"""Snapshot-consistent compressed COPY transport, rebuilt as a native full dump.
TLS protects the connection; the caller's AES-GCM protects the final archive.
The public PGP label is only a compression envelope, not an encryption secret.
"""
import base64, collections, json, os, pathlib, re, secrets, shutil, subprocess, time
LABEL='backup-transport-v1'
def ident(value): return '"'+value.replace('"','""')+'"'
def literal(value): return "'"+value.replace("'","''")+"'"
def copy_expression(columns):
    expressions=[]
    for column in columns:
        name=ident(column); expr=name+'::text'
        for code, suffix in [(92,None),(8,'b'),(12,'f'),(10,'n'),(13,'r'),(9,'t'),(11,'v')]:
            replacement='chr(92)||chr(92)' if suffix is None else 'chr(92)||'+literal(suffix)
            expr='replace('+expr+',chr('+str(code)+'),'+replacement+')'
        expressions.append('CASE WHEN '+name+' IS NULL THEN chr(92)||\'N\' ELSE '+expr+' END')
    return 'array_to_string(ARRAY['+','.join(expressions)+'],chr(9))'
def normalized_schema(data):
    lines=data.decode().splitlines(); result=[]
    for line in lines:
        # Extension pg_init_privs can serialize equivalent ACLs differently.
        # Compare function, relation and column ACLs independently below.
        if re.match(r'^(GRANT|REVOKE) .+ ON (FUNCTION|TABLE) ',line): continue
        if line.strip() and not line.startswith('--') and not line.startswith('\\restrict ') and not line.startswith('\\unrestrict '):result.append(line.rstrip())
    return collections.Counter(result)
