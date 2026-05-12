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
  if (!("actualEndDate" in project)) project.actualEndDate = "";
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
      return "In Progress";
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

/* Build a lookup that maps every identifier a node could be referenced
   by (local uid, server apiId, server-assigned WBS / displayCode) to
   {id, name, kind}. This way the table can resolve a dependency
   regardless of whether the value in `dependsOn` has been translated
   from UUID -> local uid yet. The `id` field on the result is always
   the WBS/displayCode (e.g. "M1", "A1.2") that gets rendered in the
   Depends On chip. */
export function buildDepDisplayMap(project) {
  const map = {};
  function walk(list, kind) {
    safeArray(list).forEach((n) => {
      const entry = { id: n.id || n.serverDisplayCode || "", name: n.name || "", kind };
      if (n.uid) map[n.uid] = entry;
      if (n.apiId) map[n.apiId] = entry;
      if (n.serverDisplayCode) map[n.serverDisplayCode] = entry;
      if (n.id && n.id !== n.uid) map[n.id] = entry;
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

