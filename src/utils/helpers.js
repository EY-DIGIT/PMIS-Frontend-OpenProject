export function formatDateDisplay(isoDate) {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : isoDate;
}

export function normalizeMapping(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function renderMappingText(value) {
  return normalizeMapping(value).join(', ');
}

export function normalizeText(value) {
  return String(value ?? '').toLowerCase().trim();
}

export function uniqueSorted(values) {
  return Array.from(
    new Set((values || []).map((v) => String(v).trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}
