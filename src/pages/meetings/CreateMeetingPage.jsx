/* ══════════════════════════════════════════════════════════════════
   CreateMeetingPage.jsx — single-page Create Meeting form.

   POSTs to /api/meetings (see src/api/meetings.js). Projects and the
   user roster are fetched live from the existing project / user APIs;
   attachments are read as base64 and shipped inside the same JSON
   body.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "./_shared";
import * as projectsApi from "../../api/projects";
import * as usersApi from "../../api/users";
import { createMeeting, encodeAttachments } from "../../api/meetings";
import "../../styles/meetings.css";

/* Grouped checkbox multi-select used for Attendees. */
function GroupedMultiSelect({ groups, selected, onChange, placeholder, mountId }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const all = groups.flatMap((g) => g.items);

  const labelOf = (v) => {
    const it = all.find((x) => x.value === v);
    return it ? it.label : v;
  };
  const metaOf = (v) => {
    const it = all.find((x) => x.value === v);
    return it ? it.meta : "";
  };

  const toggle = (v) => {
    const set = new Set(selected);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange(Array.from(set));
  };

  const filtered = groups
    .map((g) => ({
      group: g.group,
      items: g.items.filter(
        (it) =>
          !filter ||
          it.label.toLowerCase().includes(filter.toLowerCase()) ||
          (it.meta || "").toLowerCase().includes(filter.toLowerCase())
      )
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="multi" id={mountId}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "#fff",
          padding: "6px 8px",
          minHeight: 44,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center"
        }}
      >
        {selected.length === 0 ? (
          <span style={{ color: "var(--text-muted)", fontSize: 13.5 }}>
            {placeholder || "Select…"}
          </span>
        ) : (
          selected.map((v) => (
            <span key={v} className="chip">
              {labelOf(v)}
              {metaOf(v) && <span className="sub">{metaOf(v)}</span>}
              <button
                type="button"
                className="chip-remove"
                title="Remove"
                onClick={() => toggle(v)}
              >
                ×
              </button>
            </span>
          ))
        )}
        <button
          type="button"
          className="btn ghost small-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Browse…"}
        </button>
      </div>
      {open && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "#fff",
            padding: 8,
            marginTop: 6,
            maxHeight: 260,
            overflow: "auto"
          }}
        >
          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          {filtered.length === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              No matches.
            </div>
          )}
          {filtered.map((g) => (
            <div key={g.group || "_"}>
              {g.group && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    padding: "8px 4px 4px",
                    letterSpacing: ".4px"
                  }}
                >
                  {g.group}
                </div>
              )}
              {g.items.map((it) => {
                const on = selected.includes(it.value);
                return (
                  <label
                    key={it.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 4px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 13.5
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(it.value)}
                      style={{ width: "auto" }}
                    />
                    <span>{it.label}</span>
                    {it.meta && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11.5,
                          color: "var(--text-muted)",
                          fontWeight: 600
                        }}
                      >
                        {it.meta}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CreateMeetingPage() {
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [draft, setDraft] = useState({
    projectId: "",
    title: "",
    date: "",
    start: "",
    end: "",
    location: "",
    agenda: "",
    attendees: [],
    external: []
  });
  const [extInput, setExtInput] = useState("");
  const [showExt, setShowExt] = useState(false);
  const [files, setFiles] = useState([]); /* raw File objects */
  const [errors, setErrors] = useState({ date: false, time: false, attendees: false });
  const [submitting, setSubmitting] = useState(false);

  /* Master data fetched from existing APIs. */
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));

  /* Initial load: projects + users in parallel. */
  useEffect(() => {
    let alive = true;
    setLoadingProjects(true);
    setLoadingUsers(true);
    projectsApi
      .list()
      .then((rows) => { if (alive) setProjects(rows); })
      .catch((e) => { if (alive) show(`Couldn't load projects: ${e.message}`, "warn"); })
      .finally(() => { if (alive) setLoadingProjects(false); });
    usersApi
      .list({ pageSize: 200 })
      .then((rows) => { if (alive) setUsers(rows); })
      .catch((e) => { if (alive) show(`Couldn't load users: ${e.message}`, "warn"); })
      .finally(() => { if (alive) setLoadingUsers(false); });
    return () => { alive = false; };
  }, [show]);

  const attendeeGroups = useMemo(() => {
    const byVendor = {};
    users.forEach((u) => {
      const group = u.vendorName || u.division || u.orgRole || "Users";
      (byVendor[group] = byVendor[group] || []).push(u);
    });
    return Object.entries(byVendor).map(([group, items]) => ({
      group,
      items: items.map((u) => ({
        value: u.userId,
        label: u.fullName || u.email || u.userId,
        meta: u.orgRole || u.role || ""
      }))
    }));
  }, [users]);

  const validateTimes = () => {
    const bad = !!(draft.start && draft.end && draft.end <= draft.start);
    setErrors((e) => ({ ...e, time: bad }));
    return !bad;
  };

  const addExt = () => {
    const raw = extInput.trim().replace(/,$/, "");
    if (!raw) return;
    const added = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((v) => !draft.external.includes(v));
    if (added.length) updateDraft({ external: draft.external.concat(added) });
    setExtInput("");
  };
  const removeExt = (v) =>
    updateDraft({ external: draft.external.filter((x) => x !== v) });

  const onFilesPicked = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    /* Dedupe by name+size so picking the same file twice doesn't double up. */
    setFiles((prev) => {
      const sig = (f) => `${f.name}|${f.size}`;
      const have = new Set(prev.map(sig));
      return prev.concat(picked.filter((f) => !have.has(sig(f))));
    });
    /* Reset the input so the same file can be re-picked after removal. */
    e.target.value = "";
  };

  const removeFile = (idx) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    let ok = true;
    const nextErr = { date: false, time: false, attendees: false };
    if (!draft.projectId) { show("Select a project.", "warn"); ok = false; }
    if (!draft.title.trim()) { show("Meeting Title is required.", "warn"); ok = false; }
    if (!draft.date) { nextErr.date = true; ok = false; }
    if (!draft.start || !draft.end) {
      show("Start and End time are required.", "warn");
      ok = false;
    }
    if (!draft.attendees || draft.attendees.length === 0) {
      nextErr.attendees = true;
      show("Select at least one attendee.", "warn");
      ok = false;
    }
    if (!validateTimes()) { nextErr.time = true; ok = false; }
    setErrors(nextErr);
    if (!ok) return;

    setSubmitting(true);
    try {
      const attachments = await encodeAttachments(files);
      const payload = {
        title: draft.title.trim(),
        meetingDate: draft.date,
        startTime: draft.start,
        endTime: draft.end,
        description: draft.agenda.trim(),
        meetingLink: draft.location.trim(),
        projectId: draft.projectId,
        attendees: draft.attendees.map((userId) => ({
          userId,
          participantRole: "attendee",
          mandatory: false
        })),
        externalAttendees: draft.external.map((email) => ({ email })),
        attachments
      };
      const created = await createMeeting(payload);
      show(`Meeting #${created?.id ?? ""} created.`, "ok");
      setTimeout(() => navigate("/meetings"), 350);
    } catch (e) {
      show(e.message || "Failed to create meeting.", "warn");
    } finally {
      setSubmitting(false);
    }
  };

  const projectForTag = draft.projectId
    ? projects.find((p) => p.projectId === draft.projectId)
    : null;

  return (
    <div className="pmis-mtg">
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <div className="pm-title">Create Meeting</div>
          <div className="pm-subtitle">
            Schedule a meeting and invite attendees
          </div>
        </div>
        <div className="page-header-actions">
          {projectForTag && (
            <span className="pill-link">
              {projectForTag.projectCode || projectForTag.projectId} —{" "}
              {projectForTag.projectName}
            </span>
          )}
          <button
            type="button"
            className="btn cancel"
            onClick={() => navigate("/meetings")}
            disabled={submitting}
          >
            ← All Meetings
          </button>
        </div>
      </div>

      <div className="card">
        {/* ── Meeting details ── */}
        <div className="mt-section-label" style={{ marginTop: 0 }}>
          Meeting Details
        </div>
        <div className="grid">
          <div className="field">
            <label htmlFor="projSel">
              Project <span className="required">*</span>
            </label>
            <select
              id="projSel"
              value={draft.projectId}
              onChange={(e) => updateDraft({ projectId: e.target.value })}
              disabled={loadingProjects}
            >
              <option value="" disabled>
                {loadingProjects ? "Loading…" : "Select a project…"}
              </option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.projectCode ? `${p.projectCode} — ` : ""}
                  {p.projectName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mTitle">
              Meeting Title <span className="required">*</span>
            </label>
            <input
              id="mTitle"
              type="text"
              maxLength={120}
              value={draft.title}
              onChange={(e) => updateDraft({ title: e.target.value })}
              placeholder="e.g. Q2 Governance Committee Review"
            />
          </div>
        </div>

        {/* ── Schedule ── */}
        <div className="mt-section-label">Schedule</div>
        <div className="grid grid-3">
          <div className="field">
            <label htmlFor="mDate">
              Date <span className="required">*</span>
            </label>
            <input
              id="mDate"
              type="date"
              value={draft.date}
              onChange={(e) => {
                updateDraft({ date: e.target.value });
                setErrors((er) => ({ ...er, date: false }));
              }}
            />
            <div className={`field-err${errors.date ? " show" : ""}`}>
              Please select a date.
            </div>
          </div>
          <div className="field">
            <label htmlFor="mStart">
              Start Time (IST) <span className="required">*</span>
            </label>
            <input
              id="mStart"
              type="time"
              value={draft.start}
              onChange={(e) => {
                updateDraft({ start: e.target.value });
                setErrors((er) => ({ ...er, time: false }));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="mEnd">
              End Time (IST) <span className="required">*</span>
            </label>
            <input
              id="mEnd"
              type="time"
              value={draft.end}
              onChange={(e) => updateDraft({ end: e.target.value })}
              onBlur={validateTimes}
            />
            <div className={`field-err${errors.time ? " show" : ""}`}>
              End time must be after start time.
            </div>
          </div>
        </div>

        {/* ── Location & agenda ── */}
        <div className="mt-section-label">Location &amp; Agenda</div>
        <div className="field">
          <label htmlFor="mLoc">Meeting Location / Link</label>
          <input
            id="mLoc"
            type="text"
            maxLength={300}
            value={draft.location}
            onChange={(e) => updateDraft({ location: e.target.value })}
            placeholder="MS Teams / Google Meet link or physical location"
          />
          <div className="help">
            Paste a video-call link or type a room / venue.
          </div>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="mDesc">Agenda</label>
          <textarea
            id="mDesc"
            className="mom-textarea"
            style={{ height: 120 }}
            maxLength={1000}
            value={draft.agenda}
            onChange={(e) => updateDraft({ agenda: e.target.value })}
            placeholder="Agenda and items to be discussed…"
          />
          <div className="help">
            {draft.agenda.length}/1000 characters
          </div>
        </div>

        {/* ── Attendees ── */}
        <div className="mt-section-label">Attendees</div>
        <div className="field">
          <label>
            Internal Attendees <span className="required">*</span>
          </label>
          <GroupedMultiSelect
            groups={attendeeGroups}
            selected={draft.attendees}
            onChange={(sel) => {
              updateDraft({ attendees: sel });
              setErrors((er) => ({ ...er, attendees: false }));
            }}
            placeholder={loadingUsers ? "Loading users…" : "Select attendees…"}
          />
          <div className={`field-err${errors.attendees ? " show" : ""}`}>
            Select at least one attendee.
          </div>
          {!showExt && (
            <button
              type="button"
              className="btn ghost small-btn"
              style={{ marginTop: 10 }}
              onClick={() => setShowExt(true)}
            >
              + Add External Attendees
            </button>
          )}
        </div>

        {showExt && (
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="extInput">External Attendees</label>
            <div className="ext-row">
              <input
                id="extInput"
                type="text"
                placeholder="name@xyz.com, another@xyz.com…"
                value={extInput}
                onChange={(e) => setExtInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addExt();
                  }
                }}
              />
              <button
                type="button"
                className="btn ghost small-btn"
                onClick={addExt}
              >
                Add
              </button>
            </div>
            <div className="help">
              Press Enter or comma to add. Separate multiple e-mails with commas.
            </div>
            <div className="attendee-chips" style={{ marginTop: 8 }}>
              {draft.external.length === 0 ? (
                <span className="muted">No external attendees added yet.</span>
              ) : (
                draft.external.map((v) => (
                  <span key={v} className="chip">
                    {v}{" "}
                    <button
                      type="button"
                      className="chip-remove"
                      title="Remove"
                      onClick={() => removeExt(v)}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Attachments ── */}
        <div className="mt-section-label">Attachments</div>
        <div className="field">
          <label htmlFor="mFiles">Files</label>
          <input id="mFiles" type="file" multiple onChange={onFilesPicked} />
          <div className="attendee-chips" style={{ marginTop: 8 }}>
            {files.length === 0 ? (
              <span className="muted">No attachments added.</span>
            ) : (
              files.map((f, i) => (
                <span key={f.name + ":" + f.size + ":" + i} className="chip">
                  {f.name}
                  <span className="sub">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className="chip-remove"
                    title="Remove"
                    onClick={() => removeFile(i)}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? "Creating…" : "Create Meeting"}
          </button>
          <button
            type="button"
            className="btn cancel"
            onClick={() => navigate("/meetings")}
            disabled={submitting}
          >
            Cancel
          </button>
          <span className="muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>
            <span className="required">*</span> Required fields
          </span>
        </div>
      </div>
      {toastNode}
    </div>
  );
}