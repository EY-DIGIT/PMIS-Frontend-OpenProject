import React, { useEffect, useMemo, useState } from "react";
import DependencyPicker from "../DependencyPicker";
import ChipControl from "../ChipControl";
import {
  NODE_TYPE_OPTIONS,
  RESOURCE_TYPE_CODES,
  DIVISION_OPTIONS,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_FILE_EXTENSIONS,
  ALLOWED_FILE_ACCEPT,
  isAllowedAttachment,
  getFileExtension
} from "../../../utils/project/constants";
import {
  locateNode,
  getChildren,
  computeEffectiveActuals,
  getParentDateBounds,
  getParentDateBoundsForNew,
  safeArray
} from "../../../utils/project/nodeUtils";
import { formatDateDisplay, formatDateTime } from "../../../utils/project/helpers";
import {
  loadResourceTypes,
  loadDivisions,
  loadActivityById,
  loadTaskById,
  loadSubtaskById,
  loadCommentsForEntity
} from "../../../api/milestoneConfigApi";
import { getToken } from "../../../api/auth";

const TITLE_MAP = {
  milestone: "Milestone",
  activity: "Activity",
  task: "Task",
  subtask: "Sub Task"
};

function hintFor(kind) {
  if (kind === "milestone") return "Milestones drive the project structure.";
  if (kind === "activity") return "Activity Type is required for every activity.";
  if (kind === "task") return "Task Type is required for every task.";
  return "Sub-Tasks can be nested under tasks or under other sub-tasks.";
}

// Accept either "Capgemini" or {id, name}. Always return a name string.
function vendorName(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.name || "";
  return "";
}
function vendorKey(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.id || v.name || "";
  return "";
}

/* Concerned Division UI value is an array of division codes. Wire format
   is `["TMD1, TMD2"]` — a single-element array whose element is the
   comma-joined list. Accept either shape (plus a bare string from older
   records) and flatten to an array of trimmed codes. */
