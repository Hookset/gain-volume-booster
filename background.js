// background.js
// Manages toolbar badge updates and auto-injects on whitelisted sites with granted access.

const DEFAULT_AUDIO_STATE = {
  volume: 100,
  bass: false,
  voice: false
};

function ignorePromiseError(operation) {
  try {
    const pending = operation();
    if (pending && typeof pending.catch === 'function') {
      pending.catch(() => {});
    }
  } catch (e) {}
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

function normalizeHostname(hostname) {
  return (hostname || '').replace(/^www\./, '');
}

function isIPv4Hostname(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function getSitePatterns(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return [];

  const exact = `*://${normalized}/*`;
  if (normalized === 'localhost' || normalized.includes(':') || isIPv4Hostname(normalized) || !normalized.includes('.')) {
    return [exact];
  }

  return [exact, `*://*.${normalized}/*`];
}

function matchesList(list, hostname) {
  return list.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
}

function isSupportedTabUrl(url) {
  return /^(https?|file):/i.test(url || '');
}

function getHostnameFromUrl(url) {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch (e) {
    return '';
  }
}

function getChangedDomains(previous = [], next = []) {
  const oldSet = new Set(previous);
  const newSet = new Set(next);
  const changed = new Set();

  oldSet.forEach((domain) => {
    if (!newSet.has(domain)) changed.add(domain);
  });

  newSet.forEach((domain) => {
    if (!oldSet.has(domain)) changed.add(domain);
  });

  return Array.from(changed);
}

async function resetTabAudio(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'RESET_AUDIO',
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

async function hasPersistentSiteAccess(hostname) {
  const patterns = getSitePatterns(hostname);
  if (!patterns.length) return false;

  try {
    return await browser.permissions.contains({ origins: patterns });
  } catch (e) {
    return false;
  }
}

async function injectContentScript(tabId) {
  try {
    await browser.tabs.executeScript(tabId, {
      file: 'content.js',
      runAt: 'document_idle'
    });
  } catch (e) {}
}

async function maybeInjectForTab(tabId, url) {
  if (!url) return;

  let hostname = '';
  try {
    hostname = normalizeHostname(new URL(url).hostname);
  } catch (e) {
    return;
  }

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

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ADD_WHITELIST_SITE') {
    return addWhitelistedSite(normalizeHostname(msg.hostname));
  }

  if (msg.type === 'DISMISS_SITE_ACCESS_PROMPT') {
    return setDismissedPrompt(msg.tabId, msg.url || '');
  }

  if (msg.type === 'GET_DISMISSED_SITE_ACCESS_PROMPT') {
    return getDismissedPromptUrl(msg.tabId);
  }

  if (msg.type !== 'SET_BADGE') return;

  const { tabId, volume } = msg;

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
    try {
      const tab = await browser.tabs.get(tabId);
      await maybeInjectForTab(tabId, tab.url);
    } catch (e) {}
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
    ignorePromiseError(() => resetTabsMatching((tab) => isSupportedTabUrl(tab.url)));
    return;
  }

  const changedDomains = [
    ...getChangedDomains(
      blacklistChanged ? changes.blacklist.oldValue || [] : [],
      blacklistChanged ? changes.blacklist.newValue || [] : []
    ),
    ...getChangedDomains(
      whitelistChanged ? changes.whitelist.oldValue || [] : [],
      whitelistChanged ? changes.whitelist.newValue || [] : []
    )
  ];

  if (!changedDomains.length) return;

  ignorePromiseError(() => resetTabsMatching((tab) => {
    if (!isSupportedTabUrl(tab.url)) return false;

    const hostname = getHostnameFromUrl(tab.url);
    return changedDomains.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
  }));
});
