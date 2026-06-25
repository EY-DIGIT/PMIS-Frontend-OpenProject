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
import { listUsersByProjectOrg } from "../../api/teamPage";
import { getMeeting, getMoM, saveMoM, updateMeeting, momUpdateStatus, createActivityTask } from "../../api/meetings";
import { sampleMoM, parseMoM } from "../../data/meetingsMock";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

const STATUS_OPTIONS = ["DRAFT", "IN_REVIEW", "FINALIZED"];

/* TEMP (test only): default task assignee when a row has no owner picked and
   no project-assignable user resolves. This is the org-admin user id — remove
   once the project-org assignee dropdown is confirmed working end-to-end. */
const DEFAULT_ASSIGNEE_ID = "71e53819-ee1b-4ddb-aad2-42d010c41632";

/* n8n webhook that turns a meeting transcript into a structured MoM.
   Two input shapes (per the backend team's working request):
     - PDF upload  : multipart/form-data, key `file`
     - Transcript  : JSON body { "transcript": "<text>" }
   It responds with JSON shaped like the saveMoM payload:
     { title, templateId, content, decisions[], actionItems[], risks[] }
   where each entry carries a `description` (owners come back as speaker
   labels like "Speaker 1", not real user ids). */
const MEETING_WEBHOOK_URL = "http://10.1.131.199:5678/webhook/meeting";

/* Map the webhook's structured JSON response into the three editable
   textareas — descriptions only, since owners are speaker labels rather
   than real user ids. Falls back to parsing the plain-text `content`
   block if the structured arrays are absent. */
function momFormFromResponse(data) {
  const root = Array.isArray(data) ? data[0] : data?.data ?? data;
  if (!root || typeof root !== "object") return null;
  /* Prefix each line with a bullet so the textareas read as a list.
     parseLines strips these back off before saving. */
  const bulletize = (text) =>
    String(text || "")
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean)
      .map((l) => `• ${l}`)
      .join("\n");
  const descs = (arr) =>
    bulletize(
      (Array.isArray(arr) ? arr : [])
        .map((x) => (typeof x === "string" ? x : x?.description || ""))
        .filter(Boolean)
        .join("\n")
    );
  const decisions = descs(root.decisions);
  const actions = descs(root.actionItems ?? root.actions);
  const risks = descs(root.risks);
  if (decisions || actions || risks) return { decisions, actions, risks };
  /* No structured arrays — fall back to the plain-text content block. */
  if (typeof root.content === "string" && root.content.trim()) {
    const fb = parseMoM(root.content);
    return {
      decisions: bulletize(fb.decisions),
      actions: bulletize(fb.actions),
      risks: bulletize(fb.risks),
    };
  }
  return null;
}

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

/* The task-create API wants a full ISO datetime (e.g. 2026-06-22T00:00:00.000Z),
   but our date inputs hand back a plain "YYYY-MM-DD". Widen the date to a
   midnight-UTC timestamp; pass anything already containing a time straight
   through. Returns "" for empty input so callers can fall back. */
