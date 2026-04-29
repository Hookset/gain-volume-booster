// options.js

// ── Helpers ──────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

async function requestSitePermission(hostname) {
  const patterns = getSitePatterns(hostname);
  if (!patterns.length) return false;

  try {
    return await browser.permissions.request({ origins: patterns });
  } catch (e) {
    return false;
  }
}

async function removeSitePermission(hostname) {
  const patterns = getSitePatterns(hostname);
  if (!patterns.length) return false;

  try {
    return await browser.permissions.remove({ origins: patterns });
  } catch (e) {
    return false;
  }
}

// ── Dark mode ─────────────────────────────────────────

const darkTrack = document.getElementById('darkTrack');

function applyDark(on) {
  document.body.classList.toggle('dark', on);
  darkTrack.classList.toggle('on', on);
}

browser.storage.local.get('darkMode', (d) => applyDark(!!d.darkMode));

document.getElementById('darkToggle').addEventListener('click', () => {
  const on = !document.body.classList.contains('dark');
  applyDark(on);
  browser.storage.local.set({ darkMode: on });
});

// ── Tab navigation ─────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('panel-' + item.dataset.tab).classList.add('active');
  });
});

// ── Domain list rendering ──────────────────────────────

function renderList(listEl, domains, storageKey) {
  listEl.replaceChildren();
  if (!domains.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No sites added yet.';
    listEl.appendChild(emptyState);
    return;
  }
  domains.forEach((domain) => {
    const item = document.createElement('div');
    item.className = 'domain-item';
    const name = document.createElement('span');
    name.className = 'domain-name';
    name.textContent = domain;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '✕';

    removeBtn.addEventListener('click', async () => {
      const idx = domains.indexOf(domain);
      if (idx !== -1) domains.splice(idx, 1);
      if (storageKey === 'whitelist') {
        await removeSitePermission(domain);
      }
      browser.storage.local.set({ [storageKey]: domains });
      renderList(listEl, domains, storageKey);
      showToast('Site removed');
    });
    item.appendChild(name);
    item.appendChild(removeBtn);
    listEl.appendChild(item);
  });
}

// ── Blacklist ──────────────────────────────────────────

let blacklist = [];
const blacklistList = document.getElementById('blacklistList');
const blacklistInput = document.getElementById('blacklistInput');

browser.storage.local.get('blacklist', (d) => {
  blacklist = d.blacklist || [];
  renderList(blacklistList, blacklist, 'blacklist');
});

function addBlacklist() {
  const domain = normalizeDomain(blacklistInput.value);
  if (!domain) return;
  if (blacklist.includes(domain)) { showToast('Already in list'); return; }
  blacklist.unshift(domain);
  browser.storage.local.set({ blacklist });
  renderList(blacklistList, blacklist, 'blacklist');
  blacklistInput.value = '';
  showToast('Site blacklisted ✓');
}

document.getElementById('blacklistAdd').addEventListener('click', addBlacklist);
blacklistInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBlacklist(); });

// ── Whitelist ──────────────────────────────────────────

let whitelist = [];
const whitelistList = document.getElementById('whitelistList');
const whitelistInput = document.getElementById('whitelistInput');

browser.storage.local.get('whitelist', (d) => {
  whitelist = d.whitelist || [];
  renderList(whitelistList, whitelist, 'whitelist');
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.blacklist) {
    blacklist = changes.blacklist.newValue || [];
    renderList(blacklistList, blacklist, 'blacklist');
  }

  if (changes.whitelist) {
    whitelist = changes.whitelist.newValue || [];
    renderList(whitelistList, whitelist, 'whitelist');
  }

  if (changes.mode) {
    const mode = changes.mode.newValue || 'blacklist';
    modeBlacklist.classList.toggle('selected', mode === 'blacklist');
    modeWhitelist.classList.toggle('selected', mode === 'whitelist');
  }
});

async function addWhitelist() {
  const domain = normalizeDomain(whitelistInput.value);
  if (!domain) return;
  if (whitelist.includes(domain)) { showToast('Already in list'); return; }

  const granted = await requestSitePermission(domain);
  if (!granted) {
    showToast('Site access not granted');
    return;
  }

  whitelist.unshift(domain);
  browser.storage.local.set({ whitelist });
  renderList(whitelistList, whitelist, 'whitelist');
  whitelistInput.value = '';
  showToast('Site whitelisted ✓');
}

document.getElementById('whitelistAdd').addEventListener('click', addWhitelist);
whitelistInput.addEventListener('keydown', e => { if (e.key === 'Enter') addWhitelist(); });

// ── Mode toggle ────────────────────────────────────────

