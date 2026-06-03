/* ══════════════════════════════════════════════════════════════════
   meetingsMock.js — mock data + persistence for Meeting Management.
   Ported from PMIS_Screens/Meeting_Management.html (the seed shapes
   for USERS, PROJECTS, MEETINGS are kept verbatim so the React port
   renders identical fixtures).

   Persistence: localStorage key "pmis_mock_meetings". Wipe via
   resetMeetingsStore().
   ══════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = "pmis_mock_meetings";
export const TODAY = "2026-05-12";

/* ─── Seed: users, projects, type/status meta ─── */
export const USERS = [
  { id: "u1", name: "R. Kumar", org: "UIDAI", division: "TMD-I", role: "Division Head" },
  { id: "u2", name: "S. Sharma", org: "UIDAI", division: "TMD-II", role: "Project Owner" },
  { id: "u3", name: "A. Patel", org: "UIDAI", division: "Audit", role: "Audit Lead" },
  { id: "u4", name: "V. Singh", org: "UIDAI", division: "Operations", role: "Operations Lead" },
  { id: "u5", name: "P. Joshi", org: "UIDAI", division: "TMD-II", role: "Project Owner" },
  { id: "u6", name: "N. Rao", org: "PMC (EY)", role: "PMC Lead" },
  { id: "u7", name: "M. Iyer", org: "PMC (EY)", role: "PMC Analyst" },
  { id: "u8", name: "D. Mehta", org: "MSP (Tech Mahindra)", role: "MSP SPOC" },
  { id: "u9", name: "K. Reddy", org: "MSP (Wipro)", role: "MSP SPOC" },
  { id: "u10", name: "S. Nair", org: "MSP (TCS)", role: "MSP SPOC" }
];
export const userById = (id) => USERS.find((u) => u.id === id);

export const ORG_OPTIONS = [
  "UIDAI",
  "PMC (EY)",
  "MSP (Tech Mahindra)",
  "MSP (Wipro)",
  "MSP (TCS)"
];

export const PROJECTS = [
  {
    id: "PRJ001",
    name: "Aadhaar Enrolment Portal Revamp",
    org: "EY",
    division: "TMD-I",
    milestones: [
      {
        name: "Discovery and Design",
        activities: [
          { id: "A101", name: "Stakeholder Interviews" },
          { id: "A102", name: "UX Wireframes" }
        ]
      },
      {
        name: "Build and Deploy",
        activities: [
          { id: "A103", name: "Frontend Development" },
          { id: "A104", name: "Backend Services" }
        ]
      },
      {
        name: "Sign-off and Handover",
        activities: [{ id: "A105", name: "UAT and Approval" }]
      }
    ]
  },
  {
    id: "PRJ002",
    name: "Vendor Compliance Portal",
    org: "Wipro",
    division: "TMD-II",
    milestones: [
      { name: "Requirements", activities: [{ id: "A201", name: "Compliance Audit" }] },
      {
        name: "Implementation",
        activities: [
          { id: "A202", name: "Portal Build" },
          { id: "A203", name: "Integrations" }
        ]
      }
    ]
  },
  {
    id: "PRJ003",
    name: "Internal Audit Tracker",
    org: "Deloitte",
    division: "Audit",
    milestones: [{ name: "Planning", activities: [{ id: "A301", name: "Scoping" }] }]
  },
  {
    id: "PRJ004",
    name: "Biometric Authentication Upgrade",
    org: "Tech Mahindra",
    division: "Operations",
    milestones: [
      {
        name: "Research and POC",
        activities: [
          { id: "A401", name: "Algorithm Evaluation" },
          { id: "A402", name: "POC Development" }
        ]
      },
      {
        name: "Rollout",
        activities: [
          { id: "A403", name: "Pilot Deployment" },
          { id: "A404", name: "Production Migration" }
        ]
      }
    ]
  },
  {
    id: "PRJ005",
    name: "Citizen Grievance Module",
    org: "TCS",
    division: "TMD-II",
    milestones: [
      { name: "Product Definition", activities: [{ id: "A501", name: "Workflow Design" }] },
      {
        name: "Build Phase 1",
        activities: [
          { id: "A502", name: "Citizen Submission" },
          { id: "A503", name: "Officer Console" }
        ]
      }
    ]
  },
  {
    id: "PRJ006",
    name: "Field Office Data Sync",
    org: "Infosys",
    division: "TMD-I",
    milestones: [{ name: "Discovery", activities: [{ id: "A601", name: "Field Survey" }] }]
  }
];
export const projectById = (id) => PROJECTS.find((p) => p.id === id);

