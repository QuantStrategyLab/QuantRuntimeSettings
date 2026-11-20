"""Paper boundaries, typed intake and the six digest quantities (Q6).

All quantities are computed from one current `GenerationRoster` for a named
business day; nothing here reads a source, an environment variable or a
legacy array. Scope is the group's B2 `scope`: `paper` is the paper scope and
every other value (live or a missing environment) is the live scope, so a
missing environment can never escape the live rules as paper. Paper is always
reported in its own scope.

Coverage is observation coverage only: an accepted, uniquely bound, in-scope,
current-day typed account observation for the indicated domain (an explicit
empty observation included). A successful read, a run receipt, a missing
binding, stale-only data or an explicit non-run never covers raw account
facts. Simulated strategy rows (`SIMULATION_MODES`) never enter live
activity, run counts or coverage.
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass

from account_daily_facts import SIMULATION_MODES
from digest_roster_authority import (
    CODE, MAX_FUTURE_SKEW, OBSERVATION_BINDING_FIELDS, GenerationRoster, parse_instant, trusted_clock,
)

PAPER, LIVE = 'paper', 'live'
SCOPES = (LIVE, PAPER)
ANY_DOMAIN = 'any'
OBSERVATION_TYPE = 'account_observation'
OBSERVATION_KEYS = frozenset({'type', *OBSERVATION_BINDING_FIELDS, 'business_day', 'observed_at', 'facts'})
RUN_IDENTITY = ('platform_id', 'opaque_account_uid', 'target_id', 'strategy_profile', 'source_run_id')


def scope_of(group):
    return PAPER if group.live.scope == PAPER else LIVE


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


@dataclass(frozen=True)
class AdmittedObservations:
    """Accepted facts and covered domains per physical group (by deployments)."""
    facts: dict          # deployments -> tuple of (domain, canonical fact JSON)
    covered: dict        # deployments -> frozenset of domains
    rejected: dict       # reason code -> count


def admit_observations(roster, observations, business_day, clock):
    """Admit typed account observations against this generation's bindings.

    Every bound field must match the binding exactly; the declared business
    day must be the requested day and the observation time must be valid and
    not later than the generation clock (plus the permitted skew). A run row
    presented as an observation, a wrong owner, an ambiguous source or an
    inconsistent environment/scope admits nothing. A raw row cannot create a
    binding. An identical repeated observation contributes once.
    """
    if not isinstance(roster, GenerationRoster):
        raise ValueError('generation_roster_required')
    clock = trusted_clock(clock)
    bindings = {}
    for group in roster.groups:
        for binding in group.observation_bindings:
            bindings[binding['binding_id']] = (group, binding)
    facts, covered, rejected = defaultdict(dict), defaultdict(set), defaultdict(int)
    for raw in observations:
        reason = None
        if not isinstance(raw, dict) or raw.get('type') != OBSERVATION_TYPE:
            presented_run = isinstance(raw, dict) and 'source_run_id' in raw
            reason = 'run_as_observation' if presented_run else 'observation_type_invalid'
        elif frozenset(raw) != OBSERVATION_KEYS:
            reason = 'observation_shape_invalid'
        elif raw['binding_id'] not in bindings:
            reason = 'observation_binding_unknown'
        else:
            group, binding = bindings[raw['binding_id']]
            observed = parse_instant(raw['observed_at'])
            if any(raw[name] != binding[name] for name in OBSERVATION_BINDING_FIELDS):
                reason = 'observation_binding_mismatch'
            elif raw['business_day'] != business_day:
                reason = 'observation_day_mismatch'
            elif observed is None or observed > clock + MAX_FUTURE_SKEW:
                reason = 'observation_time_invalid'
            elif (not isinstance(raw['facts'], dict) or not raw['facts']
                  or not all(isinstance(name, str) and CODE.fullmatch(name) and name != ANY_DOMAIN
                             and isinstance(value, (list, dict)) for name, value in raw['facts'].items())):
                reason = 'observation_facts_invalid'
        if reason:
            rejected[reason] += 1
            continue
        for domain, value in raw['facts'].items():
            facts[group.deployments][(domain, _canonical(value))] = None
            covered[group.deployments].add(domain)
    return AdmittedObservations({key: tuple(value) for key, value in facts.items()},
                                {key: frozenset(value) for key, value in covered.items()}, dict(rejected))


@dataclass(frozen=True)
class RunCounts:
    observed_runs: int | None      # distinct accepted runs; None when evidence is unknown
    confirmed_runs: int
    unknown_evidence: int
    expected_targets: int
    covered_targets: int
    non_run_targets: int
    simulated_excluded: int


def reduce_runs(roster, rows):
    """Distinct accepted actual runs per scope over the bound targets.

    Identity is (platform, opaque UID, target, strategy profile, source run
    ID); a retry with the same full identity counts once. An explicit non-run
    covers its target with zero runs. A simulated row is excluded entirely. A
    run without a full identity, or the same identity reported both as a run
    and a non-run, leaves the count unknown.
    """
    if not isinstance(roster, GenerationRoster):
        raise ValueError('generation_roster_required')
    targets = {}
    for group in roster.groups:
        for binding in group.legacy_run_bindings:
            targets[tuple(binding[name] for name in RUN_IDENTITY[:4])] = scope_of(group)
    runs, non_runs, unknown = defaultdict(set), defaultdict(set), defaultdict(set)
    simulated = defaultdict(int)
    covered = defaultdict(set)
    for row in rows:
        if not isinstance(row, dict):
            continue
        target = tuple(row.get(name) for name in RUN_IDENTITY[:4])
        scope = targets.get(target)
        if scope is None:
            continue
        if str(row.get('execution_mode') or '').strip().lower() in SIMULATION_MODES:
            simulated[scope] += 1
            continue
        run_id = row.get('source_run_id')
        if row.get('actually_ran') is False:
            non_runs[scope].add(target)
            covered[scope].add(target)
            if isinstance(run_id, str) and run_id:
                non_runs[scope].add((*target, run_id))
        elif row.get('actually_ran') is True and isinstance(run_id, str) and run_id:
            runs[scope].add((*target, run_id))
            covered[scope].add(target)
        else:
            unknown[scope].add(target)
    result = {}
    for scope in SCOPES:
        contradicted = runs[scope] & non_runs[scope]
        unknown_count = len(unknown[scope]) + len(contradicted)
        confirmed = len(runs[scope] - contradicted)
        result[scope] = RunCounts(None if unknown_count else confirmed, confirmed, unknown_count,
                                  sum(1 for value in targets.values() if value == scope),
                                  len(covered[scope]), len({item for item in non_runs[scope] if len(item) == 4}),
                                  simulated[scope])
    return result


def _cohort(roster):
    """Per scope: displayed, eligible, confirmed-enabled, disabled, outside,
    unknown-eligible group keys."""
    cohort = {scope: defaultdict(list) for scope in SCOPES}
    for group in roster.groups:
        live, bucket = group.live, cohort[scope_of(group)]
        bucket['display'].append(group.deployments)
        if live.management_class == 'eligible':
            bucket['eligible'].append(group.deployments)
            if live.evidence_state == 'known' and live.management_status == 'managed' and live.processing_eligible:
                bucket['enabled'].append(group.deployments)
            elif live.evidence_state == 'known' and live.management_status == 'management_disabled':
                bucket['disabled'].append(group.deployments)
            else:
                bucket['unknown'].append(group.deployments)
        elif live.evidence_state == 'known' and live.management_status == 'not_under_management':
            bucket['outside'].append(group.deployments)
        else:
            # A display-only group with contradictory state is unknown, never
            # silently outside management.
            bucket['outside_unknown'].append(group.deployments)
    return cohort


def _fraction(covered, denominator, status, reason=None):
    return {'covered': covered, 'denominator': denominator, 'status': status, 'reason': reason}


def roster_quantities(roster, admitted, runs, domains=()):
    """The six named quantities with their pinned units.

    `domains` names the fact domains to report besides the summary `any`
    domain (the union over domains)."""
    if not isinstance(roster, GenerationRoster) or not isinstance(admitted, AdmittedObservations):
        raise ValueError('generation_roster_required')
    cohort = _cohort(roster)
    unresolved = len(roster.observation.uncovered)
    groups = {scope: len(cohort[scope]['display']) for scope in SCOPES}
    display = sum(groups.values())
    eligible = sum(len(cohort[scope]['eligible']) for scope in SCOPES)
    result = {
        'display': {'count': display, 'unresolved_deployments': unresolved, 'last_known': False},
        'eligible': {'count': eligible, 'unresolved': unresolved, 'denominator': display,
                     'total': eligible if unresolved == 0 else None},
        'enabled': {}, 'managed_coverage': {}, 'raw_coverage': {}, 'runs': runs,
    }
    # Unresolved deployments have no certified class or scope: they are
    # possible live members, never paper.
    unknown = {scope: len(cohort[scope]['unknown']) + len(cohort[scope]['outside_unknown'])
               + (unresolved if scope == LIVE else 0) for scope in SCOPES}
    for scope in SCOPES:
        bucket = cohort[scope]
        confirmed = len(bucket['enabled'])
        result['enabled'][scope] = {
            'confirmed': confirmed, 'unknown': unknown[scope], 'disabled': len(bucket['disabled']),
            'outside': len(bucket['outside']), 'eligible': len(bucket['eligible']),
            'total': confirmed if unknown[scope] == 0 else None, 'lower_bound': unknown[scope] > 0,
        }
    result['enabled']['all'] = {
        'confirmed': sum(result['enabled'][scope]['confirmed'] for scope in SCOPES),
        'unknown': sum(unknown.values()),
        'total': (sum(result['enabled'][scope]['confirmed'] for scope in SCOPES)
                  if not any(unknown.values()) else None),
    }
    result['live_totals_available'] = unknown[LIVE] == 0
    result['live_totals_reason'] = None if unknown[LIVE] == 0 else 'management_status_unknown'
    if unknown[LIVE] == 0 and not cohort[LIVE]['enabled']:
        result['live_totals_reason'] = 'no_managed_non_paper_accounts'

    def covers(key, domain):
        domains_for = admitted.covered.get(key, frozenset())
        return bool(domains_for) if domain == ANY_DOMAIN else domain in domains_for

    for domain in (ANY_DOMAIN, *domains):
        managed, raw = {}, {}
        for scope in SCOPES:
            bucket = cohort[scope]
            enabled = bucket['enabled']
            covered = sum(covers(key, domain) for key in enabled)
            if unknown[scope]:
                managed[scope] = _fraction(covered, len(enabled), 'confirmed_subset', 'management_status_unknown')
            elif not enabled:
                managed[scope] = _fraction(None, 0, 'not_applicable',
                                           'no_managed_non_paper_accounts' if scope == LIVE else None)
            else:
                managed[scope] = _fraction(covered, len(enabled), 'complete')
            raw[scope] = _fraction(sum(covers(key, domain) for key in bucket['display']), groups[scope],
                                   'complete' if groups[scope] else 'not_applicable')
        enabled_all = sum(managed[scope]['denominator'] for scope in SCOPES)
        managed['all'] = _fraction(sum(managed[scope]['covered'] or 0 for scope in SCOPES), enabled_all,
                                   'complete' if not any(unknown.values()) and enabled_all
                                   else 'confirmed_subset' if any(unknown.values())
                                   else 'not_applicable',
                                   'management_status_unknown' if any(unknown.values()) else None)
        raw['all'] = _fraction(sum(raw[scope]['covered'] for scope in SCOPES), display,
                               'complete' if display else 'not_applicable')
        result['managed_coverage'][domain] = managed
        result['raw_coverage'][domain] = raw
    return result


def unavailable_quantities(snapshot_display=None):
    """Quantities under Q5 fallback: no current class, enabled population or
    coverage; a retained display count is labeled last-known only."""
    return {'display': {'count': snapshot_display, 'unresolved_deployments': None,
                        'last_known': snapshot_display is not None},
            'eligible': None, 'enabled': None, 'managed_coverage': None, 'raw_coverage': None, 'runs': None,
            'live_totals_available': False, 'live_totals_reason': 'management_status_unknown'}


def managed_run_bindings(roster):
    """Legacy run bindings that may drive managed processing: only those of
    confirmed-managed groups (B2's processing predicate). Other groups keep
    their bindings for display and history, never for new processing."""
    if not isinstance(roster, GenerationRoster):
        raise ValueError('generation_roster_required')
    return [dict(binding) for group in roster.groups if group.live.processing_eligible
            for binding in group.legacy_run_bindings]
