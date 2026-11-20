// URL helpers shared by the ranking code and the UI. Pure functions.

// TLDs treated as "this is a hostname" when the input has no scheme and no path.
// Anything else (e.g. "node.js", "readme.md") is treated as a search query.
const COMMON_TLDS = new Set([
  'com', 'net', 'org', 'io', 'dev', 'app', 'ai', 'jp', 'co', 'me', 'info', 'xyz', 'tech',
  'cloud', 'page', 'gg', 'tv', 'so', 'to', 'us', 'uk', 'de', 'fr', 'cn', 'kr', 'in', 'edu',
  'gov', 'biz', 'site', 'online', 'blog', 'design', 'tokyo', 'inc', 'ly', 'fm', 'im', 'is',
  'it', 'nl', 'ca', 'au', 'ch', 'se', 'no', 'es', 'eu', 'ru', 'br', 'tw', 'hk', 'sg', 'id',
  'vn', 'th', 'test', 'local', 'internal', 'example', 'new',
]);

const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'file:', 'chrome:', 'about:', 'view-source:']);

/**
 * Turns typed text into a URL when it looks like one.
 * @returns {string | null} an absolute URL, or null when the text reads as a search query
 */
export function toUrl(input) {
  const text = String(input ?? '').trim();
  if (!text || /\s/.test(text)) return null;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (scheme && (text.slice(scheme[0].length).startsWith('//') || /^(about|view-source):/i.test(text))) {
    try {
      const url = new URL(text);
      return OPENABLE_SCHEMES.has(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  const hostMatch = /^([^/?#:]+)(:\d{1,5})?([/?#].*)?$/.exec(text);
  if (!hostMatch) return null;
  const host = hostMatch[1].toLowerCase();
  const hasPath = Boolean(hostMatch[3]);
  const hasPort = Boolean(hostMatch[2]);

  const isLocalhost = host === 'localhost';
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  const looksLikeDomain =
    labels.length >= 2 && labels.every((l) => /^[a-z0-9¡-￿-]+$/.test(l)) && /^[a-z]{2,}$/.test(tld);

  if (isLocalhost || isIpv4) return safeHref(`http://${text}`);
  if (looksLikeDomain && (COMMON_TLDS.has(tld) || hasPath || hasPort)) return safeHref(`https://${text}`);
  return null;
}

function safeHref(candidate) {
  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

/** Key used to drop the same page showing up as a tab, a bookmark and a history entry. */
export function dedupeKey(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.replace(/^www\./, '')}${path}${u.search}${u.hash}`;
  } catch {
    return String(url);
  }
}

/**
 * The URL with its query string left off, keeping any fragment. Only http(s):
 * other schemes do not split the query out the same way. Cut as text rather
 * than through URL, so a URL without a query comes back exactly as given.
 */
export function withoutQuery(url) {
  const text = String(url ?? '');
  if (!/^https?:/i.test(text)) return text;
  const hash = text.indexOf('#');
  const head = hash === -1 ? text : text.slice(0, hash);
  const query = head.indexOf('?');
  if (query === -1) return text;
  return head.slice(0, query) + (hash === -1 ? '' : text.slice(hash));
}

/** Text the matcher sees for a URL: no scheme, no leading "www.". */
export function matchableUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const rest = `${u.pathname}${u.search}${u.hash}`;
      return `${u.host.replace(/^www\./, '')}${rest === '/' ? '' : safeDecode(rest)}`;
    }
    return url;
  } catch {
    return String(url ?? '');
  }
}

/**
 * How many characters of a matchableUrl() text are the host, so the host can be
 * drawn apart from the path. Counted in code points, like match positions.
 * Text that still has a scheme (chrome://, file://) is not split.
 */
export function hostLength(text) {
  const chars = Array.from(String(text ?? ''));
  if (/^([a-z][a-z0-9+.-]*:\/\/|about:|view-source:)/i.test(chars.join(''))) return chars.length;
  const cut = chars.findIndex((ch) => ch === '/' || ch === '?' || ch === '#');
  return cut === -1 ? chars.length : cut;
}

function safeDecode(text) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

/**
 * What the footer shows about the page under the bar, so the user can still
 * check where they are with the address bar out of sight.
 * @returns {{label: string, secure: boolean, kind: 'web' | 'internal' | 'file' | 'unknown'}}
 */
export function describeOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return { label: u.host, secure: true, kind: 'web' };
    if (u.protocol === 'http:') return { label: u.host, secure: isLoopback(u.hostname), kind: 'web' };
    if (u.protocol === 'file:') return { label: 'ローカルファイル', secure: true, kind: 'file' };
    return { label: `${u.protocol}//${u.host}`, secure: true, kind: 'internal' };
  } catch {
    return { label: '', secure: false, kind: 'unknown' };
  }
}

/** Plain http to this machine is not a downgrade worth a warning. */
function isLoopback(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/** Schemes Chrome refuses to open from an extension (bookmarklets and the like). */
export function isOpenable(url) {
  return !/^(javascript|data|vbscript):/i.test(String(url ?? '').trim());
}
