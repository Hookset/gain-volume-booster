const slider = document.getElementById('volumeSlider');
const volDisplay = document.getElementById('volDisplay');
const volInput = document.getElementById('volInput');
const btnDefault = document.getElementById('btnDefault');
const btnVoice = document.getElementById('btnVoice');
const btnBass = document.getElementById('btnBass');
const btnReset = document.getElementById('btnReset');
const btnMergedDefault = document.getElementById('btnMergedDefault');
const btnMergedReset = document.getElementById('btnMergedReset');
const btnGear = document.getElementById('btnGear');
const tabsList = document.getElementById('tabsList');
const blockedBanner = document.getElementById('blockedBanner');
const btnDonate = document.getElementById('btnDonate');
const siteAccessBox = document.getElementById('siteAccessBox');
const siteAccessText = document.getElementById('siteAccessText');
const btnAllowSite = document.getElementById('btnAllowSite');
const btnDismissSiteAccess = document.getElementById('btnDismissSiteAccess');
const popupTooltip = document.getElementById('popupTooltip');

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
let popupClosing = false;

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
  const pct = (val / VOL_MAX) * 100;
  const warnColor = volColor(val);
  const fillColor = warnColor || '#3b82f6';
  slider.style.background = `linear-gradient(to right, ${fillColor} ${pct}%, var(--border) ${pct}%)`;
  volDisplay.style.color = warnColor || '';
}

function sendBadge(volume) {
  if (currentTabId === null) return;
  browser.runtime.sendMessage({ type: MSG.SET_BADGE, tabId: currentTabId, volume }).catch(() => {});
}

function sendVolume(tabId, volume) {
  return browser.tabs.sendMessage(tabId, { type: MSG.SET_VOLUME, value: volume }).catch(() => {});
}

function sendBass(tabId, enabled) {
  return browser.tabs.sendMessage(tabId, { type: MSG.SET_BASS_BOOST, enabled }).catch(() => {});
}

function sendVoice(tabId, enabled) {
  return browser.tabs.sendMessage(tabId, { type: MSG.SET_VOICE_BOOST, enabled }).catch(() => {});
}

function resetAudio(tabId, state) {
  return browser.tabs.sendMessage(tabId, { type: MSG.RESET_AUDIO, state }).catch(() => {});
}

async function saveState(volume, bass, voice) {
  const state = { volume, bass, voice };
  if (currentTabId !== null) {
    browser.runtime.sendMessage({
      type: MSG.SET_TAB_AUDIO_STATE,
      tabId: currentTabId,
      url: currentUrl,
      hostname: currentHostname,
      state
    }).catch(() => {});
  }

  const data = await browser.storage.local.get('rememberVolume');
  if (data.rememberVolume === true && currentHostname) {
    await browser.storage.local.set({ [`site_${currentHostname}`]: state });
  }
}

async function applyAudioTabsVisibility() {
  const data = await browser.storage.local.get('showAudioTabs');
  const show = data.showAudioTabs !== false;
  document.querySelector('.tabs-section').style.display = show ? '' : 'none';
}

async function applyBoostButtonsVisibility() {
  const data = await browser.storage.local.get('showBoostButtons');
  const show = data.showBoostButtons !== false;
  document.getElementById('boostRow').style.display = show ? '' : 'none';
  document.getElementById('resetRow').style.display = show ? '' : 'none';
  document.getElementById('mergedRow').style.display = show ? 'none' : 'flex';
}

async function applyPopupTooltipVisibility() {
  const data = await browser.storage.local.get('showPopupTooltip');
  const show = data.showPopupTooltip !== false;
  popupTooltip.classList.toggle('hidden', !show);
  document.body.classList.toggle('tooltip-hidden', !show);
}

function setControlsEnabled(enabled) {
  controlsEnabled = enabled;
  document.body.classList.toggle('disabled-ui', !enabled);
  [slider, btnDefault, btnVoice, btnBass, btnReset, btnMergedDefault, btnMergedReset].forEach((el) => {
    el.disabled = !enabled;
  });
}

function closePopupForTabChange() {
  if (popupClosing) return;
  popupClosing = true;
  setControlsEnabled(false);
  window.close();
}

function handleActiveTabChanged({ tabId }) {
  if (currentTabId === null) return;
  if (tabId !== currentTabId) closePopupForTabChange();
}

browser.tabs.onActivated.addListener(handleActiveTabChanged);

window.addEventListener('unload', () => {
  browser.tabs.onActivated.removeListener(handleActiveTabChanged);
});

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

function clampVolume(val) {
  return Math.max(0, Math.min(VOL_MAX, val));
}

function renderVolume(val) {
  val = clampVolume(val);
  slider.value = val;
  volDisplay.textContent = `Volume: ${val}%`;
  updateSliderFill(val);
  return val;
}

function commitVolume(val, { persist = true } = {}) {
  if (popupClosing || !controlsEnabled || currentTabId === null) return;

  val = clampVolume(val);

  sendVolume(currentTabId, val);
  if (persist) {
    saveState(val, bassActive, voiceActive).catch(() => {});
  }
  sendBadge(val);
}

