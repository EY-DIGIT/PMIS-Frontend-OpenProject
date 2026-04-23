/* ═══════════════════════════════════════════════════════════════
   helpers.js — lightweight utility functions
   ═══════════════════════════════════════════════════════════════ */

export function escapeText(text) {
  return String(text ?? "");
}

export function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

export function deepClone(obj) {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

export function formatDateDisplay(iso) {
  if (!iso || iso === "-") return "-";
  const parts = String(iso).split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : iso;
}

export function formatDateTime(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch (e) {
    return iso;
  }
}

export function generateNodeUid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
