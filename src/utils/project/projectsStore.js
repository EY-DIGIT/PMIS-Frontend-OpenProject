/* ═══════════════════════════════════════════════════════════════
   projectsStore.js
   A singleton data store that replaces the React Context Provider
   pattern. Components subscribe via useSyncExternalStore through a
   custom hook. No Provider is needed — the module itself holds state.
   ═══════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from "react";
import { normalizeProject, recomputeActualDates, deepClone, generateNodeUid, safeArray } from "../utils/nodeUtils";

/* ─────────────── Seed data ─────────────── */
let projects = [
  {
    projectId: "PRJ001",
    projectName: "Test Project Alpha",
    baselineId: "-",
    description: "Testing description alpha",
    status: "LIVE",
    owner: "Admin",
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    actualEndDate: "",
    isPublic: "Yes",
    category: "MSAP",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    vendors: ["Vendor A"],
    resources: [],
    milestones: [
      {
        uid: "m-seed-init",
        name: "Initiation",
        description: "Set up the project, confirm scope, and secure approvals.",
        status: "Not Completed",
        vendor: "Vendor A",
        startDate: "2026-04-01",
        endDate: "2026-04-05",
        dependsOn: [],
        activities: [
          {
            uid: "a-seed-reqcoll",
            name: "Requirement Collection",
            description: "Collect and confirm functional requirements.",
            type: "Standard Type",
            status: "Not Completed",
            startDate: "2026-04-01",
            endDate: "2026-04-02",
            dependsOn: [],
            tasks: []
          },
          {
            uid: "a-seed-kickoff",
            name: "Kickoff Preparation",
            description: "Prepare agenda, invite participants.",
            type: "Resource Type",
            status: "Not Completed",
            startDate: "2026-04-03",
            endDate: "2026-04-04",
            resourceEntryType: "details",
            resourceDetails: {
              resourceName: "John Doe",
              resType: "RFP",
              division: "PMO",
              onboardingDate: "2026-04-03",
              offboardingDate: "2026-04-04",
              actualOnboardingDate: "",
              actualOffboardingDate: "",
              position: "Lead",
              designation: "Manager",
              jobRole: "PM",
              qualification: "MBA",
              experience: "8"
            },
            dependsOn: ["a-seed-reqcoll"],
            tasks: []
          }
        ]
      },
      {
        uid: "m-seed-exec",
        name: "Execution",
        description: "Core delivery phase.",
        status: "Not Completed",
        vendor: "",
        startDate: "2026-04-06",
        endDate: "2026-04-18",
        dependsOn: ["m-seed-init"],
        activities: [
          {
            uid: "a-seed-config",
            name: "Configuration Setup",
            description: "Configure settings and validate implementation readiness.",
            type: "Transactional Type",
            status: "Not Completed",
            startDate: "2026-04-06",
            endDate: "2026-04-10",
            dependsOn: ["a-seed-kickoff"],
            tasks: []
          }
        ]
      }
    ]
  },
  {
    projectId: "PRJ001-V1",
    projectName: "Test Project Alpha",
    baselineId: "PRJ001",
    description: "Testing description alpha",
    status: "INPROGRESS",
    owner: "Admin",
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    actualEndDate: "",
    isPublic: "Yes",
    category: "MSAP",
    isVersion: true,
    versionOf: "PRJ001",
    versionNo: 1,
    auditLogs: [],
    vendors: ["Vendor A"],
    resources: [],
    milestones: [
      {
        uid: "m-v1-init",
        name: "Initiation",
        description: "Set up the project, confirm scope, and secure approvals.",
        status: "Not Completed",
        vendor: "Vendor A",
        startDate: "2026-04-01",
        endDate: "2026-04-05",
        fromBaseline: true,
        dependsOn: [],
        activities: [
          {
            uid: "a-v1-reqcoll",
            name: "Requirement Collection",
            description: "Collect and confirm functional requirements.",
            type: "Standard Type",
            status: "Not Completed",
            startDate: "2026-04-01",
            endDate: "2026-04-02",
            fromBaseline: true,
            dependsOn: [],
            tasks: [
              {
                uid: "t-v1-gather",
                name: "Gather Reference Documents",
                description: "Collect policy documents, forms, and baseline references.",
                type: "Standard Type",
                status: "Not Completed",
                startDate: "2026-04-01",
                endDate: "2026-04-01",
                fromBaseline: false,
                dependsOn: [],
                subtasks: []
              }
            ]
          }
        ]
      }
    ]
  },
  {
    projectId: "PRJ002",
    projectName: "Test Project Beta",
    baselineId: "-",
    description: "Testing description beta",
    status: "NEW",
    owner: "Supervisor",
    startDate: "2026-05-01",
    endDate: "2026-05-20",
    actualEndDate: "",
    isPublic: "No",
    category: "MSIP",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    vendors: [],
    resources: [],
    milestones: [
      {
        uid: "m-seed-plan",
        name: "Planning",
        description: "Planning and approvals.",
        status: "Not Completed",
        vendor: "",
        startDate: "2026-05-01",
        endDate: "2026-05-04",
        dependsOn: [],
        activities: [
          {
            uid: "a-seed-scope",
            name: "Scope Finalization",
            description: "Finalize the project scope.",
            type: "Standard Type",
            status: "Not Completed",
            startDate: "2026-05-02",
            endDate: "2026-05-03",
            dependsOn: [],
            tasks: []
          }
        ]
      }
    ]
  },
  {
    projectId: "PRJ003",
    projectName: "Test Project Gamma",
    baselineId: "-",
    description: "Testing description gamma",
    status: "NEW",
    owner: "Manager",
    startDate: "2026-06-01",
    endDate: "2026-06-25",
    actualEndDate: "",
    isPublic: "Yes",
    category: "BSP",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    vendors: [],
    resources: [],
    milestones: []
  }
];

