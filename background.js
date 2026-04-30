// background.js
// Manages toolbar badge updates and auto-injects on whitelisted sites with granted access.

const DEFAULT_AUDIO_STATE = {
  volume: 100,
  bass: false,
  voice: false
};

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
  } catch (e) {}

  clearBadge(tabId);
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

function shouldAutoInject(settings, hostname) {
  const whitelist = settings.whitelist || [];
  return matchesList(whitelist, hostname) && !shouldBlockSite(settings, hostname);
}


async function injectContentScript(tabId) {
  try {
    await browser.tabs.executeScript(tabId, { file: 'site-utils.js', runAt: 'document_idle' });
    await browser.tabs.executeScript(tabId, { file: 'content.js', runAt: 'document_idle' });
  } catch (e) {}
}

async function maybeInjectForTab(tabId, url) {
  if (!url) return;

  const hostname = getHostnameFromUrl(url);
  if (!hostname) return;

  const settings = await browser.storage.local.get(['mode', 'blacklist', 'whitelist']);
  if (!shouldAutoInject(settings, hostname)) return;

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
  ignorePromiseError(() => clearDismissedPrompt(tabId));
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    clearBadge(tabId);
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

browser.permissions.onAdded.addListener(() => {
  ignorePromiseError(() => maybeInjectOpenTabs());
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

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
