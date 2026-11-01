import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from notification_transport import send_intent


class ReportSerializationTests(unittest.TestCase):
    def test_report_serialization_has_no_secrets(self):
        token = str(123456789) + ':' + 'A' * 35
        chat_id = '-123'
        for acknowledged in (True, False):
            response = io.BytesIO(json.dumps({'ok': acknowledged, 'result': {
                'message_id': 1, 'chat': {'id': -123},
            }}).encode())
            response.status = 200
            with patch.dict(os.environ, {'TELEGRAM_TOKEN': token}, clear=True):
                receipt = send_intent('Synthetic digest', token=token, chat_id=chat_id,
                                      opener=lambda *_args, response=response, **_kwargs: response)
            serialized = json.dumps({'notification_receipt': receipt})
            self.assertEqual(receipt['ok'], acknowledged)
            self.assertNotRegex(serialized, r'\d{6,12}:A[\w-]{34}')
            self.assertNotIn(token, serialized)
            self.assertNotIn(chat_id, serialized)
            for key, value in receipt.items():
                if key.lower() in {'token', 'secret', 'password', 'api_key'}:
                    self.assertFalse(value)

    def test_provider_exception_does_not_enter_report(self):
        token = str(123456789) + ':' + 'A' * 35
        with patch.dict(os.environ, {'TELEGRAM_TOKEN': token}, clear=True), patch(
            'urllib.request.urlopen', side_effect=RuntimeError(token),
        ):
            receipt = send_intent('Synthetic digest', token=token, chat_id='-123')
        self.assertFalse(receipt['ok'])
        self.assertNotIn(token, json.dumps(receipt))
