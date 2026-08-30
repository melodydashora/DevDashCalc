// store.js — zero-dependency Postgres persistence for Calc Coach.
//
// Replit provides a Postgres DATABASE_URL in both environments (the dev
// database, host "helium", and the production deploy's database). This file
// speaks the Postgres wire protocol directly over node:net / node:tls with
// SCRAM-SHA-256 auth from node:crypto, so the no-`npm install` guarantee
// (CLAUDE.md invariant 6) holds. It exposes a tiny key→JSON store; server.js
// keeps the data/ files as the zero-config fallback and local mirror.
//
// One connection per operation, deliberately: this is a single-learner app
// with debounced writes, and skipping pooling removes a whole class of
// failure modes. The pure helpers (URL parsing, SCRAM math) are exported for
// tests; nothing here touches the filesystem.

import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const STORE_TABLE = 'calc_coach_store';
const KEY_RE = /^[a-z0-9-]{1,64}$/;
const DB_TIMEOUT_MS = 10_000;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function parseDatabaseUrl(raw) {
  const url = new URL(String(raw));
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
  }
  return {
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: decodeURIComponent(url.username) || 'postgres',
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    // libpq semantics: require = encrypt without CA verification;
    // verify-ca / verify-full = verify. prefer/allow/disable tolerate plaintext.
    sslmode: url.searchParams.get('sslmode') || 'prefer',
  };
}

// ------------------------------------------------------------------- SCRAM
// RFC 5802 / RFC 7677. Pure math, pinned by the RFC 7677 test vector in
// test/store.test.mjs.
// Postgres sends an empty SCRAM username (the real one travels in the
// startup message); the parameter exists so tests can reproduce the RFC
// vector, which uses a literal username.
export function scramClientFirstBare(nonce, username = '') {
  return `n=${username},r=${nonce}`;
}

export function scramParseServerFirst(text) {
  const fields = Object.fromEntries(String(text).split(',').map((part) => [part.slice(0, 1), part.slice(2)]));
  const iterations = Number(fields.i);
  if (!fields.r || !fields.s || !Number.isInteger(iterations) || iterations < 1) {
    throw new Error('malformed SCRAM server-first message');
  }
  return { nonce: fields.r, saltB64: fields.s, iterations };
}

export function scramProof(password, saltB64, iterations, authMessage) {
  const salted = pbkdf2Sync(password, Buffer.from(saltB64, 'base64'), iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
  const proof = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 1) proof[i] = clientKey[i] ^ clientSignature[i];
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  const serverSignature = createHmac('sha256', serverKey).update(authMessage).digest();
  return { proofB64: proof.toString('base64'), serverSignatureB64: serverSignature.toString('base64') };
}

// ---------------------------------------------------------- wire encoding
const cstr = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);

function frame(type, body) {
  const out = Buffer.alloc(1 + 4 + body.length);
  out.write(type, 0, 'latin1');
  out.writeUInt32BE(body.length + 4, 1);
  body.copy(out, 5);
  return out;
}

function startupMessage(user, database) {
  const body = Buffer.concat([
    Buffer.from([0, 3, 0, 0]), // protocol 3.0
    cstr('user'), cstr(user),
    cstr('database'), cstr(database),
    Buffer.from([0]),
  ]);
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32BE(body.length + 4, 0);
  body.copy(out, 4);
  return out;
}

const SSL_REQUEST = (() => {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(8, 0);
  b.writeUInt32BE(80877103, 4);
  return b;
})();

