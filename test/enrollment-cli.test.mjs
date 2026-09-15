import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnrollmentArgs, writeEnrollmentArtifact } from '../scripts/create-enrollment.mjs';

test('private enrollment link keeps its token in the fragment and will not overwrite an existing artifact', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 's4ai-enrollment-test-'));
  const output = path.join(directory, 'private.json');
  let issues = 0;
  const auth = { issueEnrollment: async () => { issues++; return { token: 'a'.repeat(43), expiresAt: Date.parse('2026-09-16T00:00:00Z') }; } };
  try {
    const result = await writeEnrollmentArtifact({ auth, profileId: 'test-child', name: 'Student', origin: 'https://example.test', output });
    assert.equal(Object.hasOwn(result, 'token'), false);
    const artifact = JSON.parse(await readFile(output, 'utf8'));
    const link = new URL(artifact.link);
    assert.equal(link.search, '');
    assert.equal(link.hash, '#/signup?enrollment=' + 'a'.repeat(43));
    if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
    await assert.rejects(writeEnrollmentArtifact({ auth, profileId: 'test-child', name: 'Student', origin: 'https://example.test', output }), { code: 'EEXIST' });
    assert.equal(issues, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('enrollment CLI accepts only an explicit HTTPS origin and validated existing profile ID', () => {
  const args = ['--profile', 'existing-child', '--name', 'Student', '--base-url', 'https://example.test'];
  assert.equal(parseEnrollmentArgs(args).origin, 'https://example.test');
  for (const origin of ['http://example.test', 'https://user:secret@example.test', 'https://example.test/?token=secret', 'https://example.test/path']) {
    assert.throws(() => parseEnrollmentArgs([...args.slice(0, -1), origin]));
  }
  assert.throws(() => parseEnrollmentArgs(['--profile', '../other', ...args.slice(2)]));
});