export function activitiesOf(pid) {
  const p = projectById(pid);
  if (!p) return [];
  const out = [];
  p.milestones.forEach((m) =>
    m.activities.forEach((a) => out.push({ ...a, stage: m.name }))
  );
  return out;
}
export function activityName(pid, aid) {
  const a = activitiesOf(pid).find((x) => x.id === aid);
  return a ? a.name : aid;
}

export const TYPE_META = {
  Steering: { cls: "b-steering", desc: "Steering Committee oversight & key decisions" },
  Governance: { cls: "b-governance", desc: "Routine status, risks & progress reviews" },
  Migration: { cls: "b-migration", desc: "Data/system migration & cutover briefs" },
  "Ad-hoc": { cls: "b-adhoc", desc: "One-off or unscheduled discussion" }
};
export const STATUS_META = {
  Draft: { cls: "st-draft" },
  Scheduled: { cls: "st-scheduled" },
  "MoM Pending": { cls: "st-mom" },
  "Tasks Created": { cls: "st-tasks" },
  Completed: { cls: "st-completed" }
};
export const AIS_META = {
  Open: { cls: "ai-open" },
  "In Progress": { cls: "ai-progress" },
  Completed: { cls: "ai-completed" },
  Delayed: { cls: "ai-delayed" }
};

/* ─── Seed meetings ─── */
function buildSeed() {
  return [
    {
      id: "MTG-2026-001",
      title: "Q2 Steering Committee Review",
      type: "Steering",
      link: "project",
      projectId: "PRJ001",
      activityIds: ["A103", "A104"],
      date: "2026-05-06",
      start: "11:00",
      end: "12:00",
      location: "MS Teams — Steering Channel",
      agenda:
        "Review build progress, open risks on backend services, and sign-off readiness for UAT.",
      attendees: ["u1", "u6", "u7", "u8"],
      external: ["audit-observer@cag.gov.in"],
      status: "Tasks Created",
      mom:
        "Decisions:\n- Backend Services activity to be re-baselined; UAT entry gate moved to 20-May.\n- PMC to publish a consolidated risk register for the Build stage.\nActions:\n- N. Rao to circulate the updated risk register by 14-May.\n- D. Mehta will fix the enrolment service latency issue by 18-May.\n- R. Kumar to confirm UAT environment readiness by 20-May.\nRisks:\n- Auth service load test slipped; may impact UAT start.",
      actionItems: [
        {
          id: "AI-1",
          text: "Circulate the updated consolidated risk register for the Build stage.",
          ownerId: "u6",
          assignedOrg: "PMC (EY)",
          target: "2026-05-14",
          status: "Completed",
          activityId: "A103",
          comments: [
            { by: "N. Rao", t: "06 May", text: "Register drafted, sharing for review." },
            { by: "R. Kumar", t: "09 May", text: "Reviewed and approved." }
          ]
        },
        {
          id: "AI-2",
          text: "Fix the enrolment service latency issue flagged in load testing.",
          ownerId: "u8",
          assignedOrg: "MSP (Tech Mahindra)",
          target: "2026-05-18",
          status: "In Progress",
          activityId: "A104",
          comments: [
            {
              by: "D. Mehta",
              t: "08 May",
              text: "Root cause identified — connection pool sizing."
            }
          ]
        },
        {
          id: "AI-3",
          text: "Confirm UAT environment readiness and access provisioning.",
          ownerId: "u1",
          assignedOrg: "UIDAI",
          target: "2026-05-20",
          status: "Open",
          activityId: "A105",
          comments: []
        },
        {
          id: "AI-4",
          text: "Complete auth service load test and publish results.",
          ownerId: "u8",
          assignedOrg: "MSP (Tech Mahindra)",
          target: "2026-05-09",
          status: "Delayed",
          activityId: "A104",
          comments: [
            {
              by: "S. Sharma",
              t: "10 May",
              text: "Overdue — escalated to MSP delivery manager."
            }
          ]
        }
      ]
    },
    {
      id: "MTG-2026-002",
      title: "Migration Cutover Brief — Biometric Upgrade",
      type: "Migration",
      link: "project",
      projectId: "PRJ004",
      activityIds: ["A404"],
      date: "2026-05-11",
      start: "15:30",
      end: "16:30",
      location: "https://meet.google.com/abc-defg-hij",
      agenda:
        "Walk through the production migration runbook, rollback plan and freeze window.",
      attendees: ["u4", "u6", "u8"],
      external: [],
      status: "MoM Pending",
      mom: "",
      actionItems: []
    },
    {
      id: "MTG-2026-003",
      title: "Weekly Governance Sync (Cross-Project)",
      type: "Governance",
      link: "general",
      projectId: null,
      activityIds: [],
      date: "2026-05-13",
      start: "10:00",
      end: "10:45",
      location: "MS Teams — Governance Standup",
      agenda: "Cross-project status, blocker triage and SLA watch-list.",
      attendees: ["u1", "u2", "u5", "u6"],
      external: ["secretariat@meity.gov.in"],
      status: "Scheduled",
      mom: "",
      actionItems: []
    }
  ];
}