function bindExecute(sql, params) {
  const parse = frame('P', Buffer.concat([cstr(''), cstr(sql), Buffer.from([0, 0])]));
  const parts = [cstr(''), cstr(''), Buffer.from([0, 0])]; // portal, statement, all-text param formats
  const count = Buffer.alloc(2);
  count.writeUInt16BE(params.length, 0);
  parts.push(count);
  for (const p of params) {
    const bytes = Buffer.from(String(p), 'utf8');
    const len = Buffer.alloc(4);
    len.writeInt32BE(bytes.length, 0);
    parts.push(len, bytes);
  }
  parts.push(Buffer.from([0, 0])); // all-text result formats
  const bind = frame('B', Buffer.concat(parts));
  const execute = frame('E', Buffer.concat([cstr(''), Buffer.from([0, 0, 0, 0])]));
  return Buffer.concat([parse, bind, execute, frame('S', Buffer.alloc(0))]);
}

function md5Password(user, password, salt) {
  const inner = createHash('md5').update(password + user).digest('hex');
  return `md5${createHash('md5').update(Buffer.concat([Buffer.from(inner, 'utf8'), salt])).digest('hex')}`;
}

// ------------------------------------------------------------- connection
function pgError(fields) {
  const map = {};
  let i = 0;
  while (i < fields.length && fields[i] !== 0) {
    const code = String.fromCharCode(fields[i]);
    const end = fields.indexOf(0, i + 1);
    map[code] = fields.toString('utf8', i + 1, end);
    i = end + 1;
  }
  return new Error(`postgres ${map.C || ''}: ${map.M || 'unknown error'}`.slice(0, 300));
}

// Runs one SQL statement with text-format parameters over a fresh
// connection and resolves with the data rows (arrays of string|null).
export function pgQuery(cfg, sql, params = []) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let socket = netConnect({ host: cfg.host, port: cfg.port });
    let buffer = Buffer.alloc(0);
    let phase = 'ssl';
    let scram = null;
    let queryError = null;
    let settled = false;

    const fail = (e) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(e);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      try { socket.write(frame('X', Buffer.alloc(0))); } catch { /* closing anyway */ }
      socket.end();
      if (queryError) reject(queryError);
      else resolve(rows);
    };

    const arm = (s) => {
      s.setTimeout(DB_TIMEOUT_MS, () => fail(new Error('database timed out')));
      s.on('error', (e) => fail(e));
      s.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try { drain(); } catch (e) { fail(e); }
      });
    };

    const startAuth = () => {
      socket.write(startupMessage(cfg.user, cfg.database));
      phase = 'auth';
    };

    const drain = () => {
      if (phase === 'ssl') {
        if (buffer.length < 1) return;
        const answer = String.fromCharCode(buffer[0]);
        buffer = buffer.subarray(1);
        if (answer === 'S') {
          const verify = cfg.sslmode === 'verify-ca' || cfg.sslmode === 'verify-full';
          const plain = socket;
          plain.removeAllListeners('data');
          plain.removeAllListeners('error');
          plain.setTimeout(0);
          socket = tlsConnect({ socket: plain, servername: cfg.host, rejectUnauthorized: verify }, () => startAuth());
          arm(socket);
          phase = 'auth';
          return;
        }
        if (answer === 'N') {
          if (cfg.sslmode === 'require' || cfg.sslmode === 'verify-ca' || cfg.sslmode === 'verify-full') {
            throw new Error('server does not support TLS but sslmode requires it');
          }
          startAuth();
        } else {
          throw new Error('unexpected reply to SSLRequest');
        }
      }

      while (buffer.length >= 5) {
        const type = String.fromCharCode(buffer[0]);
        const length = buffer.readUInt32BE(1);
        if (buffer.length < 1 + length) return;
        const body = buffer.subarray(5, 1 + length);
        buffer = buffer.subarray(1 + length);

        if (type === 'E') {
          const err = pgError(body);
          if (phase === 'query') { queryError = queryError || err; continue; }
          throw err;
        }
        if (type === 'R') {
          const code = body.readUInt32BE(0);
          if (code === 0) continue; // AuthenticationOk
          if (code === 3) { socket.write(frame('p', cstr(cfg.password))); continue; }
          if (code === 5) { socket.write(frame('p', cstr(md5Password(cfg.user, cfg.password, body.subarray(4, 8))))); continue; }
          if (code === 10) {
            const nonce = randomBytes(18).toString('base64');
            scram = { nonce, firstBare: scramClientFirstBare(nonce) };
            const initial = Buffer.from(`n,,${scram.firstBare}`, 'utf8');
            const len = Buffer.alloc(4);
            len.writeInt32BE(initial.length, 0);
            socket.write(frame('p', Buffer.concat([cstr('SCRAM-SHA-256'), len, initial])));
            continue;
          }
          if (code === 11) {
            const serverFirst = body.subarray(4).toString('utf8');
            const parsed = scramParseServerFirst(serverFirst);
            if (!parsed.nonce.startsWith(scram.nonce)) throw new Error('SCRAM nonce mismatch');
            const withoutProof = `c=biws,r=${parsed.nonce}`;
            const authMessage = `${scram.firstBare},${serverFirst},${withoutProof}`;
            const { proofB64, serverSignatureB64 } = scramProof(cfg.password, parsed.saltB64, parsed.iterations, authMessage);
            scram.expectedServerSignature = serverSignatureB64;
            socket.write(frame('p', Buffer.from(`${withoutProof},p=${proofB64}`, 'utf8')));
            continue;
          }
          if (code === 12) {
            const final = body.subarray(4).toString('utf8');
            if (final !== `v=${scram.expectedServerSignature}`) throw new Error('SCRAM server signature mismatch');
            continue;
          }
          throw new Error(`unsupported auth method ${code}`);
        }
        if (type === 'Z') {
          if (phase === 'auth') {
            phase = 'query';
            socket.write(bindExecute(sql, params));
          } else {
            done();
            return;
          }
          continue;
        }
        if (type === 'D' && phase === 'query') {
          const columnCount = body.readUInt16BE(0);
          let offset = 2;
          const row = [];
          for (let c = 0; c < columnCount; c += 1) {
            const len = body.readInt32BE(offset);
            offset += 4;
            if (len === -1) { row.push(null); continue; }
            row.push(body.toString('utf8', offset, offset + len));
            offset += len;
          }
          rows.push(row);
        }
        // 'S' ParameterStatus, 'K' BackendKeyData, 'N' Notice, '1' Parse-
        // Complete, '2' BindComplete, 'C' CommandComplete, 'T' RowDescription
        // and anything else carry nothing this store needs.
      }
    };

    arm(socket);
    socket.on('connect', () => socket.write(SSL_REQUEST));
  });
}

