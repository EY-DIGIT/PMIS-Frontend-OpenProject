/* ══════════════════════════════════════════════════════════════════
   MeetingDetailPage.jsx — port of `showMeetingDetail()` in the HTML
   reference. Three-section page:
     1. Meeting info card (badges, attendees, agenda).
     2. MoM editor with Save / Load Sample / Summarize → Tasks.
        Summarize runs a simulated n8n workflow that scrolls through
        4 progress steps, then proposes action items.
     3. Task section:
        - while proposed items exist, show the review table with edit
          rows + Confirm/Discard buttons.
        - else if confirmed action items exist, show the read-only list
          with per-item status select + collapsible comments.
        - else show an empty card.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getMeeting,
  updateMeeting,
  userById,
  activitiesOf,
  activityName,
  USERS,
  ORG_OPTIONS,
  AIS_META,
  TODAY,
  fmtDate,
  fmtDateShort,
  fmtDuration,
  initials,
  isOverdue,
  extractActionItems,
  sampleMoM,
  parseMoM,
  composeMoM
} from "../../data/meetingsMock";
import {
  TypeBadge,
  StatusBadge,
  LinkPill,
  useToast
} from "./_shared";
import "../../styles/meetings.css";

const SUMM_STEPS = [
  "Connecting to n8n workflow “MoM → Action Items”…",
  "Aadhaar Genius parsing minutes (decisions, actions, risks)…",
  "Identifying owners and target dates…",
  "Mapping action items to PMIS tasks…"
];

/* Compact info tile used for date / time / location / division / partner. */
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

/* Render the location field as a clickable link when it looks like a
   URL, otherwise as plain text. Keeps copy-on-click parity with the
   prior plain-text rendering while making Teams / Meet links obvious. */
