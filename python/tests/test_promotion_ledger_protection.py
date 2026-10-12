"""Offline, table-driven checks for promotion_ledger.require_protected_ledger.

Every case uses a fake ``gh api`` runner; no network request is made.
"""
import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import promotion_ledger as ledger

LEDGER = "refs/tags/qsl-promotion-consumed/**"


def _response(status, body=None):
    text = f"HTTP/2.0 {status} X\r\nContent-Type: application/json\r\n\r\n" + (json.dumps(body) if body is not None else "")
    return subprocess.CompletedProcess([], 0, stdout=text, stderr="")


def _detail(**overrides):
    detail = {
        "id": 7, "name": "promotion-ledger", "target": "tag", "source_type": "Repository", "source": "o/r",
        "enforcement": "active", "bypass_actors": [], "current_user_can_bypass": "never",
        "conditions": {"ref_name": {"include": [LEDGER], "exclude": []}},
        "rules": [{"type": "deletion"}, {"type": "update"}],
        "node_id": "RRS_x", "created_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-01T00:00:00Z",
        "_links": {"self": {"href": "https://api.github.com/repos/o/r/rulesets/7"}},
    }
    for key, value in overrides.items():
        if value is _DROP:
            detail.pop(key, None)
        else:
            detail[key] = value
    return detail


_DROP = object()


def _ref_name(include=(LEDGER,), exclude=(), **extra):
    ref_name = {"include": list(include) if isinstance(include, tuple) else include,
                "exclude": list(exclude) if isinstance(exclude, tuple) else exclude}
    ref_name.update(extra)
    return {"ref_name": ref_name}


def _single(detail, summary_enforcement="active"):
    return [_response(200, [{"id": 7, "enforcement": summary_enforcement}]), _response(200, detail)]


def _without_exclude():
    detail = _detail()
    del detail["conditions"]["ref_name"]["exclude"]
    return detail


