
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DependencyPicker from "../DependencyPicker";
import ChipControl from "../ChipControl";
import ApprovalPanel from "./ApprovalPanel";
import ActivityAuditTrail from "./ActivityAuditTrail";
import StartActivityBanner from "./StartActivityBanner";
import {
  getProcessInstances,
  getActivityWorkflowAuditLogs,
  getActivityWorkflowTimeline,
  getParallelGateStatus
} from "../../../api/activityWorkflow";
import {
  deriveStateFromInstances,
  deriveDivisionApprovalsFromInstances,
  deriveOwnerApprovalFromInstances,
  deriveStateFromAuditLogs,
  deriveDivisionApprovalsFromAuditLogs,
  deriveOwnerApprovalFromAuditLogs,
  deriveDivisionApprovalsFromGate
} from "../../../utils/project/approvalWorkflow";
import {
  NODE_TYPE_OPTIONS,
  RESOURCE_TYPE_CODES,
  DIVISION_OPTIONS,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_FILE_EXTENSIONS,
  ALLOWED_FILE_ACCEPT,
  isAllowedAttachment,
  getFileExtension
} from "../../../utils/project/constants";
import {
  locateNode,
  getChildren,
  computeEffectiveActuals,
  getParentDateBounds,
  getParentDateBoundsForNew,
  safeArray
} from "../../../utils/project/nodeUtils";
import {
  formatDateDisplay,
  formatDateTime
} from "../../../utils/project/helpers";
import { useCan } from "../../../auth/permissions";
import {
  loadResourceTypes,
  loadDivisions,
  loadPriorities,
  loadActivityById,
  loadTaskById,
  loadSubtaskById,
  loadCommentsForEntity,
  postCommentForEntity,
  downloadAttachment
} from "../../../api/milestoneConfigApi";
import { getToken } from "../../../api/auth";
import { authorizedFetch } from "../../../api/client";
import { useData } from "../../../data/DataContext";

const TITLE_MAP = {
  milestone: "Milestone",
  activity: "Activity",
  task: "Task",
  subtask: "Sub Task"
};

function hintFor(kind) {
  if (kind === "milestone") return "Milestones drive the project structure.";
  if (kind === "activity") return "Activity Type is required for every activity.";
  if (kind === "task") return "Task Type is required for every task.";
  return "Sub-Tasks can be nested under tasks or under other sub-tasks.";
}

// Accept either "Capgemini" or {id, name}. Always return a name string.
function vendorName(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.name || "";
  return "";
}
function vendorKey(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.id || v.name || "";
  return "";
}

/* Concerned Division UI value is an array of division codes. Wire format
   is `["TMD1, TMD2"]` — a single-element array whose element is the
   comma-joined list. Accept either shape (plus a bare string from older
   records) and flatten to an array of trimmed codes. */
export function parseDivisionList(v) {
  if (Array.isArray(v)) {
    const out = [];
    v.forEach((x) => {
      String(x || "").split(",").forEach((s) => {
        const t = s.trim();
        if (t) out.push(t);
      });
    });
    return out;
  }
  if (typeof v === "string" && v.trim()) {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/* Dirty detection. Comments are loaded asynchronously and re-set on the
   form when the user posts a new one — they're not user-edited fields, so
   the comparison ignores them. The Comments composer (commentText /
   commentFiles) lives in its own state, never touches `form`, so it
   doesn't affect dirtiness either — that's deliberate, the user posts
   comments via the dedicated Post Comment button. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function isFormChanged(cur, base) {
  if (!cur || !base) return false;
  const keys = new Set([...Object.keys(cur), ...Object.keys(base)]);
  for (const k of keys) {
    if (k === "comments") continue;
    if (!deepEqual(cur[k], base[k])) return true;
  }
  return false;
}

function makeDefaultForm(kind, node, mode, parentNode) {
  const n = node || {};
  const inheritFromParent =
    mode === "add" &&
    (kind === "task" || kind === "subtask") &&
    parentNode &&
    parentNode.type;
  return {
    name: n.name || "",
    description: n.description || "",
    startDate: n.startDate || "",
    endDate: n.endDate || "",
    actualStartDate: n.actualStartDate || "",
    actualEndDate: n.actualEndDate || "",
    status: n.status || "Not Completed",
    type: inheritFromParent
      ? parentNode.type
      : n.type || (kind === "milestone" ? "" : "Standard Type"),
    /* Category (milestone + activity). 'original' for items created before
       publish; 'asg'/'ccn' for post-publish additions. ccnValue is only
       meaningful when category === 'ccn'. */
    category:
      (kind === "milestone" || kind === "activity")
        ? n.category || "original"
        : "",
    ccnValue:
      (kind === "milestone" || kind === "activity")
        ? Number(n.ccnValue) || 0
        : 0,
    /* Activity-only: payment linkage. */
    linkedToPayment: kind === "activity" ? !!n.linkedToPayment : false,
    activityPaymentPercent:
      kind === "activity" ? Number(n.activityPaymentPercent) || 0 : 0,
    /* Activity-only: approval workflow state bag. */
    approvalState: kind === "activity" ? n.approvalState || "idle" : "idle",
    divisionApprovals:
      kind === "activity" ? safeArray(n.divisionApprovals).slice() : [],
    ownerApproval: kind === "activity" ? n.ownerApproval || null : null,
    lastRejection: kind === "activity" ? n.lastRejection || null : null,
    // Doc 38: activity-only fields. Backend stores them as ownerDivision /
    // vendorId / concernedDivision and accepts them on PATCH only.
    ownerDivision: n.ownerDivision || "",
    ownerDivisionOther: n.ownerDivisionOther || "",
    vendorId: n.vendorId || "",
    priority: n.priority || "",
    /* Task / Subtask only — id of the user this item is assigned to.
       Picked from the dropdown of users belonging to the parent
       activity's vendor. Activity / Milestone don't carry this. */
    assignedTo: n.assignedTo || "",
    concernedDivision: parseDivisionList(n.concernedDivision),
    concernedDivisionOther: n.concernedDivisionOther || "",
    vendor: n.vendor || "",
    dependsOn: safeArray(n.dependsOn),
    resourceEntryType: n.resourceEntryType || "details",
    resourceDetails: {
      resourceName: "",
      resType: "",
      division: "",
      divisionOther: "",
      onboardingDate: "",
      offboardingDate: "",
      actualOnboardingDate: "",
      actualOffboardingDate: "",
      position: "",
      designation: "",
      jobRole: "",
      qualification: "",
      experience: "",
      ...(n.resourceDetails || {})
    },
    resourceCount: {
      resType: "",
      count: 1,
      onboardingDate: "",
      division: "",
      divisionOther: "",
      ...(n.resourceCount || {})
    },
    comments: safeArray(n.comments).slice()
  };
}

