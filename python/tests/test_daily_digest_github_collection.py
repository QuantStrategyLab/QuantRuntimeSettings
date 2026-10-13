from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse
from urllib.error import URLError

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import daily_digest_aggregator as aggregator


class GithubCollectionTests(unittest.TestCase):
    allowlist = [{
        "platform_id": "schwab",
        "repository": "example/platform",
        "workflow": "daily.yml",
        "strategy_profile": "example_strategy",
    }]

    def collect(self):
        return aggregator.collect_from_github_workflows(
            business_day="2026-10-12",
            config={},
            token="synthetic-test-token",
            allowlist=self.allowlist,
        )

    def success(self):
        return {"conclusion": "success", "updated_at": "2026-10-12T18:00:00Z"}

    def test_dispatch_and_schedule_are_separate_valid_event_queries(self):
        for matching_event in ["workflow_dispatch", "schedule"]:
            requested = []
            def response(url, token):
                event = parse_qs(urlparse(url).query).get("event", [""])[0]
                requested.append(event)
                rows = [self.success()] if event == matching_event else []
                return {"total_count": len(rows), "workflow_runs": rows}
            with self.subTest(event=matching_event), mock.patch.object(
                aggregator, "_gh_api_get", side_effect=response,
            ):
                result = self.collect()
                self.assertEqual(len(result.rows), 1)
                self.assertIn(matching_event, requested)
                self.assertTrue(set(requested) <= {"workflow_dispatch", "schedule"})
                self.assertIsNone(result.rows[0]["fill_count"])
                self.assertEqual(result.failures, [])

    def test_matching_dispatch_on_second_page_is_not_missed(self):
        requested_pages = []
        def response(url, token):
            query = parse_qs(urlparse(url).query)
            event = query.get("event", [""])[0]
            page = int(query.get("page", ["1"])[0])
            if event != "workflow_dispatch":
                return {"total_count": 0, "workflow_runs": []}
            requested_pages.append(page)
            size = int(query["per_page"][0])
            rows = [{"conclusion": "failure"}] * size if page == 1 else [self.success()]
            return {"total_count": size + 1, "workflow_runs": rows}
        with mock.patch.object(aggregator, "_gh_api_get", side_effect=response):
            result = self.collect()
        self.assertEqual(len(result.rows), 1)
        self.assertEqual(requested_pages, [1, 2])
        self.assertEqual(result.sources_queried, 1)

    def test_later_page_failure_keeps_coverage_degraded(self):
        def response(url, token):
            query = parse_qs(urlparse(url).query)
            page = int(query.get("page", ["1"])[0])
            size = int(query["per_page"][0])
            if page > 1:
                raise RuntimeError("synthetic later-page failure")
            return {"total_count": size + 1, "workflow_runs": [{"conclusion": "failure"}] * size}
        with mock.patch.object(aggregator, "_gh_api_get", side_effect=response):
            result = self.collect()
        self.assertEqual(result.rows, [])
        self.assertEqual(len(result.failures), 1)
        self.assertEqual(result.failures[0]["reason_code"], "github_api_error")

    def test_all_queries_exhausted_without_success_are_verified_unmatched(self):
        with mock.patch.object(aggregator, "_gh_api_get", return_value={"total_count": 0, "workflow_runs": []}) as get:
            result = self.collect()
        events = {parse_qs(urlparse(call.args[0]).query)["event"][0] for call in get.call_args_list}
        self.assertEqual(events, {"schedule", "workflow_dispatch"})
        self.assertEqual(result.rows, [])
        self.assertEqual(result.failures, [])

    def test_short_page_with_more_declared_results_is_not_verified_idle(self):
        with mock.patch.object(aggregator, "_gh_api_get", return_value={
            "total_count": 101,
            "workflow_runs": [{"conclusion": "failure"}],
        }):
            result = self.collect()
        self.assertEqual(result.rows, [])
        self.assertEqual(len(result.failures), 1)
        self.assertEqual(result.failures[0]["reason_code"], "github_pagination_incomplete")

    def test_later_page_transport_failure_keeps_coverage_degraded(self):
        for error in [URLError("synthetic transport failure"), TimeoutError("synthetic timeout")]:
            def response(url, token):
                query = parse_qs(urlparse(url).query)
                page = int(query.get("page", ["1"])[0])
                size = int(query["per_page"][0])
                if page > 1:
                    raise error
                return {"total_count": size + 1, "workflow_runs": [{"conclusion": "failure"}] * size}
            with self.subTest(error=type(error).__name__), mock.patch.object(
                aggregator, "_gh_api_get", side_effect=response,
            ):
                result = self.collect()
                self.assertEqual(result.rows, [])
                self.assertEqual(len(result.failures), 1)
                self.assertEqual(result.failures[0]["reason_code"], "github_api_error")

    def test_invalid_total_count_cannot_establish_completed_coverage(self):
        for count in [-1, False, True, "0", None]:
            with self.subTest(count=count), mock.patch.object(
                aggregator, "_gh_api_get", return_value={
                    "total_count": count,
                    "workflow_runs": [],
                },
            ):
                result = self.collect()
                self.assertEqual(result.rows, [])
                self.assertEqual(len(result.failures), 1)
                self.assertEqual(result.failures[0]["reason_code"], "github_payload_invalid")


if __name__ == "__main__":
    unittest.main()
