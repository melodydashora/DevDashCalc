// Course-scoped document discovery and local text extraction. Source material
// is untrusted data. Downloads never receive Canvas credentials; their temporary
// signed URLs never become source links, persisted metadata, or error messages.
import { inflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { googleDocumentLink, readLinkedDocument } from './linked-documents.js';

const execFileAsync = promisify(execFile);
export const CANVAS_DOCUMENT_LIMITS = Object.freeze({
  documents: 12, discovered: 500, bytes: 8 * 1024 * 1024, text: 250_000,
  timeoutMs: 15_000, courseTimeoutMs: 45_000, zipEntries: 2048, expandedBytes: 20 * 1024 * 1024,
});
const list = value => Array.isArray(value) ? value : [];
const id = value => (typeof value === 'string' || Number.isSafeInteger(value)) && /^[0-9]{1,20}$/.test(String(value)) ? String(value) : null;
const label = value => typeof value === 'string' ? value.slice(0, 500) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const bounded = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
const budget = (value, fallback, max) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_STATES = new Set(['available', 'empty', 'partial', 'truncated', 'unread']);
const syllabusTitle = value => /syllab|schedule|calendar|pacing|course\s+(?:outline|plan|guide)|due\s+dates/i.test(value || '');
const fail = (status, reason) => Object.assign(new Error(reason), { documentStatus: status });

function checkedBase(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('A public HTTPS Canvas origin is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/i.test(url.hostname)) {
    throw new TypeError('A public HTTPS Canvas origin is required.');
  }
  return url.origin;
}

function decodeEntities(value) {
  const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (all, code) => {
    if (code[0] !== '#') return names[code.toLowerCase()] ?? all;
    const cp = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ' ';
  });
}

