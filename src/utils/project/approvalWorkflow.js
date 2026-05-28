/* ═══════════════════════════════════════════════════════════════
   approvalWorkflow.js — pure state transitions for the activity
   approval workflow (Vendor → Concerned Divisions → Activity Owner).

   Each function takes the current activity-form snapshot and returns
   a NEW form snapshot — no mutation, no side effects. Callers wire
   these into React setForm() in NodeModal.

   States:
     'idle'                 — never started
     'ready_for_approval'   — explicitly marked ready; division request not yet sent
     'pending_division'     — division request sent; one or more divisions still pending
     'division_approved'    — every consent division approved; ready to request owner
     'pending_owner'        — owner request sent; awaiting decision
     'completed'            — owner approved; activity is fully completed
     'rejected_to_vendor'   — division OR owner rejected; vendor must resend
   ═══════════════════════════════════════════════════════════════ */

import { safeArray } from "./helpers";

function nowIso() {
  return new Date().toISOString();
}

function pushSystemComment(form, payload) {
  const comments = safeArray(form.comments).slice();
  comments.unshift({
    kind: "system",
    when: nowIso(),
    attachments: [],
    ...payload
  });
  return comments;
}

/* Stamp Actual Start Date — independent of the approval workflow. Matches
   the HTML reference where "Start Activity" only marks the start date and
   the workflow is driven separately by Mark Ready / Request Division. */
export function startActivity(form /*, divisions */) {
  const today = new Date().toISOString().slice(0, 10);
  if (form.actualStartDate) return form;
  return {
    ...form,
    actualStartDate: today,
    comments: pushSystemComment(form, {
      who: "System",
      text: "Activity started.",
      systemType: "start",
      approvalStage: null
    })
  };
}

/* Resubmit a rejected activity. Used after REJECT bounced the activity back
   to the vendor. Re-routes to the original concerned divisions and clears
   the lastRejection so the timeline re-enters pending_division. */
export function resubmitAfterRejection(form, divisions) {
  if (form.approvalState !== "rejected_to_vendor") return form;
  const list = safeArray(divisions);
  if (!list.length) return form;
  return {
    ...form,
    approvalState: "pending_division",
    divisionApprovals: list.map((d) => ({
      division: d,
      status: "pending",
      decidedBy: "",
      decidedAt: "",
      reason: ""
    })),
    ownerApproval: null,
    lastRejection: null,
    comments: pushSystemComment(form, {
      who: "System",
      text: `Activity re-submitted after rejection. Routed to: ${list.join(", ")}.`,
      systemType: "request",
      approvalStage: "division"
    })
  };
}

export function markReadyForApproval(form, source = "manual") {
  if (form.approvalState !== "idle") return form;
  const why =
    source === "manual"
      ? " (manual)"
      : source === "last-task"
      ? " (last task / sub-task was completed)"
      : "";
  return {
    ...form,
    approvalState: "ready_for_approval",
    comments: pushSystemComment(form, {
      who: "System",
      text: `Activity marked Ready for Approval${why}.`,
      systemType: "ready",
      approvalStage: "ready"
    })
  };
}

/* Request Concerned Division approval. Two call signatures:
     1. (form, divisions[], message?)               — backward-compat single combined comment
     2. (form, divisions[], payloads[])             — per-target {label,text,files}; one
                                                       system comment per division so each
                                                       reviewer's instructions + attachments
                                                       sit on their own audit-trail entry. */
