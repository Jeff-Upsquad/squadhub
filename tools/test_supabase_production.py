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


if __name__ == '__main__':
    unittest.main()
