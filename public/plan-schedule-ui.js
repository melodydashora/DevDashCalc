// Optional scheduling for an already saved plan. The app owns persistence and
// the shared clock; this panel never changes checked steps or asks for browser
// notification permission until the learner presses its explicit button.
import { localDateTimeToInstant, normalizePlanSchedule, planProgress, planReminderCandidates } from './plan-schedule.js';

function element(tag, className = '', content = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}
function field(label, control) {
  const node = element('label', 'plan-field', label); node.appendChild(control); return node;
}
function localValue(instant, timeZone) {
  if (!instant) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function dateLabel(instant, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant));
}
function scheduleOf(plan) {
  try { return normalizePlanSchedule(plan?.schedule); } catch { return null; }
}
function reminderLabel(candidate) {
  if (candidate.kind === 'overdue') return 'Your planned finish time has passed. Review the remaining steps or adjust your schedule.';
  const action = candidate.kind === 'start' ? 'starts' : 'ends';
  return candidate.leadMinutes === 0 ? `Your planned study time ${action} now.`
    : `Your planned study time ${action} soon (${candidate.leadMinutes}-minute reminder).`;
}

/**
 * onUpdate(schedule|null) persists a schedule and returns the refreshed plan.
 * Call updatePlan after checked steps change and dispose when the view closes
 * or its learner changes. Reminder delivery is limited to this mounted panel.
 */
