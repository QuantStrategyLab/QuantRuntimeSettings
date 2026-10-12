"""Detached Cloud KMS (EC_SIGN_P256_SHA256) signatures for Promotion Manifests.

The qsl.activation.v2 promotion schema is unchanged: the signature is a
detached DER signature over a domain-separated payload, so existing manifest
validation and other consumers keep their exact behaviour.

Payload = b"qsl.promotion_signature.v1\\n" + canonical_promotion_json(manifest)

Domain separation keeps a promotion signature from ever being valid as an
autonomy-policy signature made with the same per-project KMS root key, and
vice versa. Trust comes from the public root record in
docs/p0_control_roots/gcp/<project>.json, accepted only when its self digest
equals a digest pinned outside the workflow inputs (protected Environment
variable QSL_PROMOTION_TRUSTED_ROOTS_JSON). Private keys never leave Cloud KMS.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping

from activation_contract import ActivationValidationError, calculate_promotion_sha256, canonical_promotion_json
from gcp_kms_policy_gate import GcpKmsPolicyValidationError, validate_gcp_kms_policy_root

PAYLOAD_PREFIX = b"qsl.promotion_signature.v1\n"
ROOT = Path(__file__).resolve().parents[2]
ROOTS_DIR = ROOT / "docs" / "p0_control_roots" / "gcp"
# One trust domain per platform; never borrow another platform's root.
PLATFORM_ROOT_PROJECTS = {
    "longbridge": "longbridgequant",
    "ibkr": "interactivebrokersquant",
    "schwab": "charlesschwabquant",
    "firstrade": "firstradequant",
    "binance": "binancequant",
}
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
MAX_TTL_SECONDS = 24 * 3600
_MAX_SIGNATURE_BYTES = 128  # DER P-256 ECDSA signatures are at most 72 bytes.


class PromotionSignatureError(ValueError):
    pass


def _fail(message: str) -> None:
    raise PromotionSignatureError(message)


def signing_payload(manifest: Mapping[str, Any]) -> bytes:
    if not isinstance(manifest, Mapping):
        _fail("promotion manifest must be an object")
    if manifest.get("promotion_sha256") != calculate_promotion_sha256(manifest):
        _fail("promotion_sha256 mismatch")
    return PAYLOAD_PREFIX + canonical_promotion_json(manifest).encode("utf-8")


def load_trusted_root(platform: str, pinned_roots: Mapping[str, Any], *, as_of: str | None = None) -> Mapping[str, Any]:
    project = PLATFORM_ROOT_PROJECTS.get(platform)
    if project is None:
        _fail("platform has no promotion trust root")
    pinned = pinned_roots.get(platform) if isinstance(pinned_roots, Mapping) else None
    if not isinstance(pinned, str) or not _SHA256.fullmatch(pinned):
        _fail("platform promotion trust root is not pinned")
    path = ROOTS_DIR / f"{project}.json"
    if path.is_symlink() or not path.is_file():
        _fail("platform promotion trust root record is missing")
    try:
        root = json.loads(path.read_text(encoding="utf-8"))
        return validate_gcp_kms_policy_root(root, expected_root_sha256=pinned, as_of=as_of)
    except (OSError, ValueError, GcpKmsPolicyValidationError) as exc:
        raise PromotionSignatureError("platform promotion trust root is invalid") from exc


def decode_signature(signature_b64: str) -> bytes:
    if not isinstance(signature_b64, str) or not signature_b64.strip():
        _fail("promotion signature is required")
    try:
        signature = base64.b64decode(signature_b64.strip(), validate=True)
    except (binascii.Error, ValueError):
        _fail("promotion signature must be base64")
    if not signature or len(signature) > _MAX_SIGNATURE_BYTES or signature[0] != 0x30:
        _fail("promotion signature must be a DER ECDSA signature")
    return signature


def verify_signature(manifest: Mapping[str, Any], signature: bytes, root: Mapping[str, Any]) -> str:
    payload = signing_payload(manifest)
    with tempfile.TemporaryDirectory(prefix="qsl-promotion-verify-") as directory:
        temporary = Path(directory)
        (temporary / "public.pem").write_text(str(root["public_key_pem"]), encoding="utf-8")
        (temporary / "sig.der").write_bytes(signature)
        (temporary / "payload.bin").write_bytes(payload)
        try:
            result = subprocess.run(
                ["openssl", "dgst", "-sha256", "-verify", str(temporary / "public.pem"),
                 "-signature", str(temporary / "sig.der"), str(temporary / "payload.bin")],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
            )
        except OSError as exc:
            raise PromotionSignatureError("OpenSSL verifier is unavailable") from exc
    if result.returncode != 0:
        _fail("promotion signature verification failed")
    return hashlib.sha256(signature).hexdigest()


def verify(manifest: Mapping[str, Any], signature_b64: str, *, platform: str,
           pinned_roots: Mapping[str, Any], as_of: str | None = None) -> dict[str, str]:
    target = manifest.get("target") if isinstance(manifest, Mapping) else None
    if not isinstance(target, Mapping) or target.get("platform") != platform:
        _fail("promotion manifest platform does not match")
    from activation_contract import _parse_timestamp  # same timestamp grammar as the manifest validator
    window = _parse_timestamp(manifest.get("expires_at"), "expires_at") - _parse_timestamp(manifest.get("issued_at"), "issued_at")
    if window.total_seconds() > MAX_TTL_SECONDS:
        _fail("promotion manifest validity window is too long")
    root = load_trusted_root(platform, pinned_roots, as_of=as_of)
    signature_sha256 = verify_signature(manifest, decode_signature(signature_b64), root)
    return {"root_id": str(root["root_id"]), "signature_sha256": signature_sha256,
            "promotion_sha256": str(manifest["promotion_sha256"])}


def unpack_envelope(text: str) -> tuple[Mapping[str, Any], str]:
    try:
        envelope = json.loads(text)
    except json.JSONDecodeError:
        _fail("signed promotion envelope must be JSON")
    if not isinstance(envelope, dict) or set(envelope) != {"promotion_manifest", "kms_signature_b64"}:
        _fail("signed promotion envelope must contain exactly promotion_manifest and kms_signature_b64")
    if not isinstance(envelope["promotion_manifest"], dict) or not isinstance(envelope["kms_signature_b64"], str):
        _fail("signed promotion envelope fields have invalid types")
    return envelope["promotion_manifest"], envelope["kms_signature_b64"]


def _load_json_file(path: str) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    payload = sub.add_parser("payload", help="write the exact bytes a signer must sign")
    payload.add_argument("--manifest", required=True)
    payload.add_argument("--output", required=True)
    unpack = sub.add_parser("unpack", help="split a signed envelope read from stdin")
    unpack.add_argument("--manifest-output", required=True)
    unpack.add_argument("--signature-output", required=True)
    check = sub.add_parser("verify", help="verify a detached signature against a pinned root")
    check.add_argument("--manifest", required=True)
    check.add_argument("--signature-b64-file", required=True)
    check.add_argument("--platform", required=True)
    check.add_argument("--pinned-roots-json", required=True, help="JSON object {platform: trusted_policy_root_sha256}")
    args = parser.parse_args(argv)
    try:
        if args.command == "unpack":
            manifest, signature_b64 = unpack_envelope(sys.stdin.read())
            Path(args.manifest_output).write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
            Path(args.signature_output).write_text(signature_b64, encoding="utf-8")
            return 0
        manifest = _load_json_file(args.manifest)
        if args.command == "payload":
            Path(args.output).write_bytes(signing_payload(manifest))
            print(json.dumps({"payload_sha256": hashlib.sha256(signing_payload(manifest)).hexdigest()}))
            return 0
        signature_b64 = Path(args.signature_b64_file).read_text(encoding="utf-8")
        result = verify(manifest, signature_b64, platform=args.platform,
                        pinned_roots=json.loads(args.pinned_roots_json))
    except (OSError, ValueError, KeyError, TypeError, ActivationValidationError) as exc:
        print(f"promotion_signature_not_verified: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
