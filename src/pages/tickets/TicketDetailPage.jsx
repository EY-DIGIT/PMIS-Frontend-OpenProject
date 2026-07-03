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
import { CATEGORIES, stageLabel, priorityLabel } from "../../data/ticketsMock";
import {
  getTicket, getWorkflow, transitionTicket, getEscalationLogs,
} from "../../api/tickets";
import "../../styles/tickets.css";

/* Dummy assignee sent with the ASSIGN / REASSIGN action for now
   (frontend-only placeholder — swap for a real user pick when available). */
const DUMMY_ASSIGNEE = { uuid: "support-001", name: "Amit Sharma", email: "amit@pmis.com" };

/* Workflow actions that the backend rejects without a reason/comment. */
const REASON_REQUIRED = new Set(["SEND_BACK"]);

const catLabel = (code) => CATEGORIES.find((c) => c.code === code)?.label || code || "—";
const slaLabel = (code) => (code ? code.replace(/_/g, " ") : "—");
const humanize = (s) =>
  String(s || "").split(/[_\s-]+/).filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

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
        <div className="tkt-header tkt-header-actions">
          <button type="button" className="tkt-btn ghost" onClick={() => navigate("/tickets")}>← Back to tickets</button>
        </div>
        <div className="tkt-err-msg">{error}</div>
      </div>
    );
  }

  return (
    <div className="uidai-pmis-content tkt-page">
      <div className="tkt-header tkt-header-actions">
        <button type="button" className="tkt-btn ghost" onClick={() => navigate("/tickets")}>
          ← Back to tickets
        </button>
      </div>

      {/* Title bar */}
      <div className="tkt-detail-head">
        <div className="tkt-detail-idrow">
          <span className="tkt-id" style={{ fontSize: 16 }}>{ticket.id}</span>
          <Badge cls={`prio-${ticket.priority}`}>{priorityLabel(ticket.priority)}</Badge>
          <Badge cls={`stg-${ticket.status}`}>{stageLabel(ticket.status)}</Badge>
          <Badge cls={`cat-${ticket.category}`}>{catLabel(ticket.category)}</Badge>
        </div>
        <div className="tkt-detail-title">{ticket.title}</div>
      </div>

      {error && <div className="tkt-err-msg" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="tkt-detail-grid">
        {/* Left — details */}
        <div>
          <Card title="Details">
            <Row label="Category">{catLabel(ticket.category)}{ticket.subCategory ? ` · ${ticket.subCategory}` : ""}</Row>
            <Row label="Project">{ticket.projectName}</Row>
            <Row label="Activity">{ticket.activityName}</Row>
            <Row label="Task">{ticket.taskName}</Row>
            <Row label="Reporter">
              {ticket.reporter?.name
                ? <>{ticket.reporter.name}{ticket.reporter.email ? <span className="tkt-dmuted"> · {ticket.reporter.email}</span> : null}</>
                : "—"}
            </Row>
            <Row label="Assignee">
              {ticket.assignee?.name
                ? <>{ticket.assignee.name}{ticket.assignee.email ? <span className="tkt-dmuted"> · {ticket.assignee.email}</span> : null}</>
                : <span className="tkt-dmuted">Unassigned</span>}
            </Row>
            <Row label="Created">{fmtDateTime(ticket.createdAt)}</Row>
            <Row label="Updated">{fmtDateTime(ticket.updatedAt)}</Row>
          </Card>

          <Card title="Description">
            <div className="tkt-detail-desc">{ticket.description || "—"}</div>
          </Card>

          <Card title="Escalations">
            {escalations.length === 0 ? (
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
            )}
          </Card>
        </div>

        {/* Right — SLA + assignment + workflow */}
        <div>
          <Card title="SLA">
            <Row label="SLA Health">
              {ticket.slaStatus
                ? <Badge cls={`sla-${ticket.slaStatus}`}>{slaLabel(ticket.slaStatus)}</Badge>
                : "—"}
            </Row>
            <Row label="Deadline">{fmtDateTime(ticket.slaDeadline)}</Row>
            <Row label="Breached">{ticket.slaBreached ? "Yes" : "No"}</Row>
          </Card>

          <Card title="Workflow">
            <div style={{ marginBottom: 10 }}>
              <span className="tkt-sub">Current stage</span>
              <div style={{ marginTop: 4 }}>
                <Badge cls={`stg-${ticket.status}`}>{stageLabel(ticket.status)}</Badge>
              </div>
            </div>

            <div className="tkt-field">
              <label htmlFor="tkt-comment">
                {reasonNeeded ? "Reason / comment (required for Send Back)" : "Comment (optional)"}
              </label>
              <textarea
                id="tkt-comment"
                value={comment}
                placeholder={reasonNeeded ? "Enter a reason…" : "Add a note for this transition…"}
                onChange={(e) => { setComment(e.target.value); if (error) setError(""); }}
              />
            </div>

            {error && <div className="tkt-err-msg" style={{ marginBottom: 6 }}>{error}</div>}

            <div className="tkt-sub" style={{ margin: "6px 0" }}>Available actions</div>
            {actions.length === 0 ? (
              <div className="tkt-sub">No further actions — this stage is terminal.</div>
            ) : (
              <div className="tkt-actions">
                {actions.map((a) => {
                  const isAssign = a.action === "ASSIGN" || a.action === "REASSIGN";
                  const label = isAssign
                    ? `${humanize(a.action)} (${DUMMY_ASSIGNEE.name}) → ${stageLabel(a.nextState)}`
                    : `${humanize(a.action)} → ${stageLabel(a.nextState)}`;
                  return (
                    <button
                      key={a.action}
                      type="button"
                      className="tkt-btn small"
                      disabled={!!busyAction}
                      title={Array.isArray(a.roles) && a.roles.length ? `Role: ${a.roles.join(", ")}` : undefined}
                      onClick={() => doAction(a)}
                    >
                      {busyAction === a.action ? "Working…" : label}
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
