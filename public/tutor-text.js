// Supported inline Markdown rendered as DOM nodes; model text is never HTML.
const MAX_TEXT = 24000;
const APP_ROUTE = /^#\/(?:home|library|build|mystery|focus|mixed(?:\/(?:sat|algebra))?|plans(?:\/(?:course\/[0-9]{1,20}|[a-z0-9-]{1,64}))?|review|settings|diagnostic|canvas(?:\/(?:plan|grades|assessment|course\/[0-9]+))?|(?:unit|practice|mastery)\/[a-z0-9-]{1,64}|lesson\/[a-z0-9-]{1,64}\/[a-z0-9-]{1,64})$/;
const UNSAFE_URL = /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>"'\\]|%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i;
const URL_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/;

export function safeTutorHref(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || value !== value.trim() || UNSAFE_URL.test(value)) return null;
  if (APP_ROUTE.test(value)) return value;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    if (URL_CONTROL.test(decodeURIComponent(value))) return null;
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function appendText(node, text) {
  text.split('\n').forEach((line, index) => {
    if (index) node.appendChild(document.createElement('br'));
    if (line) node.appendChild(document.createTextNode(line));
  });
}

function markdownLink(text, start) {
  const limit = Math.min(text.length, start + 300);
  let labelEnd = start + 1;
  for (; labelEnd < limit; labelEnd++) {
    if (text[labelEnd] === '\\') { labelEnd++; continue; }
    if (text[labelEnd] === ']') break;
    if (text[labelEnd] === '\n') return null;
  }
  if (labelEnd >= limit || text[labelEnd + 1] !== '(') return null;
  const destinationStart = labelEnd + 2;
  let depth = 1, end = destinationStart;
  for (; end < Math.min(text.length, destinationStart + 2050); end++) {
    if (text[end] === '\\') { end++; continue; }
    if (text[end] === '(') { if (++depth > 16) return null; }
    if (text[end] === ')' && --depth === 0) break;
  }
  if (depth !== 0) return null;
  let destination = text.slice(destinationStart, end);
  if (destination.startsWith('<') && destination.endsWith('>')) destination = destination.slice(1, -1);
  destination = destination.replace(/\\([()[\]\\])/g, '$1');
  return { end: end + 1, label: text.slice(start + 1, labelEnd).replace(/\\([\[\]\\])/g, '$1'), href: safeTutorHref(destination) };
}

function trimUrlPunctuation(value) {
  let text = value;
  while (text) {
    if (/[.,;:!?…。！？；：，”’]$/.test(text)) { text = text.slice(0, -1); continue; }
    const closer = text.at(-1);
    const opener = { ')': '(', ']': '[', '}': '{' }[closer];
    if (opener && text.split(closer).length > text.split(opener).length) { text = text.slice(0, -1); continue; }
    break;
  }
  return text;
}

function appendLink(node, label, href, depth) {
  const link = document.createElement('a'); link.setAttribute('href', href);
  if (!href.startsWith('#/')) {
    link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('aria-label', `${label} (opens in a new tab)`);
  }
  appendTutorInline(link, label, { links: false, depth: depth + 1 }); node.appendChild(link);
}

export function appendTutorInline(node, value, { links = true, depth = 0 } = {}) {
  const text = String(value ?? '').slice(0, MAX_TEXT).replace(/\r\n?/g, '\n');
  if (depth > 4) { appendText(node, text); return; }
  let buffer = '';
  const flush = () => { appendText(node, buffer); buffer = ''; };
  for (let i = 0; i < text.length;) {
    if (text[i] === '\x60') {
      const delimiter = /^\x60+/.exec(text.slice(i))[0]; const end = text.indexOf(delimiter, i + delimiter.length);
      if (end !== -1) {
        flush(); const code = document.createElement('code'); code.textContent = text.slice(i + delimiter.length, end);
        node.appendChild(code); i = end + delimiter.length; continue;
      }
    }
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2 && !text.slice(i, end).includes('\n')) {
        flush(); const strong = document.createElement('strong');
        appendTutorInline(strong, text.slice(i + 2, end), { links, depth: depth + 1 });
        node.appendChild(strong); i = end + 2; continue;
      }
    }
    // Images and arbitrary HTML remain text, without loading resources.
    if (text.startsWith('![', i)) {
      const image = markdownLink(text, i + 1);
      if (image) { buffer += text.slice(i, image.end); i = image.end; continue; }
    }
    if (text[i] === '[') {
      const match = markdownLink(text, i);
      if (match) {
        if (links && match.href && match.label.trim()) { flush(); appendLink(node, match.label, match.href, depth); }
        else buffer += text.slice(i, match.end);
        i = match.end; continue;
      }
    }
    if (text[i] === '<') {
      const end = text.indexOf('>', i + 1);
      if (end !== -1) {
        const candidate = text.slice(i + 1, end); const href = links ? safeTutorHref(candidate) : null;
        if (href) { flush(); appendLink(node, candidate, href, depth); }
        else buffer += text.slice(i, end + 1);
        i = end + 1; continue;
      }
    }
    if (links && /^https?:\/\//i.test(text.slice(i, i + 8)) && (i === 0 || !/[a-z0-9_:@/\\]/i.test(text[i - 1]))) {
      const raw = /^[^\s<>"'\x60]+/.exec(text.slice(i))?.[0] || '';
      const candidate = trimUrlPunctuation(raw); const href = safeTutorHref(candidate);
      if (href) { flush(); appendLink(node, candidate, href, depth); i += candidate.length; continue; }
      // Do not link a safe-looking substring of a rejected URL.
      buffer += raw; i += raw.length; continue;
    }
    buffer += text[i++];
  }
  flush();
}