export function documentHtmlText(value) {
  if (typeof value !== 'string') return '';
  return decodeEntities(value.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/(?:td|th)\s*>/gi, '\t').replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|table|section|article)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\r\n?/g, '\n').replace(/[ \u00a0]+/g, ' ')
    .replace(/ *\n+ *\t/g, '\t').replace(/ *\t */g, '\t')
    .replace(/\t+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sourceOf(type, row, courseId, base) {
  const sourceId = id(row?.id ?? row?.page_id) || label(row?.pageUrl ?? row?.url) || courseId;
  // Source URLs are deliberately canonical, with no downloaded-file tokens.
  const paths = { assignment: 'assignments', page: 'pages', discussion: 'discussion_topics', announcement: 'discussion_topics', quiz: 'quizzes', file: 'files' };
  const path = type === 'syllabus' ? 'assignments/syllabus'
    : `${paths[type] || 'modules/items'}/${encodeURIComponent(sourceId)}`;
  return { type, id: sourceId, title: label(row?.title ?? row?.name ?? row?.displayName ?? row?.display_name), url: `${base}/courses/${courseId}/${path}`, updatedAt: date(row?.updatedAt ?? row?.updated_at) };
}

function fileVersion(file) {
  const updatedAt = date(file?.updatedAt ?? file?.updated_at);
  // Size alone does not establish a version: many teachers replace a file with
  // an equally sized revision. Without a timestamp, revalidate metadata.
  return updatedAt ? hash([id(file?.id), updatedAt, Number.isFinite(Number(file?.size)) ? Number(file.size) : null,
    label(file?.filename ?? file?.displayName ?? file?.display_name ?? file?.name)]) : null;
}

// Only already-collected course content supplies references. This function
// does not accept a caller-provided URL to fetch or follow external web links.
export function discoverCourseDocuments(course, { baseUrl } = {}) {
  const base = checkedBase(baseUrl), courseId = id(course?.id);
  if (!courseId) throw new TypeError('A numeric Canvas course ID is required.');
  const refs = new Map();
  let truncated = false, scanned = 0;
  function add(ref, source) {
    const key = `${ref.type}:${ref.id}`;
    let entry = refs.get(key);
    if (!entry) {
      if (refs.size >= CANVAS_DOCUMENT_LIMITS.discovered) { truncated = true; return; }
      entry = { ...ref, courseId, provenance: [], priority: syllabusTitle(ref.title) ? 2 : 0 };
      refs.set(key, entry);
    }
    if (source.type === 'syllabus' || syllabusTitle(source.title)) entry.priority = Math.max(entry.priority, 3);
    if (!entry.provenance.some(p => p.type === source.type && p.id === source.id)) {
      if (entry.provenance.length < 40) entry.provenance.push(source);
      else entry.provenanceTruncated = true;
    }
  }
  function addLink(value, title, source) {
    let url;
    try { url = new URL(decodeEntities(value), base); } catch { return; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    const google = googleDocumentLink(url.href);
    if (google) { add({ type: 'google-document', id: google.id, title: label(title) || 'Linked Google document', url: google.href }, source); return; }
    if (url.origin !== base) return;
    const match = /^(?:\/api\/v1)?\/(?:courses\/([0-9]{1,20})\/)?files\/([0-9]{1,20})(?:\/(?:download|preview))?\/?$/.exec(url.pathname);
    if (!match || match[1] && match[1] !== courseId) return;
    add({ type: 'canvas-file', id: match[2], title: label(title) || `Course document ${match[2]}`, url: `${base}/courses/${courseId}/files/${match[2]}` }, source);
  }
  function scan(type, row, body) {
    if (++scanned > 10_000) { truncated = true; return; }
    if (row?.lockedForUser === true || row?.locked_for_user === true || row?.published === false) return;
    const source = sourceOf(type, row, courseId, base);
    const rawBody = typeof body === 'string' ? body : '';
    if (rawBody.length > 1_000_000) truncated = true;
    const html = rawBody.slice(0, 1_000_000);
    source.revision = hash([source.updatedAt, html]);
    // Anchors retain their descriptive labels. Embedded documents and Canvas
    // data-api-endpoint attributes are also encountered in instructor pages.
    for (const anchor of html.matchAll(/<a\b([^>]{0,8192})>([\s\S]{0,8192}?)<\/a\s*>/gi)) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(anchor[1]);
      if (href) addLink(href[1] ?? href[2] ?? href[3], documentHtmlText(anchor[2]) || source.title, source);
    }
    for (const attr of html.matchAll(/\b(?:href|src|data-api-endpoint)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) addLink(attr[1] ?? attr[2] ?? attr[3], source.title, source);
    for (const key of ['externalUrl', 'external_url', 'htmlUrl', 'html_url']) if (typeof row?.[key] === 'string') addLink(row[key], source.title, source);
    if (type === 'module-item' && String(row?.type).toLowerCase() === 'file') {
      const fileId = id(row.contentId ?? row.content_id);
      if (fileId) add({ type: 'canvas-file', id: fileId, title: source.title, url: `${base}/courses/${courseId}/files/${fileId}` }, source);
    }
  }
  scan('syllabus', { id: courseId, title: `${label(course.name)} syllabus` }, course.syllabusBody ?? course.syllabusBodyHtml ?? course.syllabus_body);
  if (course.frontPage) scan('page', course.frontPage, course.frontPage.bodyHtml ?? course.frontPage.body);
  for (const [key, type] of [['pages', 'page'], ['assignments', 'assignment'], ['discussions', 'discussion'], ['announcements', 'announcement'], ['quizzes', 'quiz']]) {
    for (const row of list(course[key]).slice(0, 10_000)) scan(type, row, row?.bodyHtml ?? row?.descriptionHtml ?? row?.body ?? row?.description ?? row?.message);
    if (list(course[key]).length > 10_000) truncated = true;
  }
  for (const module of list(course.modules).slice(0, 1000)) for (const item of list(module?.items).slice(0, 1000)) scan('module-item', item, null);
  for (const file of list(course.files).slice(0, 10_000)) {
    const fileId = id(file?.id), title = label(file?.displayName ?? file?.display_name ?? file?.filename ?? file?.name);
    if (!fileId) continue;
    // Unlinked syllabus/schedule documents and conventional readable documents
    // are indexed too; media and unrelated binaries remain in the file index.
    if (syllabusTitle(title) || /\.(?:pdf|docx|txt|html?|csv|tsv|md)$/i.test(title)) {
      add({ type: 'canvas-file', id: fileId, title, url: `${base}/courses/${courseId}/files/${fileId}` }, sourceOf('file', file, courseId, base));
    }
    const ref = refs.get(`canvas-file:${fileId}`);
    if (ref) {
      ref.fileVersion = fileVersion(file);
      ref.restricted = file.lockedForUser === true || file.locked_for_user === true || file.hiddenForUser === true || file.hidden_for_user === true || file.published === false;
    }
  }
  if (list(course.modules).length > 1000 || list(course.modules).some(module => list(module?.items).length > 1000) || list(course.files).length > 10_000) truncated = true;
  for (const ref of refs.values()) ref.sourceFingerprint = hash([ref.type, ref.id, ref.courseId, ref.title,
    ref.provenance.map(source => [source.type, source.id, source.updatedAt, source.revision]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  return { references: [...refs.values()].sort((a, b) => b.priority - a.priority), truncated };
}

function downloadUrl(value, base) {
  let url;
  try { url = new URL(value); } catch { throw fail('blocked', 'Canvas did not provide an allowed HTTPS download location.'); }
  const cdn = /^(?:[a-z0-9-]+\.)?files\.instructure\.com$/i.test(url.hostname)
    || /^(?:cdn\.)?inst-fs-[a-z0-9-]+\.inscloudgate\.net$/i.test(url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.origin === base || cdn)) {
    throw fail('blocked', 'The document download location is outside the allowed Canvas file hosts.');
  }
  // Some file URLs legitimately use verifier or CDN token parameters. They are
  // used transiently only. An OAuth access token must never enter a URL.
  if ([...url.searchParams.keys()].some(key => /^(?:access_token|api_key|authorization)$/i.test(key))) throw fail('blocked', 'A document download URL contained an application credential.');
  return url;
}

async function downloadFile(value, { base, fetchImpl, maxBytes, timeoutMs }) {
  let url = downloadUrl(value, base);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal, headers: { accept: 'application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain, text/html, text/csv, application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw fail('unavailable', 'The document redirect had no destination.');
      // Validate before issuing the next request. Never use automatic redirects.
      url = downloadUrl(new URL(location, url).href, base);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw fail([401, 403].includes(response.status) ? 'restricted' : 'unavailable', 'Canvas did not make this document available to the connected learner.'); }
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > maxBytes) { await response.body?.cancel(); throw fail('too-large', 'The document exceeds the download size limit.'); }
    const reader = response.body?.getReader();
    if (!reader) throw fail('unavailable', 'The document had no downloadable body.');
    const chunks = []; let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw fail('too-large', 'The document exceeds the download size limit.'); }
      chunks.push(next.value);
    }
    return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') || '' };
  }
  throw fail('unavailable', 'The document exceeded the redirect limit.');
}