function applyVolume(val, options) {
  val = renderVolume(val);
  commitVolume(val, options);
}

function resetUiState(volume) {
  voiceActive = false;
  bassActive = false;
  btnVoice.classList.remove('active');
  btnBass.classList.remove('active');
  applyVolume(volume);
}

function setPopupSliderState(state) {
  voiceActive = state.voice || false;
  bassActive = state.bass || false;

  slider.value = state.volume;
  volDisplay.textContent = `Volume: ${state.volume}%`;
  updateSliderFill(state.volume);
  btnVoice.classList.toggle('active', voiceActive);
  btnBass.classList.toggle('active', bassActive);
}

function initPopupState(state) {
  setPopupSliderState(state);
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


async function getLiveState() {
  if (currentTabId === null) return null;

  try {
    // Returns either a real audio state ({ volume, ... }) or { orphaned: true }
    // from a post-reload content script that bailed to avoid double-audio.
    const liveState = await browser.tabs.sendMessage(currentTabId, { type: MSG.GET_STATE });
    if (liveState && (typeof liveState.volume === 'number' || liveState.orphaned)) {
      return liveState;
    }
  } catch (e) {}

  return null;
}

// Read the still-playing volume of an orphaned graph from saved per-tab
// state, so the popup can display the real level instead of a blank/100.
async function getOrphanedDisplayState() {
  if (currentTabId === null) return { ...DEFAULT_AUDIO_STATE };
  try {
    const key = TAB_AUDIO_STATE_PREFIX + currentTabId;
    const data = await browser.storage.local.get(key);
    const entry = data[key];
    if (entry && entry.state && typeof entry.state.volume === 'number') {
      return entry.state;
    }
  } catch (e) {}
  return { ...DEFAULT_AUDIO_STATE };
}

async function waitForLiveState() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await getLiveState();
    if (state) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

async function ensureInjectedForActiveTab() {
  const existingState = await getLiveState();
  if (existingState) return existingState;

  if (currentTabId === null) return null;

  try {
    await browser.tabs.executeScript(currentTabId, { file: 'site-utils.js', runAt: 'document_idle' });
    await browser.tabs.executeScript(currentTabId, { file: 'content.js', runAt: 'document_idle' });
  } catch (e) {
    return null;
  }

  return waitForLiveState();
}


async function refreshAccessUi() {
  hideSiteAccess();

  if (!currentHostname) return;
  if (matchesList(blacklist, currentHostname)) return;

  const whitelisted = currentSiteWhitelisted();
  const hasAccess = await hasPersistentSiteAccess(currentHostname);

  if (whitelisted && hasAccess) return;

  if (whitelisted && !hasAccess) {
    showSiteAccess('Grant site access', 'This site is whitelisted, but Firefox access has not been granted yet.');
    return;
  }

  if (currentMode !== 'whitelist') return;
  showSiteAccess('Add to Whitelist', 'Allow Gain to auto-start on future visits to this site.');
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
      type: MSG.GET_DISMISSED_SITE_ACCESS_PROMPT,
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
    if (liveState.orphaned) {
      // The extension was reloaded/updated while this tab had a live audio
      // graph. The old graph keeps playing but can't be controlled by this
      // instance; a fresh injection is suppressed to avoid double-audio.
      // Show the real still-playing level (from saved state) so the slider
      // and badge match what's audible, with controls disabled.
      const orphanState = await getOrphanedDisplayState();
      setPopupSliderState(orphanState);
      sendBadge(orphanState.volume);
      setControlsEnabled(false);
      showBlockedBanner("Gain was recently reloaded — please refresh the page!");
    } else if (liveState.silenced) {
      // A previously-intercepted element on this page has had its src
      // swapped to cross-origin media without CORS. Web Audio silences the
      // output by spec and the intercept can't be undone. Tell the user
      // to refresh. Use setPopupSliderState (not initPopupState) so the
      // red `!` badge content.js set via refreshSilencedBadge stays put.
      setPopupSliderState(DEFAULT_AUDIO_STATE);
      setControlsEnabled(false);
      showBlockedBanner("Audio was disrupted by a mid-stream source change. Refresh the page to restore.");
    } else if (liveState.corsRestricted) {
      // Cross-origin media without CORS — Web Audio would silence it,
      // so the content script skipped the intercept. Controls would do
      // nothing here; disable them and explain why. Pin the slider to
      // 100 and clear the badge so the visual matches "Gain isn't
      // operating here."
      initPopupState(DEFAULT_AUDIO_STATE);
      setControlsEnabled(false);
      showBlockedBanner("This site does not send CORS headers, so Gain is unable to intercept and boost audio.");
    } else {
      initPopupState(liveState);
      setControlsEnabled(true);

      const boostData = await browser.storage.local.get('showBoostButtons');
      if (boostData.showBoostButtons === false && (voiceActive || bassActive)) {
        voiceActive = false;
        bassActive = false;
        sendVoice(currentTabId, false);
        sendBass(currentTabId, false);
        saveState(parseInt(slider.value, 10), false, false).catch(() => {});
      }
    }
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

function closeVolInput() {
  volInput.classList.remove('visible');
  volDisplay.style.display = '';
}

function commitVolInput() {
  if (!controlsEnabled) return;
  if (!volInput.classList.contains('visible')) return;
  const val = Math.max(0, Math.min(VOL_MAX, parseInt(volInput.value, 10) || 0));
  closeVolInput();
  applyVolume(val);
}

volInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitVolInput();
  if (e.key === 'Escape') closeVolInput();
});

