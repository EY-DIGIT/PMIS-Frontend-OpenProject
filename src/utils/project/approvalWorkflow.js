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

/* Convenience: stamp Actual Start Date AND submit for division approval in
   one step. Matches the backend's SUBMIT action which moves the activity
   straight into pending_division with the configured Concerned Divisions. */
export function startActivity(form, divisions) {
  const today = new Date().toISOString().slice(0, 10);
  const list = safeArray(divisions);
  const next = {
    ...form,
    actualStartDate: form.actualStartDate || today,
    approvalState: list.length ? "pending_division" : form.approvalState,
    divisionApprovals: list.map((d) => ({
      division: d,
      status: "pending",
      decidedBy: "",
      decidedAt: "",
      reason: ""
    })),
    ownerApproval: null,
    lastRejection: null
  };
  next.comments = pushSystemComment(form, {
    who: "System",
    text: list.length
      ? `Activity started and submitted for approval. Routed to: ${list.join(", ")}.`
      : "Activity started.",
    systemType: "request",
    approvalStage: list.length ? "division" : null
  });
  return next;
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

export function requestDivisionApproval(form, divisions, message = "") {
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
  return {
    ...form,
    approvalState: "pending_division",
    divisionApprovals,
    ownerApproval: null,
    lastRejection: null,
    comments: pushSystemComment(form, {
      who: "System",
      text: `Approval request sent to Concerned Division(s): ${list.join(
        ", "
      )}.${message ? " Message: " + message : ""}`,
      systemType: "request",
      approvalStage: "division"
    })
  };
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
  let nextOwnerApproval = form.ownerApproval || null;
  let comments = pushSystemComment(form, {
    who: divisionName,
    text: `${divisionName} has approved.`,
    systemType: "approval",
    approvalStage: "division",
    divisionName
  });
  /* When the last concerned division approves, the backend auto-progresses
     to pending_owner (no separate "request owner" action exists). Mirror that
     locally so the panel jumps straight to the Owner Review step. */
  if (rows.every((r) => r.status === "approved")) {
    nextState = "pending_owner";
    nextOwnerApproval = {
      status: "pending",
      decidedBy: "",
      decidedAt: "",
      reason: ""
    };
    comments = pushSystemComment(
      { ...form, comments },
      {
        who: "System",
        text:
          "All Concerned Divisions have approved. Routing to Activity Owner for final approval.",
        systemType: "completion",
        approvalStage: "division"
      }
    );
  }
  return {
    ...form,
    divisionApprovals: rows,
    ownerApproval: nextOwnerApproval,
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

export function requestOwnerApproval(form, ownerName, message = "") {
  if (form.approvalState !== "division_approved") return form;
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
        message ? " Message: " + message : ""
      }`,
      systemType: "request",
      approvalStage: "owner",
      approvalTarget: ownerName || "Owner",
      approvalTargetKind: "owner"
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
