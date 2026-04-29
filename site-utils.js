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