/* ─── Persistence ─── */
function load() {
  if (typeof window === "undefined" || !window.localStorage) return buildSeed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = buildSeed();
      save(seed);
      return seed;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seed = buildSeed();
      save(seed);
      return seed;
    }
    return parsed;
  } catch {
    return buildSeed();
  }
}
function save(items) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota */
  }
}

export function resetMeetingsStore() {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return load();
}

/* ─── Public API ─── */
export function listMeetings() {
  return load();
}

export function getMeeting(id) {
  return load().find((m) => m.id === id) || null;
}

export function createMeeting(payload) {
  const items = load();
  const seq = items.length + 1;
  const id = "MTG-2026-" + String(seq).padStart(3, "0");
  const meeting = {
    id,
    title: payload.title || "",
    type: payload.type || "Ad-hoc",
    link: payload.link || "general",
    projectId: payload.link === "project" ? payload.projectId || null : null,
    activityIds: payload.link === "project" ? payload.activityIds || [] : [],
    date: payload.date || "",
    start: payload.start || "",
    end: payload.end || "",
    location: payload.location || "",
    agenda: payload.agenda || "",
    attendees: payload.attendees || [],
    external: payload.external || [],
    status: "MoM Pending",
    mom: "",
    actionItems: []
  };
  items.push(meeting);
  save(items);
  return meeting;
}

export function updateMeeting(id, patch) {
  const items = load();
  const idx = items.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...patch };
  save(items);
  return items[idx];
}

/* ─── Helpers (date / status) ─── */
export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}
export function fmtDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
export function fmt12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
export function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isOverdue(item) {
  return item.status !== "Completed" && item.target && item.target < TODAY;
}

/* ─── Heuristic MoM → action items extractor (stand-in for the n8n
   workflow). Ported from the HTML — same rules. */
const ACTION_VERB = /\b(to|will|shall|must|needs? to|is to|are to|follow[- ]?up|prepare|share|provide|update|finali[sz]e|review|submit|deploy|fix|raise|schedule|circulate|complete|coordinate|confirm|publish|own|draft|investigate|escalate)\b/i;
const MONTHS_3 = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

export function extractActionItems(text, m) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim());
  const attendeeUsers = m.attendees.map((uid) => userById(uid)).filter(Boolean);
  const allNames = USERS.map((u) => u.name);
  const items = [];
  let section = "";
  lines.forEach((line) => {
    if (!line) return;
    const low = line.toLowerCase();
    if (/^decisions?\s*:?$/.test(low)) { section = "dec"; return; }
    if (/^actions?\s*:?$/.test(low) || /^action items?\s*:?$/.test(low)) {
      section = "act"; return;
    }
    if (/^risks?\s*:?$/.test(low)) { section = "risk"; return; }
    if (section === "risk") return;
    if (section === "dec" && !ACTION_VERB.test(line) && !/<owner>/i.test(line)) return;
    if (line.length < 6) return;
    if (/^<owner>/i.test(line)) return;

    let ownerId = null;
    for (const n of allNames) {
      if (line.includes(n)) {
        ownerId = USERS.find((x) => x.name === n).id;
        break;
      }
    }
    if (!ownerId) {
      const at = line.match(/@([A-Za-z][A-Za-z. ]+)/);
      if (at) {
        const cand = allNames.find((n) =>
          n.toLowerCase().startsWith(at[1].trim().toLowerCase().slice(0, 3))
        );
        if (cand) ownerId = USERS.find((x) => x.name === cand).id;
      }
    }
    if (!ownerId) {
      const fallback =
        attendeeUsers[items.length % Math.max(1, attendeeUsers.length)] || USERS[0];
      ownerId = fallback.id;
    }
    const owner = userById(ownerId);

    let target = "";
    const dm = low.match(/by\s+(\d{4}-\d{2}-\d{2})/);
    if (dm) target = dm[1];
    else {
      const md = low.match(/by\s+(\d{1,2})\s*[- ]?\s*([a-z]{3,})/);
      const dm2 = low.match(/by\s+([a-z]{3,})\s*[- ]?\s*(\d{1,2})/);
      if (md) {
        const day = +md[1];
        const mo = MONTHS_3[md[2].slice(0, 3)];
        if (mo != null) target = new Date(2026, mo, day).toISOString().slice(0, 10);
      } else if (dm2) {
        const day = +dm2[2];
        const mo = MONTHS_3[dm2[1].slice(0, 3)];
        if (mo != null) target = new Date(2026, mo, day).toISOString().slice(0, 10);
      }
    }
    if (!target) target = addDays(m.date || TODAY, 7);

    let txt = line.replace(/@([A-Za-z][A-Za-z. ]+)/, "").trim();
    txt = txt.replace(/\s+by\s+.*$/i, "").trim();
    if (owner) {
      txt = txt
        .replace(
          new RegExp("^" + owner.name.replace(/\./g, "\\.") + "\\s+(to|will|shall|is to)\\s+", "i"),
          ""
        )
        .trim();
    }
    txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    if (!/[.!?]$/.test(txt)) txt += ".";

    items.push({
      id: "PRO-" + (items.length + 1),
      text: txt,
      ownerId,
      assignedOrg: owner ? owner.org : "UIDAI",
      target,
      status: "Open",
      activityId:
        m.link === "project" && m.activityIds && m.activityIds.length
          ? m.activityIds[0]
          : null,
      comments: []
    });
  });
  return items;
}

