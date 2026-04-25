// background.js
// Manages toolbar badge showing current volume per tab

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'SET_BADGE') return;

  const { tabId, volume } = msg;

  if (volume === 100) {
    // At default — clear the badge
    browser.browserAction.setBadgeText({ text: '', tabId });
  } else {
    browser.browserAction.setBadgeText({ text: String(volume), tabId });
    // Dark charcoal for normal range, amber 251-400%, red 401-600%, grey when reduced
    const color = volume < 100 ? '#64748b' : volume > 400 ? '#ef4444' : volume > 250 ? '#f59e0b' : '#1e293b';
    browser.browserAction.setBadgeBackgroundColor({ color, tabId });
  }
});

// Clear badge when tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  browser.browserAction.setBadgeText({ text: '', tabId });
});

// Clear badge when navigating to a new page
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    browser.browserAction.setBadgeText({ text: '', tabId });
  }
});
