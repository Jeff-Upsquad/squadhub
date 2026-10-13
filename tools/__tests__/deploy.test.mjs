import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const source = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
const remote = source.split("<<'REMOTE'\n")[1].split('\nREMOTE\n')[0];

function runRemote(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'squadhub-deploy-test-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(dir, 'Caddyfile'), 'example.test {}\n');
  writeFileSync(join(dir, 'docker-log'), '');
  writeFileSync(join(bin, 'git'), String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), root = process.env.DEPLOY_TEST_DIR;
if (args[0] === 'rev-parse') {
  const countFile = root + '/head-count';
  const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0;
  fs.writeFileSync(countFile, String(count + 1));
  console.log(count === 0 || process.env.SAME_HEAD === 'true' ? 'old-commit' : 'new-commit');
} else if (args[0] === 'show') console.log('example.test {}');
else if (args[0] === 'merge-file') process.stdout.write(fs.readFileSync(args[2]));
else if (args[0] === 'diff' && process.env.SAME_HEAD !== 'true') console.log('web/src/calendar.tsx');
`, { mode: 0o755 });
  writeFileSync(join(bin, 'docker'), String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DEPLOY_TEST_DIR + '/docker-log', args.join(' ') + '\n');
if (args[0] === 'compose' && args[1] === process.env.FAIL_STAGE) process.exit(42);
if (args[0] === 'image' && args.includes('--format')) console.log('sha256:new');
if (args[0] === 'inspect') console.log(args.at(-1).includes('Running')
  ? 'true' : process.env.STALE_IMAGE === 'true' ? 'sha256:old' : 'sha256:new');
`, { mode: 0o755 });
  try {
    const result = spawnSync('bash', ['-c', remote.replace('cd /opt/squadhub', `cd '${dir}'`)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_TEST_DIR: dir,
        DEPLOY_TAG: 'test-release', FORCE_SERVICES: '', ...options },
    });
    const log = readFileSync(join(dir, 'docker-log'), 'utf8');
    return { ...result, log };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('build failure stops before container startup or release tagging', () => {
  const result = runRemote({ FAIL_STAGE: 'build' });
  assert.equal(result.status, 42, result.stderr);
  assert.match(result.log, /compose build web/);
  assert.doesNotMatch(result.log, /compose up|^tag /m);
});

test('container startup failure stops before release tagging', () => {
  const result = runRemote({ FAIL_STAGE: 'up' });
  assert.equal(result.status, 42, result.stderr);
  assert.doesNotMatch(result.log, /^tag /m);
});

test('a stale running image fails verification rather than tagging a release', () => {
  const result = runRemote({ STALE_IMAGE: 'true' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /built image is not running/);
  assert.doesNotMatch(result.log, /^tag /m);
});

test('explicit rebuild recovers when source HEAD was already advanced', () => {
  const result = runRemote({ SAME_HEAD: 'true', FORCE_SERVICES: 'web' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /compose build\s+web/);
  assert.match(result.log, /compose up -d\s+web/);
  assert.match(result.stdout, /Verified web image: sha256:new/);
  assert.match(result.log, /^tag squadhub-web:latest/m);
});

test('unchanged source without an explicit rebuild keeps the normal fast exit', () => {
  const result = runRemote({ SAME_HEAD: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.log, /compose build|compose up|^tag /m);
});
