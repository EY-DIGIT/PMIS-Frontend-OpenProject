/* ══════════════════════════════════════════════════════════════════
   ticketsMock.js — dummy data + reference catalogs for the Ticket &
   SLA Management screen (SRS §2.14, PMIS-FR-35…37).

   Everything here is placeholder data so the UI can be designed and
   demoed before the backend exists. Replace the TICKETS array and the
   catalog look-ups with real API calls when the service is ready.
   ══════════════════════════════════════════════════════════════════ */

/* Categories — Incident / Service Request / Change / Problem are the
   four mandated types (PMIS-FR-36). `configurable: true` flags that the
   catalog itself is editable (PMIS-FR-36.1); each carries its own SLA
   profile + approval workflow (PMIS-FR-36.2). */
export const CATEGORIES = [
  { code: "PMIS_SUPPORT", label: "PMIS Support", workflow: "SUPPORT", configurable: true },  
];

/* Priority drives SLA timelines + escalation path (PMIS-FR-37.2). The
   `respondMins` / `resolveMins` are the SLA windows per priority. */
export const PRIORITIES = [
  { code: "P1", label: "Critical", respondMins: 30, resolveMins: 240, escalation: "Manager → Head" },
  { code: "P2", label: "High", respondMins: 60, resolveMins: 480, escalation: "Lead → Manager" },
  { code: "P3", label: "Medium", respondMins: 240, resolveMins: 1440, escalation: "Assignee → Lead" },
  // { code: "P4", label: "Low", respondMins: 480, resolveMins: 2880, escalation: "Assignee" },
];

export const STATUSES = [
  { code: "OPEN", label: "Open" },
  { code: "IN_PROGRESS", label: "In Progress" },
  { code: "ON_HOLD", label: "On Hold" },
  { code: "RESOLVED", label: "Resolved" },
  { code: "CLOSED", label: "Closed" },
];

/* SLA health buckets (PMIS-FR-37.2 / .3) — derived from the time left
   against the resolve window. */
export const SLA_STATES = {
  ON_TRACK: { code: "ON_TRACK", label: "On Track" },
  AT_RISK: { code: "AT_RISK", label: "At Risk" },
  BREACHED: { code: "BREACHED", label: "Breached" },
  MET: { code: "MET", label: "Met" },
};

/* Assignee pool — skills + availability + open-ticket load feed the
   "intelligent routing" suggestion (PMIS-FR-37.4). */
export const ASSIGNEES = [
  { id: "U-01", name: "Anita Rao", skills: ["Network", "Incident"], available: true, load: 3 },
  { id: "U-02", name: "Vikram Singh", skills: ["Database", "Change"], available: true, load: 1 },
  { id: "U-03", name: "Priya Menon", skills: ["Application", "Problem"], available: false, load: 5 },
  { id: "U-04", name: "Rahul Nair", skills: ["Security", "Service Request"], available: true, load: 2 },
  { id: "U-05", name: "Sana Khan", skills: ["Infrastructure", "Change"], available: true, load: 4 },
];

export const PROJECTS = [
  { id: "PRJ-1001", name: "Aadhaar Enrolment Platform" },
  { id: "PRJ-1002", name: "eKYC Gateway Modernisation" },
  { id: "PRJ-1003", name: "Authentication SDK Rollout" },
];

/* A few task/activity references per project so a ticket can be linked
   to a project, task OR activity (PMIS-FR-35.1). */
export const LINKABLES = [
  { id: "ACT-2201", projectId: "PRJ-1001", kind: "Activity", name: "Biometric device onboarding" },
  { id: "TSK-3310", projectId: "PRJ-1001", kind: "Task", name: "Operator training module" },
  { id: "ACT-2208", projectId: "PRJ-1002", kind: "Activity", name: "API contract sign-off" },
  { id: "TSK-3402", projectId: "PRJ-1002", kind: "Task", name: "Load-test eKYC endpoint" },
  { id: "ACT-2215", projectId: "PRJ-1003", kind: "Activity", name: "SDK regression suite" },
];

/* Relative-minute offsets are baked into `createdAgoMins` / `dueInMins`
   so the mock renders consistent SLA timers without depending on the
   wall clock at module load. The page converts these to states. */
