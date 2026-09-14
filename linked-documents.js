// Read a publicly shared Google document linked by an already retrieved
// instructor source. No Google/Canvas cookies, tokens or arbitrary URLs.
const DOC_ID = /^[a-zA-Z0-9_-]{10,160}$/;
export function googleDocumentLink(value) {
  try {
    const url = new URL(value);
    const match = /^\/document\/d\/([a-zA-Z0-9_-]+)(?:\/(?:edit|view|preview|export))?\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password || !match || !DOC_ID.test(match[1])) return null;
    if ([...url.searchParams.keys()].some(k => /token|key|credential|signature|verifier/i.test(k))) return null;
    return { id: match[1], href: `https://docs.google.com/document/d/${match[1]}/edit`, exportUrl: `https://docs.google.com/document/d/${match[1]}/export?format=txt` };
  } catch { return null; }
}

export async function readLinkedDocument(ref, { fetchImpl = fetch, maxBytes = 100_000, timeoutMs = 20_000 } = {}) {
  const link = googleDocumentLink(ref?.href);
  if (!link) throw new Error('Unsupported linked document.');
  const signal = AbortSignal.timeout(timeoutMs);
  let url = link.exportUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal, headers: { accept: 'text/plain' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const next = new URL(response.headers.get('location') || '', url);
      await response.body?.cancel();
      // Google exports redirect to its docstext hosts. Login and every other
      // destination stop here; tokens from this app are never forwarded.
      if (next.protocol !== 'https:' || next.username || next.password || next.port
        || !/^[a-z0-9-]+-docstext\.googleusercontent\.com$/.test(next.hostname)) throw new Error('This document needs access that the coach does not have.');
      url = next.href;
      continue;
    }
    if (!response.ok || !/^text\/plain(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw new Error('The linked document was not available as readable text. Open the original document to check access.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The document had no readable body.');
    const chunks = [];
    let size = 0, truncated = false;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - size;
      chunks.push(next.value.subarray(0, remaining));
      size += Math.min(remaining, next.value.byteLength);
      if (next.value.byteLength > remaining || size >= maxBytes) { truncated = true; await reader.cancel(); break; }
    }
    const body = Buffer.concat(chunks).toString('utf8').trim();
    if (!body) throw new Error('The linked document returned empty text.');
    return { courseId: ref.courseId, type: 'document', id: link.id, title: String(ref.title || 'Linked Google document').slice(0,300), htmlUrl: link.href,
      body, contentStatus: truncated ? 'truncated' : 'available', readAt: new Date().toISOString(), updatedAt: null, dueAt: null, dueAtPresent: false };
  }
  throw new Error('The linked document exceeded its redirect limit.');
}
