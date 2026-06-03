/* ══════════════════════════════════════════════════════════════════
   MeetingsListPage.jsx — landing page at /meetings.

   Used to render an "All Meetings" toolbar + table; that section was
   removed per UX request. What's left:
     • Create Meeting button (top-right via .page-header)
     • Action-item stat row (totals across every meeting)

   Title is rendered by the global navbar (resolveNavTitle in
   Layout.jsx — "Meetings"), so no in-page heading either.
   ══════════════════════════════════════════════════════════════════ */

import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { listMeetings, isOverdue } from "../../data/meetingsMock";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

export default function MeetingsListPage() {
  const navigate = useNavigate();
  const { node: toastNode } = useToast();
  const meetings = useMemo(() => listMeetings(), []);

  /* Aggregate action-item stats across every meeting. */
  const stats = useMemo(() => {
    let total = 0;
    let prog = 0;
    let delayed = 0;
    let done = 0;
    meetings.forEach((m) =>
      m.actionItems.forEach((a) => {
        total++;
        if (a.status === "Completed") done++;
        else if (a.status === "In Progress") prog++;
        if (isOverdue(a) || a.status === "Delayed") delayed++;
      })
    );
    return { total, prog, delayed, done };
  }, [meetings]);

  return (
    <div className="pmis-mtg">
      {/* Page title sits in the global navbar. Empty spacer keeps the
          Create Meeting button right-aligned via space-between. */}
      <div className="page-header">
        <div />
        <div className="page-header-actions">
          <button
            type="button"
            className="btn"
            onClick={() => navigate("/meetings/new")}
          >
            Create Meeting
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat s-total">
          <div className="num">{stats.total}</div>
          <div className="lbl">Action items</div>
        </div>
        <div className="stat s-progress">
          <div className="num">{stats.prog}</div>
          <div className="lbl">In progress</div>
        </div>
        <div className="stat s-delayed">
          <div className="num">{stats.delayed}</div>
          <div className="lbl">Overdue</div>
        </div>
        <div className="stat s-done">
          <div className="num">{stats.done}</div>
          <div className="lbl">Completed</div>
        </div>
      </div>
      {toastNode}
    </div>
  );
}
