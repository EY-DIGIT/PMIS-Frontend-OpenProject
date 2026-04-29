import React, { useEffect, useMemo, useState } from "react";
import DependencyPicker from "../DependencyPicker";
import {
  NODE_TYPE_OPTIONS,
  RESOURCE_TYPE_CODES,
  DIVISION_OPTIONS,
  MAX_ATTACHMENT_BYTES
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
    vendor: n.vendor || "",
    dependsOn: safeArray(n.dependsOn),
    resourceEntryType: n.resourceEntryType || "details",
    resourceDetails: {
      resourceName: "",
      resType: "RFP",
      division: "",
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
      resType: "RFP",
      count: 1,
      onboardingDate: "",
      division: "",
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
  onSave,
  onError
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

  useEffect(() => {
    if (open) {
      setForm(makeDefaultForm(kind, node, mode, parentNode));
      setCommentText("");
      setCommentFiles([]);
      setAttachError("");
    }
  }, [open, kind, node, mode, parentNode]);

  if (!open || !project) return null;

  const isAdd = mode === "add";
  const showStatus = !isAdd;
  const showActuals = !isAdd && kind !== "milestone";
  const showType = kind !== "milestone";
  const showVendor = kind === "milestone";
  const hasKids = node ? getChildren(node).length > 0 : false;
  const effActuals = node ? computeEffectiveActuals(node) : { start: "", end: "" };

  const actualStartValue = hasKids && node ? effActuals.start || "" : form.actualStartDate;
  const actualEndValue = hasKids && node ? effActuals.end || "" : form.actualEndDate;
  const actualDisabled = hasKids || !editable;

  const bounds = isAdd
    ? getParentDateBoundsForNew(project, parentUid)
    : getParentDateBounds(project, nodeUid);

  const isOnboarding = !project.projectId;
  const projectIsVersion = !!project.isVersion;
  let showDepsSection = false;
  if (isOnboarding) showDepsSection = false;
  else if (projectIsVersion) {
    if (kind === "milestone" || kind === "activity") {
      showDepsSection = safeArray(node && node.dependsOn).length > 0;
    } else {
      showDepsSection = true;
    }
  } else {
    showDepsSection = kind === "milestone" || kind === "activity";
  }

  function updateField(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function validateFiles(files) {
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

  function postComment() {
    if (!editable) return;
    const text = commentText.trim();
    if (!text && commentFiles.length === 0) {
      if (typeof onError === "function") onError("Write a comment or attach a file first.");
      return;
    }
    const entry = {
      who: "Admin",
      when: new Date().toISOString(),
      text,
      attachments: commentFiles.map((f) => ({ name: f.name, size: f.size }))
    };
    setForm((f) => ({ ...f, comments: [entry, ...f.comments] }));
    setCommentText("");
    setCommentFiles([]);
    setAttachError("");
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
    onSave({
      ...form,
      bounds
    });
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
      <div className="uidai-modal__box uidai-modal__box--wide">
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
              onChange={(e) => updateField({ endDate: e.target.value })}
              disabled={dis}
            />
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

          {showVendor && (
            <div className="uidai-field uidai-grid__full">
              <label className="uidai-field__label">
                Vendor{" "}
                <span style={{ fontWeight: 400, fontSize: 12, color: "#66788f" }}>
                  (associated with this milestone)
                </span>
              </label>
              <select
                className="uidai-select"
                value={form.vendor}
                onChange={(e) => updateField({ vendor: e.target.value })}
                disabled={dis}
              >
                <option value="">— None —</option>
                {projectVendors.map((v) => {
                  const name = vendorName(v);
                  const key = vendorKey(v);
                  if (!name) return null;
                  return (
                    <option key={key} value={name}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </div>
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

          {showType && form.type === "Resource Type" && (
            <ResourceSection
              form={form}
              updateField={updateField}
              adjResCount={adjResCount}
              dis={dis}
              editable={editable}
            />
          )}
        </div>

        {project.projectId && (
          <CommentsPanel
            comments={form.comments}
            editable={editable}
            commentText={commentText}
            setCommentText={setCommentText}
            onFileChange={handleFileChange}
            attachError={attachError}
            onPost={postComment}
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

function ResourceSection({ form, updateField, adjResCount, dis, editable }) {
  const entry = form.resourceEntryType;
  const rd = form.resourceDetails;
  const rc = form.resourceCount;

  function updateRd(patch) {
    updateField({ resourceDetails: { ...rd, ...patch } });
  }
  function updateRc(patch) {
    updateField({ resourceCount: { ...rc, ...patch } });
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
                value={rd.resType || "RFP"}
                onChange={(e) => updateRd({ resType: e.target.value })}
                disabled={dis}
              >
                {RESOURCE_TYPE_CODES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Division</label>
              <DivisionField
                value={rd.division || ""}
                onChange={(v) => updateRd({ division: v })}
                disabled={dis}
              />
            </div>
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
                value={rc.resType || "RFP"}
                onChange={(e) => updateRc({ resType: e.target.value })}
                disabled={dis}
              >
                {RESOURCE_TYPE_CODES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
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
              <DivisionField
                value={rc.division || ""}
                onChange={(v) => updateRc({ division: v })}
                disabled={dis}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DivisionField({ value, onChange, disabled }) {
  const standard = DIVISION_OPTIONS.filter((o) => o !== "Others");
  const isStandard = standard.includes(value);
  const select = isStandard ? value : value ? "Others" : "";
  const [otherText, setOtherText] = useState(isStandard ? "" : value);

  useEffect(() => {
    setOtherText(isStandard ? "" : value);
  }, [value, isStandard]);

  return (
    <div>
      <select
        className="uidai-select"
        value={select}
        onChange={(e) => {
          if (e.target.value === "Others") {
            onChange(otherText || "");
          } else {
            onChange(e.target.value);
          }
        }}
        disabled={disabled}
      >
        <option value="">— Select —</option>
        {DIVISION_OPTIONS.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      {select === "Others" && (
        <input
          className="uidai-input"
          type="text"
          placeholder="Specify division"
          style={{ marginTop: 6 }}
          value={otherText}
          onChange={(e) => {
            setOtherText(e.target.value);
            onChange(e.target.value);
          }}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function CommentsPanel({
  comments,
  editable,
  commentText,
  setCommentText,
  onFileChange,
  attachError,
  onPost
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
              <input type="file" multiple onChange={onFileChange} />
              <div className="uidai-attach-hint">
                Maximum file size: 25 MB per file. Multiple files allowed.
              </div>
              {attachError && <div className="uidai-attach-error">{attachError}</div>}
            </div>
            <div>
              <button type="button" className="uidai-btn" onClick={onPost}>
                Post Comment
              </button>
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