// ------------------------------------------------------------ key→JSON API
let ensurePromise = null;

function config() {
  return parseDatabaseUrl(process.env.DATABASE_URL);
}

function ensureTable(cfg) {
  if (!ensurePromise) {
    ensurePromise = pgQuery(cfg,
      `CREATE TABLE IF NOT EXISTS ${STORE_TABLE} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      .catch((e) => { ensurePromise = null; throw e; });
  }
  return ensurePromise;
}

function checkKey(key) {
  if (!KEY_RE.test(String(key))) throw new Error('invalid store key');
  return String(key);
}

export async function dbGet(key) {
  const cfg = config();
  await ensureTable(cfg);
  const rows = await pgQuery(cfg, `SELECT value FROM ${STORE_TABLE} WHERE key = $1`, [checkKey(key)]);
  if (!rows.length || rows[0][0] === null) return null;
  try { return JSON.parse(rows[0][0]); } catch { return null; }
}

export async function dbSet(key, value) {
  const cfg = config();
  await ensureTable(cfg);
  await pgQuery(cfg,
    `INSERT INTO ${STORE_TABLE} (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [checkKey(key), JSON.stringify(value)]);
}

export async function dbDelete(key) {
  const cfg = config();
  await ensureTable(cfg);
  await pgQuery(cfg, `DELETE FROM ${STORE_TABLE} WHERE key = $1`, [checkKey(key)]);
}
