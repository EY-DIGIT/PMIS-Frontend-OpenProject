/* ═══════════════════════════════════════════════════════════════
   nodeUtils.js — all the node-traversal, normalization, status-
   propagation, progress and tracking helpers ported from the
   original vanilla JS app.
   ═══════════════════════════════════════════════════════════════ */

import { safeArray, deepClone, generateNodeUid } from "./helpers";

export { safeArray, deepClone, generateNodeUid };

/* ─────────────── Normalization ─────────────── */
export function normalizeNode(node, kind) {
  if (!node.uid) node.uid = generateNodeUid(kind[0]);
  if (!node.comments) node.comments = [];
  if (!node.attachments) node.attachments = [];
  if (!("status" in node) || !node.status) node.status = "Not Completed";
  if (!("description" in node)) node.description = "";
  if (!("startDate" in node)) node.startDate = "";
  if (!("endDate" in node)) node.endDate = "";
  if (!("actualStartDate" in node)) node.actualStartDate = "";
  if (!("actualEndDate" in node)) node.actualEndDate = "";
  if (!("dependsOn" in node)) node.dependsOn = [];
  if (!("fromBaseline" in node)) node.fromBaseline = false;
  if (kind === "milestone" && !("vendor" in node)) node.vendor = "";
  if (kind !== "milestone" && !("type" in node)) node.type = "Standard Type";
  if (kind === "activity" || kind === "task" || kind === "subtask") {
    if (!("resourceEntryType" in node)) node.resourceEntryType = "details";
    if (!node.resourceDetails) node.resourceDetails = {};
    if (!node.resourceCount)
      node.resourceCount = { resType: "RFP", count: 1, onboardingDate: "", division: "" };
  }
}

export function normalizeProject(project) {
  if (!project.auditLogs) project.auditLogs = [];
  if (!("isVersion" in project)) project.isVersion = false;
  if (!("versionOf" in project)) project.versionOf = "";
  if (!("versionNo" in project)) project.versionNo = 0;
  if (!("actualEndDate" in project)) project.actualEndDate = "";
  if (!project.baselineId) project.baselineId = "-";
  if (!project.vendors) project.vendors = [];
  if (!project.resources) project.resources = [];
  project.milestones = safeArray(project.milestones);

  project.milestones.forEach((m, mi) => {
    normalizeNode(m, "milestone");
    m.id = m.serverDisplayCode || `M${mi + 1}`;
    m.activities = safeArray(m.activities);
    m.activities.forEach((a, ai) => {
      normalizeNode(a, "activity");
      a.id = a.serverDisplayCode || `A${mi + 1}.${ai + 1}`;
      a.tasks = safeArray(a.tasks);
      a.tasks.forEach((t, ti) => {
        normalizeNode(t, "task");
        t.id = t.serverDisplayCode || `T${mi + 1}.${ai + 1}.${ti + 1}`;
        t.subtasks = safeArray(t.subtasks);
        normalizeSubtaskList(t.subtasks, t.id);
      });
    });
  });
  return project;
}

function normalizeSubtaskList(list, parentId) {
  list.forEach((s, si) => {
    normalizeNode(s, "subtask");
    /* Prefer the server-assigned WBS code (e.g. "S1.1.1.1.1.1") so the
       client matches whatever the API produces; fall back to a chained
       parent-prefix ID for any legacy / un-mapped node. */
    s.id = s.serverDisplayCode || `${parentId}.${si + 1}`;
    s.subtasks = safeArray(s.subtasks);
    normalizeSubtaskList(s.subtasks, s.id);
  });
}

/* ─────────────── Project helpers ─────────────── */
export function isVersionProject(p) {
  return !!p && !!p.isVersion;
}

export function isBaselineProject(p) {
  return !!p && !p.isVersion;
}

export function isPublishedBaseline(p) {
  return !!p && !p.isVersion && p.status === "PUBLISHED";
}

export function getRootProjectId(p) {
  return p.versionOf || String(p.projectId || "").split("-V")[0];
}

export function isNodeBaselineLocked(project, node) {
  if (!project || !node) return false;
  if (!isVersionProject(project)) return false;
  return !!node.fromBaseline;
}

export function markSubtreeFromBaseline(node) {
  if (!node) return;
  node.fromBaseline = true;
  const kids = getChildren(node);
  kids.forEach(markSubtreeFromBaseline);
}

/* ─────────────── Traversal ─────────────── */
export function getChildren(node) {
  if (!node) return [];
  if (node.activities) return safeArray(node.activities);
  if (node.tasks) return safeArray(node.tasks);
  return safeArray(node.subtasks);
}