export const TICKETS = [
  {
    id: "TKT-5001",
    title: "Enrolment client crashes on fingerprint capture",
    category: "INCIDENT",
    priority: "P1",
    status: "IN_PROGRESS",
    projectId: "PRJ-1001",
    linkId: "ACT-2201",
    assigneeId: "U-01",
    parentId: null,
    description: "Operators report the enrolment client crashes intermittently when capturing the right-thumb fingerprint on v3.2 devices.",
    createdAgoMins: 95,
    dueInMins: 60,
    requester: "Field Ops — Jaipur",
  },
  {
    id: "TKT-5002",
    title: "Add bulk operator import to enrolment console",
    category: "SERVICE_REQUEST",
    priority: "P3",
    status: "OPEN",
    projectId: "PRJ-1001",
    linkId: "TSK-3310",
    assigneeId: "U-04",
    parentId: null,
    description: "Request to support CSV import of operators instead of one-by-one entry.",
    createdAgoMins: 300,
    dueInMins: 900,
    requester: "Training Cell",
  },
  {
    id: "TKT-5003",
    title: "Change request: bump eKYC API to v2 contract",
    category: "CHANGE",
    priority: "P2",
    status: "ON_HOLD",
    projectId: "PRJ-1002",
    linkId: "ACT-2208",
    assigneeId: "U-02",
    parentId: null,
    description: "Migrate the eKYC gateway to the v2 API contract. Requires CAB approval and a baseline update.",
    createdAgoMins: 600,
    dueInMins: 180,
    requester: "Integration Team",
  },
  {
    id: "TKT-5004",
    title: "Latency spikes on eKYC endpoint under load",
    category: "PROBLEM",
    priority: "P2",
    status: "IN_PROGRESS",
    projectId: "PRJ-1002",
    linkId: "TSK-3402",
    assigneeId: "U-03",
    parentId: null,
    description: "p99 latency exceeds 4s during peak. Suspect connection-pool exhaustion. Root-cause analysis in progress.",
    createdAgoMins: 720,
    dueInMins: -45,
    requester: "SRE",
  },
  {
    id: "TKT-5005",
    title: "Sub-issue: connection pool not released on timeout",
    category: "PROBLEM",
    priority: "P3",
    status: "OPEN",
    projectId: "PRJ-1002",
    linkId: "TSK-3402",
    assigneeId: "U-02",
    parentId: "TKT-5004",
    description: "Child of TKT-5004 — DB connections leak when the upstream call times out.",
    createdAgoMins: 540,
    dueInMins: 600,
    requester: "SRE",
  },
  {
    id: "TKT-5006",
    title: "SDK regression: OTP auth fails on Android 14",
    category: "INCIDENT",
    priority: "P2",
    status: "RESOLVED",
    projectId: "PRJ-1003",
    linkId: "ACT-2215",
    assigneeId: "U-03",
    parentId: null,
    description: "OTP-based auth returned error 412 on Android 14 devices. Fixed in SDK 4.1.2.",
    createdAgoMins: 2000,
    dueInMins: 0,
    requester: "QA",
  },
  {
    id: "TKT-5007",
    title: "Rotate signing certificate for Authentication SDK",
    category: "CHANGE",
    priority: "P1",
    status: "OPEN",
    projectId: "PRJ-1003",
    linkId: "ACT-2215",
    assigneeId: "U-05",
    parentId: null,
    description: "Production signing cert expires in 10 days. Coordinated change with baseline + contract governance sign-off.",
    createdAgoMins: 30,
    dueInMins: 200,
    requester: "Security Office",
  },
  {
    id: "TKT-5008",
    title: "Operator console shows stale enrolment count",
    category: "INCIDENT",
    priority: "P4",
    status: "CLOSED",
    projectId: "PRJ-1001",
    linkId: "TSK-3310",
    assigneeId: "U-01",
    parentId: null,
    description: "Dashboard count lagged by ~15 min due to cache TTL. Closed after cache tuning.",
    createdAgoMins: 5000,
    dueInMins: 0,
    requester: "Field Ops — Pune",
  },
];