function utf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw fail('unsupported', 'This text document is not valid UTF-8. Its contents have not been read.'); }
}

function xmlText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('unsupported', 'Document XML with entity declarations is not supported.');
  // Deleted tracked-change text and field instructions are not current prose.
  return decodeEntities(xml.replace(/<w:(?:del|instrText)\b[^>]*>[\s\S]*?<\/w:(?:del|instrText)>/g, '')
    .replace(/<w:(?:tab)\b[^>]*\/>/g, '\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t').replace(/<\/w:(?:p|tr)>/g, '\n').replace(/<[^>]*>/g, ''))
    .replace(/ *\n+ *\t/g, '\t').replace(/\t+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Read ZIP entries in memory; never extract filesystem paths, run macros,
// follow relationships, or expand arbitrary embedded objects. Central-directory
// sizes, actual inflation size, methods and local headers are all checked.
export function extractDocxText(bytes) {
  const zip = Buffer.from(bytes);
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65_557); offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50 && offset + 22 + zip.readUInt16LE(offset + 20) === zip.length) { end = offset; break; }
  }
  if (end < 0) throw fail('unsupported', 'This Word document is not a supported DOCX archive.');
  const entries = zip.readUInt16LE(end + 10), centralSize = zip.readUInt32LE(end + 12), centralOffset = zip.readUInt32LE(end + 16);
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== entries
    || entries > CANVAS_DOCUMENT_LIMITS.zipEntries || centralOffset + centralSize !== end) throw fail('unsupported', 'The DOCX archive structure exceeds supported limits.');
  let pos = centralOffset, expanded = 0; const selected = new Map();
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > end || zip.readUInt32LE(pos) !== 0x02014b50) throw fail('unsupported', 'The DOCX archive has an invalid directory.');
    const flags = zip.readUInt16LE(pos + 8), method = zip.readUInt16LE(pos + 10);
    const expectedCrc = zip.readUInt32LE(pos + 16), compressed = zip.readUInt32LE(pos + 20), size = zip.readUInt32LE(pos + 24), nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30), commentLen = zip.readUInt16LE(pos + 32), offset = zip.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen + extraLen + commentLen > end) throw fail('unsupported', 'The DOCX directory was truncated.');
    const name = zip.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;
    expanded += size;
    if (flags & 0x41 || ![0, 8].includes(method) || expanded > CANVAS_DOCUMENT_LIMITS.expandedBytes
      || size > CANVAS_DOCUMENT_LIMITS.expandedBytes || compressed > zip.length || (compressed && size / compressed > 200)) throw fail('too-large', 'The DOCX archive is encrypted or exceeds safe expansion limits.');
    if (!/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name)) continue;
    if (selected.has(name) || offset + 30 > centralOffset || zip.readUInt32LE(offset) !== 0x04034b50
      || zip.readUInt16LE(offset + 6) !== flags || zip.readUInt16LE(offset + 8) !== method) throw fail('unsupported', 'The DOCX entry headers do not match.');
    const localNameLen = zip.readUInt16LE(offset + 26), localExtraLen = zip.readUInt16LE(offset + 28);
    if (!(flags & 8) && (zip.readUInt32LE(offset + 14) !== expectedCrc || zip.readUInt32LE(offset + 18) !== compressed || zip.readUInt32LE(offset + 22) !== size)) throw fail('unsupported', 'The DOCX entry sizes or checksum do not match.');
    const start = offset + 30 + localNameLen + localExtraLen;
    if (zip.subarray(offset + 30, offset + 30 + localNameLen).toString('utf8') !== name || start + compressed > centralOffset) throw fail('unsupported', 'The DOCX entry is outside the archive data.');
    let data;
    try { data = method === 0 ? zip.subarray(start, start + compressed) : inflateRawSync(zip.subarray(start, start + compressed), { maxOutputLength: Math.min(size + 1, CANVAS_DOCUMENT_LIMITS.expandedBytes) }); }
    catch { throw fail('unsupported', 'The DOCX entry could not be safely expanded.'); }
    if (data.length !== size) throw fail('unsupported', 'The DOCX expansion size did not match its directory.');
    if (crc32(data) !== expectedCrc) throw fail('unsupported', 'The DOCX text entry failed its integrity check.');
    selected.set(name, utf8(data));
  }
  if (pos !== end || !selected.has('word/document.xml')) throw fail('unsupported', 'The DOCX document body is missing.');
  const body = selected.get('word/document.xml');
  const parts = [xmlText(body)];
  for (const [name, xml] of selected) if (name !== 'word/document.xml') parts.push(`[${name.replace('word/', '').replace('.xml', '')}]\n${xmlText(xml)}`);
  const hasUnread = [...selected.values()].some(xml => /<w:(?:drawing|pict|object|altChunk)\b|<m:oMath\b/.test(xml));
  return { text: parts.filter(Boolean).join('\n\n'), method: 'docx-xml', contentStatus: hasUnread ? 'partial' : 'available', warnings: hasUnread ? ['Embedded images, equations, or objects were not read.'] : [] };
}

