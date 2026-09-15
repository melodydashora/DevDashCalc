// Server-side operator command only. No public enrollment issuance endpoint.
// Run in the Replit shell with DATABASE_URL and SESSION_SECRET already present.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAccountStore } from '../account-store.js';
import { createAuthService, AuthError } from '../auth.js';

export function parseEnrollmentArgs(args) {
  const known = new Set(['profile', 'name', 'base-url', 'out']);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (!args[index]?.startsWith('--') || !known.has(key) || Object.hasOwn(values, key) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Use --profile ID --name LABEL --base-url HTTPS_ORIGIN [--out PRIVATE_FILE].');
    }
    values[key] = args[index + 1];
  }
  if (!/^[a-z0-9-]{1,55}$/.test(values.profile || '') || !values.name?.trim() || values.name.length > 80) throw new Error('A valid existing profile ID and name are required.');
  let url;
  try { url = new URL(values['base-url']); } catch { throw new Error('An HTTPS app origin is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use only the HTTPS app origin, without credentials, a path, query, or fragment.');
  return { profileId: values.profile, name: values.name.trim(), origin: url.origin,
    output: path.resolve(values.out || path.join('data', 'enrollment-links', `${randomUUID()}.json`)) };
}

export async function writeEnrollmentArtifact({ auth, profileId, name, origin, output }) {
  // Reserve the destination before issuing the invitation, so an existing file
  // is never overwritten. Creation uses owner-only permissions on Unix/Replit.
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const { open } = await import('node:fs/promises');
  const file = await open(output, 'wx', 0o600);
  try {
    const issued = await auth.issueEnrollment({ profileId, name });
    const link = `${origin}/#/signup?enrollment=${encodeURIComponent(issued.token)}`;
    await file.writeFile(JSON.stringify({ purpose: 'Private single-use student enrollment link. Do not publish or commit.',
      profileId, name, expiresAt: new Date(issued.expiresAt).toISOString(), link }, null, 2) + '\n');
    return { output, expiresAt: issued.expiresAt };
  } finally { await file.close(); }
}

async function main() {
  try {
    const options = parseEnrollmentArgs(process.argv.slice(2));
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured in the server environment.');
    const auth = createAuthService({ store: createAccountStore(), sessionSecret: process.env.SESSION_SECRET });
    const result = await writeEnrollmentArtifact({ ...options, auth });
    // The enrollment bearer token/link is deliberately not printed to logs.
    process.stdout.write(`Private enrollment file: ${result.output}\nExpires: ${new Date(result.expiresAt).toISOString()}\n`);
  } catch (error) {
    const message = error instanceof AuthError ? error.message
      : error?.code === 'EEXIST' ? 'The output file already exists. Choose a new private output path.'
        : /^Use |^A valid |^An HTTPS |^DATABASE_URL |^SESSION_SECRET /.test(error?.message || '') ? error.message
          : 'Enrollment could not be created. Check the private server configuration and output path.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