/* ─── MoM text ⇄ structured form ─── */

/* Split a freeform MoM string into its three canonical sections —
   Decisions / Actions / Risks. Any leading bullet (`-`, `*`, `•`) is
   stripped from each line so the form starts clean. Unknown lines
   before a header land in the first section the parser hits, then
   default to Decisions if there is no header at all (matches the
   sample's flow). */
export function parseMoM(text) {
  const out = { decisions: "", actions: "", risks: "" };
  if (!text) return out;
  const lines = String(text).split(/\r?\n/);
  let section = "";
  const buckets = { decisions: [], actions: [], risks: [] };
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const low = line.toLowerCase();
    if (/^decisions?\s*:?$/.test(low)) { section = "decisions"; return; }
    if (/^actions?\s*:?$/.test(low) || /^action items?\s*:?$/.test(low)) { section = "actions"; return; }
    if (/^risks?\s*:?$/.test(low)) { section = "risks"; return; }
    const cleaned = line.replace(/^[-*•]\s*/, "");
    const target = buckets[section] || buckets.decisions;
    target.push(cleaned);
  });
  out.decisions = buckets.decisions.join("\n");
  out.actions = buckets.actions.join("\n");
  out.risks = buckets.risks.join("\n");
  return out;
}

/* Compose the three form sections back into the canonical block
   format the AI extractor + downstream consumers expect. Empty
   sections are dropped so we don't emit naked headers. */
export function composeMoM({ decisions, actions, risks } = {}) {
  const block = (label, body) => {
    const lines = String(body || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return "";
    return `${label}:\n` + lines.map((l) => `- ${l.replace(/^[-*•]\s*/, "")}`).join("\n");
  };
  return [
    block("Decisions", decisions),
    block("Actions", actions),
    block("Risks", risks)
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sampleMoM(m) {
  const owners = (m.attendees || [])
    .map((uid) => userById(uid)?.name)
    .filter(Boolean);
  const o1 = owners[0] || "R. Kumar";
  const o2 = owners[1] || "N. Rao";
  const o3 = owners[2] || "D. Mehta";
  const base = m.date || TODAY;
  const d1 = addDays(base, 3);
  const d2 = addDays(base, 7);
  const d3 = addDays(base, 10);
  return (
    "Decisions:\n" +
    "- Proceed with the planned scope; no change to milestone baseline this cycle.\n" +
    `- ${o2} to own the consolidated status pack for the next review.\n\n` +
    "Actions:\n" +
    `- ${o1} to confirm environment readiness and access provisioning by ${fmtDateShort(d1)}.\n` +
    `- ${o3} will fix the open performance issue and share test results by ${fmtDateShort(d2)}.\n` +
    `- ${o2} to circulate the updated risk register and decision log by ${fmtDateShort(d3)}.\n\n` +
    "Risks:\n" +
    "- Dependency on third-party sign-off may slip the timeline; track closely."
  );
}
