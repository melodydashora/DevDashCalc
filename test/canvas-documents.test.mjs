import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { discoverCourseDocuments, enrichCourseDocuments, documentHtmlText, extractDocxText, extractDocumentText, extractPdfText } from '../canvas-documents.js';

const baseUrl = 'https://school.instructure.com';
const now = Date.parse('2026-10-10T16:00:00Z');
const course = overrides => ({ id: '42', name: 'Calculus', syllabusBody: '<a href="/courses/42/files/9/download?verifier=private">Fall syllabus</a>', ...overrides });
const file = overrides => ({ id: 9, course_id: 42, display_name: 'Fall syllabus.txt', filename: 'syllabus.txt', size: 50, url: `${baseUrl}/files/9/download?verifier=private`, updated_at: '2026-10-01T00:00:00Z', ...overrides });
const textResponse = (value = 'Unit 1 Test\tOctober 15, 2026') => new Response(value, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries, { method = 8, declaredSize, flags = 0 } = {}) {
  const local = [], directory = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const raw = Buffer.from(value), compressed = method === 8 ? deflateRawSync(raw) : raw, nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(raw), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(declaredSize ?? raw.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize ?? raw.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, compressed); directory.push(central, nameBytes); offset += header.length + nameBytes.length + compressed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}

test('discovers and deduplicates course syllabus files with separate source provenance', () => {
  const out = discoverCourseDocuments(course({
    pages: [{ id: '2', title: 'Week one', bodyHtml: `<a href="${baseUrl}/api/v1/courses/42/files/9">Syllabus</a><iframe src="https://docs.google.com/document/d/abcdefghijklmnop/preview"></iframe>` }],
    assignments: [{ id: '3', name: 'Homework', descriptionHtml: '<a href="/files/9">Instructions</a>' }],
    modules: [{ id: '4', items: [{ id: '5', type: 'File', contentId: '9', title: 'Course plan' }] }],
    files: [{ id: '7', displayName: 'Unlinked schedule.pdf' }, { id: '8', displayName: 'photo.png' }],
  }), { baseUrl });
  assert.equal(out.references.length, 3);
  const syllabus = out.references.find(ref => ref.id === '9');
  assert.equal(syllabus.provenance.length, 4);
  assert.equal(syllabus.url, `${baseUrl}/courses/42/files/9`);
  assert.doesNotMatch(JSON.stringify(out), /private|verifier/);
  assert.ok(out.references.some(ref => ref.id === '7'));
  assert.equal(out.references.find(ref => ref.type === 'google-document').url, 'https://docs.google.com/document/d/abcdefghijklmnop/edit');
});

test('untrusted links cannot discover another course, arbitrary hosts, local URLs, or credentials', () => {
  const links = [
    '/courses/99/files/9', 'https://attacker.example/files/9', 'http://school.instructure.com/files/9',
    'https://user:secret@school.instructure.com/files/9', 'https://school.instructure.com:444/files/9',
    'https://school.instructure.com.evil.example/files/9', 'https://127.0.0.1/files/9',
    'https://docs.google.com/document/d/abcdefghijklmnop/edit?token=secret',
  ];
  const out = discoverCourseDocuments(course({ syllabusBody: links.map(href => `<a href="${href}">Syllabus</a>`).join('') }), { baseUrl });
  assert.deepEqual(out.references, []);
  for (const base of ['http://school.instructure.com', 'https://localhost', 'https://192.168.1.1', 'https://127.1', 'https://school.local', 'https://school.instructure.com:4433']) {
    assert.throws(() => discoverCourseDocuments(course(), { baseUrl: base }));
  }
});

