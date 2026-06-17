import React, { useEffect, useMemo, useState } from "react";
import {
  buildDepDisplayMap,
  listEligibleItemsForDep,
  normalizeProject,
  safeArray
} from "../../utils/project/nodeUtils";
import { DEP_KIND_LABEL, DEP_KIND_LABEL_PLURAL } from "../../utils/project/constants";
import { listAll as listAllProjects } from "../../api/projects";
import { loadProjectTree } from "../../api/milestoneConfigApi";

/* Cross-project dependencies are stored in the form value as
   "xproj:<apiId>" tokens — the target node's globally unique server id.
   Same-project dependencies stay plain local UIDs (unchanged behaviour). */
const XPROJ_PREFIX = "xproj:";
const isXProjToken = (v) => typeof v === "string" && v.startsWith(XPROJ_PREFIX);
const xprojApiId = (v) => (isXProjToken(v) ? v.slice(XPROJ_PREFIX.length) : "");

function kindBadgeLetter(kind) {
  if (kind === "milestone") return "M";
  if (kind === "activity") return "A";
  if (kind === "task") return "T";
  if (kind === "subtask") return "S";
  return "?";
}

/* Walk a project tree and index every node by its apiId so cross-project
   selections can render a friendly chip (display id + name). */
function buildApiIdDisplayMap(project, projectName) {
  const map = {};
  if (!project) return map;
  const add = (n, kind) => {
    if (n && n.apiId) {
      map[n.apiId] = { id: n.id || "", name: n.name || "", kind, projectName: projectName || "" };
    }
  };
  safeArray(project.milestones).forEach((m) => {
    add(m, "milestone");
    safeArray(m.activities).forEach((a) => {
      add(a, "activity");
      safeArray(a.tasks).forEach((t) => {
        add(t, "task");
        const walk = (list) =>
          safeArray(list).forEach((s) => {
            add(s, "subtask");
            walk(s.subtasks);
          });
        walk(t.subtasks);
      });
    });
  });
  return map;
}

