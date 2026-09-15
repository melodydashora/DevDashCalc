// Passwords and bearer credentials stay on the server. The store is mandatory;
// database failure must never create a local-file authentication fallback.
import { randomBytes, randomUUID, createHmac, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AccountStoreError } from './account-store.js';

const derive = promisify(scrypt);
const SCRYPT = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PROFILE = /^[a-z0-9-]{1,55}$/;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ENROLLMENT_MS = 24 * 60 * 60 * 1000;
const DUMMY_HASH = `scrypt$131072$8$1$${Buffer.alloc(16, 1).toString('base64url')}$${Buffer.alloc(32, 1).toString('base64url')}`;

export class AuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// Bound both active 128 MiB derivations and queued requests. Persistent rate
// limits below are separate and continue to work across server restarts.
let activeHashes = 0;
const hashWaiters = [];
async function passwordWork(work) {
  if (activeHashes >= 2) {
    if (hashWaiters.length >= 4) throw new AuthError(503, 'AUTH_BUSY', 'Sign-in is busy. Please try again shortly.');
    await new Promise(resolve => hashWaiters.push(resolve));
  } else activeHashes++;
  try { return await work(); }
  finally {
    const next = hashWaiters.shift();
    if (next) next();
    else activeHashes--;
  }
}

function validPassword(password) {
  return typeof password === 'string' && password.length <= 256 && [...password].length >= 15 && [...password].length <= 128;
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new AuthError(400, 'INVALID_PASSWORD', 'Use a password with 15 to 128 characters.');
  return passwordWork(async () => {
    const salt = randomBytes(16);
    const key = await derive(password, salt, 32, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  });
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const valid = parts.length === 6 && parts[0] === 'scrypt' && parts[1] === String(SCRYPT.N)
    && parts[2] === '8' && parts[3] === '1' && /^[A-Za-z0-9_-]{22}$/.test(parts[4]) && TOKEN.test(parts[5]);
  // A damaged/unsupported stored hash uses equal-cost work and never matches.
  const fields = valid ? parts : DUMMY_HASH.split('$');
  return passwordWork(async () => {
    const key = await derive(password, Buffer.from(fields[4], 'base64url'), 32, SCRYPT);
    const matches = timingSafeEqual(key, Buffer.from(fields[5], 'base64url'));
    return valid && matches;
  });
}

function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) throw new AuthError(400, 'INVALID_USERNAME', 'Use 3 to 32 letters, numbers, underscores, or hyphens for your username.');
  return username;
}
function displayName(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string' || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AuthError(400, 'INVALID_NAME', 'Use a display name of up to 80 characters.');
  }
  return value.trim() || fallback;
}
const safeUser = user => ({ id: user.id, username: user.username, displayName: user.displayName });
const invalidLogin = () => new AuthError(401, 'INVALID_CREDENTIALS', 'The username or password did not match.');
const invalidEnrollment = () => new AuthError(400, 'INVALID_ENROLLMENT', 'This enrollment link is invalid, expired, or already used. Ask the app owner for a new link.');