# (case id, gh api responses in call order, expected_accept)
CASES = [
    # --- baseline ---
    ("baseline_exclude_empty", _single(_detail()), True),
    ("baseline_exclude_unrelated_tag_pattern",
     _single(_detail(conditions=_ref_name(exclude=("refs/tags/v*", "refs/tags/release/**")))), True),
    ("baseline_exclude_sibling_prefix",
     _single(_detail(conditions=_ref_name(exclude=("refs/tags/qsl-promotion-consumed-old/**",)))), True),
    # --- ref_name.exclude covering ledger refs ---
    ("exclude_whole_ledger_prefix", _single(_detail(conditions=_ref_name(exclude=(LEDGER,)))), False),
    ("exclude_ledger_prefix_single_star",
     _single(_detail(conditions=_ref_name(exclude=("refs/tags/qsl-promotion-consumed/*",)))), False),
    ("exclude_single_ledger_tag",
     _single(_detail(conditions=_ref_name(exclude=("refs/tags/qsl-promotion-consumed/longbridge-sg-0001",)))), False),
    ("exclude_wildcard_matching_ledger_tag",
     _single(_detail(conditions=_ref_name(exclude=("refs/tags/qsl-promotion-consumed/longbridge-*",)))), False),
    ("exclude_wildcard_before_ledger_prefix", _single(_detail(conditions=_ref_name(exclude=("refs/tags/qsl-*",)))), False),
    ("exclude_all_tags", _single(_detail(conditions=_ref_name(exclude=("refs/tags/**",)))), False),
    ("exclude_char_class", _single(_detail(conditions=_ref_name(exclude=("refs/tags/[q]sl-promotion-consumed/**",)))), False),
    ("exclude_case_variant", _single(_detail(conditions=_ref_name(exclude=("refs/tags/QSL-promotion-consumed/**",)))), False),
    ("exclude_tilde_all", _single(_detail(conditions=_ref_name(exclude=("~ALL",)))), False),
    ("exclude_unprefixed_ledger_pattern", _single(_detail(conditions=_ref_name(exclude=("qsl-promotion-consumed/**",)))), False),
    ("exclude_bare_star", _single(_detail(conditions=_ref_name(exclude=("*",)))), False),
    # --- malformed exclude / conditions (fail closed) ---
    ("exclude_missing", _single(_without_exclude()), False),
    ("exclude_null", _single(_detail(conditions=_ref_name(exclude=None))), False),
    ("exclude_not_list_string", _single(_detail(conditions=_ref_name(exclude=LEDGER))), False),
    ("exclude_not_list_dict", _single(_detail(conditions=_ref_name(exclude={"0": LEDGER}))), False),
    ("exclude_contains_non_string", _single(_detail(conditions=_ref_name(exclude=[None]))), False),
    ("exclude_contains_int", _single(_detail(conditions=_ref_name(exclude=[1]))), False),
    ("include_not_list", _single(_detail(conditions=_ref_name(include=LEDGER))), False),
    ("include_contains_non_string", _single(_detail(conditions=_ref_name(include=[LEDGER, 5]))), False),
    ("ref_name_unknown_key", _single(_detail(conditions=_ref_name(exclude_patterns=[LEDGER]))), False),
    ("conditions_unknown_key",
     _single(_detail(conditions={**_ref_name(), "repository_name": {"include": ["~ALL"], "exclude": ["r"]}})), False),
    ("conditions_not_mapping", _single(_detail(conditions=[LEDGER])), False),
    # --- enforcement ---
    ("enforcement_disabled_summary", _single(_detail(enforcement="disabled"), "disabled"), False),
    ("enforcement_evaluate_summary", _single(_detail(enforcement="evaluate"), "evaluate"), False),
    ("enforcement_detail_evaluate_summary_active", _single(_detail(enforcement="evaluate")), False),
    ("enforcement_detail_disabled_summary_active", _single(_detail(enforcement="disabled")), False),
    ("enforcement_detail_missing", _single(_detail(enforcement=_DROP)), False),
    # --- bypass ---
    ("bypass_actor_present", _single(_detail(bypass_actors=[{"actor_id": 5, "actor_type": "RepositoryRole",
                                                              "bypass_mode": "always"}])), False),
    ("bypass_actor_pull_request_mode", _single(_detail(bypass_actors=[{"actor_id": 1, "actor_type": "OrganizationAdmin",
                                                                        "bypass_mode": "pull_request"}])), False),
    ("bypass_actors_not_list", _single(_detail(bypass_actors={"actor_id": 5})), False),
    ("bypass_actors_hidden_but_never", _single(_detail(bypass_actors=_DROP)), True),
    ("current_user_can_bypass_always", _single(_detail(current_user_can_bypass="always")), False),
    ("current_user_can_bypass_pull_requests_only", _single(_detail(current_user_can_bypass="pull_requests_only")), False),
    ("current_user_can_bypass_missing", _single(_detail(current_user_can_bypass=_DROP)), False),
    # --- include ---
    ("include_all_tags_only", _single(_detail(conditions=_ref_name(include=("refs/tags/**",)))), False),
    ("include_other_prefix", _single(_detail(conditions=_ref_name(include=("refs/tags/qsl-promotion/**",)))), False),
    ("include_branch_pattern", _single(_detail(conditions=_ref_name(include=("refs/heads/qsl-promotion-consumed/**",)))), False),
    ("include_empty", _single(_detail(conditions=_ref_name(include=()))), False),
    ("conditions_missing", _single(_detail(conditions=_DROP)), False),
    # --- rules / target ---
    ("rule_update_missing", _single(_detail(rules=[{"type": "deletion"}])), False),
    ("rule_deletion_missing", _single(_detail(rules=[{"type": "update"}])), False),
    ("rules_empty", _single(_detail(rules=[])), False),
    ("rules_extra_types_ok", _single(_detail(rules=[{"type": "deletion"}, {"type": "update"},
                                                    {"type": "non_fast_forward"}])), True),
    ("target_branch", _single(_detail(target="branch")), False),
    # --- unknown extra fields ---
    ("unknown_top_level_field_ignored", _single(_detail(future_field={"x": 1})), True),
    # --- multiple rulesets ---
    ("multi_second_excludes_ledger_first_ok",
     [_response(200, [{"id": 7, "enforcement": "active"}, {"id": 8, "enforcement": "active"}]),
      _response(200, _detail()),
      _response(200, _detail(id=8, conditions=_ref_name(include=("~ALL",), exclude=(LEDGER,)),
                             rules=[{"type": "required_signatures"}]))], True),
    ("multi_first_excludes_ledger_second_ok",
     [_response(200, [{"id": 8, "enforcement": "active"}, {"id": 7, "enforcement": "active"}]),
      _response(200, _detail(id=8, conditions=_ref_name(exclude=("refs/tags/qsl-promotion-consumed/x-001",)))),
      _response(200, _detail())], True),
    ("multi_all_have_ledger_exclude",
     [_response(200, [{"id": 7, "enforcement": "active"}, {"id": 8, "enforcement": "active"}]),
      _response(200, _detail(conditions=_ref_name(exclude=(LEDGER,)))),
      _response(200, _detail(id=8, bypass_actors=[{"actor_id": 1}]))], False),
    ("multi_qualifying_one_is_evaluate_only",
     [_response(200, [{"id": 7, "enforcement": "evaluate"}, {"id": 8, "enforcement": "active"}]),
      _response(200, _detail(id=8, conditions=_ref_name(exclude=(LEDGER,))))], False),
    # --- API failures / uncertain responses ---
    ("list_http_500", [_response(500, {"message": "boom"})], False),
    ("list_http_403", [_response(403, {"message": "forbidden"})], False),
    ("list_not_json", [subprocess.CompletedProcess([], 0, stdout="HTTP/2.0 200 OK\r\n\r\n<html>", stderr="")], False),
    ("list_not_list", [_response(200, {"rulesets": []})], False),
    ("list_empty", [_response(200, [])], False),
    ("list_no_status_line", [subprocess.CompletedProcess([], 1, stdout="", stderr="gh: error")], False),
    ("detail_http_404", [_response(200, [{"id": 7, "enforcement": "active"}]), _response(404, {})], False),
    ("detail_http_500", [_response(200, [{"id": 7, "enforcement": "active"}]), _response(500, {})], False),
    ("detail_not_mapping", [_response(200, [{"id": 7, "enforcement": "active"}]), _response(200, [])], False),
    ("summary_id_missing", [_response(200, [{"enforcement": "active"}]), _response(200, _detail())], False),
    ("detail_id_mismatch", _single(_detail(id=99)), False),
    ("exclude_tilde_default_branch", _single(_detail(conditions=_ref_name(exclude=("~DEFAULT_BRANCH",)))), False),
    ("exclude_exact_prefix_without_slash",
     _single(_detail(conditions=_ref_name(exclude=("refs/tags/qsl-promotion-consumed",)))), False),
    ("exclude_brace_expansion", _single(_detail(conditions=_ref_name(exclude=("refs/tags/{v,qsl}*",)))), False),
    ("exclude_refs_star", _single(_detail(conditions=_ref_name(exclude=("refs/*",)))), False),
    ("summary_id_bool", [_response(200, [{"id": True, "enforcement": "active"}]), _response(200, _detail())], False),
]


