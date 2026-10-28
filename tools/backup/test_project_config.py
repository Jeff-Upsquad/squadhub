"""Configuration safety only: no network, Docker or real credentials."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("backup_under_test", Path(__file__).with_name("backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class ProjectConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        app = self.root / "app.env"
        app.write_text("")
        self.config_path = self.root / "backup.env"
        self.destination = next(iter(backup.SUPPORTED_PROJECTS - {backup.PROJECT}))
        self.config = {
            "PROJECT_REF": backup.PROJECT,
            "PGHOST": "db." + backup.PROJECT + ".supabase.co",
            "PGUSER": "backup_reader",
            "POSTGRES_IMAGE": "postgres:17",
            "BACKUP_ENCRYPTION_KEY": "00" * 32,
            "APP_ENV_FILE": str(app),
            "ALERT_ENV_FILE": str(app),
            "STATE_DIR": str(self.root / "source-state"),
        }

    def destination_config(self):
        self.config.update(
            PROJECT_REF=self.destination,
            PGHOST="db." + self.destination + ".supabase.co",
            STATE_DIR=str(self.root / ("destination-" + self.destination)),
        )

    def load(self):
        self.config_path.write_text("".join(k + "=" + v + "\n" for k, v in self.config.items()))
        return backup.Backup(self.config_path)

    def test_source_namespace_is_unchanged(self):
        self.assertEqual(self.load().prefix, "backups/supabase/" + backup.PROJECT + "/")

    def test_destination_has_an_independent_namespace_and_state(self):
        self.destination_config()
        job = self.load()
        self.assertEqual(job.prefix, "backups/supabase/" + self.destination + "/")
        self.assertIn(self.destination, job.root.name)

    def test_session_pooler_must_identify_the_same_project(self):
        self.config.update(PGHOST="aws-1-ap-south-1.pooler.supabase.com",
                           PGUSER="backup_reader." + backup.PROJECT)
        self.assertEqual(self.load().project, backup.PROJECT)
        self.config["PGUSER"] = "backup_reader.anotherproject"
        with self.assertRaisesRegex(ValueError, "connection"):
            self.load()

    def test_mismatched_direct_host_is_rejected(self):
        self.destination_config()
        self.config["PGHOST"] = "db." + backup.PROJECT + ".supabase.co"
        with self.assertRaisesRegex(ValueError, "connection"):
            self.load()

    def test_unknown_projects_are_rejected(self):
        self.config.update(PROJECT_REF="unexpected", PGHOST="db.unexpected.supabase.co")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            self.load()

    def test_destination_cannot_reuse_source_state(self):
        self.destination_config()
        self.config["STATE_DIR"] = str(self.root / "source-state")
        with self.assertRaisesRegex(ValueError, "separate directory"):
            self.load()

    def test_destination_cannot_inherit_a_pinned_source_address(self):
        self.destination_config()
        self.config["PGHOSTADDR"] = "192.0.2.1"
        with self.assertRaisesRegex(ValueError, "pinned source"):
            self.load()

if __name__ == "__main__":
    unittest.main()

