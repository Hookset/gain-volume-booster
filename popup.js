const slider = document.getElementById('volumeSlider');
const volDisplay = document.getElementById('volDisplay');
const volInput = document.getElementById('volInput');
const btnDefault = document.getElementById('btnDefault');
const btnVoice = document.getElementById('btnVoice');
const btnBass = document.getElementById('btnBass');
const btnReset = document.getElementById('btnReset');
const btnGear = document.getElementById('btnGear');
const tabsList = document.getElementById('tabsList');
const blockedBanner = document.getElementById('blockedBanner');
const btnDonate = document.getElementById('btnDonate');
const donateBar = document.getElementById('donateBar');
const siteAccessBox = document.getElementById('siteAccessBox');
const siteAccessText = document.getElementById('siteAccessText');
const btnAllowSite = document.getElementById('btnAllowSite');
const btnDismissSiteAccess = document.getElementById('btnDismissSiteAccess');

let currentTabId = null;
let currentHostname = '';
let currentUrl = '';
let currentMode = 'blacklist';
let blacklist = [];
let whitelist = [];
let voiceActive = false;
let bassActive = false;
let controlsEnabled = false;
let siteAccessDismissed = false;
const DEFAULT_AUDIO_STATE = { volume: 100, bass: false, voice: false };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSafeFaviconUrl(url) {
  if (!url) return '';

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') return url;
  } catch (e) {}

  if (/^data:image\/(?:png|gif|jpe?g|webp|x-icon|vnd\.microsoft\.icon);/i.test(url)) {
    return url;
  }

  return '';
}

function updateSliderFill(val) {
  const pct = (val / 600) * 100;
  const amber = val > 250 && val <= 400;
  const red = val > 400;
  const color = red ? '#ef4444' : amber ? '#f59e0b' : '#3b82f6';
  slider.style.background = `linear-gradient(to right, ${color} ${pct}%, var(--border) ${pct}%)`;
  volDisplay.style.color = red ? '#ef4444' : amber ? '#f59e0b' : '';
}

function sendBadge(volume) {
  if (currentTabId === null) return;
  browser.runtime.sendMessage({ type: 'SET_BADGE', tabId: currentTabId, volume }).catch(() => {});
}

function sendVolume(tabId, volume) {
  return browser.tabs.sendMessage(tabId, { type: 'SET_VOLUME', value: volume }).catch(() => {});
}

function sendBass(tabId, enabled) {
  return browser.tabs.sendMessage(tabId, { type: 'SET_BASS_BOOST', enabled }).catch(() => {});
}

function sendVoice(tabId, enabled) {
  return browser.tabs.sendMessage(tabId, { type: 'SET_VOICE_BOOST', enabled }).catch(() => {});
}

function resetAudio(tabId, state) {
  return browser.tabs.sendMessage(tabId, { type: 'RESET_AUDIO', state }).catch(() => {});
}

async function saveState(volume, bass, voice) {
  const data = await browser.storage.local.get('rememberVolume');
  if (data.rememberVolume === true && currentHostname) {
    await browser.storage.local.set({ [`site_${currentHostname}`]: { volume, bass, voice } });
  }
}

async function applyAudioTabsVisibility() {
  const data = await browser.storage.local.get('showAudioTabs');
  const show = data.showAudioTabs !== false;
  document.querySelector('.tabs-section').style.display = show ? '' : 'none';
}

function setControlsEnabled(enabled) {
  controlsEnabled = enabled;
  document.body.classList.toggle('disabled-ui', !enabled);
  [slider, btnDefault, btnVoice, btnBass, btnReset].forEach((el) => {
    el.disabled = !enabled;
  });
}

function showBlockedBanner(message) {
  blockedBanner.textContent = message;
  blockedBanner.classList.add('show');
}

function hideBlockedBanner() {
  blockedBanner.classList.remove('show');
}

function showSiteAccess(label, description) {
  if (siteAccessDismissed) return;
  btnAllowSite.textContent = label;
  siteAccessText.textContent = description;
  siteAccessBox.classList.add('show');
}

function hideSiteAccess() {
  siteAccessBox.classList.remove('show');
}

function applyVolume(val) {
  val = Math.max(0, Math.min(600, val));
  slider.value = val;
  volDisplay.textContent = `Volume: ${val}%`;
  updateSliderFill(val);

  if (!controlsEnabled || currentTabId === null) return;

  sendVolume(currentTabId, val);
  saveState(val, bassActive, voiceActive);
  sendBadge(val);
}

