import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('postgres_production', Path(__file__).with_name('production.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TargetSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / 'supabase/migrations').mkdir(parents=True)
        self.target = {'kind': 'postgres', 'project_ref': 'squadhub-local', 'ssh_host': 'root@72.61.245.97',
                       'container': 'squadhub-local-data-db-1', 'compose_project': 'squadhub-local-data',
                       'database': 'squadhub_trial_20261116_1234abcd', 'deployment_id': '11111111-1111-4111-8111-111111111111'}
        self.save()

    def save(self):
        (self.repo / 'supabase/production-target.json').write_text(json.dumps(self.target))

    def test_source_or_unrelated_hosts_cannot_be_selected(self):
        for key, value in [('ssh_host', 'root@other'), ('database', 'postgres'), ('container', 'squadhub-server'), ('kind', 'supabase')]:
            before = self.target[key]
            self.target[key] = value
            self.save()
            with self.assertRaises(ValueError):
                module.target_configuration(self.repo)
            self.target[key] = before

    @patch.object(module, 'execute')
    def test_bulk_apply_and_path_traversal_never_connect(self, execute):
        for version in [None, '../file', '20261116120000x']:
            with self.assertRaises(ValueError):
                module.run(self.repo, 'apply', version)
        execute.assert_not_called()

    @patch.object(module, 'execute', return_value='')
    def test_only_selected_sql_is_recorded_transactionally(self, execute):
        folder = self.repo / 'supabase/migrations'
        (folder / '20261116120000_selected.sql').write_text('SELECT 1;')
        (folder / '20261116120001_unrelated.sql').write_text('DROP TABLE public.example;')
        module.run(self.repo, 'apply', '20261116120000')
        query = execute.call_args.args[2]
        self.assertTrue(query.startswith('BEGIN;'))
        self.assertIn('INSERT INTO supabase_migrations.schema_migrations', query)
        self.assertNotIn('DROP TABLE', query)
        self.assertTrue(query.endswith('COMMIT;'))


if __name__ == '__main__':
    unittest.main()
