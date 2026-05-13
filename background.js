// background.js
// Manages toolbar badges plus permission-aware and saved-tab auto-injection.

const DEFAULT_AUDIO_STATE = {
  volume: 100,
  bass: false,
  voice: false
};
const TAB_AUDIO_STATE_PREFIX = 'tabAudioState_';
const TAB_AUDIO_RESET_PREFIX = 'tabAudioReset_';

function tabAudioStateKey(tabId) {
  return `${TAB_AUDIO_STATE_PREFIX}${tabId}`;
}

function tabAudioResetKey(tabId) {
  return `${TAB_AUDIO_RESET_PREFIX}${tabId}`;
}

function sanitizeAudioState(state) {
  if (!state || typeof state !== 'object') return null;

  return {
    volume: typeof state.volume === 'number' && isFinite(state.volume)
      ? Math.max(0, Math.min(600, state.volume))
      : 100,
    bass: state.bass === true,
    voice: state.voice === true
  };
}

function isNeutralAudioState(state) {
  return state && state.volume === 100 && !state.bass && !state.voice;
}

function isExpectedTabError(e) {
  const msg = (e && e.message) || '';
  return (
    msg.includes('Could not establish connection') ||
    msg.includes('Receiving end does not exist') ||
    msg.includes('No tab with id') ||
    msg.includes('Invalid tab ID') ||
    msg.includes('Tab was closed')
  );
}

function ignorePromiseError(operation) {
  try {
    const pending = operation();
    if (pending && typeof pending.catch === 'function') {
      pending.catch((e) => {
        if (!isExpectedTabError(e)) {
          console.warn('[Gain] Background error:', (e && e.message) || e);
        }
      });
    }
  } catch (e) {
    if (!isExpectedTabError(e)) {
      console.warn('[Gain] Background error:', (e && e.message) || e);
    }
  }
}

function setBadgeText(details) {
  ignorePromiseError(() => browser.browserAction.setBadgeText(details));
}

function setBadgeBackgroundColor(details) {
  ignorePromiseError(() => browser.browserAction.setBadgeBackgroundColor(details));
}

function clearBadge(tabId) {
  setBadgeText({ text: '', tabId });
}

async function setTabAudioState(tabId, url, state, hostname = '') {
  if (tabId === undefined || tabId === null) return;

  const nextState = sanitizeAudioState(state);
  const key = tabAudioStateKey(tabId);
  if (!nextState || isNeutralAudioState(nextState)) {
    await browser.storage.local.remove([key, tabAudioResetKey(tabId)]);
    return;
  }

  const tabHostname = normalizeHostname(hostname) || getHostnameFromUrl(url);
  await browser.storage.local.set({
    [key]: {
      hostname: tabHostname,
      url: url || '',
      state: nextState
    }
  });
  await browser.storage.local.remove(tabAudioResetKey(tabId));
}

async function getTabAudioRestore(tabId, url, hostname = '', restoreAcrossUrlChange = false) {
  const emptyRestore = { state: null, suppressSiteState: false };
  if (tabId === undefined || tabId === null) return emptyRestore;

  const resetKey = tabAudioResetKey(tabId);
  const key = tabAudioStateKey(tabId);
  const data = await browser.storage.local.get([key, resetKey]);
  const resetEntry = data[resetKey];
  let suppressSiteState = false;
  const tabHostname = normalizeHostname(hostname) || getHostnameFromUrl(url);

  if (resetEntry && typeof resetEntry === 'object') {
    const resetHostname = normalizeHostname(resetEntry.hostname);
    if (!resetHostname || !tabHostname || resetHostname === tabHostname) {
      suppressSiteState = true;
    }
  }

  const entry = data[key];
  if (!entry || typeof entry !== 'object') {
    return { state: null, suppressSiteState };
  }

  if (entry.hostname && tabHostname && entry.hostname !== tabHostname) {
    await browser.storage.local.remove(key);
    return { state: null, suppressSiteState };
  }

  if (!restoreAcrossUrlChange && entry.url && url && entry.url !== url) {
    await browser.storage.local.remove(key);
    return { state: null, suppressSiteState };
  }

  return {
    state: sanitizeAudioState(entry.state),
    suppressSiteState
  };
}

