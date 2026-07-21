/* ══════════════════════════════════════════════════════════════════
   TicketDetailPage.jsx — single ticket view (/tickets/:ticketId).

   Loads the ticket (GET /ticket-service/tickets/{uuid}) and the workflow
   definition (GET /ticket-service/workflow). The ticket `status` is its
   workflow STAGE, so the "Workflow" panel offers the allowed actions for
   the current stage and PATCHes the ticket with { ticket.action } to move
   it along (see transitionTicket). Each transition acts AS the role the
   action requires (PMIS_ADMIN while OPEN, PMIS_SUPPORT once moving), and
   ASSIGN / REASSIGN carry a dummy assignee (DUMMY_ASSIGNEE) for now.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CATEGORIES, STAGES, stageLabel, priorityLabel } from "../../data/ticketsMock";
import {
  getTicket, getWorkflow, transitionTicket, getEscalationLogs,
} from "../../api/tickets";
import "../../styles/tickets.css";

/* Dummy assignee sent with the ASSIGN / REASSIGN action for now
   (frontend-only placeholder — swap for a real user pick when available). */
const DUMMY_ASSIGNEE = { uuid: "support-001", name: "", email: "amit@pmis.com" };

/* Workflow actions that the backend rejects without a reason/comment. */
const REASON_REQUIRED = new Set(["SEND_BACK"]);

/* The "happy path" a ticket walks through. SENT_BACK / PENDING / CANCELLED
   are detours off this rail and are surfaced separately in the stepper. */
const FLOW = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];

/* Visual weight per workflow action so the panel reads like a real ticket
   queue: one obvious next step, supporting moves quieter, exits in red. */
const ACTION_INTENT = {
  ASSIGN: "primary", REASSIGN: "primary", START: "primary", START_PROGRESS: "primary",
  RESOLVE: "success", CLOSE: "success", APPROVE: "success",
  SEND_BACK: "warn", HOLD: "warn", ON_HOLD: "warn", PENDING: "warn",
  CANCEL: "danger", REJECT: "danger",
};

const catLabel = (code) => CATEGORIES.find((c) => c.code === code)?.label || code || "—";
const slaLabel = (code) => (code ? code.replace(/_/g, " ") : "—");
const humanize = (s) =>
  String(s || "").split(/[_\s-]+/).filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

/* Initials for the assignee / reporter avatar chips. */
const initials = (name) =>
  String(name || "").trim().split(/\s+/).slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase()).join("") || "?";

const Person = ({ person, empty = "Unassigned" }) => {
  if (!person?.name) return <span className="tkt-dmuted">{empty}</span>;
  return (
    <span className="tkt-assignee">
      <span className="tkt-avatar">{initials(person.name)}</span>
      <span>
        {person.name}
        {person.email && <span className="tkt-dmuted"> · {person.email}</span>}
      </span>
    </span>
  );
};

function fmtDateTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try { return new Date(n).toLocaleString("en-IN"); } catch { return "—"; }
}

