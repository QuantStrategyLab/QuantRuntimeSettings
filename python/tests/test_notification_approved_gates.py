"""Per-run approved gate evidence survives intake, merge, render and receipt."""
import copy
import hashlib
import json
import unittest

from notification_candidate_adapter import aggregate
from notification_approved_gates import clean_reasons
from test_notification_consolidation import build, candidate

CONSECUTIVE = dict(reason_code="consecutive_loss_limit_exceeded", observed_value=6, limit=5)
DAILY = dict(reason_code="daily_loss_limit_exceeded", observed_value=80, limit=60, equity_usd=2000)


def gate(reasons, kind="routine_cycle"):
    row = candidate(kind="routine_cycle" if kind == "expected_block_observed" else kind, status="alert", execution_status="execution_unknown",
        reason_code="execution_evidence_missing_or_attention", approved_gate_reasons=copy.deepcopy(reasons),
        block_reason=dict(reason_code="strategy_risk_rejected", observed_value=None, limit=None, order_submitted_this_run=False))
    fact = row["notification_event"]
    fact["approved_gate_reasons"] = copy.deepcopy(reasons)
    if kind == "expected_block_observed":
        # Rebuild projection fields after setting the actual proof.
        from notification_candidate_adapter import _event
        fact["event_kind"] = kind
        fact.pop("dedupe_key", None)
        fact["expected_block_evidence"] = "approved-gate:" + hashlib.sha256(json.dumps(reasons, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        fact.update(_event(fact).to_candidate())
    return row


class ApprovedGateTests(unittest.TestCase):
    def test_every_approved_reason_and_value_reaches_both_locales_and_receipt(self):
        for reasons in ([DAILY], [CONSECUTIVE], [CONSECUTIVE, DAILY]):
            for locale in ("zh", "en"):
                with self.subTest(reasons=reasons, locale=locale):
                    row = gate(reasons)
                    payload, text, collected, receipt = build([row, copy.deepcopy(row)], locale=locale)
                    self.assertEqual(collected.notification_summary["immediate_events"], 0)
                    self.assertEqual(receipt["runs"][0]["approved_gate_reasons"], tuple(reasons))
                    self.assertEqual(receipt["runs"][0]["source_run_id"], row["source_run_id"])
                    for reason in reasons:
                        if reason == DAILY:
                            self.assertIn("日亏损上限" if locale == "zh" else "Daily-loss gate", text)
                            self.assertIn("80≥60" if locale == "zh" else "80>=60", text)
                            self.assertIn("E=2000", text)
                        else:
                            self.assertIn("6>5", text)
                    self.assertIn("本轮未下单" if locale == "zh" else "No order this run", text)

    def test_same_run_reason_union_preserves_all_reasons_in_both_input_orders(self):
        for rows in ([gate([DAILY]), gate([CONSECUTIVE])], [gate([CONSECUTIVE]), gate([DAILY])]):
            _, text, collected, receipt = build(rows)
            self.assertEqual(collected.notification_summary["immediate_events"], 0)
            self.assertEqual(len(receipt["runs"]), 1)
            self.assertEqual({r["reason_code"] for r in receipt["runs"][0]["approved_gate_reasons"]}, {DAILY["reason_code"], CONSECUTIVE["reason_code"]})
            self.assertIn("80≥60", text)
            self.assertIn("6>5", text)

    def test_expected_observation_requires_complete_archive_reasons_and_exact_proof(self):
        for change in (None, "no_reasons", "bad_proof", "boolean"):
            row = gate([DAILY], "expected_block_observed")
            if change == "no_reasons": row.pop("approved_gate_reasons")
            if change == "bad_proof": row["notification_event"]["expected_block_evidence"] = "approved-gate:arbitrary"
            if change == "boolean": row["approved_gate_reasons"] = True
            if change == "bad_proof":
                from notification_candidate_adapter import _event
                row["notification_event"].pop("dedupe_key", None)
                row["notification_event"].update(_event(row["notification_event"]).to_candidate())
            _, _, collected, _ = build([row, copy.deepcopy(row)])
            self.assertEqual(collected.notification_summary["immediate_events"], int(change is not None))

    def test_urgent_orders_fills_receipt_errors_unknown_blocks_are_never_quiet(self):
        for kind in ("blocked_run", "real_error", "order_submitted", "fill", "order_status_unknown", "missing_receipt"):
            row = gate([DAILY], kind)
            _, _, collected, receipt = build([row, copy.deepcopy(row)])
            self.assertEqual(collected.notification_summary["immediate_events"], 1, kind)
            self.assertEqual(receipt["runs"][0]["approved_gate_reasons"], ())
        for mutation in (lambda r: r.update(order_count=1), lambda r: r.update(fill_count=1),
                         lambda r: r["block_reason"].update(reason_code="unknown_gate")):
            row = gate([DAILY]); mutation(row)
            _, _, collected, _ = build([row])
            self.assertGreater(collected.notification_summary["immediate_events"], 0)

    def test_reason_conflicts_never_silence_and_other_runs_do_not_share_approval(self):
        for rows in ([gate([DAILY]), gate([{**DAILY, "observed_value": 90}])],
                     [gate([DAILY]), gate([{**DAILY, "limit": 1}])]):
            _, _, collected, _ = build(rows)
            self.assertGreater(collected.notification_summary["immediate_events"], 0)
        row = gate([DAILY]); other = candidate(run="other", status="alert")
        _, _, collected, _ = build([row, other])
        self.assertEqual(collected.notification_summary["immediate_events"], 1)

    def test_only_exact_approved_rules_are_accepted(self):
        for reasons in ([{**CONSECUTIVE, "limit": 4}], [{**CONSECUTIVE, "observed_value": True}],
                        [{**DAILY, "limit": 59}], [{**DAILY, "observed_value": float("nan")}],
                        [DAILY, DAILY], [{"reason_code": "free_text", "observed_value": 99, "limit": 1}]):
            self.assertEqual(clean_reasons(reasons), [])
