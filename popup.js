// popup.js

const slider      = document.getElementById('volumeSlider');
const volDisplay  = document.getElementById('volDisplay');
const volInput    = document.getElementById('volInput');
const btnDefault  = document.getElementById('btnDefault');
const btnVoice    = document.getElementById('btnVoice');
const btnBass     = document.getElementById('btnBass');
const btnReset    = document.getElementById('btnReset');
const btnGear     = document.getElementById('btnGear');
const tabsList    = document.getElementById('tabsList');
const blockedBanner = document.getElementById('blockedBanner');
const btnDonate   = document.getElementById('btnDonate');
const donateBar   = document.getElementById('donateBar');

// ── Dark mode ──────────────────────────────────────────

browser.storage.local.get('darkMode', (d) => {
  if (d.darkMode) {
    document.body.classList.add('dark');
    document.getElementById('btnDark').textContent = '☀️';
  }
});

document.getElementById('btnDark').addEventListener('click', () => {
  const on = !document.body.classList.contains('dark');
  document.body.classList.toggle('dark', on);
  document.getElementById('btnDark').textContent = on ? '☀️' : '🌙';
  browser.storage.local.set({ darkMode: on });
});

// ── State ──────────────────────────────────────────────

let currentTabId    = null;
let currentHostname = null;
let voiceActive     = false;
let bassActive      = false;
let lastBadgeVolume = -1;

// ── Slider fill + tiered colour warning ──────────────

function updateSliderFill(val) {
  const pct   = (val / 600) * 100;
  const amber = val > 250 && val <= 400;
  const red   = val > 400;
  const color = red ? '#ef4444' : amber ? '#f59e0b' : '#3b82f6';
  slider.style.background    = `linear-gradient(to right, ${color} ${pct}%, var(--border) ${pct}%)`;
  volDisplay.style.color     = red ? '#ef4444' : amber ? '#f59e0b' : '';
}

// ── Core volume setter ────────────────────────────────

function applyVolume(val) {
  val = Math.max(0, Math.min(600, val));
  slider.value = val;
  volDisplay.textContent = `Volume: ${val}%`;
  updateSliderFill(val);
  if (currentTabId !== null) {
    sendVolume(currentTabId, val);
    saveState(val, bassActive, voiceActive);
    // Throttle badge: only update if changed by ≥5%, or snapping back to 100
    if (Math.abs(val - lastBadgeVolume) >= 5 || val === 100) {
      lastBadgeVolume = val;
      browser.runtime.sendMessage({ type: 'SET_BADGE', tabId: currentTabId, volume: val });
    }
  }
}

// ── Click-to-type volume ──────────────────────────────

volDisplay.addEventListener('click', () => {
  volInput.value = parseInt(slider.value);
  volDisplay.style.display = 'none';
  volInput.classList.add('visible');
  volInput.focus();
  volInput.select();
});

function commitVolInput() {
  const val = Math.max(0, Math.min(600, parseInt(volInput.value) || 0));
  volInput.classList.remove('visible');
  volDisplay.style.display = '';
  applyVolume(val);
}

volInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitVolInput();
  if (e.key === 'Escape') {
    volInput.classList.remove('visible');
    volDisplay.style.display = '';
  }
});
volInput.addEventListener('blur', commitVolInput);

// ── Messaging ─────────────────────────────────────────

function sendVolume(tabId, volume) {
  browser.tabs.sendMessage(tabId, { type: 'SET_VOLUME', value: volume }).catch(() => {});
}
function sendBass(tabId, enabled) {
  browser.tabs.sendMessage(tabId, { type: 'SET_BASS_BOOST', enabled }).catch(() => {});
}
function sendVoice(tabId, enabled) {
  browser.tabs.sendMessage(tabId, { type: 'SET_VOICE_BOOST', enabled }).catch(() => {});
}

// ── Domain-keyed state (not ephemeral tab ID) ─────────

function saveState(volume, bass, voice) {
  browser.storage.local.get('rememberVolume', (d) => {
    if (d.rememberVolume === true && currentHostname) {
      browser.storage.local.set({ [`site_${currentHostname}`]: { volume, bass, voice } });
    }
  });
}

function loadState(cb) {
  const key = `site_${currentHostname}`;
  browser.storage.local.get(['rememberVolume', 'defaultVolume', key], (result) => {
    const remember   = result.rememberVolume === true;
    const defaultVol = result.defaultVolume ?? 100;
    const saved      = result[key];
    cb(remember && saved ? saved : { volume: defaultVol, bass: false, voice: false });
  });
}

// ── Audio tabs visibility ─────────────────────────────

function applyAudioTabsVisibility() {
  browser.storage.local.get('showAudioTabs', (d) => {
    const show = d.showAudioTabs !== false;
    document.querySelector('.tabs-section').style.display = show ? '' : 'none';
  });
}

// ── Init with current tab ─────────────────────────────

browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs.length) return;
  currentTabId = tabs[0].id;
  try {
    currentHostname = new URL(tabs[0].url).hostname.replace(/^www\./, '');
  } catch (e) {
    currentHostname = '';
  }
  checkSiteBlocked(currentHostname);

  // First ask the content script what's actually playing right now
  browser.tabs.sendMessage(currentTabId, { type: 'GET_STATE' })
    .then((liveState) => {
      if (liveState && typeof liveState.volume === 'number') {
        initPopupState(liveState);
      } else {
        loadState(initPopupState);
      }
    })
    .catch(() => {
      loadState(initPopupState);
    });
});

function initPopupState(state) {
  voiceActive = state.voice || state.voiceBoost || false;
  bassActive  = state.bass  || state.bassBoost  || false;

  slider.value = state.volume;
  volDisplay.textContent = `Volume: ${state.volume}%`;
  updateSliderFill(state.volume);
  btnVoice.classList.toggle('active', voiceActive);
  btnBass.classList.toggle('active', bassActive);

  // Don't push volume back — content script already has it right
  // Only sync boosts if needed
  lastBadgeVolume = state.volume;
  browser.runtime.sendMessage({ type: 'SET_BADGE', tabId: currentTabId, volume: state.volume });
}

// ── Slider ────────────────────────────────────────────

slider.addEventListener('input', () => {
  applyVolume(parseInt(slider.value));
});

// Global arrow key handler — works as soon as popup is open
// Skips if user is typing in the vol input field
document.addEventListener('keydown', (e) => {
  if (document.activeElement === volInput) return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    e.preventDefault();
    applyVolume(parseInt(slider.value) + step);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    e.preventDefault();
    applyVolume(parseInt(slider.value) - step);
  }
});

// ── Buttons ───────────────────────────────────────────

btnDefault.addEventListener('click', () => {
  voiceActive = false;
  bassActive  = false;
  btnVoice.classList.remove('active');
  btnBass.classList.remove('active');
  if (currentTabId !== null) {
    sendBass(currentTabId, false);
    sendVoice(currentTabId, false);
  }
  applyVolume(100);
});

btnReset.addEventListener('click', () => {
  applyVolume(100);
});

btnVoice.addEventListener('click', () => {
  voiceActive = !voiceActive;
  btnVoice.classList.toggle('active', voiceActive);
  if (currentTabId !== null) {
    sendVoice(currentTabId, voiceActive);
    saveState(parseInt(slider.value), bassActive, voiceActive);
  }
});

btnBass.addEventListener('click', () => {
  bassActive = !bassActive;
  btnBass.classList.toggle('active', bassActive);
  if (currentTabId !== null) {
    sendBass(currentTabId, bassActive);
    saveState(parseInt(slider.value), bassActive, voiceActive);
  }
});

btnGear.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

// ── Site blocked check ────────────────────────────────

function checkSiteBlocked(hostname) {
  browser.storage.local.get(['mode', 'blacklist', 'whitelist'], (data) => {
    const mode      = data.mode      || 'blacklist';
    const blacklist = data.blacklist || [];
    const whitelist = data.whitelist || [];
    let blocked = false;
    if (mode === 'blacklist') {
      blocked = blacklist.some(d => hostname === d || hostname.endsWith('.' + d));
    } else {
      blocked = whitelist.length > 0 && !whitelist.some(d => hostname === d || hostname.endsWith('.' + d));
    }
    if (blocked) blockedBanner.classList.add('show');
  });
}

// ── Audio tabs list ───────────────────────────────────

function loadAudioTabs() {
  browser.tabs.query({ audible: true }, (tabs) => {
    if (!tabs.length) {
      tabsList.innerHTML = '<p class="no-tabs">No tabs playing audio.</p>';
      return;
    }
    tabsList.innerHTML = '';
    tabs.forEach((tab) => {
      const item = document.createElement('div');
      item.className = 'tab-item' + (tab.id === currentTabId ? ' current' : '');

      let favEl;
      if (tab.favIconUrl) {
        favEl = document.createElement('img');
        favEl.className = 'tab-favicon';
        favEl.src = tab.favIconUrl;
        favEl.onerror = () => { favEl.style.display = 'none'; };
      } else {
        favEl = document.createElement('div');
        favEl.className = 'tab-favicon-placeholder';
        favEl.textContent = '🔊';
      }

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || tab.url;

      item.appendChild(favEl);
      item.appendChild(title);
      item.addEventListener('click', () => {
        browser.tabs.update(tab.id, { active: true });
        window.close();
      });
      tabsList.appendChild(item);
    });
  });
}

loadAudioTabs();
applyAudioTabsVisibility();
setInterval(loadAudioTabs, 2000);

// ── Donate button ─────────────────────────────────────

btnDonate.addEventListener('click', () => {
  browser.tabs.create({ url: 'https://github.com/Hookset/gain-volume-booster#support' });
  window.close();
});

browser.storage.local.get('showDonate', (d) => {
  donateBar.style.display = d.showDonate === false ? 'none' : '';
});
