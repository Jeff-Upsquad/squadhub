"""Opt-in, read-only PostgreSQL golden test: no table/account mutations."""
import os
from pathlib import Path
import tempfile
import unittest
from backup import Backup
from compact_transport import copy_expression, ident, literal

@unittest.skipUnless(os.environ.get('BACKUP_COPY_TEST_CONFIG'), 'Set an explicit read-only test connection')
class CopyProtocolTests(unittest.TestCase):
    def test_copy_encoding_matches_postgres_for_special_values_and_1001_rows(self):
        job=Backup(os.environ['BACKUP_COPY_TEST_CONFIG'])
        values=[
            ('quoted"column',literal('\\N')+'::text'),
            ('controls',literal('tab\tline\nreturn\rback\bform\fvertical\vslash\\.')+'::text'),
            ('unicode',literal('Unicode: नमस्ते 🌱')+'::text'),
            ('binary',"decode('00090a0dff','hex')"),
            ('array_value',"ARRAY['a,b','{quoted}',NULL,'\\N']::text[]"),
            ('json_value',literal('{"duplicate":1,"duplicate":2,"null":null,"escape":"\\n"}')+'::json'),
            ('precise',"1234567890.12345678901234567890::numeric"),
            ('utc_time',"'2026-10-28 12:34:56.123456+05:30'::timestamptz"),
            ('empty',"''::text"),('missing','NULL::text'),('nan',"'NaN'::float8"),
            ('interval_value',"interval '2 months 3 days 01:02:03.123456'"),('row_number','n'),
        ]
        source='SELECT '+','.join(value+' AS '+ident(name) for name,value in values)+' FROM generate_series(1,1001) n'
        settings="SET timezone='UTC';SET bytea_output='hex';SET extra_float_digits=3;SET standard_conforming_strings=on;"
        with tempfile.TemporaryDirectory() as folder:
            with job.client_env(folder) as env:
                native=job.run(job.docker_client(env,'psql','-XqAt','-v','ON_ERROR_STOP=1','-c',settings+'COPY ('+source+') TO STDOUT'))
                encoded=job.run(job.docker_client(env,'psql','-XqAt','-v','ON_ERROR_STOP=1','-c',settings+'SELECT '+copy_expression([name for name,_ in values])+' FROM ('+source+') fixture'))
        self.assertEqual(encoded,native)
        self.assertEqual(len(native.split(b'\n')),1002)
if __name__=='__main__':unittest.main()
