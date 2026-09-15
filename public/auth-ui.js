// Account screens never load student progress or Canvas data before sign-in.
// Keep an invitation in this tab across reloads; never store account passwords.
import { createEnrollmentSetup, parseEnrollmentInput } from './enrollment-setup.js';
let setupState;
let invitationEntry = false;
function enrollment() {
  if (!setupState) {
    let storage;
    try { storage = window.sessionStorage; } catch { /* The original setup fragment is the fallback. */ }
    setupState = createEnrollmentSetup({ location, history, storage });
  }
  return setupState;
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function captureEnrollment() {
  const explicitInvitation = location.hash.startsWith('#/signup?');
  if (!isSignupRoute() || explicitInvitation) invitationEntry = false;
  const captured = enrollment().capture();
  if (explicitInvitation && !captured) invitationEntry = true;
  return captured;
}

export const isSignupRoute = () => location.hash.split('?')[0] === '#/signup';
// Changing setup mode or invitation must replace the rendered form.
export const accountGateKey = () => `${isSignupRoute() ? 'signup' : 'login'}:${enrollment().token() || (invitationEntry ? 'invitation' : '')}`;

export async function apiFetch(path, options) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    const data = await response.clone().json().catch(() => ({}));
    if (data.code === 'authentication_required') window.dispatchEvent(new Event('students4ai-auth-required'));
  }
  return response;
}

export async function getAccountSession() {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('Student sign-in is temporarily unavailable. Your saved work has not been changed.');
  return response.json();
}