export default function NodeModal({
  open,
  kind,
  mode,
  project,
  parentUid,
  nodeUid,
  editable,
  onCancel,
  onSave
}) {
  // Project Members can't see or edit Priority — per spec the field is
  // hidden, not just disabled. Other roles get the usual control.
  const canEditPriority = useCan('editPriority');
  const node = useMemo(() => {
    if (!open || !nodeUid || !project) return null;
    const loc = locateNode(project, nodeUid);
    return loc ? loc.node : null;
  }, [open, nodeUid, project]);

  // Backend rule: subtask resourceMode/resource is only valid when parent task's type is 'resource'.
  // (Same applies if parent is itself a subtask — resource fields stay only inside a resource subtree.)
  const parentNode = useMemo(() => {
    if (!open || !parentUid || !project) return null;
    const loc = locateNode(project, parentUid);
    return loc ? loc.node : null;
  }, [open, parentUid, project]);
  const parentTypeIsResource = parentNode?.type === "Resource Type";

  /* For Task / Subtask: walk the project tree from this node (or its
     parent in add mode) up to the enclosing Activity. Used to scope
     the "Assigned To" user picker to that activity's vendor's users. */
  const enclosingActivity = useMemo(() => {
    if (!open || !project) return null;
    if (kind !== "task" && kind !== "subtask") return null;
    const targetUid =
      (mode === "edit" || mode === "view") && nodeUid ? nodeUid : parentUid;
    if (!targetUid) return null;
    const loc = locateNode(project, targetUid);
    if (!loc) return null;
    if (loc.kind === "activity") return loc.node;
    for (const step of (loc.chain || [])) {
      if (step && step.kind === "activity") return step.node;
    }
    return null;
  }, [open, project, kind, mode, nodeUid, parentUid]);

  /* All users belonging to the enclosing activity's vendor — populates
     the Assigned To dropdown. Falls back to [] when the activity has
     no vendor or no users match. */
  const { users } = useData();
  const assignableUsers = useMemo(() => {
    if (kind !== "task" && kind !== "subtask") return [];
    const vendorId = enclosingActivity?.vendorId || "";
    if (!vendorId) return [];
    return safeArray(users).filter((u) => u && u.vendorId === vendorId);
  }, [kind, enclosingActivity, users]);

  const [form, setForm] = useState(() => makeDefaultForm(kind, node, mode, parentNode));
  // Snapshot of the form taken whenever it is (re)initialized from the
  // node — open, async record fetch, divisions normalization. Compared
  // against `form` to decide whether the Save button should be enabled
  // in edit mode. Set to null until the first initialization runs.
  const [baseline, setBaseline] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [commentFiles, setCommentFiles] = useState([]);
  const [attachError, setAttachError] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  // Bumping this remounts the (uncontrolled) <input type="file"> so its
  // displayed filename clears after a successful post.
  const [fileInputKey, setFileInputKey] = useState(0);
  const [resourceTypes, setResourceTypes] = useState([]);
  const [resourceTypesLoading, setResourceTypesLoading] = useState(false);
  const [divisions, setDivisions] = useState([]);
  const [divisionsLoading, setDivisionsLoading] = useState(false);
  const [priorities, setPriorities] = useState([]);
  const [prioritiesLoading, setPrioritiesLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [saveError, setSaveError] = useState("");
  /* Workflow audit trail + timeline data, fetched from the activity-
     workflow service for activity edit mode. `refreshKey` triggers a
     refetch after any transition action (Mark Ready, Approve, etc.). */
  const [processInstances, setProcessInstances] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState("");
  const [processRefreshKey, setProcessRefreshKey] = useState(0);
  const refreshProcessInstances = () => setProcessRefreshKey((k) => k + 1);

  useEffect(() => {
    if (open) {
      const initial = makeDefaultForm(kind, node, mode, parentNode);
      setForm(initial);
      setBaseline(initial);
      setCommentText("");
      setCommentFiles([]);
      setAttachError("");
      setPostError("");
      setPosting(false);
      setFileInputKey((k) => k + 1);
      setFullscreen(false);
      setSaveError("");
    }
  }, [open, kind, node, mode, parentNode]);

  useEffect(() => {
    if (!open || kind === "milestone" || !getToken()) return;
    let cancelled = false;
    setResourceTypesLoading(true);
    setDivisionsLoading(true);
    loadResourceTypes()
      .then((list) => { if (!cancelled) setResourceTypes(list); })
      .catch(() => { if (!cancelled) setResourceTypes([]); })
      .finally(() => { if (!cancelled) setResourceTypesLoading(false); });
    loadDivisions()
      .then((list) => { if (!cancelled) setDivisions(list); })
      .catch(() => { if (!cancelled) setDivisions([]); })
      .finally(() => { if (!cancelled) setDivisionsLoading(false); });
    return () => { cancelled = true; };
  }, [open, kind]);

  /* Priorities load fires for every kind (milestone / activity / task /
     subtask) — the priority field is shown across the board. */
  useEffect(() => {
    if (!open || !getToken()) return;
    let cancelled = false;
    setPrioritiesLoading(true);
    loadPriorities()
      .then((list) => { if (!cancelled) setPriorities(list); })
      .catch(() => { if (!cancelled) setPriorities([]); })
      .finally(() => { if (!cancelled) setPrioritiesLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  /* On Create (add mode), preselect the last entry from the priorities
     dropdown so the user isn't forced to pick one for typical low-urgency
     items. Only fires when the field is still empty — once the user picks
     a different value (or the form is seeded from an existing node) we
     leave it alone. */
  useEffect(() => {
    if (mode !== "add") return;
    const list = safeArray(priorities);
    if (list.length === 0) return;
    if (form.priority) return;
    const last = list[list.length - 1];
    const code = last?.code;
    if (code) setForm((f) => (f.priority ? f : { ...f, priority: code }));
  }, [mode, priorities, form.priority]);

  /* Older records may have stored Concerned Division as labels ("TMD1") instead
     of codes ("tmd1"). Once the divisions list arrives, rewrite any label-form
     values in the form to their canonical code so we always send the code. */
  useEffect(() => {
    const list = safeArray(divisions);
    if (list.length === 0) return;
    const lookup = new Map();
    list.forEach((d) => {
      if (!d) return;
      const code = String(d.code || "");
      if (code) lookup.set(code.toLowerCase(), code);
      if (d.label) lookup.set(String(d.label).toLowerCase(), code);
    });
    function normalize(prev) {
      if (!prev) return prev;
      const cur = safeArray(prev.concernedDivision);
      if (cur.length === 0) return prev;
      const next = cur.map((v) => lookup.get(String(v).toLowerCase()) || v);
      const changed = next.some((v, i) => v !== cur[i]);
      return changed ? { ...prev, concernedDivision: next } : prev;
    }
    setForm((f) => normalize(f));
    setBaseline((b) => normalize(b));
  }, [divisions]);

  /* Edit mode: list endpoints return summary rows that omit the nested
     `resource` object — fetch the full single record so the form prefills
     correctly (especially for Resource Type activities/tasks/subtasks).
     IMPORTANT: the freshly-fetched record's `dependsOn` contains the raw
     server display IDs ("M1", "A1.2", …); the project-level resolver only
     ran over the cached tree, so we keep the CACHED node's `dependsOn`
     (already translated to local UIDs) when seeding the form. */
  useEffect(() => {
    if (!open || mode === "add" || !node?.apiId || !getToken()) return;
    if (kind === "milestone") return;
    const fetcher =
      kind === "activity" ? loadActivityById :
      kind === "task" ? loadTaskById :
      kind === "subtask" ? loadSubtaskById :
      null;
    if (!fetcher) return;
    let cancelled = false;
    fetcher(node.apiId)
      .then((full) => {
        if (cancelled || !full) return;
        const merged = {
          ...full,
          dependsOn: safeArray(node.dependsOn),
          dependsOnDisplay: safeArray(node.dependsOnDisplay)
        };
        const next = makeDefaultForm(kind, merged, mode, parentNode);
        // The comments effect runs in parallel and may have already
        // populated form.comments — preserve it so the panel doesn't
        // flicker empty if the full-record GET resolves second.
        setForm((prev) => ({
          ...next,
          comments: safeArray(prev && prev.comments).length
            ? prev.comments
            : next.comments
        }));
        setBaseline(next);
      })
      .catch(() => { /* keep cached node form on failure */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, kind, node && node.apiId]);

  /* For activity edit mode, fetch the workflow's process-instance
     history from the activity-workflow service. Drives both the
     ApprovalPanel timeline cues and the ActivityAuditTrail list.
     `refreshProcessInstances()` re-runs this after every transition
     action so the audit reflects the new state immediately. */
  useEffect(() => {
    if (!open || mode === "add") return;
    if (kind !== "activity" || !node) return;
    const businessId = node.apiId || node.uid || "";
    if (!businessId) return;
    let cancelled = false;
    setProcessLoading(true);
    setProcessError("");
    /* Fire BOTH the legacy process-instance search (still needed to
       derive approvalState / division votes / owner vote) AND the
       new audit-log endpoint (richer timeline with outcome, resultant
       state, performedBy username). The audit list is what the
       timeline component renders; the process instances feed state
       derivation. If the new audit endpoint fails or returns empty
       we fall back to the legacy instances for display. */
    Promise.allSettled([
      getProcessInstances(businessId),
      getActivityWorkflowAuditLogs(businessId),
      getParallelGateStatus(businessId),
      getActivityWorkflowTimeline(businessId)
    ])
      .then(([piRes, auditRes, gateRes, timelineRes]) => {
        if (cancelled) return;
        const instances = piRes.status === "fulfilled" && Array.isArray(piRes.value)
          ? piRes.value : [];
        const auditLogs = auditRes.status === "fulfilled" && Array.isArray(auditRes.value)
          ? auditRes.value : [];
        const gate = gateRes.status === "fulfilled" && gateRes.value && typeof gateRes.value === "object"
          ? gateRes.value : null;
        const timelineEvents = timelineRes.status === "fulfilled" && Array.isArray(timelineRes.value)
          ? timelineRes.value : [];

        /* Audit-log rows drive the Activity Audit Trail list (fall back
           to legacy instances). The purpose-built timeline feed drives
           the separate Timeline section. State derivation below runs off
           auditLogs / instances. */
        setProcessInstances(auditLogs.length ? auditLogs : instances);
        setTimeline(timelineEvents);

        const consentDivisions = parseDivisionList(node && node.concernedDivision);
        /* State derivation source priority: audit logs first (carry
           `resultantState` directly, including ALL_APPROVED auto-transitions
           the legacy process-instance shape never recorded) → process
           instances → bail. The audit endpoint also surfaces failed attempts
           which we filter out inside the derive helpers. */
        let derivedState = null;
        let derivedDivs = [];
        let derivedOwner = null;
        if (auditLogs.length) {
          derivedState = deriveStateFromAuditLogs(auditLogs, consentDivisions);
          derivedDivs = deriveDivisionApprovalsFromAuditLogs(auditLogs, consentDivisions);
          derivedOwner = deriveOwnerApprovalFromAuditLogs(auditLogs);
        }
        if (!derivedState && instances.length) {
          derivedState = deriveStateFromInstances(instances, consentDivisions);
          if (!derivedDivs.length) {
            derivedDivs = deriveDivisionApprovalsFromInstances(instances, consentDivisions);
          }
          if (!derivedOwner) {
            derivedOwner = deriveOwnerApprovalFromInstances(instances);
          }
        }
        /* Gate-status is the authoritative roll-up of Concerned Division
           votes. Its `divisions[]` carries each division's real vote, so
           prefer it over the audit-log inference (which only counts
           anonymous APPROVE events and can lag, leaving rows stuck on
           "pending" in the timeline even after a division approved). */
        const gateDivs = deriveDivisionApprovalsFromGate(gate);
        if (gateDivs.length) {
          derivedDivs = gateDivs;
        }
        /* When the gate reports every division approved (readyForOwner)
           surface the "Request Owner Approval" button by bumping
           pending_division → division_approved. Upgrade ONLY — never
           downgrade a state the audit log already advanced to the owner
           stage or completed. A successful request-owner-approval returns
           200 with an empty body, so the forward-to-owner is confirmed by
           the audit-derived pending_owner, NOT by the gate (the parallel
           gate-status can keep reporting its own
           PENDINGATCONCERNEDDIVISION / readyForOwner roll-up even after the
           activity has moved on — trusting it here would yank the timeline
           back to division_approved). Never override a rejection. */
        if (
          gate &&
          gate.readyForOwner === true &&
          !gate.hasRejection &&
          (derivedState === "pending_division" || derivedState === null)
        ) {
          derivedState = "division_approved";
        }
        if (!derivedState) return;
        setForm((f) => ({
          ...f,
          approvalState: derivedState,
          divisionApprovals:
            derivedDivs.length > 0 ? derivedDivs : safeArray(f.divisionApprovals),
          ownerApproval: derivedOwner || f.ownerApproval || null
        }));
        setBaseline((b) =>
          b
            ? {
                ...b,
                approvalState: derivedState,
                divisionApprovals:
                  derivedDivs.length > 0 ? derivedDivs : safeArray(b.divisionApprovals),
                ownerApproval: derivedOwner || b.ownerApproval || null
              }
            : b
        );

        if (piRes.status === "rejected" && auditRes.status === "rejected") {
          const err = piRes.reason || auditRes.reason;
          setProcessError(err && err.message ? err.message : "Failed to load workflow history.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setProcessInstances([]);
        setProcessError(err && err.message ? err.message : "Failed to load workflow history.");
      })
      .finally(() => {
        if (!cancelled) setProcessLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, kind, node && (node.apiId || node.uid), processRefreshKey]);

  /* Load existing comments + attachments for the node so they appear in
     the Comments panel when the modal opens — for both view and edit
     modes (only skipped on add, since the entity doesn't exist yet). */
  useEffect(() => {
    if (!open || mode === "add" || !node?.apiId || !getToken()) return;
    let cancelled = false;
    loadCommentsForEntity(kind, node.apiId)
      .then((items) => {
        if (cancelled) return;
        setForm((f) => ({ ...f, comments: items || [] }));
      })
      .catch(() => { /* swallow — comments are best-effort */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, kind, node && node.apiId]);

  if (!open || !project) return null;

  const isAdd = mode === "add";
  // Activity status is driven entirely by the approval workflow, so the
  // Status field is hidden for activities in both add and edit modes.
  const showStatus = !isAdd && kind !== "activity";
  const showActuals = !isAdd;
  // Doc 38: activity / task / subtask no longer have a `type` at the API
  // level (the four /standard, /transactional, /resource/* variants were
  // collapsed into a single create endpoint). The Type select is hidden;
  // ResourceSection is also hidden (kept in form state for backwards
  // compat with stale data, but never sent).
  const showType = false;
  const showResourceSection = false;
  // Activity-only fields per design + Doc 38 backend support.
  const showActivityFields = kind === "activity";
  const showVendor = false;
  // Task / Subtask carry an "Assigned To" user picked from the parent
  // activity's vendor's user pool. Milestone / Activity don't.
  const showAssignedTo = kind === "task" || kind === "subtask";
  const hasKids = node ? getChildren(node).length > 0 : false;
  const effActuals = node ? computeEffectiveActuals(node) : { start: "", end: "" };

  const actualStartValue = hasKids && node ? effActuals.start || "" : form.actualStartDate;
  const actualEndValue = hasKids && node ? effActuals.end || "" : form.actualEndDate;
  const actualDisabled = hasKids || !editable;

  const bounds = isAdd
    ? getParentDateBoundsForNew(project, parentUid)
    : getParentDateBounds(project, nodeUid);

  const isOnboarding = !project.projectId;
  const showDepsSection = !isOnboarding;

  function updateField(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function validateFiles(files) {
    const disallowed = files.filter((f) => !isAllowedAttachment(f));
    if (disallowed.length) {
      const names = disallowed
        .map((f) => `${f.name} (.${getFileExtension(f.name) || "?"})`)
        .join(", ");
      setAttachError(
        `Unsupported file type: ${names}. Allowed types: ${ALLOWED_FILE_EXTENSIONS.join(", ")}.`
      );
      return false;
    }
    const oversize = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversize.length) {
      const names = oversize
        .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`)
        .join(", ");
      setAttachError(`File too large (max 25 MB): ${names}`);
      return false;
    }
    setAttachError("");
    return true;
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (!validateFiles(files)) {
      e.target.value = "";
      setCommentFiles([]);
      return;
    }
    setCommentFiles(files);
  }

  function adjResCount(delta) {
    setForm((f) => ({
      ...f,
      resourceCount: {
        ...f.resourceCount,
        count: Math.max(1, (parseInt(f.resourceCount.count, 10) || 1) + delta)
      }
    }));
  }

  function save() {
    // Validate Owner Division + Concerned Division "Others" fields for
    // activities — backend needs the user-supplied text whenever an
    // "Others" code is selected.
    if (kind === "activity") {
      const divList = safeArray(divisions);

      if (
        divisionRequiresOther(divList, form.ownerDivision) &&
        !String(form.ownerDivisionOther || "").trim()
      ) {
        setSaveError("Please specify the owner division.");
        return;
      }

      const concernedNeedsOther = safeArray(form.concernedDivision).some((code) =>
        divisionRequiresOther(divList, code)
      );
      if (concernedNeedsOther && !String(form.concernedDivisionOther || "").trim()) {
        setSaveError("Please specify the concerned division.");
        return;
      }
    }
    setSaveError("");

    const payload = { ...form, bounds };
    const body = commentText.trim();
    if (body) payload.body = body;
    if (commentFiles.length) payload.files = commentFiles;
    onSave(payload);
  }

  /* Standalone "Post Comment" — fires the comments API for the current
     entity directly, without saving the parent node. On success, clears
     the composer and reloads the comments list so the new entry appears
     immediately. */
  async function postCommentNow() {
    if (posting) return;
    if (!node?.apiId) {
      setPostError("Save the item before adding a comment.");
      return;
    }
    const text = commentText.trim();
    if (!text && commentFiles.length === 0) {
      setPostError("Type a comment or attach a file first.");
      return;
    }
    setPostError("");
    setPosting(true);
    try {
      await postCommentForEntity(kind, node.apiId, text, commentFiles);
      setCommentText("");
      setCommentFiles([]);
      setAttachError("");
      setFileInputKey((k) => k + 1);
      const items = await loadCommentsForEntity(kind, node.apiId);
      setForm((f) => ({ ...f, comments: items || [] }));
    } catch (err) {
      setPostError(err?.message || "Failed to post comment.");
    } finally {
      setPosting(false);
    }
  }

  const navigate = useNavigate();

  const dis = editable ? false : true;
  // Edit mode: disable Save until the user actually edits a non-comment
  // field. Add mode: leave Save enabled (the user is creating something
  // from scratch). Comment text + file uploads route through the Post
  // Comment button now, so they don't count as field changes.
  const editDirty = !isAdd && baseline ? isFormChanged(form, baseline) : false;
  const disableSave = !isAdd && !editDirty;
  const projectVendors = safeArray(project.vendors);
  const title = !editable
    ? `View ${TITLE_MAP[kind] || ""} (Baseline — read-only)`
    : `${isAdd ? "Add" : "View/Update"} ${TITLE_MAP[kind] || ""}`;
  const hintText = !editable
    ? "This item is part of the published baseline and cannot be edited within a version."
    : hintFor(kind);

  /* Activity edit mode renders a wider 2-column layout: form on the left,
     approval workflow + audit trail on the right. The extra width keeps
     both columns readable without forcing the user into fullscreen. */
  const isActivityEdit = kind === "activity" && !isAdd && !!node;
  const boxStyle = fullscreen
    ? {
        position: "relative",
        width: "100vw",
        maxWidth: "100vw",
        height: "100vh",
        maxHeight: "100vh",
        margin: 0,
        borderRadius: 0,
        overflowY: "auto"
      }
    : isActivityEdit
    ? {
        position: "relative",
        width: "min(1400px, 100%)",
        maxWidth: "min(1400px, 100%)",
        /* Lock the modal to the viewport in activity-edit mode so the
           outer box never scrolls. Header + footer stay fixed; the body
           splits into two flex columns that each scroll independently. */
        height: "92vh",
        maxHeight: "92vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
      }
    : { position: "relative" };

  /* Body layout for activity-edit: a single flex row with two scrolling
     columns. Left column stacks banner → form → comments; right column
     holds the approval panel + audit trail. Outside activity edit, the
     wrapper renders as a plain block so milestone/task modals are
     unchanged. */
  const splitWrapperStyle = isActivityEdit
    ? {
        display: "flex",
        gap: 16,
        alignItems: "stretch",
        flex: "1 1 auto",
        minHeight: 0
      }
    : undefined;
  const leftColStyle = {
    flex: "1.05 1 0",
    minWidth: 0,
    overflowY: "auto",
    paddingRight: 6,
    display: "flex",
    flexDirection: "column",
    gap: 12
  };
  const rightColStyle = {
    flex: "1 1 0",
    minWidth: 0,
    overflowY: "auto",
    paddingRight: 6
  };

  const iconBtnStyle = {
    position: "absolute",
    width: 28,
    height: 28,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "#666",
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  };

  return (
    <div className="uidai-modal">
      <div className="uidai-modal__box uidai-modal__box--wide" style={boxStyle}>
        {kind === "activity" && node?.apiId && (
          <button
            type="button"
            aria-label="SLA Mapping"
            title="Manage SLA activity mappings"
            onClick={() => {
              // Nested under the project so the global breadcrumb extends as
              // Project Detail › Milestone › Activity › Map SLA. The milestone /
              // activity names ride along as query params for those crumbs.
              const loc = locateNode(project, node.uid);
              const params = new URLSearchParams({ activityId:node.apiId });
              const code=node.serverDisplayCode || node.id;
              if(code) params.set("activityCode", code);
              if (loc?.parent?.name) params.set("milestoneName", loc.parent.name);
              if (node?.name) params.set("activityName", node.name);
              navigate(`/projects/${encodeURIComponent(project.projectId)}/activity-slas?${params.toString()}`);
            }}
            style={{ ...iconBtnStyle, top: 8, right: 110, fontSize: 14, lineHeight: 1 ,width:"auto",padding: "8px 16px",background: "linear-gradient(90deg, #0b3c88, #129ab8)", borderRadius: 4, color: "#ffffff" ,marginTop:4}}
          >
            SLA Mapping
          </button>
        )}
        <button
          type="button"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={() => setFullscreen((v) => !v)}
          style={{ ...iconBtnStyle, top: 8, right: 44, fontSize: 16, lineHeight: 1 ,marginTop:4}}
        >
          {fullscreen ? "🗗" : "⛶"}
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          style={{ ...iconBtnStyle, top: 8, right: 10, fontSize: 22, lineHeight: 1 ,marginTop:4}}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">{title}</h3>
        <div className="uidai-hint" style={{ marginBottom: 12 }}>
          {hintText}
        </div>

        <div style={splitWrapperStyle}>
        <div style={isActivityEdit ? leftColStyle : undefined}>
        {isActivityEdit && (
          <div style={{ minWidth: 0 }}>
            <StartActivityBanner
              activity={node}
              form={form}
              editable={editable}
              projectPublished={
                String(project && project.status || "").toLowerCase() === "published"
              }
              onChange={(next) => setForm(next)}
            />
          </div>
        )}
        <div
          className="uidai-grid"
          style={
            isActivityEdit
              ? { minWidth: 0 }
              : undefined
          }
        >
          {node && node.id && (
            <div className="uidai-field">
              <label className="uidai-field__label">
                {TITLE_MAP[kind] || ""} ID
              </label>
              <input className="uidai-input" value={node.id || ""} disabled />
            </div>
          )}

          <div className="uidai-field">
            <label className="uidai-field__label">
              Name <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.name}
              onChange={(e) => updateField({ name: e.target.value })}
              disabled={dis}
            />
          </div>

          {showType && (() => {
            // For tasks/subtasks: backend rejects type='Resource Type' unless the parent is also resource.
            // Activities don't have this constraint (parent milestone has no type).
            // Only filter on add — edit mode keeps the existing value visible even if inconsistent.
            const restrictResource =
              isAdd &&
              (kind === "task" || kind === "subtask") &&
              !parentTypeIsResource;
            const typeOptions = restrictResource
              ? NODE_TYPE_OPTIONS.filter((t) => t !== "Resource Type")
              : NODE_TYPE_OPTIONS;
            // When adding a task or subtask, lock its type to the parent's type.
            const lockToParentType =
              isAdd &&
              (kind === "task" || kind === "subtask") &&
              !!(parentNode && parentNode.type);
            return (
              <div className="uidai-field">
                <label className="uidai-field__label">
                  {kind === "activity" ? "Activity" : kind === "task" ? "Task" : "Sub Task"} Type{" "}
                  <span className="uidai-required-project">*</span>
                </label>
                <select
                  className="uidai-select"
                  value={form.type}
                  onChange={(e) => updateField({ type: e.target.value })}
                  disabled={dis || lockToParentType}
                >
                  {typeOptions.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                {lockToParentType && (
                  <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                    Inherited from parent {kind === "task" ? "activity" : "task"} type.
                  </div>
                )}
                {restrictResource && !lockToParentType && (
                  <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                    Resource Type is only available when the parent {kind === "task" ? "activity" : "task"} is also Resource Type.
                  </div>
                )}
              </div>
            );
          })()}

          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Description</label>
            <textarea
              className="uidai-textarea"
              maxLength={5000}
              value={form.description}
              onChange={(e) => updateField({ description: e.target.value })}
              disabled={dis}
            />
            <div className="uidai-char-count">
              {5000 - form.description.length} characters remaining
            </div>
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected Start Date <span className="uidai-required-project">*</span>
            </label>
            <input
              type="date"
              className="uidai-input"
              value={form.startDate}
              min={(bounds && bounds.start) || undefined}
              max={form.endDate || (bounds && bounds.end) || undefined}
              onChange={(e) => updateField({ startDate: e.target.value })}
              disabled={dis}
            />
            {bounds && bounds.start && bounds.end && (
              <div className="uidai-hint">
                Allowed range: {formatDateDisplay(bounds.start)} to {formatDateDisplay(bounds.end)}
              </div>
            )}
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected End Date <span className="uidai-required-project">*</span>
            </label>
            <input
              type="date"
              className="uidai-input"
              value={form.endDate}
              min={form.startDate || (bounds && bounds.start) || undefined}
              max={(bounds && bounds.end) || undefined}
              onChange={(e) => updateField({ endDate: e.target.value })}
              disabled={dis}
            />
            {bounds && bounds.start && bounds.end && (
              <div className="uidai-hint">
                Allowed range: {formatDateDisplay(bounds.start)} to {formatDateDisplay(bounds.end)}
              </div>
            )}
          </div>

          {showActuals && (
            <>
              <div className="uidai-field">
                <label className="uidai-field__label">Actual Start Date</label>
                <input
                  type="date"
                  className="uidai-input"
                  value={actualStartValue}
                  onChange={(e) => updateField({ actualStartDate: e.target.value })}
                  disabled={actualDisabled}
                />
                {hasKids && (
                  <div className="uidai-auto-hint">Auto-derived from children's dates</div>
                )}
              </div>

              <div className="uidai-field">
                <label className="uidai-field__label">Actual End Date</label>
                <input
                  type="date"
                  className="uidai-input"
                  value={actualEndValue}
                  onChange={(e) => updateField({ actualEndDate: e.target.value })}
                  disabled={actualDisabled}
                />
                {hasKids && (
                  <div className="uidai-auto-hint">Auto-derived from children's dates</div>
                )}
              </div>
            </>
          )}

          {showStatus && (
            <div className="uidai-field">
              <label className="uidai-field__label">Status</label>
              <select
                className="uidai-select"
                value={form.status}
                onChange={(e) => updateField({ status: e.target.value })}
                disabled={dis}
              >
                <option>Not Completed</option>
                <option>Completed</option>
              </select>
            </div>
          )}

          {showActivityFields && (() => {
            const divList = safeArray(divisions);

            // Owner Division — does the current selection require an
            // "Other" free-text input?
            const ownerNeedsOther = divisionRequiresOther(divList, form.ownerDivision);

            // Concerned Division is multi-select. If ANY selected code is
            // an "Others" entry, surface the specify input below.
            const concernedNeedsOther = safeArray(form.concernedDivision).some((code) =>
              divisionRequiresOther(divList, code)
            );

            return (
              <>
                <div className="uidai-field">
                  <label className="uidai-field__label">
                    Owner Division <span className="uidai-required-project">*</span>
                  </label>
                  <select
                    className="uidai-select"
                    value={form.ownerDivision}
                    onChange={(e) => {
                      const next = e.target.value;
                      const stillNeedsOther = divisionRequiresOther(divList, next);
                      updateField({
                        ownerDivision: next,
                        ownerDivisionOther: stillNeedsOther ? form.ownerDivisionOther : ""
                      });
                    }}
                    disabled={dis}
                  >
                    <option value="">Select Owner Division</option>
                    {divList.map((d) => (
                      <option key={d.code} value={d.code}>{d.label}</option>
                    ))}
                  </select>
                </div>

                {ownerNeedsOther && (
                  <div className="uidai-field">
                    <label className="uidai-field__label">
                      Specify Owner Division <span className="uidai-required-project">*</span>
                    </label>
                    <input
                      className="uidai-input"
                      placeholder="Specify owner division"
                      value={form.ownerDivisionOther}
                      onChange={(e) => updateField({ ownerDivisionOther: e.target.value })}
                      disabled={dis}
                      maxLength={100}
                    />
                  </div>
                )}

                <div className="uidai-field">
                  <label className="uidai-field__label">
                    Organization <span className="uidai-required-project">*</span>
                  </label>
                  <select
                    className="uidai-select"
                    value={form.vendorId}
                    onChange={(e) => updateField({ vendorId: e.target.value })}
                    disabled={dis}
                  >
                    <option value="">— Select Organization —</option>
                    {projectVendors.map((v) => {
                      const id = typeof v === "object" ? (v.id || v.uuid || "") : "";
                      const name = vendorName(v);
                      if (!id || !name) return null;
                      return <option key={id} value={id}>{name}</option>;
                    })}
                  </select>
                  {projectVendors.length === 0 && (
                    <div className="uidai-field__hint" style={{ fontSize: 12, color: "#66788f", marginTop: 4 }}>
                      No organizations are associated with this project yet. Add them in Project Details &rarr; Organizations.
                    </div>
                  )}
                </div>

                <div className="uidai-field uidai-grid__full">
                  <label className="uidai-field__label">
                    Concerned Division <span className="uidai-required-project">*</span>{" "}
                    <span style={{ fontWeight: 400, fontSize: 12, color: "#66788f" }}>
                      (the divisions whose consent is required for this activity)
                    </span>
                  </label>
                  <ChipControl
                    value={safeArray(form.concernedDivision)}
                    options={
                      divList.length
                        ? divList.map((d) => ({ uid: d.code, name: d.label }))
                        : DIVISION_OPTIONS.map((o) => ({
                            uid: String(o).toLowerCase(),
                            name: o
                          }))
                    }
                    onChange={(next) => {
                      const stillNeedsOther = safeArray(next).some((code) =>
                        divisionRequiresOther(divList, code)
                      );
                      updateField({
                        concernedDivision: next,
                        concernedDivisionOther: stillNeedsOther ? form.concernedDivisionOther : ""
                      });
                    }}
                    label="division"
                    disabled={dis}
                  />
                </div>

                {concernedNeedsOther && (
                  <div className="uidai-field uidai-grid__full">
                    <label className="uidai-field__label">
                      Specify Concerned Division <span className="uidai-required-project">*</span>
                    </label>
                    <input
                      className="uidai-input"
                      placeholder="Specify concerned division"
                      value={form.concernedDivisionOther}
                      onChange={(e) => updateField({ concernedDivisionOther: e.target.value })}
                      disabled={dis}
                      maxLength={200}
                    />
                  </div>
                )}

              </>
            );
          })()}

          {/* Priority field is shown for all kinds (milestone / activity /
              task / subtask) — backend accepts `priority` on every level.
              Hidden entirely for Project Members per role spec. */}
          {canEditPriority && (
            <div className="uidai-field">
              <label className="uidai-field__label">
                Priority <span className="uidai-required-project">*</span>
              </label>
              <select
                className="uidai-select"
                value={form.priority}
                onChange={(e) => updateField({ priority: e.target.value })}
                disabled={dis || prioritiesLoading}
              >
                <option value="">— Select Priority —</option>
                {safeArray(priorities).map((p) => (
                  <option key={p.id || p.code} value={p.code}>
                    {p.name}
                    {/* {p.description ? ` — ${p.description}` : ""} */}
                  </option>
                ))}
              </select>
              {prioritiesLoading && (
                <div className="uidai-field__hint" style={{ fontSize: 12, color: "#66788f", marginTop: 4 }}>
                  Loading priorities…
                </div>
              )}
            </div>
          )}

          {/* Assigned To — only on Task / Subtask. Lists users belonging
              to the parent activity's vendor. */}
          {showAssignedTo && (
            <div className="uidai-field">
              <label className="uidai-field__label">Assigned To</label>
              <select
                className="uidai-select"
                value={form.assignedTo}
                onChange={(e) => updateField({ assignedTo: e.target.value })}
                disabled={dis || !enclosingActivity?.vendorId}
              >
                <option value="">— Unassigned —</option>
                {assignableUsers.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.fullName || u.email || u.userCode || u.userId}
                  </option>
                ))}
              </select>
              {!enclosingActivity?.vendorId && (
                <div className="uidai-field__hint" style={{ fontSize: 12, color: "#66788f", marginTop: 4 }}>
                  The parent activity has no vendor assigned yet — pick a vendor on the activity first to enable this list.
                </div>
              )}
              {enclosingActivity?.vendorId && assignableUsers.length === 0 && (
                <div className="uidai-field__hint" style={{ fontSize: 12, color: "#66788f", marginTop: 4 }}>
                  No users are mapped to this activity's vendor yet.
                </div>
              )}
            </div>
          )}

          {showDepsSection && (
            <div className="uidai-field uidai-grid__full">
              <label className="uidai-field__label">Depends On</label>
              <DependencyPicker
                value={form.dependsOn}
                onChange={(next) => updateField({ dependsOn: next })}
                project={project}
                kind={kind}
                nodeUid={node ? node.uid : ""}
                parentUid={parentUid || ""}
                editable={editable}
              />
            </div>
          )}

          {showResourceSection && form.type === "Resource Type" && (
            <ResourceSection
              form={form}
              updateField={updateField}
              adjResCount={adjResCount}
              dis={dis}
              editable={editable}
              resourceTypes={resourceTypes}
              resourceTypesLoading={resourceTypesLoading}
              divisions={divisions}
              divisionsLoading={divisionsLoading}
            />
          )}
        </div>

        {project.projectId && !isAdd && (
          <CommentsPanel
            comments={form.comments}
            editable={editable}
            commentText={commentText}
            setCommentText={setCommentText}
            commentFiles={commentFiles}
            onFileChange={handleFileChange}
            fileInputKey={fileInputKey}
            attachError={attachError}
            onPostComment={postCommentNow}
            posting={posting}
            postError={postError}
          />
        )}
        </div>

        {isActivityEdit && (
          <div style={rightColStyle}>
            <ApprovalPanel
              activity={node}
              form={form}
              editable={editable}
              divisions={divisions}
              onChange={(next) => setForm(next)}
              onTransition={refreshProcessInstances}
              projectId={project.projectId}
            />
            <ActivityAuditTrail
              form={form}
              processInstances={processInstances}
              timeline={timeline}
              loading={processLoading}
              error={processError}
            />
          </div>
        )}
        </div>

        {saveError && (
          <div className="uidai-attach-error" style={{ marginTop: 8 }}>
            {saveError}
          </div>
        )}

        <div className="uidai-modal__actions">
          {editable && (
            <button
              type="button"
              className="uidai-btn"
              onClick={save}
              disabled={disableSave}
            >
              Save
            </button>
          )}
          <button type="button" className="uidai-btn uidai-btn--cancel" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ResourceSection({
  form,
  updateField,
  adjResCount,
  dis,
  editable,
  resourceTypes,
  resourceTypesLoading,
  divisions,
  divisionsLoading
}) {
  const entry = form.resourceEntryType;
  const rd = form.resourceDetails;
  const rc = form.resourceCount;

  const apiList = safeArray(resourceTypes);
  const useApi = apiList.length > 0;

  const divisionFallback = DIVISION_OPTIONS.map((o) => ({
    code: o.toLowerCase() === "others" ? "others" : o,
    label: o,
    requiresOther: o.toLowerCase() === "others"
  }));
  const effectiveDivisions = safeArray(divisions).length ? divisions : divisionFallback;

  function updateRd(patch) {
    updateField({ resourceDetails: { ...rd, ...patch } });
  }
  function updateRc(patch) {
    updateField({ resourceCount: { ...rc, ...patch } });
  }

  function handleDivisionChange(target, code) {
    const needsOther = divisionRequiresOther(effectiveDivisions, code);
    const patch = {
      division: code,
      divisionOther: needsOther ? (target.divisionOther || "") : ""
    };
    if (target === rd) updateRd(patch); else updateRc(patch);
  }

  function renderResourceTypeOptions(currentValue) {
    if (!useApi) {
      return RESOURCE_TYPE_CODES.map((t) => <option key={t}>{t}</option>);
    }
    const opts = apiList.map((r) => (
      <option key={r.id} value={r.id}>
        {r.name}
      </option>
    ));
    const hasMatch = apiList.some((r) => r.id === currentValue);
    if (currentValue && !hasMatch) {
      opts.unshift(
        <option key={`legacy-${currentValue}`} value={currentValue}>
          {currentValue}
        </option>
      );
    }
    if (!currentValue) {
      opts.unshift(
        <option key="__placeholder" value="">
          — Select —
        </option>
      );
    }
    return opts;
  }

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <h4 style={{ color: "#173e77", margin: "6px 0 10px" }}>Resource Details</h4>
      <div className="uidai-resource-radios" role="radiogroup">
        <div
          className={`uidai-resource-radio${entry === "details" ? " uidai-resource-radio--active" : ""}`}
          onClick={() => editable && updateField({ resourceEntryType: "details" })}
          role="radio"
          aria-checked={entry === "details"}
        >
          <div className="uidai-resource-radio__dot" />
          <div className="uidai-resource-radio__info">
            <div className="uidai-resource-radio__title">Resource Details</div>
            <div className="uidai-resource-radio__sub">
              Record a specific named resource with full profile
            </div>
          </div>
        </div>
        <div
          className={`uidai-resource-radio${entry === "count" ? " uidai-resource-radio--active" : ""}`}
          onClick={() => editable && updateField({ resourceEntryType: "count" })}
          role="radio"
          aria-checked={entry === "count"}
        >
          <div className="uidai-resource-radio__dot" />
          <div className="uidai-resource-radio__info">
            <div className="uidai-resource-radio__title">Resource Count</div>
            <div className="uidai-resource-radio__sub">
              Record only a count of resources (no name)
            </div>
          </div>
        </div>
      </div>

      {entry === "details" && (
        <div className="uidai-resource-section">
          <div className="uidai-resource-section__title">Resource Profile</div>
          <div className="uidai-grid">
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Name</label>
              <input
                className="uidai-input"
                value={rd.resourceName || ""}
                onChange={(e) => updateRd({ resourceName: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Type</label>
              <select
                className="uidai-select"
                value={rd.resType || ""}
                onChange={(e) => updateRd({ resType: e.target.value })}
                disabled={dis || resourceTypesLoading}
              >
                {renderResourceTypeOptions(rd.resType || "")}
              </select>
              {resourceTypesLoading && (
                <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Loading resource types…
                </div>
              )}
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Division</label>
              <DivisionDropdown
                value={rd.division || ""}
                onChange={(v) => handleDivisionChange(rd, v)}
                disabled={dis || divisionsLoading}
                divisions={effectiveDivisions}
                loading={divisionsLoading}
              />
            </div>
            {divisionRequiresOther(effectiveDivisions, rd.division) && (
              <div className="uidai-field">
                <label className="uidai-field__label">
                  Specify Division <span className="uidai-required-project">*</span>
                </label>
                <input
                  className="uidai-input"
                  value={rd.divisionOther || ""}
                  onChange={(e) => updateRd({ divisionOther: e.target.value })}
                  disabled={dis}
                />
              </div>
            )}
            <div className="uidai-field">
              <label className="uidai-field__label">Onboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.onboardingDate || ""}
                onChange={(e) => updateRd({ onboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Offboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.offboardingDate || ""}
                onChange={(e) => updateRd({ offboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Actual Onboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.actualOnboardingDate || ""}
                onChange={(e) => updateRd({ actualOnboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Actual Offboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rd.actualOffboardingDate || ""}
                onChange={(e) => updateRd({ actualOffboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Position</label>
              <input
                className="uidai-input"
                value={rd.position || ""}
                onChange={(e) => updateRd({ position: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Designation</label>
              <input
                className="uidai-input"
                value={rd.designation || ""}
                onChange={(e) => updateRd({ designation: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Job Role</label>
              <input
                className="uidai-input"
                value={rd.jobRole || ""}
                onChange={(e) => updateRd({ jobRole: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Qualification</label>
              <input
                className="uidai-input"
                value={rd.qualification || ""}
                onChange={(e) => updateRd({ qualification: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Experience (Years)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                className="uidai-input"
                value={rd.experience || ""}
                onChange={(e) => updateRd({ experience: e.target.value })}
                disabled={dis}
              />
            </div>
          </div>
        </div>
      )}

      {entry === "count" && (
        <div className="uidai-resource-section">
          <div className="uidai-resource-section__title">Resource Count</div>
          <div className="uidai-grid">
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Type</label>
              <select
                className="uidai-select"
                value={rc.resType || ""}
                onChange={(e) => updateRc({ resType: e.target.value })}
                disabled={dis || resourceTypesLoading}
              >
                {renderResourceTypeOptions(rc.resType || "")}
              </select>
              {resourceTypesLoading && (
                <div className="uidai-field__hint" style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Loading resource types…
                </div>
              )}
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Count</label>
              <div className="uidai-res-count">
                <button
                  type="button"
                  className="uidai-res-count__btn"
                  onClick={() => adjResCount(-1)}
                  disabled={dis}
                >
                  −
                </button>
                <input
                  type="number"
                  min="1"
                  className="uidai-input"
                  style={{ width: 70, textAlign: "center" }}
                  value={rc.count || 1}
                  onChange={(e) => updateRc({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  disabled={dis}
                />
                <button
                  type="button"
                  className="uidai-res-count__btn"
                  onClick={() => adjResCount(1)}
                  disabled={dis}
                >
                  +
                </button>
              </div>
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Onboarding Date</label>
              <input
                type="date"
                className="uidai-input"
                value={rc.onboardingDate || ""}
                onChange={(e) => updateRc({ onboardingDate: e.target.value })}
                disabled={dis}
              />
            </div>
            <div className="uidai-field">
              <label className="uidai-field__label">Resource Division</label>
              <DivisionDropdown
                value={rc.division || ""}
                onChange={(v) => handleDivisionChange(rc, v)}
                disabled={dis || divisionsLoading}
                divisions={effectiveDivisions}
                loading={divisionsLoading}
              />
            </div>
            {divisionRequiresOther(effectiveDivisions, rc.division) && (
              <div className="uidai-field">
                <label className="uidai-field__label">
                  Specify Division <span className="uidai-required-project">*</span>
                </label>
                <input
                  className="uidai-input"
                  value={rc.divisionOther || ""}
                  onChange={(e) => updateRc({ divisionOther: e.target.value })}
                  disabled={dis}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isOthersOption(d) {
  if (!d) return false;
  if (d.requiresOther) return true;
  return (
    String(d.code || "").toLowerCase() === "others" ||
    String(d.label || "").toLowerCase() === "others"
  );
}

function divisionRequiresOther(list, code) {
  const opt = list.find((d) => d.code === code);
  return isOthersOption(opt);
}

/* DivisionDropdown — pure code-only dropdown, mirrors AddProjectPage's owner
   select. The Others free-text input is rendered as a separate sibling field
   by the caller (so the layout matches owner / ownerOther). */
function DivisionDropdown({ value, onChange, disabled, divisions, loading }) {
  const apiList = safeArray(divisions);
  const fallback = DIVISION_OPTIONS.map((o) => ({
    code: o.toLowerCase() === "others" ? "others" : o,
    label: o,
    requiresOther: o.toLowerCase() === "others"
  }));
  const list = apiList.length > 0 ? apiList : fallback;

  // Resolve the form's stored value against the list (case-insensitive on
  // code OR label) so legacy uppercase strings still light up the right row.
  const lower = String(value || "").toLowerCase();
  const matched = list.find(
    (d) =>
      String(d.code || "").toLowerCase() === lower ||
      String(d.label || "").toLowerCase() === lower
  );
  const selectCode = matched ? matched.code : "";

  return (
    <select
      className="uidai-select"
      value={selectCode}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">{loading ? "Loading…" : "— Select —"}</option>
      {list.map((d) => (
        <option key={d.code} value={d.code}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

function CommentsPanel({
  comments,
  editable,
  commentText,
  setCommentText,
  commentFiles,
  onFileChange,
  fileInputKey,
  attachError,
  onPostComment,
  posting,
  postError
}) {
  const nothingToPost =
    !String(commentText || "").trim() && safeArray(commentFiles).length === 0;
  // Top-level filter for the comment history. "all" (default) shows
  // everything; "week" narrows to the last 7 days; "month" reveals a
  // second row of 12 calendar-month radios (Jan…Dec) and filters by
  // month-of-year regardless of year so the user can pick any month.
  const [commentFilter, setCommentFilter] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  /* Workflow-driven entries (kind === "system") belong in the Activity
     Audit Trail panel — exclude them here so they don't double up under
     the Comments list on the left. */
  const userComments = safeArray(comments).filter((c) => c && c.kind !== "system");
  const total = userComments.length;
  const MONTH_NAMES_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const visibleComments = (() => {
    if (commentFilter === "all") return userComments;
    if (commentFilter === "week") {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return userComments.filter((c) => {
        const t = c?.when ? new Date(c.when).getTime() : NaN;
        return Number.isFinite(t) && t >= cutoff;
      });
    }
    // commentFilter === "month"
    return userComments.filter((c) => {
      const t = c?.when ? new Date(c.when) : null;
      if (!t || Number.isNaN(t.getTime())) return false;
      return t.getMonth() === selectedMonth;
    });
  })();
  return (
    <div className="uidai-comments">
      <div className="uidai-comments__title">💬 Comments &amp; Attachments</div>
      {editable && (
        <div className="uidai-comments__composer">
          <div className="uidai-field">
            <textarea
              className="uidai-textarea"
              placeholder="Write a comment..."
              style={{ minHeight: 70 }}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
          </div>
          <div className="uidai-comments__upload-row">
            <div className="uidai-field">
              <input
                key={fileInputKey}
                type="file"
                multiple
                accept={ALLOWED_FILE_ACCEPT}
                onChange={onFileChange}
              />
              <div className="uidai-attach-hint">
                Maximum file size: 25 MB per file. Multiple files allowed.
                Allowed types: Documents (pdf, docx, xlsx, txt, csv), Images (jpg, png, heic), Videos (mp4, webm, mov).
              </div>
              {attachError && <div className="uidai-attach-error">{attachError}</div>}
            </div>
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="uidai-btn"
              onClick={onPostComment}
              disabled={posting || nothingToPost}
            >
              {posting ? "Posting…" : "Post Comment"}
            </button>
            {postError && <div className="uidai-attach-error">{postError}</div>}
          </div>
        </div>
      )}
      {total > 0 && (
        <div
          style={{
            width:"100px",
            marginLeft: "auto",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            fontSize: 13
          }}
        >
          <label htmlFor="uidai-comments-filter" style={{ fontWeight: 500 }}>Filter:</label>
          <select
            id="uidai-comments-filter"
            className="uidai-select"
            value={commentFilter}
            onChange={(e) => setCommentFilter(e.target.value)}
          >
            <option value="all">All</option>
            {/* <option value="week">This Week</option> */}
            <option value="month">Month</option>
          </select>
          {commentFilter === "month" && (
            <select
              id="uidai-comments-filter-month"
              className="uidai-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {MONTH_NAMES_SHORT.map((m, idx) => (
                <option key={m} value={idx}>{m}</option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="uidai-comments__list">
        {total === 0 ? (
          <div className="uidai-hint">No comments or attachments yet</div>
        ) : visibleComments.length === 0 ? (
          <div className="uidai-hint">No comments in the selected range.</div>
        ) : (
          visibleComments.map((item, i) => (
            <div key={i} className="uidai-comment-item">
              <div className="uidai-comment-item__meta">
                {item.who || "User"} · {formatDateTime(item.when)}
              </div>
              <div>{item.text}</div>
              {safeArray(item.attachments).length > 0 && (
                <div className="uidai-comment-item__attachments">
                  {item.attachments.map((f, j) => {
                    const isObj = f && typeof f === "object";
                    const name = isObj ? (f.name || "attachment") : String(f || "attachment");
                    const fileUrl = isObj ? (f.url || "") : "";
                    if (!fileUrl) {
                      return (
                        <span key={j} className="uidai-attachment-chip">
                          📎 {name}
                        </span>
                      );
                    }
                    return (
                      <button
                        key={j}
                        type="button"
                        className="uidai-attachment-chip"
                        onClick={async () => {
                          try {
                            await downloadAttachment(fileUrl, name);
                          } catch (err) {
                            // eslint-disable-next-line no-console
                            console.error("[downloadAttachment]", fileUrl, err);
                            window.alert(err?.message || "Failed to download attachment.");
                          }
                        }}
                        style={{ cursor: "pointer", font: "inherit" }}
                        title={`Download ${name}`}
                      >
                        📎 {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}