test('locked pages do not disclose links; discovered files remain indexed when the read budget is reached', async () => {
  const input = course({
    pages: [{ id: '1', title: 'Locked', lockedForUser: true, bodyHtml: '<a href="/files/8">Restricted</a>' }],
    files: [{ id: '7', displayName: 'Another schedule.pdf' }],
  });
  let reads = 0;
  const out = await enrichCourseDocuments(input, { baseUrl, now, maxDocuments: 1, getFileMetadata: async () => { reads++; return file(); }, fetchImpl: async () => textResponse() });
  assert.equal(reads, 1);
  assert.equal(out.documents.length, 2);
  assert.equal(out.documents[1].contentStatus, 'not-read');
  assert.equal(out.documentsTruncated, true);
  assert.equal(out.documentCollection.complete, false);
  assert.equal(input.documents, undefined, 'enrichment does not mutate the input');
});

test('authenticated metadata is course scoped but tokenless byte reads follow only allowlisted CDN redirects', async () => {
  const calls = [], metadataCalls = [];
  const out = await enrichCourseDocuments(course(), { baseUrl, now,
    getFileMetadata: async ref => { metadataCalls.push(ref); return file(); },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.inst-fs-iad-prod.inscloudgate.net/course/syllabus.txt?token=temporary' } }) : textResponse();
    },
  });
  assert.equal(metadataCalls[0].courseId, '42'); assert.equal(metadataCalls[0].fileId, '9');
  assert.equal(calls.length, 2);
  for (const { options } of calls) {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.cookie, undefined);
  }
  const doc = out.documents[0];
  assert.equal(doc.text, 'Unit 1 Test\tOctober 15, 2026'); assert.equal(doc.contentStatus, 'available');
  assert.equal(doc.updatedAt, '2026-10-01T00:00:00Z'); assert.equal(doc.readAt, new Date(now).toISOString());
  assert.doesNotMatch(JSON.stringify(doc), /temporary|private|verifier|inscloudgate/);
});

test('bad metadata, restricted files, and non-Canvas download locations never trigger a byte request', async () => {
  for (const meta of [file({ id: 99 }), file({ course_id: 99 }), file({ context_type: 'Course', context_id: 99 }), file({ locked_for_user: true }),
    file({ hidden_for_user: true }), file({ url: 'https://attacker.example/document.txt' }), file({ url: 'http://school.instructure.com/file.txt' }),
    file({ url: `${baseUrl}/files/9?access_token=secret` }), file({ url: 'https://files.instructure.com.attacker.example/file' }), file({ size: 9_000_000 })]) {
    let calls = 0;
    const out = await enrichCourseDocuments(course(), { baseUrl, now, getFileMetadata: async () => meta, fetchImpl: async () => { calls++; return textResponse(); } });
    assert.equal(calls, 0);
    assert.notEqual(out.documents[0].contentStatus, 'available');
    assert.equal(out.documents[0].text, null);
  }
});

test('cross-origin redirects to arbitrary URLs stop before requesting them and failed requests never expose URLs', async () => {
  for (const destination of ['https://attacker.example/file', 'http://127.0.0.1/file', 'https://files.instructure.com.attacker.example/file', 'https://school.instructure.com:444/file']) {
    let calls = 0;
    const out = await enrichCourseDocuments(course(), { baseUrl, now, getFileMetadata: async () => file(), fetchImpl: async () => {
      calls++; return new Response(null, { status: 307, headers: { location: destination } });
    } });
    assert.equal(calls, 1); assert.equal(out.documents[0].contentStatus, 'blocked');
    assert.doesNotMatch(JSON.stringify(out.documents), /attacker|127\.0\.0\.1/);
  }
  const out = await enrichCourseDocuments(course(), { baseUrl, now, getFileMetadata: async () => { throw new Error('secret token and URL'); } });
  assert.doesNotMatch(JSON.stringify(out.documents), /secret token/);
});