export default function DependencyPicker({
  value = [],
  onChange,
  project,
  kind,
  nodeUid,
  parentUid,
  editable = true,
  currentProjectId = ""
}) {
  /* Same-kind only (per app rules) — dependency target is always the same
     kind as the node being edited. */
  const allowedKind = kind;
  const currentKind = allowedKind;
  const [msUid, setMsUid] = useState("");
  const [actUid, setActUid] = useState("");
  const [tskUid, setTskUid] = useState("");

  /* Project picker — defaults to the current project so existing behaviour
     is unchanged until the user explicitly switches projects. */
  const ownProjectId = currentProjectId || project?.projectId || "";
  const [selProjectId, setSelProjectId] = useState(ownProjectId);
  const [allProjects, setAllProjects] = useState([]);
  const [foreignCache, setForeignCache] = useState({}); // projectId -> tree
  const [loadingForeign, setLoadingForeign] = useState(false);
  const [foreignErr, setForeignErr] = useState("");

  const isForeign = !!selProjectId && selProjectId !== ownProjectId;
  const activeProject = isForeign ? foreignCache[selProjectId] : project;

  /* Load the list of projects once (only when the user can edit). */
  useEffect(() => {
    if (!editable) return;
    let alive = true;
    listAllProjects()
      .then((list) => {
        if (alive) setAllProjects(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (alive) setAllProjects([]);
      });
    return () => {
      alive = false;
    };
  }, [editable]);

  /* Fetch the chosen foreign project's tree on demand (cached). */
  useEffect(() => {
    if (!isForeign || foreignCache[selProjectId]) return;
    let alive = true;
    setLoadingForeign(true);
    setForeignErr("");
    loadProjectTree(selProjectId)
      .then((tree) => {
        if (!alive) return;
        if (tree) {
          try { normalizeProject(tree); } catch { /* best effort */ }
          setForeignCache((prev) => ({ ...prev, [selProjectId]: tree }));
        } else {
          setForeignErr("Could not load that project.");
        }
      })
      .catch(() => {
        if (alive) setForeignErr("Could not load that project.");
      })
      .finally(() => {
        if (alive) setLoadingForeign(false);
      });
    return () => {
      alive = false;
    };
  }, [isForeign, selProjectId, foreignCache]);

  /* Display maps: current project by UID, every loaded project by apiId. */
  const displayMap = useMemo(
    () => (project ? buildDepDisplayMap(project) : {}),
    [project]
  );
  const apiIdMap = useMemo(() => {
    const out = {};
    const nameOf = (pid) =>
      allProjects.find((p) => p.projectId === pid)?.projectName || "";
    Object.entries(foreignCache).forEach(([pid, tree]) => {
      Object.assign(out, buildApiIdDisplayMap(tree, nameOf(pid)));
    });
    return out;
  }, [foreignCache, allProjects]);

  /* Resolve a stored value (UID or xproj token) into a chip descriptor. */
  function resolveChip(v) {
    if (isXProjToken(v)) {
      const info = apiIdMap[xprojApiId(v)];
      if (info) {
        const label = `${info.id ? info.id + " — " : ""}${info.name}`;
        return {
          label: info.projectName ? `${label}  ·  ${info.projectName}` : label,
          kind: info.kind
        };
      }
      return { label: `Other project — ${xprojApiId(v)}`, kind: allowedKind };
    }
    const info = displayMap[v];
    return info
      ? { label: `${info.id ? info.id + " — " : ""}${info.name}`, kind: info.kind }
      : { label: v, kind: null };
  }

  const items = useMemo(() => {
    if (!activeProject) return [];
    // Exclusions (self / ancestors / descendants) only apply within the
    // current project — a foreign project has no such relationship.
    return isForeign
      ? listEligibleItemsForDep(activeProject, kind, "", "", currentKind)
      : listEligibleItemsForDep(activeProject, kind, nodeUid, parentUid, currentKind);
  }, [activeProject, isForeign, kind, nodeUid, parentUid, currentKind]);

  /* The token stored in `value` for a given eligible item. */
  function tokenFor(it) {
    return isForeign ? `${XPROJ_PREFIX}${it.apiId || it.uid}` : it.uid;
  }

  const selSet = new Set(value);

  function removeSelection(token) {
    onChange(value.filter((v) => v !== token));
  }

  function toggleItem(token, checked) {
    const cur = new Set(value);
    if (checked) cur.add(token);
    else cur.delete(token);
    onChange(Array.from(cur));
  }

  /* Read-only mode */
  if (!editable) {
    return (
      <div className="uidai-dep-wizard">
        {value.length > 0 && (
          <div className="uidai-dep-chips">
            {value.map((v) => {
              const { label, kind: k } = resolveChip(v);
              return (
                <span key={v} className="uidai-chip">
                  {k && (
                    <span className={`uidai-chip-kind-badge uidai-chip-kind-badge--${k}`}>
                      {kindBadgeLetter(k)}
                    </span>
                  )}
                  {label}
                </span>
              );
            })}
          </div>
        )}
        {value.length === 0 && <div className="uidai-hint">No dependencies</div>}
      </div>
    );
  }

  /* Compute distinct milestones / activities / tasks for cascade */
  const distinctMs = Array.from(new Set(items.map((it) => it.msUid).filter(Boolean)))
    .map((id) => safeArray(activeProject?.milestones).find((m) => m.uid === id))
    .filter(Boolean);

  const distinctAct =
    currentKind !== "milestone" && msUid
      ? (() => {
          const acts = new Set(
            items.filter((it) => it.msUid === msUid).map((it) => it.actUid).filter(Boolean)
          );
          const m = safeArray(activeProject?.milestones).find((x) => x.uid === msUid);
          return m ? safeArray(m.activities).filter((a) => acts.has(a.uid)) : [];
        })()
      : [];

  const distinctTsk =
    currentKind === "subtask" && msUid && actUid
      ? (() => {
          const tsks = new Set(
            items
              .filter((it) => it.msUid === msUid && it.actUid === actUid)
              .map((it) => it.tskUid)
              .filter(Boolean)
          );
          const m = safeArray(activeProject?.milestones).find((x) => x.uid === msUid);
          const a = m && safeArray(m.activities).find((x) => x.uid === actUid);
          return a ? safeArray(a.tasks).filter((t) => tsks.has(t.uid)) : [];
        })()
      : [];

  let finalItems = [];
  let showFinal = false;

  if (currentKind === "milestone") {
    finalItems = items;
    showFinal = true;
  } else if (currentKind === "activity") {
    if (msUid) {
      finalItems = items.filter((it) => it.msUid === msUid);
      showFinal = true;
    }
  } else if (currentKind === "task") {
    if (msUid && actUid) {
      finalItems = items.filter((it) => it.msUid === msUid && it.actUid === actUid);
      showFinal = true;
    }
  } else {
    if (msUid && actUid && tskUid) {
      finalItems = items.filter(
        (it) => it.msUid === msUid && it.actUid === actUid && it.tskUid === tskUid
      );
      showFinal = true;
    }
  }

  const allChecked =
    finalItems.length > 0 && finalItems.every((it) => selSet.has(tokenFor(it)));
  const someChecked =
    !allChecked && finalItems.some((it) => selSet.has(tokenFor(it)));

  function toggleAll(checked) {
    const cur = new Set(value);
    finalItems.forEach((it) => {
      const token = tokenFor(it);
      if (checked) cur.add(token);
      else cur.delete(token);
    });
    onChange(Array.from(cur));
  }

  function onProjectChange(nextId) {
    setSelProjectId(nextId);
    setMsUid("");
    setActUid("");
    setTskUid("");
  }

  let helpLine = "";
  if (kind === "milestone")
    helpLine = "Pick one or more milestones this milestone should wait for.";
  else if (kind === "activity")
    helpLine = "Pick one or more activities this activity should wait for. Drill down by milestone.";
  else if (kind === "task")
    helpLine = "Pick one or more tasks this task should wait for. Drill down milestone → activity.";
  else helpLine = "Pick sub-tasks this sub-task should wait for. Drill down milestone → activity → task.";

  /* Project dropdown options: current project first, then the rest. */
  const projectOptions = (() => {
    const opts = [];
    const own = allProjects.find((p) => p.projectId === ownProjectId);
    opts.push({
      id: ownProjectId,
      label: `${own?.projectName || project?.projectName || "This project"} (current)`
    });
    allProjects
      .filter((p) => p.projectId && p.projectId !== ownProjectId)
      .forEach((p) => opts.push({ id: p.projectId, label: p.projectName || p.projectId }));
    return opts;
  })();

  const scopeWord = isForeign ? "selected project" : "this project";

  return (
    <div className="uidai-dep-wizard">
      {value.length > 0 && (
        <div className="uidai-dep-chips">
          {value.map((v) => {
            const { label, kind: k } = resolveChip(v);
            return (
              <span key={v} className="uidai-chip">
                {k && (
                  <span className={`uidai-chip-kind-badge uidai-chip-kind-badge--${k}`}>
                    {kindBadgeLetter(k)}
                  </span>
                )}
                {label}
                <button
                  type="button"
                  className="uidai-chip__remove"
                  onClick={() => removeSelection(v)}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}
      {value.length === 0 && (
        <div className="uidai-hint">No dependencies yet — use the form below to link some.</div>
      )}

      <div className="uidai-dep-builder">
        <div className="uidai-dep-builder__title">Add dependencies</div>
        <div className="uidai-dep-builder__hint">{helpLine}</div>

        <div className="uidai-dep-kinds-row">
          <span className="uidai-dep-kinds-label">Linking:</span>
          <span className="uidai-dep-kinds-value">{DEP_KIND_LABEL[allowedKind]}</span>
        </div>

        {/* Project selector — drill into another project's hierarchy. */}
        <div className="uidai-dep-cascade">
          <label className="uidai-dep-cascade__label">Project</label>
          <select
            className="uidai-dep-cascade__select"
            value={selProjectId}
            onChange={(e) => onProjectChange(e.target.value)}
          >
            {projectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {isForeign && loadingForeign ? (
          <div className="uidai-dep-wait">Loading {DEP_KIND_LABEL_PLURAL[currentKind].toLowerCase()} from the selected project…</div>
        ) : isForeign && foreignErr ? (
          <div className="uidai-dep-empty">{foreignErr}</div>
        ) : items.length === 0 ? (
          <div className="uidai-dep-empty">
            No {DEP_KIND_LABEL_PLURAL[currentKind].toLowerCase()} exist in {scopeWord} to link to yet.
          </div>
        ) : (
          <>
            {currentKind !== "milestone" && (
              <div className="uidai-dep-cascade">
                <label className="uidai-dep-cascade__label">Under milestone</label>
                <select
                  className="uidai-dep-cascade__select"
                  value={msUid}
                  onChange={(e) => {
                    setMsUid(e.target.value);
                    setActUid("");
                    setTskUid("");
                  }}
                >
                  <option value="">— Select a milestone —</option>
                  {distinctMs.map((m) => (
                    <option key={m.uid} value={m.uid}>
                      {m.id ? `${m.id} — ` : ""}
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(currentKind === "task" || currentKind === "subtask") && msUid && (
              <div className="uidai-dep-cascade">
                <label className="uidai-dep-cascade__label">Under activity</label>
                <select
                  className="uidai-dep-cascade__select"
                  value={actUid}
                  onChange={(e) => {
                    setActUid(e.target.value);
                    setTskUid("");
                  }}
                >
                  <option value="">— Select an activity —</option>
                  {distinctAct.map((a) => (
                    <option key={a.uid} value={a.uid}>
                      {a.id ? `${a.id} — ` : ""}
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {currentKind === "subtask" && msUid && actUid && (
              <div className="uidai-dep-cascade">
                <label className="uidai-dep-cascade__label">Under task</label>
                <select
                  className="uidai-dep-cascade__select"
                  value={tskUid}
                  onChange={(e) => setTskUid(e.target.value)}
                >
                  <option value="">— Select a task —</option>
                  {distinctTsk.map((t) => (
                    <option key={t.uid} value={t.uid}>
                      {t.id ? `${t.id} — ` : ""}
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!showFinal && (
              <div className="uidai-dep-wait">
                Pick {currentKind === "activity" ? "a milestone" : currentKind === "task" ? "an activity" : "a task"} to continue.
              </div>
            )}

            {showFinal && finalItems.length === 0 && (
              <div className="uidai-dep-wait">
                No {DEP_KIND_LABEL_PLURAL[currentKind].toLowerCase()} available at this level.
              </div>
            )}

            {showFinal && finalItems.length > 0 && (
              <div className="uidai-dep-final">
                <div className="uidai-dep-final__head">
                  <label className="uidai-dep-final__all">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                    <span>All {DEP_KIND_LABEL_PLURAL[currentKind]}</span>
                  </label>
                  <span className="uidai-dep-final__count">
                    {finalItems.length} {DEP_KIND_LABEL_PLURAL[currentKind].toLowerCase()}
                  </span>
                </div>
                <div className="uidai-dep-final__items">
                  {finalItems.map((it) => {
                    const token = tokenFor(it);
                    return (
                      <label key={token} className="uidai-dep-final__item">
                        <input
                          type="checkbox"
                          className="select_mildstone_id"
                          checked={selSet.has(token)}
                          onChange={(e) => toggleItem(token, e.target.checked)}
                        />
                        <span className="uidai-dep-final__label">
                          {it.id ? `${it.id} — ` : ""}
                          {it.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