// Poppler is an optional local capability, never a dependency downloaded at
// runtime. No document leaves the server. Missing binaries and scanned/image
// content are reported honestly rather than guessed from PDF byte strings.
export async function extractPdfText(bytes, { timeoutMs = CANVAS_DOCUMENT_LIMITS.timeoutMs, maxText = CANVAS_DOCUMENT_LIMITS.text } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-document-'));
  try {
    const path = join(directory, 'source.pdf');
    await writeFile(path, bytes, { mode: 0o600 });
    let stdout;
    try {
      ({ stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], { timeout: timeoutMs, maxBuffer: Math.min(4_000_000, maxText * 4 + 4096), windowsHide: true }));
    } catch (error) {
      if (error.code === 'ENOENT') throw fail('unsupported', 'PDF text extraction is unavailable on this server. The PDF has not been read.');
      throw fail(error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'too-large' : 'unavailable', 'The PDF could not be read within the local extraction limits. It may be encrypted or damaged.');
    }
    const pages = stdout.replace(/\f\s*$/, '').split('\f');
    const emptyPages = pages.filter(page => !page.trim()).length;
    const text = pages.join('\n\n').trim();
    if (!text) return { text: '', method: 'pdftotext', contentStatus: 'unread', warnings: ['No text layer was found. Scanned or image-only pages require OCR; OCR was not performed.'] };
    return { text, method: 'pdftotext', contentStatus: emptyPages ? 'partial' : 'available', warnings: [
      'PDF images, handwriting and text omitted from the PDF text layer are not read.',
      ...(emptyPages ? [`${emptyPages} page(s) had no readable text layer.`] : []),
    ] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function extractDocumentText(bytes, { contentType = '', filename = '', maxText = CANVAS_DOCUMENT_LIMITS.text, timeoutMs = CANVAS_DOCUMENT_LIMITS.timeoutMs, pdfExtractor = extractPdfText } = {}) {
  const data = Buffer.from(bytes), mime = contentType.split(';')[0].trim().toLowerCase();
  if (data.length > CANVAS_DOCUMENT_LIMITS.bytes) throw fail('too-large', 'The document exceeds the extraction size limit.');
  if (!data.length) return { text: '', contentStatus: 'empty', method: 'none', warnings: [] };
  let result;
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') {
    if (!['application/pdf', 'application/octet-stream', 'binary/octet-stream', ''].includes(mime)) throw fail('unsupported', 'The document content type does not match its PDF content.');
    result = await pdfExtractor(data, { maxText, timeoutMs });
  } else if (data.length > 4 && data.readUInt32LE(0) === 0x04034b50) {
    if (!['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream', ''].includes(mime)) throw fail('unsupported', 'The document content type does not match its Word content.');
    result = extractDocxText(data);
  } else if (['text/plain', 'text/csv', 'text/tab-separated-values', 'text/markdown', 'text/html', 'application/xhtml+xml'].includes(mime)
    || mime === 'application/octet-stream' && /\.(?:txt|csv|tsv|md|html?)$/i.test(filename)) {
    const raw = utf8(data);
    if (/\u0000/.test(raw)) throw fail('unsupported', 'Binary content cannot be read as a text document.');
    const html = mime === 'text/html' || mime === 'application/xhtml+xml' || /\.html?$/i.test(filename);
    // A login page at a .pdf/.docx download address is not a read document.
    if (/\.(?:pdf|docx)$/i.test(filename)) throw fail('restricted', 'The expected document was replaced by a text or sign-in response.');
    if (html && /<form\b[^>]*>[\s\S]*?(?:type\s*=\s*["']?password|\/login)/i.test(raw)) throw fail('restricted', 'The document returned a sign-in page.');
    result = { text: html ? documentHtmlText(raw) : raw.trim(), method: html ? 'html-text' : 'utf8', contentStatus: 'available', warnings: [] };
  } else throw fail('unsupported', 'This document format is not supported. Its contents have not been read.');
  if (!result || typeof result.text !== 'string') throw fail('unavailable', 'The document extractor returned no readable result.');
  const limit = bounded(maxText, CANVAS_DOCUMENT_LIMITS.text, 1_000_000);
  const truncated = result.text.length > limit;
  return { ...result, text: result.text.slice(0, limit), contentStatus: truncated ? 'truncated' : result.text.trim() ? result.contentStatus : result.contentStatus === 'unread' ? 'unread' : 'empty',
    warnings: [...list(result.warnings), ...(truncated ? ['Extracted text was shortened by the document text limit.'] : [])] };
}

function withTimeout(operation, ms) {
  let timer;
  return Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(fail('unavailable', 'Document metadata timed out.')), ms); })]).finally(() => clearTimeout(timer));
}