test('stream and Content-Length limits are enforced; metadata timeout is explicitly unread', async () => {
  for (const response of [new Response('abcdef', { headers: { 'content-type': 'text/plain' } }), new Response('abc', { headers: { 'content-length': '999', 'content-type': 'text/plain' } })]) {
    const out = await enrichCourseDocuments(course(), { baseUrl, now, maxBytes: 4, getFileMetadata: async () => file({ size: 0 }), fetchImpl: async () => response });
    assert.equal(out.documents[0].contentStatus, 'too-large'); assert.equal(out.documents[0].text, null);
  }
  const out = await enrichCourseDocuments(course(), { baseUrl, now, timeoutMs: 5, getFileMetadata: async () => new Promise(() => {}) });
  assert.equal(out.documents[0].contentStatus, 'unavailable');
  assert.equal(out.documentCollection.unread, 1);
});

test('HTML extraction retains schedule rows, entities and paragraphs without scripts', async () => {
  const html = '<h1>Syllabus &amp; calendar</h1><script>evil()</script><table><tr><td><p>Unit 1 Test</p></td><td>October 15, 2026</td></tr><tr><td>Essay</td><td>October 22, 2026</td></tr></table>';
  assert.equal(documentHtmlText(html), 'Syllabus & calendar\nUnit 1 Test\tOctober 15, 2026\nEssay\tOctober 22, 2026');
  const result = await extractDocumentText(Buffer.from(html), { contentType: 'text/html', filename: 'syllabus.html' });
  assert.equal(result.method, 'html-text'); assert.doesNotMatch(result.text, /evil|<table>/);
  const csv = await extractDocumentText(Buffer.from('Task,Due\nEssay,2026-10-22'), { contentType: 'text/csv' });
  assert.equal(csv.text, 'Task,Due\nEssay,2026-10-22');
});

test('DOCX XML preserves table cell relationships and ignores tracked deletions and field commands', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Fall Syllabus</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Unit 1 Test</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>October 15, 2026</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:del><w:r><w:t>Old date</w:t></w:r></w:del><w:instrText>HYPERLINK private</w:instrText></w:body></w:document>';
  for (const method of [0, 8]) {
    const result = extractDocxText(zip({ 'word/document.xml': xml, 'word/header1.xml': '<w:hdr><w:p><w:r><w:t>Fall 2026</w:t></w:r></w:p></w:hdr>' }, { method }));
    assert.match(result.text, /Unit 1 Test\tOctober 15, 2026/); assert.match(result.text, /Fall 2026/);
    assert.doesNotMatch(result.text, /Old date|HYPERLINK|private/); assert.equal(result.contentStatus, 'available');
  }
  const image = extractDocxText(zip({ 'word/document.xml': '<w:document><w:p><w:t>Read this</w:t><w:drawing/></w:p></w:document>' }));
  assert.equal(image.contentStatus, 'partial');
});

test('DOCX expansion bombs, encryption, unsupported methods, entities and damaged directory are rejected', () => {
  const xml = '<w:document><w:t>Example</w:t></w:document>';
  for (const archive of [
    zip({ 'word/document.xml': xml }, { declaredSize: 30_000_000 }),
    zip({ 'word/document.xml': xml }, { declaredSize: 1 }),
    zip({ 'word/document.xml': xml }, { flags: 1 }),
    zip({ 'word/document.xml': xml }, { method: 99 }),
    zip({ 'word/document.xml': '<!DOCTYPE a [<!ENTITY b SYSTEM "file:///etc/passwd">]><w:t>&b;</w:t>' }),
    zip({ 'word/document.xml': ' '.repeat(1_000_000) }),
    zip({ 'other.xml': xml }), Buffer.from('not a zip'),
  ]) assert.throws(() => extractDocxText(archive));
  const truncated = zip({ 'word/document.xml': xml }).subarray(0, -3);
  assert.throws(() => extractDocxText(truncated));
  const corrupt = zip({ 'word/document.xml': xml }, { method: 0 });
  corrupt[30 + 'word/document.xml'.length + 3] ^= 1;
  assert.throws(() => extractDocxText(corrupt), /integrity/);
});

