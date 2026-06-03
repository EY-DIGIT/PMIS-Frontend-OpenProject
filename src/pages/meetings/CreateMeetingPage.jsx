/* ══════════════════════════════════════════════════════════════════
   CreateMeetingPage.jsx — single-page Create Meeting form. The
   "Create a New Meeting" title sits in the global navbar. Activities
   selection was removed per request; new meetings default to type
   "Steering" so the model field stays populated for badges/filters
   elsewhere.
   ══════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PROJECTS,
  USERS,
  projectById,
  createMeeting
} from "../../data/meetingsMock";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

const DEFAULT_TYPE = "Steering";

/* Grouped checkbox multi-select used for Activities and Attendees. */
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

export default function CreateMeetingPage() {
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [draft, setDraft] = useState({
    link: "project",
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
  const [errors, setErrors] = useState({ date: false, time: false });

  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const onLinkSelect = (v) => {
    if (v === "__general" || v === "") {
      updateDraft({ link: "general", projectId: "" });
    } else {
      updateDraft({ link: "project", projectId: v });
    }
  };

  const attendeeGroups = useMemo(() => {
    const byOrg = {};
    USERS.forEach((u) => {
      (byOrg[u.org] = byOrg[u.org] || []).push(u);
    });
    return Object.entries(byOrg).map(([org, items]) => ({
      group: org,
      items: items.map((u) => ({
        value: u.id,
        label: u.name,
        meta: u.division || u.role
      }))
    }));
  }, []);

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

  const submit = () => {
    let ok = true;
    const nextErr = { date: false, time: false };
    if (draft.link === "project" && !draft.projectId) {
      show("Select a project, or choose General.", "warn");
      ok = false;
    }
    if (!draft.date) { nextErr.date = true; ok = false; }
    if (!validateTimes()) { nextErr.time = true; ok = false; }
    if (!draft.title.trim()) { show("Meeting Title is required.", "warn"); ok = false; }
    if (!draft.start || !draft.end) {
      show("Start and End time are required.", "warn");
      ok = false;
    }
    setErrors(nextErr);
    if (!ok) return;

    const created = createMeeting({
      title: draft.title.trim(),
      type: DEFAULT_TYPE,
      link: draft.link,
      projectId: draft.link === "project" ? draft.projectId : null,
      activityIds: [],
      date: draft.date,
      start: draft.start,
      end: draft.end,
      location: draft.location.trim(),
      agenda: draft.agenda.trim(),
      attendees: draft.attendees,
      external: draft.external
    });
    show(`Meeting ${created.id} created.`, "ok");
    /* Tiny delay so the toast is visible before route swap. */
    setTimeout(() => navigate(`/meetings/${created.id}`), 350);
  };

  const projectForTag = draft.projectId ? projectById(draft.projectId) : null;

  return (
    <div className="pmis-mtg">
      {/* Page title moved to the global navbar (resolveNavTitle in
          Layout.jsx → "Create a New Meeting"). */}
      <div className="card">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "center",
            marginBottom: 16
          }}
        >
          <div className="card-title" style={{ margin: 0 }}>
            Create a New Meeting Invite
          </div>
          {draft.link === "general" ? (
            <span className="pill-link pill-general">General Meeting</span>
          ) : draft.projectId ? (
            <span className="pill-link">
              {draft.projectId} — {projectForTag ? projectForTag.name : ""}
            </span>
          ) : null}
        </div>

        <div className="grid grid-3">
          {/* Row 1 — Project | Title | Date */}
          <div className="field">
            <label htmlFor="projSel">
              Project <span className="required">*</span>
            </label>
            <select
              id="projSel"
              value={
                draft.link === "general" ? "__general" : draft.projectId || ""
              }
              onChange={(e) => onLinkSelect(e.target.value)}
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="__general">
                General — not linked to a project
              </option>
              <optgroup label="Projects">
                {PROJECTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} — {p.name}
                  </option>
                ))}
              </optgroup>
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
              placeholder="e.g. Q2 Steering Committee Review"
            />
          </div>
          <div className="field">
            <label htmlFor="mDate">
              Meeting Date <span className="required">*</span>
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

          {/* Row 2 — Start | End | Location */}
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
          <div className="field">
            <label htmlFor="mLoc">Meeting Location / Link</label>
            <input
              id="mLoc"
              type="text"
              maxLength={300}
              value={draft.location}
              onChange={(e) => updateDraft({ location: e.target.value })}
              placeholder="MS Teams / Google Meet link or location"
            />
          </div>

          {/* Row 3 — Agenda | Attendees | (External slot, blank until
              the user clicks "Add External Attendees"). All three
              share the 3-col grid so the External panel slides in
              alongside the others instead of pushing a new row. */}
          <div className="field">
            <label htmlFor="mDesc">Agenda</label>
            <textarea
              id="mDesc"
              maxLength={1000}
              value={draft.agenda}
              onChange={(e) => updateDraft({ agenda: e.target.value })}
              placeholder="Agenda and items to be discussed…"
            />
          </div>

          <div className="field">
            <label>Attendees</label>
            <GroupedMultiSelect
              groups={attendeeGroups}
              selected={draft.attendees}
              onChange={(sel) => updateDraft({ attendees: sel })}
              placeholder="Select attendees…"
            />
            {!showExt && (
              <button
                type="button"
                className="btn ghost small-btn"
                style={{ marginTop: 8 }}
                onClick={() => setShowExt(true)}
              >
                + Add External Attendees
              </button>
            )}
          </div>

          {showExt ? (
            <div className="field">
              <label htmlFor="extInput">External Attendees</label>
              <div className="attendee-chips" style={{ marginBottom: 6 }}>
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
              <div className="ext-row">
                <input
                  id="extInput"
                  type="text"
                  placeholder="name@xyz.com, abc.com…"
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
            </div>
          ) : (
            /* Empty placeholder keeps the grid cell reserved so the
               row visibly has its third column ready for External. */
            <div aria-hidden="true" />
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={submit}>
            Create Meeting
          </button>
          <button
            type="button"
            className="btn cancel"
            onClick={() => navigate("/meetings")}
          >
            Cancel
          </button>
        </div>
      </div>
      {toastNode}
    </div>
  );
}
