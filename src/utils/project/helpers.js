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

/* ─────────────── Finance / CCN helpers ─────────────── */
export function formatINR(value) {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(n);
  } catch (e) {
    return `₹${n.toLocaleString("en-IN")}`;
  }
}

export function getCCNCapAmount(project) {
  if (!project) return 0;
  const tpv = Number(project.totalProjectValue) || 0;
  const pct = Number(project.ccnCapPercent);
  const effPct = isFinite(pct) ? pct : 25;
  return tpv * effPct / 100;
}

export function computeCCNUsage(project) {
  if (!project) return 0;
  let used = 0;
  safeArray(project.milestones).forEach((m) => {
    if (m && m.category === "ccn") used += Number(m.ccnValue) || 0;
    safeArray(m && m.activities).forEach((a) => {
      if (a && a.category === "ccn") used += Number(a.ccnValue) || 0;
    });
  });
  return used;
}

/* ─────────────── Activity approval helpers ─────────────── */
export function activityHasNoTasks(activity) {
  return !activity || safeArray(activity.tasks).length === 0;
}

function isLeafCompleted(node) {
  if (!node) return false;
  if (node.status === "Completed") return true;
  return false;
}

export function flattenActivityLeaves(activity) {
  const out = [];
  function walkSubs(list) {
    safeArray(list).forEach((s) => {
      const subs = safeArray(s.subtasks);
      if (subs.length) walkSubs(subs);
      else out.push(s);
    });
  }
  safeArray(activity && activity.tasks).forEach((t) => {
    const subs = safeArray(t.subtasks);
    if (subs.length) walkSubs(subs);
    else out.push(t);
  });
  return out;
}

export function activityTasksAllComplete(activity) {
  const leaves = flattenActivityLeaves(activity);
  if (!leaves.length) return false;
  return leaves.every(isLeafCompleted);
}