function toIsoDateTime(value) {
  if (!value) return "";
  const s = String(value);
  const d = s.includes("T") ? new Date(s) : new Date(s + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/* MoM table priority (LOW/MEDIUM/HIGH/CRITICAL) → task API priority
   (p1..p4). Per the contract, LOW is the lowest code (p1). */
const TASK_PRIORITY_MAP = {
  LOW: "p1",
  MEDIUM: "p2",
  HIGH: "p3",
  CRITICAL: "p4",
};

/* ─── Status badge — DRAFT / SCHEDULED / COMPLETED / CANCELLED ─── */
const STATUS_CLASS = {
  DRAFT: "st-draft",
  IN_REVIEW: "st-mom",
  FINALIZED: "st-completed",
};
function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();
  return <span className={`badge ${STATUS_CLASS[s] || "st-draft"}`}>{s || "—"}</span>;
}

/* ─── Action-item status badge — items carry the same three statuses
   as the MoM (DRAFT / IN_REVIEW / FINALIZED). ─── */
const AI_STATUS_CLASS = {
  DRAFT: "st-draft",
  IN_REVIEW: "ai-progress",
  FINALIZED: "ai-completed",
};
function ActionStatusBadge({ status }) {
  const s = String(status || "").toUpperCase();
  if (!s) return <span className="muted">—</span>;
  return <span className={`badge ${AI_STATUS_CLASS[s] || "st-draft"}`}>{s.replace(/_/g, " ")}</span>;
}

/* ─── Minimal line icons (stroke-based, inherit currentColor) so the UI
   reads as professional rather than emoji-decorated. ─── */
function Icon({ name, size = 16 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  switch (name) {
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 2.5v4M16 2.5v4" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "pin":
      return (
        <svg {...common}>
          <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <path d="M14 3v5h5" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common}>
          <path d="M12 3l1.8 4.8L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.2Z" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h8" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
          <path d="M13.5 6.5l4 4" />
        </svg>
      );
    default:
      return null;
  }
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
        <Icon name="copy" size={14} />
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
function numberOrUndefined(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function cleanPayload(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== "" && value !== null && value !== undefined)
  );
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  /* Users that can actually be assigned a task on this meeting's project.
     A task's assignee MUST have a role on the project (the create API
     returns 403 otherwise), so the "Assigned To" dropdown is sourced from
     the linked activity's vendor assignable-users — NOT the global user
     directory. Resolved via: meeting.activityId → activity.vendorId →
     listVendorAssignableUsers(vendorId). */
  const [assignees, setAssignees] = useState([]);

  const [momForm, setMomForm] = useState({
    title: "",
    templateId: "1",
    content: "",
    decisions: "",
    actions: "",
    risks: "",
    decisionDetails: [],
    actionDetails: [],
    riskDetails: [],
  });
  const [momRemote, setMomRemote] = useState(null);
  const [savingMom, setSavingMom] = useState(false);

  /* Auto-MoM generator (n8n webhook). User uploads a PDF transcript or
     pastes the transcript text; the response fills the MoM textareas. */
  const [transcript, setTranscript] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [generating, setGenerating] = useState(false);
  /* Which input the user picked: "file" (Choose PDF) or "paste" (transcript text). */
  const [momInputMode, setMomInputMode] = useState("");

  /* A MoM has a SINGLE status — edited once for the whole record, not
     per action item. These drive that one inline editor. */
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  /* Attendance is tracked locally and persisted via PUT when Mark Present is clicked. */
  const [presentSelection, setPresentSelection] = useState([]);
  const [updatingAttendance, setUpdatingAttendance] = useState(false);
  const taskSectionRef = useRef(null);

  const startStatusEdit = () => {
    /* A FINALIZED MoM is locked — guard here too in case the button is
       ever reachable. */
    if (String(momRemote?.status || "").toUpperCase() === "FINALIZED") return;
    setStatusDraft(String(momRemote?.status || "").toUpperCase() || STATUS_OPTIONS[0]);
    setEditingStatus(true);
  };
  const cancelStatusEdit = () => { setEditingStatus(false); setStatusDraft(""); };
  const saveStatus = async () => {
    const momId = momRemote?.id ?? momRemote?.momId;
    if (!momId) {
      show("MoM ID missing.", "warn");
      return;
    }
    if (savingStatus) return;
    try {
      setSavingStatus(true);
      await momUpdateStatus(momId, statusDraft);
      /* Patch the loaded record in place so the badge reflects the new
         status without a reload. */
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

  /* Load users for attendee display + owner labels. */
  useEffect(() => {
    let alive = true;
    usersApi
      .list({ pageSize: 200 })
      .then((rows) => { if (alive) setUsers(rows); })
      .catch(() => { /* fall back to userId text */ });
    return () => { alive = false; };
  }, []);

  /* Resolve the task-assignee candidates for this meeting's project. A task
     assignee MUST belong to a vendor mapped to the project (the create API
     403s on `same_vendor` otherwise), so we source the dropdown from the
     project's organization-associated users — NOT the global directory or
     the activity's vendor. The associated-users endpoint returns
     { id, login, email, firstName, lastName, ... }; normalize to the
     { userId, fullName, email } shape the rest of the page uses. */
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
              u.fullName ||
              u.name ||
              u.login ||
              u.email ||
              "",
            email: u.email || "",
          }))
          .filter((u) => u.userId);
        setAssignees(norm);
      })
      .catch(() => { if (alive) setAssignees([]); });
    return () => { alive = false; };
  }, [meeting?.projectId]);

  /* Clear the breadcrumb's meeting-name context when leaving the page. */
  useEffect(() => () => clearPageContext(), []);

  const userById = useMemo(() => {
    const m = new Map();
    /* Directory first, then assignees — so an assignee not in the paged
       directory still resolves to a name. */
    users.forEach((u) => m.set(u.userId, u));
    assignees.forEach((u) => m.set(u.userId, u));
    return (uid) => m.get(uid) || null;
  }, [users, assignees]);

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
    setMomForm({
      title: "",
      templateId: "1",
      content: "",
      decisions: "",
      actions: "",
      risks: "",
      decisionDetails: [],
      actionDetails: [],
      riskDetails: [],
    });
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
              title: data.title || "",
              templateId: String(data.templateId ?? "1"),
              content: data.content || "",
              decisions: joinLines(
                decisionsList.map((d) => d?.description || "").filter(Boolean)
              ),
              actions: joinLines(
                actionsList.map((a) => a?.description || "").filter(Boolean)
              ),
              risks: joinLines(
                risksList.map((r) => r?.description || "").filter(Boolean)
              ),
              decisionDetails: decisionsList.map((d) => ({
                id: d?.id ?? "",
                ownerUserId: d?.ownerUserId || "",
              })),
              actionDetails: actionsList.map((a) => ({
                id: a?.id ?? "",
                momId: a?.momId ?? "",
                taskName: a?.taskName || a?.title || "",
                description: a?.description || "",
                assignedToUserId: a?.assignedToUserId || "",
                startDate: a?.startDate || "",
                endDate: a?.endDate || a?.dueDate || "",
                priority: a?.priority || "MEDIUM",
                status: a?.status || "OPEN",
              })),
              riskDetails: risksList.map((r) => ({
                id: r?.id ?? "",
                severity: r?.severity || "LOW",
                mitigation: r?.mitigation || "",
                ownerUserId: r?.ownerUserId || "",
              })),
            });
          })
          .catch(() => {

            if (!alive) return;

            // ✅ Treat 404 as "no MoM"
            setMomRemote(null);
          });
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
  const updateMomDetail = (section, index, key, value) =>
    setMomForm((f) => {
      const rows = [...(f[section] || [])];
      rows[index] = { ...(rows[index] || {}), [key]: value };
      return { ...f, [section]: rows };
    });

  /* The MoM is now a single dynamic Tasks table — each row lives in
     momForm.actionDetails. Task Name / Start Date / Priority have no
     dedicated API column, so they are folded into the content block on
     save (see submitMoM). */
  const emptyTaskRow = () => ({
    taskName: "",
    description: "",
    startDate: "",
    endDate: "",
    assignedToUserId: "",
    priority: "MEDIUM",
    status: "OPEN",
  });
  const addTaskRow = () =>
    setMomForm((f) => ({
      ...f,
      actionDetails: [...(f.actionDetails || []), emptyTaskRow()],
    }));
  const removeTaskRow = (index) =>
    setMomForm((f) => ({
      ...f,
      actionDetails: (f.actionDetails || []).filter((_, i) => i !== index),
    }));

  /* Drop a canned MoM block into the three textareas so the user can
     test the form without typing the whole thing. Mirrors the helper
     from the pre-API HTML reference; doesn't touch the server. */
  const loadSample = () => {
    if (!meeting) return;
    const sample = parseMoM(sampleMoM(meeting));
    const rows = parseLines(sample.actions).map((description) => ({
      ...emptyTaskRow(),
      description,
    }));
    setMomForm((f) => ({
      ...f,
      title: f.title || meeting.title || "",
      templateId: f.templateId || "1",
      actionDetails: rows,
    }));
    show("Sample tasks loaded.", "ok");
  };

  /* Send the PDF / pasted transcript to the n8n webhook and parse the
     structured MoM it returns into the three editable fields. An uploaded
     PDF wins over pasted text. Does NOT save — the user reviews, then
     clicks Save MoM. */
  const generateFromTranscript = async () => {
    if (generating) return;
    const text = transcript.trim();
    if (!uploadFile && !text) {
      show("Upload a PDF or paste the transcript first.", "warn");
      return;
    }
    setGenerating(true);
    try {
      let res;
      if (uploadFile) {
        const fd = new FormData();
        fd.append("file", uploadFile);
        /* No Content-Type header — the browser sets the multipart
           boundary itself. */
        res = await fetch(MEETING_WEBHOOK_URL, { method: "POST", body: fd });
      } else {
        /* The workflow expects the transcript wrapped as JSON, not a raw
           text/plain body (matches the backend team's working request). */
        res = await fetch(MEETING_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = momFormFromResponse(await res.json().catch(() => null));
      if (!parsed || (!parsed.decisions && !parsed.actions && !parsed.risks)) {
        show("Couldn't read a MoM from the response.", "warn");
        return;
      }
      /* Every extracted line (decisions / actions / risks) becomes a task
         row — the user reviews and fills in dates / owner / priority. */
      const rows = [
        ...parseLines(parsed.actions),
        ...parseLines(parsed.decisions),
        ...parseLines(parsed.risks),
      ].map((description) => ({ ...emptyTaskRow(), description }));
      if (!rows.length) {
        show("Couldn't read any tasks from the response.", "warn");
        return;
      }
      setMomForm((f) => ({
        ...f,
        title: f.title || meeting?.title || "",
        templateId: f.templateId || "1",
        actionDetails: rows,
      }));
      show("Auto MoM generated — review and edit before saving.", "ok");
    } catch (e) {
      show(e.message || "Failed to generate MoM.", "warn");
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelection = (key) => {
    setPresentSelection((sel) =>
      sel.includes(key) ? sel.filter((x) => x !== key) : sel.concat(key)
    );
  };

  const submitMoM = async () => {
    if (!meeting) return;
    const taskRows = (momForm.actionDetails || []).filter(
      (d) =>
        (d.taskName && d.taskName.trim()) ||
        (d.description && d.description.trim()) ||
        d.assignedToUserId ||
        d.startDate ||
        d.endDate
    );
    if (!taskRows.length) {
      show("Add at least one task.", "warn");
      return;
    }
    /* The task-create API rejects assignees without a project role, so the
       fallback owner must come from the project-assignable list. Prefer an
       attendee who is also assignable; otherwise the first assignable user. */
    const assigneeIds = new Set(assignees.map((u) => u.userId));
    const fallbackOwner =
      meeting.attendees?.find((a) => assigneeIds.has(a.userId))?.userId ||
      assignees[0]?.userId ||
      DEFAULT_ASSIGNEE_ID;
    const due = addDaysISO(meeting.meetingDate, 7);
    /* Task Name, Start Date and Priority have no dedicated API column, so
       they are folded into the human-readable content block here. */
    const generatedContent = `Tasks:\n${taskRows
      .map((d) =>
        [
          `- ${d.taskName?.trim() || d.description?.trim() || "Untitled task"}`,
          d.description?.trim() ? `Description: ${d.description.trim()}` : "",
          d.startDate ? `Start: ${d.startDate}` : "",
          d.endDate || d.dueDate ? `End: ${d.endDate || d.dueDate}` : "",
          d.assignedToUserId ? `Assigned: ${labelFor(d.assignedToUserId)}` : "",
          d.priority ? `Priority: ${d.priority}` : "",
        ]
          .filter(Boolean)
          .join(" | ")
      )
      .join("\n")}`;
    const body = {
      title: momForm.title?.trim() || meeting.title || "Meeting",
      templateId: numberOrUndefined(momForm.templateId) ?? 1,
      content: momForm.content?.trim() || generatedContent,
      status: momRemote?.status || "DRAFT",
      decisions: [],
      actionItems: taskRows.map((d) =>
        cleanPayload({
          id: numberOrUndefined(d.id),
          momId: numberOrUndefined(d.momId),
          description: d.description?.trim() || d.taskName?.trim() || "Untitled task",
          assignedToUserId: d.assignedToUserId || fallbackOwner,
          dueDate: d.endDate || d.dueDate || due,
          status: d.status || "OPEN",
          comments: [],
          extensionRequests: [],
        })
      ),
      risks: [],
    };
    /* Tasks gate the MoM: create every task FIRST, and only persist the MoM
       if they all succeed. If any task call fails, abort and surface the
       error — the MoM is NOT saved. */
    const activityId = meeting.activityId;
    if (!activityId) {
      show("This meeting has no linked activity — cannot create tasks.", "warn");
      return;
    }
    setSavingMom(true);
    try {
      /* 1. Create one task per table row. Throw on the first failure so the
            MoM save below never runs. */
      let created = 0;
      for (let i = 0; i < taskRows.length; i++) {
        const d = taskRows[i];
        const name = d.taskName?.trim() || d.description?.trim() || "Untitled task";
        const assignedTo = d.assignedToUserId || fallbackOwner;
        /* No valid project assignee → the create API would 403. Fail now
           with a clear message instead of firing a doomed request. */
        if (!assignedTo) {
          throw new Error(`"${name}" has no assignable user for this project.`);
        }
        const startDate = toIsoDateTime(d.startDate) || toIsoDateTime(meeting.meetingDate);
        const endDate = toIsoDateTime(d.endDate || d.dueDate) || toIsoDateTime(due);
        const taskBody = cleanPayload({
          name,
          description: d.description?.trim() || d.taskName?.trim() || name,
          startDate,
          endDate,
          /* Mirror planned dates — matches the proven-201 request shape. */
          actualStartDate: startDate,
          actualEndDate: endDate,
          status: "open",
          priority: TASK_PRIORITY_MAP[String(d.priority || "MEDIUM").toUpperCase()] || "p2",
          /* 1-based position so tasks keep their row order (1, 2, 3, …). */
          position: i + 1,
          assignedTo,
          dependsOn: [],
        });
        try {
          await createActivityTask(activityId, taskBody);
          created += 1;
        } catch (err) {
          throw new Error(`Task "${name}" failed: ${err.message || "request error"}`);
        }
      }

      /* 2. All tasks created — now persist the MoM. */
      const saved = await saveMoM(meeting.id, body);
      setMomRemote(saved);
      show(`${created} task${created === 1 ? "" : "s"} created. MoM saved.`, "ok");

      setTimeout(() => {
        taskSectionRef.current?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
    } catch (e) {
      /* A task (or the MoM) failed — show the error and leave the MoM unsaved. */
      show(e.message || "Failed — MoM not saved.", "warn");
    } finally {
      setSavingMom(false);
    }
  };

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

  const actionItems = momRemote?.actionItems || [];
  const taskRowsDraft = momForm.actionDetails || [];
  /* TEMP (test): allow ANY user as a task assignee. The create API really
     wants a project-mapped user (see `assignees`), but for now we list the
     full directory so testers can pick e.g. super-admin. Swap back to
     `assignees` once project-scoped assignment is confirmed. */
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
          <InfoTile icon={<Icon name="calendar" />} label="Date" value={fmtDate(meeting.meetingDate)} />
          <InfoTile
            icon={<Icon name="clock" />}
            label="Time (IST)"
            value={
              `${trimTime(meeting.startTime) || "—"} – ${trimTime(meeting.endTime) || "—"}` +
              (fmtDuration(meeting.startTime, meeting.endTime)
                ? ` (${fmtDuration(meeting.startTime, meeting.endTime)})`
                : "")
            }
          />
          <InfoTile
            icon={<Icon name="pin" />}
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
                {/* <span className="sub">{meeting.activityId}</span> */}
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
                        className={`mt-people-avatar${r.kind === "ext" ? " mt-people-avatar--ext" : ""
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
      {momRemote === null ? (
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
          {/* ── Auto-MoM generator: upload a PDF or paste the transcript,
                 then "Generate Auto MoM" fills the three fields below. ── */}
          <div
            style={{
              marginBottom: 16,
              borderRadius: 10,
              border: "1px solid #e9eef6",
              background: "#fbfcfe",
              overflow: "hidden",
            }}
          >
            {/* header — title on the left, the two mode options on the right */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid #e6ecf5",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#eef4fb",
                  border: "1px solid #d9e6f5",
                  color: "#0b3c88",
                }}
              >
                <Icon name="sparkle" size={16} />
              </span>

              <div style={{ lineHeight: 1.3 }}>
                <div style={{ fontWeight: 700, color: "#173e77" }}>
                  Generate Auto MoM
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Upload a PDF transcript or paste the text — it fills the
                  Tasks table below for you to review.
                </div>
              </div>

              {/* mode selector — sits to the right of the title, same level */}
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    margin: 0,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "#173e77",
                    cursor: generating || savingMom ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="momInputMode"
                    value="file"
                    checked={momInputMode === "file"}
                    onChange={() => setMomInputMode("file")}
                    disabled={generating || savingMom}
                  />
                  Choose file
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    margin: 0,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "#173e77",
                    cursor: generating || savingMom ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="momInputMode"
                    value="paste"
                    checked={momInputMode === "paste"}
                    onChange={() => setMomInputMode("paste")}
                    disabled={generating || savingMom}
                  />
                  Paste transcript
                </label>
              </div>
            </div>

            {/* body — only rendered once a mode is chosen */}
            {momInputMode && (
            <div
              style={{
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* upload row — shown when "Choose file" is selected */}
              {momInputMode === "file" && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <label
                    className="btn ghost small-btn"
                    style={{
                      margin: 0,
                      cursor: generating || savingMom ? "not-allowed" : "pointer",
                    }}
                  >
                    <Icon name="file" size={15} />
                    Choose PDF
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      disabled={generating || savingMom}
                      style={{ display: "none" }}
                    />
                  </label>
                  {uploadFile ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#173e77" }}>
                        {uploadFile.name}
                      </span>
                      <button
                        type="button"
                        className="mt-copy-btn"
                        title="Remove file"
                        aria-label="Remove file"
                        onClick={() => setUploadFile(null)}
                        disabled={generating || savingMom}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      No file selected
                    </span>
                  )}
                </div>
              )}

              {/* paste transcript — shown when "Paste transcript" is selected */}
              {momInputMode === "paste" && (
                <div className="field full" style={{ margin: 0 }}>
                  <label htmlFor="momTranscript">Paste transcript</label>
                  <textarea
                    id="momTranscript"
                    className="mom-textarea"
                    style={{ height: 130 }}
                    placeholder="Paste the meeting transcript here…"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    disabled={generating || savingMom}
                  />
                </div>
              )}

              {/* action */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={generateFromTranscript}
                  disabled={
                    generating ||
                    savingMom ||
                    (!uploadFile && !transcript.trim())
                  }
                >
                  {!generating && <Icon name="sparkle" size={15} />}
                  {generating ? "Generating…" : "Generate Auto MoM"}
                </button>
                {generating && (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Reading the transcript and extracting the MoM…
                  </span>
                )}
              </div>
            </div>
            )}
          </div>

          <div id="mom-form" className="grid" style={{ gridTemplateColumns: "1fr" }}>
            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr", gap: 12 }}
            >
              <div className="field">
                <label htmlFor="momTitle">MoM Title</label>
                <input
                  id="momTitle"
                  value={momForm.title}
                  onChange={(e) => updateMomField("title", e.target.value)}
                  placeholder={meeting.title || "Meeting"}
                />
              </div>
            </div>
            <div className="field full">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <label>Tasks</label>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  onClick={addTaskRow}
                  disabled={savingMom}
                >
                  + Add task
                </button>
              </div>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 160 }}>Task Name</th>
                      <th style={{ minWidth: 220 }}>Task Description</th>
                      <th style={{ minWidth: 150 }}>Start Date</th>
                      <th style={{ minWidth: 150 }}>End Date</th>
                      <th style={{ minWidth: 180 }}>Assigned To</th>
                      <th style={{ minWidth: 130 }}>Priority</th>
                      <th aria-label="Remove" style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {taskRowsDraft.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>
                          No tasks yet. Click “+ Add task” to create one.
                        </td>
                      </tr>
                    ) : (
                      taskRowsDraft.map((detail, index) => (
                        <tr key={`task-row-${index}`}>
                          <td>
                            <input
                              value={detail.taskName || ""}
                              placeholder="Task name"
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "taskName", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={detail.description || ""}
                              placeholder="What needs to be done"
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "description", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              value={detail.startDate || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "startDate", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              value={detail.endDate || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "endDate", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <select
                              value={detail.assignedToUserId || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "assignedToUserId", e.target.value)
                              }
                            >
                              {renderUserOptions(detail.assignedToUserId)}
                            </select>
                          </td>
                          <td>
                            <select
                              value={detail.priority || "MEDIUM"}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "priority", e.target.value)
                              }
                            >
                              <option value="LOW">LOW</option>
                              <option value="MEDIUM">MEDIUM</option>
                              <option value="HIGH">HIGH</option>
                              <option value="CRITICAL">CRITICAL</option>
                            </select>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              className="mt-copy-btn"
                              title="Remove task"
                              aria-label="Remove task"
                              onClick={() => removeTaskRow(index)}
                              disabled={savingMom}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
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
        </div>) : (
        <div ref={taskSectionRef}>
          {momRemote ? (
            <>
              {/* MoM header — a single status control for the whole record. */}
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
                    Minutes of Meeting
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      className="muted"
                      style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".2px" }}
                    >
                      STATUS
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
                            <option key={s} value={s}>{s}</option>
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
                        <StatusBadge status={momRemote.status} />
                        {String(momRemote.status || "").toUpperCase() === "FINALIZED" ? (
                          <span
                            className="muted"
                            style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
                            title="A finalized MoM cannot be edited."
                          >
                            <Icon name="lock" size={13} /> Locked
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            onClick={startStatusEdit}
                          >
                            <Icon name="edit" size={13} /> Edit
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {actionItems.length > 0 ? (
                <div className="card">
                  <div className="card-title">Tasks</div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 160 }}>Task Name</th>
                          <th style={{ minWidth: 240 }}>Task Description</th>
                          <th>Start Date</th>
                          <th>End Date</th>
                          <th>Assigned To</th>
                          <th>Priority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {actionItems.map((a) => (
                          <tr key={a.id}>
                            <td>{a.taskName || "—"}</td>
                            <td>{a.description}</td>
                            <td>{a.startDate ? fmtDate(a.startDate) : "—"}</td>
                            <td>{fmtDate(a.dueDate)}</td>
                            <td>{labelFor(a.assignedToUserId)}</td>
                            <td>{a.priority || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="card no-stripe" style={{ borderStyle: "dashed" }}>
                  <div className="empty-state">No tasks recorded for this MoM.</div>
                </div>
              )}
            </>
          ) : (
            <div className="card no-stripe" style={{ borderStyle: "dashed" }}>
              <div className="empty-state">
                Save the MoM to see tasks here.
              </div>
            </div>
          )}
        </div>)
      }


      {/* ── Section 3: items returned by the MoM API ── */}

      {toastNode}
    </div>
  );
}