// Shared helpers for hostname matching and site permission patterns.

function normalizeHostname(hostname) {
  return (hostname || '').replace(/^www\./, '');
}

function normalizeDomain(raw) {
  return raw.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
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

function getHostnameFromUrl(url) {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch (e) {
    return '';
  }
}

function isSupportedTabUrl(url) {
  return /^(https?|file):/i.test(url || '');
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

const MSG = {
  SET_VOLUME:                       'SET_VOLUME',
  SET_BASS_BOOST:                   'SET_BASS_BOOST',
  SET_VOICE_BOOST:                  'SET_VOICE_BOOST',
  RESET_AUDIO:                      'RESET_AUDIO',
  GET_STATE:                        'GET_STATE',
  GET_TAB_AUDIO_STATE:              'GET_TAB_AUDIO_STATE',
  SET_TAB_AUDIO_STATE:              'SET_TAB_AUDIO_STATE',
  SET_BADGE:                        'SET_BADGE',
  ADD_WHITELIST_SITE:               'ADD_WHITELIST_SITE',
  DISMISS_SITE_ACCESS_PROMPT:       'DISMISS_SITE_ACCESS_PROMPT',
  GET_DISMISSED_SITE_ACCESS_PROMPT: 'GET_DISMISSED_SITE_ACCESS_PROMPT',
};

// Storage key prefix for per-tab live audio state. Shared so the popup can
// read a tab's saved volume directly (e.g. to display the still-playing
// level when the extension was reloaded and the graph is orphaned).
const TAB_AUDIO_STATE_PREFIX = 'tabAudioState_';

// Shared audio defaults and volume color thresholds. Single source of truth
// so popup/options sliders and the toolbar badge stay in sync.
const DEFAULT_AUDIO_STATE = { volume: 100, bass: false, voice: false };
const VOL_MAX = 600;
const VOL_AMBER = 250;
const VOL_RED = 400;

function volColor(v) {
  if (v > VOL_RED) return '#ef4444';
  if (v > VOL_AMBER) return '#f59e0b';
  return null;
}

const SUPPORT_URL = 'https://github.com/Hookset/gain-volume-booster#support';
