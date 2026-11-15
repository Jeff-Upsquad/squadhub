import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('rehearse', Path(__file__).with_name('rehearse.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CatalogTest(unittest.TestCase):
    def test_only_vault_objects_are_omitted(self):
        text = '''; archive
1; 3079 99 EXTENSION - supabase_vault
2; 0 0 COMMENT - EXTENSION supabase_vault
3; 1259 100 TABLE vault secrets supabase_admin
4; 0 100 TABLE DATA vault secrets supabase_admin
5; 1259 101 TABLE public clients postgres
6; 1259 102 TABLE auth users supabase_auth_admin
7; 1259 103 TABLE smm jobs postgres
8; 3079 104 EXTENSION - pgcrypto
'''
        kept, removed = module.portable_catalog(text)
        self.assertEqual(len(removed), 4)
        for expected in ['TABLE public clients', 'TABLE auth users', 'TABLE smm jobs', 'EXTENSION - pgcrypto']:
            self.assertIn(expected, kept)
        self.assertNotIn('TABLE DATA vault', kept)


if __name__ == '__main__':
    unittest.main()
