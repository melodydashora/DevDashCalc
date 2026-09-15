// Optional Canvas setup for the signed-in workspace. Adapters enforce ownership;
// this component keeps only a nonsecret connection summary between requests.
let nextCardId = 0;

const text = value => typeof value === 'string' ? value.slice(0, 1000) : '';
function connectionSummary(value) {
  return { connected: value?.connected === true, userName: text(value?.userName),
    host: text(value?.host), remembered: value?.remembered === true,
    prepared: value?.prepared === true, notice: text(value?.notice), retryDisconnect: value?.retryDisconnect === true };
}

function schoolOrigin(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash ? url.origin : '';
  } catch { return ''; }
}

export function mountCanvasAccount(root, { profileName, loadConnection, connect, disconnect }) {
  let disposed = false;
  let pending = false;
  let generation = 0;
  let summary = connectionSummary(null);
  const id = `canvas-account-${++nextCardId}`;
  root.innerHTML = `<h2>Canvas connection</h2>
    <p class="canvas-account-profile"></p>
    <p>Canvas is optional. Lessons, practice, and mastery checks are available without Canvas.</p>
    <p><a class="btn secondary" href="#/home">Continue learning</a></p>
    <p class="canvas-account-identity">Checking your Canvas connection.</p>
    <p class="canvas-account-details session-progress"></p>
    <p class="canvas-account-notice session-progress"></p>
    <div class="btn-row">
      <button type="button" class="secondary canvas-account-edit" aria-expanded="false" aria-controls="${id}-form">Add Canvas token</button>
      <button type="button" class="quiet canvas-account-disconnect" hidden>Disconnect Canvas</button>
    </div>
    <form id="${id}-form" class="canvas-account-form" hidden>
      <label for="${id}-url">School Canvas HTTPS URL</label>
      <input id="${id}-url" name="baseUrl" type="url" required maxlength="2048" autocomplete="url" spellcheck="false" placeholder="https://school.instructure.com">
      <label for="${id}-token">Canvas access token</label>
      <input id="${id}-token" name="token" type="password" required maxlength="2048" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="${id}-help">
      <p id="${id}-help" class="session-progress">Your token is sent to the Students4AI server, then to your school to verify the connection. Your saved token is never shown here.</p>
      <label class="canvas-account-remember"><input name="remember" type="checkbox" checked> Remember this connection for my account on any device</label>
      <p class="session-progress">Without Remember, the connection lasts up to 8 hours or until the server restarts.</p>
      <div class="btn-row"><button type="submit">Verify and save Canvas connection</button><button type="button" class="quiet canvas-account-cancel">Cancel</button></div>
    </form>
    <p class="canvas-account-status" role="status" aria-live="polite"></p>`;
  const profile = root.querySelector('.canvas-account-profile');
  const identity = root.querySelector('.canvas-account-identity');
  const details = root.querySelector('.canvas-account-details');
  const notice = root.querySelector('.canvas-account-notice');
  const status = root.querySelector('.canvas-account-status');
  const form = root.querySelector('form');
  const urlInput = form.elements.baseUrl;
  const tokenInput = form.elements.token;
  const rememberInput = form.elements.remember;
  const edit = root.querySelector('.canvas-account-edit');
  const remove = root.querySelector('.canvas-account-disconnect');
  const cancel = root.querySelector('.canvas-account-cancel');
  const submit = form.querySelector('button');
  profile.textContent = profileName ? `For ${text(profileName)}.` : 'For your learning workspace.';

  function showForm(show) {
    form.hidden = !show;
    edit.setAttribute('aria-expanded', String(show));
  }
  function busy(value) {
    pending = value;
    form.setAttribute('aria-busy', String(value));
    for (const control of [edit, remove, cancel, submit, urlInput, tokenInput, rememberInput]) control.disabled = value;
  }
  function renderSummary() {
    identity.textContent = summary.connected
      ? `Connected${summary.userName ? ` as ${summary.userName}` : ''}${summary.host ? ` to ${summary.host}` : ''}.`
      : 'Canvas is not connected.';
    details.textContent = summary.prepared
      ? 'This Canvas connection was prepared for your learning workspace.'
      : summary.connected ? summary.remembered
        ? 'This connection is saved for your account on any device.'
        : 'This connection lasts up to 8 hours or until the server restarts.' : '';
    notice.textContent = summary.notice;
    notice.hidden = !summary.notice;
    edit.textContent = summary.connected ? 'Update Canvas token' : 'Add Canvas token';
    remove.hidden = !summary.connected && !summary.retryDisconnect;
    remove.textContent = summary.retryDisconnect ? 'Retry removing saved connection' : 'Disconnect Canvas';
    // Initial connection loading must not replace a school address being typed.
    if (!urlInput.value && summary.host) {
      const host = summary.host.startsWith('https://') ? summary.host : `https://${summary.host}`;
      urlInput.value = schoolOrigin(host);
    }
  }

  edit.addEventListener('click', () => {
    if (disposed || pending) return;
    showForm(true);
    (urlInput.value ? tokenInput : urlInput).focus();
  });
  cancel.addEventListener('click', () => {
    if (disposed || pending) return;
    tokenInput.value = '';
    showForm(false);
    status.textContent = '';
    edit.focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (disposed || pending) return;
    const baseUrl = schoolOrigin(urlInput.value);
    let token = tokenInput.value.trim();
    tokenInput.value = '';
    if (!baseUrl || !token || token.length > 2048) {
      status.textContent = !baseUrl
        ? 'Enter your school Canvas HTTPS address without a page path, then enter your token again.'
        : 'Enter a Canvas access token with no more than 2048 characters.';
      token = '';
      (!baseUrl ? urlInput : tokenInput).focus();
      return;
    }
    const current = ++generation;
    busy(true);
    status.textContent = 'Verifying and saving your Canvas connection.';
    try {
      const request = connect({ baseUrl, token, remember: rememberInput.checked });
      token = '';
      const result = await request;
      if (disposed || current !== generation) return;
      if (!result?.connected) throw new Error('Connection was not verified.');
      summary = connectionSummary(result);
      renderSummary();
      showForm(false);
      status.textContent = 'Your Canvas connection is ready.';
    } catch {
      if (!disposed && current === generation) {
        status.textContent = 'Canvas could not confirm the updated connection. Check your school address and token, then try again. You can continue learning.';
        showForm(true);
      }
    } finally {
      token = '';
      if (!disposed && current === generation) { busy(false); if (!form.hidden) tokenInput.focus(); }
    }
  });
  remove.addEventListener('click', async () => {
    if (disposed || pending || (!summary.connected && !summary.retryDisconnect)) return;
    const current = ++generation;
    tokenInput.value = '';
    busy(true);
    status.textContent = 'Disconnecting Canvas.';
    try {
      const result = await disconnect();
      if (disposed || current !== generation) return;
      summary = connectionSummary(result);
      renderSummary();
      showForm(false);
      status.textContent = summary.connected ? 'Canvas connection status updated.' : 'Canvas is disconnected. Your lessons and saved progress are still available.';
    } catch {
      if (!disposed && current === generation) status.textContent = 'Canvas disconnect could not be confirmed. Try again when the server is available.';
    } finally { if (!disposed && current === generation) busy(false); }
  });

  const initialGeneration = generation;
  Promise.resolve().then(() => { if (!disposed && initialGeneration === generation) return loadConnection(); }).then(result => {
    if (disposed || initialGeneration !== generation) return;
    summary = connectionSummary(result);
    renderSummary();
  }).catch(() => {
    if (disposed || initialGeneration !== generation) return;
    identity.textContent = 'Canvas connection status is unavailable.';
    status.textContent = 'Canvas status could not load. You can enter a token to connect, or continue learning.';
  });
  return () => { disposed = true; generation++; tokenInput.value = ''; };
}
