import contextlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import backup

class CaptureTests(unittest.TestCase):
    def job(self, mode):
        job=backup.Backup.__new__(backup.Backup)
        job.c={'BACKUP_TRANSPORT':mode};job.opened=[];job.closed=[];job.commands=[]
        @contextlib.contextmanager
        def snapshot(env):
            marker='snapshot-'+str(len(job.opened)+1);job.opened.append(marker)
            try:
                yield marker,lambda sql:json.dumps({'vault_secrets':0,'roles':[],'snapshot_marker':marker})
            finally:job.closed.append(marker)
        job.snapshot=snapshot
        job.inventory=lambda query:[]
        job.docker_client=lambda env,command,*args,**kwargs:[command,*args]
        job.run=lambda command:job.commands.append(command)
        return job
    def test_compact_failure_uses_a_new_snapshot_and_matching_inventory(self):
        with tempfile.TemporaryDirectory() as folder:
            job=self.job('compact')
            with patch('compact_transport.compact_dump',side_effect=RuntimeError('transport unavailable')):
                result=job.capture_database(Path(folder))
            self.assertEqual(job.opened,['snapshot-1','snapshot-2'])
            self.assertEqual(job.closed,job.opened)
            self.assertEqual(result['snapshot_marker'],'snapshot-2')
            self.assertEqual(json.loads((Path(folder)/'inventory.json').read_text())['snapshot_marker'],'snapshot-2')
            self.assertEqual(job.commands[0][job.commands[0].index('--snapshot')+1],'snapshot-2')
    def test_native_default_needs_no_compression_process(self):
        with tempfile.TemporaryDirectory() as folder:
            job=self.job('native');job.c={}
            with patch('compact_transport.compact_dump',side_effect=AssertionError('must not run')):
                result=job.capture_database(Path(folder))
            self.assertEqual(result['transport'],{'mode':'native'})
            self.assertEqual(job.opened,['snapshot-1'])
    def test_unknown_mode_fails_before_opening_a_database_connection(self):
        job=self.job('typo')
        with self.assertRaises(ValueError):job.capture_database(Path('/unused'))
        self.assertEqual(job.opened,[])
    def test_native_fallback_failure_is_not_reported_as_a_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            job=self.job('compact')
            def fail(command):raise RuntimeError('native failed')
            job.run=fail
            with patch('compact_transport.compact_dump',side_effect=RuntimeError('compact failed')):
                with self.assertRaisesRegex(RuntimeError,'native failed'):job.capture_database(Path(folder))
            self.assertFalse((Path(folder)/'inventory.json').exists())
if __name__=='__main__':unittest.main()