function normalize(raw) {
  // Tolerate a wrapped response ({ ticket }, { data }) vs a bare object.
  const t = raw?.ticket || raw?.data || raw;
  if (!t) return null;
  return {
    uuid: t.uuid,
    id: t.ticketNumber || t.uuid,
    title: t.title || "",
    description: t.description || "",
    category: t.category || "",
    subCategory: t.subCategory || "",
    priority: t.priority || "",
    status: t.status || "",
    projectName: t.projectName || "",
    activityName: t.activityName || "",
    taskName: t.taskName || "",
    assignee: t.assignee || null,
    reporter: t.reporter || null,
    slaStatus: t.slaStatus || "",
    slaBreached: !!t.slaBreached,
    slaDeadline: t.slaDeadline,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const Badge = ({ cls, children }) => <span className={`tkt-badge ${cls}`}>{children}</span>;

const Row = ({ label, children }) => (
  <div className="tkt-drow">
    <div className="tkt-dlabel">{label}</div>
    <div className="tkt-dval">{children || "—"}</div>
  </div>
);

const Card = ({ title, children }) => (
  <div className="tkt-detail-card">
    {title && <h4 className="tkt-cardtitle">{title}</h4>}
    {children}
  </div>
);

export default function TicketDetailPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();

  const [ticket, setTicket] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [escalations, setEscalations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [comment, setComment] = useState("");
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, wf] = await Promise.all([getTicket(ticketId), getWorkflow()]);
        if (!alive) return;
        setTicket(normalize(t));
        setWorkflow(wf);
        // Escalation logs are best-effort — don't fail the page if they error.
        getEscalationLogs(ticketId)
          .then((logs) => { if (alive) setEscalations(Array.isArray(logs) ? logs : []); })
          .catch(() => { if (alive) setEscalations([]); });
      } catch (e) {
        if (alive) setError(e.message || "Failed to load ticket.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [ticketId]);

  const reload = async () => {
    const t = await getTicket(ticketId);
    setTicket(normalize(t));
  };

  const stateDef = workflow?.states?.find((s) => s.state === ticket?.status);
  const actions = stateDef?.actions || [];
  const reasonNeeded = actions.some((a) => REASON_REQUIRED.has(a.action));

  async function doAction(action) {
    const needsAssignee = action.action === "ASSIGN" || action.action === "REASSIGN";
    // Send-back (and similar) require a reason — enforce it up front so the
    // user gets a clear prompt instead of a raw backend rejection.
    if (REASON_REQUIRED.has(action.action) && !comment.trim()) {
      setError(`Please enter a reason before "${humanize(action.action)}".`);
      return;
    }
    /* Act AS the role the workflow requires for this action. Per the
       backend flow that resolves to PMIS_ADMIN while the ticket is OPEN
       (admin assigns it) and PMIS_SUPPORT once it's moving; fall back to
       that OPEN→ADMIN / else→SUPPORT rule if an action lists no role. */
    const role =
      (Array.isArray(action.roles) && action.roles[0]) ||
      (ticket.status === "OPEN" ? "PMIS_ADMIN" : "PMIS_SUPPORT");
    setError("");
    setBusyAction(action.action);
    try {
      await transitionTicket(ticketId, {
        action: action.action,
        role,
        comment: comment.trim() || undefined,
        assignee: needsAssignee ? DUMMY_ASSIGNEE : undefined,
      });
      setComment("");
      await reload();
    } catch (e) {
      setError(e.message || "Failed to update ticket.");
    } finally {
      setBusyAction("");
    }
  }

  if (loading) {
    return (
      <div className="uidai-pmis-content tkt-page">
        <div className="tkt-empty">Loading ticket…</div>
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div className="uidai-pmis-content tkt-page">
        <nav className="tkt-crumbbar">
          <button type="button" className="tkt-crumb-back" onClick={() => navigate("/tickets")}>
            <span aria-hidden="true">←</span> Tickets
          </button>
        </nav>
        <div className="tkt-err-msg">{error}</div>
      </div>
    );
  }

  return (
    <div className="uidai-pmis-content tkt-page">
      <nav className="tkt-crumbbar">
        <button type="button" className="tkt-crumb-back" onClick={() => navigate("/tickets")}>
          <span aria-hidden="true">←</span> Tickets
        </button>
        <span className="tkt-crumb-sep" aria-hidden="true">/</span>
        <span className="tkt-crumb-cur">{ticket.id}</span>
      </nav>

      {/* Title bar */}
      <div className="tkt-detail-head">
        <div className="tkt-detail-idrow">
          <span className="tkt-id" style={{ fontSize: 16 }}>{ticket.id}</span>
          <Badge cls={`stg-${ticket.status}`}>{stageLabel(ticket.status)}</Badge>
          <Badge cls={`prio-${ticket.priority}`}>{priorityLabel(ticket.priority)}</Badge>
          <Badge cls={`cat-${ticket.category}`}>{catLabel(ticket.category)}</Badge>
          {ticket.slaBreached && <Badge cls="sla-BREACHED">SLA Breached</Badge>}
        </div>
        <div className="tkt-detail-title">{ticket.title}</div>
        <div className="tkt-detail-meta">
          <span><b>Project</b>{ticket.projectName || "—"}</span>
          <span><b>Assignee</b>{ticket.assignee?.name || "Unassigned"}</span>
          <span><b>Updated</b>{fmtDateTime(ticket.updatedAt)}</span>
        </div>
      </div>

      {error && <div className="tkt-err-msg" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="tkt-detail-grid">
        {/* Left — details */}
        <div>
          <Card title="Details">
            <Row label="Category">{catLabel(ticket.category)}{ticket.subCategory ? ` · ${ticket.subCategory}` : ""}</Row>
            <Row label="Project">{ticket.projectName}</Row>
            {/* <Row label="Activity">{ticket.activityName}</Row> */}
            {/* <Row label="Task">{ticket.taskName}</Row> */}
            <Row label="Reporter"><Person person={ticket.reporter} empty="—" /></Row>
            <Row label="Assignee"><Person person={ticket.assignee} /></Row>
            <Row label="Created">{fmtDateTime(ticket.createdAt)}</Row>
            <Row label="Updated">{fmtDateTime(ticket.updatedAt)}</Row>
          </Card>

          <Card title="Description">
            <div className="tkt-detail-desc">{ticket.description || "—"}</div>
          </Card>

          <Card title="Escalations">
            {/* {escalations.length === 0 ? (
              <div className="tkt-sub">No escalations logged.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {escalations.map((e, i) => (
                  <div key={e.uuid || i} style={{ fontSize: 13, color: "#173e77" }}>
                    <strong>{e.level || `L${i + 1}`}</strong> · {e.priority || ""} · {fmtDateTime(e.updatedAt || e.escalatedAt)}
                    {Array.isArray(e.emails) && e.emails.length ? <div className="tkt-sub">{e.emails.join(", ")}</div> : null}
                  </div>
                ))}
              </div>
            )} */}
            <div style={{color:"gray"}}>
              Work In-Progress
            </div>
          </Card>
        </div>

        {/* Right — SLA + assignment + workflow */}
        <div>
          <Card title="SLA">
            <div className={`tkt-sla-banner ${ticket.slaBreached ? "breached" : (ticket.slaStatus || "").toLowerCase()}`}>
              <div className="tkt-sla-banner-lbl">Resolution deadline</div>
              <div className="tkt-sla-banner-val">{fmtDateTime(ticket.slaDeadline)}</div>
              {ticket.slaStatus && (
                <Badge cls={`sla-${ticket.slaStatus}`}>{slaLabel(ticket.slaStatus)}</Badge>
              )}
            </div>
            <Row label="Breached">
              {ticket.slaBreached
                ? <span style={{ color: "#c0392b" }}>Yes</span>
                : <span className="tkt-dmuted">No</span>}
            </Row>
          </Card>

          <Card title="Workflow">
            {/* Stage rail — where the ticket sits on the happy path. */}
            <ol className="tkt-stepper">
              {FLOW.map((code) => {
                const at = FLOW.indexOf(ticket.status);
                const i = FLOW.indexOf(code);
                const state = at < 0 ? "todo" : i < at ? "done" : i === at ? "current" : "todo";
                return (
                  <li key={code} className={`tkt-step ${state}`}>
                    <span className="tkt-step-dot" aria-hidden="true" />
                    <span className="tkt-step-lbl">{stageLabel(code)}</span>
                  </li>
                );
              })}
            </ol>
            {!FLOW.includes(ticket.status) && (
              <div className="tkt-step-off">
                Off the main path — currently{" "}
                <Badge cls={`stg-${ticket.status}`}>{stageLabel(ticket.status)}</Badge>
              </div>
            )}

            <div className="tkt-field" style={{ marginTop: 14 }}>
              <label htmlFor="tkt-comment">
                {reasonNeeded ? "Reason / comment" : "Comment"}
                <span className="tkt-lbl-hint">{reasonNeeded ? "required for Send Back" : "optional"}</span>
              </label>
              <textarea
                id="tkt-comment"
                value={comment}
                placeholder={reasonNeeded ? "Enter a reason…" : "Add a note for this transition…"}
                onChange={(e) => { setComment(e.target.value); if (error) setError(""); }}
              />
            </div>

            {error && <div className="tkt-err-msg" style={{ marginBottom: 6 }}>{error}</div>}

            <div className="tkt-actions-head">Move this ticket</div>
            {actions.length === 0 ? (
              <div className="tkt-sub">No further actions — this stage is terminal.</div>
            ) : (
              <div className="tkt-actionlist">
                {actions.map((a, i) => {
                  const intent = ACTION_INTENT[a.action] || (i === 0 ? "primary" : "neutral");
                  const busy = busyAction === a.action;
                  const roles = Array.isArray(a.roles) ? a.roles.filter(Boolean) : [];
                  return (
                    <button
                      key={a.action}
                      type="button"
                      className={`tkt-action ${intent}${busy ? " busy" : ""}`}
                      disabled={!!busyAction}
                      title={`Moves this ticket to ${stageLabel(a.nextState)}${roles.length ? ` · Role: ${roles.join(", ")}` : ""}`}
                      onClick={() => doAction(a)}
                    >
                      <span className="tkt-action-lbl">{busy ? "Working…" : humanize(a.action)}</span>
                      <span className="tkt-action-next">{stageLabel(a.nextState)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
