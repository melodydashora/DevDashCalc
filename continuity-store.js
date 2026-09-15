// Explicitly saved study notes only. The HTTP boundary must authorize the
// workspace and derive createdByUserId from the signed-in account. Never pass
// cookies, credentials, whole transcripts, or an unreviewed model output here.
import { randomUUID } from 'node:crypto';
import { pgQuery, parseDatabaseUrl } from './store.js';

const PROFILE = /^[a-z0-9-]{1,55}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES = new Set(['student_note', 'coach_note']);
const KINDS = new Set(['settings', 'study-coach', 'question-coach']);
const SUBJECTS = new Set(['calculus-bc', 'calculus-ab', 'physics', 'all']);
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS s4ai_student_memos (
    id uuid PRIMARY KEY, profile_id text NOT NULL REFERENCES s4ai_workspaces(profile_id),
    created_by_user_id uuid NOT NULL REFERENCES s4ai_users(id), client_request_id uuid NOT NULL,
    memo_text text NOT NULL CHECK (char_length(memo_text) BETWEEN 1 AND 2000),
    memo_type text NOT NULL CHECK (memo_type IN ('student_note','coach_note')),
    source jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source)='object'),
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(profile_id,client_request_id))`,
  'CREATE INDEX IF NOT EXISTS s4ai_student_memos_recent_idx ON s4ai_student_memos(profile_id,created_at DESC,id DESC)',
];
const COLUMNS = 'id::text,profile_id,memo_text,memo_type,source::text,created_at::text,created_by_user_id::text';

export class ContinuityStoreError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const invalid = message => new ContinuityStoreError(400, 'CONTINUITY_INVALID', message);
const safe = async work => {
  try { return await work(); }
  catch (error) {
    if (error instanceof ContinuityStoreError) throw error;
    throw new ContinuityStoreError(503, 'CONTINUITY_UNAVAILABLE', 'Saved study notes are temporarily unavailable. Please try again later.');
  }
};
function profile(value) {
  if (typeof value !== 'string' || !PROFILE.test(value)) throw invalid('A valid learner workspace is required.');
  return value;
}
function cleanSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('The note source must be an object.');
  const result = {};
  for (const key of ['kind', 'subject', 'unitId', 'questionId']) {
    if (!Object.hasOwn(value, key) || value[key] == null || value[key] === '') continue;
    const item = value[key];
    const valid = typeof item === 'string' && (key === 'kind' ? KINDS.has(item)
      : key === 'subject' ? SUBJECTS.has(item) : /^[a-zA-Z0-9_.:-]{1,120}$/.test(item));
    if (!valid) throw invalid('Use a valid study-note source.');
    result[key] = item;
  }
  return result; // Unknown metadata, including any token or URL, is discarded.
}
function cleanText(value) {
  if (typeof value !== 'string') throw invalid('Enter a study note.');
  const text = value.trim();
  if (!text || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw invalid('Use 1 to 2,000 characters for a study note.');
  }
  // A guard against obvious accidental credential pastes, not a claim that
  // arbitrary sensitive data can be detected or made safe automatically.
  if (/\bBearer\s+[A-Za-z0-9._~-]{16,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\b(?:password|api[_ -]?(?:key|token)|access[_ -]?token)\s*[:=]\s*["']?[^\s"']{8,}/i.test(text)) {
    throw new ContinuityStoreError(400, 'CONTINUITY_SECRET', 'Do not save passwords or access tokens in study notes.');
  }
  return text;
}
function record(row) {
  return { id: row[0], profileId: row[1], text: row[2], type: row[3], source: cleanSource(JSON.parse(row[4])),
    createdAt: new Date(row[5]).toISOString(), createdByUserId: row[6] };
}

export function createContinuityStore({ query } = {}) {
  const run = query || ((sql, params = []) => {
    if (!process.env.DATABASE_URL) throw new Error('Account database is required.');
    return pgQuery(parseDatabaseUrl(process.env.DATABASE_URL), sql, params);
  });
  let initialized;
  const init = () => {
    if (!initialized) initialized = safe(async () => { for (const sql of SCHEMA) await run(sql); })
      .catch(error => { initialized = null; throw error; });
    return initialized;
  };
  const execute = async (sql, params) => { await init(); return run(sql, params); };
  return {
    init,
    async append({ profileId, createdByUserId, clientRequestId, text, type = 'student_note', source = {} } = {}) {
      return safe(async () => {
        profile(profileId);
        if (typeof createdByUserId !== 'string' || !UUID.test(createdByUserId) || typeof clientRequestId !== 'string' || !UUID.test(clientRequestId)) {
          throw invalid('A valid account and note request ID are required.');
        }
        if (!TYPES.has(type)) throw invalid('Choose a student note or saved coach note.');
        const note = cleanText(text), metadata = JSON.stringify(cleanSource(source));
        const rows = await execute(`INSERT INTO s4ai_student_memos(id,profile_id,created_by_user_id,client_request_id,memo_text,memo_type,source)
          VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7::jsonb)
          ON CONFLICT(profile_id,client_request_id) DO NOTHING RETURNING ${COLUMNS}`,
        [randomUUID(), profileId, createdByUserId, clientRequestId, note, type, metadata]);
        if (rows[0]) return { ...record(rows[0]), replayed: false };
        // A fresh statement sees the winning concurrent insert. A same-query
        // INSERT DO NOTHING + SELECT CTE can miss it under READ COMMITTED.
        const existing = await execute(`SELECT ${COLUMNS} FROM s4ai_student_memos
          WHERE profile_id=$1 AND client_request_id=$2::uuid AND memo_text=$3
          AND memo_type=$4 AND source=$5::jsonb AND created_by_user_id=$6::uuid`,
        [profileId, clientRequestId, note, type, metadata, createdByUserId]);
        if (!existing[0]) throw new ContinuityStoreError(409, 'CONTINUITY_CONFLICT', 'This save request already belongs to a different note. Start a new save request.');
        return { ...record(existing[0]), replayed: true };
      });
    },
    async list({ profileId, limit = 30, offset = 0 } = {}) {
      return safe(async () => {
        profile(profileId);
        if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
          throw invalid('Use a positive note limit and an offset from 0 to 100,000.');
        }
        const rows = await execute(`SELECT
          (SELECT count(*) FROM s4ai_student_memos WHERE profile_id=$1)::text,
          COALESCE((SELECT jsonb_agg(jsonb_build_array(id::text,profile_id,memo_text,memo_type,source::text,created_at::text,created_by_user_id::text)
            ORDER BY created_at DESC,id DESC) FROM (
              SELECT * FROM s4ai_student_memos WHERE profile_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2::integer OFFSET $3::integer
            ) recent),'[]'::jsonb)::text`, [profileId, Math.min(limit, 30), offset]);
        const totalCount = Number(rows[0]?.[0] || 0);
        const notes = JSON.parse(rows[0]?.[1] || '[]').map(record);
        return { notes, totalCount, omittedCount: Math.max(0, totalCount - offset - notes.length) };
      });
    },
  };
}
