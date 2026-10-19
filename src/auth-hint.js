// Tiny, dependency-free check used on every page: is there a stored session?
// Lets pages skip loading supabase-js (≈50 KB) for logged-out visitors.
export const AUTH_STORAGE_KEY = 'b1-auth';

export function hasStoredSession() {
  try { return Boolean(localStorage.getItem(AUTH_STORAGE_KEY)); } catch { return false; }
}
