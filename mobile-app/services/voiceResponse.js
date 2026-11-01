// Permission to process speech is separate from biometric verification:
// off/shadow/fail-open may allow a speaker who has not been verified.
export function isVoiceAllowed(response) {
  if (response?.allowed !== undefined) return response.allowed === true;

  // Older backends omit `allowed`, but only return a transcript after the
  // server gate permits it. Rejected clips always have empty text. This lets
  // the updated app work during a staggered backend/mobile rollout.
  return typeof response?.text === 'string' && response.text.trim().length > 0;
}
