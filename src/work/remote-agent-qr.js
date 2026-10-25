// Strict parser for bob://remote-agent QR invitations.
// Uses standard URL parsing and decodes each query parameter value at most once.

export const REMOTE_AGENT_QR_SCHEME = 'bob:';
export const REMOTE_AGENT_QR_HOST = 'remote-agent';
export const REMOTE_AGENT_QR_VERSION = '1';
export const KNOWN_REMOTE_AGENT_ADAPTERS = Object.freeze(['dsh', 'bob-core']);
export const SUPPORTED_REMOTE_AGENT_ADAPTERS = Object.freeze(['dsh']);

const REQUIRED_KEYS = Object.freeze(['v', 'adapter', 'name', 'endpoint', 'token']);
const ALLOWED_KEYS = new Set(REQUIRED_KEYS);
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const TOKEN_FORBIDDEN_CHAR_RE = /[\u0000-\u0020\u007F]/;

export function isRemoteAgentQrCandidate(rawInput) {
  if (typeof rawInput !== 'string') return false;
  const trimmed = rawInput.trim();
  return /^bob:\/\/remote-agent(?:[/?#]|$)/i.test(trimmed);
}

export function isSensitiveTokenUrl(rawInput) {
  if (typeof rawInput !== 'string') return false;
  const trimmed = rawInput.trim();
  if (isRemoteAgentQrCandidate(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    for (const [key] of parsed.searchParams) {
      if (key.toLowerCase() === 'token') return true;
    }
    return /(?:^|[?&#])token=/i.test(parsed.hash);
  } catch {
    return false;
  }
}

function isUnsafeHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '0.0.0.0' || host === '[::]' || host === '[::1]') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return true;
  return false;
}

export function normalizeHttpsRootEndpoint(rawEndpoint) {
  if (typeof rawEndpoint !== 'string') return { ok: false, error: 'REMOTE_INVALID_URL' };
  const trimmed = rawEndpoint.trim();
  if (!trimmed) return { ok: false, error: 'REMOTE_QR_MISSING_PARAM' };
  if (
    !trimmed.startsWith('https://') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('@') ||
    trimmed.includes('\\') ||
    /[\u0000-\u0020\u007F]/.test(trimmed)
  ) {
    return { ok: false, error: 'REMOTE_INVALID_URL' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'REMOTE_INVALID_URL' };
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.pathname !== '/' ||
    isUnsafeHostname(parsed.hostname)
  ) {
    return { ok: false, error: 'REMOTE_INVALID_URL' };
  }

  const afterScheme = trimmed.slice('https://'.length);
  const slashIndex = afterScheme.indexOf('/');
  if (slashIndex !== -1 && afterScheme.slice(slashIndex) !== '/') {
    return { ok: false, error: 'REMOTE_INVALID_URL' };
  }

  return { ok: true, endpoint: parsed.origin };
}

export function parseRemoteAgentQr(rawInput) {
  if (typeof rawInput !== 'string') {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 4096 || CONTROL_CHAR_RE.test(trimmed)) {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }
  if (!trimmed.startsWith('bob://') || trimmed.includes('#')) {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }

  if (
    url.protocol !== REMOTE_AGENT_QR_SCHEME ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hostname !== REMOTE_AGENT_QR_HOST ||
    url.host !== REMOTE_AGENT_QR_HOST ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.hash !== ''
  ) {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }

  const qIndex = trimmed.indexOf('?');
  if (qIndex === -1 || !url.search.startsWith('?') || url.search.length <= 1) {
    return { ok: false, error: 'REMOTE_QR_MISSING_PARAM' };
  }
  const authorityAndPath = trimmed.slice('bob://'.length, qIndex);
  if (authorityAndPath !== REMOTE_AGENT_QR_HOST && authorityAndPath !== `${REMOTE_AGENT_QR_HOST}/`) {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }

  const rawQuery = url.search.slice(1);
  const segments = rawQuery.split('&');
  const params = new Map();

  for (const segment of segments) {
    if (!segment) {
      return { ok: false, error: 'REMOTE_QR_INVALID' };
    }
    const eqIndex = segment.indexOf('=');
    if (eqIndex <= 0) {
      return { ok: false, error: 'REMOTE_QR_INVALID' };
    }
    const rawKey = segment.slice(0, eqIndex);
    const rawValue = segment.slice(eqIndex + 1);
    let key;
    let value;
    try {
      key = decodeURIComponent(rawKey);
      value = decodeURIComponent(rawValue);
    } catch {
      return { ok: false, error: 'REMOTE_QR_INVALID' };
    }
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: 'REMOTE_QR_INVALID' };
    }
    if (params.has(key)) {
      return { ok: false, error: 'REMOTE_QR_DUPLICATE_PARAM' };
    }
    params.set(key, value);
  }

  for (const requiredKey of REQUIRED_KEYS) {
    if (!params.has(requiredKey)) {
      return { ok: false, error: 'REMOTE_QR_MISSING_PARAM' };
    }
  }

  const version = params.get('v');
  if (!version) {
    return { ok: false, error: 'REMOTE_QR_MISSING_PARAM' };
  }
  if (version !== REMOTE_AGENT_QR_VERSION) {
    return { ok: false, error: 'REMOTE_QR_VERSION' };
  }

  const adapter = params.get('adapter');
  if (!adapter) {
    return { ok: false, error: 'REMOTE_QR_MISSING_PARAM' };
  }
  if (!KNOWN_REMOTE_AGENT_ADAPTERS.includes(adapter)) {
    return { ok: false, error: 'REMOTE_UNSUPPORTED_ADAPTER' };
  }

  const rawName = params.get('name');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) {
    return { ok: false, error: 'REMOTE_QR_MISSING_PARAM' };
  }
  if (name.length > 120 || CONTROL_CHAR_RE.test(name)) {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }

  const endpointResult = normalizeHttpsRootEndpoint(params.get('endpoint'));
  if (!endpointResult.ok) {
    return { ok: false, error: endpointResult.error };
  }

  const token = params.get('token');
  if (!token) {
    return { ok: false, error: 'REMOTE_QR_MISSING_PARAM' };
  }
  if (token.length > 8192 || TOKEN_FORBIDDEN_CHAR_RE.test(token)) {
    return { ok: false, error: 'REMOTE_QR_INVALID' };
  }

  const supported = SUPPORTED_REMOTE_AGENT_ADAPTERS.includes(adapter);
  return {
    ok: true,
    v: REMOTE_AGENT_QR_VERSION,
    adapter,
    name,
    endpoint: endpointResult.endpoint,
    token,
    supported,
  };
}
