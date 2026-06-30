/* ══════════════════════════════════════════════════════════════════
   LinkedTaskMeeting.jsx — editable view of the tasks already created for
   a meeting (route: /meetings/:id/tasks).

   Reached from the Project Meetings list: clicking a meeting that already
   has a MoM with tasks lands here instead of the meeting detail page.

   Data flow:
     1. GET /meetings/get/{id}                          → meeting (+ activityId)
     2. GET /projects/api/v3/activities/{activityId}/tasks → the real tasks
     3. GET /meetings/mom/getByMeeting/{id}             → MoM (status only)
   The MoM itself is NOT re-saved — it already exists in DRAFT. The user
   edits each task's Description / Assigned To / Priority and Save PATCHes
   the real task (PATCH /projects/api/v3/tasks/{id}). The MoM's own status
   (DRAFT / IN_REVIEW / FINALIZED) is editable here too, exactly like the
   detail page; a FINALIZED MoM locks the tasks.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as usersApi from "../../api/users";
import { listUsersByProjectOrg } from "../../api/teamPage";
import {
  getMeeting,
  getMoM,
  listActivityTasks,
  updateTask,
  deleteTask,
  momUpdateStatus,
} from "../../api/meetings";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

/* Task API priority is p1..p4 (returned upper-cased as P1..P4); the UI uses
   LOW/MEDIUM/HIGH/CRITICAL. Map both ways. */
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const UI_TO_API_PRIORITY = { LOW: "p1", MEDIUM: "p2", HIGH: "p3", CRITICAL: "p4" };
const API_TO_UI_PRIORITY = { P1: "LOW", P2: "MEDIUM", P3: "HIGH", P4: "CRITICAL" };
function uiPriority(apiPriority) {
  return API_TO_UI_PRIORITY[String(apiPriority || "").toUpperCase()] || "MEDIUM";
}

/* MoM status — same three states (and lock-on-FINALIZED) as the detail page. */
const STATUS_OPTIONS = ["DRAFT", "IN_REVIEW", "FINALIZED"];
const STATUS_CLASS = {
  DRAFT: "st-draft",
  IN_REVIEW: "st-mom",
  FINALIZED: "st-completed",
};
function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();
  return (
    <span className={`badge ${STATUS_CLASS[s] || "st-draft"}`}>
      {s ? s.replace(/_/g, " ") : "—"}
    </span>
  );
}

/* ─── Small helpers (date / payloads) ─── */
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function cleanPayload(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined
    )
  );
}

/* Pull the task array out of the activities/{id}/tasks wrapper:
   { data: { _embedded: { elements: [...] } } }. Returns []. */
function tasksFromResponse(res) {
  return (
    res?.data?._embedded?.elements ??
    res?._embedded?.elements ??
    res?.data?.elements ??
    []
  );
}

/* Unwrap the MoM record from whatever wrapper the API hands back, the same
   way MeetingDetailPage does. Returns the record or null. */
function unwrapMoM(mom) {
  if (!mom) return null;
  const candidates = [mom?.data?.mom, mom?.mom, mom?.data, mom];
  const hasMoM = (c) =>
    c &&
    typeof c === "object" &&
    (Array.isArray(c.decisions) ||
      Array.isArray(c.actionItems) ||
      Array.isArray(c.actions) ||
      Array.isArray(c.risks) ||
      "status" in c);
  return (
    candidates.find(hasMoM) ||
    candidates.find((c) => c && typeof c === "object") ||
    null
  );
}