export function requestDivisionApproval(form, divisions, payloadsOrMessage) {
  const list = safeArray(divisions);
  if (!list.length) return form;
  if (
    form.approvalState !== "ready_for_approval" &&
    form.approvalState !== "rejected_to_vendor"
  ) {
    return form;
  }
  const divisionApprovals = list.map((d) => ({
    division: d,
    status: "pending",
    decidedBy: "",
    decidedAt: "",
    reason: ""
  }));
  let next = {
    ...form,
    approvalState: "pending_division",
    divisionApprovals,
    ownerApproval: null,
    lastRejection: null
  };
  /* Per-target payload path: emit one system comment per division. Each
     entry carries the user-typed message + attachments visible to that
     specific reviewer in the timeline. */
  if (Array.isArray(payloadsOrMessage) && payloadsOrMessage.length > 0) {
    let comments = safeArray(next.comments).slice();
    payloadsOrMessage.forEach((p) => {
      const label = (p && p.label) || (p && p.division) || "";
      const text = String((p && p.text) || "").trim();
      const files = safeArray(p && p.files);
      comments.unshift({
        kind: "system",
        when: nowIso(),
        who: "System",
        text: `Approval request sent to Division: ${label}.${text ? " Message: " + text : ""}`,
        systemType: "request",
        approvalStage: "division",
        approvalTarget: label,
        approvalTargetKind: "division",
        attachments: files
      });
    });
    next = { ...next, comments };
    return next;
  }
  /* Fallback: single combined comment (no per-target payload supplied). */
  const message = typeof payloadsOrMessage === "string" ? payloadsOrMessage : "";
  next.comments = pushSystemComment(form, {
    who: "System",
    text: `Approval request sent to Concerned Division(s): ${list.join(
      ", "
    )}.${message ? " Message: " + message : ""}`,
    systemType: "request",
    approvalStage: "division"
  });
  return next;
}

export function approveDivision(form, divisionName) {
  if (form.approvalState !== "pending_division") return form;
  const rows = safeArray(form.divisionApprovals).map((r) =>
    r.division === divisionName
      ? {
          ...r,
          status: "approved",
          decidedBy: divisionName,
          decidedAt: nowIso()
        }
      : r
  );
  let nextState = form.approvalState;
  let comments = pushSystemComment(form, {
    who: divisionName,
    text: `${divisionName} has approved.`,
    systemType: "approval",
    approvalStage: "division",
    divisionName
  });
  /* When the last concerned division approves, move to division_approved.
     User must then click "Request Owner Approval" to forward to the Owner
     (matches the HTML reference's explicit two-step flow). */
  if (rows.every((r) => r.status === "approved")) {
    nextState = "division_approved";
    comments = pushSystemComment(
      { ...form, comments },
      {
        who: "System",
        text:
          "All Concerned Divisions have approved. Ready to request Owner approval.",
        systemType: "completion",
        approvalStage: "division"
      }
    );
  }
  return {
    ...form,
    divisionApprovals: rows,
    approvalState: nextState,
    comments
  };
}

export function rejectDivision(form, divisionName, reason) {
  if (form.approvalState !== "pending_division") return form;
  if (!reason || !String(reason).trim()) return form;
  const decidedAt = nowIso();
  const rows = safeArray(form.divisionApprovals).map((r) =>
    r.division === divisionName
      ? {
          ...r,
          status: "rejected",
          decidedBy: divisionName,
          decidedAt,
          reason
        }
      : r
  );
  return {
    ...form,
    divisionApprovals: rows,
    approvalState: "rejected_to_vendor",
    lastRejection: {
      byKind: "division",
      byName: divisionName,
      reason,
      at: decidedAt
    },
    comments: pushSystemComment(form, {
      who: divisionName,
      text: `${divisionName} REJECTED with reason: ${reason}. Returning to vendor for resend.`,
      systemType: "rejection",
      approvalStage: "division",
      divisionName,
      reason
    })
  };
}

/* Request Owner approval. payload may be a string (back-compat) or a
   `{text, files}` object captured from the request popup. The single
   system comment carries the user-typed message + attachments. */