def compact_dump(job, folder, env, snapshot, query, inventory):
    folder=pathlib.Path(folder); wire_bytes=0; logical_bytes=0
    query("SET timezone='UTC'; SET datestyle='ISO, MDY'; SET intervalstyle='postgres'; SET extra_float_digits=3; SET bytea_output='hex'; SET search_path=pg_catalog")
    assert query('SELECT count(*) FROM pg_inherits')=='0', 'Partitions/inheritance require native transport'
    pgcrypto_schema=query("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")
    assert pgcrypto_schema
    metadata=json.loads(query("""SELECT json_agg(json_build_object('schema',n.nspname,'table',c.relname,'columns',
      (SELECT json_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='')) ORDER BY n.nspname,c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'"""))
    source_tables={(t['schema'],t['table']):t for t in inventory['tables']}
    assert set(source_tables)=={(t['schema'],t['table']) for t in metadata}
    sequences=json.loads(query("""SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname,
      'state',query_to_xml(format('SELECT last_value,is_called FROM %I.%I',n.nspname,c.relname),false,true,'')) ORDER BY n.nspname,c.relname),'[]')
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%'"""))
    acl_sql="""SET search_path=pg_catalog; SELECT json_object_agg(n.nspname||'.'||p.oid::regprocedure::text,json_build_object('owner',pg_get_userbyid(p.proowner),'acl',
      (SELECT json_agg(json_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY pg_get_userbyid(x.grantor),x.grantee=0,pg_get_userbyid(x.grantee),x.privilege_type,x.is_grantable)
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x)))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'"""
    source_function_acl=json.loads(query(acl_sql))
    relation_acl_sql="""SELECT json_object_agg(n.nspname||'.'||c.relname,json_build_object('owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'acl',
      (SELECT json_agg(json_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY pg_get_userbyid(x.grantor),x.grantee=0,pg_get_userbyid(x.grantee),x.privilege_type,x.is_grantable)
       FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) x)))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','S','v','m','f') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'"""
    source_relation_acl=json.loads(query(relation_acl_sql))
    column_acl_sql="""SELECT coalesce(json_object_agg(n.nspname||'.'||c.relname||'.'||a.attname,
      (SELECT json_agg(json_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY pg_get_userbyid(x.grantor),x.grantee=0,pg_get_userbyid(x.grantee),x.privilege_type,x.is_grantable) FROM aclexplode(a.attacl) x)),'{}')
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'"""
    source_column_acl=json.loads(query(column_acl_sql))


    member_owner_sql="""WITH owners AS (
      SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO %I;',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner)) AS statement
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e' AND d.refclassid='pg_extension'::regclass WHERE p.prokind IN ('f','p') AND n.nspname NOT LIKE 'pg_%'
      UNION ALL SELECT format('ALTER %s %I.%I OWNER TO %I;',CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,n.nspname,c.relname,pg_get_userbyid(c.relowner))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e' AND d.refclassid='pg_extension'::regclass WHERE c.relkind IN ('r','p','S','v','m') AND n.nspname NOT LIKE 'pg_%'
      UNION ALL SELECT format('ALTER %s %I.%I OWNER TO %I;',CASE WHEN t.typtype='d' THEN 'DOMAIN' ELSE 'TYPE' END,n.nspname,t.typname,pg_get_userbyid(t.typowner))
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_depend d ON d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e' AND d.refclassid='pg_extension'::regclass WHERE n.nspname NOT LIKE 'pg_%' AND t.typelem=0 AND t.typrelid=0
      ) SELECT coalesce(json_agg(statement),'[]') FROM owners"""
    member_owner_statements=json.loads(query(member_owner_sql))
    extension_owners=json.loads(query("SELECT json_object_agg(extname,pg_get_userbyid(extowner)) FROM pg_extension"))
    schema_file=folder/'source-schema.dump'
    job.run(job.docker_client(env,'pg_dump','--schema-only','--format=custom','--snapshot',snapshot,'--file','/backup/source-schema.dump',mounts=[(folder,'/backup')]))
    gpg_home=folder/'gpg';gpg_home.mkdir(mode=0o700,exist_ok=True)
    data_file=folder/'copy-data.sql'
    with data_file.open('wb') as output:
        output.write(b"SET timezone='UTC'; SET datestyle='ISO, MDY'; SET intervalstyle='postgres'; SET extra_float_digits=3; SET bytea_output='hex';\n")
        for table in metadata:
            name=ident(table['schema'])+'.'+ident(table['table']); columns=table['columns']; assert columns
            output.write(('COPY '+name+' ('+','.join(map(ident,columns))+') FROM stdin;\n').encode())
            if source_tables[table['schema'],table['table']]['rows']:
                expr=copy_expression(columns)
                statement="SELECT replace(encode("+ident(pgcrypto_schema)+".pgp_sym_encrypt(string_agg(line,chr(10))||chr(10),"+literal(LABEL)+",'compress-algo=1,compress-level=6,s2k-mode=0'),'base64'),chr(10),'') FROM (SELECT "+expr+" AS line,(row_number() OVER()-1)/500 AS bucket FROM ONLY "+name+") AS rows GROUP BY bucket ORDER BY bucket"
                chunks=query(statement).splitlines()
                for encoded in chunks:
                    wire_bytes+=len(encoded)+1
                    payload=base64.b64decode(encoded,validate=True)
                    with (folder/'gpg-private-error.log').open('wb') as error:
                        p=subprocess.run(['gpg','--batch','--no-options','--homedir',str(gpg_home),'--pinentry-mode','loopback','--passphrase',LABEL,'--decrypt'],input=payload,stdout=subprocess.PIPE,stderr=error,timeout=60)
                    if p.returncode: raise RuntimeError('Compressed COPY envelope failed verification')
                    output.write(p.stdout);logical_bytes+=len(p.stdout)
            output.write(b'\\.\n')
        import xml.etree.ElementTree as ET
        for sequence in sequences:
            state=ET.fromstring(sequence['state']);value=state.findtext('.//last_value');called=state.findtext('.//is_called');assert value.isdigit() and called in ['true','false']
            name=ident(sequence['schema'])+'.'+ident(sequence['name'])
            output.write(('SELECT pg_catalog.setval('+literal(name)+','+value+','+called+');\n').encode())
    name='sqh-compact-'+secrets.token_hex(6);client=['docker','exec','-i',name]
    def sql(q,db='sqh_compact'):
        return job.run(client+['psql','-h','127.0.0.1','-U','supabase_admin','-d',db,'-XqAt','-v','ON_ERROR_STOP=1'],stdin=q.encode()).decode().strip()
    try:
        job.run(['docker','run','-d','--name',name,'--network','none','--memory','768m','--cpus','1','--tmpfs','/var/lib/postgresql/data:rw,size=768m','--env-file','/dev/stdin',job.image],stdin=('POSTGRES_PASSWORD='+secrets.token_hex(32)+'\nPOSTGRES_HOST_AUTH_METHOD=trust\n').encode())
        for attempt in range(60):
            if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','supabase_admin','-d','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('Isolated reconstruction database not ready')
        for role in inventory['roles']:
            sql('DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='+literal(role['name'])+') THEN CREATE ROLE '+ident(role['name'])+' NOLOGIN; END IF; END $$','postgres')
        sql('CREATE DATABASE sqh_compact TEMPLATE template0;','postgres')
        for file in [schema_file,data_file]: job.run(['docker','cp',str(file),name+':/tmp/'+file.name])
        restore=client+['pg_restore','-h','127.0.0.1','-U','supabase_admin','--exit-on-error','-d','sqh_compact']
        # Native dumps do not encode extension ownership. Recreate each under
        # its snapshot owner so extension-member ACLs also remain identical.
        for owner in set(extension_owners.values()):
            sql('ALTER ROLE '+ident(owner)+' SUPERUSER;', 'postgres')
        predata=job.run(client+['pg_restore','--section=pre-data','--clean','--if-exists','--file=-','/tmp/'+schema_file.name]).decode()
        def extension_role(match):
            token=match.group(1); ext=token[1:-1].replace('""','"') if token.startswith('"') else token
            assert ext in extension_owners
            return 'SET ROLE '+ident(extension_owners[ext])+';\n'+match.group(0)+'\nRESET ROLE;'
        predata=re.sub(r'^CREATE EXTENSION IF NOT EXISTS (\"[^\"]+\"|[^\s]+)[^;]*;',extension_role,predata,flags=re.M)
        sql(predata)
        sql('\n'.join(member_owner_statements))
        job.run(client+['psql','-h','127.0.0.1','-U','supabase_admin','-d','sqh_compact','-Xq','-v','ON_ERROR_STOP=1','--single-transaction','-f','/tmp/'+data_file.name])
        job.run(restore+['--section=post-data','/tmp/'+schema_file.name])
        actual={(t['schema'],t['table']):t for t in job.inventory(sql)}
        assert actual==source_tables,'Reconstructed rows/counts differ from source snapshot'
        import xml.etree.ElementTree as ET
        for sequence in sequences:
            state=ET.fromstring(sequence['state']);expected={'last_value':int(state.findtext('.//last_value')),'is_called':state.findtext('.//is_called')=='true'}
            actual_state=json.loads(sql('SELECT row_to_json(s) FROM (SELECT last_value,is_called FROM '+ident(sequence['schema'])+'.'+ident(sequence['name'])+') s'))
            assert actual_state==expected,'Sequence state mismatch'
        job.run(client+['pg_dump','-h','127.0.0.1','-U','supabase_admin','-d','sqh_compact','--format=custom','--compress=6','--file','/tmp/database.dump'])
        job.run(['docker','cp',name+':/tmp/database.dump',str(folder/'database.dump')])
        native=job.run(job.docker_client(env,'pg_restore','--schema-only','--file=-','/backup/source-schema.dump',mounts=[(folder,'/backup')]))
        rebuilt=job.run(job.docker_client(env,'pg_restore','--schema-only','--file=-','/backup/database.dump',mounts=[(folder,'/backup')]))
        assert json.loads(sql(relation_acl_sql))==source_relation_acl,'Relation ownership/ACL mismatch'
        assert json.loads(sql(column_acl_sql))==source_column_acl,'Column ACL mismatch'
        rebuilt_acl=json.loads(sql(acl_sql))
        if rebuilt_acl!=source_function_acl:
            (folder/'source-acl-private.json').write_text(json.dumps(source_function_acl))
            (folder/'rebuilt-acl-private.json').write_text(json.dumps(rebuilt_acl))
            raise RuntimeError('Effective function ownership/ACL mismatch')
        if normalized_schema(native)!=normalized_schema(rebuilt):
            (folder/'native-schema-private.sql').write_bytes(native);(folder/'rebuilt-schema-private.sql').write_bytes(rebuilt)
            raise RuntimeError('Reconstructed schema/ownership/ACL differs from snapshot')
        return {'compressed_data_wire_bytes':wire_bytes,'logical_data_bytes':logical_bytes,'schema_archive_bytes':schema_file.stat().st_size,'tables_verified':len(actual),'sequence_states_verified':len(sequences),'native_full_dump':True}
    finally:
        subprocess.run(['docker','rm','-f','-v',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run(['gpgconf','--homedir',str(gpg_home),'--kill','gpg-agent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
