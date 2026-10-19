// Small helpers for Netlify Functions (v2: Request in, Response out).
import { ConfigError } from './env.js';

export class HttpError extends Error {
  constructor(status, code, message = code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export async function readJson(req, { maxBytes = 64 * 1024 } = {}) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export function allowMethods(req, ...methods) {
  if (!methods.includes(req.method)) throw new HttpError(405, 'method_not_allowed');
}

// Wrap a handler: HttpErrors become JSON responses; anything else is logged
// and returned as a generic 500 (never leak internals or keys to the browser).
export function handler(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(err.status, { error: err.code, ...(err.details ? { details: err.details } : {}) });
      }
      if (err instanceof ConfigError) {
        console.error('[config]', err.message);
        return json(503, { error: 'service_not_configured' });
      }
      console.error('[unhandled]', err);
      return json(500, { error: 'internal_error' });
    }
  };
}
