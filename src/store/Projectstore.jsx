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
  if (!("isVersion"    in p)) p.isVersion    = false;
  if (!("versionOf"    in p)) p.versionOf    = "";
  if (!("versionNo"    in p)) p.versionNo    = 0;
  if (!("actualEndDate"in p)) p.actualEndDate= "";
  if (!p.baselineId) p.baselineId = "-";
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

// ─── Initial Demo Data ────────────────────────────────────────
const INITIAL_PROJECTS = [
  {
    projectId: "PRJ001", projectName: "Test Project Alpha", baselineId: "-",
    description: "Testing description alpha", status: "NEW", owner: "Admin",
    startDate: "2026-04-01", endDate: "2026-04-30", actualEndDate: "",
    isPublic: "Yes", category: "MSAP", isVersion: false, versionOf: "", versionNo: 0, auditLogs: [],
    milestones: [
      {
        id: "M1", name: "Initiation", description: "Set up the project, confirm scope, and secure approvals.",
        startDate: "2026-04-01", endDate: "2026-04-05",
        activities: [
          {
            id: "A1.1", name: "Requirement Collection", description: "Collect and confirm functional requirements.",
            startDate: "2026-04-01", endDate: "2026-04-02", type: "Standard Type",
            tasks: [
              { id: "T1.1.1", name: "Gather Reference Documents", description: "Collect policy documents, forms, and baseline references.", startDate: "2026-04-01", endDate: "2026-04-01", type: "Standard Type", subtasks: [] },
              { id: "T1.1.2", name: "Stakeholder Confirmation", description: "Finalize internal and external stakeholder list.", startDate: "2026-04-02", endDate: "2026-04-02", type: "Resource Type", subtasks: [] },
            ],
          },
          {
            id: "A1.2", name: "Kickoff Preparation", description: "Prepare agenda, invite participants, and finalize kickoff materials.",
            startDate: "2026-04-03", endDate: "2026-04-04", type: "Resource Type",
            tasks: [
              { id: "T1.2.1", name: "Agenda Drafting", description: "Draft the kickoff agenda and circulate for review.", startDate: "2026-04-03", endDate: "2026-04-03", type: "Standard Type", subtasks: [] },
            ],
          },
        ],
      },
      {
        id: "M2", name: "Execution", description: "Core delivery and operational implementation phase.",
        startDate: "2026-04-06", endDate: "2026-04-18",
        activities: [
          {
            id: "A2.1", name: "Configuration Setup", description: "Configure settings and validate implementation readiness.",
            startDate: "2026-04-06", endDate: "2026-04-10", type: "Transactional Type",
            tasks: [
              { id: "T2.1.1", name: "Environment Preparation", description: "Prepare the environment for execution.", startDate: "2026-04-08", endDate: "2026-04-08", type: "Standard Type", subtasks: [] },
              { id: "T2.1.2", name: "Validation Check", description: "Perform sanity validation after setup.", startDate: "2026-04-10", endDate: "2026-04-10", type: "Resource Type", subtasks: [] },
            ],
          },
          {
            id: "A2.2", name: "Functional Testing", description: "Test the configured flows against expected behavior.",
            startDate: "2026-04-11", endDate: "2026-04-16", type: "Standard Type",
            tasks: [
              { id: "T2.2.1", name: "Regression Test", description: "Run regression checks for impacted flows.", startDate: "2026-04-14", endDate: "2026-04-14", type: "Transactional Type", subtasks: [] },
              { id: "T2.2.2", name: "Defect Closure", description: "Fix and re-verify test defects.", startDate: "2026-04-16", endDate: "2026-04-16", type: "Resource Type", subtasks: [] },
            ],
          },
        ],
      },
    ],
  },
  {
    projectId: "PRJ002", projectName: "Test Project Beta", baselineId: "-",
    description: "Testing description beta", status: "INPROGRESS", owner: "Supervisor",
    startDate: "2026-05-01", endDate: "2026-05-20", actualEndDate: "",
    isPublic: "No", category: "MSIP", isVersion: false, versionOf: "", versionNo: 0, auditLogs: [],
    milestones: [
      {
        id: "M1", name: "Planning", description: "Planning and approvals.",
        startDate: "2026-05-01", endDate: "2026-05-04",
        activities: [
          {
            id: "A1.1", name: "Scope Finalization", description: "Finalize the project scope.",
            startDate: "2026-05-02", endDate: "2026-05-03", type: "Standard Type",
            tasks: [
              { id: "T1.1.1", name: "Scope Review", description: "Review all planned deliverables.", startDate: "2026-05-02", endDate: "2026-05-02", type: "Standard Type", subtasks: [] },
            ],
          },
        ],
      },
    ],
  },
  {
    projectId: "PRJ003", projectName: "Test Project Gamma", baselineId: "-",
    description: "Testing description gamma", status: "NEW", owner: "Manager",
    startDate: "2026-06-01", endDate: "2026-06-25", actualEndDate: "",
    isPublic: "Yes", category: "BSP", isVersion: false, versionOf: "", versionNo: 0, auditLogs: [], milestones: [],
  },
  {
    projectId: "PRJ004", projectName: "Test Project Delta", baselineId: "-",
    description: "Testing description delta", status: "CLOSED", owner: "Lead",
    startDate: "2026-07-01", endDate: "2026-07-18", actualEndDate: "",
    isPublic: "No", category: "MSAP", isVersion: false, versionOf: "", versionNo: 0, auditLogs: [], milestones: [],
  },
].map((p) => normalizeProject(deepClone(p)));

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