// Isolated behavioral fixture only. Production account storage is PostgreSQL.
import { AccountStoreError } from '../../account-store.js';

export function createMemoryAccountStore() {
  const users = new Map(), sessions = new Map(), workspaces = new Map(), invitations = new Map(), limits = new Map();
  const legacyProfiles = new Set();
  const calls = [];
  const view = w => ({ id: w.id, profileId: w.profileId, name: w.name, role: 'owner' });
  const publicUser = u => ({ id: u.id, username: u.username, displayName: u.displayName });
  const sessionUser = (row, now) => {
    const user = users.get(row?.userId);
    return row && !row.revokedAt && Date.parse(row.expiresAt) > Date.parse(now)
      && user?.status === 'active' && user.authVersion === row.authVersion ? user : null;
  };
  const store = {
    async init() {},
    async consumeRateLimit(key, limit, resetAt, now) {
      let row = limits.get(key);
      if (!row || Date.parse(row.resetAt) <= Date.parse(now)) row = { count: 0, resetAt };
      row.count++; limits.set(key, row);
      return row.count <= limit;
    },
    async findUser(username) { return [...users.values()].find(u => u.username === username) || null; },
    async listWorkspaces(userId) {
      return [...workspaces.values()].filter(w => w.ownerId === userId && users.get(userId)?.status === 'active').map(view);
    },
    async register(record) {
      calls.push(['register', structuredClone(record)]);
      // No await between checks and mutations: mirror the SQL atomic boundary.
      const invitation = record.enrollmentHash ? invitations.get(record.enrollmentHash) : null;
      const oldWorkspace = invitation ? workspaces.get(invitation.profileId) : null;
      if (record.enrollmentHash && (!invitation || invitation.consumedAt || Date.parse(invitation.expiresAt) <= Date.parse(record.now) || oldWorkspace?.ownerId)) {
        throw new AccountStoreError('INVALID_ENROLLMENT');
      }
      if ([...users.values()].some(u => u.username === record.username)) throw new AccountStoreError('USERNAME_TAKEN');
      const user = { id: record.userId, username: record.username, displayName: record.displayName,
        passwordHash: record.passwordHash, status: 'active', authVersion: 1 };
      const workspace = oldWorkspace || { id: record.workspaceId, profileId: record.profileId, name: record.workspaceName };
      users.set(user.id, user);
      workspace.ownerId = user.id;
      workspaces.set(workspace.profileId, workspace);
      if (invitation) { invitation.consumedAt = record.now; invitation.consumedBy = user.id; }
      sessions.set(record.sessionHash, { id: record.sessionId, tokenHash: record.sessionHash, userId: user.id, authVersion: 1, expiresAt: record.expiresAt });
      return publicUser(user);
    },
    async createSession(record) {
      calls.push(['createSession', structuredClone(record)]);
      const user = users.get(record.userId);
      if (!user || user.status !== 'active' || user.authVersion !== record.authVersion) return false;
      sessions.set(record.tokenHash, { ...record });
      return true;
    },
    async authenticate(hash, now) {
      const row = sessions.get(hash), user = sessionUser(row, now);
      return user ? { sessionId: row.id, user: publicUser(user), expiresAt: row.expiresAt } : null;
    },
    async authorizeWorkspace(sessionId, userId, profileId, now) {
      const row = [...sessions.values()].find(s => s.id === sessionId && s.userId === userId);
      if (!sessionUser(row, now)) return null;
      const workspace = [...workspaces.values()].find(w => w.ownerId === userId && (!profileId || w.profileId === profileId));
      return workspace ? view(workspace) : null;
    },
    async revokeSession(hash, now) { const row = sessions.get(hash); if (row) row.revokedAt = now; },
    async legacyProfileExists(profileId) { return legacyProfiles.has(profileId); },
    async createEnrollment(record) {
      calls.push(['createEnrollment', structuredClone(record)]);
      const existing = workspaces.get(record.profileId);
      if (existing?.ownerId) throw new AccountStoreError('WORKSPACE_ALREADY_OWNED');
      if (!existing) workspaces.set(record.profileId, { id: record.workspaceId, profileId: record.profileId, name: record.name, ownerId: null });
      invitations.set(record.tokenHash, { ...record });
    },
  };
  return { store, users, sessions, workspaces, invitations, limits, legacyProfiles, calls };
}
