// Relational account storage. Each operation is a parameterized SQL statement
// over the existing zero-dependency wire client. Never fall back to local files
// when authenticating or granting ownership.
import { pgQuery, parseDatabaseUrl } from './store.js';

export class AccountStoreError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS s4ai_users (
    id uuid PRIMARY KEY, username text NOT NULL UNIQUE, display_name text NOT NULL,
    password_hash text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    auth_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS s4ai_workspaces (
    id uuid PRIMARY KEY, profile_id text NOT NULL UNIQUE, name text NOT NULL,
    owner_user_id uuid REFERENCES s4ai_users(id), created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (profile_id ~ '^[a-z0-9-]{1,55}$'))`,
  `CREATE TABLE IF NOT EXISTS s4ai_workspace_members (
    workspace_id uuid NOT NULL REFERENCES s4ai_workspaces(id), user_id uuid NOT NULL REFERENCES s4ai_users(id),
    role text NOT NULL CHECK (role IN ('owner','viewer')), created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS s4ai_sessions (
    id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES s4ai_users(id),
    auth_version integer NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS s4ai_sessions_user_idx ON s4ai_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS s4ai_enrollments (
    id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, workspace_id uuid NOT NULL REFERENCES s4ai_workspaces(id),
    expires_at timestamptz NOT NULL, consumed_at timestamptz, consumed_by uuid REFERENCES s4ai_users(id),
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS s4ai_auth_limits (
    bucket_key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL)`,
];

const userColumns = `u.id::text, u.username, u.display_name`;
const userValue = row => row ? { id: row[0], username: row[1], displayName: row[2] } : null;
const workspaceValue = row => ({ id: row[0], profileId: row[1], name: row[2], role: row[3] });

export function createAccountStore({ query } = {}) {
  const run = query || ((sql, params = []) => {
    if (!process.env.DATABASE_URL) throw new AccountStoreError('DATABASE_REQUIRED');
    return pgQuery(parseDatabaseUrl(process.env.DATABASE_URL), sql, params);
  });
  let initialized;
  const init = () => {
    if (!initialized) initialized = (async () => { for (const sql of SCHEMA) await run(sql); })()
      .catch(error => { initialized = null; throw error; });
    return initialized;
  };
  const execute = async (sql, params = []) => { await init(); return run(sql, params); };
  const uniqueUser = error => {
    if (/23505/.test(String(error?.code || error?.message))) throw new AccountStoreError('USERNAME_TAKEN');
    throw error;
  };

  return {
    init,
    async findUser(username) {
      const rows = await execute(`SELECT ${userColumns}, u.password_hash, u.status, u.auth_version::text FROM s4ai_users u WHERE u.username=$1`, [username]);
      return rows[0] ? { ...userValue(rows[0]), passwordHash: rows[0][3], status: rows[0][4], authVersion: Number(rows[0][5]) } : null;
    },
    async listWorkspaces(userId) {
      return (await execute(`SELECT w.id::text,w.profile_id,w.name,m.role FROM s4ai_workspace_members m
        JOIN s4ai_workspaces w ON w.id=m.workspace_id JOIN s4ai_users u ON u.id=m.user_id
        WHERE m.user_id=$1::uuid AND u.status='active' AND w.owner_user_id IS NOT NULL AND m.role='owner'
        ORDER BY w.created_at,w.id`, [userId])).map(workspaceValue);
    },
    async register({ userId, username, displayName, passwordHash, workspaceId, profileId, workspaceName, sessionId, sessionHash, expiresAt, enrollmentHash, now }) {
      try {
        if (enrollmentHash) {
          // Both the invitation and unclaimed workspace are locked before any
          // user is created. A duplicate username rolls back the whole statement;
          // an invalid/reused invitation creates no user, session or membership.
          const rows = await execute(`WITH invitation AS MATERIALIZED (
              SELECT e.id,e.workspace_id FROM s4ai_enrollments e JOIN s4ai_workspaces w ON w.id=e.workspace_id
              WHERE e.token_hash=$1 AND e.consumed_at IS NULL AND e.expires_at>$2::timestamptz
                AND w.owner_user_id IS NULL FOR UPDATE OF e,w
            ), new_user AS (
              INSERT INTO s4ai_users(id,username,display_name,password_hash)
              SELECT $3::uuid,$4,$5,$6 FROM invitation RETURNING *
            ), claimed AS (
              UPDATE s4ai_workspaces w SET owner_user_id=u.id FROM new_user u,invitation i
              WHERE w.id=i.workspace_id AND w.owner_user_id IS NULL RETURNING w.*
            ), used AS (
              UPDATE s4ai_enrollments e SET consumed_at=$2::timestamptz,consumed_by=c.owner_user_id
              FROM claimed c,invitation i WHERE e.id=i.id AND e.consumed_at IS NULL RETURNING e.id
            ), member AS (
              INSERT INTO s4ai_workspace_members(workspace_id,user_id,role)
              SELECT c.id,c.owner_user_id,'owner' FROM claimed c,used RETURNING workspace_id
            ), session AS (
              INSERT INTO s4ai_sessions(id,token_hash,user_id,auth_version,expires_at)
              SELECT $7::uuid,$8,u.id,u.auth_version,$9::timestamptz FROM new_user u,member RETURNING id
            ) SELECT u.id::text,u.username,u.display_name FROM new_user u,session`,
          [enrollmentHash, now, userId, username, displayName, passwordHash, sessionId, sessionHash, expiresAt]);
          if (!rows[0]) throw new AccountStoreError('INVALID_ENROLLMENT');
          return userValue(rows[0]);
        }
        const rows = await execute(`WITH new_user AS (
            INSERT INTO s4ai_users(id,username,display_name,password_hash) VALUES ($1::uuid,$2,$3,$4) RETURNING *
          ), workspace AS (
            INSERT INTO s4ai_workspaces(id,profile_id,name,owner_user_id)
            SELECT $5::uuid,$6,$7,u.id FROM new_user u RETURNING id,owner_user_id
          ), member AS (
            INSERT INTO s4ai_workspace_members(workspace_id,user_id,role)
            SELECT id,owner_user_id,'owner' FROM workspace RETURNING workspace_id
          ), session AS (
            INSERT INTO s4ai_sessions(id,token_hash,user_id,auth_version,expires_at)
            SELECT $8::uuid,$9,u.id,u.auth_version,$10::timestamptz FROM new_user u,member RETURNING id
          ) SELECT u.id::text,u.username,u.display_name FROM new_user u,session`,
        [userId, username, displayName, passwordHash, workspaceId, profileId, workspaceName, sessionId, sessionHash, expiresAt]);
        return userValue(rows[0]);
      } catch (error) { return uniqueUser(error); }
    },
    async createSession({ id, tokenHash, userId, authVersion, expiresAt }) {
      const rows = await execute(`INSERT INTO s4ai_sessions(id,token_hash,user_id,auth_version,expires_at)
        SELECT $1::uuid,$2,u.id,u.auth_version,$3::timestamptz FROM s4ai_users u
        WHERE u.id=$4::uuid AND u.status='active' AND u.auth_version=$5::integer RETURNING id::text`,
      [id, tokenHash, expiresAt, userId, authVersion]);
      return Boolean(rows[0]);
    },
    async authenticate(tokenHash, now) {
      const rows = await execute(`SELECT ${userColumns},s.id::text,s.expires_at::text FROM s4ai_sessions s
        JOIN s4ai_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL
        AND s.expires_at>$2::timestamptz AND u.status='active' AND s.auth_version=u.auth_version`, [tokenHash, now]);
      return rows[0] ? { user: userValue(rows[0]), sessionId: rows[0][3], expiresAt: new Date(rows[0][4]).toISOString() } : null;
    },
    async authorizeWorkspace(sessionId, userId, profileId, now) {
      const rows = await execute(`SELECT w.id::text,w.profile_id,w.name,m.role FROM s4ai_sessions s
        JOIN s4ai_users u ON u.id=s.user_id JOIN s4ai_workspace_members m ON m.user_id=u.id
        JOIN s4ai_workspaces w ON w.id=m.workspace_id WHERE s.id=$1::uuid AND u.id=$2::uuid
        AND s.revoked_at IS NULL AND s.expires_at>$3::timestamptz AND u.status='active' AND s.auth_version=u.auth_version
        AND w.owner_user_id IS NOT NULL AND ($4='' OR w.profile_id=$4) AND m.role='owner'
        ORDER BY w.created_at,w.id LIMIT 1`, [sessionId, userId, now, profileId || '']);
      return rows[0] ? workspaceValue(rows[0]) : null;
    },
    async revokeSession(tokenHash, now) {
      await execute('UPDATE s4ai_sessions SET revoked_at=$2::timestamptz WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash, now]);
    },
    async legacyProfileExists(profileId) {
      // Existence only: do not retrieve progress or credentials during issuance.
      const rows = await execute('SELECT EXISTS(SELECT 1 FROM calc_coach_store WHERE key=$1)::text', [`progress-${profileId}`]);
      return rows[0]?.[0] === 'true';
    },
    async createEnrollment({ id, tokenHash, workspaceId, profileId, name, expiresAt }) {
      const rows = await execute(`WITH workspace AS (
          INSERT INTO s4ai_workspaces(id,profile_id,name) VALUES ($1::uuid,$2,$3)
          ON CONFLICT(profile_id) DO UPDATE SET name=s4ai_workspaces.name
          WHERE s4ai_workspaces.owner_user_id IS NULL RETURNING id
        ) INSERT INTO s4ai_enrollments(id,token_hash,workspace_id,expires_at)
        SELECT $4::uuid,$5,id,$6::timestamptz FROM workspace RETURNING id::text`,
      [workspaceId, profileId, name, id, tokenHash, expiresAt]);
      if (!rows[0]) throw new AccountStoreError('WORKSPACE_ALREADY_OWNED');
    },
    async consumeRateLimit(key, limit, resetAt, now) {
      const rows = await execute(`INSERT INTO s4ai_auth_limits(bucket_key,attempts,reset_at) VALUES ($1,1,$2::timestamptz)
        ON CONFLICT(bucket_key) DO UPDATE SET
          attempts=CASE WHEN s4ai_auth_limits.reset_at<=$3::timestamptz THEN 1 ELSE s4ai_auth_limits.attempts+1 END,
          reset_at=CASE WHEN s4ai_auth_limits.reset_at<=$3::timestamptz THEN EXCLUDED.reset_at ELSE s4ai_auth_limits.reset_at END
        RETURNING attempts::text`, [key, resetAt, now]);
      return Number(rows[0]?.[0] || limit + 1) <= limit;
    },
  };
}