function renderLocation(loc) {
  const s = String(loc || "").trim();
  if (!s) return "—";
  if (/^https?:\/\//i.test(s)) {
    return (
      <a href={s} target="_blank" rel="noopener noreferrer">
        {s}
      </a>
    );
  }
  return s;
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [meeting, setMeeting] = useState(() => getMeeting(id));
  /* MoM is captured as a structured form (Decisions / Actions / Risks)
     and serialized to the canonical block format when saved or fed to
     the AI extractor. */
  const [momForm, setMomForm] = useState(() => parseMoM(meeting?.mom || ""));
  const [proposed, setProposed] = useState(null);
  const [run, setRun] = useState({ active: false, stepIdx: 0, done: false, count: 0 });
  const [openComments, setOpenComments] = useState({});
  const [commentDraft, setCommentDraft] = useState({});
  const taskSectionRef = useRef(null);

  const momText = useMemo(() => composeMoM(momForm), [momForm]);

  /* Re-pull from store if the route param changes. */
  useEffect(() => {
    const m = getMeeting(id);
    setMeeting(m);
    setMomForm(parseMoM(m?.mom || ""));
    setProposed(null);
    setRun({ active: false, stepIdx: 0, done: false, count: 0 });
  }, [id]);

  /* Drive the simulated n8n progress. Each step is ~720ms. The effect
     does nothing while `meeting` is null (route param doesn't match) so
     it's safe to mount above the early-return. */
  useEffect(() => {
    if (!meeting || !run.active || run.done) return undefined;
    if (run.stepIdx < SUMM_STEPS.length - 1) {
      const t = setTimeout(
        () => setRun((s) => ({ ...s, stepIdx: s.stepIdx + 1 })),
        720
      );
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      const items = extractActionItems(momText, meeting);
      setProposed(items);
      setRun({ active: false, stepIdx: SUMM_STEPS.length - 1, done: true, count: items.length });
      setTimeout(() => {
        taskSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, 50);
    }, 720);
    return () => clearTimeout(t);
  }, [run.active, run.stepIdx, run.done, momText, meeting]);

  const proposedActivities = useMemo(
    () =>
      meeting && meeting.link === "project"
        ? activitiesOf(meeting.projectId)
        : [],
    [meeting]
  );

  if (!meeting) {
    return (
      <div className="pmis-mtg">
        <div className="page-header">
          <div>
            <div className="pm-title">Meeting not found</div>
            <div className="pm-subtitle">{id}</div>
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

  const updateMomField = (key, value) =>
    setMomForm((f) => ({ ...f, [key]: value }));

  const togglePresent = (key) => {
    const current = meeting.present || [];
    const next = current.includes(key)
      ? current.filter((x) => x !== key)
      : current.concat(key);
    const updated = updateMeeting(meeting.id, { present: next });
    setMeeting(updated);
  };

  const saveMoM = () => {
    const next = updateMeeting(meeting.id, { mom: momText });
    setMeeting(next);
    show("MoM saved.", "ok");
  };

  const loadSample = () => {
    const txt = sampleMoM(meeting);
    setMomForm(parseMoM(txt));
    show("Sample MoM loaded.", "ok");
  };

  const summarize = () => {
    if (!momText.trim()) {
      show("Add some minutes first, or load the sample MoM.", "warn");
      return;
    }
    /* Persist whatever's in the editor before kicking off the run. */
    updateMeeting(meeting.id, { mom: momText });
    setRun({ active: true, stepIdx: 0, done: false, count: 0 });
  };

  const reSummarize = () => {
    document
      .getElementById("mom-form")
      ?.scrollIntoView?.({ behavior: "smooth" });
    summarize();
  };

  const proEdit = (i, k, v) =>
    setProposed((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const proSyncOrg = (i) =>
    setProposed((arr) =>
      arr.map((it, idx) => {
        if (idx !== i) return it;
        const u = userById(it.ownerId);
        return u ? { ...it, assignedOrg: u.org } : it;
      })
    );

  const proRemove = (i) => {
    setProposed((arr) => {
      const next = arr.filter((_, idx) => idx !== i);
      return next.length ? next : null;
    });
  };

  const addProposedRow = () => {
    setProposed((arr) => {
      const list = arr || [];
      const u = USERS[0];
      return list.concat({
        id: "PRO-" + (list.length + 1),
        text: "",
        ownerId: u.id,
        assignedOrg: u.org,
        target:
          meeting.date
            ? new Date(
                new Date(meeting.date + "T00:00:00").getTime() +
                  7 * 86400000
              )
                .toISOString()
                .slice(0, 10)
            : TODAY,
        status: "Open",
        activityId:
          meeting.link === "project" && meeting.activityIds.length
            ? meeting.activityIds[0]
            : null,
        comments: []
      });
    });
  };

  const confirmTasks = () => {
    const valid = (proposed || []).filter((it) => it.text.trim());
    if (!valid.length) {
      show("Add at least one action item.", "warn");
      return;
    }
    let n = meeting.actionItems.length;
    const newItems = valid.map((it) => {
      n++;
      return {
        id: "AI-" + n,
        text: it.text.trim(),
        ownerId: it.ownerId,
        assignedOrg: it.assignedOrg,
        target: it.target,
        status: isOverdue(it) ? "Delayed" : "Open",
        activityId: meeting.link === "project" ? it.activityId : null,
        comments: []
      };
    });
    const next = updateMeeting(meeting.id, {
      actionItems: meeting.actionItems.concat(newItems),
      status: "Tasks Created"
    });
    setMeeting(next);
    setProposed(null);
    setRun({ active: false, stepIdx: 0, done: false, count: 0 });
    show(`${valid.length} task${valid.length > 1 ? "s" : ""} created.`, "ok");
  };

  const discardProposed = () => {
    setProposed(null);
    setRun({ active: false, stepIdx: 0, done: false, count: 0 });
  };

  const setItemStatus = (aid, val) => {
    const updated = meeting.actionItems.map((a) =>
      a.id === aid ? { ...a, status: val } : a
    );
    const next = updateMeeting(meeting.id, { actionItems: updated });
    setMeeting(next);
  };

  const toggleCommentsRow = (aid) =>
    setOpenComments((o) => ({ ...o, [aid]: !o[aid] }));

  const postComment = (aid) => {
    const text = (commentDraft[aid] || "").trim();
    if (!text) return;
    const updated = meeting.actionItems.map((a) =>
      a.id === aid
        ? {
            ...a,
            comments: a.comments.concat({
              by: "You",
              t: fmtDateShort(TODAY),
              text
            })
          }
        : a
    );
    const next = updateMeeting(meeting.id, { actionItems: updated });
    setMeeting(next);
    setCommentDraft((d) => ({ ...d, [aid]: "" }));
  };

  const confirmedDone = meeting.actionItems.filter((a) => a.status === "Completed").length;
  const confirmedOverdue =
    meeting.actionItems.filter(isOverdue).length ||
    meeting.actionItems.filter((a) => a.status === "Delayed").length;

  return (
    <div className="pmis-mtg">
      <div className="page-header">
        <div>
          <div className="pm-title">{meeting.title}</div>
          <div className="pm-subtitle">{meeting.id}</div>
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
          <TypeBadge type={meeting.type} />
          <StatusBadge status={meeting.status} />
          <LinkPill meeting={meeting} />
        </div>

        <div className="mt-info-grid">
          <InfoTile icon="📅" label="Date" value={fmtDate(meeting.date)} />
          <InfoTile
            icon="🕐"
            label="Time (IST)"
            value={`${meeting.start || "—"} – ${meeting.end || "—"}`}
          />
          {fmtDuration(meeting.start, meeting.end) && (
            <InfoTile
              icon="⏱️"
              label="Duration"
              value={fmtDuration(meeting.start, meeting.end)}
            />
          )}
          <InfoTile
            icon="📍"
            label="Location / Link"
            value={renderLocation(meeting.location)}
          />
        </div>

        {meeting.link === "project" && (
          <>
            <div className="mt-section-label">Activities</div>
            <div className="attendee-chips">
              {meeting.activityIds.length === 0 ? (
                <span className="mt-empty-people">No activities linked.</span>
              ) : (
                meeting.activityIds.map((aid) => (
                  <span key={aid} className="chip">
                    {activityName(meeting.projectId, aid)}{" "}
                    <span className="sub">{aid}</span>
                  </span>
                ))
              )}
            </div>
          </>
        )}

        {meeting.agenda && (
          <>
            <div className="mt-section-label">Agenda</div>
            <div className="mt-agenda">{meeting.agenda}</div>
          </>
        )}

        <div className="mt-section-label">
          Attendance{" "}
          <span className="muted" style={{ fontWeight: 500, fontSize: 12.5 }}>
            (tick whoever was present)
          </span>
        </div>
        <div className="mt-attendance">
          {(() => {
            const internal = (meeting.attendees || []).map((uid) => {
              const u = userById(uid);
              return {
                key: uid,
                label: u ? u.name : uid,
                sub: u ? `${u.org}${u.division ? " · " + u.division : ""}` : "Internal",
                kind: "int"
              };
            });
            const external = (meeting.external || []).map((v) => ({
              key: v,
              label: v,
              sub: "External",
              kind: "ext"
            }));
            const rows = internal.concat(external);
            const presentCount = rows.filter((r) =>
              (meeting.present || []).includes(r.key)
            ).length;
            if (rows.length === 0) {
              return <div className="mt-empty-people">No attendees added.</div>;
            }
            return (
              <>
                <div className="mt-attendance__head">
                  <span>
                    {presentCount}/{rows.length} present
                  </span>
                </div>
                <div className="mt-attendance__grid">
                  {rows.map((r) => {
                    const checked = (meeting.present || []).includes(r.key);
                    return (
                      <label
                        key={r.kind + ":" + r.key}
                        className={`mt-attendance__row${checked ? " is-present" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePresent(r.key)}
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
            );
          })()}
        </div>
      </div>

      {/* ── Section 2: MoM editor ── */}
      <div className="card">
        <div className="card-title">Minutes of Meeting</div>
        <div className="mom-tools">
          <button
            type="button"
            className="btn ghost small-btn"
            onClick={loadSample}
          >
            Load sample
          </button>
          <button
            type="button"
            className="btn ghost small-btn"
            onClick={saveMoM}
          >
            Save
          </button>
        </div>
        <div id="mom-form" className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="field full">
            <label htmlFor="momDecisions">Decisions</label>
            <textarea
              id="momDecisions"
              className="mom-textarea"
              style={{ height: 130 }}
              placeholder={"One decision per line.\ne.g. Proceed with planned scope; no baseline change this cycle."}
              value={momForm.decisions}
              onChange={(e) => updateMomField("decisions", e.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="momActions">
              Action Items{" "}
              <span className="muted">(used by the AI to extract tasks)</span>
            </label>
            <textarea
              id="momActions"
              className="mom-textarea"
              style={{ height: 170 }}
              placeholder={
                "One action per line.\ne.g. R. Kumar to confirm UAT environment readiness by 20-May."
              }
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
              placeholder={"One risk per line.\ne.g. Dependency on third-party sign-off may slip the timeline."}
              value={momForm.risks}
              onChange={(e) => updateMomField("risks", e.target.value)}
            />
          </div>
        </div>

        <div className="ai-banner">
          <div className="txt">
            Held in MS Teams / Google Meet. Record the MoM, then summarize into tasks.
          </div>
          <button
            type="button"
            className="btn-ai"
            onClick={summarize}
            disabled={run.active}
          >
            Summarize → Tasks
          </button>
        </div>

        {run.active && (
          <>
            <div className="run-status">
              <span className="spinner" aria-hidden="true" />
              <span>{SUMM_STEPS[run.stepIdx]}</span>
            </div>
            <div className="run-step">
              Step {run.stepIdx + 1} of {SUMM_STEPS.length}
            </div>
          </>
        )}
        {!run.active && run.done && (
          <div className="run-status" style={{ color: "#15795b" }}>
            ✓ {run.count} task{run.count !== 1 ? "s" : ""} proposed
          </div>
        )}
      </div>

      {/* ── Section 3: tasks ── */}
      <div ref={taskSectionRef}>
        {proposed && proposed.length > 0 ? (
          <div className="card">
            <div className="card-title">
              Proposed Tasks{" "}
              <span className="badge ai-progress" style={{ verticalAlign: "middle" }}>
                AI
              </span>
            </div>
            <div className="table-wrap">
              <table className="table review-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 240 }}>Action item</th>
                    <th>Owner</th>
                    <th>Assigned</th>
                    <th>Target date</th>
                    {meeting.link === "project" && <th>Activity</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {proposed.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <input
                          type="text"
                          value={it.text}
                          onChange={(e) => proEdit(idx, "text", e.target.value)}
                        />
                        {isOverdue(it) && (
                          <div className="flag-overdue">⚠ overdue</div>
                        )}
                      </td>
                      <td>
                        <select
                          value={it.ownerId}
                          onChange={(e) => {
                            proEdit(idx, "ownerId", e.target.value);
                            setTimeout(() => proSyncOrg(idx), 0);
                          }}
                        >
                          {USERS.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={it.assignedOrg}
                          onChange={(e) =>
                            proEdit(idx, "assignedOrg", e.target.value)
                          }
                        >
                          {ORG_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="date"
                          value={it.target}
                          onChange={(e) => proEdit(idx, "target", e.target.value)}
                        />
                      </td>
                      {meeting.link === "project" && (
                        <td>
                          <select
                            value={it.activityId || ""}
                            onChange={(e) =>
                              proEdit(idx, "activityId", e.target.value)
                            }
                          >
                            {proposedActivities.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td>
                        <button
                          type="button"
                          className="chip-remove"
                          title="Remove"
                          style={{ fontSize: 18 }}
                          onClick={() => proRemove(idx)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={confirmTasks}>
                Create {proposed.length} Task{proposed.length > 1 ? "s" : ""}
              </button>
              <button
                type="button"
                className="btn ghost small-btn"
                onClick={addProposedRow}
              >
                + Add
              </button>
              <button
                type="button"
                className="btn cancel"
                onClick={discardProposed}
              >
                Discard
              </button>
            </div>
          </div>
        ) : meeting.actionItems.length > 0 ? (
          <div className="card">
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                marginBottom: 10
              }}
            >
              <div className="card-title" style={{ margin: 0 }}>
                Tasks
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-soft)",
                  fontWeight: 600
                }}
              >
                {confirmedDone}/{meeting.actionItems.length} done
                {confirmedOverdue > 0 && (
                  <span style={{ color: "var(--red)" }}>
                    {" "}
                    · {confirmedOverdue} overdue
                  </span>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 240 }}>Action item</th>
                    <th>Owner</th>
                    <th>Assigned</th>
                    <th>Target</th>
                    <th>Status</th>
                    {meeting.link === "project" && <th>Activity</th>}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {meeting.actionItems.map((a) => {
                    const u = userById(a.ownerId);
                    const colSpan = meeting.link === "project" ? 7 : 6;
                    return (
                      <React.Fragment key={a.id}>
                        <tr>
                          <td>
                            {a.text}
                            {isOverdue(a) && (
                              <div className="flag-overdue">⚠ overdue</div>
                            )}
                          </td>
                          <td>
                            {u ? u.name : a.ownerId}
                            <div className="muted">
                              {u ? u.division || u.role : ""}
                            </div>
                          </td>
                          <td>{a.assignedOrg}</td>
                          <td>{fmtDate(a.target)}</td>
                          <td>
                            <select
                              value={a.status}
                              onChange={(e) => setItemStatus(a.id, e.target.value)}
                            >
                              {Object.keys(AIS_META).map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </td>
                          {meeting.link === "project" && (
                            <td>{activityName(meeting.projectId, a.activityId)}</td>
                          )}
                          <td>
                            <button
                              type="button"
                              className="btn ghost small-btn"
                              onClick={() => toggleCommentsRow(a.id)}
                            >
                              Notes ({a.comments.length})
                            </button>
                          </td>
                        </tr>
                        {openComments[a.id] && (
                          <tr>
                            <td colSpan={colSpan}>
                              <div className="comments">
                                {a.comments.length === 0 ? (
                                  <div
                                    className="muted"
                                    style={{ marginBottom: 6 }}
                                  >
                                    No comments yet.
                                  </div>
                                ) : (
                                  a.comments.map((c, i) => (
                                    <div className="comment" key={i}>
                                      <div className="av">{initials(c.by)}</div>
                                      <div className="body">
                                        <b>{c.by}</b>
                                        <span className="t">{c.t}</span>
                                        <div>{c.text}</div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                              <div
                                className="ext-row"
                                style={{ marginTop: 4 }}
                              >
                                <input
                                  type="text"
                                  placeholder="Add a comment…"
                                  value={commentDraft[a.id] || ""}
                                  onChange={(e) =>
                                    setCommentDraft((d) => ({
                                      ...d,
                                      [a.id]: e.target.value
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      postComment(a.id);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn ghost small-btn"
                                  onClick={() => postComment(a.id)}
                                >
                                  Post
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button type="button" className="btn-ai" onClick={reSummarize}>
                Re-summarize
              </button>
            </div>
          </div>
        ) : (
          <div className="card no-stripe" style={{ borderStyle: "dashed" }}>
            <div className="empty-state">No tasks yet.</div>
          </div>
        )}
      </div>
      {toastNode}
    </div>
  );
}
