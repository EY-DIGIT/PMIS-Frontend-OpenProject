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
import { getMeeting, getMoM, saveMoM, updateMeeting, momUpdateStatus } from "../../api/meetings";
import { sampleMoM, parseMoM } from "../../data/meetingsMock";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

const STATUS_OPTIONS = ["DRAFT", "IN_REVIEW", "FINALIZED"];

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
function splitDraftLines(text) {
  const raw = String(text || "");
  if (!raw.trim()) return parseLines(raw);
  return raw ? raw.split(/\r?\n/).map((l) => l.replace(/^[-*â€¢]\s*/, "")) : [];
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
function datetimeInputValue(value) {
  return value ? String(value).slice(0, 16) : "";
}
function toApiDateTime(value) {
  return value ? new Date(value).toISOString() : undefined;
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);

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
                assignedToUserId: a?.assignedToUserId || "",
                startDate: a?.startDate || "",
                dueDate: a?.dueDate || "",
                endDate: a?.endDate || a?.dueDate || "",
                priority: a?.priority || "MEDIUM",
                status: a?.status || "OPEN",
                linkedTaskId: a?.linkedTaskId ?? "",
                linkedMilestoneId: a?.linkedMilestoneId ?? "",
                linkedTicketId: a?.linkedTicketId || "",
                linkedActivityId: a?.linkedActivityId || "",
                commentId: a?.comments?.[0]?.id ?? "",
                commentParentId: a?.comments?.[0]?.parentId ?? "",
                commentAuthorUserId: a?.comments?.[0]?.authorUserId || "",
                commentContent: a?.comments?.[0]?.content || "",
                commentCreatedAt: datetimeInputValue(a?.comments?.[0]?.createdAt),
                extensionRequestId: a?.extensionRequests?.[0]?.id ?? "",
                extensionActionItemId: a?.extensionRequests?.[0]?.actionItemId ?? "",
                previousDueDate: a?.extensionRequests?.[0]?.previousDueDate || "",
                requestedDueDate: a?.extensionRequests?.[0]?.requestedDueDate || "",
                extensionJustification: a?.extensionRequests?.[0]?.justification || "",
                extensionStatus: a?.extensionRequests?.[0]?.status || "PENDING",
                requestedByUserId: a?.extensionRequests?.[0]?.requestedByUserId || "",
                requestedAt: datetimeInputValue(a?.extensionRequests?.[0]?.requestedAt),
                decidedByUserId: a?.extensionRequests?.[0]?.decidedByUserId || "",
                decisionComment: a?.extensionRequests?.[0]?.decisionComment || "",
                decidedAt: datetimeInputValue(a?.extensionRequests?.[0]?.decidedAt),
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
  const updateMomLine = (field, index, value) =>
    setMomForm((f) => {
      const lines = splitDraftLines(f[field]);
      lines[index] = value;
      return { ...f, [field]: joinLines(lines) };
    });
  const addMomLine = (field, detailField, label, defaults = {}) =>
    setMomForm((f) => ({
      ...f,
      [field]: joinLines([...splitDraftLines(f[field]), label]),
      [detailField]: [...(f[detailField] || []), defaults],
    }));
  const removeMomLine = (field, detailField, index) =>
    setMomForm((f) => {
      const lines = splitDraftLines(f[field]).filter((_, i) => i !== index);
      const details = (f[detailField] || []).filter((_, i) => i !== index);
      return { ...f, [field]: joinLines(lines), [detailField]: details };
    });

  /* Drop a canned MoM block into the three textareas so the user can
     test the form without typing the whole thing. Mirrors the helper
     from the pre-API HTML reference; doesn't touch the server. */
  const loadSample = () => {
    if (!meeting) return;
    setMomForm((f) => ({
      ...f,
      ...parseMoM(sampleMoM(meeting)),
      title: f.title || meeting.title || "",
      templateId: f.templateId || "1",
    }));
    show("Sample MoM loaded.", "ok");
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
      setMomForm((f) => ({
        ...f,
        ...parsed,
        title: f.title || meeting?.title || "",
        templateId: f.templateId || "1",
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
    const actionRows = splitDraftLines(momForm.actions)
      .map((description, index) => ({ description: description.trim(), index }))
      .filter((row) => {
        const detail = momForm.actionDetails?.[row.index] || {};
        return row.description || detail.taskName || detail.assignedToUserId || detail.startDate || detail.endDate || detail.priority;
      });
    if (!actionRows.length) {
      show("Add at least one task row.", "warn");
      return;
    }
    const fallbackOwner =
      meeting.attendees?.[0]?.userId || users[0]?.userId || null;
    const due = addDaysISO(meeting.meetingDate, 7);
    const generatedContent = `Tasks:\n${actionRows.map(({ description, index }) => {
      const detail = momForm.actionDetails?.[index] || {};
      return [
        `- ${detail.taskName || "Untitled task"}`,
        description ? `Description: ${description}` : "",
        detail.startDate ? `Start: ${detail.startDate}` : "",
        detail.endDate || detail.dueDate ? `End: ${detail.endDate || detail.dueDate}` : "",
        detail.assignedToUserId ? `Assigned: ${labelFor(detail.assignedToUserId)}` : "",
        detail.priority ? `Priority: ${detail.priority}` : "",
      ].filter(Boolean).join(" | ");
    }).join("\n")}`;
    const body = {
      title: momForm.title?.trim() || meeting.title || "Meeting",
      templateId: numberOrUndefined(momForm.templateId) ?? 1,
      content: momForm.content?.trim() || generatedContent,
      status: momRemote?.status || "DRAFT",
      decisions: [],
      actionItems: actionRows.map(({ description, index }) => {
        const detail = momForm.actionDetails?.[index] || {};
        return cleanPayload({
          id: numberOrUndefined(detail.id),
          momId: numberOrUndefined(detail.momId),
          description: description || detail.taskName || "Untitled task",
          assignedToUserId: detail.assignedToUserId || fallbackOwner,
          dueDate: detail.endDate || detail.dueDate || due,
          status: detail.status || "OPEN",
          linkedTaskId: numberOrUndefined(detail.linkedTaskId),
          linkedMilestoneId: numberOrUndefined(detail.linkedMilestoneId),
          linkedTicketId: detail.linkedTicketId,
          linkedActivityId: detail.linkedActivityId,
          comments: [],
          extensionRequests: [],
        });
      }),
      risks: [],
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

  const decisions = momRemote?.decisions || [];
  const actionItems = momRemote?.actionItems || [];
  const risks = momRemote?.risks || [];
  const decisionDrafts = splitDraftLines(momForm.decisions);
  const actionDrafts = splitDraftLines(momForm.actions);
  const riskDrafts = splitDraftLines(momForm.risks);
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
              borderRadius: 12,
              border: "1px solid #dfe7f1",
              background: "linear-gradient(180deg,#f6faff 0%,#fbfdff 100%)",
              overflow: "hidden",
            }}
          >
            {/* header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
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
                  background: "#eaf1fb",
                  fontSize: 16,
                }}
              >
                ✨
              </span>
              <div style={{ lineHeight: 1.3 }}>
                <div style={{ fontWeight: 700, color: "#173e77" }}>
                  Generate Auto MoM
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Upload a PDF transcript or paste the text — it fills
                  Decisions, Action Items &amp; Risks below for you to review.
                </div>
              </div>
            </div>

            {/* body */}
            <div
              style={{
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* upload row */}
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
                  📄 Choose PDF
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

              {/* divider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "#9aa7bd",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span style={{ flex: 1, height: 1, background: "#e6ecf5" }} />
                OR
                <span style={{ flex: 1, height: 1, background: "#e6ecf5" }} />
              </div>

              {/* paste transcript */}
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
                  {generating ? "Generating…" : "✨ Generate Auto MoM"}
                </button>
                {generating ? (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Reading the transcript and extracting the MoM…
                  </span>
                ) : (
                  <span
                    className="muted"
                    style={{ fontSize: 12, marginLeft: "auto" }}
                  >
                    A selected PDF takes priority over pasted text.
                  </span>
                )}
              </div>
            </div>
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
              <label htmlFor="momContent">Content</label>
              <textarea
                id="momContent"
                className="mom-textarea"
                style={{ height: 110 }}
                placeholder="Optional MoM summary. If blank, it will be generated from the sections below."
                value={momForm.content}
                onChange={(e) => updateMomField("content", e.target.value)}
              />
            </div>
            <div className="field full">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <label>Decisions</label>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  onClick={() => addMomLine("decisions", "decisionDetails", "New decision", {})}
                  disabled={savingMom}
                >
                  + Add decision
                </button>
              </div>
              {decisionDrafts.length > 0 && (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {decisionDrafts.map((description, index) => {
                    const detail = momForm.decisionDetails?.[index] || {};
                    return (
                      <div
                        key={`decision-detail-${index}`}
                        style={{
                          border: "1px solid #dfe7f1",
                          borderRadius: 8,
                          padding: 12,
                          background: "#fbfdff",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            marginBottom: 8,
                          }}
                        >
                          <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
                            Decision {index + 1}
                          </div>
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            onClick={() => removeMomLine("decisions", "decisionDetails", index)}
                            disabled={savingMom}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="field full" style={{ margin: "0 0 10px" }}>
                          <label>Description</label>
                          <textarea
                            className="mom-textarea"
                            style={{ height: 80 }}
                            value={description}
                            onChange={(e) => updateMomLine("decisions", index, e.target.value)}
                          />
                        </div>
                        <div
                          className="grid"
                          style={{ gridTemplateColumns: "minmax(220px, 1fr)", gap: 10 }}
                        >
                          <div className="field" style={{ margin: 0 }}>
                            <label>Owner</label>
                            <select
                              value={detail.ownerUserId || ""}
                              onChange={(e) =>
                                updateMomDetail("decisionDetails", index, "ownerUserId", e.target.value)
                              }
                            >
                              {renderUserOptions(detail.ownerUserId)}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="field full">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <label>Action Items</label>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  onClick={() =>
                    addMomLine("actions", "actionDetails", "New action item", {
                      status: "OPEN",
                    })
                  }
                  disabled={savingMom}
                >
                  + Add action
                </button>
              </div>
              {actionDrafts.length > 0 && (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {actionDrafts.map((description, index) => {
                    const detail = momForm.actionDetails?.[index] || {};
                    return (
                      <div
                        key={`action-detail-${index}`}
                        style={{
                          border: "1px solid #dfe7f1",
                          borderRadius: 8,
                          padding: 12,
                          background: "#fbfdff",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            marginBottom: 8,
                          }}
                        >
                          <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
                            Action {index + 1}
                          </div>
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            onClick={() => removeMomLine("actions", "actionDetails", index)}
                            disabled={savingMom}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="field full" style={{ margin: "0 0 10px" }}>
                          <label>Description</label>
                          <textarea
                            className="mom-textarea"
                            style={{ height: 80 }}
                            value={description}
                            onChange={(e) => updateMomLine("actions", index, e.target.value)}
                          />
                        </div>
                        <div
                          className="grid"
                          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}
                        >
                          <div className="field" style={{ margin: 0 }}>
                            <label>Assigned To</label>
                            <select
                              value={detail.assignedToUserId || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "assignedToUserId", e.target.value)
                              }
                            >
                              {renderUserOptions(detail.assignedToUserId)}
                            </select>
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Due Date</label>
                            <input
                              type="date"
                              value={detail.dueDate || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "dueDate", e.target.value)
                              }
                            />
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Status</label>
                            <select
                              value={detail.status || "OPEN"}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "status", e.target.value)
                              }
                            >
                              <option value="OPEN">OPEN</option>
                              <option value="IN_PROGRESS">IN_PROGRESS</option>
                              <option value="DONE">DONE</option>
                              <option value="CANCELLED">CANCELLED</option>
                            </select>
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Linked Task ID</label>
                            <input
                              type="number"
                              value={detail.linkedTaskId ?? ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "linkedTaskId", e.target.value)
                              }
                            />
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Linked Milestone ID</label>
                            <input
                              type="number"
                              value={detail.linkedMilestoneId ?? ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "linkedMilestoneId", e.target.value)
                              }
                            />
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Linked Ticket ID</label>
                            <input
                              value={detail.linkedTicketId || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "linkedTicketId", e.target.value)
                              }
                            />
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Linked Activity ID</label>
                            <input
                              value={detail.linkedActivityId || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "linkedActivityId", e.target.value)
                              }
                            />
                          </div>
                        </div>
                        <div
                          style={{
                            marginTop: 12,
                            paddingTop: 12,
                            borderTop: "1px solid #e6ecf5",
                          }}
                        >
                          <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                            Comment
                          </div>
                          <div
                            className="grid"
                            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}
                          >
                            <div className="field" style={{ margin: 0 }}>
                              <label>Author</label>
                              <select
                                value={detail.commentAuthorUserId || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "commentAuthorUserId", e.target.value)
                                }
                              >
                                {renderUserOptions(detail.commentAuthorUserId)}
                              </select>
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Created At</label>
                              <input
                                type="datetime-local"
                                value={detail.commentCreatedAt || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "commentCreatedAt", e.target.value)
                                }
                              />
                            </div>
                          </div>
                          <div className="field full" style={{ margin: "10px 0 0" }}>
                            <label>Comment Content</label>
                            <input
                              value={detail.commentContent || ""}
                              onChange={(e) =>
                                updateMomDetail("actionDetails", index, "commentContent", e.target.value)
                              }
                            />
                          </div>
                        </div>
                        <div
                          style={{
                            marginTop: 12,
                            paddingTop: 12,
                            borderTop: "1px solid #e6ecf5",
                          }}
                        >
                          <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                            Extension Request
                          </div>
                          <div
                            className="grid"
                            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}
                          >
                            <div className="field" style={{ margin: 0 }}>
                              <label>Previous Due Date</label>
                              <input
                                type="date"
                                value={detail.previousDueDate || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "previousDueDate", e.target.value)
                                }
                              />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Requested Due Date</label>
                              <input
                                type="date"
                                value={detail.requestedDueDate || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "requestedDueDate", e.target.value)
                                }
                              />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Status</label>
                              <select
                                value={detail.extensionStatus || "PENDING"}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "extensionStatus", e.target.value)
                                }
                              >
                                <option value="PENDING">PENDING</option>
                                <option value="APPROVED">APPROVED</option>
                                <option value="REJECTED">REJECTED</option>
                              </select>
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Requested By</label>
                              <select
                                value={detail.requestedByUserId || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "requestedByUserId", e.target.value)
                                }
                              >
                                {renderUserOptions(detail.requestedByUserId)}
                              </select>
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Requested At</label>
                              <input
                                type="datetime-local"
                                value={detail.requestedAt || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "requestedAt", e.target.value)
                                }
                              />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Decided By</label>
                              <select
                                value={detail.decidedByUserId || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "decidedByUserId", e.target.value)
                                }
                              >
                                {renderUserOptions(detail.decidedByUserId)}
                              </select>
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Decided At</label>
                              <input
                                type="datetime-local"
                                value={detail.decidedAt || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "decidedAt", e.target.value)
                                }
                              />
                            </div>
                          </div>
                          <div
                            className="grid"
                            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}
                          >
                            <div className="field" style={{ margin: 0 }}>
                              <label>Justification</label>
                              <input
                                value={detail.extensionJustification || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "extensionJustification", e.target.value)
                                }
                              />
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label>Decision Comment</label>
                              <input
                                value={detail.decisionComment || ""}
                                onChange={(e) =>
                                  updateMomDetail("actionDetails", index, "decisionComment", e.target.value)
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="field full">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <label>Risks</label>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  onClick={() =>
                    addMomLine("risks", "riskDetails", "New risk", {
                      severity: "LOW",
                    })
                  }
                  disabled={savingMom}
                >
                  + Add risk
                </button>
              </div>
              {riskDrafts.length > 0 && (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {riskDrafts.map((description, index) => {
                    const detail = momForm.riskDetails?.[index] || {};
                    return (
                      <div
                        key={`risk-detail-${index}`}
                        style={{
                          border: "1px solid #dfe7f1",
                          borderRadius: 8,
                          padding: 12,
                          background: "#fbfdff",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            marginBottom: 8,
                          }}
                        >
                          <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
                            Risk {index + 1}
                          </div>
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            onClick={() => removeMomLine("risks", "riskDetails", index)}
                            disabled={savingMom}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="field full" style={{ margin: "0 0 10px" }}>
                          <label>Description</label>
                          <textarea
                            className="mom-textarea"
                            style={{ height: 80 }}
                            value={description}
                            onChange={(e) => updateMomLine("risks", index, e.target.value)}
                          />
                        </div>
                        <div
                          className="grid"
                          style={{ gridTemplateColumns: "150px minmax(220px, 1fr)", gap: 10 }}
                        >
                          <div className="field" style={{ margin: 0 }}>
                            <label>Severity</label>
                            <select
                              value={detail.severity || "LOW"}
                              onChange={(e) =>
                                updateMomDetail("riskDetails", index, "severity", e.target.value)
                              }
                            >
                              <option value="LOW">LOW</option>
                              <option value="MEDIUM">MEDIUM</option>
                              <option value="HIGH">HIGH</option>
                              <option value="CRITICAL">CRITICAL</option>
                            </select>
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Owner</label>
                            <select
                              value={detail.ownerUserId || ""}
                              onChange={(e) =>
                                updateMomDetail("riskDetails", index, "ownerUserId", e.target.value)
                              }
                            >
                              {renderUserOptions(detail.ownerUserId)}
                            </select>
                          </div>
                        </div>
                        <div className="field full" style={{ margin: "10px 0 0" }}>
                          <label>Mitigation</label>
                          <input
                            value={detail.mitigation || ""}
                            onChange={(e) =>
                              updateMomDetail("riskDetails", index, "mitigation", e.target.value)
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                            🔒 Locked
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            onClick={startStatusEdit}
                          >
                            ✎ Edit
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

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
                          {/* <th>Status</th> */}
                        </tr>
                      </thead>
                      <tbody>
                        {actionItems.map((a) => (
                          <tr key={a.id}>
                            <td>{a.description}</td>
                            <td>{labelFor(a.assignedToUserId)}</td>
                            <td>{fmtDate(a.dueDate)}</td>
                            {/* <td>
                              <ActionStatusBadge status={a.status} />
                            </td> */}
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
        </div>)
      }


      {/* ── Section 3: items returned by the MoM API ── */}

      {toastNode}
    </div>
  );
}
