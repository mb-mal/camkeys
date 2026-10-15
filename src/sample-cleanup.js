// Only called for the explicit, user-authorized cleanup URL; never a migration.
export const SAMPLE_CLEANUP_REQUEST = "camkeys-sample-2026-10-14";
export function removeKnownSample(text) {
  const cleaned = text.replace(/(^|\s)привет мир(?=\s|$)/u, "$1");
  return cleaned.trim() ? cleaned : "";
}