test('format confusion, sign-in pages, invalid UTF-8, binaries, and unsupported office formats remain unread', async () => {
  for (const [bytes, opts] of [
    [Buffer.from('<html>Login</html>'), { contentType: 'text/html', filename: 'syllabus.pdf' }],
    [Buffer.from('<form><input type="password"></form>'), { contentType: 'text/html' }],
    [Buffer.from([255, 254, 0, 1]), { contentType: 'text/plain' }],
    [Buffer.from('a\0b'), { contentType: 'text/plain' }],
    [Buffer.from('legacy doc'), { contentType: 'application/msword' }],
    [Buffer.from('%PDF-1.4 fake'), { contentType: 'text/html' }],
  ]) await assert.rejects(extractDocumentText(bytes, opts));
});

test('PDF extraction is injected locally, reports scanned/partial text, and text bounds are explicit', async () => {
  let called = false;
  const result = await extractDocumentText(Buffer.from('%PDF-1.4 example'), { contentType: 'application/pdf', maxText: 5,
    pdfExtractor: async bytes => { called = bytes.toString().startsWith('%PDF'); return { text: 'Due October 15', contentStatus: 'partial', method: 'test-local', warnings: ['One scanned page unread.'] }; },
  });
  assert.equal(called, true); assert.equal(result.text, 'Due O'); assert.equal(result.contentStatus, 'truncated');
  assert.equal(result.warnings.length, 2);
  const unread = await extractDocumentText(Buffer.from('%PDF-1.4 example'), { contentType: 'application/pdf', pdfExtractor: async () => ({ text: '', contentStatus: 'unread', method: 'test-local', warnings: ['OCR not available.'] }) });
  assert.equal(unread.contentStatus, 'unread'); assert.equal(unread.text, '');
});

test('local Poppler extracts a real PDF text layer when available, otherwise states its absence', async t => {
  const stream = 'BT /F1 12 Tf 72 720 Td (Unit 1 Test due October 15, 2026) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  try {
    const result = await extractPdfText(Buffer.from(pdf));
    assert.match(result.text, /Unit 1 Test due October 15, 2026/); assert.equal(result.method, 'pdftotext');
  } catch (error) {
    if (error.documentStatus === 'unsupported' && /unavailable on this server/.test(error.message)) t.skip('Optional pdftotext binary is not installed.');
    else throw error;
  }
});

test('observed public Google docs use public export with provenance and explicit limitations', async () => {
  const out = await enrichCourseDocuments(course({ syllabusBody: '<a href="https://docs.google.com/document/d/abcdefghijklmnop/edit">Syllabus</a>' }), { baseUrl, now, fetchImpl: async (url, options) => {
    assert.match(url, /\/export\?format=txt$/); assert.equal(options.credentials, 'omit'); return textResponse();
  } });
  assert.equal(out.documents[0].source, 'google-document'); assert.equal(out.documents[0].extraction, 'public-google-text');
  assert.equal(out.documents[0].provenance[0].type, 'syllabus'); assert.match(out.documents[0].warnings[0], /images/);
});

test('zero budgets discover without requests, and subsequent passes progress beyond the first document', async () => {
  const input = course({ syllabusBody: '', files: Array.from({ length: 3 }, (_, n) => ({ id: String(n + 1), displayName: `schedule-${n + 1}.txt`, filename: `schedule-${n + 1}.txt`, size: 50, updatedAt: '2026-10-01T00:00:00Z' })) });
  const calls = [];
  const options = { baseUrl, now, maxDocuments: 1, getFileMetadata: async ({ fileId }) => { calls.push(fileId); return file({ id: Number(fileId), display_name: `schedule-${fileId}.txt`, filename: `schedule-${fileId}.txt` }); }, fetchImpl: async () => textResponse() };
  const zero = await enrichCourseDocuments(input, { ...options, maxDocuments: 0 });
  assert.equal(zero.documents.length, 3); assert.equal(calls.length, 0); assert.equal(zero.documentCollection.attempted, 0);
  const zeroTime = await enrichCourseDocuments(input, { ...options, courseTimeoutMs: 0 });
  assert.equal(calls.length, 0); assert.equal(zeroTime.documents[0].contentStatus, 'not-read');
  let previousDocuments = zero.documents;
  for (let pass = 0; pass < 3; pass++) {
    const output = await enrichCourseDocuments(input, { ...options, now: now + pass * 1000, previousDocuments });
    assert.equal(output.documentCollection.attempted, 1);
    previousDocuments = output.documents;
  }
  assert.deepEqual(calls, ['1', '2', '3']);
  assert.ok(previousDocuments.every(doc => doc.contentStatus === 'available'));
  const cached = await enrichCourseDocuments(input, { ...options, now: now + 3000, previousDocuments });
  assert.equal(cached.documentCollection.attempted, 0); assert.equal(cached.documentCollection.cacheHits, 3);
  assert.equal(calls.length, 3);
});

