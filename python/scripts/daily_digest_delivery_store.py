"""Private GCS candidates and generation-checked daily delivery reservations."""
from __future__ import annotations

import json
from urllib.parse import urlsplit


class StoreUnavailable(Exception):
    """A bounded storage operation was not confirmed; contains no private detail."""


def location(uri):
    parsed = urlsplit(uri)
    prefix = parsed.path.strip('/')
    if parsed.scheme != 'gs' or not parsed.netloc or not prefix or parsed.query or parsed.fragment:
        raise ValueError('digest_store_configuration_invalid')
    if any(part in {'', '.', '..'} for part in prefix.split('/')):
        raise ValueError('digest_store_configuration_invalid')
    return parsed.netloc, prefix


class GCSDeliveryStore:
    def __init__(self, candidates_uri, deliveries_uri, *, client=None):
        from google.cloud import storage
        self.client = client or storage.Client()
        self.candidates_bucket, self.candidates_prefix = location(candidates_uri)
        self.deliveries_bucket, self.deliveries_prefix = location(deliveries_uri)

    def _blob(self, bucket, prefix, key):
        return self.client.bucket(bucket).blob(prefix + '/' + key)

    def candidate(self, key, timeout):
        from google.api_core.exceptions import NotFound
        blob = self._blob(self.candidates_bucket, self.candidates_prefix, key)
        try:
            body = blob.download_as_bytes(retry=None, timeout=timeout, if_generation_match=None)
            if len(body) > 2_000_000:
                raise StoreUnavailable()
            return json.loads(body)
        except NotFound:
            return None
        except Exception:  # noqa: BLE001 -- Normalize SDK/auth errors without exposing private paths or credentials.
            raise StoreUnavailable() from None

    def reserve(self, key, record):
        from google.api_core.exceptions import PreconditionFailed
        blob = self._blob(self.deliveries_bucket, self.deliveries_prefix, key)
        try:
            blob.upload_from_string(json.dumps(record, allow_nan=False), content_type='application/json',
                                    if_generation_match=0, retry=None, timeout=10)
            if blob.generation is None:
                raise StoreUnavailable()
            return True, int(blob.generation)
        except PreconditionFailed:
            try:
                existing = json.loads(blob.download_as_bytes(retry=None, timeout=10))
                return False, existing
            except Exception:  # noqa: BLE001 -- An unreadable reservation is never proof that delivery is safe.
                raise StoreUnavailable() from None
        except Exception:  # noqa: BLE001 -- A timed-out conditional write may already have succeeded.
            raise StoreUnavailable() from None

    def delivery(self, key):
        from google.api_core.exceptions import NotFound
        blob = self._blob(self.deliveries_bucket, self.deliveries_prefix, key)
        try:
            return json.loads(blob.download_as_bytes(retry=None, timeout=10))
        except NotFound:
            return None
        except Exception:  # noqa: BLE001 -- A failed receipt check must never be reported as absence or success.
            raise StoreUnavailable() from None

    def finish(self, key, generation, record):
        blob = self._blob(self.deliveries_bucket, self.deliveries_prefix, key)
        try:
            blob.upload_from_string(json.dumps(record, allow_nan=False), content_type='application/json',
                                    if_generation_match=generation, retry=None, timeout=10)
        except Exception:  # noqa: BLE001 -- Never overwrite an uncertain ACK or retry the Telegram request.
            # The reservation remains durable, even if an ACK write is uncertain.
            raise StoreUnavailable() from None