async function clearTabAudioState(tabId, suppressSiteState = false, url = '', hostname = '') {
  if (tabId === undefined || tabId === null) return;
  const updates = [browser.storage.local.remove(tabAudioStateKey(tabId))];

  if (suppressSiteState) {
    updates.push(browser.storage.local.set({
      [tabAudioResetKey(tabId)]: {
        hostname: normalizeHostname(hostname) || getHostnameFromUrl(url),
        url: url || ''
      }
    }));
  } else {
    updates.push(browser.storage.local.remove(tabAudioResetKey(tabId)));
  }

  await Promise.all(updates);
}


function getAddedDomains(oldList = [], newList = []) {
  const oldSet = new Set(oldList);
  return newList.filter((d) => !oldSet.has(d));
}

function getRemovedDomains(oldList = [], newList = []) {
  const newSet = new Set(newList);
  return oldList.filter((d) => !newSet.has(d));
}

async function resetTabAudio(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: MSG.RESET_AUDIO,
      state: DEFAULT_AUDIO_STATE
    });
  } catch (e) {
    if (!isExpectedTabError(e)) console.warn('[Gain] resetTabAudio:', e && e.message);
  }

  await clearTabAudioState(tabId).catch(() => {});
  clearBadge(tabId);
}

async function deactivateBoostsAllTabs() {
  let tabs = [];
  try {
    tabs = await browser.tabs.query({});
  } catch (e) {
    return;
  }

  await Promise.all(tabs.map(async (tab) => {
    if (!isSupportedTabUrl(tab.url)) return;
    try { await browser.tabs.sendMessage(tab.id, { type: MSG.SET_BASS_BOOST, enabled: false }); } catch (e) {}
    try { await browser.tabs.sendMessage(tab.id, { type: MSG.SET_VOICE_BOOST, enabled: false }); } catch (e) {}
  }));
}

async function clearRememberedBoosts() {
  let data = {};
  try {
    data = await browser.storage.local.get(null);
  } catch (e) {
    return;
  }

  const updates = {};
  Object.entries(data).forEach(([key, value]) => {
    if (!key.startsWith('site_') || !value || typeof value !== 'object') return;
    if (value.bass !== true && value.voice !== true) return;
    updates[key] = { ...value, bass: false, voice: false };
  });

  if (Object.keys(updates).length) {
    await browser.storage.local.set(updates);
  }
}

async function clearSavedTabBoosts() {
  let data = {};
  try {
    data = await browser.storage.local.get(null);
  } catch (e) {
    return;
  }

  const updates = {};
  const removals = [];

  Object.entries(data).forEach(([key, entry]) => {
    if (!key.startsWith(TAB_AUDIO_STATE_PREFIX) || !entry || typeof entry !== 'object') return;

    const state = sanitizeAudioState(entry.state);
    if (!state || (state.bass !== true && state.voice !== true)) return;

    const nextState = { ...state, bass: false, voice: false };
    if (isNeutralAudioState(nextState)) {
      removals.push(key);
      return;
    }

    updates[key] = {
      ...entry,
      state: nextState
    };
  });

  if (Object.keys(updates).length) {
    await browser.storage.local.set(updates);
  }

  if (removals.length) {
    await browser.storage.local.remove(removals);
  }
}

async function resetTabsMatching(predicate) {
  let tabs = [];
  try {
    tabs = await browser.tabs.query({});
  } catch (e) {
    return;
  }

  await Promise.all(tabs.map(async (tab) => {
    if (!predicate(tab)) return;
    await resetTabAudio(tab.id);
  }));
}

async function getDismissedPromptMap() {
  const data = await browser.storage.local.get('dismissedSiteAccessByTab');
  return data.dismissedSiteAccessByTab || {};
}

async function setDismissedPrompt(tabId, url) {
  const dismissed = await getDismissedPromptMap();
  dismissed[String(tabId)] = url;
  await browser.storage.local.set({ dismissedSiteAccessByTab: dismissed });
}