/* Normalize all seed projects (assigns IDs, uids, default fields) */
projects.forEach((p) => {
  normalizeProject(p);
  try {
    recomputeActualDates(p);
  } catch (e) {}
});

/* ─────────────── Pub/sub mechanism ─────────────── */
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return projects;
}

/* ─────────────── Public API ─────────────── */
export const projectsStore = {
  getAll: () => projects,
  find: (id) => projects.find((p) => p.projectId === id),

  addProject(project) {
    projects = [project, ...projects];
    emit();
  },

  removeProject(id) {
    projects = projects.filter((p) => p.projectId !== id);
    emit();
  },

  updateProject(id, updater) {
    const idx = projects.findIndex((p) => p.projectId === id);
    if (idx < 0) return;
    const copy = projects.slice();
    const updated = updater(deepClone(copy[idx])) || copy[idx];
    copy[idx] = updated;
    projects = copy;
    emit();
  },

  /* Replace the entire collection (used after in-place mutation cascades) */
  replaceAll(next) {
    projects = next;
    emit();
  },

  /* Force-refresh subscribers when an in-place mutation happened */
  refresh() {
    projects = projects.slice();
    emit();
  },

  /* Next-ID helpers */
  getNextProjectId() {
    const max = projects.reduce((acc, p) => {
      const m = String(p.projectId || "").match(/^PRJ(\d+)(?:-V\d+)?$/i);
      return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
    }, 0);
    return `PRJ${String(max + 1).padStart(3, "0")}`;
  },

  getNextVersionId(base) {
    let maxV = 0;
    projects.forEach((p) => {
      const root = p.versionOf || String(p.projectId || "").split("-V")[0];
      if (root === base) {
        const m = String(p.projectId || "").match(/-V(\d+)$/i);
        if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
      }
    });
    return `${base}-V${maxV + 1}`;
  },

  getVersionsOf(baselineId) {
    return projects.filter(
      (p) => p.isVersion && (p.versionOf === baselineId || p.baselineId === baselineId)
    );
  },

  subscribe
};

/* ─────────────── Hooks ─────────────── */
export function useProjects() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useProject(id) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return projects.find((p) => p.projectId === id);
}