export function locateNode(project, uid) {
  if (!project) return null;
  const stack = [];
  function scan(list, parent, parentKind, kind) {
    for (const item of list) {
      const chain = stack.concat([{ node: item, kind, parent, parentKind }]);
      if (item.uid === uid) return chain;
      stack.push({ node: item, kind, parent, parentKind });
      let res = null;
      if (kind === "milestone")
        res = scan(safeArray(item.activities), item, "milestone", "activity");
      else if (kind === "activity") res = scan(safeArray(item.tasks), item, "activity", "task");
      else if (kind === "task") res = scan(safeArray(item.subtasks), item, "task", "subtask");
      else if (kind === "subtask") res = scan(safeArray(item.subtasks), item, "subtask", "subtask");
      stack.pop();
      if (res) return res;
    }
    return null;
  }
  const chain = scan(safeArray(project.milestones), project, "project", "milestone");
  if (!chain) return null;
  const last = chain[chain.length - 1];
  return {
    node: last.node,
    kind: last.kind,
    parent: last.parent,
    parentKind: last.parentKind,
    chain
  };
}

export function collectDescendantUids(node) {
  const out = [];
  function walk(list) {
    safeArray(list).forEach((n) => {
      out.push(n.uid);
      walk(getChildren(n));
    });
  }
  walk(getChildren(node));
  return out;
}

/* ─────────────── Status propagation ─────────────── */
export function effectiveStatus(node) {
  if (!node) return "Not Completed";
  if (node.status === "Completed") return "Completed";
  const kids = getChildren(node);
  if (!kids.length) return node.status || "Not Completed";
  const allDone = kids.every((k) => effectiveStatus(k) === "Completed");
  return allDone ? "Completed" : node.status || "Not Completed";
}

export function rollUpStatus(project) {
  function walk(node, kind) {
    const kids = getChildren(node);
    kids.forEach((k) => {
      let childKind = "subtask";
      if (kind === "project") childKind = "milestone";
      else if (kind === "milestone") childKind = "activity";
      else if (kind === "activity") childKind = "task";
      walk(k, childKind);
    });
    if (kids.length && kids.every((k) => k.status === "Completed")) {
      node.status = "Completed";
    }
  }
  walk(project, "project");
}

/* ─────────────── Progress ─────────────── */
export function computeProgress(node) {
  if (!node) return 0;
  const kids = getChildren(node);
  if (!kids.length) {
    return effectiveStatus(node) === "Completed" ? 100 : 0;
  }
  const total = kids.reduce((acc, k) => acc + computeProgress(k), 0);
  return Math.round(total / kids.length);
}

export function computeEffectiveActuals(node) {
  const kids = getChildren(node);
  if (!kids.length) {
    return {
      start: node.actualStartDate || "",
      end: node.actualEndDate || ""
    };
  }
  let minStart = "";
  let maxEnd = "";
  kids.forEach((k) => {
    const eff = computeEffectiveActuals(k);
    const s = eff.start || k.startDate || "";
    const e = eff.end || k.endDate || "";
    if (s && (!minStart || s < minStart)) minStart = s;
    if (e && (!maxEnd || e > maxEnd)) maxEnd = e;
  });
  return { start: minStart, end: maxEnd };
}

export function recomputeActualDates(project) {
  function walk(node) {
    const kids = getChildren(node);
    kids.forEach(walk);
    if (kids.length) {
      const eff = computeEffectiveActuals(node);
      node.actualStartDate = eff.start;
      node.actualEndDate = eff.end;
    }
  }
  safeArray(project.milestones).forEach(walk);
}

/* ─────────────── Status classification (Track page) ─────────────── */
export function classifyStatus(node) {
  if (!node) return "notstarted";
  if (node.status === "Closed") return "closed";
  const eff = effectiveStatus(node);
  if (eff === "Completed") return "completed";
  const progress = computeProgress(node);
  const todayStr = new Date().toISOString().slice(0, 10);
  const end = node.endDate || "";

  if (end && todayStr > end) return "delayed";
  const actuals = computeEffectiveActuals(node);
  const hasStarted = !!actuals.start || progress > 0;
  if (!hasStarted) return "notstarted";
  if (progress > 0 && progress < 100) return "ontrack";
  return "notcompleted";
}

