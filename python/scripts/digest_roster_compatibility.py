"""Historical compatibility policy, exception register, status suppression, and
display-label safety (RESCOPE §9 items 1-5 and §11 item 9).

Strict current acceptance refuses any artifact violating qsl_digest_account_roster.v1
or qsl_digest_enrollment_artifact.v1 without alternate-parser repair. Retained
historical artifacts enter an explicit per-artifact exception register tied to exact
bytes, with display-label safety recorded separately from management-status authority.
Unsupported statuses and unverified labels are suppressed across all general outputs.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

from digest_roster_validator import (
    ARTIFACT_FORMAT,
    CODE,
    CONFLICT,
    ROSTER_FORMAT,
    STATUS_AVAILABLE,
    UNAVAILABLE,
    AuthorityError,
    strict_json,
    validate_artifact,
    validate_roster_envelope,
)

HISTORICAL_INSPECTION_ONLY = 'historical_inspection_only'
FORBIDDEN_HISTORICAL_PURPOSES = frozenset({
    'current_roster',
    'current_acquisition',
    'private_recipient_authorization',
    'display_cache_seeding',
    'general_output',
})

# RESCOPE §9 item 5 seeded exception classes (inventory seeds only; never confer trust on members).
HISTORICAL_EXCEPTION_CLASSES = {
    'pr1211_contract_invalid_envelope': {
        'description': 'PR #1211-era constructor envelope of contract-invalid bytes (R3 §2 F08 class).',
        'default_failures': ('pr1211_contract_invalid_envelope',),
        'default_label_evidence': 'unverified_historical_bytes',
        'default_status_evidence': 'contract_validation_failed',
    },
    'legacy_fallback_empty_bindings': {
        'description': 'Legacy fallback document serializing group labels with both binding lists empty (R3 §2 row 16 class).',
        'default_failures': ('label_safety_unproven_empty_bindings', 'unsupported_legacy_status_claim'),
        'default_label_evidence': 'absent_source_bytes_empty_bindings',
        'default_status_evidence': 'unsupported_legacy_claim',
    },
    'legacy_selected_prep_only_labels': {
        'description': 'Historical selected artifact whose only label evidence is a PREP-input locator match (R3 §2 class).',
        'default_failures': ('label_safety_unproven_prep_only', 'unsupported_legacy_status_claim'),
        'default_label_evidence': 'prep_only_match_without_source_bytes',
        'default_status_evidence': 'unsupported_legacy_claim',
    },
}

EXCEPTION_ENTRY_FIELDS = (
    'identity',
    'original_format_version',
    'known_validation_failures',
    'reason_for_exception',
    'evidence',
    'permitted_usage',
    'label_and_status_trust',
)

_NEUTRAL_UNKNOWN_STATUS = {
    'en': 'Quant management status unknown',
    'zh': '量化管理状态未知',
}
_NEUTRAL_UNVERIFIED_NOTE = {
    'en': 'Unverified historical record',
    'zh': '未核实历史记录',
}


def accept_current_roster(raw_payload):
    """Strict current acceptance (§9 item 1): only B3-conformant validated
    available envelopes can represent current authority; never repairs or falls back.
    """
    doc = validate_roster_envelope(raw_payload)
    if doc['format'] != ROSTER_FORMAT or doc['status'] != STATUS_AVAILABLE:
        raise AuthorityError('roster_not_authoritative', UNAVAILABLE)
    return doc


def accept_current_enrollment_artifact(raw_payload):
    """Strict current acceptance for enrollment artifacts (§9 item 1)."""
    doc = strict_json(raw_payload) if isinstance(raw_payload, (bytes, bytearray, str)) else raw_payload
    return validate_artifact(doc)


def _extract_group_count_and_labels(document):
    """Extract raw historical groups without trusting labels or management statuses."""
    groups = document.get('accounts') if isinstance(document.get('accounts'), list) else document.get('groups')
    if not isinstance(groups, list) or not groups:
        return 1, [()]
    raw_groups = []
    for group in groups:
        if not isinstance(group, dict):
            raw_groups.append(())
            continue
        labels = []
        raw_lbls = group.get('labels')
        if isinstance(raw_lbls, list):
            for item in raw_lbls:
                if isinstance(item, dict) and isinstance(item.get('label'), str):
                    labels.append(item['label'])
                elif isinstance(item, list) and len(item) >= 3 and isinstance(item[2], str):
                    labels.append(item[2])
        if isinstance(group.get('account_label'), str):
            labels.append(group['account_label'])
        raw_groups.append(tuple(labels))
    return len(raw_groups), raw_groups


def _neutral_label(index, locale):
    """Bounded neutral header independent of any hidden historical label (§9 item 4)."""
    if locale == 'zh':
        return f'账户 {index}'
    return f'Account {index}'


@dataclass(frozen=True)
class HistoricalExceptionEntry:
    """Exact seven-field register entry (§9 item 2) tied to exact retained bytes."""
    identity: str
    original_format_version: str
    known_validation_failures: tuple
    reason_for_exception: str
    evidence: dict
    permitted_usage: tuple
    label_and_status_trust: dict

    def as_dict(self):
        return {
            'identity': self.identity,
            'original_format_version': self.original_format_version,
            'known_validation_failures': list(self.known_validation_failures),
            'reason_for_exception': self.reason_for_exception,
            'evidence': dict(self.evidence),
            'permitted_usage': list(self.permitted_usage),
            'label_and_status_trust': dict(self.label_and_status_trust),
        }


@dataclass(frozen=True)
class HistoricalPresentation:
    """Safe, status-suppressed, label-safe presentation for a registered historical artifact."""
    identity: str
    verified: bool
    locale: str
    headers: tuple
    neutral_labels: tuple
    suppressed_status_code: str
    general_envelope: dict = field(repr=False)
    log_record: dict = field(repr=False)
    receipt_record: dict = field(repr=False)
    preview_record: dict = field(repr=False)


def _render_safe_presentation(entry: HistoricalExceptionEntry, group_count: int, locale: str) -> HistoricalPresentation:
    loc = 'zh' if str(locale).lower().startswith('zh') else 'en'
    neutral_labels = tuple(_neutral_label(idx + 1, loc) for idx in range(group_count))
    status_text = _NEUTRAL_UNKNOWN_STATUS[loc]
    unverified = _NEUTRAL_UNVERIFIED_NOTE[loc]
    headers = tuple(f'🏦 {label} · {status_text} · {unverified}' for label in neutral_labels)
    safe_groups = [
        {
            'ordinal': idx + 1,
            'display_label': neutral_labels[idx],
            'management_class': None,
            'management_status': 'unknown',
            'evidence_state': 'unknown',
            'processing_eligible': False,
            'verified': False,
        }
        for idx in range(group_count)
    ]
    general_envelope = {
        'historical_identity': entry.identity,
        'original_format_version': entry.original_format_version,
        'verified': False,
        'authoritative_current': False,
        'management_status': 'unknown',
        'display_labels_safe': entry.label_and_status_trust['display_labels_safe'],
        'management_status_authoritative': entry.label_and_status_trust['management_status_authoritative'],
        'groups': safe_groups,
        'headers': list(headers),
    }
    log_record = {
        'event': 'historical_exception_retained',
        'identity': entry.identity,
        'verified': False,
        'known_validation_failures': list(entry.known_validation_failures),
        'permitted_usage': list(entry.permitted_usage),
        'group_count': group_count,
    }
    receipt_record = {
        'historical_identity': entry.identity,
        'verified': False,
        'status_suppressed': True,
        'labels_suppressed': not entry.label_and_status_trust['display_labels_safe'],
        'headers': list(headers),
    }
    preview_record = {
        'mode': 'historical_preview_suppressed',
        'identity': entry.identity,
        'verified': False,
        'headers': list(headers),
    }
    return HistoricalPresentation(
        identity=entry.identity,
        verified=False,
        locale=loc,
        headers=headers,
        neutral_labels=neutral_labels,
        suppressed_status_code='unknown',
        general_envelope=general_envelope,
        log_record=log_record,
        receipt_record=receipt_record,
        preview_record=preview_record,
    )


class HistoricalExceptionRegister:
    """Per-artifact exception register tied to exact retained bytes (§9 items 2-5)."""

    def __init__(self):
        self._entries: dict[str, HistoricalExceptionEntry] = {}
        self._raw_bytes: dict[str, bytes] = {}
        self._group_counts: dict[str, int] = {}

    def register_historical_artifact(
        self,
        raw_bytes: bytes,
        *,
        exception_class: str,
        reason_for_exception: str = 'retained_historical_compatibility_record',
        affirmative_safe_labels: bool = False,
        affirmative_source_bytes: bytes | None = None,
    ) -> HistoricalExceptionEntry:
        """Strictly verify the artifact fails current contract, then enter it per exact bytes."""
        if not isinstance(raw_bytes, (bytes, bytearray)) or not raw_bytes:
            raise ValueError('historical_bytes_required')
        if exception_class not in HISTORICAL_EXCEPTION_CLASSES:
            raise ValueError('historical_exception_class_unknown')
        raw = bytes(raw_bytes)
        digest = hashlib.sha256(raw).hexdigest()
        identity = f'hist_sha256_{digest}'

        failures = []
        document = None
        try:
            document = strict_json(raw)
        except AuthorityError as err:
            failures.append(err.code)

        if not isinstance(document, dict):
            if 'json_invalid' not in failures:
                failures.append('roster_shape_invalid')
            orig_format = 'unknown_unparseable'
            group_count = 1
        else:
            orig_format = str(
                document.get('format') or document.get('schema_version') or f'legacy_{exception_class}'
            )
            group_count, _ = _extract_group_count_and_labels(document)
            # Check strict current contract first: F08 / contract-invalid envelopes must fail current acceptance.
            if orig_format == ARTIFACT_FORMAT:
                try:
                    validate_artifact(document)
                except AuthorityError as err:
                    failures.append(err.code)
            else:
                try:
                    accept_current_roster(document)
                    if exception_class == 'pr1211_contract_invalid_envelope':
                        raise ValueError('current_conformant_artifact_cannot_use_exception_register')
                except AuthorityError as err:
                    failures.append(err.code)

            if exception_class == 'legacy_fallback_empty_bindings':
                groups = document.get('accounts') or document.get('groups') or []
                if isinstance(groups, list) and all(
                    isinstance(g, dict)
                    and not (g.get('legacy_run_bindings') or [])
                    and not (g.get('observation_bindings') or [])
                    for g in groups
                ):
                    failures.append('label_safety_unproven_empty_bindings')
                failures.append('unsupported_legacy_status_claim')
            elif exception_class == 'legacy_selected_prep_only_labels':
                failures.append('label_safety_unproven_prep_only')
                failures.append('unsupported_legacy_status_claim')

        cls_meta = HISTORICAL_EXCEPTION_CLASSES[exception_class]
        for code in cls_meta['default_failures']:
            if code not in failures:
                failures.append(code)
        failures = tuple(dict.fromkeys(code for code in failures if CODE.fullmatch(code)))

        # Display-label safety (§9 item 4): lack of source bytes for locator comparison is
        # insufficient evidence; both empty-binding fallbacks and PREP-only artifacts suppress labels.
        has_source_bytes = isinstance(affirmative_source_bytes, (bytes, bytearray)) and len(affirmative_source_bytes) > 0
        labels_safe = (
            bool(affirmative_safe_labels)
            and has_source_bytes
            and exception_class not in {'legacy_fallback_empty_bindings', 'legacy_selected_prep_only_labels'}
        )
        label_evidence = (
            'affirmative_source_bytes_verified'
            if labels_safe
            else cls_meta['default_label_evidence']
        )

        # Management status authority is recorded separately (§9 items 3-4).
        trust = {
            'display_labels_safe': labels_safe,
            'label_safety_evidence': label_evidence,
            'management_status_authoritative': False,
            'status_authority_evidence': cls_meta['default_status_evidence'],
            'verified': False,
        }
        entry = HistoricalExceptionEntry(
            identity=identity,
            original_format_version=orig_format,
            known_validation_failures=failures,
            reason_for_exception=reason_for_exception,
            evidence={
                'exception_class': exception_class,
                'artifact_sha256': digest,
                'byte_length': len(raw),
                'has_affirmative_source_bytes': has_source_bytes,
            },
            permitted_usage=(HISTORICAL_INSPECTION_ONLY,),
            label_and_status_trust=trust,
        )
        self._entries[identity] = entry
        self._raw_bytes[identity] = raw
        self._group_counts[identity] = group_count
        return entry

    def get_entry(self, identity: str) -> HistoricalExceptionEntry | None:
        return self._entries.get(identity)

    def inspect_raw_historical_record(self, identity: str, *, purpose: str) -> bytes:
        """Raw historical bytes remain accessible ONLY for the registered historical use (§9 item 4)."""
        if purpose != HISTORICAL_INSPECTION_ONLY:
            raise AuthorityError('historical_usage_forbidden', CONFLICT)
        entry = self._entries.get(identity)
        if entry is None or HISTORICAL_INSPECTION_ONLY not in entry.permitted_usage:
            raise AuthorityError('historical_exception_not_registered', UNAVAILABLE)
        return self._raw_bytes[identity]

    def present_historical(self, identity: str, *, locale: str = 'en') -> HistoricalPresentation:
        """Render status-suppressed, display-label-safe output for general surfaces in `en` or `zh`."""
        entry = self._entries.get(identity)
        if entry is None:
            raise AuthorityError('historical_exception_not_registered', UNAVAILABLE)
        return _render_safe_presentation(entry, self._group_counts[identity], locale)

    def authorize_operational_use(self, identity: str, *, operation: str):
        """Historical exceptions may NEVER authorize current roster, acquisition, recipient, or cache seed."""
        if operation in FORBIDDEN_HISTORICAL_PURPOSES:
            raise AuthorityError('historical_usage_forbidden', CONFLICT)
        raise AuthorityError('historical_usage_forbidden', CONFLICT)


__all__ = [
    'EXCEPTION_ENTRY_FIELDS',
    'FORBIDDEN_HISTORICAL_PURPOSES',
    'HISTORICAL_EXCEPTION_CLASSES',
    'HISTORICAL_INSPECTION_ONLY',
    'HistoricalExceptionEntry',
    'HistoricalExceptionRegister',
    'HistoricalPresentation',
    'accept_current_enrollment_artifact',
    'accept_current_roster',
]