export async function enrichCourseDocuments(course, {
  baseUrl, getFileMetadata, fetchImpl = fetch, now = Date.now(), pdfExtractor = extractPdfText,
  previousDocuments = [],
  maxDocuments = CANVAS_DOCUMENT_LIMITS.documents, maxBytes = CANVAS_DOCUMENT_LIMITS.bytes,
  maxText = CANVAS_DOCUMENT_LIMITS.text, timeoutMs = CANVAS_DOCUMENT_LIMITS.timeoutMs,
  courseTimeoutMs = CANVAS_DOCUMENT_LIMITS.courseTimeoutMs,
} = {}) {
  const base = checkedBase(baseUrl), discovered = discoverCourseDocuments(course, { baseUrl });
  const readAt = new Date(now).toISOString(), started = Date.now();
  const limit = budget(maxDocuments, CANVAS_DOCUMENT_LIMITS.documents, 100);
  const bytesLimit = bounded(maxBytes, CANVAS_DOCUMENT_LIMITS.bytes, CANVAS_DOCUMENT_LIMITS.bytes);
  const textLimit = bounded(maxText, CANVAS_DOCUMENT_LIMITS.text, 1_000_000);
  const requestTimeout = bounded(timeoutMs, CANVAS_DOCUMENT_LIMITS.timeoutMs, 30_000);
  const courseTimeout = budget(courseTimeoutMs, CANVAS_DOCUMENT_LIMITS.courseTimeoutMs, 120_000);
  const previous = new Map(list(previousDocuments).filter(doc => doc?.courseId === String(course.id)).map(doc => [`${doc.source}:${doc.id}`, doc]));
  const documents = [], queue = [];
  let attempted = 0, cacheHits = 0;
  for (const ref of discovered.references) {
    const doc = { id: ref.id, courseId: ref.courseId, type: 'document', source: ref.type, title: ref.title,
      url: ref.url, htmlUrl: ref.url, text: null, body: null, contentStatus: 'not-read', readAt: null, updatedAt: null,
      provenance: ref.provenance, provenanceTruncated: Boolean(ref.provenanceTruncated), extraction: null, warnings: [],
      sourceFingerprint: ref.sourceFingerprint, documentVersionHash: null, lastAttemptAt: null, previousContentStatus: null };
    documents.push(doc);
    if (ref.restricted) { doc.contentStatus = 'restricted'; doc.warnings = ['Canvas marks this file as unavailable to the connected learner.']; continue; }
    const old = previous.get(`${ref.type}:${ref.id}`);
    const sameSource = old?.sourceFingerprint === ref.sourceFingerprint && old.url === ref.url;
    const age = Number(now) - Date.parse(old?.readAt || '');
    const cachedStatus = old?.previousContentStatus || old?.contentStatus;
    const cached = sameSource && CACHE_STATES.has(cachedStatus) && typeof old.text === 'string' && age >= 0 && age < CACHE_MS ? old : null;
    const reuse = (previousDoc, pending = false) => {
      doc.text = previousDoc.text.slice(0, textLimit); doc.body = doc.text;
      doc.readAt = date(previousDoc.readAt); doc.updatedAt = date(previousDoc.updatedAt);
      const priorStatus = previousDoc.text.length > textLimit ? 'truncated' : previousDoc.previousContentStatus || previousDoc.contentStatus;
      doc.contentStatus = pending ? 'not-read' : priorStatus;
      doc.previousContentStatus = pending ? priorStatus : null;
      doc.extraction = label(previousDoc.extraction); doc.warnings = list(previousDoc.warnings).map(label).slice(0, 10);
      doc.title = label(previousDoc.title) || ref.title; doc.documentVersionHash = previousDoc.documentVersionHash || null;
      doc.lastAttemptAt = date(previousDoc.lastAttemptAt); if (!pending) cacheHits++;
    };
    // Current Canvas file-index timestamps permit reuse without another metadata
    // request. Public Google docs have no trustworthy revision here and are read
    // again within the rotating read budget instead of silently staying stale.
    if (cached && ref.type === 'canvas-file' && ref.fileVersion && ref.fileVersion === cached.documentVersionHash) { reuse(cached); continue; }
    const lastAttempt = sameSource ? date(old?.lastAttemptAt) : null;
    if (lastAttempt) doc.lastAttemptAt = lastAttempt;
    queue.push({ doc, ref, cached, reuse, rank: !lastAttempt ? 0 : 1 });
  }
  // Never-read files first, then oldest attempted files (including failures and
  // cached files requiring metadata revalidation). Refreshes make progress beyond the first
  // page of documents instead of repeatedly downloading the same syllabus.
  queue.sort((a, b) => a.rank - b.rank || (Date.parse(a.doc.lastAttemptAt || '') || 0) - (Date.parse(b.doc.lastAttemptAt || '') || 0) || b.ref.priority - a.ref.priority);
  for (const { doc, ref, cached, reuse } of queue) {
    if (attempted >= limit || Date.now() - started >= courseTimeout) {
      if (cached) reuse(cached, true);
      doc.warnings.push(cached ? 'Earlier extracted text is retained, but the current source version has not been revalidated.' : 'The document read budget was reached; this discovered document remains unread.'); continue;
    }
    attempted++; doc.lastAttemptAt = readAt;
    const remaining = () => Math.max(1, Math.min(requestTimeout, courseTimeout - (Date.now() - started)));
    try {
      let result;
      if (ref.type === 'google-document') {
        const output = await readLinkedDocument({ href: ref.url, title: ref.title, courseId: ref.courseId }, { fetchImpl, maxBytes: Math.min(bytesLimit, textLimit), timeoutMs: remaining() });
        result = { text: output.body, contentStatus: output.contentStatus, method: 'public-google-text', warnings: ['Only the public text export was read; embedded images and attachments were not read.'] };
      } else {
        if (typeof getFileMetadata !== 'function') throw fail('metadata-only', 'An authenticated course file reader is unavailable.');
        const metadata = await withTimeout(Promise.resolve().then(() => getFileMetadata({ courseId: ref.courseId, fileId: ref.id, signal: AbortSignal.timeout(remaining()) })), remaining());
        if (id(metadata?.id) !== ref.id || metadata?.course_id != null && id(metadata.course_id) !== ref.courseId
          || metadata?.context_type === 'Course' && metadata.context_id != null && id(metadata.context_id) !== ref.courseId) throw fail('blocked', 'The Canvas file metadata did not match the discovered course reference.');
        doc.title = label(metadata.display_name ?? metadata.filename) || ref.title;
        doc.updatedAt = date(metadata.updated_at);
        if (metadata.locked_for_user === true || metadata.hidden_for_user === true || metadata.published === false) throw fail('restricted', 'Canvas marks this file as unavailable to the connected learner.');
        if (Number(metadata.size) > bytesLimit) throw fail('too-large', 'The document exceeds the download size limit.');
        doc.documentVersionHash = fileVersion(metadata);
        if (cached && doc.documentVersionHash && doc.documentVersionHash === cached.documentVersionHash) { reuse(cached); doc.lastAttemptAt = readAt; continue; }
        const download = await downloadFile(metadata.url, { base, fetchImpl, maxBytes: bytesLimit, timeoutMs: remaining() });
        result = await extractDocumentText(download.bytes, { contentType: download.contentType, filename: metadata.filename || doc.title, maxText: textLimit, timeoutMs: remaining(), pdfExtractor });
      }
      doc.text = result.text; doc.body = result.text; doc.readAt = readAt;
      doc.contentStatus = result.contentStatus; doc.extraction = result.method; doc.warnings = result.warnings;
    } catch (error) {
      doc.contentStatus = error?.documentStatus || 'unavailable';
      // Do not propagate fetch/Canvas errors: they may contain signed URLs,
      // credentials, filenames, student data, or internal server paths.
      doc.warnings = [error?.documentStatus ? error.message : 'The document could not be read. Check its access in Canvas.'];
    }
  }
  const unread = documents.filter(doc => !['available', 'empty'].includes(doc.contentStatus)).length;
  return { ...course, documents, documentsTruncated: discovered.truncated || documents.some(doc => ['not-read', 'truncated'].includes(doc.contentStatus)),
    documentCollection: { discovered: discovered.references.length, attempted, cacheHits, read: documents.filter(doc => doc.readAt).length, unread, complete: !discovered.truncated && unread === 0, checkedAt: readAt,
      limitations: ['Only collected course sources and the accessible file index were searched. External websites, authenticated Google documents, legacy Office files, and image OCR are not read.'] } };
}
