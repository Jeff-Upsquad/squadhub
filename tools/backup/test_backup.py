import datetime as dt
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import backup


class EncryptionTests(unittest.TestCase):
    def test_roundtrip_and_authentication(self):
        key = os.urandom(32)
        with tempfile.TemporaryDirectory() as temp:
            src = Path(temp) / 'original'
            enc = Path(temp) / 'encrypted'
            src.write_bytes(os.urandom(2500000))
            backup.encrypt_file(src, enc, key)
            out = io.BytesIO()
            with enc.open('rb') as inp:
                backup.decrypt_stream(inp, out, key)
            self.assertEqual(out.getvalue(), src.read_bytes())
            blob = bytearray(enc.read_bytes()); blob[-30] ^= 1
            with self.assertRaises(Exception):
                backup.decrypt_stream(io.BytesIO(blob), io.BytesIO(), key)
            with self.assertRaises(Exception):
                backup.decrypt_stream(io.BytesIO(enc.read_bytes()), io.BytesIO(), os.urandom(32))

    def test_empty_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            src = Path(temp) / 'src'; src.write_bytes(b'')
            enc = Path(temp) / 'enc'; key = os.urandom(32)
            backup.encrypt_file(src, enc, key)
            out = io.BytesIO()
            with enc.open('rb') as inp: backup.decrypt_stream(inp, out, key)
            self.assertEqual(out.getvalue(), b'')

    def test_unrecognized_payload_fails(self):
        with self.assertRaises(ValueError):
            backup.decrypt_stream(io.BytesIO(b'bad format'), io.BytesIO(), os.urandom(32))


class RetentionTests(unittest.TestCase):
    now = dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc)
    def m(self, hours):
        return {'run_id': str(hours), 'created_at': (self.now - dt.timedelta(hours=hours)).isoformat()}

    def test_keep_all_six_hour_copies_for_a_week(self):
        copies = [self.m(h) for h in range(0, 169, 6)]
        self.assertEqual(backup.retention_victims(copies, self.now), [])

    def test_keep_one_daily_copy_in_older_window(self):
        copies = [self.m(8*24+h) for h in [0, 6, 12, 18]]
        deleted = backup.retention_victims(copies, self.now)
        # UTC dates differ at midnight: keep the newest entry on each day.
        self.assertEqual({m['run_id'] for m in deleted}, {str(8*24+12), str(8*24+18)})

    def test_never_delete_only_remaining_backup(self):
        self.assertEqual(backup.retention_victims([self.m(90*24)], self.now), [])

    def test_expire_old_copies_after_a_newer_backup_exists(self):
        copies = [self.m(0), self.m(31*24)]
        self.assertEqual(backup.retention_victims(copies, self.now), [copies[1]])


class AlertTests(unittest.TestCase):
    def fake_job(self, root):
        job = object.__new__(backup.Backup)
        job.root = Path(root)
        job.c = {'ALERT_USER_ID': 'self-user'}
        job.app = {'SUPABASE_SERVICE_ROLE_KEY':'test-only', 'SUPABASE_URL':'https://example.invalid'}
        return job

    def test_failure_alerts_are_self_only_and_deduplicated(self):
        with tempfile.TemporaryDirectory() as root:
            job = self.fake_job(root)
            for _ in range(2): job.queue_alert('Failed', 'Check backup', 'failure-1')
            rows = json.loads((Path(root)/'pending-alerts.json').read_text())
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['user_id'], 'self-user')
            self.assertEqual(rows[0]['reference_id'], 'self-user')
            self.assertEqual(rows[0]['reference_type'], 'announcement')

    def test_retry_repairs_legacy_missing_inbox_reference(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            job = self.fake_job(root)
            job.queue_alert('Failed', 'Check backup', 'failure-1')
            path = Path(root)/'pending-alerts.json'
            rows = json.loads(path.read_text())
            del rows[0]['reference_id']
            rows[0]['reference_type'] = 'database_backup'
            path.write_text(json.dumps(rows))
            with patch('urllib.request.urlopen', return_value=MagicMock()) as send:
                self.assertEqual(job.alerts(), 0)
            notice = json.loads(send.call_args.args[0].data)
            self.assertEqual(notice['reference_id'], 'self-user')
            self.assertEqual(notice['reference_type'], 'announcement')

    def test_database_outage_keeps_alert_for_retry(self):
        with tempfile.TemporaryDirectory() as root:
            job = self.fake_job(root)
            job.queue_alert('Failed', 'Check backup', 'failure-1')
            with patch('urllib.request.urlopen', side_effect=OSError('offline')):
                self.assertEqual(job.alerts(), 1)
            self.assertEqual(len(json.loads((Path(root)/'pending-alerts.json').read_text())), 1)

    def test_database_outage_sends_fallback_push_only_once(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as root:
            job = self.fake_job(root)
            job.queue_alert('Failed', 'Check backup', 'failure-1')
            (Path(root)/'push-subscriptions.json').write_text('[]')
            job.run = Mock(return_value=b'{"delivered":1}')
            with patch('urllib.request.urlopen', side_effect=OSError('offline')):
                job.alerts(); job.alerts()
            job.run.assert_called_once()
            self.assertEqual(len(json.loads((Path(root)/'pending-alerts.json').read_text())), 1)

    def test_successful_delivery_clears_queue(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            job = self.fake_job(root)
            job.queue_alert('Failed', 'Check backup', 'failure-1')
            with patch('urllib.request.urlopen', return_value=MagicMock()):
                self.assertEqual(job.alerts(), 0)
            self.assertEqual(json.loads((Path(root)/'pending-alerts.json').read_text()), [])


if __name__=='__main__':unittest.main()