const modeBlacklist = document.getElementById('modeBlacklist');
const modeWhitelist = document.getElementById('modeWhitelist');

browser.storage.local.get('mode', (d) => {
  const mode = d.mode || 'blacklist';
  modeBlacklist.classList.toggle('selected', mode === 'blacklist');
  modeWhitelist.classList.toggle('selected', mode === 'whitelist');
});

modeBlacklist.addEventListener('click', () => {
  modeBlacklist.classList.add('selected');
  modeWhitelist.classList.remove('selected');
  browser.storage.local.set({ mode: 'blacklist' });
  showToast('Blacklist mode enabled');
});

modeWhitelist.addEventListener('click', () => {
  modeWhitelist.classList.add('selected');
  modeBlacklist.classList.remove('selected');
  browser.storage.local.set({ mode: 'whitelist' });
  showToast('Whitelist mode enabled');
});

// ── Default volume slider ──────────────────────────────

const defaultVolSlider = document.getElementById('defaultVolSlider');
const defaultVolVal = document.getElementById('defaultVolVal');
const defaultVolInput = document.getElementById('defaultVolInput');

function updateDefaultVolSlider(val) {
  const pct     = (val / 600) * 100;
  const amber   = val > 250 && val <= 400;
  const red     = val > 400;
  const color   = red ? '#ef4444' : amber ? '#f59e0b' : 'var(--blue)';

  defaultVolSlider.style.background = `linear-gradient(to right, ${color} ${pct}%, var(--border) ${pct}%)`;
  defaultVolSlider.style.setProperty('--thumb-color', color);
  defaultVolVal.textContent  = val + '%';
  defaultVolVal.style.color  = red ? '#ef4444' : amber ? '#f59e0b' : '';

  const warning = document.getElementById('defaultVolWarning');
  if (val > 250) {
    warning.classList.add('show');
    warning.classList.toggle('red', red);
  } else {
    warning.classList.remove('show', 'red');
  }
}

// Reset default volume to 100%
document.getElementById('defaultVolReset').addEventListener('click', () => {
  defaultVolSlider.value = 100;
  updateDefaultVolSlider(100);
  browser.storage.local.set({ defaultVolume: 100 });
  showToast('Reset to 100%');
});

browser.storage.local.get('defaultVolume', (d) => {
  const v = d.defaultVolume ?? 100;
  defaultVolSlider.value = v;
  updateDefaultVolSlider(v);
});

defaultVolSlider.addEventListener('input', () => {
  const v = parseInt(defaultVolSlider.value);
  updateDefaultVolSlider(v);
  browser.storage.local.set({ defaultVolume: v });
});

// Global arrow key handler for default vol slider — works without clicking slider
// Skips if user is typing in any input field
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const step = e.shiftKey ? 10 : 1;
  let v = parseInt(defaultVolSlider.value);
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    e.preventDefault();
    v = Math.min(600, v + step);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    e.preventDefault();
    v = Math.max(0, v - step);
  } else return;
  defaultVolSlider.value = v;
  updateDefaultVolSlider(v);
  browser.storage.local.set({ defaultVolume: v });
});

// Click label → editable input
defaultVolVal.addEventListener('click', () => {
  defaultVolInput.value = parseInt(defaultVolSlider.value);
  defaultVolVal.style.display = 'none';
  defaultVolInput.classList.add('visible');
  defaultVolInput.focus();
  defaultVolInput.select();
});

function commitDefaultVolInput() {
  const v = Math.max(0, Math.min(600, parseInt(defaultVolInput.value) || 0));
  defaultVolInput.classList.remove('visible');
  defaultVolVal.style.display = '';
  defaultVolSlider.value = v;
  updateDefaultVolSlider(v);
  browser.storage.local.set({ defaultVolume: v });
}

defaultVolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitDefaultVolInput();
  if (e.key === 'Escape') {
    defaultVolInput.classList.remove('visible');
    defaultVolVal.style.display = '';
  }
});
defaultVolInput.addEventListener('blur', commitDefaultVolInput);

// ── Small toggles ──────────────────────────────────────

function initToggle(id, storageKey, defaultVal = true) {
  const el = document.getElementById(id);
  browser.storage.local.get(storageKey, (d) => {
    const on = d[storageKey] ?? defaultVal;
    el.classList.toggle('on', on);
  });
  el.addEventListener('click', () => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    browser.storage.local.set({ [storageKey]: on });
    showToast(on ? 'Enabled' : 'Disabled');
  });
}

initToggle('toggleAudioTabs', 'showAudioTabs', true);
initToggle('toggleResetOnUrlChange', 'resetOnUrlChange', true);
initToggle('toggleRemember', 'rememberVolume', false);
initToggle('toggleDonate', 'showDonate', true);
