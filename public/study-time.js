// This is a foreground activity estimate, not a measure of attention or mastery.
// It keeps only counters and current scope identifiers in memory. The host owns
// trusted interaction/visibility events; no timer, input text, or storage is used.
const IDLE_MS = 5 * 60 * 1000;
const MAX_MS = 24 * 60 * 60 * 1000;
const PROFILE_ID = /^[a-z0-9-]{1,55}$/;

export function createStudyTimeTracker({ now, monotonicNow, timeZone } = {}) {
  const wallClock = typeof now === 'function' ? now : Date.now;
  const elapsedClock = typeof monotonicNow === 'function' ? monotonicNow
    : typeof now === 'function' ? now
      : () => globalThis.performance?.now?.() ?? Date.now();
  let profileId = null, scopeKey = '', isStudy = false, paused = false, visible = true, disposed = false;
  let activeMs = 0, continuousMs = 0, topicMs = 0, lastTick = null, lastActivity = null;
  const eligible = () => !disposed && Boolean(profileId) && isStudy && !paused && visible;
  const bounded = value => Math.min(MAX_MS, Math.max(0, value));

  function elapsedNow() {
    let value;
    try { value = elapsedClock(); } catch { value = NaN; }
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(lastTick ?? value, value) : lastTick ?? 0;
  }
  function advance() {
    const current = elapsedNow();
    if (eligible() && lastTick !== null && lastActivity !== null) {
      // Count at most the five minutes following an interaction, even when
      // the next event/snapshot arrives much later or the device was asleep.
      const end = Math.min(current, lastActivity + IDLE_MS);
      const elapsed = Math.max(0, end - lastTick);
      activeMs = bounded(activeMs + elapsed);
      continuousMs = bounded(continuousMs + elapsed);
      topicMs = bounded(topicMs + elapsed);
      if (current >= lastActivity + IDLE_MS) continuousMs = 0;
    } else continuousMs = 0;
    lastTick = current;
    return current;
  }
  function restartWindow(current) {
    continuousMs = 0;
    lastActivity = eligible() ? current : null;
  }
  function zone() {
    try {
      const value = typeof timeZone === 'function' ? timeZone()
        : timeZone === undefined ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone;
      if (typeof value !== 'string' || !value || value.length > 100) return null;
      return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    } catch { return null; }
  }
  function observedAt() {
    try {
      const value = wallClock();
      if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    } catch { /* Use the actual browser wall clock if an injected clock fails. */ }
    return new Date().toISOString();
  }

  return {
    setContext(value = {}) {
      if (disposed) return;
      const current = advance(), wasEligible = eligible();
      const nextProfile = typeof value.profileId === 'string' && PROFILE_ID.test(value.profileId) ? value.profileId : null;
      const nextScope = typeof value.scopeKey === 'string' ? value.scopeKey.slice(0, 500) : '';
      const profileChanged = nextProfile !== profileId;
      if (profileChanged) activeMs = continuousMs = topicMs = 0;
      else if (nextScope !== scopeKey) topicMs = 0;
      profileId = nextProfile; scopeKey = nextScope;
      isStudy = value.isStudy === true; paused = value.paused === true;
      if (profileChanged || wasEligible !== eligible()) restartWindow(current);
    },
    activity() {
      if (disposed) return;
      const current = advance();
      if (eligible()) lastActivity = current;
    },
    visibility(value) {
      if (disposed) return;
      const current = advance(), wasEligible = eligible();
      visible = value === true;
      if (wasEligible !== eligible()) restartWindow(current);
    },
    snapshot() {
      const current = advance();
      const status = !eligible() ? 'paused'
        : lastActivity === null || current >= lastActivity + IDLE_MS ? 'idle' : 'active';
      return {
        timeZone: zone(),
        session: {
          activeSeconds: Math.floor(activeMs / 1000),
          continuousSeconds: Math.floor(continuousMs / 1000),
          topicSeconds: Math.floor(topicMs / 1000),
          status,
          observedAt: observedAt(),
        },
      };
    },
    dispose() {
      disposed = true; profileId = null; scopeKey = ''; isStudy = false;
      activeMs = continuousMs = topicMs = 0; lastActivity = null;
    },
  };
}
