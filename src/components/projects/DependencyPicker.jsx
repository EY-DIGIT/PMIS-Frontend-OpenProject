import React, { useMemo, useState } from "react";
import {
  buildDepDisplayMap,
  listEligibleItemsForDep,
  safeArray
} from "../../utils/project/nodeUtils";
import { DEP_KIND_LABEL, DEP_KIND_LABEL_PLURAL } from "../../utils/project/constants";

function kindBadgeLetter(kind) {
  if (kind === "milestone") return "M";
  if (kind === "activity") return "A";
  if (kind === "task") return "T";
  if (kind === "subtask") return "S";
  return "?";
}

export default function DependencyPicker({
  value = [],
  onChange,
  project,
  kind,
  nodeUid,
  parentUid,
  editable = true
}) {
  const displayMap = useMemo(() => (project ? buildDepDisplayMap(project) : {}), [project]);

  /* Same-kind only (per app rules) */
  const allowedKind = kind;
  const [currentKind, setCurrentKind] = useState(allowedKind);
  const [msUid, setMsUid] = useState("");
  const [actUid, setActUid] = useState("");
  const [tskUid, setTskUid] = useState("");

  const items = useMemo(() => {
    if (!project) return [];
    return listEligibleItemsForDep(project, kind, nodeUid, parentUid, currentKind);
  }, [project, kind, nodeUid, parentUid, currentKind]);

  const selSet = new Set(value);

  function removeSelection(uid) {
    onChange(value.filter((v) => v !== uid));
  }

  function toggleItem(uid, checked) {
    const cur = new Set(value);
    if (checked) cur.add(uid);
    else cur.delete(uid);
    onChange(Array.from(cur));
  }

  /* Read-only mode */
  if (!editable) {
    return (
      <div className="uidai-dep-wizard">
        <div className="uidai-dep-chips">
          {value.map((uid) => {
            const info = displayMap[uid];
            const display = info ? `${info.id ? info.id + " — " : ""}${info.name}` : uid;
            const badge = info ? (
              <span className={`uidai-chip-kind-badge uidai-chip-kind-badge--${info.kind}`}>
                {kindBadgeLetter(info.kind)}
              </span>
            ) : null;
            return (
              <span key={uid} className="uidai-chip">
                {badge}
                {display}
              </span>
            );
          })}
        </div>
        {value.length === 0 && <div className="uidai-hint">No dependencies</div>}
      </div>
    );
  }

  /* Compute distinct milestones / activities / tasks for cascade */
  const distinctMs = Array.from(new Set(items.map((it) => it.msUid).filter(Boolean)))
    .map((id) => safeArray(project.milestones).find((m) => m.uid === id))
    .filter(Boolean);

  const distinctAct =
    currentKind !== "milestone" && msUid
      ? (() => {
          const acts = new Set(
            items.filter((it) => it.msUid === msUid).map((it) => it.actUid).filter(Boolean)
          );
          const m = safeArray(project.milestones).find((x) => x.uid === msUid);
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
          const m = safeArray(project.milestones).find((x) => x.uid === msUid);
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

  const allChecked = finalItems.length > 0 && finalItems.every((it) => selSet.has(it.uid));
  const someChecked = !allChecked && finalItems.some((it) => selSet.has(it.uid));

  function toggleAll(checked) {
    const cur = new Set(value);
    finalItems.forEach((it) => {
      if (checked) cur.add(it.uid);
      else cur.delete(it.uid);
    });
    onChange(Array.from(cur));
  }

  let helpLine = "";
  if (kind === "milestone")
    helpLine = "Pick one or more milestones this milestone should wait for.";
  else if (kind === "activity")
    helpLine = "Pick one or more activities this activity should wait for. Drill down by milestone.";
  else if (kind === "task")
    helpLine = "Pick one or more tasks this task should wait for. Drill down milestone → activity.";
  else helpLine = "Pick sub-tasks this sub-task should wait for. Drill down milestone → activity → task.";

  return (
    <div className="uidai-dep-wizard">
      <div className="uidai-dep-chips">
        {value.map((uid) => {
          const info = displayMap[uid];
          const display = info ? `${info.id ? info.id + " — " : ""}${info.name}` : uid;
          const badge = info ? (
            <span className={`uidai-chip-kind-badge uidai-chip-kind-badge--${info.kind}`}>
              {kindBadgeLetter(info.kind)}
            </span>
          ) : null;
          return (
            <span key={uid} className="uidai-chip">
              {badge}
              {display}
              <button
                type="button"
                className="uidai-chip__remove"
                onClick={() => removeSelection(uid)}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
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

        {items.length === 0 ? (
          <div className="uidai-dep-empty">
            No other {DEP_KIND_LABEL_PLURAL[currentKind].toLowerCase()} exist in this project to link to yet.
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
                  {finalItems.map((it) => (
                    <label key={it.uid} className="uidai-dep-final__item">
                      <input
                        type="checkbox"
                        checked={selSet.has(it.uid)}
                        onChange={(e) => toggleItem(it.uid, e.target.checked)}
                      />
                      <span className="uidai-dep-final__label">
                        {it.id ? `${it.id} — ` : ""}
                        {it.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