export function parseDivisionList(v) {
  if (Array.isArray(v)) {
    const out = [];
    v.forEach((x) => {
      String(x || "").split(",").forEach((s) => {
        const t = s.trim();
        if (t) out.push(t);
      });
    });
    return out;
  }
  if (typeof v === "string" && v.trim()) {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function makeDefaultForm(kind, node, mode, parentNode) {
  const n = node || {};
  const inheritFromParent =
    mode === "add" &&
    (kind === "task" || kind === "subtask") &&
    parentNode &&
    parentNode.type;
  return {
    name: n.name || "",
    description: n.description || "",
    startDate: n.startDate || "",
    endDate: n.endDate || "",
    actualStartDate: n.actualStartDate || "",
    actualEndDate: n.actualEndDate || "",
    status: n.status || "Not Completed",
    type: inheritFromParent
      ? parentNode.type
      : n.type || (kind === "milestone" ? "" : "Standard Type"),
    // Doc 38: activity-only fields. Backend stores them as ownerDivision /
    // vendorId / concernedDivision and accepts them on PATCH only.
    ownerDivision: n.ownerDivision || "",
    vendorId: n.vendorId || "",
    concernedDivision: parseDivisionList(n.concernedDivision),
    vendor: n.vendor || "",
    dependsOn: safeArray(n.dependsOn),
    resourceEntryType: n.resourceEntryType || "details",
    resourceDetails: {
      resourceName: "",
      resType: "",
      division: "",
      divisionOther: "",
      onboardingDate: "",
      offboardingDate: "",
      actualOnboardingDate: "",
      actualOffboardingDate: "",
      position: "",
      designation: "",
      jobRole: "",
      qualification: "",
      experience: "",
      ...(n.resourceDetails || {})
    },
    resourceCount: {
      resType: "",
      count: 1,
      onboardingDate: "",
      division: "",
      divisionOther: "",
      ...(n.resourceCount || {})
    },
    comments: safeArray(n.comments).slice()
  };
}

export default function NodeModal({
  open,
  kind,
  mode,
  project,
  parentUid,
  nodeUid,
  editable,
  onCancel,
  onSave
}) {
  const node = useMemo(() => {
    if (!open || !nodeUid || !project) return null;
    const loc = locateNode(project, nodeUid);
    return loc ? loc.node : null;
  }, [open, nodeUid, project]);

  // Backend rule: subtask resourceMode/resource is only valid when parent task's type is 'resource'.
  // (Same applies if parent is itself a subtask — resource fields stay only inside a resource subtree.)
  const parentNode = useMemo(() => {
    if (!open || !parentUid || !project) return null;
    const loc = locateNode(project, parentUid);
    return loc ? loc.node : null;
  }, [open, parentUid, project]);
  const parentTypeIsResource = parentNode?.type === "Resource Type";

  const [form, setForm] = useState(() => makeDefaultForm(kind, node, mode, parentNode));
  const [commentText, setCommentText] = useState("");
  const [commentFiles, setCommentFiles] = useState([]);
  const [attachError, setAttachError] = useState("");
  const [resourceTypes, setResourceTypes] = useState([]);
  const [resourceTypesLoading, setResourceTypesLoading] = useState(false);
  const [divisions, setDivisions] = useState([]);
  const [divisionsLoading, setDivisionsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(makeDefaultForm(kind, node, mode, parentNode));
      setCommentText("");
      setCommentFiles([]);
      setAttachError("");
    }
  }, [open, kind, node, mode, parentNode]);

  useEffect(() => {
    if (!open || kind === "milestone" || !getToken()) return;
    let cancelled = false;
    setResourceTypesLoading(true);
    setDivisionsLoading(true);
    loadResourceTypes()
      .then((list) => { if (!cancelled) setResourceTypes(list); })
      .catch(() => { if (!cancelled) setResourceTypes([]); })
      .finally(() => { if (!cancelled) setResourceTypesLoading(false); });
    loadDivisions()
      .then((list) => { if (!cancelled) setDivisions(list); })
      .catch(() => { if (!cancelled) setDivisions([]); })
      .finally(() => { if (!cancelled) setDivisionsLoading(false); });
    return () => { cancelled = true; };
  }, [open, kind]);

  /* Older records may have stored Concerned Division as labels ("TMD1") instead
     of codes ("tmd1"). Once the divisions list arrives, rewrite any label-form
     values in the form to their canonical code so we always send the code. */
  useEffect(() => {
    const list = safeArray(divisions);
    if (list.length === 0) return;
    const lookup = new Map();
    list.forEach((d) => {
      if (!d) return;
      const code = String(d.code || "");
      if (code) lookup.set(code.toLowerCase(), code);
      if (d.label) lookup.set(String(d.label).toLowerCase(), code);
    });
    setForm((f) => {
      const cur = safeArray(f.concernedDivision);
      if (cur.length === 0) return f;
      const next = cur.map((v) => lookup.get(String(v).toLowerCase()) || v);
      const changed = next.some((v, i) => v !== cur[i]);
      return changed ? { ...f, concernedDivision: next } : f;
    });
  }, [divisions]);

  /* Edit mode: list endpoints return summary rows that omit the nested
     `resource` object — fetch the full single record so the form prefills
     correctly (especially for Resource Type activities/tasks/subtasks).
     IMPORTANT: the freshly-fetched record's `dependsOn` contains the raw
     server display IDs ("M1", "A1.2", …); the project-level resolver only
     ran over the cached tree, so we keep the CACHED node's `dependsOn`
     (already translated to local UIDs) when seeding the form. */
  useEffect(() => {
    if (!open || mode !== "edit" || !node?.apiId || !getToken()) return;
    if (kind === "milestone") return;
    const fetcher =
      kind === "activity" ? loadActivityById :
      kind === "task" ? loadTaskById :
      kind === "subtask" ? loadSubtaskById :
      null;
    if (!fetcher) return;
    let cancelled = false;
    fetcher(node.apiId)
      .then((full) => {
        if (cancelled || !full) return;
        const merged = {
          ...full,
          dependsOn: safeArray(node.dependsOn),
          dependsOnDisplay: safeArray(node.dependsOnDisplay)
        };
        setForm(makeDefaultForm(kind, merged, mode, parentNode));
      })
      .catch(() => { /* keep cached node form on failure */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, kind, node && node.apiId]);

  /* Load existing comments + attachments for the node so they appear in
     the Comments panel when the modal opens. The list adapter sets
     comments:[] regardless, so without this fetch the panel is always
     empty even after the user posts a comment. */
  useEffect(() => {
    if (!open || mode !== "edit" || !node?.apiId || !getToken()) return;
    let cancelled = false;
    loadCommentsForEntity(kind, node.apiId)
      .then((items) => {
        if (cancelled) return;
        setForm((f) => ({ ...f, comments: items || [] }));
      })
      .catch(() => { /* swallow — comments are best-effort */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, kind, node && node.apiId]);

  if (!open || !project) return null;

  const isAdd = mode === "add";
  const showStatus = !isAdd;
  const showActuals = !isAdd && kind !== "milestone";
  // Doc 38: activity / task / subtask no longer have a `type` at the API
  // level (the four /standard, /transactional, /resource/* variants were
  // collapsed into a single create endpoint). The Type select is hidden;
  // ResourceSection is also hidden (kept in form state for backwards
  // compat with stale data, but never sent).
  const showType = false;
  const showResourceSection = false;
  // Activity-only fields per design + Doc 38 backend support.
  const showActivityFields = kind === "activity";
  const showVendor = false;
  const hasKids = node ? getChildren(node).length > 0 : false;
  const effActuals = node ? computeEffectiveActuals(node) : { start: "", end: "" };

  const actualStartValue = hasKids && node ? effActuals.start || "" : form.actualStartDate;
  const actualEndValue = hasKids && node ? effActuals.end || "" : form.actualEndDate;
  const actualDisabled = hasKids || !editable;

  const bounds = isAdd
    ? getParentDateBoundsForNew(project, parentUid)
    : getParentDateBounds(project, nodeUid);

  const isOnboarding = !project.projectId;
  const showDepsSection = !isOnboarding && !isAdd && (kind === "milestone" || kind === "activity");

  function updateField(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function validateFiles(files) {
    const disallowed = files.filter((f) => !isAllowedAttachment(f));
    if (disallowed.length) {
      const names = disallowed
        .map((f) => `${f.name} (.${getFileExtension(f.name) || "?"})`)
        .join(", ");
      setAttachError(
        `Unsupported file type: ${names}. Allowed types: ${ALLOWED_FILE_EXTENSIONS.join(", ")}.`
      );
      return false;
    }
    const oversize = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversize.length) {
      const names = oversize
        .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`)
        .join(", ");
      setAttachError(`File too large (max 25 MB): ${names}`);
      return false;
    }
    setAttachError("");
    return true;
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (!validateFiles(files)) {
      e.target.value = "";
      setCommentFiles([]);
      return;
    }
    setCommentFiles(files);
  }

  function adjResCount(delta) {
    setForm((f) => ({
      ...f,
      resourceCount: {
        ...f.resourceCount,
        count: Math.max(1, (parseInt(f.resourceCount.count, 10) || 1) + delta)
      }
    }));
  }

  function save() {
    const payload = { ...form, bounds };
    const body = commentText.trim();
    if (body) payload.body = body;
    if (commentFiles.length) payload.files = commentFiles;
    onSave(payload);
  }

  const dis = editable ? false : true;
  const projectVendors = safeArray(project.vendors);
  const title = !editable
    ? `View ${TITLE_MAP[kind] || ""} (Baseline — read-only)`
    : `${isAdd ? "Add" : "View/Update"} ${TITLE_MAP[kind] || ""}`;
  const hintText = !editable
    ? "This item is part of the published baseline and cannot be edited within a version."
    : hintFor(kind);

  return (
    <div className="uidai-modal">
      <div className="uidai-modal__box uidai-modal__box--wide" style={{ position: "relative" }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            width: 28,
            height: 28,
            border: "none",
            background: "transparent",
            fontSize: 22,
            lineHeight: 1,
            cursor: "pointer",
            color: "#666",
            padding: 0
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">{title}</h3>
        <div className="uidai-hint" style={{ marginBottom: 12 }}>
          {hintText}
        </div>

        <div className="uidai-grid">
          {node && node.id && (
            <div className="uidai-field">
              <label className="uidai-field__label">
                {TITLE_MAP[kind] || ""} ID
              </label>
              <input className="uidai-input" value={node.id || ""} disabled />
            </div>
          )}

          <div className="uidai-field">
            <label className="uidai-field__label">
              Name <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.name}
              onChange={(e) => updateField({ name: e.target.value })}
              disabled={dis}
            />
          </div>

          {showType && (() => {
            // For tasks/subtasks: backend rejects type='Resource Type' unless the parent is also resource.
            // Activities don't have this constraint (parent milestone has no type).
            // Only filter on add — edit mode keeps the existing value visible even if inconsistent.
            const restrictResource =
              isAdd &&
              (kind === "task" || kind === "subtask") &&
              !parentTypeIsResource;
            const typeOptions = restrictResource
              ? NODE_TYPE_OPTIONS.filter((t) => t !== "Resource Type")
              : NODE_TYPE_OPTIONS;
            // When adding a task or subtask, lock its type to the parent's type.
            const lockToParentType =
              isAdd &&
              (kind === "task" || kind === "subtask") &&
              !!(parentNode && parentNode.type);
            return (
              <div className="uidai-field">
                <label className="uidai-field__label">
                  {kind === "activity" ? "Activity" : kind === "task" ? "Task" : "Sub Task"} Type{" "}
                  <span className="uidai-required-project">*</span>
                </label>
                <select
                  className="uidai-select"
                  value={form.type}
                  onChange={(e) => updateField({ type: e.target.value })}
                  disabled={dis || lockToParentType}
                >
                  {typeOptions.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                {lockToParentType && (
                  <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                    Inherited from parent {kind === "task" ? "activity" : "task"} type.
                  </div>
                )}
                {restrictResource && !lockToParentType && (
                  <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                    Resource Type is only available when the parent {kind === "task" ? "activity" : "task"} is also Resource Type.
                  </div>
                )}
              </div>
            );
          })()}

          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Description</label>
            <textarea
              className="uidai-textarea"
              maxLength={5000}
              value={form.description}
              onChange={(e) => updateField({ description: e.target.value })}
              disabled={dis}
            />
            <div className="uidai-char-count">
              {5000 - form.description.length} characters remaining
            </div>
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected Start Date <span className="uidai-required-project">*</span>
            </label>
            <input
              type="date"
              className="uidai-input"
              value={form.startDate}
              min={(bounds && bounds.start) || undefined}
              max={form.endDate || (bounds && bounds.end) || undefined}
              onChange={(e) => updateField({ startDate: e.target.value })}
              disabled={dis}
            />
            {bounds && bounds.start && bounds.end && (
              <div className="uidai-hint">
                Allowed range: {formatDateDisplay(bounds.start)} to {formatDateDisplay(bounds.end)}
              </div>
            )}
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected End Date <span className="uidai-required-project">*</span>
            </label>
            <input
              type="date"
              className="uidai-input"
              value={form.endDate}
              min={form.startDate || (bounds && bounds.start) || undefined}
              max={(bounds && bounds.end) || undefined}
              onChange={(e) => updateField({ endDate: e.target.value })}
              disabled={dis}
            />
            {bounds && bounds.start && bounds.end && (
              <div className="uidai-hint">
                Allowed range: {formatDateDisplay(bounds.start)} to {formatDateDisplay(bounds.end)}
              </div>
            )}
          </div>

          {showActuals && (
            <>
              <div className="uidai-field">
                <label className="uidai-field__label">Actual Start Date</label>
                <input
                  type="date"
                  className="uidai-input"
                  value={actualStartValue}
                  onChange={(e) => updateField({ actualStartDate: e.target.value })}
                  disabled={actualDisabled}
                />
                {hasKids && (
                  <div className="uidai-auto-hint">Auto-derived from children's dates</div>
                )}
              </div>

              <div className="uidai-field">
                <label className="uidai-field__label">Actual End Date</label>
                <input
                  type="date"
                  className="uidai-input"
                  value={actualEndValue}
                  onChange={(e) => updateField({ actualEndDate: e.target.value })}
                  disabled={actualDisabled}
                />
                {hasKids && (
                  <div className="uidai-auto-hint">Auto-derived from children's dates</div>
                )}
              </div>
            </>
          )}

          {showStatus && (
            <div className="uidai-field">
              <label className="uidai-field__label">Status</label>
              <select
                className="uidai-select"
                value={form.status}
                onChange={(e) => updateField({ status: e.target.value })}
                disabled={dis}
              >
                <option>Not Completed</option>
                <option>Completed</option>
              </select>
            </div>
          )}

          {showActivityFields && (
            <>
              <div className="uidai-field">
                <label className="uidai-field__label">
                  Owner Division <span className="uidai-required-project">*</span>
                </label>
                <select
                  className="uidai-select"
                  value={form.ownerDivision}
                  onChange={(e) => updateField({ ownerDivision: e.target.value })}
                  disabled={dis}
                >
                  <option value="">Select Owner Division</option>
                  {safeArray(divisions).map((d) => (
                    <option key={d.code} value={d.code}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="uidai-field">
                <label className="uidai-field__label">Vendor</label>
                <select
                  className="uidai-select"
                  value={form.vendorId}
                  onChange={(e) => updateField({ vendorId: e.target.value })}
                  disabled={dis}
                >
                  <option value="">— None —</option>
                  {projectVendors.map((v) => {
                    const id = typeof v === "object" ? (v.id || v.uuid || "") : "";
                    const name = vendorName(v);
                    if (!id || !name) return null;
                    return <option key={id} value={id}>{name}</option>;
                  })}
                </select>
                {projectVendors.length === 0 && (
                  <div className="uidai-field__hint" style={{ fontSize: 12, color: "#66788f", marginTop: 4 }}>
                    No vendors are associated with this project yet. Add them in Project Details &rarr; Associated Vendors.
                  </div>
                )}
              </div>
              <div className="uidai-field uidai-grid__full">
                <label className="uidai-field__label">
                  Concerned Division{" "}
                  <span style={{ fontWeight: 400, fontSize: 12, color: "#66788f" }}>
                    (the divisions whose consent is required for this activity)
                  </span>
                </label>
                <ChipControl
                  value={safeArray(form.concernedDivision)}
                  options={
                    safeArray(divisions).length
                      ? safeArray(divisions).map((d) => ({ uid: d.code, name: d.label }))
                      : DIVISION_OPTIONS.map((o) => ({
                          uid: String(o).toLowerCase(),
                          name: o
                        }))
                  }
                  onChange={(next) => updateField({ concernedDivision: next })}
                  label="division"
                  disabled={dis}
                />
              </div>
            </>
          )}

          {showDepsSection && (
            <div className="uidai-field uidai-grid__full">
              <label className="uidai-field__label">Depends On</label>
              <DependencyPicker
                value={form.dependsOn}
                onChange={(next) => updateField({ dependsOn: next })}
                project={project}
                kind={kind}
                nodeUid={node ? node.uid : ""}
                parentUid={parentUid || ""}
                editable={editable}
              />
            </div>
          )}

          {showResourceSection && form.type === "Resource Type" && (
            <ResourceSection
              form={form}
              updateField={updateField}
              adjResCount={adjResCount}
              dis={dis}
              editable={editable}
              resourceTypes={resourceTypes}
              resourceTypesLoading={resourceTypesLoading}
              divisions={divisions}
              divisionsLoading={divisionsLoading}
            />
          )}
        </div>

        {project.projectId && !isAdd && (
          <CommentsPanel
            comments={form.comments}
            editable={editable}
            commentText={commentText}
            setCommentText={setCommentText}
            onFileChange={handleFileChange}
            attachError={attachError}
          />
        )}

        <div className="uidai-modal__actions">
          {editable && (
            <button type="button" className="uidai-btn" onClick={save}>
              Save
            </button>
          )}
          <button type="button" className="uidai-btn uidai-btn--cancel" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ResourceSection({
  form,
  updateField,
  adjResCount,
  dis,
  editable,
  resourceTypes,
  resourceTypesLoading,
  divisions,
  divisionsLoading
}) {
  const entry = form.resourceEntryType;
  const rd = form.resourceDetails;
  const rc = form.resourceCount;

  const apiList = safeArray(resourceTypes);
  const useApi = apiList.length > 0;

  const divisionFallback = DIVISION_OPTIONS.map((o) => ({
    code: o.toLowerCase() === "others" ? "others" : o,
    label: o,
    requiresOther: o.toLowerCase() === "others"
  }));
  const effectiveDivisions = safeArray(divisions).length ? divisions : divisionFallback;

  function updateRd(patch) {
    updateField({ resourceDetails: { ...rd, ...patch } });
  }
  function updateRc(patch) {
    updateField({ resourceCount: { ...rc, ...patch } });
  }

  function handleDivisionChange(target, code) {
    const needsOther = divisionRequiresOther(effectiveDivisions, code);
    const patch = {
      division: code,
      divisionOther: needsOther ? (target.divisionOther || "") : ""
    };
    if (target === rd) updateRd(patch); else updateRc(patch);
  }

  function renderResourceTypeOptions(currentValue) {
    if (!useApi) {
      return RESOURCE_TYPE_CODES.map((t) => <option key={t}>{t}</option>);
    }
    const opts = apiList.map((r) => (
      <option key={r.id} value={r.id}>
        {r.name}
      </option>
    ));
    const hasMatch = apiList.some((r) => r.id === currentValue);
    if (currentValue && !hasMatch) {
      opts.unshift(
        <option key={`legacy-${currentValue}`} value={currentValue}>
          {currentValue}
        </option>
      );
    }
    if (!currentValue) {
      opts.unshift(
        <option key="__placeholder" value="">
          — Select —
        </option>
      );
    }
    return opts;
  }

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <h4 style={{ color: "#173e77", margin: "6px 0 10px" }}>Resource Details</h4>
      <div className="uidai-resource-radios" role="radiogroup">
        <div
          className={`uidai-resource-radio${entry === "details" ? " uidai-resource-radio--active" : ""}`}
          onClick={() => editable && updateField({ resourceEntryType: "details" })}
          role="radio"
          aria-checked={entry === "details"}
        >
          <div className="uidai-resource-radio__dot" />
          <div className="uidai-resource-radio__info">
            <div className="uidai-resource-radio__title">Resource Details</div>
            <div className="uidai-resource-radio__sub">
              Record a specific named resource with full profile
            </div>
          </div>
        </div>
        <div
          className={`uidai-resource-radio${entry === "count" ? " uidai-resource-radio--active" : ""}`}
          onClick={() => editable && updateField({ resourceEntryType: "count" })}
          role="radio"
          aria-checked={entry === "count"}
        >
          <div className="uidai-resource-radio__dot" />
          <div className="uidai-resource-radio__info">
            <div className="uidai-resource-radio__title">Resource Count</div>
            <div className="uidai-resource-radio__sub">
              Record only a count of resources (no name)
            </div>
          </div>
        </div>
      </div>

      {entry === "details" && (
        <div className="uidai-resource-section">
          <div className="uidai-resource-section__title">Resource Profile</div>
          <div className="uidai-grid">
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Name</label>
              <input
                className="uidai-input"
                value={rd.resourceName || ""}
                onChange={(e) => updateRd({ resourceName: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Type</label>
              <select
                className="uidai-select"
                value={rd.resType || ""}
                onChange={(e) => updateRd({ resType: e.target.value })}
                disabled={dis || resourceTypesLoading}
              >
                {renderResourceTypeOptions(rd.resType || "")}
              </select>
              {resourceTypesLoading && (
                <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Loading resource types…
                </div>
              )}
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Division</label>
              <DivisionDropdown
                value={rd.division || ""}
                onChange={(v) => handleDivisionChange(rd, v)}
                disabled={dis || divisionsLoading}
                divisions={effectiveDivisions}
                loading={divisionsLoading}
              />
            </div>
            {divisionRequiresOther(effectiveDivisions, rd.division) && (
              <div className="uidai-field">
                <label className="uidai-field__label">
                  Specify Division <span className="uidai-required-project">*</span>
                </label>
                <input
                  className="uidai-input"
                  value={rd.divisionOther || ""}
                  onChange={(e) => updateRd({ divisionOther: e.target.value })}
                  disabled={dis}
                />
              </div>
            )}
            <div className="uidai-field">
              <label className="uidai-field__label">Onboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.onboardingDate || ""}
                onChange={(e) => updateRd({ onboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Offboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.offboardingDate || ""}
                onChange={(e) => updateRd({ offboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Actual Onboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.actualOnboardingDate || ""}
                onChange={(e) => updateRd({ actualOnboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Actual Offboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.actualOffboardingDate || ""}
                onChange={(e) => updateRd({ actualOffboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Position</label>
              <input
                className="uidai-input"
                value={rd.position || ""}
                onChange={(e) => updateRd({ position: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Designation</label>
              <input
                className="uidai-input"
                value={rd.designation || ""}
                onChange={(e) => updateRd({ designation: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Job Role</label>
              <input
                className="uidai-input"
                value={rd.jobRole || ""}
                onChange={(e) => updateRd({ jobRole: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Qualification</label>
              <input
                className="uidai-input"
                value={rd.qualification || ""}
                onChange={(e) => updateRd({ qualification: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Experience (Years)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                className="uidai-input"
                value={rd.experience || ""}
                onChange={(e) => updateRd({ experience: e.target.value })}
                disabled={dis}
              />
            </div>
          </div>
        </div>
      )}

      {entry === "count" && (
        <div className="uidai-resource-section">
          <div className="uidai-resource-section__title">Resource Count</div>
          <div className="uidai-grid">
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Type</label>
              <select
                className="uidai-select"
                value={rc.resType || ""}
                onChange={(e) => updateRc({ resType: e.target.value })}
                disabled={dis || resourceTypesLoading}
              >
                {renderResourceTypeOptions(rc.resType || "")}
              </select>
              {resourceTypesLoading && (
                <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Loading resource types…
                </div>
              )}
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Count</label>
              <div className="uidai-res-count">
                <button
                  type="button"
                  className="uidai-res-count__btn"
                  onClick={() => adjResCount(-1)}
                  disabled={dis}
                >
                  −
                </button>
                <input
                  type="number"
                  min="1"
                  className="uidai-input"
                  style={{ width: 70, textAlign: "center" }}
                  value={rc.count || 1}
                  onChange={(e) => updateRc({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  disabled={dis}
                />
                <button
                  type="button"
                  className="uidai-res-count__btn"
                  onClick={() => adjResCount(1)}
                  disabled={dis}
                >
                  +
                </button>
              </div>
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Onboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rc.onboardingDate || ""}
                onChange={(e) => updateRc({ onboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Division</label>
              <DivisionDropdown
                value={rc.division || ""}
                onChange={(v) => handleDivisionChange(rc, v)}
                disabled={dis || divisionsLoading}
                divisions={effectiveDivisions}
                loading={divisionsLoading}
              />
            </div>
            {divisionRequiresOther(effectiveDivisions, rc.division) && (
              <div className="uidai-field">
                <label className="uidai-field__label">
                  Specify Division <span className="uidai-required-project">*</span>
                </label>
                <input
                  className="uidai-input"
                  value={rc.divisionOther || ""}
                  onChange={(e) => updateRc({ divisionOther: e.target.value })}
                  disabled={dis}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isOthersOption(d) {
  if (!d) return false;
  if (d.requiresOther) return true;
  return (
    String(d.code || "").toLowerCase() === "others" ||
    String(d.label || "").toLowerCase() === "others"
  );
}

function divisionRequiresOther(list, code) {
  const opt = list.find((d) => d.code === code);
  return isOthersOption(opt);
}

/* DivisionDropdown — pure code-only dropdown, mirrors AddProjectPage's owner
   select. The Others free-text input is rendered as a separate sibling field
   by the caller (so the layout matches owner / ownerOther). */
function DivisionDropdown({ value, onChange, disabled, divisions, loading }) {
  const apiList = safeArray(divisions);
  const fallback = DIVISION_OPTIONS.map((o) => ({
    code: o.toLowerCase() === "others" ? "others" : o,
    label: o,
    requiresOther: o.toLowerCase() === "others"
  }));
  const list = apiList.length > 0 ? apiList : fallback;

  // Resolve the form's stored value against the list (case-insensitive on
  // code OR label) so legacy uppercase strings still light up the right row.
  const lower = String(value || "").toLowerCase();
  const matched = list.find(
    (d) =>
      String(d.code || "").toLowerCase() === lower ||
      String(d.label || "").toLowerCase() === lower
  );
  const selectCode = matched ? matched.code : "";

  return (
    <select
      className="uidai-select"
      value={selectCode}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">{loading ? "Loading…" : "— Select —"}</option>
      {list.map((d) => (
        <option key={d.code} value={d.code}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

function CommentsPanel({
  comments,
  editable,
  commentText,
  setCommentText,
  onFileChange,
  attachError
}) {
  return (
    <div className="uidai-comments">
      <div className="uidai-comments__title">💬 Comments &amp; Attachments</div>
      {editable && (
        <div className="uidai-comments__composer">
          <div className="uidai-field">
            <textarea
              className="uidai-textarea"
              placeholder="Write a comment..."
              style={{ minHeight: 70 }}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
          </div>
          <div className="uidai-comments__upload-row">
            <div className="uidai-field">
              <input
                type="file"
                multiple
                accept={ALLOWED_FILE_ACCEPT}
                onChange={onFileChange}
              />
              <div className="uidai-attach-hint">
                Maximum file size: 25 MB per file. Multiple files allowed.
                Allowed types: Documents (pdf, docx, xlsx, txt, csv), Images (jpg, png, heic), Videos (mp4, webm, mov).
              </div>
              {attachError && <div className="uidai-attach-error">{attachError}</div>}
            </div>
          </div>
        </div>
      )}
      <div className="uidai-comments__list">
        {comments.length === 0 ? (
          <div className="uidai-hint">No comments or attachments yet</div>
        ) : (
          comments.map((item, i) => (
            <div key={i} className="uidai-comment-item">
              <div className="uidai-comment-item__meta">
                {item.who || "User"} · {formatDateTime(item.when)}
              </div>
              <div>{item.text}</div>
              {safeArray(item.attachments).length > 0 && (
                <div className="uidai-comment-item__attachments">
                  {item.attachments.map((f, j) => (
                    <span key={j} className="uidai-attachment-chip">
                      📎 {typeof f === "string" ? f : f.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}