export function mountAccountGate(root, { session = {}, notice = '', onAuthenticated, onSetupChanged }) {
  let disposed = false;
  let pending = false;
  const setup = isSignupRoute();
  const enrollmentToken = enrollment().token();
  const needsInvitation = setup && !enrollmentToken && (!session.allowSelfSignup || invitationEntry);
  root.innerHTML = `<section class="account-screen" aria-labelledby="account-title">
    <p class="account-kicker">STUDENTS4AI</p>
    <h1 id="account-title">${setup ? 'Make this learning space yours' : 'Your learning space, wherever you study'}</h1>
    <p>${setup ? (needsInvitation ? 'Use your invitation to connect to the classes and progress prepared for you.' : enrollmentToken ? 'Choose a student username and password. Your invitation connects the workspace prepared for you.' : 'Choose a student username and password to start a new learning workspace.') : 'Sign in to open your courses, saved progress, and Canvas connection.'}</p>
    ${setup && session.authenticated ? `<p class="card">This browser is signed in as ${escape(session.user?.username)}. Creating another student account will switch this browser to that student.</p>` : ''}
    ${window.top !== window ? `<p class="card">Open the app in its own tab to ${setup ? 'create your account' : 'sign in'}. <a href="${escape(location.origin + location.pathname + (setup ? enrollmentToken ? '#/signup?enrollment=' + encodeURIComponent(enrollmentToken) : '#/signup' : '#/login'))}" target="_blank" rel="noopener noreferrer">Open Students4AI</a></p>` : ''}
    <div class="card account-card">
      <h2>${setup ? 'Set up your student account' : 'Student sign-in'}</h2>
      <form id="account-form">
        ${needsInvitation ? `<label for="account-invitation">Your setup link or invitation code</label>
        <input id="account-invitation" name="invitation" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="2048" aria-describedby="invitation-help">
        <p id="invitation-help" class="session-progress">Paste the private link provided for you, or its invitation code. Use your own invitation so your existing work stays with you. To get an invitation, ask the person who set up your learning space.</p>` : `
        <label for="account-username">Student username</label>
        <input id="account-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" aria-describedby="username-help">
        <p id="username-help" class="session-progress">3–32 letters, numbers, underscores, or hyphens.</p>
        <label for="account-password">Password</label>
        <input id="account-password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required ${setup ? 'minlength="15"' : ''} maxlength="256" ${setup ? 'aria-describedby="password-help"' : ''}>
        ${setup ? '<p id="password-help" class="session-progress">Use 15 or more characters. A phrase you can remember works well.</p><label for="account-confirm">Confirm password</label><input id="account-confirm" name="confirmPassword" type="password" autocomplete="new-password" required maxlength="256">' : ''}`}
        <p id="account-message" class="account-message" role="status" aria-live="polite">${escape(notice)}</p>
        <button type="submit">${needsInvitation ? 'Continue to account setup' : setup ? 'Create my account' : 'Sign in'}</button>
      </form>
      ${setup && enrollmentToken ? '<p class="session-progress">Your invitation is ready. You can refresh this tab and continue setup.</p><button type="button" class="quiet" id="account-change-invitation">Use a different invitation</button>' : ''}
      ${setup && session.allowSelfSignup && !enrollmentToken ? needsInvitation ? '<button type="button" class="quiet" id="account-new-workspace">Create a new learning workspace</button>' : '<p class="session-progress">If a learning workspace was already prepared for you, use its setup invitation to keep your existing work.</p><button type="button" class="quiet" id="account-use-invitation">Use a setup invitation</button>' : ''}
      <p class="session-progress">${setup ? 'After setup, use your account on any of your devices.' : 'Create your student account to get started.'}</p>
      ${setup ? '<button type="button" class="quiet account-switch" id="account-back">I already have an account — sign in</button>' : '<a class="account-switch" href="#/signup">Create account</a>'}
    </div>
    <p class="account-note">Your classes. Your pace.<br>Ask for help. Keep building understanding.</p>
  </section>`;
  const form = root.querySelector('#account-form');
  const status = root.querySelector('#account-message');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || disposed) return;
    const values = new FormData(form);
    if (needsInvitation) {
      const token = parseEnrollmentInput(values.get('invitation'), location.origin);
      if (!token) {
        status.textContent = 'Paste your complete Students4AI setup link or its 43-character invitation code.';
        form.elements.invitation.setAttribute('aria-invalid', 'true');
        form.elements.invitation.focus();
        return;
      }
      enrollment().remember(token);
      onSetupChanged('');
      return;
    }
    const password = String(values.get('password') || '');
    if (setup && password !== values.get('confirmPassword')) {
      status.textContent = 'The passwords do not match. Enter the same password in both fields.';
      form.elements.confirmPassword.setAttribute('aria-invalid', 'true');
      form.elements.confirmPassword.focus();
      return;
    }
    form.elements.confirmPassword?.removeAttribute('aria-invalid');
    if (setup && ([...password].length < 15 || [...password].length > 128)) { status.textContent = 'Use 15 to 128 characters for your password.'; return; }
    pending = true;
    form.setAttribute('aria-busy', 'true');
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = setup ? 'Creating your account and opening your workspace.' : 'Opening your workspace.';
    try {
      const response = await fetch(`/api/auth/${setup ? 'register' : 'login'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: String(values.get('username') || '').trim(), password, ...(setup && enrollmentToken ? { enrollmentToken } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (disposed) return;
      if (!response.ok || !data.authenticated) {
        if (setup && ['INVALID_ENROLLMENT', 'ENROLLMENT_REQUIRED', 'WORKSPACE_ALREADY_OWNED'].includes(data.code)) {
          enrollment().clear();
          invitationEntry = true;
          onSetupChanged(data.error || 'This invitation is unavailable. Use a new invitation, or sign in if you already created your account.');
          return;
        }
        status.textContent = data.error || 'Sign-in is temporarily unavailable. Try again in a moment.';
        return;
      }
      if (disposed) return;
      form.reset();
      enrollment().clear();
      invitationEntry = false;
      await onAuthenticated(data);
    } catch {
      if (!disposed) status.textContent = 'Sign-in could not reach the server. Check your connection and try again.';
    } finally {
      pending = false;
      form.removeAttribute('aria-busy');
      if (!disposed) button.disabled = false;
    }
  });
  root.querySelector('#account-back')?.addEventListener('click', () => {
    if (pending || disposed) return;
    enrollment().clear();
    invitationEntry = false;
    location.hash = '#/login';
    onSetupChanged('');
  });
  const useInvitation = () => {
    if (pending || disposed) return;
    enrollment().clear();
    invitationEntry = true;
    onSetupChanged('');
  };
  root.querySelector('#account-change-invitation')?.addEventListener('click', useInvitation);
  root.querySelector('#account-use-invitation')?.addEventListener('click', useInvitation);
  root.querySelector('#account-new-workspace')?.addEventListener('click', () => {
    if (pending || disposed) return;
    enrollment().clear();
    invitationEntry = false;
    onSetupChanged('');
  });
  return () => { disposed = true; form.reset(); };
}