function resetUiState(volume) {
  voiceActive = false;
  bassActive = false;
  btnVoice.classList.remove('active');
  btnBass.classList.remove('active');
  applyVolume(volume);
}

function initPopupState(state) {
  voiceActive = state.voice || false;
  bassActive = state.bass || false;

  slider.value = state.volume;
  volDisplay.textContent = `Volume: ${state.volume}%`;
  updateSliderFill(state.volume);
  btnVoice.classList.toggle('active', voiceActive);
  btnBass.classList.toggle('active', bassActive);
  sendBadge(state.volume);
}

function isSiteBlocked() {
  if (!currentHostname) return true;

  if (currentMode === 'blacklist') {
    return matchesList(blacklist, currentHostname);
  }

  return !matchesList(whitelist, currentHostname);
}

function currentSiteWhitelisted() {
  return currentHostname ? matchesList(whitelist, currentHostname) : false;
}

async function hasPersistentSiteAccess() {
  const patterns = getSitePatterns(currentHostname);
  if (!patterns.length) return false;

  try {
    return await browser.permissions.contains({ origins: patterns });
  } catch (e) {
    return false;
  }
}

async function getLiveState() {
  if (currentTabId === null) return null;

  try {
    const liveState = await browser.tabs.sendMessage(currentTabId, { type: 'GET_STATE' });
    if (liveState && typeof liveState.volume === 'number') {
      return liveState;
    }
  } catch (e) {}

  return null;
}

async function waitForLiveState() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await getLiveState();
    if (state) return state;
    await delay(100);
  }

  return null;
}

async function ensureInjectedForActiveTab() {
  const existingState = await getLiveState();
  if (existingState) return existingState;

  if (currentTabId === null) return null;

  try {
    await browser.tabs.executeScript(currentTabId, {
      file: 'content.js',
      runAt: 'document_idle'
    });
  } catch (e) {
    return null;
  }

  return waitForLiveState();
}

function isSupportedTabUrl(url) {
  return /^(https?|file):/i.test(url);
}

async function refreshAccessUi() {
  hideSiteAccess();

  if (!currentHostname) return;
  if (matchesList(blacklist, currentHostname)) return;

  const whitelisted = currentSiteWhitelisted();
  const hasAccess = await hasPersistentSiteAccess();

  if (whitelisted && hasAccess) return;

  if (whitelisted && !hasAccess) {
    showSiteAccess('Grant site access', 'This site is whitelisted, but Firefox access has not been granted yet.');
    return;
  }

  if (currentMode !== 'whitelist') return;
  showSiteAccess('Always allow on this site', 'Allow Gain to auto-start on future visits to this site.');
}

async function initializeTabState() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return;

  currentTabId = tabs[0].id;
  currentUrl = tabs[0].url || '';
  currentHostname = getHostnameFromUrl(currentUrl);

  const settings = await browser.storage.local.get(['mode', 'blacklist', 'whitelist']);
  currentMode = settings.mode || 'blacklist';
  blacklist = settings.blacklist || [];
  whitelist = settings.whitelist || [];
  siteAccessDismissed = false;

  try {
    const dismissedUrl = await browser.runtime.sendMessage({
      type: 'GET_DISMISSED_SITE_ACCESS_PROMPT',
      tabId: currentTabId
    });
    siteAccessDismissed = dismissedUrl === currentUrl;
  } catch (e) {}

  if (!isSupportedTabUrl(currentUrl)) {
    showBlockedBanner("Gain can't run on this page.");
    setControlsEnabled(false);
    initPopupState(DEFAULT_AUDIO_STATE);
    return;
  }

  if (isSiteBlocked()) {
    if (currentMode === 'whitelist' && !currentSiteWhitelisted()) {
      showBlockedBanner('Gain is disabled on this site because it is not in your whitelist yet.');
    } else {
      showBlockedBanner('Gain is disabled on this site via your settings.');
    }
    setControlsEnabled(false);
    initPopupState(DEFAULT_AUDIO_STATE);
    await refreshAccessUi();
    return;
  }

  hideBlockedBanner();

  const liveState = await ensureInjectedForActiveTab();
  if (liveState) {
    initPopupState(liveState);
    setControlsEnabled(true);
  } else {
    showBlockedBanner("Gain can't run on this page right now.");
    setControlsEnabled(false);
    initPopupState(DEFAULT_AUDIO_STATE);
  }

  await refreshAccessUi();
}

volDisplay.addEventListener('click', () => {
  if (!controlsEnabled) return;
  volInput.value = parseInt(slider.value, 10);
  volDisplay.style.display = 'none';
  volInput.classList.add('visible');
  volInput.focus();
  volInput.select();
});