export function mountPlanSchedule(container, { plan, clock, onUpdate, remindersManagedExternally = false } = {}) {
  let currentPlan = plan, disposed = false, busy = false, notificationsEnabled = false;
  const notified = new Set(), shownNotifications = new Set();
  const current = () => !disposed && container.isConnected !== false;
  const readClock = () => {
    const context = clock?.read();
    if (!context || !Number.isFinite(context.epochMs) || typeof context.timeZone !== 'string') throw new Error('Current time is unavailable. Refresh the app before saving a schedule.');
    return context;
  };
  const panel = element('section', 'plan-schedule');
  panel.appendChild(element('h3', '', 'Schedule and progress'));
  const clockLabel = element('p', 'canvas-meta');
  const actualLabel = element('p');
  const actualProgress = element('progress'); actualProgress.max = 100; actualProgress.setAttribute('aria-label', 'Completed plan steps');
  const elapsedLabel = element('p', 'canvas-meta');
  const elapsedProgress = element('progress'); elapsedProgress.max = 100; elapsedProgress.setAttribute('aria-label', 'Scheduled time elapsed');
  const pace = element('p', 'canvas-meta');
  const summary = element('p', 'canvas-meta');
  panel.append(clockLabel, actualLabel, actualProgress, elapsedLabel, elapsedProgress, pace, summary);
  const form = element('form', 'study-plan-form');
  const start = element('input'); start.type = 'datetime-local'; start.name = 'plan-start'; start.required = true; start.step = '60';
  const end = element('input'); end.type = 'datetime-local'; end.name = 'plan-end'; end.required = true; end.step = '60';
  const zone = element('input'); zone.type = 'text'; zone.name = 'plan-time-zone'; zone.required = true; zone.maxLength = 100; zone.autocomplete = 'off';
  const dateFields = element('div', 'plan-fields');
  dateFields.append(field('Start date and time ', start), field('Finish date and time ', end), field('Time zone ', zone));
  const reminderCheck = element('input'); reminderCheck.type = 'checkbox'; reminderCheck.name = 'plan-reminders';
  const reminderField = element('label', 'plan-step-check');
  reminderField.append(reminderCheck, element('span', '', remindersManagedExternally ? 'Remind me while the app is open' : 'Remind me while this plan is open'));
  const lead = element('select'); lead.name = 'plan-reminder-lead';
  for (const minutes of [0, 5, 15, 30, 60]) {
    const option = element('option', '', minutes === 0 ? 'At the start and finish' : `${minutes} minutes before start and finish`);
    option.value = String(minutes); lead.appendChild(option);
  }
  const leadField = field('Reminder timing ', lead);
  const save = element('button', '', 'Save schedule'); save.type = 'submit';
  const remove = element('button', 'secondary', 'Remove schedule'); remove.type = 'button';
  const notificationButton = element('button', 'secondary', 'Enable browser notifications'); notificationButton.type = 'button';
  const actions = element('div', 'btn-row'); actions.append(save, remove, notificationButton);
  const notice = element('p', 'canvas-meta', remindersManagedExternally
    ? 'Times use the zone above. Reminders work while the app is open; they are not delivered after the app is closed.'
    : 'Times use the zone above. Reminders work while this plan is open; they are not delivered after the app is closed.');
  const status = element('p', 'plan-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const reminders = element('div', 'plan-status'); reminders.setAttribute('role', 'status'); reminders.setAttribute('aria-live', 'polite');
  let reminderText = '';
  form.append(dateFields, reminderField, leadField, notice, actions, status);
  panel.append(form, reminders); container.replaceChildren(panel);

  function syncControls() {
    for (const control of [start, end, zone, reminderCheck, save]) control.disabled = busy;
    lead.disabled = busy || !reminderCheck.checked;
    remove.disabled = busy || !currentPlan?.schedule;
    notificationButton.disabled = busy || !scheduleOf(currentPlan)?.remindersEnabled;
    notificationButton.hidden = remindersManagedExternally || typeof globalThis.Notification !== 'function';
    notificationButton.textContent = notificationsEnabled ? 'Turn off browser notifications' : 'Enable browser notifications';
  }
  function loadFields() {
    const schedule = scheduleOf(currentPlan);
    let context;
    try { context = readClock(); } catch (error) { status.textContent = error.message; }
    zone.value = schedule?.timeZone || context?.timeZone || '';
    start.value = schedule ? localValue(schedule.startAt, schedule.timeZone) : '';
    end.value = schedule ? localValue(schedule.endAt, schedule.timeZone) : '';
    reminderCheck.checked = schedule?.remindersEnabled === true;
    const value = (schedule?.reminderLeadMinutes?.length ? schedule.reminderLeadMinutes : [15]).join(',');
    if (![...lead.children].some(option => option.value === value)) {
      const option = element('option', '', `Saved timing: ${value.replaceAll(',', ', ')} minutes before`); option.value = value; lead.appendChild(option);
    }
    lead.value = value;
    syncControls();
  }
  function tick() {
    if (!current()) return;
    let context;
    try { context = readClock(); } catch (error) { clockLabel.textContent = error.message; return; }
    clockLabel.textContent = `${context.localDate} · ${context.localTime} · ${context.timeZone}`;
    const progress = planProgress(currentPlan, context.epochMs), schedule = scheduleOf(currentPlan);
    actualLabel.textContent = `${progress.completedSteps} of ${progress.totalSteps} steps complete · ${progress.completionPercent}%`;
    actualProgress.value = progress.completionPercent;
    actualProgress.textContent = `${progress.completionPercent}% of steps complete`;
    elapsedProgress.hidden = !schedule; elapsedLabel.hidden = !schedule; pace.hidden = !schedule;
    if (schedule) {
      elapsedLabel.textContent = `${progress.timeElapsedPercent}% of scheduled time elapsed. Time passing does not complete a step.`;
      elapsedProgress.value = progress.timeElapsedPercent;
      elapsedProgress.textContent = `${progress.timeElapsedPercent}% of scheduled time elapsed`;
      pace.textContent = progress.complete ? 'All plan steps are checked complete.'
        : `Suggested pace by now: ${progress.plannedCompletionPercent}% of steps. This is a timing guide, not a measure of understanding.`;
      summary.textContent = `${dateLabel(schedule.startAt, schedule.timeZone)} to ${dateLabel(schedule.endAt, schedule.timeZone)} · ${schedule.timeZone}`
        + (progress.scheduleStatus === 'overdue' ? ' · Planned finish time has passed.' : '');
    } else summary.textContent = currentPlan?.schedule ? 'The saved schedule could not be read. Enter new times to replace it.' : 'No schedule saved. Choose a start and finish when you are ready.';
    const candidates = remindersManagedExternally ? [] : planReminderCandidates(currentPlan, { now: context.epochMs });
    const nextText = candidates.map(reminderLabel).join(' ');
    if (nextText !== reminderText) { reminders.textContent = nextText; reminderText = nextText; }
    const Notification = globalThis.Notification;
    if (!notificationsEnabled || typeof Notification !== 'function' || Notification.permission !== 'granted') return;
    for (const candidate of candidates) {
      if (notified.has(candidate.id)) continue;
      try {
        const notification = new Notification('Study plan reminder', { body: `${String(currentPlan.title || 'Study plan').slice(0, 160)}: ${reminderLabel(candidate)}`, tag: candidate.id });
        notified.add(candidate.id); shownNotifications.add(notification);
      } catch {
        notificationsEnabled = false;
        status.textContent = 'Browser notifications are unavailable here. In-app reminders remain on while this plan is open.';
        syncControls(); break;
      }
    }
  }
  async function persist(schedule) {
    if (busy || !current()) return;
    busy = true; syncControls(); status.textContent = 'Saving schedule.';
    try {
      if (typeof onUpdate !== 'function') throw new Error('The schedule could not be saved. Reopen this plan and try again.');
      const next = await onUpdate(schedule);
      if (!current()) return;
      if (!next || next.id !== currentPlan.id) throw new Error('The saved schedule could not be confirmed. Reopen this plan to check it.');
      currentPlan = next;
      if (!scheduleOf(currentPlan)?.remindersEnabled) notificationsEnabled = false;
      loadFields(); tick(); status.textContent = schedule ? 'Schedule saved.' : 'Schedule removed.';
    } catch (error) {
      if (current() && error.name !== 'AbortError') status.textContent = error.message || 'The schedule could not be saved. Try again.';
    } finally { if (current()) { busy = false; syncControls(); } }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !current() || !form.reportValidity()) return;
    try {
      readClock();
      const saved = scheduleOf(currentPlan);
      // Preserve an already unambiguous saved instant when only reminder
      // settings change, including times within a daylight-saving overlap.
      const instant = (value, previous) => saved?.timeZone === zone.value.trim() && value === localValue(previous, saved.timeZone)
        ? previous : localDateTimeToInstant(value, zone.value.trim());
      persist(normalizePlanSchedule({
        startAt: instant(start.value, saved?.startAt),
        endAt: instant(end.value, saved?.endAt), timeZone: zone.value.trim(),
        remindersEnabled: reminderCheck.checked, reminderLeadMinutes: lead.value.split(',').map(Number),
      }));
    } catch (error) { status.textContent = error.message; }
  });
  remove.addEventListener('click', () => persist(null));
  reminderCheck.addEventListener('change', syncControls);
  notificationButton.addEventListener('click', async () => {
    if (!current() || busy || remindersManagedExternally || !scheduleOf(currentPlan)?.remindersEnabled) return;
    if (notificationsEnabled) { notificationsEnabled = false; syncControls(); status.textContent = 'Browser notifications turned off. In-app reminders remain on.'; return; }
    const Notification = globalThis.Notification;
    if (typeof Notification !== 'function') return;
    try {
      // Permission is requested only from this learner click, never on mount,
      // timer ticks, loading an opted-in plan, or saving its schedule.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (!current() || !scheduleOf(currentPlan)?.remindersEnabled) return;
      notificationsEnabled = permission === 'granted';
      status.textContent = notificationsEnabled ? 'Browser notifications enabled while this plan is open.'
        : 'Browser notifications are not enabled. In-app reminders remain on while this plan is open.';
      syncControls(); tick();
    } catch { if (current()) status.textContent = 'Browser notifications are unavailable here. In-app reminders remain on.'; }
  });
  loadFields(); tick();
  const timer = setInterval(tick, 15_000);
  document.addEventListener?.('visibilitychange', tick);
  return {
    updatePlan(next) {
      if (!current() || next?.id !== currentPlan?.id) return;
      currentPlan = next;
      if (!scheduleOf(currentPlan)?.remindersEnabled) notificationsEnabled = false;
      tick(); syncControls();
    },
    dispose() {
      disposed = true; clearInterval(timer); document.removeEventListener?.('visibilitychange', tick);
      for (const notification of shownNotifications) { try { notification.close?.(); } catch { /* already closed */ } }
      shownNotifications.clear();
    },
  };
}

