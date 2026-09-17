// Operator check: no database, student account, Canvas, or saved student records.
// --smoke makes small paid provider requests using synthetic record data only.
import { resolveCoachConfig } from '../coach-config.js';
import { getTutorStatus } from '../tutor-service.js';
import { completeAnthropicCoach } from '../anthropic-coach.js';
import { completeRecordCoach } from '../ai-record-coach.js';
import { createStudentRecordLookup } from '../coach-records.js';

if (process.argv.slice(2).some(arg => arg !== '--smoke')) {
  console.error('Usage: node scripts/check-tutor-models.mjs [--smoke]');
  process.exit(2);
}
const status = getTutorStatus();
console.log(JSON.stringify({ tutorConfiguration: status }));
if (!status.available) process.exit(1);
if (!process.argv.includes('--smoke')) process.exit(0);

let failed = false;
const config = resolveCoachConfig();
for (const entry of config.attempts) {
  const marker = 'bluebird-fixture-47';
  const lookup = createStudentRecordLookup({ profileId: 'tutor-capability-fixture',
    readNotes: async () => ({ totalCount: 1, notes: [{ profileId: 'tutor-capability-fixture',
      id: 'synthetic-note', type: 'student_note', text: `Synthetic check marker: ${marker}` }] }),
  });
  const request = { ...entry, models: [entry.model], lookup, timeoutMs: 120000,
    system: 'This is a synthetic API capability check with no real student data. Follow the requested read-only tool workflow and keep the final answer under 20 words.',
    messages: [{ role: 'user', content: 'Use read_student_records to read saved_notes at offset 0, then reply with only the synthetic check marker you retrieved.' }],
  };
  const out = entry.provider === 'anthropic' ? await completeAnthropicCoach(request) : await completeRecordCoach(request);
  const verified = Boolean(out.text?.includes(marker) && lookup.reads.some(read => read.collection === 'saved_notes' && read.count === 1));
  console.log(JSON.stringify({ provider: entry.provider, requestedModel: entry.model,
    textReceived: Boolean(out.text), savedNoteToolVerified: verified,
    refusal: Boolean(out.refusal), truncated: Boolean(out.truncated), failures: out.failures }));
  if (!verified || out.refusal || out.truncated) failed = true;
}
process.exitCode = failed ? 1 : 0;