export function requestOwnerApproval(form, ownerName, payloadOrMessage) {
  if (form.approvalState !== "division_approved") return form;
  let text = "";
  let files = [];
  if (typeof payloadOrMessage === "string") {
    text = payloadOrMessage;
  } else if (payloadOrMessage && typeof payloadOrMessage === "object") {
    text = String(payloadOrMessage.text || "").trim();
    files = safeArray(payloadOrMessage.files);
  }
  return {
    ...form,
    approvalState: "pending_owner",
    ownerApproval: {
      status: "pending",
      decidedBy: "",
      decidedAt: "",
      reason: ""
    },
    comments: pushSystemComment(form, {
      who: "System",
      text: `Owner approval request sent to ${ownerName || "Owner"}.${
        text ? " Message: " + text : ""
      }`,
      systemType: "request",
      approvalStage: "owner",
      approvalTarget: ownerName || "Owner",
      approvalTargetKind: "owner",
      attachments: files
    })
  };
}

export function approveOwner(form, ownerName) {
  if (form.approvalState !== "pending_owner") return form;
  const decidedAt = nowIso();
  return {
    ...form,
    approvalState: "completed",
    status: "Completed",
    ownerApproval: {
      ...(form.ownerApproval || {}),
      status: "approved",
      decidedBy: ownerName || "Owner",
      decidedAt
    },
    comments: pushSystemComment(form, {
      who: ownerName || "Owner",
      text: `${ownerName || "Owner"} (Owner) has approved. Activity marked Completed.`,
      systemType: "completion",
      approvalStage: "completed"
    })
  };
}

/* Owner rejection: revertTo === 'vendor' bounces the whole flow back to the
   vendor (state = rejected_to_vendor). revertTo === 'divisions' bounces back
   to Step 4 with only the picked divisions pending again. */
export function rejectOwner(form, ownerName, reason, revertTo, revertDivisions) {
  if (form.approvalState !== "pending_owner") return form;
  if (!reason || !String(reason).trim()) return form;
  const decidedAt = nowIso();
  const baseOwnerApproval = {
    ...(form.ownerApproval || {}),
    status: "rejected",
    decidedBy: ownerName || "Owner",
    decidedAt,
    reason
  };
  if (revertTo === "vendor") {
    return {
      ...form,
      ownerApproval: baseOwnerApproval,
      approvalState: "rejected_to_vendor",
      lastRejection: {
        byKind: "owner",
        byName: ownerName || "Owner",
        reason,
        at: decidedAt,
        revertTo: "vendor"
      },
      comments: pushSystemComment(form, {
        who: ownerName || "Owner",
        text: `${
          ownerName || "Owner"
        } (Owner) REJECTED. Returning to vendor for resend. Reason: ${reason}`,
        systemType: "rejection",
        approvalStage: "owner",
        reason,
        revertTo: "vendor"
      })
    };
  }
  const picked = safeArray(revertDivisions);
  if (!picked.length) return form;
  return {
    ...form,
    ownerApproval: null,
    approvalState: "pending_division",
    divisionApprovals: picked.map((d) => ({
      division: d,
      status: "pending",
      decidedBy: "",
      decidedAt: "",
      reason: ""
    })),
    lastRejection: {
      byKind: "owner",
      byName: ownerName || "Owner",
      reason,
      at: decidedAt,
      revertTo: "divisions",
      revertDivisions: picked
    },
    comments: pushSystemComment(form, {
      who: ownerName || "Owner",
      text: `${
        ownerName || "Owner"
      } (Owner) REJECTED. Reverted to Concerned Divisions: ${picked.join(
        ", "
      )}. Reason: ${reason}`,
      systemType: "rejection",
      approvalStage: "owner",
      reason,
      revertTo: "divisions",
      revertDivisions: picked
    })
  };
}

export function resetWorkflow(form) {
  if (form.approvalState === "idle") return form;
  return {
    ...form,
    approvalState: "idle",
    divisionApprovals: [],
    ownerApproval: null,
    lastRejection: null,
    status: form.status === "Completed" ? "Not Completed" : form.status,
    comments: pushSystemComment(form, {
      who: "System",
      text: "Approval workflow was reset by an administrator.",
      systemType: "request",
      approvalStage: null
    })
  };
}

/* ─── State derivation from the workflow service's audit history ─── */

/* Map the backend's previousStatus enum to a snapshot of our local
   approvalState. Returns "" when the status doesn't match anything we
   recognise so callers can fall back to "idle". */
