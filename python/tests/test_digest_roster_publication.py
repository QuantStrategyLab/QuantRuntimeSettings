"""Slice 4 PUB interleaving fixture and B3-10 tests (RESCOPE §5 rules 1-6 verbatim)."""
from __future__ import annotations

import json
import sys
import unittest
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import digest_roster_authority as authority  # noqa: E402
import digest_roster_publication as publication  # noqa: E402
import digest_roster_validator as validator  # noqa: E402
from test_digest_roster_completeness_and_freshness import (  # noqa: E402
    CORPUS,
    OBSERVED,
    _at,
    _Auth,
    _boot,
    _Clock,
    _Enrollment,
    _Transport,
    _window,
)
from test_digest_roster_identity_and_ownership import _prepare_bundle  # noqa: E402


class _ErrorTransport:
    def __init__(self, status=403, error=None):
        self.status = status
        self.error = error

    def get(self, url, headers, timeout):
        if self.error is not None:
            raise self.error
        return authority.TransportResponse(self.status, {}, b'', url)


class PubInterleavingMatrixTests(unittest.TestCase):
    """RESCOPE §5 rule 6: two independent clients against one synthetic CAS store."""

    def setUp(self):
        self.bundle = _prepare_bundle()
        self.enrollment = _Enrollment(self.bundle.artifact_bytes)
        self.selection_dict = authority.read_selection(
            self.enrollment.read_selection(), 'synthetic-enrollment',
        ).as_dict()

    def _publisher(self, store, responses, clock, *, boot=None, recipient_scope='syn-scope', enrollment=None):
        b = boot or _boot()
        transport = responses if hasattr(responses, 'get') else _Transport(*responses)
        client = authority.AcquisitionClient(b, _Auth(), transport)
        return publication.ConditionalRosterPublisher(
            b, client, enrollment or self.enrollment, store, clock, recipient_scope,
        )

    def _publish(self, pub, clock, *, slot='07:00', report_date='2026-11-20', preview=False,
                 generation_id=None, collect=None):
        return pub.publish_generation(
            report_date=report_date,
            original_slot=slot,
            generation_window=_window(),
            deadline=clock() + timedelta(minutes=10),
            preview=preview,
            collect=collect,
            generation_id=generation_id,
        )

    def test_conflicting_commit_orders_both_directions(self):
        all_on = CORPUS['scenarios']['all_on']
        one_off = CORPUS['scenarios']['one_off']

        for winner_name, first_doc, second_doc, winner_managed in (
            ('client1_wins', all_on, one_off, 9),
            ('client2_wins', one_off, all_on, 8),
        ):
            with self.subTest(order=winner_name):
                store = publication.InMemoryConditionalRosterStore()
                clk1, clk2 = _Clock(OBSERVED), _Clock(OBSERVED + timedelta(seconds=1))
                c1 = self._publisher(store, [first_doc, first_doc], clk1)
                c2 = self._publisher(store, [second_doc, second_doc], clk2)

                res_win = self._publish(c1, clk1, generation_id='gen-winner')
                self.assertEqual((res_win.status, res_win.committed, res_win.replayed), ('available', True, False))
                self.assertEqual(res_win.generation_id, 'gen-winner')
                self.assertEqual(res_win.envelope['counts']['managed'], winner_managed)

                res_lose = self._publish(c2, clk2, generation_id='gen-loser')
                self.assertEqual((res_lose.status, res_lose.committed, res_lose.failure_code),
                                 ('fallback', False, 'publication_content_conflict'))
                self.assertEqual(res_lose.failure_kind, validator.CONFLICT)
                self.assertIsNone(res_lose.generation_id)
                self.assertEqual(len(res_lose.envelope['accounts']), 10)
                self.assertTrue(all(a['management_status'] == 'unknown' for a in res_lose.envelope['accounts']))

                # Winning bytes and generation_id stay intact on the store; consumer gets winner.
                self.assertEqual(store.read_run(res_win.run_key), res_win.envelope_bytes)
                consumed = publication.consume_run_roster(
                    store, boot=_boot(), recipient_scope='syn-scope',
                    report_date='2026-11-20', original_slot='07:00',
                    expected_selection=self.selection_dict, clock=clk2(),
                )
                self.assertEqual(consumed['generation_id'], 'gen-winner')
                self.assertEqual(consumed['counts']['managed'], winner_managed)

    def test_identical_replay_including_lost_create_acknowledgement(self):
        store = publication.InMemoryConditionalRosterStore()
        store.lose_next_create_ack = True
        all_on = CORPUS['scenarios']['all_on']
        clk1 = _Clock(OBSERVED + timedelta(seconds=5))
        c1 = self._publisher(store, [all_on, all_on], clk1)

        # Client 1 succeeds on store CAS, then loses the create acknowledgement -> enters cold unavailable.
        lost = self._publish(c1, clk1, generation_id='gen-orig-001')
        self.assertEqual((lost.status, lost.committed, lost.failure_code),
                         ('unavailable', False, 'publication_ack_lost'))
        self.assertIsNotNone(store.read_run(lost.run_key))
        # Display metadata wasn't updated yet during lost ack.
        self.assertIsNone(store.read_display_metadata(lost.display_scope))

        # Client 2 (retry/replay at later read clock with identical authority) replays and returns
        # the exact original stored bytes and original generation_id!
        clk2 = _Clock(OBSERVED + timedelta(seconds=20))
        c2 = self._publisher(store, [all_on, all_on], clk2)
        replayed = self._publish(c2, clk2, generation_id='gen-retry-999')
        self.assertEqual((replayed.status, replayed.committed, replayed.replayed), ('available', True, True))
        self.assertEqual(replayed.generation_id, 'gen-orig-001')
        self.assertEqual(replayed.envelope_bytes, store.read_run(lost.run_key))
        self.assertEqual(replayed.envelope['generated_at'], validator.format_utc(clk1()))
        self.assertIsNotNone(store.read_display_metadata(lost.display_scope))

    def test_renewed_timestamps_with_unchanged_authority_keep_original_bytes_and_times(self):
        store = publication.InMemoryConditionalRosterStore()
        t1 = OBSERVED
        t2 = OBSERVED + timedelta(seconds=90)
        doc1 = _at(CORPUS['scenarios']['all_on'], t1)
        doc2 = _at(CORPUS['scenarios']['all_on'], t2)

        clk1, clk2 = _Clock(t1 + timedelta(seconds=2)), _Clock(t2 + timedelta(seconds=3))
        c1 = self._publisher(store, [doc1, doc1], clk1)
        c2 = self._publisher(store, [doc2, doc2], clk2)

        first = self._publish(c1, clk1, generation_id='gen-first-t1')
        replay = self._publish(c2, clk2, generation_id='gen-second-t2')

        self.assertEqual((first.replayed, replay.replayed), (False, True))
        self.assertEqual(replay.generation_id, 'gen-first-t1')
        self.assertEqual(replay.envelope_bytes, first.envelope_bytes)
        self.assertEqual(replay.envelope['source_snapshot_at'], validator.format_utc(t1))
        self.assertEqual(replay.envelope['generated_at'], validator.format_utc(t1 + timedelta(seconds=2)))
        # Display metadata keeps original confirming source time t1 (not refreshed to t2).
        self.assertEqual(store.read_display_metadata(first.display_scope).observed_at, validator.format_utc(t1))

    def test_same_revision_changed_content_and_different_revision_refuse_keeping_baseline(self):
        store = publication.InMemoryConditionalRosterStore()
        all_on = CORPUS['scenarios']['all_on']
        one_off = CORPUS['scenarios']['one_off']

        clk = _Clock(OBSERVED + timedelta(seconds=5))
        c1 = self._publisher(store, [all_on, all_on], clk)
        winner = self._publish(c1, clk, generation_id='gen-win')
        self.assertEqual(winner.status, 'available')

        # Same revision, changed content (e.g. one eligible group managed -> disabled at same applied revision).
        changed = deepcopy(all_on)
        idx_off = next(i for i, g in enumerate(changed['groups']) if g['management_status'] == 'managed')
        target_grp = changed['groups'][idx_off]
        target_grp['applied'] = {
            **target_grp['applied'],
            'management_enabled': False,
        }
        target_grp['management_status'] = 'management_disabled'
        target_grp['processing_eligible'] = False
        target_grp['processing_denial'] = 'management_disabled'
        changed['counts']['managed'] -= 1
        changed['counts']['management_disabled'] += 1
        target_pairs = {(d['platform'], d['key']) for d in target_grp['deployments']}
        changed['effective_export']['records'] = [
            {**r, 'management_enabled': False}
            if (r['platform'], r['legacy_key']) in target_pairs
            else r
            for r in changed['effective_export']['records']
        ]

        c2 = self._publisher(store, [changed, changed], clk)
        res_same_rev = self._publish(c2, clk, generation_id='gen-diff-content')
        self.assertEqual((res_same_rev.status, res_same_rev.failure_code, res_same_rev.failure_kind),
                         ('fallback', 'publication_content_conflict', validator.CONFLICT))
        self.assertEqual(store.read_run(winner.run_key), winner.envelope_bytes)

        # Different revision even if membership and statuses agree -> refused!
        rb_rev2 = deepcopy(all_on)
        rb_rev2['instance_revision'] += 1
        rb_rev2['effective_export']['instance_revision'] += 1
        proj_rev2 = deepcopy(CORPUS['preparations']['complete']['projection'])
        for acc in proj_rev2['accounts']:
            acc['configuration_revision']['instances'] += 1
        from test_digest_roster_identity_and_ownership import (  # noqa: E402
            _instances,
            _legacy_roster,
            _observation_bindings,
        )
        bundle_rev2 = authority.prepare_enrollment_bundle(
            readback=rb_rev2,
            effective_records=rb_rev2['effective_export']['records'],
            projection=proj_rev2,
            instances=_instances(),
            enrollment_links=json.loads((ROOT / 'tests/fixtures/account-mapping-roster.synthetic.json').read_text(encoding='utf-8'))['enrollment_links'],
            legacy_roster=_legacy_roster(),
            observation_bindings=_observation_bindings(rb_rev2),
            source='synthetic-enrollment',
            versions={'version': 'v2', 'membership_version': 'm1', 'label_version': 'l1', 'link_version': 'k1'},
            prepared_at=CORPUS['observed_at'],
        )
        enr_rev2 = _Enrollment(bundle_rev2.artifact_bytes, versions={
            'version': 'v2', 'membership_version': 'm1', 'label_version': 'l1', 'link_version': 'k1',
        })
        c3 = self._publisher(store, [rb_rev2, rb_rev2], clk, enrollment=enr_rev2)
        res_diff_rev = self._publish(c3, clk, generation_id='gen-diff-rev')
        self.assertEqual((res_diff_rev.status, res_diff_rev.failure_code, res_diff_rev.failure_kind),
                         ('fallback', 'publication_revision_conflict', validator.CONFLICT))
        self.assertEqual(store.read_run(winner.run_key), winner.envelope_bytes)
        self.assertEqual(len(res_diff_rev.envelope['accounts']), 10)
        self.assertEqual(res_diff_rev.envelope['source_snapshot_at'], winner.envelope['source_snapshot_at'])

    def test_stale_replay_refuses_and_returns_dated_warm_fallback(self):
        store = publication.InMemoryConditionalRosterStore()
        all_on = _at(CORPUS['scenarios']['all_on'], OBSERVED)
        clk1 = _Clock(OBSERVED + timedelta(seconds=10))
        c1 = self._publisher(store, [all_on, all_on], clk1)
        winner = self._publish(c1, clk1, generation_id='gen-fresh')
        self.assertEqual(winner.status, 'available')

        # Replay at OBSERVED + 301s: candidate read is fresh, existing committed record is now stale!
        t_late = OBSERVED + timedelta(seconds=301)
        fresh_read = _at(CORPUS['scenarios']['all_on'], t_late)
        clk2 = _Clock(t_late)
        c2 = self._publisher(store, [fresh_read, fresh_read], clk2)
        stale_replay = self._publish(c2, clk2, generation_id='gen-replay-late')
        self.assertEqual((stale_replay.status, stale_replay.failure_code, stale_replay.failure_kind),
                         ('fallback', 'observation_stale', validator.STALE))
        self.assertEqual(stale_replay.envelope['source_snapshot_at'], validator.format_utc(OBSERVED))
        self.assertEqual(stale_replay.envelope['observation_age_seconds'], 301.0)
        self.assertEqual(len(stale_replay.envelope['accounts']), 10)
        self.assertTrue(all(a['management_status'] == 'unknown' for a in stale_replay.envelope['accounts']))
        # Committed bytes unchanged on store; consumer also rejects stale record.
        self.assertEqual(store.read_run(winner.run_key), winner.envelope_bytes)
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            publication.consume_run_roster(
                store, boot=_boot(), recipient_scope='syn-scope',
                report_date='2026-11-20', original_slot='07:00',
                expected_selection=self.selection_dict, clock=t_late,
            )

    def test_distinct_slots_and_cross_context_isolation(self):
        store = publication.InMemoryConditionalRosterStore()
        all_on = CORPUS['scenarios']['all_on']
        one_off = CORPUS['scenarios']['one_off']
        clk = _Clock(OBSERVED + timedelta(seconds=5))

        pub_main = self._publisher(store, [all_on, all_on, one_off, one_off], clk)
        s0700 = self._publish(pub_main, clk, slot='07:00', generation_id='gen-0700')
        s0730 = self._publish(pub_main, clk, slot='07:30', generation_id='gen-0730')
        self.assertEqual((s0700.status, s0730.status), ('available', 'available'))
        self.assertNotEqual(s0700.run_key, s0730.run_key)
        self.assertEqual((s0700.envelope['counts']['managed'], s0730.envelope['counts']['managed']), (9, 8))

        # Cross-context isolation: preview, foreign recipient_scope, and foreign config_context
        # cannot use prod namespace or warm prod display baseline.
        pub_preview_fail = self._publisher(store, _ErrorTransport(403), clk)
        res_preview = self._publish(pub_preview_fail, clk, slot='07:00', preview=True)
        self.assertEqual(res_preview.status, 'unavailable')
        self.assertNotEqual(res_preview.run_key, s0700.run_key)
        self.assertNotEqual(res_preview.display_scope, s0700.display_scope)

        pub_other_recipient = self._publisher(store, _ErrorTransport(403), clk, recipient_scope='other-scope')
        res_other = self._publish(pub_other_recipient, clk, slot='07:00')
        self.assertEqual(res_other.status, 'unavailable')

        other_boot = authority.RosterBootConfig(
            validator.MAPPING_MODE, 'https://console.example.invalid',
            validator.ServiceAuthPolicy('syn-iss', 'syn-aud', frozenset({'syn-sub'})),
            'synthetic-enrollment', 'other_context',
        )
        pub_other_ctx = self._publisher(store, _ErrorTransport(403), clk, boot=other_boot)
        res_ctx = self._publish(pub_other_ctx, clk, slot='07:00')
        self.assertEqual(res_ctx.status, 'unavailable')

    def test_row_10_reverse_completion_and_failure_paths_preserve_newer_baseline(self):
        store = publication.InMemoryConditionalRosterStore()
        t_older = OBSERVED
        t_newer = OBSERVED + timedelta(seconds=60)
        doc_older = _at(CORPUS['scenarios']['all_on'], t_older)
        doc_newer = _at(CORPUS['scenarios']['one_off'], t_newer)

        # Distinct run keys (07:30 completes first with t_newer, 07:00 completes second with t_older).
        clk_newer = _Clock(t_newer + timedelta(seconds=2))
        clk_older = _Clock(t_newer + timedelta(seconds=4))
        p_0730 = self._publisher(store, [doc_newer, doc_newer], clk_newer)
        p_0700 = self._publisher(store, [doc_older, doc_older], clk_older)

        res_0730 = self._publish(p_0730, clk_newer, slot='07:30', generation_id='gen-0730-newer')
        res_0700 = self._publish(p_0700, clk_older, slot='07:00', generation_id='gen-0700-older')
        self.assertEqual((res_0730.status, res_0700.status), ('available', 'available'))
        self.assertEqual(
            store.read_display_metadata(res_0730.display_scope).observed_at,
            validator.format_utc(t_newer),
            'older confirming time on 07:00 must not regress display baseline',
        )

        # Subsequent denied read + timeout + incomplete grouping + wrong selection + truncated counts:
        # every failure retains t_newer's original 10 headers, timestamp, and computed age!
        clk_fail = _Clock(t_newer + timedelta(seconds=45))
        trunc = deepcopy(CORPUS['scenarios']['all_on'])
        trunc['groups'].pop()

        wrong_ver_enr = _Enrollment(self.bundle.artifact_bytes)
        wrong_ver_enr.selection_doc['artifact_sha256'] = '0' * 64

        failure_setups = [
            ('denied_403', _ErrorTransport(403), self.enrollment),
            ('timeout', _ErrorTransport(error=authority.AuthorityError('management_read_timeout')), self.enrollment),
            ('uninitialized', [CORPUS['scenarios']['uninitialized']], self.enrollment),
            ('policy_missing', [CORPUS['scenarios']['policy_missing']], self.enrollment),
            ('truncated_repeated_counts', [trunc, trunc], self.enrollment),
            ('wrong_source_version', [doc_newer, doc_newer], wrong_ver_enr),
        ]
        for label, transport, enr in failure_setups:
            with self.subTest(failure=label):
                pub_fail = self._publisher(store, transport, clk_fail, enrollment=enr)
                fb = self._publish(pub_fail, clk_fail, report_date='2026-11-21', slot='07:00')
                self.assertEqual(fb.status, 'fallback')
                self.assertEqual(fb.envelope['source_snapshot_at'], validator.format_utc(t_newer))
                self.assertEqual(fb.envelope['observation_age_seconds'], 45.0)
                self.assertEqual(fb.envelope['account_count'], 10)
                self.assertTrue(all(a['management_status'] == 'unknown' for a in fb.envelope['accounts']))
                self.assertTrue(all(
                    a['legacy_run_bindings'] == [] and a['observation_bindings'] == []
                    for a in fb.envelope['accounts']
                ))

        # Later coherent generation on a new valid run key restores current status.
        t_restored = t_newer + timedelta(seconds=50)
        doc_restored = _at(CORPUS['scenarios']['all_on'], t_restored)
        clk_ok = _Clock(t_restored + timedelta(seconds=1))
        pub_ok = self._publisher(store, [doc_restored, doc_restored], clk_ok)
        restored = self._publish(pub_ok, clk_ok, report_date='2026-11-21', slot='07:00', generation_id='gen-restored')
        self.assertEqual((restored.status, restored.envelope['counts']['managed']), ('available', 9))
        self.assertEqual(
            store.read_display_metadata(restored.display_scope).observed_at,
            validator.format_utc(t_restored),
        )


if __name__ == '__main__':
    unittest.main()