test('source or file revisions invalidate reusable document text, and current locks remove cached bodies', async () => {
  const fileIndex = { id: '9', displayName: 'Fall syllabus.txt', filename: 'syllabus.txt', size: 50, updatedAt: '2026-10-01T00:00:00Z' };
  const input = course({ files: [fileIndex] });
  let downloads = 0;
  const options = { baseUrl, now, getFileMetadata: async () => file(), fetchImpl: async () => { downloads++; return textResponse(); } };
  const first = await enrichCourseDocuments(input, options);
  await enrichCourseDocuments(input, { ...options, previousDocuments: first.documents });
  assert.equal(downloads, 1);
  await enrichCourseDocuments({ ...input, syllabusBody: `${input.syllabusBody}<p>Updated schedule</p>` }, { ...options, previousDocuments: first.documents });
  assert.equal(downloads, 2);
  const changed = { ...input, files: [{ ...fileIndex, updatedAt: '2026-10-02T00:00:00Z' }] };
  await enrichCourseDocuments(changed, { ...options, previousDocuments: first.documents, getFileMetadata: async () => file({ updated_at: '2026-10-02T00:00:00Z' }) });
  assert.equal(downloads, 3);
  const locked = await enrichCourseDocuments({ ...input, files: [{ ...fileIndex, lockedForUser: true }] }, { ...options, previousDocuments: first.documents });
  assert.equal(locked.documents[0].contentStatus, 'restricted'); assert.equal(locked.documents[0].text, null);
  assert.equal(downloads, 3);
});

test('without file index revisions, previous text remains pending and is reused only after metadata validation', async () => {
  let downloads = 0, metadataReads = 0;
  const options = { baseUrl, now, getFileMetadata: async () => { metadataReads++; return file(); }, fetchImpl: async () => { downloads++; return textResponse(); } };
  const first = await enrichCourseDocuments(course(), options);
  const pending = await enrichCourseDocuments(course(), { ...options, maxDocuments: 0, previousDocuments: first.documents });
  assert.equal(pending.documents[0].text, first.documents[0].text); assert.equal(pending.documents[0].contentStatus, 'not-read');
  assert.equal(pending.documents[0].previousContentStatus, 'available');
  const validated = await enrichCourseDocuments(course(), { ...options, previousDocuments: pending.documents });
  assert.equal(validated.documents[0].contentStatus, 'available'); assert.equal(validated.documents[0].previousContentStatus, null);
  assert.equal(downloads, 1); assert.equal(metadataReads, 2);
});

test('transient failures rotate behind never-read references and do not starve later files', async () => {
  const input = course({ syllabusBody: '<a href="/files/1">syllabus 1</a><a href="/files/2">syllabus 2</a><a href="/files/3">syllabus 3</a>' });
  const calls = []; let previousDocuments = [];
  for (let pass = 0; pass < 4; pass++) {
    const out = await enrichCourseDocuments(input, { baseUrl, now: now + pass * 1000, maxDocuments: 1, previousDocuments,
      getFileMetadata: async ({ fileId }) => { calls.push(fileId); throw new Error('temporary failure'); },
    });
    previousDocuments = out.documents;
  }
  assert.deepEqual(calls, ['1', '2', '3', '1']);
});