const _STATUS_TO_LOCAL = {
  READYFORAPPROVAL: "ready_for_approval",
  PENDINGATCONCERNEDDIVISION: "pending_division",
  PENDINGATOWNERDIVISION: "pending_owner",
  COMPLETED: "completed",
  REJECTED: "rejected_to_vendor",
  RETURNEDTOVENDOR: "rejected_to_vendor"
};

/* Inspect the chronologically-sorted ProcessInstance list and return
   the activity's CURRENT approval state. Reads the latest action and
   maps to the post-transition state — refreshing the modal after a
   transition therefore reflects the backend truth even though the
   local form was wiped.

   The flow has two LOCAL intermediate steps the backend doesn't track:
     • ready_for_approval (after SUBMIT, before user clicks Request
       Division Approval) — backend has already moved to
       PENDINGATCONCERNEDDIVISION but we surface a "Request Division
       Approval" button to the user first.
     • division_approved (after all Concerned Divisions approve, before
       user clicks Request Owner Approval) — same idea, surface a
       "Request Owner Approval" button.

   `consentDivisions` is the activity's configured division list — used
   to count whether enough APPROVE-at-concerned events have come in to
   transition into division_approved. */
export function deriveStateFromInstances(instances, consentDivisions) {
  if (!Array.isArray(instances) || instances.length === 0) return null;
  const sorted = [...instances].sort(
    (a, b) =>
      ((a.auditDetails && a.auditDetails.createdTime) || 0) -
      ((b.auditDetails && b.auditDetails.createdTime) || 0)
  );
  const last = sorted[sorted.length - 1];
  const action = String((last && last.action) || "").toUpperCase();
  const prev = String((last && last.previousStatus) || "").toUpperCase();
  const divCount = safeArray(consentDivisions).length;

  /* SUBMIT or UPDATE was the most recent event — backend has moved the
     activity into PENDINGATCONCERNEDDIVISION, but our UI splits this
     into two visible steps. Surface "Request Division Approval" by
     parking at ready_for_approval; the user clicks through locally to
     reach pending_division and the per-division rows. */
  if (action === "SUBMIT") return "ready_for_approval";
  if (action === "UPDATE") return "ready_for_approval";
  if (action === "REJECT") return "rejected_to_vendor";
  if (action === "APPROVE") {
    if (prev === "PENDINGATOWNERDIVISION") return "completed";
    if (prev === "PENDINGATCONCERNEDDIVISION") {
      const approvalsAtConcerned = sorted.filter(
        (e) =>
          String((e && e.action) || "").toUpperCase() === "APPROVE" &&
          String((e && e.previousStatus) || "").toUpperCase() ===
            "PENDINGATCONCERNEDDIVISION"
      ).length;
      /* All configured Concerned Divisions have signed off — park at
         division_approved so the "Request Owner Approval" button
         surfaces, then user clicks through to pending_owner. */
      if (divCount > 0 && approvalsAtConcerned >= divCount) {
        return "division_approved";
      }
      return "pending_division";
    }
    return "completed";
  }
  return _STATUS_TO_LOCAL[prev] || null;
}

/* Build the per-division approval rows from a ProcessInstance list.
   Because the backend doesn't tag APPROVE events with a division
   identifier, we use the chronological order of APPROVE-from-
   PENDINGATCONCERNEDDIVISION events to fill rows from the head of the
   configured `consentDivisions` array. */
