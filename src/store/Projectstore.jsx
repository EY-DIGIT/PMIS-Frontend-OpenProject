// ============================================================
// ProjectStore.jsx  –  Single source of truth for all projects
// ============================================================
import { createContext, useContext, useState } from "react";

// ─── Exported Utilities (used by page components too) ────────
export const deepClone   = (o) => JSON.parse(JSON.stringify(o));
export const safeArr     = (v) => (Array.isArray(v) ? v : []);
export const uid         = (p) => `${p}-${Math.random().toString(36).slice(2, 11)}-${Date.now().toString(36)}`;
export const fmtDate     = (d) => { if (!d || d === "-") return "-"; const p = String(d).split("-"); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d; };
export const fmtDT       = (iso) => { if (!iso) return "-"; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB"); };

export function ensureFlags(n, exp) {
  if (!n) return n;
  if (!("actualStartDate" in n)) n.actualStartDate = "";
  if (!("actualEndDate"   in n)) n.actualEndDate   = "";
  if (!Array.isArray(n.comments)) n.comments = [];
  if (!("expanded"        in n)) n.expanded = exp;
  return n;
}

export function normalizeProject(p) {
  if (!p) return p;
  if (!p.auditLogs) p.auditLogs = [];
  if (!("actualEndDate"in p)) p.actualEndDate= "";
  p.milestones = safeArr(p.milestones);
  p.milestones.forEach((m, mi) => {
    if (!m.uid) m.uid = uid("m");
    m.id = `M${mi + 1}`;
    ensureFlags(m, true);
    m.activities = safeArr(m.activities);
    m.activities.forEach((a, ai) => {
      if (!a.uid) a.uid = uid("a");
      a.id = `A${mi + 1}.${ai + 1}`;
      ensureFlags(a, true);
      a.tasks = safeArr(a.tasks);
      a.tasks.forEach((t, ti) => {
        if (!t.uid) t.uid = uid("t");
        t.id = `T${mi + 1}.${ai + 1}.${ti + 1}`;
        ensureFlags(t, false);
        t.subtasks = safeArr(t.subtasks);
        t.subtasks.forEach((s, si) => {
          if (!s.uid) s.uid = uid("s");
          s.id = `S${mi + 1}.${ai + 1}.${ti + 1}.${si + 1}`;
          ensureFlags(s, false);
        });
      });
    });
  });
  return p;
}

export function renumber(p) {
  if (!p) return;
  p.milestones = safeArr(p.milestones);
  p.milestones.forEach((m, mi) => {
    m.id = `M${mi + 1}`;
    m.activities = safeArr(m.activities);
    m.activities.forEach((a, ai) => {
      a.id = `A${mi + 1}.${ai + 1}`;
      a.tasks = safeArr(a.tasks);
      a.tasks.forEach((t, ti) => {
        t.id = `T${mi + 1}.${ai + 1}.${ti + 1}`;
        t.subtasks = safeArr(t.subtasks);
        t.subtasks.forEach((s, si) => {
          s.id = `S${mi + 1}.${ai + 1}.${ti + 1}.${si + 1}`;
        });
      });
    });
  });
}

export function addAudit(p, action, before, after) {
  if (!p) return;
  p.auditLogs = p.auditLogs || [];
  p.auditLogs.unshift({ when: new Date().toISOString(), who: "Admin", action, before, after });
}

export function rootId(p) {
  if (!p) return "";
  if (p.versionOf) return p.versionOf;
  return String(p.projectId || "").split("-V")[0];
}

export function findByUid(list, id) {
  for (const item of safeArr(list)) {
    if (item.uid === id) return item;
    const f = findByUid(item.activities || [], id) || findByUid(item.tasks || [], id) || findByUid(item.subtasks || [], id);
    if (f) return f;
  }
  return null;
}

// ─── Initial Projects (populated from API) ───────────────────
const INITIAL_PROJECTS = [];

// ─── Context ──────────────────────────────────────────────────
const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const [projects, setProjects] = useState(() =>
    INITIAL_PROJECTS.map((p) => normalizeProject(deepClone(p)))
  );
  const [loader, setLoader] = useState(null);
  const [msg,    setMsg   ] = useState(null);

  // ── Reads ────────────────────────────────────────────────────
  const getById = (id) => projects.find((p) => p.projectId === id);

  // ── Writes ───────────────────────────────────────────────────
  const mutate  = (p) => setProjects((ps) =>
    ps.map((x) => x.projectId === p.projectId ? deepClone(normalizeProject(p)) : x)
  );
  const addProject    = (p)  => setProjects((ps) => [p, ...ps]);
  const removeProject = (id) => setProjects((ps) => ps.filter((p) => p.projectId !== id));

  // ── ID generators ────────────────────────────────────────────
  const getNextId = () => {
    const max = projects.reduce((a, p) => {
      const m = String(p.projectId || "").match(/^PRJ(\d+)(?:-V\d+)?$/i);
      return m ? Math.max(a, parseInt(m[1], 10)) : a;
    }, 0);
    return `PRJ${String(max + 1).padStart(3, "0")}`;
  };

  const getNextVerId = (baseId) => {
    const sameRoot = projects.filter((p) => rootId(p) === baseId);
    let maxV = 0;
    sameRoot.forEach((p) => {
      const m = String(p.projectId || "").match(/-V(\d+)$/i);
      if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
    });
    return `${baseId}-V${maxV + 1}`;
  };

  // ── UX helpers ───────────────────────────────────────────────
  const withLoader = (label, workFn, message, onOk) => {
    setLoader(label || "Loading…");
    setTimeout(() => {
      try { workFn(); } finally { setLoader(null); setMsg({ text: message, onOk: onOk || null }); }
    }, 900);
  };

  const showMsg  = (text, onOk) => setMsg({ text, onOk: onOk || null });
  const clearMsg = () => { const cb = msg?.onOk; setMsg(null); if (cb) cb(); };

  return (
    <ProjectContext.Provider value={{
      projects, loader, msg,
      getById, mutate, addProject, removeProject,
      getNextId, getNextVerId,
      withLoader, showMsg, clearMsg,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export const useProjects = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjects must be inside <ProjectProvider>");
  return ctx;
};