// background.js
// Manages toolbar badges plus permission-aware and saved-tab auto-injection.

// TAB_AUDIO_STATE_PREFIX is defined in site-utils.js (shared with the popup).
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
      ? Math.max(0, Math.min(VOL_MAX, state.volume))
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

// Render the toolbar badge for a non-neutral volume on a tab. Single source
// of truth for badge text + color so applyTabState and the SET_BADGE
// message handler can't drift.
function setVolumeBadge(tabId, volume) {
  setBadgeText({ text: String(volume), tabId });
  const color = volume < 100 ? '#64748b' : (volColor(volume) || '#1e293b');
  setBadgeBackgroundColor({ color, tabId });
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
  await Promise.all([
    browser.storage.local.set({
      [key]: {
        hostname: tabHostname,
        url: url || '',
        state: nextState
      }
    }),
    browser.storage.local.remove(tabAudioResetKey(tabId))
  ]);
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


// Push an audio state to a tab's content script via RESET_AUDIO and update
// the toolbar badge and stored tab state accordingly. For neutral state,
// this is the "Gain stepping back" path — clear stored state and clear the
// badge. For non-neutral state (e.g., applying the user's defaultVolume
// when a tab is newly unblocked), set the badge to match; content.js will
// persist the new state itself through its own saveTabAudioState.
async function applyTabState(tabId, state) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: MSG.RESET_AUDIO,
      state
    });
  } catch (e) {
    if (!isExpectedTabError(e)) console.warn('[Gain] applyTabState:', e && e.message);
  }

  if (isNeutralAudioState(state)) {
    await clearTabAudioState(tabId).catch(() => {});
    clearBadge(tabId);
    return;
  }

  setVolumeBadge(tabId, state.volume);
}

async function resetTabAudio(tabId) {
  await applyTabState(tabId, DEFAULT_AUDIO_STATE);
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

// Serialize whitelist writes so concurrent callers (popup ADD_WHITELIST_SITE
// and permissions.onAdded) don't race the read-modify-write.
let whitelistWriteQueue = Promise.resolve();

function addWhitelistedSite(hostname) {
  if (!hostname) return Promise.resolve();

  whitelistWriteQueue = whitelistWriteQueue.then(async () => {
    const data = await browser.storage.local.get('whitelist');
    const whitelist = data.whitelist || [];
    if (matchesList(whitelist, hostname)) return;
    whitelist.unshift(hostname);
    await browser.storage.local.set({ whitelist });
  }, () => {});

  return whitelistWriteQueue;
}

function shouldBlockSite(settings, hostname) {
  return isHostnameBlocked(
    hostname,
    settings.mode || 'blacklist',
    settings.blacklist || [],
    settings.whitelist || []
  );
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

// On extension reload/update the browserAction badges are wiped, but any tab
// that had a boosted graph is now orphaned and still audibly playing at that
// volume. Re-apply badges from saved per-tab state so the toolbar matches
// what the user is hearing. Only called on install/update (not browser
// startup, where restored tabs are unloaded and not actually boosted yet).
async function restoreBadgesFromSavedState() {
  let data = {};
  try {
    data = await browser.storage.local.get(null);
  } catch (e) {
    return;
  }

  Object.entries(data).forEach(([key, entry]) => {
    if (!key.startsWith(TAB_AUDIO_STATE_PREFIX) || !entry || typeof entry !== 'object') return;
    const tabId = parseInt(key.slice(TAB_AUDIO_STATE_PREFIX.length), 10);
    if (!isFinite(tabId)) return;
    const state = sanitizeAudioState(entry.state);
    if (state && !isNeutralAudioState(state)) setVolumeBadge(tabId, state.volume);
  });
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
  if (tabId === undefined) return;

  // The content script detected that a previously-intercepted element on
  // this tab now has a cross-origin src and is being silenced by Web Audio.
  // Surface this on the toolbar so the user has a cue without opening the
  // popup. Refresh of the page clears the state via fresh content.js init.
  if (msg.silenced) {
    setBadgeText({ text: '!', tabId });
    setBadgeBackgroundColor({ color: '#ef4444', tabId });
    return;
  }

  const { volume } = msg;
  if (volume === 100) {
    clearBadge(tabId);
  } else {
    setVolumeBadge(tabId, volume);
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
  ignorePromiseError(() => restoreBadgesFromSavedState());
  ignorePromiseError(() => maybeInjectOpenTabs());
});

browser.permissions.onAdded.addListener(async (permissions) => {
  // Firefox closes the popup during permissions.request(), so the whitelist
  // write in popup.js may never run. Auto-whitelist any site-specific
  // permission that just got granted so the popup works on next open.
  const seen = new Set();
  for (const origin of (permissions.origins || [])) {
    const match = origin.match(/^\*:\/\/([^/]+)\/\*$/);
    if (!match) {
      console.warn('[Gain] permissions.onAdded: unrecognized origin pattern', origin);
      continue;
    }
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

  // Unified per-tab transition handler. For each tab, compare its
  // blocked-ness under the OLD settings vs the NEW settings. Newly blocked
  // tabs reset to the neutral default state ("Gain stepping back"). Newly
  // allowed tabs receive the user's configured defaultVolume so the
  // transition matches what a fresh activation would produce.
  ignorePromiseError(async () => {
    const stored = await browser.storage.local.get(['mode', 'blacklist', 'whitelist', 'defaultVolume']);
    const newMode = stored.mode || 'blacklist';
    const newBl = stored.blacklist || [];
    const newWl = stored.whitelist || [];

    const oldMode = modeChanged ? (changes.mode.oldValue || 'blacklist') : newMode;
    const oldBl = blacklistChanged ? (changes.blacklist.oldValue || []) : newBl;
    const oldWl = whitelistChanged ? (changes.whitelist.oldValue || []) : newWl;

    const rawDefault = stored.defaultVolume;
    const defaultVol = typeof rawDefault === 'number' && isFinite(rawDefault)
      ? Math.max(0, Math.min(VOL_MAX, rawDefault))
      : 100;
    const defaultState = { volume: defaultVol, bass: false, voice: false };

    let tabs = [];
    try { tabs = await browser.tabs.query({}); } catch (e) { return; }

    await Promise.all(tabs.map(async (tab) => {
      if (!isSupportedTabUrl(tab.url)) return;
      const hostname = getHostnameFromUrl(tab.url);
      if (!hostname) return;

      const wasBlocked = isHostnameBlocked(hostname, oldMode, oldBl, oldWl);
      const isBlocked = isHostnameBlocked(hostname, newMode, newBl, newWl);
      if (wasBlocked === isBlocked) return;

      if (isBlocked) {
        // Newly blocked: revert to native browser audio (Gain is stepping back).
        await resetTabAudio(tab.id);
      } else if (!isNeutralAudioState(defaultState)) {
        // Newly allowed: apply the user's default volume so the unblock
        // matches what fresh activation on this tab would produce.
        // (Skip when defaultVol is 100 — that's already the neutral state.)
        await applyTabState(tab.id, defaultState);
      }
    }));
  });
});

function isHostnameBlocked(hostname, mode, blacklist, whitelist) {
  if (mode === 'blacklist') return matchesList(blacklist, hostname);
  return !matchesList(whitelist, hostname);
}
