// One clock for header, schedules and reminders. The coach independently uses
// server time plus the validated display timezone, never a client-supplied date.
export function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { return null; }
}

export function timeContext(now, timeZone = 'UTC') {
  if (!Number.isFinite(now)) throw new TypeError('A valid current time is required.');
  const zone = validTimeZone(timeZone) || 'UTC';
  const date = new Date(now);
  return {
    now: date.toISOString(), epochMs: now, timeZone: zone,
    localDate: new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
    localTime: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(date),
    label: new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'full', timeStyle: 'long' }).format(date),
  };
}

export function createAppClock({ wallNow = Date.now, monotonicNow = () => globalThis.performance?.now() ?? Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  let anchor = wallNow(), tick = monotonicNow(), source = 'device', syncedAt = null;
  const zone = validTimeZone(timeZone) || 'UTC';
  function now() { return anchor + Math.max(0, monotonicNow() - tick); }
  return {
    now,
    read: () => ({ ...timeContext(now(), zone), source, syncedAt }),
    // HTTP response timestamp is sampled at the server; half the round trip is
    // a bounded latency estimate, not a promise of subsecond precision.
    synchronize(serverNow, sentAt, receivedAt = monotonicNow()) {
      const epoch = typeof serverNow === 'number' ? serverNow : Date.parse(serverNow);
      const roundTrip = receivedAt - sentAt;
      if (!Number.isFinite(epoch) || !Number.isFinite(roundTrip) || roundTrip < 0 || roundTrip > 30_000) return false;
      anchor = epoch + roundTrip / 2; tick = receivedAt;
      source = 'server'; syncedAt = new Date(epoch).toISOString(); return true;
    },
    useDeviceTime() { if (source !== 'server') { anchor = wallNow(); tick = monotonicNow(); } },
  };
}

export function mountHeaderClock(container, clock) {
  const update = () => {
    const context = clock.read();
    container.textContent = `${context.localTime} · ${context.localDate}`;
    container.dateTime = context.now;
    container.title = `${context.timeZone} · ${context.source === 'server' ? 'Server-synchronized time' : 'Device time; synchronization unavailable'}`;
    container.setAttribute('aria-label', context.label);
  };
  update();
  const timer = setInterval(() => { if (!document.hidden) update(); }, 1000);
  document.addEventListener('visibilitychange', update);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
}