async function clearDismissedPrompt(tabId) {
  const dismissed = await getDismissedPromptMap();
  const key = String(tabId);
  if (!(key in dismissed)) return;
  delete dismissed[key];
  await browser.storage.local.set({ dismissedSiteAccessByTab: dismissed });
}

async function getDismissedPromptUrl(tabId) {
  const dismissed = await getDismissedPromptMap();
  return dismissed[String(tabId)] || '';
}

async function addWhitelistedSite(hostname) {
  if (!hostname) return;

  const data = await browser.storage.local.get('whitelist');
  const whitelist = data.whitelist || [];
  if (matchesList(whitelist, hostname)) return;

  whitelist.unshift(hostname);
  await browser.storage.local.set({ whitelist });
}

function shouldBlockSite(settings, hostname) {
  const mode = settings.mode || 'blacklist';
  const blacklist = settings.blacklist || [];
  const whitelist = settings.whitelist || [];

  if (mode === 'blacklist') {
    return matchesList(blacklist, hostname);
  }

  return !matchesList(whitelist, hostname);
}

async function injectContentScript(tabId) {
  try {
    await browser.tabs.executeScript(tabId, { file: 'site-utils.js', runAt: 'document_idle' });
    await browser.tabs.executeScript(tabId, { file: 'content.js', runAt: 'document_idle' });
  } catch (e) {
    if (!isExpectedTabError(e)) console.warn('[Gain] injectContentScript:', e && e.message);
  }
}

async function maybeInjectForTab(tabId, url) {
  if (!url) return;

  const hostname = getHostnameFromUrl(url);
  if (!hostname) return;

  const settings = await browser.storage.local.get(['mode', 'blacklist', 'whitelist', 'resetOnUrlChange']);
  if (shouldBlockSite(settings, hostname)) return;

  const tabRestore = await getTabAudioRestore(tabId, url, hostname, settings.resetOnUrlChange === false);
  if (tabRestore.state) {
    await injectContentScript(tabId);
    return;
  }

  if (!matchesList(settings.whitelist || [], hostname)) return;

  const hasAccess = await hasPersistentSiteAccess(hostname);
  if (!hasAccess) return;

  await injectContentScript(tabId);
}

async function maybeInjectOpenTabs() {
  let tabs = [];
  try {
    tabs = await browser.tabs.query({});
  } catch (e) {
    return;
  }

  await Promise.all(tabs.map((tab) => maybeInjectForTab(tab.id, tab.url)));
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id) return;

  if (msg.type === MSG.ADD_WHITELIST_SITE) {
    return addWhitelistedSite(normalizeHostname(msg.hostname));
  }

  if (msg.type === MSG.DISMISS_SITE_ACCESS_PROMPT) {
    return setDismissedPrompt(msg.tabId, msg.url || '');
  }

  if (msg.type === MSG.GET_DISMISSED_SITE_ACCESS_PROMPT) {
    return getDismissedPromptUrl(msg.tabId);
  }

  if (msg.type === MSG.GET_TAB_AUDIO_STATE) {
    const tab = sender.tab || {};
    return getTabAudioRestore(tab.id, tab.url, msg.hostname, msg.restoreAcrossUrlChange === true);
  }

  if (msg.type === MSG.SET_TAB_AUDIO_STATE) {
    const tab = sender.tab || {};
    const tabId = tab.id ?? msg.tabId;
    return setTabAudioState(tabId, tab.url || msg.url, msg.state, msg.hostname);
  }

  if (msg.type !== MSG.SET_BADGE) return;

  const tabId = msg.tabId ?? (sender.tab && sender.tab.id);
  const { volume } = msg;

  if (tabId === undefined) return;

  if (volume === 100) {
    setBadgeText({ text: '', tabId });
  } else {
    setBadgeText({ text: String(volume), tabId });
    const color = volume < 100 ? '#64748b' : volume > 400 ? '#ef4444' : volume > 250 ? '#f59e0b' : '#1e293b';
    setBadgeBackgroundColor({ color, tabId });
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  clearBadge(tabId);
  ignorePromiseError(() => clearTabAudioState(tabId));
  ignorePromiseError(() => clearDismissedPrompt(tabId));
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    const loadingUrl = changeInfo.url || (tab && tab.url);
    clearBadge(tabId);
    ignorePromiseError(() => clearTabAudioState(tabId, true, loadingUrl));
    ignorePromiseError(() => clearDismissedPrompt(tabId));
    return;
  }

  if (changeInfo.status === 'complete') {
    ignorePromiseError(() => maybeInjectForTab(tabId, tab && tab.url));
  }
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  ignorePromiseError(async () => {
    const tab = await browser.tabs.get(tabId);
    await maybeInjectForTab(tabId, tab.url);
  });
});