def _outcome(responses):
    queue = list(copy.deepcopy(responses))
    calls = []

    def fake(command, **kwargs):
        calls.append(command)
        if not queue:
            raise subprocess.SubprocessError("unexpected extra gh api call")
        return queue.pop(0)
    try:
        ledger.require_protected_ledger("o/r", run=fake)
    except ledger.PromotionLedgerError as exc:
        return False, str(exc), calls
    except Exception as exc:  # noqa: BLE001 - recorded so the table shows crashes
        return None, f"crash:{type(exc).__name__}", calls
    return True, "accepted", calls


class RequireProtectedLedgerTableTests(unittest.TestCase):
    def test_table(self):
        for case_id, responses, expected in CASES:
            accepted, reason, _ = _outcome(responses)
            with self.subTest(case=case_id):
                self.assertEqual(accepted, expected, f"{case_id}: got {reason}")

    def test_no_network_only_read_calls(self):
        for case_id, responses, _ in CASES:
            _, _, calls = _outcome(responses)
            for command in calls:
                with self.subTest(case=case_id):
                    self.assertEqual(command[:2], ["gh", "api"])
                    self.assertNotIn("-X", command)


if __name__ == "__main__":
    # Prints a case table: python3 python/tests/test_promotion_ledger_protection.py --table
    if "--table" in sys.argv:
        for case_id, responses, expected in CASES:
            accepted, reason, _ = _outcome(responses)
            flag = "ok " if accepted == expected else "BAD"
            print(f"{flag} {case_id:48s} expected={'accept' if expected else 'reject':6s} "
                  f"actual={ {True: "accept", False: "reject", None: "CRASH"}[accepted] } ({reason})")
        raise SystemExit(0)
    unittest.main()