export function statusLabelFor(key) {
  switch (key) {
    case "completed":
      return "Completed";
    case "ontrack":
      return "On Track";
    case "delayed":
      return "Delayed";
    case "notstarted":
      return "Not Started";
    case "notcompleted":
      return "Not Completed";
    case "closed":
      return "Closed";
    default:
      return "Not Started";
  }
}

/* ─────────────── Audit ─────────────── */
export function addAudit(project, action, before, after) {
  if (!project) return;
  if (!project.auditLogs) project.auditLogs = [];
  project.auditLogs.unshift({
    when: new Date().toISOString(),
    who: "Admin",
    action,
    before,
    after
  });
}

/* ─────────────── Display maps & deps ─────────────── */
export function buildDepDisplayMap(project) {
  const map = {};
  function walk(list, kind) {
    safeArray(list).forEach((n) => {
      map[n.uid] = { id: n.id || "", name: n.name || "", kind };
      if (kind === "milestone") walk(n.activities, "activity");
      else if (kind === "activity") walk(n.tasks, "task");
      else walk(n.subtasks, "subtask");
    });
  }
  walk(project.milestones, "milestone");
  return map;
}

export function getAncestorUidsForNode(project, nodeUid, parentUid) {
  const set = new Set();
  if (nodeUid) {
    const loc = locateNode(project, nodeUid);
    if (loc && loc.chain) {
      loc.chain.slice(0, -1).forEach((step) => set.add(step.node.uid));
    }
  } else if (parentUid) {
    const ploc = locateNode(project, parentUid);
    if (ploc && ploc.chain) {
      ploc.chain.forEach((step) => set.add(step.node.uid));
    }
  }
  return set;
}

export function getDescendantUidsForNode(project, nodeUid) {
  const set = new Set();
  if (!nodeUid) return set;
  const loc = locateNode(project, nodeUid);
  if (!loc) return set;
  function walk(n) {
    getChildren(n).forEach((c) => {
      set.add(c.uid);
      walk(c);
    });
  }
  walk(loc.node);
  return set;
}

export function buildDepExclusionSet(project, nodeUid, parentUid) {
  const ancestors = getAncestorUidsForNode(project, nodeUid, parentUid);
  const descendants = getDescendantUidsForNode(project, nodeUid);
  const excluded = new Set([...ancestors, ...descendants]);
  if (nodeUid) excluded.add(nodeUid);
  return excluded;
}

export function listEligibleItemsForDep(project, nodeKind, nodeUid, parentUid, depKind) {
  const excluded = buildDepExclusionSet(project, nodeUid, parentUid);
  const out = [];

  if (depKind === "milestone") {
    safeArray(project.milestones).forEach((m) => {
      if (excluded.has(m.uid)) return;
      out.push({ uid: m.uid, id: m.id || "", name: m.name || "", msUid: "", actUid: "", tskUid: "" });
    });
    return out;
  }

  if (depKind === "activity") {
    safeArray(project.milestones).forEach((m) => {
      safeArray(m.activities).forEach((a) => {
        if (excluded.has(a.uid)) return;
        out.push({
          uid: a.uid,
          id: a.id || "",
          name: a.name || "",
          msUid: m.uid,
          actUid: "",
          tskUid: ""
        });
      });
    });
    return out;
  }

  if (depKind === "task") {
    safeArray(project.milestones).forEach((m) => {
      safeArray(m.activities).forEach((a) => {
        safeArray(a.tasks).forEach((t) => {
          if (excluded.has(t.uid)) return;
          out.push({
            uid: t.uid,
            id: t.id || "",
            name: t.name || "",
            msUid: m.uid,
            actUid: a.uid,
            tskUid: ""
          });
        });
      });
    });
    return out;
  }

  /* subtask */
  safeArray(project.milestones).forEach((m) => {
    safeArray(m.activities).forEach((a) => {
      safeArray(a.tasks).forEach((t) => {
        function walk(list) {
          safeArray(list).forEach((s) => {
            if (!excluded.has(s.uid)) {
              out.push({
                uid: s.uid,
                id: s.id || "",
                name: s.name || "",
                msUid: m.uid,
                actUid: a.uid,
                tskUid: t.uid
              });
            }
            walk(s.subtasks);
          });
        }
        walk(t.subtasks);
      });
    });
  });
  return out;
}

/* ─────────────── Date bounds (Change #8) ─────────────── */
export function getParentDateBounds(project, nodeUid) {
  if (!nodeUid || !project) return null;
  const loc = locateNode(project, nodeUid);
  if (!loc) return getParentDateBoundsForNew(project, null);
  const { parentKind, parent } = loc;
  if (parentKind === "project") return { start: project.startDate || "", end: project.endDate || "" };
  return { start: parent.startDate || "", end: parent.endDate || "" };
}

