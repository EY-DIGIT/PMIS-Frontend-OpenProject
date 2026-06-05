/* ══════════════════════════════════════════════════════════════════
   MeetingDetailPage.jsx — meeting detail backed by:
     GET  /api/meetings/{id}        meeting + linked activity + attendees
     POST /api/meetings/{id}/mom    save MoM (decisions, actions, risks)

   Layout (top → bottom):
     1. Info card  — date, time (with duration), location/link (copy),
        linked activity, agenda, attendance checkboxes.
     2. MoM editor — three textareas; Save POSTs the structured payload.
     3. Tasks      — table of action items returned by the MoM API.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as usersApi from "../../api/users";
import { getMeeting, getMoM, saveMoM, updateMeeting } from "../../api/meetings";
import { sampleMoM, parseMoM } from "../../data/meetingsMock";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

/* ─── Small helpers (date / time / strings) ─── */
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function trimTime(hms) {
  return hms ? String(hms).slice(0, 5) : "";
}
function fmtDuration(start, end) {
  const a = trimTime(start);
  const b = trimTime(end);
  if (!a || !b) return "";
  const [sh, sm] = a.split(":").map(Number);
  const [eh, em] = b.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function initials(name) {
  return (name || "?")
    .split(/[\s@]+/)
    .filter(Boolean)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function addDaysISO(iso, n) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ─── Status badge — DRAFT / SCHEDULED / COMPLETED / CANCELLED ─── */
const STATUS_CLASS = {
  DRAFT: "st-draft",
  SCHEDULED: "st-scheduled",
  COMPLETED: "st-completed",
  CANCELLED: "st-mom",
};
function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();
  return <span className={`badge ${STATUS_CLASS[s] || "st-draft"}`}>{s || "—"}</span>;
}

/* ─── Info tile (date / time / location) ─── */
function InfoTile({ icon, label, value }) {
  return (
    <div className="mt-info-tile">
      <span className="mt-info-tile__icon" aria-hidden="true">{icon}</span>
      <span className="mt-info-tile__body">
        <span className="mt-info-tile__lbl">{label}</span>
        <span className="mt-info-tile__val">{value}</span>
      </span>
    </div>
  );
}

/* ─── Location field with a copy button. Renders as a link when the
   value looks like a URL, otherwise plain text. ─── */
function LocationValue({ loc, onCopy }) {
  const s = String(loc || "").trim();
  if (!s) return "—";
  const isLink = /^https?:\/\//i.test(s);
  const doCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(s);
      onCopy?.("ok");
    } catch {
      onCopy?.("err");
    }
  };
  return (
    <span className="mt-loc-val">
      {isLink ? (
        <a href={s} target="_blank" rel="noopener noreferrer">{s}</a>
      ) : (
        <span>{s}</span>
      )}
      <button
        type="button"
        className="mt-copy-btn"
        title="Copy link"
        aria-label="Copy link"
        onClick={doCopy}
      >
        📋
      </button>
    </span>
  );
}

/* ─── Freeform MoM text ⇄ structured. Decisions and Risks are flat
   description lists; ActionItems hold owner + due-date metadata. ─── */
function parseLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}
function joinLines(lines) {
  return (lines || []).join("\n");
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);

  const [momForm, setMomForm] = useState({
    decisions: "",
    actions: "",
    risks: "",
  });
  const [momRemote, setMomRemote] = useState(null);
  const [savingMom, setSavingMom] = useState(false);

  /* Attendance is tracked locally and persisted via PUT when Mark Present is clicked. */
  const [presentSelection, setPresentSelection] = useState([]);
  const [updatingAttendance, setUpdatingAttendance] = useState(false);
  const taskSectionRef = useRef(null);

  /* Load users for attendee display + owner labels. */
  useEffect(() => {
    let alive = true;
    usersApi
      .list({ pageSize: 200 })
      .then((rows) => { if (alive) setUsers(rows); })
      .catch(() => { /* fall back to userId text */ });
    return () => { alive = false; };
  }, []);

  /* Clear the breadcrumb's meeting-name context when leaving the page. */
  useEffect(() => () => clearPageContext(), []);

  const userById = useMemo(() => {
    const m = new Map();
    users.forEach((u) => m.set(u.userId, u));
    return (uid) => m.get(uid) || null;
  }, [users]);

  const labelFor = (uid) => {
    const u = userById(uid);
    return u ? u.fullName || u.email || uid : uid;
  };

  /* Fetch the meeting whenever the route param changes. Also pulls any
     existing MoM via /meetings/mom/get/{id} and prefills the MoM
     textareas + the rendered decisions/actions/risks panel so the user
     edits a saved record instead of starting from blank. */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setPresentSelection([]);
    setMomRemote(null);
    setMomForm({ decisions: "", actions: "", risks: "" });
    getMeeting(id)
      .then((m) => {
        if (!alive) return;
        setMeeting(m);
        /* Publish the meeting name so the global breadcrumb shows it
           instead of the raw id. */
        setPageContext({ meetingName: m?.title || m?.meetingCode || "" });
        /* Backend echoes back attendance state — pre-tick everyone the
           response already marks as present so the user sees the saved
           state instead of an empty grid. Internal rows are keyed by
           userId; external rows by email — same keys the toggle uses. */
        const presentKeys = [
          ...(m?.attendees || [])
            .filter((a) => a && a.isPresent)
            .map((a) => a.userId),
          ...(m?.externalAttendees || [])
            .filter((e) => e && e.isPresent)
            .map((e) => e.email),
        ].filter(Boolean);
        setPresentSelection(presentKeys);

        /* The MoM endpoint is keyed on the meeting's own id — the same id
           `saveMoM` posts to — NOT the route param (which is the meeting
           code). Fetch it here, once the loaded meeting gives us that id,
           so a saved MoM reappears on reload. */
        getMoM(m?.id ?? id)
          .then((mom) => {
            if (!alive || !mom) return;
            /* Tolerate the various wrappers the backend hands us — direct
               object, { data: {...} }, { mom: {...} }, or { data: { mom: {...} } }.
               Pick whichever candidate actually carries the MoM arrays.
               Field names also vary (actionItems vs actions). */
            const candidates = [mom?.data?.mom, mom?.mom, mom?.data, mom];
            const hasMoM = (c) =>
              c && typeof c === "object" &&
              (Array.isArray(c.decisions) ||
                Array.isArray(c.actionItems) ||
                Array.isArray(c.actions) ||
                Array.isArray(c.risks));
            const data =
              candidates.find(hasMoM) ||
              candidates.find((c) => c && typeof c === "object");
            if (!data || typeof data !== "object") return;
            const decisionsList = Array.isArray(data.decisions) ? data.decisions : [];
            const actionsList = Array.isArray(data.actionItems)
              ? data.actionItems
              : Array.isArray(data.actions)
              ? data.actions
              : [];
            const risksList = Array.isArray(data.risks) ? data.risks : [];
            setMomRemote({
              ...data,
              decisions: decisionsList,
              actionItems: actionsList,
              risks: risksList,
            });
            setMomForm({
              decisions: joinLines(
                decisionsList.map((d) => d?.description || "").filter(Boolean)
              ),
              actions: joinLines(
                actionsList.map((a) => a?.description || "").filter(Boolean)
              ),
              risks: joinLines(
                risksList.map((r) => r?.description || "").filter(Boolean)
              ),
            });
          })
          .catch(() => { /* no existing MoM yet — leave the form blank */ });
      })
      .catch((e) => {
        if (!alive) return;
        setMeeting(null);
        show(e.message || "Failed to load meeting.", "warn");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, show]);

  const updateMomField = (key, value) =>
    setMomForm((f) => ({ ...f, [key]: value }));

  /* Drop a canned MoM block into the three textareas so the user can
     test the form without typing the whole thing. Mirrors the helper
     from the pre-API HTML reference; doesn't touch the server. */
  const loadSample = () => {
    if (!meeting) return;
    setMomForm(parseMoM(sampleMoM(meeting)));
    show("Sample MoM loaded.", "ok");
  };

  const toggleSelection = (key) => {
    setPresentSelection((sel) =>
      sel.includes(key) ? sel.filter((x) => x !== key) : sel.concat(key)
    );
  };

  const submitMoM = async () => {
    if (!meeting) return;
    const decisions = parseLines(momForm.decisions);
    const actions = parseLines(momForm.actions);
    const risks = parseLines(momForm.risks);
    if (!decisions.length && !actions.length && !risks.length) {
      show("Add at least one decision, action, or risk.", "warn");
      return;
    }
    const fallbackOwner =
      meeting.attendees?.[0]?.userId || users[0]?.userId || null;
    const due = addDaysISO(meeting.meetingDate, 7);
    const body = {
      title: meeting.title || "Meeting",
      templateId: 1,
      content: [
        decisions.length ? `Decisions:\n${decisions.map((d) => `- ${d}`).join("\n")}` : "",
        actions.length ? `Actions:\n${actions.map((d) => `- ${d}`).join("\n")}` : "",
        risks.length ? `Risks:\n${risks.map((d) => `- ${d}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
      decisions: decisions.map((description) => ({
        description,
        ownerUserId: fallbackOwner,
      })),
      actionItems: actions.map((description) => ({
        description,
        assignedToUserId: fallbackOwner,
        dueDate: due,
      })),
      risks: risks.map((description) => ({
        description,
        severity: "LOW",
        mitigation: "",
        ownerUserId: fallbackOwner,
      })),
    };
    setSavingMom(true);
    try {
      const saved = await saveMoM(meeting.id, body);
      setMomRemote(saved);
      show("MoM saved.", "ok");
      setTimeout(() => {
        taskSectionRef.current?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
    } catch (e) {
      show(e.message || "Failed to save MoM.", "warn");
    } finally {
      setSavingMom(false);
    }
  };

  if (loading) {
    return (
      <div className="pmis-mtg">
        <div className="page-header">
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
        <div className="page-header">
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

  const internalAttendees = meeting.attendees || [];
  const externalAttendees = meeting.externalAttendees || [];

  const attendanceRows = [
    ...internalAttendees.map((a) => ({
      key: a.userId,
      label: labelFor(a.userId),
      sub: a.participantRole || "Internal",
      kind: "int",
    })),
    ...externalAttendees.map((e) => ({
      key: e.email,
      label: e.email,
      sub: "External",
      kind: "ext",
    })),
  ];
  const presentCount = presentSelection.length;
  const noneSelected = presentCount === 0;
  const allKeys = attendanceRows.map((r) => r.key);
  const attendanceButtonLabel = noneSelected
    ? "Mark all present"
    : `Mark Present (${presentCount})`;
  const onAttendanceButton = async () => {
    if (!meeting || updatingAttendance) return;
    
    /* Toggle selection. */
    const newSelection = noneSelected ? allKeys : presentSelection;
    setPresentSelection(newSelection);
    
    /* Build the payload with attendance updates. */
    setUpdatingAttendance(true);
    try {
      const updatedAttendees = internalAttendees.map((a) => ({
        userId: a.userId,
        participantRole: a.participantRole || "Internal",
        mandatory: a.mandatory ?? false,
        isPresent: newSelection.includes(a.userId),
      }));
      
      const updatedExternalAttendees = externalAttendees.map((e) => ({
        email: e.email,
        isPresent: newSelection.includes(e.email),
      }));
      
      const payload = {
        title: meeting.title,
        meetingDate: meeting.meetingDate,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        description: meeting.description,
        meetingLink: meeting.meetingLink,
        projectId: meeting.projectId,
        attendees: updatedAttendees,
        externalAttendees: updatedExternalAttendees,
      };
      
      await updateMeeting(meeting.id, payload);
      show(
        noneSelected
          ? `${allKeys.length} marked present.`
          : `${presentCount} marked present.`,
        "ok"
      );
    } catch (e) {
      setPresentSelection(noneSelected ? [] : presentSelection);
      show(e.message || "Failed to update attendance.", "warn");
    } finally {
      setUpdatingAttendance(false);
    }
  };

  const decisions = momRemote?.decisions || [];
  const actionItems = momRemote?.actionItems || [];
  const risks = momRemote?.risks || [];

  return (
    <div className="pmis-mtg">
      <div className="page-header">
        <div>
          <div className="pm-title">{meeting.title}</div>
          <div className="pm-subtitle">
            #{meeting.meetingCode}
            {meeting.activityName ? ` · ${meeting.activityName}` : ""}
          </div>
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

      {/* ── Section 1: meeting info ── */}
      <div className="card">
        <div className="mt-hero">
          <StatusBadge status={meeting.status} />
          {meeting.projectId && (
            <span className="pill-link">Project: {meeting.projectName}</span>
          )}
        </div>

        <div className="mt-info-grid">
          <InfoTile icon="📅" label="Date" value={fmtDate(meeting.meetingDate)} />
          <InfoTile
            icon="🕐"
            label="Time (IST)"
            value={
              `${trimTime(meeting.startTime) || "—"} – ${trimTime(meeting.endTime) || "—"}` +
              (fmtDuration(meeting.startTime, meeting.endTime)
                ? ` (${fmtDuration(meeting.startTime, meeting.endTime)})`
                : "")
            }
          />
          <InfoTile
            icon="📍"
            label="Location / Link"
            value={
              <LocationValue
                loc={meeting.meetingLink}
                onCopy={(k) =>
                  show(
                    k === "ok" ? "Link copied." : "Copy failed.",
                    k === "ok" ? "ok" : "warn"
                  )
                }
              />
            }
          />
        </div>

        {(meeting.activityName || meeting.activityId) && (
          <>
            <div className="mt-section-label">Linked Activity</div>
            <div className="attendee-chips">
              <span className="chip">
                {meeting.activityName || meeting.activityId}
                <span className="sub">{meeting.activityId}</span>
              </span>
            </div>
          </>
        )}

        {meeting.description && (
          <>
            <div className="mt-section-label">Agenda</div>
            <div className="mt-agenda">{meeting.description}</div>
          </>
        )}

        <div className="mt-section-label">
          Attendance{" "}
          <span className="muted" style={{ fontWeight: 500, fontSize: 12.5 }}>
            (tick whoever was present, then click Mark Present)
          </span>
        </div>
        <div className="mt-attendance">
          {attendanceRows.length === 0 ? (
            <div className="mt-empty-people">No attendees added.</div>
          ) : (
            <>
              <div className="mt-attendance__head">
                <span>
                  {presentCount}/{attendanceRows.length} selected
                </span>
                <button
                  type="button"
                  className="btn ghost small-btn is-emphasised"
                  onClick={onAttendanceButton}
                  disabled={updatingAttendance}
                >
                  {updatingAttendance ? "Updating..." : attendanceButtonLabel}
                </button>
              </div>
              <div className="mt-attendance__grid">
                {attendanceRows.map((r) => {
                  const checked = presentSelection.includes(r.key);
                  return (
                    <label
                      key={r.kind + ":" + r.key}
                      className={`mt-attendance__row${checked ? " is-present" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelection(r.key)}
                      />
                      <span
                        className={`mt-people-avatar${
                          r.kind === "ext" ? " mt-people-avatar--ext" : ""
                        }`}
                      >
                        {initials(r.label)}
                      </span>
                      <span className="mt-people-body">
                        <span className="mt-people-name">{r.label}</span>
                        <span className="mt-people-sub">{r.sub}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Section 2: MoM editor ── */}
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div className="card-title" style={{ margin: 0 }}>
            Minutes of Meeting
          </div>
          <button
            type="button"
            className="btn ghost small-btn"
            onClick={loadSample}
            disabled={savingMom}
          >
            Load sample
          </button>
        </div>
        <div id="mom-form" className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="field full">
            <label htmlFor="momDecisions">Decisions</label>
            <textarea
              id="momDecisions"
              className="mom-textarea"
              style={{ height: 130 }}
              placeholder={"One decision per line."}
              value={momForm.decisions}
              onChange={(e) => updateMomField("decisions", e.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="momActions">Action Items</label>
            <textarea
              id="momActions"
              className="mom-textarea"
              style={{ height: 170 }}
              placeholder={"One action per line."}
              value={momForm.actions}
              onChange={(e) => updateMomField("actions", e.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="momRisks">Risks</label>
            <textarea
              id="momRisks"
              className="mom-textarea"
              style={{ height: 110 }}
              placeholder={"One risk per line."}
              value={momForm.risks}
              onChange={(e) => updateMomField("risks", e.target.value)}
            />
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={submitMoM}
            disabled={savingMom}
          >
            {savingMom ? "Saving…" : "Save MoM"}
          </button>
        </div>
      </div>

      {/* ── Section 3: items returned by the MoM API ── */}
      <div ref={taskSectionRef}>
        {momRemote ? (
          <>
            {decisions.length > 0 && (
              <div className="card">
                <div className="card-title">Decisions</div>
                <ul className="mt-list">
                  {decisions.map((d) => (
                    <li key={d.id}>
                      <span>{d.description}</span>
                      {d.ownerUserId && (
                        <span className="muted">
                          {" "}
                          · {labelFor(d.ownerUserId)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {actionItems.length > 0 && (
              <div className="card">
                <div className="card-title">Action Items</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 240 }}>Description</th>
                        <th>Owner</th>
                        <th>Due</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionItems.map((a) => (
                        <tr key={a.id}>
                          <td>{a.description}</td>
                          <td>{labelFor(a.assignedToUserId)}</td>
                          <td>{fmtDate(a.dueDate)}</td>
                          <td>
                            <span className="badge ai-open">
                              {a.status || "OPEN"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {risks.length > 0 && (
              <div className="card">
                <div className="card-title">Risks</div>
                <ul className="mt-list">
                  {risks.map((r) => (
                    <li key={r.id}>
                      <span>{r.description}</span>
                      {r.severity && (
                        <span className="muted"> · {r.severity}</span>
                      )}
                      {r.mitigation && (
                        <div className="muted">Mitigation: {r.mitigation}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="card no-stripe" style={{ borderStyle: "dashed" }}>
            <div className="empty-state">
              Save the MoM to see decisions, action items and risks here.
            </div>
          </div>
        )}
      </div>
      {toastNode}
    </div>
  );
}