// Keep native/API errors as text before putting them in React state. Some
// native modules expose message as a structured { code, message } object.
export function errorMessage(error, fallback = 'Kuch galat hua') {
  const value = error?.response?.data?.error ?? error?.message ?? error;
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if (typeof value.message === 'string') return value.message;
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}
