/* ══════════════════════════════════════════════════════════════════
   CreateMeetingPage.jsx — single-page Create Meeting form.

   POSTs to /api/meetings (see src/api/meetings.js). Projects come from the
   project API; candidate attendees come from that project's role
   assignments (GET /users/api/v3/projects/{id}/role-assignments), so the
   picker only ever offers users who hold a role on the selected project.
   Attachments are read as base64 and shipped inside the same JSON body.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useToast } from "./_shared";
import * as projectsApi from "../../api/projects";
import { api } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoint";
import * as usersApi from "../../api/users";
import { createMeeting, encodeAttachments } from "../../api/meetings";
import "../../styles/meetings.css";

/* Backend role slugs → human labels: "project_admin" → "Project Admin". */
function roleLabel(name) {
  const words = String(name || "").split(/[_\s-]+/).filter(Boolean);
  if (!words.length) return "Member";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/* Grouped checkbox multi-select used for Attendees. */
function GroupedMultiSelect({ groups, selected, onChange, placeholder, mountId, disabled }) {
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

  /* Search matches name, type/role (meta) AND the group/vendor name, so
     typing a role like "admin" or a vendor narrows the list. */
  const needle = filter.toLowerCase();
  const filtered = groups
    .map((g) => {
      const groupMatches = (g.group || "").toLowerCase().includes(needle);
      return {
        group: g.group,
        items: g.items.filter(
          (it) =>
            !needle ||
            groupMatches ||
            it.label.toLowerCase().includes(needle) ||
            (it.meta || "").toLowerCase().includes(needle)
        )
      };
    })
    .filter((g) => g.items.length > 0);

  return (
    <div className="multi" id={mountId} aria-disabled={disabled}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: disabled ? "#f3f6fb" : "#fff",
          padding: "6px 8px",
          minHeight: 44,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          opacity: disabled ? 0.7 : 1,
          cursor: disabled ? "not-allowed" : "default"
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
          disabled={disabled}
        >
          {open ? "Close" : "Browse…"}
        </button>
      </div>
      {open && !disabled && (
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
            placeholder="Search by name or type…"
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

/* Searchable single-select — used for the Project picker, which can hold
   hundreds of rows. Same look as a native select, but the dropdown has a
   type-to-filter box so you don't scroll forever. */
function SearchableSelect({ id, value, options, onChange, placeholder, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    function onOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const selected = options.find((o) => o.value === value);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: disabled ? "#f3f6fb" : "#fff",
          color: selected ? "var(--text)" : "var(--text-muted)",
          font: "inherit",
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : (loading ? "Loading…" : placeholder || "Select…")}
        </span>
        <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>▾</span>
      </button>
      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "#fff",
            boxShadow: "0 6px 20px rgba(11,60,136,.14)",
            padding: 8,
            maxHeight: 280,
            overflow: "auto"
          }}
        >
          <input
            type="text"
            autoFocus
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          {filtered.length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>No matches.</div>
          ) : (
            filtered.map((o) => {
              const on = o.value === value;
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={on}
                  onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
                  style={{
                    padding: "8px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13.5,
                    background: on ? "#eef4ff" : "transparent",
                    fontWeight: on ? 700 : 500,
                    color: on ? "var(--navy)" : "var(--text)"
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {o.label}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* Location helpers — the backend stores a single `meetingLink` string, so
   the three modes below are just UX scaffolding around that one value. */
const isUrl = (s) => /^https?:\/\//i.test(String(s || "").trim());

const LOCATION_TYPES = [
  {
    key: "online",
    icon: "🎥",
    name: "Online Meeting",
    // desc: "Video-call link (Meet, Teams, Zoom)",
    label: "Meeting link",
    placeholder: "https://meet.google.com/abc-defg-hij",
    help: "Paste the full video-call URL — attendees open it with one click.",
  },
  {
    key: "venue",
    icon: "📍",
    name: "Location",
    // desc: "Physical venue / address",
    label: "Location",
    placeholder: "e.g. Conference Room 2, 3rd Floor, Head Office",
    help: "Enter the venue or address as plain text.",
  },
];

export default function CreateMeetingPage() {
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  /* Opened project-scoped as /projects/{id}/meetings/new — the project is
     already decided, so the picker is replaced by a locked read-only field
     and every exit stays inside the project. The ?projectId= form is the
     older shape of the same thing, still honoured so existing links work.
     Opened bare (from the All-Meetings list) there's no project yet and the
     dropdown stays. */
  const { projectId: routeProjectId } = useParams();
  const [searchParams] = useSearchParams();
  const lockedProjectId = routeProjectId || searchParams.get("projectId") || "";

  /* Where "back" and the post-create redirect land: the originating
     project's meeting list when locked, the all-meetings list otherwise. */
  const backTo = lockedProjectId
    ? `/projects/${encodeURIComponent(lockedProjectId)}/meetings`
    : "/meetings";

  const [draft, setDraft] = useState({
    projectId: lockedProjectId,
    title: "",
    date: "",
    start: "",
    end: "",
    locationType: "online", /* online | venue — UI only, value lands in `location` */
    location: "",
    agenda: "",
    attendees: [],
    external: []
  });
  const [extInput, setExtInput] = useState("");
  const [showExt, setShowExt] = useState(false);
  const [files, setFiles] = useState([]); /* raw File objects */
  const [errors, setErrors] = useState({
    projectId: false,
    title: false,
    date: false,
    start: false,
    end: false,
    time: false,
    attendees: false
  });
  const [submitting, setSubmitting] = useState(false);

  /* Master data fetched from existing APIs. */
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  /* Resolved details for a locked project — only its name/code, so the
     read-only field can show something friendlier than a raw UUID. */
  const [lockedProject, setLockedProject] = useState(null);

  /* Candidate attendees = everyone holding a role on the selected project
     (GET /projects/{id}/role-assignments). This replaces the old approach of
     pulling the whole user directory and filtering it by the project's
     vendor — the roster is already project-scoped server-side. */
  const [projectMembers, setProjectMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));

  /* Initial load. With a locked project only that one project is fetched —
     the full list exists solely to populate the dropdown, which isn't
     rendered in that mode. A failed lookup keeps the field locked (the id
     from the URL is still what the API needs); only the label falls back
     to the raw id. */
  useEffect(() => {
    let alive = true;
    setLoadingProjects(true);
    if (lockedProjectId) {
      /* Hitting the endpoint directly rather than via projectsApi.get():
         that helper feeds the raw response to its adapter without opening
         the { data: … } envelope this endpoint replies with, so every
         field comes back blank. Only the code and name are needed here. */
      api
        .get(ENDPOINTS.projects.get(lockedProjectId))
        .then((res) => {
          if (!alive) return;
          const p = res?.data ?? res ?? {};
          setLockedProject({
            projectId: p.uuid || p.id || lockedProjectId,
            projectCode: p.projectCode || "",
            projectName: p.name || p.projectName || ""
          });
        })
        .catch((e) => { if (alive) show(`Couldn't load the project: ${e.message}`, "warn"); })
        .finally(() => { if (alive) setLoadingProjects(false); });
    } else {
      projectsApi
        .list({ pageSize: 200 })
        .then((rows) => { if (alive) setProjects(rows); })
        .catch((e) => { if (alive) show(`Couldn't load projects: ${e.message}`, "warn"); })
        .finally(() => { if (alive) setLoadingProjects(false); });
    }
    return () => { alive = false; };
  }, [lockedProjectId, show]);

  /* Project members → attendee candidates. Refetched on every project switch. */
  useEffect(() => {
    let alive = true;
    const projectId = draft.projectId;
    if (!projectId) {
      setProjectMembers([]);
      return () => { alive = false; };
    }
    setLoadingMembers(true);
    usersApi
      .listProjectRoleAssignments(projectId)
      .then((rows) => {
        if (!alive) return;
        /* One row per (user, role) — a user holding two roles on the project
           would otherwise show up twice behind the same checkbox value. */
        const byUser = new Map();
        rows.forEach((r) => {
          if (r.userId && !byUser.has(r.userId)) byUser.set(r.userId, r);
        });
        setProjectMembers(Array.from(byUser.values()));
      })
      .catch((e) => {
        if (!alive) return;
        setProjectMembers([]);
        show(`Couldn't load project members: ${e.message}`, "warn");
      })
      .finally(() => { if (alive) setLoadingMembers(false); });
    return () => { alive = false; };
  }, [draft.projectId, show]);

  const attendeeGroups = useMemo(() => {
    const byRole = {};
    projectMembers.forEach((m) => {
      const group = roleLabel(m.roleName);
      (byRole[group] = byRole[group] || []).push(m);
    });
    return Object.entries(byRole).map(([group, items]) => ({
      group,
      items: items.map((m) => ({
        value: m.userId,
        label: m.login || m.email || m.userId,
        meta: m.roleName || ""
      }))
    }));
  }, [projectMembers]);

  /* userId → member row, so the create payload can carry email + role name. */
  const memberById = useMemo(() => {
    const map = {};
    projectMembers.forEach((m) => { map[m.userId] = m; });
    return map;
  }, [projectMembers]);

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
    const nextErr = {
      projectId: false,
      title: false,
      date: false,
      start: false,
      end: false,
      time: false,
      attendees: false
    };
    if (!draft.projectId) { nextErr.projectId = true; ok = false; }
    if (!draft.title.trim()) { nextErr.title = true; ok = false; }
    if (!draft.date) { nextErr.date = true; ok = false; }
    if (!draft.start) { nextErr.start = true; ok = false; }
    if (!draft.end) { nextErr.end = true; ok = false; }
    if (!draft.attendees || draft.attendees.length === 0) {
      nextErr.attendees = true;
      ok = false;
    }
    if (draft.start && draft.end && draft.end <= draft.start) {
      nextErr.time = true;
      ok = false;
    }
    setErrors(nextErr);
    if (!ok) return;

    setSubmitting(true);
    try {
      const attachments = await encodeAttachments(files);
      const externalEmails = Array.from(
        new Set([
          ...draft.external,
          ...extInput
            .split(",")
            .map((email) => email.trim())
            .filter(Boolean)
        ])
      );
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
          email: memberById[userId]?.email || "",
          roleName: memberById[userId]?.roleName || "",
          participantRole: "attendee",
          mandatory: false
        })),
        externalAttendees: externalEmails.map((email) => ({ email })),
        attachments
      };
      const created = await createMeeting(payload);
      const createdName =
        created?.title || created?.meetingCode || payload.title || "Meeting";
      show(`“${createdName}” created.`, "ok");
      setTimeout(() => navigate(backTo), 350);
    } catch (e) {
      show(e.message || "Failed to create meeting.", "warn");
    } finally {
      setSubmitting(false);
    }
  };

  const projectForTag = lockedProjectId
    ? lockedProject
    : draft.projectId
      ? projects.find((p) => p.projectId === draft.projectId)
      : null;

  const lockedProjectLabel = lockedProject
    ? `${lockedProject.projectCode ? `${lockedProject.projectCode} — ` : ""}${lockedProject.projectName || ""}`.trim()
    : lockedProjectId;

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
            onClick={() => navigate(backTo)}
            disabled={submitting}
          >
            {lockedProjectId ? "← Back to Meetings" : "← All Meetings"}
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
            {lockedProjectId ? (
              /* Came in from this project — nothing to choose. Shown
                 disabled so it reads like the read-only fields on the
                 Project Details screen. */
              <input
                id="projSel"
                type="text"
                readOnly
                disabled
                value={loadingProjects && !lockedProject ? "Loading…" : lockedProjectLabel}
              />
            ) : (
              <>
                <SearchableSelect
                  id="projSel"
                  value={draft.projectId}
                  loading={loadingProjects}
                  disabled={loadingProjects}
                  placeholder="Select a project…"
                  options={projects.map((p) => ({
                    value: p.projectId,
                    label: `${p.projectCode ? `${p.projectCode} — ` : ""}${p.projectName}`
                  }))}
                  onChange={(val) => {
                    /* Switching project changes the eligible attendee set, so
                       wipe any previously-picked attendees. */
                    updateDraft({ projectId: val, attendees: [] });
                    setErrors((er) => ({ ...er, projectId: false, attendees: false }));
                  }}
                />
                <div className={`field-err${errors.projectId ? " show" : ""}`}>
                  Please select a project.
                </div>
              </>
            )}
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
              onChange={(e) => {
                updateDraft({ title: e.target.value });
                setErrors((er) => ({ ...er, title: false }));
              }}
              placeholder="e.g. Q2 Governance Committee Review"
            />
            <div className={`field-err${errors.title ? " show" : ""}`}>
              Meeting Title is required.
            </div>
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
                setErrors((er) => ({ ...er, start: false, time: false }));
              }}
            />
            <div className={`field-err${errors.start ? " show" : ""}`}>
              Please select a start time.
            </div>
          </div>
          <div className="field">
            <label htmlFor="mEnd">
              End Time (IST) <span className="required">*</span>
            </label>
            <input
              id="mEnd"
              type="time"
              value={draft.end}
              onChange={(e) => {
                updateDraft({ end: e.target.value });
                setErrors((er) => ({ ...er, end: false, time: false }));
              }}
              onBlur={validateTimes}
            />
            <div className={`field-err${errors.end ? " show" : ""}`}>
              Please select an end time.
            </div>
            <div className={`field-err${errors.time ? " show" : ""}`}>
              End time must be after start time.
            </div>
          </div>
        </div>

        {/* ── Location & agenda ── */}
        <div className="mt-section-label">Location &amp; Agenda</div>
        <div className="field">
          <label htmlFor="mLoc">Meeting Location / Link</label>

          {/* Mode picker — pick how attendees will join / find the meeting. */}
          <div
            className="type-seg"
            role="radiogroup"
            aria-label="Meeting location type"
            style={{ marginBottom: 12 }}
          >
            {LOCATION_TYPES.map((t) => {
              const active = draft.locationType === t.key;
              /* Switching mode clears the value so an online link never
                 lingers in the Maps field (and vice-versa). */
              const pick = () =>
                updateDraft(
                  active ? {} : { locationType: t.key, location: "" }
                );
              return (
                <div
                  key={t.key}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  className={`type-opt${active ? " active" : ""}`}
                  onClick={pick}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick();
                    }
                  }}
                >
                  <span className="type-radio" aria-hidden="true" />
                  <span className="type-body">
                    <span className="type-name">
                      <span aria-hidden="true" style={{ marginRight: 6 }}>{t.icon}</span>
                      {t.name}
                    </span>
                    <span className="type-desc">{t.desc}</span>
                  </span>
                </div>
              );
            })}
          </div>

          {(() => {
            const cfg =
              LOCATION_TYPES.find((t) => t.key === draft.locationType) ||
              LOCATION_TYPES[0];
            const loc = draft.location.trim();
            const valueIsUrl = isUrl(loc);
            /* Soft, non-blocking hint: only the online mode strictly needs a
               URL — Maps mode happily accepts a plain address too. */
            const linkModeButNotUrl =
              loc && draft.locationType === "online" && !valueIsUrl;
            return (
              <>
                <input
                  id="mLoc"
                  type="text"
                  maxLength={300}
                  value={draft.location}
                  onChange={(e) => updateDraft({ location: e.target.value })}
                  placeholder={cfg.placeholder}
                  aria-label={cfg.label}
                />
                <div className="help">{cfg.help}</div>

                {/* Live preview — open/verify an online link before saving. */}
                {loc && draft.locationType === "online" && valueIsUrl && (
                  <div style={{ marginTop: 8 }}>
                    <a
                      className="pill-link"
                      href={loc}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      🎥 Open meeting link ↗
                    </a>
                  </div>
                )}

                {linkModeButNotUrl && (
                  <div className="help" style={{ color: "var(--red)" }}>
                    This doesn't look like a link — start it with https:// or
                    switch to “Location”.
                  </div>
                )}
              </>
            );
          })()}
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
            disabled={!draft.projectId || loadingMembers}
            placeholder={
              !draft.projectId
                ? "Select a project first…"
                : loadingMembers
                  ? "Loading project members…"
                  : "Select attendees…"
            }
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
            onClick={() => navigate(backTo)}
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