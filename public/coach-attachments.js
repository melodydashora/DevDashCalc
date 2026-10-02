// In-memory drafts only. The public preview contains metadata and blob URLs;
// attachment bytes are returned only for an explicit Coach request.
export const MAX_COACH_ATTACHMENTS = 2;
export const MAX_COACH_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export const MAX_COACH_NOTE_CHARACTERS = 12000;
export const COACH_ATTACHMENT_PROMPT = 'Help me understand the attached study material.';
export const COACH_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,text/plain,.jpg,.jpeg,.png,.webp,.txt';
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'text/plain']);

function fileType(file) {
  const type = String(file.type || '').toLowerCase();
  if (TYPES.has(type)) return type;
  if (type) return '';
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain' }[String(file.name || '').split('.').pop().toLowerCase()] || '';
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function createCoachAttachments({ onChange = () => {}, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url) } = {}) {
  let entries = [];
  let generation = 0;
  let loading = false;
  const release = entry => { if (entry.previewUrl) revokeObjectURL(entry.previewUrl); };
  const metadata = ({ id, name, mimeType, size, previewUrl }) => ({ id, name, mimeType, size, previewUrl });
  const changed = () => onChange();
  return {
    get items() { return entries.map(metadata); },
    get loading() { return loading; },
    snapshot() { return entries.map(({ name, mimeType, data }) => ({ name, mimeType, data })); },
    async add(selected) {
      if (loading) return false;
      const files = Array.from(selected || []);
      if (!files.length) return false;
      if (files.length + entries.length > MAX_COACH_ATTACHMENTS) throw new Error('You can attach up to 2 photos or notes. Remove one before adding another.');
      if (files.some(file => !fileType(file))) throw new Error('Choose a JPG, PNG, WebP photo or a plain text (.txt) note.');
      if (files.some(file => !Number.isSafeInteger(file.size) || file.size <= 0)) throw new Error('This file is empty or could not be read. Choose another file.');
      if (files.reduce((total, file) => total + file.size, entries.reduce((total, entry) => total + entry.size, 0)) > MAX_COACH_ATTACHMENT_BYTES) throw new Error('These files are too large. Choose photos or notes under 6 MB combined.');
      const ownGeneration = ++generation;
      loading = true; changed();
      const prepared = [];
      let textCharacters = entries.reduce((total, entry) => total + entry.textCharacters, 0);
      try {
        for (const file of files) {
          let bytes;
          try { bytes = new Uint8Array(await file.arrayBuffer()); }
          catch { throw new Error('This file could not be read. Choose it again or try another file.'); }
          if (generation !== ownGeneration) return false;
          if (bytes.length !== file.size) throw new Error('This file could not be read completely. Choose it again.');
          const mimeType = fileType(file);
          let characters = 0;
          if (mimeType === 'text/plain') {
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw new Error('This note needs to be saved as UTF-8 plain text (.txt).'); }
            if (!text.trim() || text.includes('\0')) throw new Error('Choose a plain text note with readable study material.');
            characters = text.length;
            textCharacters += characters;
            if (textCharacters > MAX_COACH_NOTE_CHARACTERS) throw new Error('Keep attached notes under 12,000 characters combined.');
          }
          prepared.push({ id: crypto.randomUUID(), name: String(file.name || 'Study attachment').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'Study attachment', mimeType, size: bytes.length, textCharacters: characters, data: base64(bytes), previewUrl: '' });
        }
        if (generation !== ownGeneration) return false;
        for (let index = 0; index < prepared.length; index += 1) {
          if (prepared[index].mimeType.startsWith('image/')) prepared[index].previewUrl = createObjectURL(files[index]);
        }
        entries.push(...prepared); return true;
      } catch (error) {
        prepared.forEach(release);
        if (generation !== ownGeneration) return false;
        throw error;
      } finally {
        if (generation === ownGeneration) { loading = false; changed(); }
      }
    },
    remove(id) {
      const removed = entries.find(entry => entry.id === id);
      if (!removed) return;
      generation += 1; loading = false;
      entries = entries.filter(entry => entry !== removed); release(removed); changed();
    },
    clear() {
      generation += 1; loading = false;
      entries.forEach(release); entries = []; changed();
    },
  };
}