export function createAuthService({ store, sessionSecret, allowSelfSignup = false, now = () => Date.now(), sessionTtlMs = SESSION_MS } = {}) {
  if (!store) throw new Error('Account database store is required.');
  if (typeof sessionSecret !== 'string' || Buffer.byteLength(sessionSecret.trim()) < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > SESSION_MS) throw new Error('Invalid session lifetime.');
  const digest = (type, value) => createHmac('sha256', sessionSecret).update(`students4ai:${type}:v1\0`).update(value).digest('hex');
  const instant = () => new Date(now()).toISOString();
  const safe = async work => {
    try { return await work(); }
    catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof AccountStoreError) {
        if (error.code === 'INVALID_ENROLLMENT') throw invalidEnrollment();
        if (error.code === 'USERNAME_TAKEN') throw new AuthError(409, 'USERNAME_TAKEN', 'That username is unavailable. Choose another username.');
        if (error.code === 'WORKSPACE_ALREADY_OWNED') throw new AuthError(409, 'WORKSPACE_ALREADY_OWNED', 'This workspace already belongs to an account.');
      }
      // Never put database errors, password hashes, or connection strings in a
      // client response or log. The integration layer may log this safe code.
      throw new AuthError(503, 'AUTH_UNAVAILABLE', 'Account storage is unavailable. Please try again later.');
    }
  };
  async function rate(action, username, clientKey) {
    const stamp = now();
    const windowMs = action === 'register' ? 60 * 60 * 1000 : 15 * 60 * 1000;
    const constraints = [[`client:${String(clientKey || 'unknown').slice(0, 200)}`, action === 'register' ? 12 : 60]];
    if (username) constraints.push([`username:${username}`, action === 'register' ? 5 : 12]);
    for (const [scope, limit] of constraints) {
      const allowed = await store.consumeRateLimit(digest(`rate:${action}`, scope), limit,
        new Date(stamp + windowMs).toISOString(), new Date(stamp).toISOString());
      if (!allowed) throw new AuthError(429, 'AUTH_RATE_LIMITED', 'Too many sign-in attempts. Please try again later.');
    }
  }
  function session() {
    const token = randomBytes(32).toString('base64url');
    return { id: randomUUID(), token, tokenHash: digest('session', token), expiresAt: new Date(now() + sessionTtlMs).toISOString() };
  }

  return {
    async register(input = {}, { clientKey } = {}) {
      return safe(async () => {
        const username = normalizeUsername(input.username);
        const name = displayName(input.displayName, username);
        if (!validPassword(input.password)) throw new AuthError(400, 'INVALID_PASSWORD', 'Use a password with 15 to 128 characters.');
        const enrollment = input.enrollmentToken;
        if (enrollment != null && !TOKEN.test(enrollment)) throw invalidEnrollment();
        if (!enrollment && !allowSelfSignup) throw new AuthError(403, 'ENROLLMENT_REQUIRED', 'Use the private enrollment link from the app owner to create your account.');
        await rate('register', username, clientKey);
        const passwordHash = await hashPassword(input.password);
        const pending = session();
        const user = await store.register({ userId: randomUUID(), username, displayName: name, passwordHash,
          workspaceId: randomUUID(), profileId: `student-${randomUUID()}`, workspaceName: name,
          sessionId: pending.id, sessionHash: pending.tokenHash, expiresAt: pending.expiresAt,
          enrollmentHash: enrollment ? digest('enrollment', enrollment) : null, now: instant() });
        const workspaces = await store.listWorkspaces(user.id);
        return { token: pending.token, expiresAt: Date.parse(pending.expiresAt), user: safeUser(user), workspaces };
      });
    },
    async login(input = {}, { clientKey } = {}) {
      return safe(async () => {
        let username;
        try { username = normalizeUsername(input.username); } catch { throw invalidLogin(); }
        if (typeof input.password !== 'string' || input.password.length > 256) throw invalidLogin();
        await rate('login', username, clientKey);
        const user = await store.findUser(username);
        const verified = await verifyPassword(input.password, user?.passwordHash || DUMMY_HASH);
        if (!user || !verified || user.status !== 'active') throw invalidLogin();
        const pending = session();
        const created = await store.createSession({ id: pending.id, tokenHash: pending.tokenHash, expiresAt: pending.expiresAt, userId: user.id, authVersion: user.authVersion });
        if (!created) throw invalidLogin();
        return { token: pending.token, expiresAt: Date.parse(pending.expiresAt), user: safeUser(user), workspaces: await store.listWorkspaces(user.id) };
      });
    },
    async authenticate(token) {
      if (typeof token !== 'string' || !TOKEN.test(token)) return null;
      return safe(async () => {
        const context = await store.authenticate(digest('session', token), instant());
        if (!context) return null;
        return { ...context, expiresAt: Date.parse(context.expiresAt), user: safeUser(context.user), workspaces: await store.listWorkspaces(context.user.id) };
      });
    },
    async authorizeWorkspace(context, requestedProfileId) {
      return safe(async () => {
        if (!context?.sessionId || !context?.user?.id) throw new AuthError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
        if (requestedProfileId != null && (typeof requestedProfileId !== 'string' || !PROFILE.test(requestedProfileId))) {
          throw new AuthError(403, 'WORKSPACE_FORBIDDEN', 'This workspace is not available to your account.');
        }
        const workspace = await store.authorizeWorkspace(context.sessionId, context.user.id, requestedProfileId || '', instant());
        if (!workspace) throw new AuthError(403, 'WORKSPACE_FORBIDDEN', 'This workspace is not available to your account.');
        return workspace;
      });
    },
    async logout(token) {
      if (typeof token !== 'string' || !TOKEN.test(token)) return;
      return safe(() => store.revokeSession(digest('session', token), instant()));
    },
    async issueEnrollment({ profileId, name, expiresInMs = ENROLLMENT_MS } = {}) {
      return safe(async () => {
        if (typeof profileId !== 'string' || !PROFILE.test(profileId)) throw new AuthError(400, 'INVALID_PROFILE', 'A valid existing workspace ID is required.');
        if (!Number.isFinite(expiresInMs) || expiresInMs < 60_000 || expiresInMs > 7 * ENROLLMENT_MS) {
          throw new AuthError(400, 'INVALID_EXPIRY', 'Enrollment links must expire within one minute to seven days.');
        }
        if (!await store.legacyProfileExists(profileId)) throw new AuthError(404, 'PROFILE_NOT_FOUND', 'No saved database progress exists for this workspace.');
        const label = displayName(name, profileId);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(now() + expiresInMs).toISOString();
        await store.createEnrollment({ id: randomUUID(), tokenHash: digest('enrollment', token), workspaceId: randomUUID(), profileId, name: label, expiresAt });
        return { token, profileId, expiresAt: Date.parse(expiresAt) };
      });
    },
  };
}