export function deriveDivisionApprovalsFromInstances(instances, consentDivisions) {
  const divs = safeArray(consentDivisions);
  if (!divs.length) return [];
  const sorted = safeArray(instances).slice().sort(
    (a, b) =>
      ((a.auditDetails && a.auditDetails.createdTime) || 0) -
      ((b.auditDetails && b.auditDetails.createdTime) || 0)
  );
  const approveEvents = sorted.filter(
    (e) =>
      String((e && e.action) || "").toUpperCase() === "APPROVE" &&
      String((e && e.previousStatus) || "").toUpperCase() ===
        "PENDINGATCONCERNEDDIVISION"
  );
  const rejectEvent = sorted.find(
    (e) =>
      String((e && e.action) || "").toUpperCase() === "REJECT" &&
      String((e && e.previousStatus) || "").toUpperCase() ===
        "PENDINGATCONCERNEDDIVISION"
  );
  return divs.map((d, i) => {
    const ev = approveEvents[i];
    if (ev) {
      return {
        division: d,
        status: "approved",
        decidedBy: (ev.auditDetails && ev.auditDetails.createdBy) || "",
        decidedAt: ev.auditDetails && ev.auditDetails.createdTime
          ? new Date(ev.auditDetails.createdTime).toISOString()
          : "",
        reason: ev.comment || ""
      };
    }
    if (rejectEvent && i === approveEvents.length) {
      return {
        division: d,
        status: "rejected",
        decidedBy: (rejectEvent.auditDetails && rejectEvent.auditDetails.createdBy) || "",
        decidedAt: rejectEvent.auditDetails && rejectEvent.auditDetails.createdTime
          ? new Date(rejectEvent.auditDetails.createdTime).toISOString()
          : "",
        reason: rejectEvent.comment || ""
      };
    }
    return {
      division: d,
      status: "pending",
      decidedBy: "",
      decidedAt: "",
      reason: ""
    };
  });
}

/* Derive ownerApproval from instances. Returns the {status,decidedBy,
   decidedAt,reason} shape if we found an APPROVE/REJECT event from
   PENDINGATOWNERDIVISION; null otherwise. */
export function deriveOwnerApprovalFromInstances(instances) {
  const sorted = safeArray(instances).slice().sort(
    (a, b) =>
      ((a.auditDetails && a.auditDetails.createdTime) || 0) -
      ((b.auditDetails && b.auditDetails.createdTime) || 0)
  );
  const ownerEvent = [...sorted].reverse().find(
    (e) =>
      String((e && e.previousStatus) || "").toUpperCase() === "PENDINGATOWNERDIVISION"
  );
  if (!ownerEvent) return null;
  const action = String(ownerEvent.action || "").toUpperCase();
  if (action !== "APPROVE" && action !== "REJECT") return null;
  return {
    status: action === "APPROVE" ? "approved" : "rejected",
    decidedBy: (ownerEvent.auditDetails && ownerEvent.auditDetails.createdBy) || "",
    decidedAt:
      ownerEvent.auditDetails && ownerEvent.auditDetails.createdTime
        ? new Date(ownerEvent.auditDetails.createdTime).toISOString()
        : "",
    reason: ownerEvent.comment || ""
  };
}

/* Classify each of the 5 timeline steps for rendering. */
export function classifyStep(name, form, allTasksDone, hasTasks) {
  const state = form.approvalState || "idle";
  const rejection = form.lastRejection || null;
  if (name === "tasks") {
    if (!hasTasks) {
      return state === "idle" || state === "rejected_to_vendor" ? "active" : "done";
    }
    if (allTasksDone) return "done";
    return "active";
  }
  if (name === "ready") {
    if (state === "ready_for_approval") return "active";
    if (state === "rejected_to_vendor") return "active";
    if (state === "idle") return allTasksDone ? "active" : "future";
    return "done";
  }
  if (name === "division") {
    if (state === "pending_division") return "active";
    if (
      state === "division_approved" ||
      state === "pending_owner" ||
      state === "completed"
    ) {
      return "done";
    }
    if (state === "rejected_to_vendor" && rejection && rejection.byKind === "division") {
      return "rejected";
    }
    return "future";
  }
  if (name === "owner") {
    if (state === "pending_owner") return "active";
    if (state === "completed") return "done";
    if (state === "division_approved") return "active";
    if (rejection && rejection.byKind === "owner") return "rejected";
    return "future";
  }
  if (name === "done") {
    return state === "completed" ? "done" : "future";
  }
  return "future";
}