function commitVolInput() {
  if (!controlsEnabled) return;
  const val = Math.max(0, Math.min(600, parseInt(volInput.value, 10) || 0));
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

slider.addEventListener('input', () => {
  if (!controlsEnabled) return;
  applyVolume(parseInt(slider.value, 10));
});

document.addEventListener('keydown', (e) => {
  if (!controlsEnabled || document.activeElement === volInput) return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    e.preventDefault();
    applyVolume(parseInt(slider.value, 10) + step);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    e.preventDefault();
    applyVolume(parseInt(slider.value, 10) - step);
  }
});

btnDefault.addEventListener('click', async () => {
  if (!controlsEnabled || currentTabId === null) return;
  const data = await browser.storage.local.get('defaultVolume');
  const vol = data.defaultVolume ?? 100;
  await resetAudio(currentTabId, { volume: vol, bass: false, voice: false });
  resetUiState(vol);
});

btnReset.addEventListener('click', () => {
  if (!controlsEnabled || currentTabId === null) return;
  applyVolume(100);
});

btnVoice.addEventListener('click', async () => {
  if (!controlsEnabled || currentTabId === null) return;
  voiceActive = !voiceActive;
  btnVoice.classList.toggle('active', voiceActive);
  await sendVoice(currentTabId, voiceActive);
  await saveState(parseInt(slider.value, 10), bassActive, voiceActive);
});

btnBass.addEventListener('click', async () => {
  if (!controlsEnabled || currentTabId === null) return;
  bassActive = !bassActive;
  btnBass.classList.toggle('active', bassActive);
  await sendBass(currentTabId, bassActive);
  await saveState(parseInt(slider.value, 10), bassActive, voiceActive);
});

btnAllowSite.addEventListener('click', async () => {
  if (!currentHostname) return;

  const patterns = getSitePatterns(currentHostname);
  if (!patterns.length) return;

  if (!currentSiteWhitelisted()) {
    browser.runtime.sendMessage({
      type: 'ADD_WHITELIST_SITE',
      hostname: currentHostname
    }).catch(() => {});
    whitelist.unshift(currentHostname);
  }

  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: patterns });
  } catch (e) {
    granted = false;
  }

  if (!granted) {
    showBlockedBanner('Firefox did not grant access to this site.');
    await refreshAccessUi();
    return;
  }

  hideBlockedBanner();
  hideSiteAccess();

  const liveState = await ensureInjectedForActiveTab();
  if (liveState) {
    initPopupState(liveState);
    setControlsEnabled(true);
  } else {
    showBlockedBanner('Site access was granted, but Gain could not start on this page yet.');
    setControlsEnabled(false);
  }
});

btnDismissSiteAccess.addEventListener('click', () => {
  siteAccessDismissed = true;
  hideSiteAccess();
  if (currentTabId !== null) {
    browser.runtime.sendMessage({
      type: 'DISMISS_SITE_ACCESS_PROMPT',
      tabId: currentTabId,
      url: currentUrl
    }).catch(() => {});
  }
});

btnGear.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

async function loadAudioTabs() {
  const [tabs, activeTabs] = await Promise.all([
    browser.tabs.query({ audible: true }),
    browser.tabs.query({ active: true, currentWindow: true })
  ]);
  const activeTabId = activeTabs.length ? activeTabs[0].id : currentTabId;

  if (!tabs.length) {
    const noTabs = document.createElement('p');
    noTabs.className = 'no-tabs';
    noTabs.textContent = 'No tabs playing audio.';
    tabsList.replaceChildren(noTabs);
    return;
  }

  tabsList.replaceChildren();
  tabs.forEach((tab) => {
    const item = document.createElement('div');
    item.className = 'tab-item' + (tab.id === activeTabId ? ' current' : '');

    let favEl;
    const faviconUrl = getSafeFaviconUrl(tab.favIconUrl);
    if (faviconUrl) {
      favEl = document.createElement('img');
      favEl.className = 'tab-favicon';
      favEl.src = faviconUrl;
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
}

browser.storage.local.get('darkMode').then((data) => {
  if (data.darkMode) {
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

loadAudioTabs();
applyAudioTabsVisibility();
setInterval(loadAudioTabs, 2000);

btnDonate.addEventListener('click', () => {
  browser.tabs.create({ url: 'https://github.com/Hookset/gain-volume-booster#support' });
  window.close();
});

browser.storage.local.get('showDonate').then((data) => {
  donateBar.style.display = data.showDonate === false ? 'none' : '';
});

initializeTabState();
