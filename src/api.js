// Browser → Netlify Functions. Adds the login token (if any) and the
// anonymous token, and turns error responses into ApiError.
import { hasStoredSession } from './auth-hint.js';

const ANON_KEY = 'anon-token';

export class ApiError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code; // e.g. 'rate_limited', 'login_required', 'network_error'
    this.details = details;
  }
}

// Random per-browser id for the free diagnostic (no account needed).
export function anonToken() {
  try {
    let token = localStorage.getItem(ANON_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(ANON_KEY, token);
    }
    return token;
  } catch {
    return null; // storage blocked: server will reject anonymous AI calls
  }
}

async function authHeader() {
  if (!hasStoredSession()) return {};
  const { getAccessToken } = await import('./auth.js');
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const anon = anonToken();
  const init = {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(anon ? { 'X-Anon-Token': anon } : {}),
      ...(await authHeader()),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  let res;
  try {
    res = await fetch(`/api/${path.replace(/^\//, '')}`, init);
  } catch {
    throw new ApiError(0, 'network_error');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'http_error', data.details);
  return data;
}