document.addEventListener('mousedown', (e) => {
  if (!volInput.classList.contains('visible')) return;
  if (e.target === volInput) return;
  commitVolInput();
});

slider.addEventListener('input', () => {
  if (!controlsEnabled) return;
  applyVolume(parseInt(slider.value, 10));
});

slider.addEventListener('wheel', (e) => {
  if (!controlsEnabled) return;
  e.preventDefault();
  const direction = e.deltaY < 0 ? 1 : -1;
  applyVolume(parseInt(slider.value, 10) + (direction * 2));
}, { passive: false });

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

async function handleDefault() {
  if (!controlsEnabled || currentTabId === null) return;
  const data = await browser.storage.local.get('defaultVolume');
  const vol = data.defaultVolume ?? 100;
  await resetAudio(currentTabId, { volume: vol, bass: false, voice: false });
  resetUiState(vol);
}

function handleReset() {
  if (!controlsEnabled || currentTabId === null) return;
  applyVolume(100);
}

btnDefault.addEventListener('click', handleDefault);
btnMergedDefault.addEventListener('click', handleDefault);
btnReset.addEventListener('click', handleReset);
btnMergedReset.addEventListener('click', handleReset);

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

  if (!currentSiteWhitelisted()) {
    try {
      await browser.runtime.sendMessage({
        type: MSG.ADD_WHITELIST_SITE,
        hostname: currentHostname
      });
    } catch (e) {
      showBlockedBanner('Site access was granted, but Gain could not save this site yet.');
      await refreshAccessUi();
      return;
    }
    whitelist.unshift(currentHostname);
  }

  hideBlockedBanner();
  hideSiteAccess();

  const liveState = await ensureInjectedForActiveTab();
  if (liveState) {
    if (liveState.orphaned) {
      const orphanState = await getOrphanedDisplayState();
      setPopupSliderState(orphanState);
      sendBadge(orphanState.volume);
      setControlsEnabled(false);
      showBlockedBanner("Gain was recently reloaded — please refresh the page!");
    } else if (liveState.silenced) {
      setPopupSliderState(DEFAULT_AUDIO_STATE);
      setControlsEnabled(false);
      showBlockedBanner("Audio was disrupted by a mid-stream source change. Refresh the page to restore.");
    } else if (liveState.corsRestricted) {
      initPopupState(DEFAULT_AUDIO_STATE);
      setControlsEnabled(false);
      showBlockedBanner("This site does not send CORS headers, so Gain is unable to intercept and boost audio. Working on a bypass for v1.2!");
    } else {
      initPopupState(liveState);
      setControlsEnabled(true);
      // Site just transitioned from blocked to allowed. Apply the user's
      // configured default volume so the unblock matches what a fresh
      // activation would produce. The background-side handler also fires
      // off the same RESET_AUDIO via storage.onChanged — doing it here too
      // eliminates any UI race in the popup itself.
      await handleDefault();
    }
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
      type: MSG.DISMISS_SITE_ACCESS_PROMPT,
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
  if (document.querySelector('.tabs-section').style.display === 'none') return;

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
  if (data.darkMode === true) {
    document.documentElement.classList.add('dark');
    document.getElementById('btnDark').textContent = '☀️';
  } else if (data.darkMode === false) {
    document.documentElement.classList.remove('dark');
  }

  if (typeof data.darkMode === 'boolean') {
    try {
      localStorage.setItem('gain.darkMode', data.darkMode ? 'true' : 'false');
    } catch (e) {}
  }
});

document.getElementById('btnDark').addEventListener('click', () => {
  const on = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', on);
  document.getElementById('btnDark').textContent = on ? '☀️' : '🌙';
  try {
    localStorage.setItem('gain.darkMode', on ? 'true' : 'false');
  } catch (e) {}
  browser.storage.local.set({ darkMode: on });
});

applyAudioTabsVisibility().then(() => loadAudioTabs()).catch(() => {});
applyBoostButtonsVisibility().catch(() => {});
applyPopupTooltipVisibility().catch(() => {});
setInterval(loadAudioTabs, 2000);

btnDonate.addEventListener('click', () => {
  browser.tabs.create({ url: SUPPORT_URL });
  window.close();
});

browser.storage.local.get('showDonate').then((data) => {
  btnDonate.style.display = data.showDonate === false ? 'none' : 'flex';
});

initializeTabState().catch(() => {});