browser.runtime.onStartup.addListener(() => {
  ignorePromiseError(() => browser.storage.local.remove('dismissedSiteAccessByTab'));
  ignorePromiseError(() => maybeInjectOpenTabs());
});

browser.runtime.onInstalled.addListener(() => {
  ignorePromiseError(() => maybeInjectOpenTabs());
});

browser.permissions.onAdded.addListener(async (permissions) => {
  // Firefox closes the popup during permissions.request(), so the whitelist
  // write in popup.js may never run. Auto-whitelist any site-specific
  // permission that just got granted so the popup works on next open.
  const seen = new Set();
  for (const origin of (permissions.origins || [])) {
    const match = origin.match(/^\*:\/\/([^/]+)\/\*$/);
    if (!match) continue;
    const hostname = match[1].replace(/^\*\./, '');
    if (!hostname || hostname === '*' || seen.has(hostname)) continue;
    seen.add(hostname);
    await addWhitelistedSite(hostname).catch(() => {});
  }
  ignorePromiseError(() => maybeInjectOpenTabs());
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.showBoostButtons && changes.showBoostButtons.newValue === false) {
    ignorePromiseError(async () => {
      await clearRememberedBoosts();
      await clearSavedTabBoosts();
      await deactivateBoostsAllTabs();
    });
  }

  const modeChanged = !!changes.mode;
  const blacklistChanged = !!changes.blacklist;
  const whitelistChanged = !!changes.whitelist;
  if (!modeChanged && !blacklistChanged && !whitelistChanged) return;

  if (modeChanged) {
    ignorePromiseError(async () => {
      const newMode = changes.mode.newValue || 'blacklist';
      const data = await browser.storage.local.get(['whitelist', 'blacklist']);
      const wl = data.whitelist || [];
      const bl = data.blacklist || [];

      await resetTabsMatching((tab) => {
        if (!isSupportedTabUrl(tab.url)) return false;
        const hostname = getHostnameFromUrl(tab.url);
        if (!hostname) return false;

        if (newMode === 'whitelist') {
          // Switching to whitelist: reset tabs not in whitelist (now newly blocked).
          // Skip already-blacklisted tabs — nothing was running there in blacklist mode.
          if (matchesList(bl, hostname)) return false;
          return !matchesList(wl, hostname);
        }

        // Switching to blacklist: reset tabs that are in the blacklist.
        // They may have been running because they were whitelisted in whitelist mode.
        return matchesList(bl, hostname);
      });
    });
    return;
  }

  ignorePromiseError(async () => {
    const { mode } = await browser.storage.local.get('mode');
    const currentMode = mode || 'blacklist';

    const domainsToReset = [
      // Newly blacklisted — only relevant in blacklist mode (blacklist is ignored in whitelist mode)
      ...(blacklistChanged && currentMode === 'blacklist' ? getAddedDomains(
        changes.blacklist.oldValue || [],
        changes.blacklist.newValue || []
      ) : []),
      // Removed from whitelist — only newly blocked in whitelist mode
      ...(whitelistChanged && currentMode === 'whitelist' ? getRemovedDomains(
        changes.whitelist.oldValue || [],
        changes.whitelist.newValue || []
      ) : []),
    ];

    if (!domainsToReset.length) return;

    await resetTabsMatching((tab) => {
      if (!isSupportedTabUrl(tab.url)) return false;
      const hostname = getHostnameFromUrl(tab.url);
      return domainsToReset.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
    });
  });
});