/** A profile-scoped monitor that stays mounted while the learner changes routes. */
export function mountPlanReminders(container, { getPlans, clock, profileId } = {}) {
  let disposed = false, notificationsEnabled = false, requestingPermission = false, currentText = '';
  const notified = new Set(), shownNotifications = new Set();
  const current = () => !disposed && container.isConnected !== false;
  const messages = element('p', 'plan-status'); messages.setAttribute('role', 'status'); messages.setAttribute('aria-live', 'polite');
  const explanation = element('p', 'canvas-meta', 'Study reminders work while this app is open. Closing it stops delivery; your browser may delay reminders in a background tab.');
  const permissionStatus = element('p', 'plan-status'); permissionStatus.setAttribute('role', 'status'); permissionStatus.setAttribute('aria-live', 'polite');
  const enable = element('button', 'secondary', 'Enable browser notifications'); enable.type = 'button';
  container.replaceChildren(messages, explanation, enable, permissionStatus);
  function plansNow() {
    const plans = typeof getPlans === 'function' ? getPlans() : [];
    return Array.isArray(plans) ? plans : [];
  }
  function render() {
    if (!current()) return;
    let context, plans;
    try {
      context = clock?.read(); plans = plansNow();
      if (!Number.isFinite(context?.epochMs)) throw new Error('Current time is unavailable. Reminders will resume when the app clock is available.');
    } catch (error) {
      container.hidden = false;
      messages.textContent = error.message || 'Study reminders could not be refreshed. Open Study plans to try again.';
      currentText = '';
      enable.disabled = true;
      enable.hidden = typeof globalThis.Notification !== 'function';
      for (const notification of shownNotifications) { try { notification.close?.(); } catch { /* already closed */ } }
      shownNotifications.clear();
      return;
    }
    const enabledPlans = plans.filter(plan => scheduleOf(plan)?.remindersEnabled);
    container.hidden = enabledPlans.length === 0;
    enable.disabled = requestingPermission || enabledPlans.length === 0;
    enable.hidden = typeof globalThis.Notification !== 'function';
    enable.textContent = notificationsEnabled ? 'Turn off browser notifications' : 'Enable browser notifications';
    const candidates = enabledPlans.flatMap(plan => planReminderCandidates(plan, { now: context.epochMs, profileId }));
    const text = candidates.map(candidate => `${candidate.title}: ${reminderLabel(candidate)}`).join(' ')
      || 'No study reminders are due right now.';
    if (text !== currentText) { messages.textContent = text; currentText = text; }
    const Notification = globalThis.Notification;
    if (!notificationsEnabled || typeof Notification !== 'function' || Notification.permission !== 'granted') return;
    for (const candidate of candidates) {
      if (notified.has(candidate.id)) continue;
      try {
        const notification = new Notification('Study plan reminder', {
          body: `${candidate.title.slice(0, 160)}: ${reminderLabel(candidate)}`, tag: candidate.id,
        });
        notified.add(candidate.id); shownNotifications.add(notification);
      } catch {
        notificationsEnabled = false; enable.textContent = 'Enable browser notifications';
        permissionStatus.textContent = 'Browser notifications are unavailable here. In-app reminders remain on.'; break;
      }
    }
  }
  enable.addEventListener('click', async () => {
    if (!current() || requestingPermission) return;
    try { if (!plansNow().some(plan => scheduleOf(plan)?.remindersEnabled)) return; }
    catch { render(); return; }
    if (notificationsEnabled) {
      notificationsEnabled = false;
      permissionStatus.textContent = 'Browser notifications turned off. In-app reminders remain on.';
      render(); return;
    }
    const Notification = globalThis.Notification;
    if (typeof Notification !== 'function') return;
    requestingPermission = true; render();
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (!current()) return;
      notificationsEnabled = permission === 'granted';
      permissionStatus.textContent = notificationsEnabled ? 'Browser notifications enabled for this session while the app is open.'
        : 'Browser notifications are not enabled. In-app reminders remain on while the app is open.';
    } catch { if (current()) permissionStatus.textContent = 'Browser notifications are unavailable here. In-app reminders remain on.'; }
    finally { if (current()) { requestingPermission = false; render(); } }
  });
  render();
  const timer = setInterval(render, 15_000);
  document.addEventListener?.('visibilitychange', render);
  return {
    refresh: render,
    dispose() {
      disposed = true; clearInterval(timer); document.removeEventListener?.('visibilitychange', render);
      for (const notification of shownNotifications) { try { notification.close?.(); } catch { /* already closed */ } }
      shownNotifications.clear();
    },
  };
}
