import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../store.js';

// The pure pieces of the zero-dependency Postgres client. The live wire
// protocol is exercised against the real database in development; these
// tests pin the math and parsing that production auth depends on.

test('parseDatabaseUrl reads host, port, credentials, database, and sslmode', () => {
  const cfg = S.parseDatabaseUrl('postgresql://someuser:s%40crt@db.example.com:6543/mydb?sslmode=require');
  assert.deepEqual(cfg, {
    host: 'db.example.com',
    port: 6543,
    user: 'someuser',
    password: 's@crt',
    database: 'mydb',
    sslmode: 'require',
  }, 'every component is decoded');
});

test('parseDatabaseUrl applies postgres defaults and rejects other schemes', () => {
  const cfg = S.parseDatabaseUrl('postgres://u@h');
  assert.equal(cfg.port, 5432, 'default port');
  assert.equal(cfg.database, 'postgres', 'default database');
  assert.equal(cfg.sslmode, 'prefer', 'default sslmode');
  assert.throws(() => S.parseDatabaseUrl('mysql://u@h/db'), /postgres/, 'non-postgres schemes are refused');
  assert.throws(() => S.parseDatabaseUrl('not a url'));
});

test('scramParseServerFirst extracts nonce, salt, and iterations, and rejects garbage', () => {
  const parsed = S.scramParseServerFirst('r=abcdef,s=c2FsdA==,i=4096');
  assert.deepEqual(parsed, { nonce: 'abcdef', saltB64: 'c2FsdA==', iterations: 4096 });
  assert.throws(() => S.scramParseServerFirst('r=x,s=y'), /malformed/, 'missing iteration count');
  assert.throws(() => S.scramParseServerFirst('i=0,r=x,s=y'), /malformed/, 'zero iterations');
});

test('scramProof reproduces the RFC 7677 SCRAM-SHA-256 test vector', () => {
  // RFC 7677 section 3: user "user", password "pencil".
  const clientNonce = 'rOprNGfwEbeRWgbNEkqO';
  const serverFirst = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
  const parsed = S.scramParseServerFirst(serverFirst);
  assert.equal(parsed.iterations, 4096);
  const firstBare = S.scramClientFirstBare(clientNonce, 'user');
  assert.equal(firstBare, 'n=user,r=rOprNGfwEbeRWgbNEkqO');
  assert.equal(S.scramClientFirstBare(clientNonce), 'n=,r=rOprNGfwEbeRWgbNEkqO', 'postgres uses an empty SCRAM username');
  const withoutProof = `c=biws,r=${parsed.nonce}`;
  const authMessage = `${firstBare},${serverFirst},${withoutProof}`;
  const { proofB64, serverSignatureB64 } = S.scramProof('pencil', parsed.saltB64, parsed.iterations, authMessage);
  assert.equal(proofB64, 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'client proof matches the RFC');
  assert.equal(serverSignatureB64, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=', 'server signature matches the RFC');
});

test('a clean connection close rejects the query instead of hanging', async () => {
  // A server shutdown or a proxy's idle reaper sends a FIN with no error
  // event; the client must reject promptly, not wait out (or lose) the
  // inactivity timer. Simulated with a real socket: answer the SSLRequest
  // with N, swallow the startup message, then close cleanly.
  const { createServer } = await import('node:net');
  const srv = createServer((sock) => {
    sock.once('data', () => {
      sock.write('N');
      sock.once('data', () => sock.end());
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const cfg = { host: '127.0.0.1', port: srv.address().port, user: 'u', password: '', database: 'd', sslmode: 'disable' };
  await assert.rejects(S.pgQuery(cfg, 'SELECT 1'), /closed/, 'a clean FIN rejects with a closed-connection error');
  srv.close();
});

test('hasDatabase reflects whether DATABASE_URL is set', () => {
  const original = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://u@h/db';
    assert.equal(S.hasDatabase(), true);
    delete process.env.DATABASE_URL;
    assert.equal(S.hasDatabase(), false);
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});
