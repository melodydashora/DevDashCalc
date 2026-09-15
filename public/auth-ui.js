// Account screens never load student progress or Canvas data before sign-in.
// Enrollment tokens live only in memory after being removed from the URL.
let enrollmentToken = '';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function captureEnrollment() {
  if (!location.hash.startsWith('#/signup?')) return;
  const params = new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1));
  enrollmentToken = params.get('enrollment') || '';
  history.replaceState(null, '', `${location.pathname}${location.search}#/signup`);
}

export const hasEnrollment = () => Boolean(enrollmentToken);

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

export function mountAccountGate(root, { session = {}, notice = '', onAuthenticated }) {
  let disposed = false;
  let pending = false;
  const setup = Boolean(enrollmentToken) || (location.hash === '#/signup' && session.allowSelfSignup);
  root.innerHTML = `<section class="account-screen" aria-labelledby="account-title">
    <p class="account-kicker">STUDENTS4AI</p>
    <h1 id="account-title">${setup ? 'Make this learning space yours' : 'Your learning space, wherever you study'}</h1>
    <p>${setup ? (enrollmentToken ? 'Choose a student username and password. Your setup link connects the workspace prepared for you.' : 'Choose a student username and password to start a new learning workspace.') : 'Sign in to open your courses, saved progress, and Canvas connection.'}</p>
    ${!setup && location.hash === '#/signup' ? '<p class="card">Reopen your private account setup link to continue. Setup links are not kept when this page reloads.</p>' : ''}
    ${window.top !== window ? `<p class="card">Open the app in its own tab for student sign-in. <a href="${escape(location.origin + location.pathname + (enrollmentToken ? '#/signup?enrollment=' + encodeURIComponent(enrollmentToken) : '#/login'))}" target="_blank" rel="noopener noreferrer">Open Students4AI</a></p>` : ''}
    <div class="card account-card">
      <h2>${setup ? 'Set up your student account' : 'Student sign-in'}</h2>
      <form id="account-form">
        <label for="account-username">Student username</label>
        <input id="account-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" aria-describedby="username-help">
        <p id="username-help" class="session-progress">3–32 letters, numbers, underscores, or hyphens.</p>
        <label for="account-password">Password</label>
        <input id="account-password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required ${setup ? 'minlength="15"' : ''} maxlength="256" ${setup ? 'aria-describedby="password-help"' : ''}>
        ${setup ? '<p id="password-help" class="session-progress">Use 15 or more characters. A phrase you can remember works well.</p><label for="account-confirm">Confirm password</label><input id="account-confirm" name="confirmPassword" type="password" autocomplete="new-password" required maxlength="256">' : ''}
        <p id="account-message" class="account-message" role="status" aria-live="polite">${escape(notice)}</p>
        <button type="submit">${setup ? 'Create my account' : 'Sign in'}</button>
      </form>
      <p class="session-progress">${setup ? 'Use the same account on your own computer. Your Canvas token stays on the server.' : 'First visit: open the private account setup link provided for you. If you need help signing in, contact the app owner.'}</p>
      ${setup ? '<button type="button" class="quiet" id="account-back">I already have an account</button>' : session.allowSelfSignup ? '<a href="#/signup">Create a student account</a>' : ''}
    </div>
    <p class="account-note">Calculus BC · Calculus AB · Physics<br>Choose your pace. Ask for help. Keep building understanding.</p>
  </section>`;
  const form = root.querySelector('#account-form');
  const status = root.querySelector('#account-message');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || disposed) return;
    const values = new FormData(form);
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
      if (!response.ok || !data.authenticated) {
        status.textContent = data.error || 'Sign-in is temporarily unavailable. Try again in a moment.';
        return;
      }
      if (disposed) return;
      form.reset();
      enrollmentToken = '';
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
    enrollmentToken = '';
    location.hash = '#/login';
  });
  return () => { disposed = true; form.reset(); };
}
