"""Exercise the GCS precondition boundary without credentials or live storage."""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from daily_digest_delivery_store import GCSDeliveryStore, StoreUnavailable, location


class Missing(Exception):
    pass


class Conflict(Exception):
    pass


class DeliveryStoreTests(unittest.TestCase):
    def setUp(self):
        self.blob = Mock(generation=42)
        self.client = Mock()
        self.client.bucket.return_value.blob.return_value = self.blob
        self.modules = patch.dict(sys.modules, {
            'google.cloud': SimpleNamespace(storage=SimpleNamespace(Client=Mock())),
            'google.api_core.exceptions': SimpleNamespace(NotFound=Missing, PreconditionFailed=Conflict),
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.store = GCSDeliveryStore('gs://synthetic/candidates', 'gs://synthetic/deliveries', client=self.client)

    def test_reservation_is_create_only_and_ack_requires_exact_generation(self):
        record = {'delivery': 'sending'}
        self.assertEqual(self.store.reserve('scope/2026-10-16.json', record), (True, 42))
        self.assertEqual(self.blob.upload_from_string.call_args.kwargs['if_generation_match'], 0)
        self.assertIsNone(self.blob.upload_from_string.call_args.kwargs['retry'])
        self.store.finish('scope/2026-10-16.json', 42, {'delivery': 'accepted'})
        self.assertEqual(self.blob.upload_from_string.call_args.kwargs['if_generation_match'], 42)

    def test_existing_reservation_is_read_and_never_overwritten(self):
        self.blob.upload_from_string.side_effect = Conflict()
        self.blob.download_as_bytes.return_value = json.dumps({'delivery': 'unknown'}).encode()
        self.assertEqual(self.store.reserve('key', {}), (False, {'delivery': 'unknown'}))
        self.assertEqual(self.blob.upload_from_string.call_count, 1)

    def test_timeout_during_claim_or_ack_is_unconfirmed_without_retry(self):
        self.blob.upload_from_string.side_effect = TimeoutError('private-path')
        for operation in (lambda: self.store.reserve('key', {}), lambda: self.store.finish('key', 42, {})):
            with self.assertRaises(StoreUnavailable) as caught:
                operation()
            self.assertNotIn('private-path', str(caught.exception))
        self.assertEqual(self.blob.upload_from_string.call_count, 2)

    def test_missing_is_not_conflated_with_read_failure(self):
        self.blob.download_as_bytes.side_effect = Missing()
        self.assertIsNone(self.store.candidate('key', 5))
        self.blob.download_as_bytes.side_effect = PermissionError('private-account')
        with self.assertRaises(StoreUnavailable):
            self.store.candidate('key', 5)

    def test_platform_root_changes_only_selected_candidate_reads(self):
        store = GCSDeliveryStore('gs://synthetic/candidates', 'gs://synthetic/deliveries',
                                 candidates_by_platform={'firstrade': 'gs://synthetic-isolated/intake'},
                                 client=self.client)
        self.blob.download_as_bytes.return_value = b'{"runs": []}'
        for platform, bucket, prefix in (
                ('firstrade', 'synthetic-isolated', 'intake'), ('ibkr', 'synthetic', 'candidates')):
            key = f'{platform}/2026-10-15/slot.json'
            self.assertEqual(store.candidate(key, 5), {'runs': []})
            self.client.bucket.assert_called_with(bucket)
            self.client.bucket.return_value.blob.assert_called_with(prefix + '/' + key)
            self.assertEqual(self.blob.download_as_bytes.call_args.kwargs['timeout'], 5)
            self.assertIsNone(self.blob.download_as_bytes.call_args.kwargs['retry'])
        store.reserve('scope/2026-10-16.json', {'delivery': 'sending'})
        self.client.bucket.assert_called_with('synthetic')
        self.client.bucket.return_value.blob.assert_called_with('deliveries/scope/2026-10-16.json')
        self.assertEqual(self.blob.upload_from_string.call_args.kwargs['if_generation_match'], 0)

    def test_selected_root_never_falls_back_after_missing_denied_or_timeout(self):
        store = GCSDeliveryStore('gs://synthetic/candidates', 'gs://synthetic/deliveries',
                                 candidates_by_platform={'firstrade': 'gs://synthetic-isolated/intake'},
                                 client=self.client)
        for error in (Missing(), PermissionError('private-path'), TimeoutError('private-path')):
            with self.subTest(error=type(error).__name__):
                self.client.reset_mock()
                self.blob.download_as_bytes.side_effect = error
                if isinstance(error, Missing):
                    self.assertIsNone(store.candidate('firstrade/day/slot.json', 5))
                else:
                    with self.assertRaises(StoreUnavailable) as caught:
                        store.candidate('firstrade/day/slot.json', 5)
                    self.assertNotIn('private-path', str(caught.exception))
                self.client.bucket.assert_called_once_with('synthetic-isolated')
                self.blob.download_as_bytes.assert_called_once()

    def test_unreadable_existing_reservation_does_not_become_absent(self):
        self.blob.upload_from_string.side_effect = Conflict()
        self.blob.download_as_bytes.return_value = b'not-json'
        with self.assertRaises(StoreUnavailable):
            self.store.reserve('key', {})

    def test_store_uri_requires_a_private_nontraversing_prefix(self):
        for uri in ('https://synthetic/private', 'gs://synthetic', 'gs://synthetic/a/../b', 'gs://synthetic/a?override=1'):
            with self.assertRaises(ValueError):
                location(uri)


if __name__ == '__main__':
    unittest.main()