export default function LinkedTaskMeeting() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [meeting, setMeeting] = useState(null);
  const [momRemote, setMomRemote] = useState(null);
  const [tasks, setTasks] = useState([]); // editable drafts (carry _raw + _orig)
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null); // taskId being deleted

  const [users, setUsers] = useState([]);
  const [assignees, setAssignees] = useState([]);

  /* MoM status editor — same single-status control as the detail page. */
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  const momStatus = String(momRemote?.status || "").toUpperCase();
  const isFinalized = momStatus === "FINALIZED";

  /* Load the user directory for assignee labels. */
  useEffect(() => {
    let alive = true;
    usersApi
      .list({ pageSize: 200 })
      .then((rows) => { if (alive) setUsers(rows); })
      .catch(() => { /* fall back to userId text */ });
    return () => { alive = false; };
  }, []);

  /* Project-org assignable users — same source MeetingDetailPage uses for
     the "Assigned To" dropdown (a task assignee must have a project role). */
  useEffect(() => {
    let alive = true;
    const projectId = meeting?.projectId;
    if (!projectId) {
      setAssignees([]);
      return () => { alive = false; };
    }
    listUsersByProjectOrg(projectId)
      .then((rows) => {
        if (!alive) return;
        const norm = (Array.isArray(rows) ? rows : [])
          .map((u) => ({
            userId: u.id || u.userId || u.uuid || "",
            fullName:
              [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
              u.fullName || u.name || u.login || u.email || "",
            email: u.email || "",
          }))
          .filter((u) => u.userId);
        setAssignees(norm);
      })
      .catch(() => { if (alive) setAssignees([]); });
    return () => { alive = false; };
  }, [meeting?.projectId]);

  /* Clear the breadcrumb context on unmount. */
  useEffect(() => () => clearPageContext(), []);

  /* Load the meeting, then its activity's tasks (the editable rows) and the
     MoM (status only). No linked activity / no tasks → bounce to the detail
     page, which is where the MoM + tasks get created. */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMeeting(null);
    setMomRemote(null);
    setTasks([]);
    getMeeting(id)
      .then(async (m) => {
        if (!alive) return;
        setMeeting(m);
        setPageContext({ meetingName: m?.title || m?.meetingCode || "" });

        const activityId = m?.activityId;
        if (!activityId) {
          navigate(`/meetings/${id}`, { replace: true });
          return;
        }

        /* Tasks (required) + MoM (optional, for the status control). A
           missing MoM is fine — the status control just hides. */
        const [tasksRes, momRes] = await Promise.all([
          listActivityTasks(activityId),
          getMoM(m?.id ?? id).catch(() => null),
        ]);
        if (!alive) return;

        const elements = tasksFromResponse(tasksRes);
        if (!Array.isArray(elements) || elements.length === 0) {
          navigate(`/meetings/${id}`, { replace: true });
          return;
        }

        setMomRemote(unwrapMoM(momRes));
        setTasks(
          elements.map((t) => ({
            taskId: t.id,
            taskName: t.name || "",
            description: t.description || "",
            assignedToUserId: t.assignedTo || "",
            startDate: t.startDate || "",
            endDate: t.endDate || "",
            priority: uiPriority(t.priority),
            /* Snapshot of the editable fields, to detect what actually
               changed on save. */
            _orig: {
              description: t.description || "",
              assignedToUserId: t.assignedTo || "",
              priority: uiPriority(t.priority),
            },
            /* Full server record — preserved on PATCH so we don't drop
               fields the user didn't touch. */
            _raw: t,
          }))
        );
      })
      .catch((e) => {
        if (!alive) return;
        show(e.message || "Failed to load tasks.", "warn");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, navigate, show]);

  const userById = useMemo(() => {
    const m = new Map();
    users.forEach((u) => m.set(u.userId, u));
    assignees.forEach((u) => m.set(u.userId, u));
    return (uid) => m.get(uid) || null;
  }, [users, assignees]);

  const labelFor = (uid) => {
    const u = userById(uid);
    return u ? u.fullName || u.email || uid : uid || "—";
  };

  /* TEMP (test): allow ANY user as a task assignee — mirrors the detail
     page until project-scoped assignment is confirmed end-to-end. */
  const userOptions = users.filter((u) => u.userId);
  const renderUserOptions = (currentValue) => (
    <>
      <option value="">Auto assign</option>
      {currentValue && !userOptions.some((u) => u.userId === currentValue) && (
        <option value={currentValue}>{labelFor(currentValue)}</option>
      )}
      {userOptions.map((u) => (
        <option key={u.userId} value={u.userId}>
          {u.fullName || u.email || u.userId}
        </option>
      ))}
    </>
  );

  const updateTaskField = (index, key, value) =>
    setTasks((rows) => {
      const next = [...rows];
      next[index] = { ...next[index], [key]: value };
      return next;
    });

  const isDirty = (t) =>
    t._orig &&
    (t.description !== t._orig.description ||
      t.assignedToUserId !== t._orig.assignedToUserId ||
      t.priority !== t._orig.priority);

  /* ─── MoM status editing (momUpdateStatus) ─── */
  const startStatusEdit = () => {
    if (isFinalized) return;
    setStatusDraft(momStatus || STATUS_OPTIONS[0]);
    setEditingStatus(true);
  };
  const cancelStatusEdit = () => { setEditingStatus(false); setStatusDraft(""); };
  const saveStatus = async () => {
    const momId = momRemote?.id ?? momRemote?.momId;
    if (!momId) { show("MoM ID missing.", "warn"); return; }
    if (savingStatus) return;
    try {
      setSavingStatus(true);
      await momUpdateStatus(momId, statusDraft);
      setMomRemote((prev) => (prev ? { ...prev, status: statusDraft } : prev));
      setEditingStatus(false);
      setStatusDraft("");
      show("Status updated.", "ok");
    } catch (e) {
      show(e.message || "Failed to update status.", "warn");
    } finally {
      setSavingStatus(false);
    }
  };

  /* Save edits onto the real activity tasks. Only changed rows are PATCHed;
     the MoM is NOT re-saved. Each PATCH carries the full task record with the
     edited fields applied, so untouched fields are preserved. */
  const saveChanges = async () => {
    if (!meeting || saving || isFinalized) return;
    const dirty = tasks.filter(isDirty);
    if (dirty.length === 0) {
      show("No changes to save.", "ok");
      return;
    }
    setSaving(true);
    try {
      for (const t of dirty) {
        const raw = t._raw || {};
        const body = cleanPayload({
          name: raw.name || t.taskName || "Untitled task",
          description: t.description?.trim() || raw.description || "",
          startDate: raw.startDate,
          endDate: raw.endDate,
          actualStartDate: raw.actualStartDate,
          actualEndDate: raw.actualEndDate,
          status: raw.status,
          priority: UI_TO_API_PRIORITY[t.priority] || "p2",
          assignedTo: t.assignedToUserId || undefined,
          position: raw.position,
        });
        await updateTask(t.taskId, body);
      }
      /* Re-baseline so the rows are no longer "dirty" after a successful save. */
      setTasks((rows) =>
        rows.map((t) =>
          isDirty(t)
            ? {
                ...t,
                _orig: {
                  description: t.description,
                  assignedToUserId: t.assignedToUserId,
                  priority: t.priority,
                },
              }
            : t
        )
      );
      show(`Saved. ${dirty.length} task${dirty.length === 1 ? "" : "s"} updated.`, "ok");
    } catch (e) {
      show(e.message || "Failed to save changes.", "warn");
    } finally {
      setSaving(false);
    }
  };

  /* Delete a single task (DELETE /tasks/{id}) and drop its row on success. */
  const removeTask = async (t) => {
    if (!t?.taskId || isFinalized || deletingId) return;
    const name = t.taskName || t.description || "this task";
    if (typeof window !== "undefined" && !window.confirm(`Delete "${name}"? This cannot be undone.`)) {
      return;
    }
    setDeletingId(t.taskId);
    try {
      await deleteTask(t.taskId);
      setTasks((rows) => rows.filter((r) => r.taskId !== t.taskId));
      show("Task deleted.", "ok");
    } catch (e) {
      show(e.message || "Failed to delete task.", "warn");
    } finally {
      setDeletingId(null);
    }
  };

  const dirtyCount = tasks.filter(isDirty).length;

  if (loading) {
    return (
      <div className="pmis-mtg">
        <div className="page-header" style={{ margin: 0 }}>
          <div>
            <div className="pm-title">Loading…</div>
            <div className="pm-subtitle">#{id}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="pmis-mtg">
        <div className="page-header" style={{ margin: 0 }}>
          <div>
            <div className="pm-title">Meeting not found</div>
            <div className="pm-subtitle">#{id}</div>
          </div>
          <div className="page-header-actions">
            <button
              type="button"
              className="btn cancel"
              onClick={() => navigate("/meetings")}
            >
              ← All Meetings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pmis-mtg">
      <div className="page-header">
        <div>
          <div className="pm-title">{meeting.title}</div>
          <div className="pm-subtitle">
            #{meeting.meetingCode}
            {meeting.projectCode ? ` · ${meeting.projectCode}` : ""}
          </div>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn cancel"
            onClick={() => navigate(`/meetings/${id}`)}
          >
            Open Meeting Detail
          </button>
        </div>
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div className="card-title" style={{ margin: 0 }}>
            Linked Tasks
          </div>

          {/* MoM status — same control as the meeting detail page. Only
              shown when a MoM exists. */}
          {momRemote && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                className="muted"
                style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".2px" }}
              >
                MoM STATUS
              </span>
              {editingStatus ? (
                <>
                  <select
                    value={statusDraft}
                    onChange={(e) => setStatusDraft(e.target.value)}
                    disabled={savingStatus}
                    style={{ minWidth: 150 }}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn small-btn"
                    onClick={saveStatus}
                    disabled={savingStatus}
                  >
                    {savingStatus ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost small-btn"
                    onClick={cancelStatusEdit}
                    disabled={savingStatus}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <StatusBadge status={momStatus} />
                  {isFinalized ? (
                    <span className="muted" style={{ fontSize: 12 }} title="A finalized MoM cannot be edited.">
                      Locked
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost small-btn"
                      onClick={startStatusEdit}
                    >
                      Edit
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {isFinalized && (
          <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
            This MoM is finalized — tasks are read-only.
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Task Name</th>
                <th style={{ minWidth: 260 }}>Task Description</th>
                <th>Start Date</th>
                <th>Due Date</th>
                <th style={{ minWidth: 180 }}>Assigned To</th>
                <th style={{ minWidth: 130 }}>Priority</th>
                <th aria-label="Delete" style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">No tasks for this meeting.</div>
                  </td>
                </tr>
              ) : (
                tasks.map((t, index) => (
                  <tr key={t.taskId || `task-${index}`}>
                    <td>{t.taskName || "—"}</td>
                    <td>
                      <input
                        value={t.description || ""}
                        title={t.description || ""}
                        placeholder="What needs to be done"
                        disabled={isFinalized}
                        onChange={(e) =>
                          updateTaskField(index, "description", e.target.value)
                        }
                      />
                    </td>
                    <td>{t.startDate ? fmtDate(t.startDate) : "—"}</td>
                    <td>{t.endDate ? fmtDate(t.endDate) : "—"}</td>
                    <td>
                      <select
                        value={t.assignedToUserId || ""}
                        disabled={isFinalized}
                        onChange={(e) =>
                          updateTaskField(index, "assignedToUserId", e.target.value)
                        }
                      >
                        {renderUserOptions(t.assignedToUserId)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={t.priority || "MEDIUM"}
                        disabled={isFinalized}
                        onChange={(e) =>
                          updateTaskField(index, "priority", e.target.value)
                        }
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="mt-copy-btn"
                        title="Delete task"
                        aria-label="Delete task"
                        disabled={isFinalized || deletingId === t.taskId}
                        onClick={() => removeTask(t)}
                      >
                        {deletingId === t.taskId ? "…" : "✕"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={saveChanges}
            disabled={saving || isFinalized || dirtyCount === 0}
          >
            {saving ? "Saving…" : dirtyCount > 0 ? `Save changes (${dirtyCount})` : "Save changes"}
          </button>
        </div>
      </div>

      {toastNode}
    </div>
  );
}
