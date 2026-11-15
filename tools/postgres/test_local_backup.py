import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup_local', Path(__file__).with_name('backup_local.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LocalBackupSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        app = self.root / 'app.env'
        app.write_text('')
        self.path = self.root / 'backup.env'
        self.values = {'DATABASE_KIND': 'postgres', 'PROJECT_REF': 'squadhub-local',
                       'PGHOST': 'db', 'PGPORT': '5432', 'PGUSER': 'local_backup',
                       'PGSSLMODE': 'disable', 'DOCKER_NETWORK': 'squadhub-local-data_data',
                       'RESTORE_ADMIN_USER': 'postgres', 'PGDATABASE': 'squadhub_trial_20261115_1234abcd',
                       'STATE_DIR': str(self.root / 'squadhub-local-backup'),
                       'POSTGRES_IMAGE': 'postgres:17.9-alpine', 'APP_ENV_FILE': str(app),
                       'BACKUP_ENCRYPTION_KEY': '00' * 32}

    def load(self):
        self.path.write_text(''.join(f'{k}={v}\n' for k, v in self.values.items()))
        return module.LocalBackup(self.path)

    def test_local_retention_cannot_use_hosted_backup_namespace(self):
        job = self.load()
        self.assertEqual(job.prefix, 'backups/postgres/squadhub-local/')
        self.assertNotIn('supabase', job.prefix)

    def test_wrong_host_network_or_administrator_is_rejected(self):
        for key, value in [('PGHOST', 'db.hvcpoxgkdybyscaebtik.supabase.co'),
                           ('DOCKER_NETWORK', 'host'), ('PGUSER', 'postgres'),
                           ('PROJECT_REF', 'hvcpoxgkdybyscaebtik')]:
            original = self.values[key]
            self.values[key] = value
            with self.assertRaises(ValueError):
                self.load()
            self.values[key] = original

    def test_production_name_and_shared_state_are_rejected(self):
        self.values['PGDATABASE'] = 'postgres'
        with self.assertRaises(ValueError):
            self.load()
        self.values['PGDATABASE'] = 'squadhub_trial_20261115_1234abcd'
        self.values['STATE_DIR'] = str(self.root / 'hosted-backup')
        with self.assertRaises(ValueError):
            self.load()


if __name__ == '__main__':
    unittest.main()