export function getParentDateBoundsForNew(project, parentUid) {
  if (!project) return null;
  if (!parentUid) return { start: project.startDate || "", end: project.endDate || "" };
  const loc = locateNode(project, parentUid);
  if (!loc) return { start: project.startDate || "", end: project.endDate || "" };
  return { start: loc.node.startDate || "", end: loc.node.endDate || "" };
}

export function findChildDateViolations(node, newStart, newEnd) {
  const out = [];
  function walk(list) {
    safeArray(list).forEach((k) => {
      const s = k.startDate || "";
      const e = k.endDate || "";
      if ((s && (s < newStart || s > newEnd)) || (e && (e < newStart || e > newEnd))) {
        out.push(k);
      }
      walk(getChildren(k));
    });
  }
  walk(getChildren(node));
  return out;
}

/* ─────────────── Baseline → version propagation ─────────────── */
export function propagateNodeAddToVersions(allProjects, baseProject, parentUid, kind, newNode) {
  const versions = allProjects.filter(
    (p) => p.isVersion && (p.versionOf === baseProject.projectId || p.baselineId === baseProject.projectId)
  );
  versions.forEach((v) => {
    const clone = deepClone(newNode);
    markSubtreeFromBaseline(clone);
    if (kind === "milestone") {
      v.milestones = safeArray(v.milestones);
      if (!v.milestones.some((m) => m.uid === clone.uid)) v.milestones.push(clone);
    } else {
      const loc = locateNode(v, parentUid);
      if (!loc) return;
      const list =
        kind === "activity"
          ? (loc.node.activities = safeArray(loc.node.activities))
          : kind === "task"
          ? (loc.node.tasks = safeArray(loc.node.tasks))
          : (loc.node.subtasks = safeArray(loc.node.subtasks));
      if (!list.some((x) => x.uid === clone.uid)) list.push(clone);
    }
    normalizeProject(v);
    recomputeActualDates(v);
    addAudit(v, `Baseline added ${kind}`, "-", deepClone(newNode));
  });
}

export function propagateNodeUpdateToVersions(allProjects, baseProject, nodeUid, updatedFields) {
  const versions = allProjects.filter(
    (p) => p.isVersion && (p.versionOf === baseProject.projectId || p.baselineId === baseProject.projectId)
  );
  versions.forEach((v) => {
    const loc = locateNode(v, nodeUid);
    if (!loc) return;
    const before = deepClone(loc.node);
    Object.keys(updatedFields).forEach((k) => {
      loc.node[k] = deepClone(updatedFields[k]);
    });
    recomputeActualDates(v);
    addAudit(v, `Baseline updated ${loc.kind}`, before, deepClone(loc.node));
  });
}

export function propagateNodeDeleteToVersions(allProjects, baseProject, nodeUid) {
  const versions = allProjects.filter(
    (p) => p.isVersion && (p.versionOf === baseProject.projectId || p.baselineId === baseProject.projectId)
  );
  versions.forEach((v) => {
    const loc = locateNode(v, nodeUid);
    if (!loc) return;
    const { parent, parentKind, node } = loc;
    const removed = deepClone(node);
    let list;
    if (parentKind === "project") list = parent.milestones;
    else if (parentKind === "milestone") list = parent.activities;
    else if (parentKind === "activity") list = parent.tasks;
    else list = parent.subtasks;
    const idx = list.findIndex((x) => x.uid === nodeUid);
    if (idx >= 0) list.splice(idx, 1);
    normalizeProject(v);
    recomputeActualDates(v);
    addAudit(v, `Baseline deleted ${loc.kind}`, removed, "-");
  });
}

export function propagateBaselineDetailsToVersions(allProjects, baseProject) {
  const versions = allProjects.filter(
    (p) => p.isVersion && (p.versionOf === baseProject.projectId || p.baselineId === baseProject.projectId)
  );
  versions.forEach((v) => {
    v.projectName = baseProject.projectName;
    v.description = baseProject.description;
    v.startDate = baseProject.startDate;
    v.endDate = baseProject.endDate;
    v.vendors = deepClone(safeArray(baseProject.vendors));
    addAudit(v, "Baseline details synced", "-", {
      projectName: v.projectName,
      description: v.description,
      startDate: v.startDate,
      endDate: v.endDate
    });
  });
}
