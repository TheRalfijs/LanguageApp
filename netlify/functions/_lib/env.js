// Server-side environment access. Secrets live only in Netlify env vars.

export class ConfigError extends Error {}

export function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function requireEnv(name) {
  const value = env(name);
  if (value === undefined) throw new ConfigError(`Missing environment variable ${name}`);
  return value;
}
