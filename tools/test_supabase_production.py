import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('production', Path(__file__).with_name('supabase-production.py'))
production = importlib.util.module_from_spec(spec)
spec.loader.exec_module(production)


class SelectedMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        folder = self.repo / 'supabase/migrations'
        folder.mkdir(parents=True)
        (folder / '20261102122525_test.sql').write_text('ALTER TABLE public.example ADD COLUMN test text;')
        (folder / '20261102122526_unrelated.sql').write_text('DROP TABLE public.example;')
        self.url = 'postgresql://postgres:private-password@db.example:5432/postgres?sslmode=verify-full&sslrootcert=%2Ftmp%2Fca.crt'

    @patch.object(production.subprocess, 'run')
    def test_dry_run_reads_ledger_without_executing_migration(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, stdout='', stderr='')
        production.selected_migration(self.repo, self.url, '20261102122525', False)
        args, options = run.call_args
        self.assertTrue(options['input'].startswith('SELECT version, name'))
        self.assertNotIn('ALTER TABLE', options['input'])
        self.assertNotIn('private-password', str(args))
        self.assertEqual(options['env']['PGSSLMODE'], 'verify-full')

    @patch.object(production.subprocess, 'run')
    def test_apply_records_only_selected_sql_in_same_transaction(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, stdout='', stderr='')
        production.selected_migration(self.repo, self.url, '20261102122525', True)
        query = run.call_args.kwargs['input']
        self.assertTrue(query.startswith('BEGIN;'))
        self.assertTrue(query.endswith('COMMIT;\n'))
        self.assertIn('ALTER TABLE public.example', query)
        self.assertIn('INSERT INTO supabase_migrations.schema_migrations', query)
        self.assertNotIn('DROP TABLE', query)
        self.assertIn('already recorded', query)

    @patch.object(production.subprocess, 'run')
    def test_invalid_selection_never_connects(self, run):
        for version in ['../test', '20261102122526x', '20261102122524']:
            with self.assertRaises(ValueError):
                production.selected_migration(self.repo, self.url, version, True)
        run.assert_not_called()

    @patch.object(production.subprocess, 'run')
    def test_error_does_not_print_connection_secrets(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, stdout='', stderr=self.url)
        with self.assertRaises(ValueError) as caught:
            production.selected_migration(self.repo, self.url, '20261102122525', True)
        self.assertNotIn('private-password', str(caught.exception))


class ReadOnlySourceStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / 'supabase').mkdir()
        (self.repo / 'supabase/production-target.json').write_text('{"project_ref":"hvcpoxgkdybyscaebtik"}')
        self.cert = self.repo / 'ca.crt'
        self.cert.write_text('test certificate')
        self.credentials = self.repo / 'private.env'
        self.values = {'PROJECT_REF':'hvcpoxgkdybyscaebtik','PGHOST':'db.hvcpoxgkdybyscaebtik.supabase.co',
                       'PGUSER':'squadhub_backup_v1','PGPASSWORD':'private-password','PGDATABASE':'postgres',
                       'PGPORT':'5432','PGSSLMODE':'verify-full','PGSSLROOTCERT':str(self.cert)}

    def save(self):
        self.credentials.write_text(''.join(k+'='+v+'\n' for k,v in self.values.items()))

    @patch.object(production.subprocess,'run')
    def test_status_uses_read_only_transaction_and_keeps_password_out_of_arguments(self,run):
        self.save()
        run.return_value=subprocess.CompletedProcess([],0,stdout='{"database":"postgres","read_only":"on"}',stderr='')
        production.source_backup_status(self.repo,self.credentials)
        args,options=run.call_args
        self.assertTrue(options['input'].startswith('BEGIN READ ONLY;'))
        self.assertNotIn('private-password',str(args))
        self.assertEqual(options['env']['PGSSLMODE'],'verify-full')

    @patch.object(production.subprocess,'run')
    def test_wrong_source_and_unverified_tls_fail_before_connecting(self,run):
        for key,value in [('PROJECT_REF','retired'),('PGHOST','elsewhere'),('PGUSER','postgres'),('PGSSLMODE','disable')]:
            old=self.values[key];self.values[key]=value;self.save()
            with self.assertRaises(ValueError):production.source_backup_status(self.repo,self.credentials)
            self.values[key]=old
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
