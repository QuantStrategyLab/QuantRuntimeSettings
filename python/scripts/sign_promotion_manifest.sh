#!/usr/bin/env bash
# Human-run signer. Impersonates the dedicated signer service account, which is
# the only principal with roles/cloudkms.signerVerifier on the platform root
# key. No private key material ever leaves Cloud KMS; nothing secret is printed.
# Usage: sign_promotion_manifest.sh <platform> <manifest.json> <out-signature.b64>
set -euo pipefail
platform="$1"; manifest="$2"; out="$3"
here="$(cd "$(dirname "$0")" && pwd)"
case "$platform" in
  longbridge) project=longbridgequant ;;
  *) echo "no signer configured for ${platform}" >&2; exit 2 ;;
esac
signer="qsl-promotion-signer@${project}.iam.gserviceaccount.com"
key_version="projects/${project}/locations/global/keyRings/qsl-p0-policy-root/cryptoKeys/autonomy-policy-root-v1/cryptoKeyVersions/1"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
python3 "$here/promotion_signature.py" payload --manifest "$manifest" --output "$work/payload.bin"
gcloud kms asymmetric-sign --version="$key_version" --digest-algorithm=sha256 \
  --input-file="$work/payload.bin" --signature-file="$work/sig.der" \
  --impersonate-service-account="$signer" --quiet
base64 < "$work/sig.der" | tr -d '\n' > "$out"
echo "signature written to $out"
