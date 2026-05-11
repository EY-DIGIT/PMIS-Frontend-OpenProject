/* Dashboard mock data — verbatim port of PMIS_Screens / Dashboard.html
   (commit 2026-05-08, lines 349-544). Used until the backend exposes a
   real dashboard summary endpoint. See backend-dashboard-apis.md for the
   ask. When the API lands, Dashboard.jsx can swap `mockDashboardProjects`
   for the adapted output of `useProjects()` in one line. */

const hand = [
  {
    id:"PRJ001", name:"Aadhaar Enrolment Portal Revamp",
    description:"Modernise the citizen-facing enrolment portal with new UX, mobile flows and operator console.",
    organisation:"EY", division:"TMD-I", owner:"R. Kumar", status:"PUBLISHED",
    plannedStart:"2026-01-05", plannedEnd:"2026-05-10", actualStart:"2026-01-05",
    milestones:[
      {name:"Discovery and Design", plannedStart:"2026-01-05", plannedEnd:"2026-02-28", activities:[
        {name:"Stakeholder Interviews", owner:"TMD-I", vendor:"EY", approvalState:"completed", tasks:[
          {name:"Interview Operations Team", plannedStart:"2026-01-05", plannedEnd:"2026-01-12", actualStart:"2026-01-05", actualEnd:"2026-01-11"},
          {name:"Interview Field Officers", plannedStart:"2026-01-13", plannedEnd:"2026-01-20", actualStart:"2026-01-13", actualEnd:"2026-01-22"}
        ]},
        {name:"UX Wireframes", owner:"TMD-I", vendor:"EY", approvalState:"completed", tasks:[
          {name:"Mobile flow wireframes", plannedStart:"2026-02-01", plannedEnd:"2026-02-15", actualStart:"2026-02-01", actualEnd:"2026-02-14"},
          {name:"Desktop flow wireframes", plannedStart:"2026-02-10", plannedEnd:"2026-02-25", actualStart:"2026-02-10", actualEnd:"2026-02-26"}
        ]}
      ]},
      {name:"Build and Deploy", plannedStart:"2026-03-01", plannedEnd:"2026-04-15", activities:[
        {name:"Frontend Development", owner:"TMD-I", vendor:"EY", approvalState:"pending_division", tasks:[
          {name:"Citizen registration screens", plannedStart:"2026-03-01", plannedEnd:"2026-03-25", actualStart:"2026-03-01"},
          {name:"Operator console screens", plannedStart:"2026-03-10", plannedEnd:"2026-04-05", actualStart:"2026-03-10"},
          {name:"Admin dashboard", plannedStart:"2026-03-20", plannedEnd:"2026-04-15"}
        ]},
        {name:"Backend Services", owner:"TMD-I", vendor:"EY", approvalState:"idle", tasks:[
          {name:"Auth service", plannedStart:"2026-03-01", plannedEnd:"2026-03-20", actualStart:"2026-03-01", actualEnd:"2026-03-22"},
          {name:"Enrolment service", plannedStart:"2026-03-15", plannedEnd:"2026-04-10", actualStart:"2026-03-15"}
        ]}
      ]},
      {name:"Sign-off and Handover", plannedStart:"2026-04-20", plannedEnd:"2026-05-10", activities:[
        {name:"UAT and Approval", owner:"PMC", vendor:"EY", approvalState:"idle", tasks:[
          {name:"Run UAT cycles", plannedStart:"2026-04-20", plannedEnd:"2026-05-05"},
          {name:"Final sign-off", plannedStart:"2026-05-06", plannedEnd:"2026-05-10"}
        ]}
      ]}
    ]
  },
  {
    id:"PRJ002", name:"Vendor Compliance Portal",
    description:"Single portal for empanelled vendors to submit compliance documents and respond to reviewer queries.",
    organisation:"Wipro", division:"TMD-II", owner:"S. Sharma", status:"PUBLISHED",
    plannedStart:"2026-02-01", plannedEnd:"2026-04-30", actualStart:"2026-02-01",
    milestones:[
      {name:"Requirements", plannedStart:"2026-02-01", plannedEnd:"2026-02-25", activities:[
        {name:"Compliance Audit", owner:"TMD-II", vendor:"Wipro", approvalState:"completed", tasks:[
          {name:"Map vendor compliance items", plannedStart:"2026-02-01", plannedEnd:"2026-02-10", actualStart:"2026-02-01", actualEnd:"2026-02-09"},
          {name:"Define risk scoring", plannedStart:"2026-02-11", plannedEnd:"2026-02-20", actualStart:"2026-02-11", actualEnd:"2026-02-21"}
        ]}
      ]},
      {name:"Implementation", plannedStart:"2026-03-01", plannedEnd:"2026-04-15", activities:[
        {name:"Portal Build", owner:"TMD-II", vendor:"Wipro", approvalState:"pending_owner", tasks:[
          {name:"Vendor self-service screens", plannedStart:"2026-03-01", plannedEnd:"2026-03-25", actualStart:"2026-03-01"},
          {name:"Reviewer workflow", plannedStart:"2026-03-15", plannedEnd:"2026-04-10"}
        ]},
        {name:"Integrations", owner:"TMD-II", vendor:"Wipro", approvalState:"idle", tasks:[
          {name:"Integrate with master vendor DB", plannedStart:"2026-03-10", plannedEnd:"2026-04-01", actualStart:"2026-03-10"}
        ]}
      ]}
    ]
  },
  {
    id:"PRJ003", name:"Internal Audit Tracker",
    description:"Plan and follow audit cycles with milestone based reporting.",
    organisation:"Deloitte", division:"Audit", owner:"A. Patel", status:"NEW",
    plannedStart:"2026-04-15", plannedEnd:"2026-06-10",
    milestones:[
      {name:"Planning", plannedStart:"2026-04-15", plannedEnd:"2026-05-05", activities:[
        {name:"Scoping", owner:"Audit", vendor:"Deloitte", approvalState:"idle", tasks:[
          {name:"Define audit scope", plannedStart:"2026-04-15", plannedEnd:"2026-04-25"},
          {name:"Identify auditors", plannedStart:"2026-04-20", plannedEnd:"2026-04-30"}
        ]}
      ]}
    ]
  },
  {
    id:"PRJ004", name:"Biometric Authentication Upgrade",
    description:"Upgrade fingerprint and iris matching engines and migrate auth services.",
    organisation:"Tech Mahindra", division:"Operations", owner:"V. Singh", status:"PUBLISHED",
    plannedStart:"2026-01-15", plannedEnd:"2026-04-15", actualStart:"2026-01-15",
    milestones:[
      {name:"Research and POC", plannedStart:"2026-01-15", plannedEnd:"2026-03-15", activities:[
        {name:"Algorithm Evaluation", owner:"Operations", vendor:"Tech Mahindra", approvalState:"completed", tasks:[
          {name:"Benchmark fingerprint algos", plannedStart:"2026-01-15", plannedEnd:"2026-02-10", actualStart:"2026-01-15", actualEnd:"2026-02-08"},
          {name:"Benchmark iris algos", plannedStart:"2026-02-01", plannedEnd:"2026-02-25", actualStart:"2026-02-01", actualEnd:"2026-02-24"}
        ]},
        {name:"POC Development", owner:"Operations", vendor:"Tech Mahindra", approvalState:"completed", tasks:[
          {name:"Build POC harness", plannedStart:"2026-02-20", plannedEnd:"2026-03-15", actualStart:"2026-02-20", actualEnd:"2026-03-14"}
        ]}
      ]},
      {name:"Production Rollout", plannedStart:"2026-03-15", plannedEnd:"2026-04-15", activities:[
        {name:"Migration", owner:"Operations", vendor:"Tech Mahindra", approvalState:"rejected", tasks:[
          {name:"Migrate auth service", plannedStart:"2026-03-15", plannedEnd:"2026-04-08", actualStart:"2026-03-15"},
          {name:"Cutover prod traffic", plannedStart:"2026-04-09", plannedEnd:"2026-04-15"}
        ]}
      ]}
    ]
  },
  {
    id:"PRJ005", name:"Citizen Grievance Module",
    description:"New grievance submission and tracking module with SLA escalation.",
    organisation:"TCS", division:"TMD-II", owner:"P. Joshi", status:"PUBLISHED",
    plannedStart:"2026-02-05", plannedEnd:"2026-05-15", actualStart:"2026-02-05",
    milestones:[
      {name:"Product Definition", plannedStart:"2026-02-05", plannedEnd:"2026-03-08", activities:[
        {name:"Workflow Design", owner:"TMD-II", vendor:"TCS", approvalState:"completed", tasks:[
          {name:"Map current grievance flow", plannedStart:"2026-02-05", plannedEnd:"2026-02-20", actualStart:"2026-02-05", actualEnd:"2026-02-19"},
          {name:"Design new SLA structure", plannedStart:"2026-02-15", plannedEnd:"2026-03-05", actualStart:"2026-02-15", actualEnd:"2026-03-08"}
        ]}
      ]},
      {name:"Build Phase 1", plannedStart:"2026-03-10", plannedEnd:"2026-04-15", activities:[
        {name:"Citizen Submission", owner:"TMD-II", vendor:"TCS", approvalState:"pending_division", tasks:[
          {name:"Submission form", plannedStart:"2026-03-10", plannedEnd:"2026-03-30", actualStart:"2026-03-10"},
          {name:"Tracking screens", plannedStart:"2026-03-20", plannedEnd:"2026-04-10"}
        ]},
        {name:"Officer Console", owner:"Operations", vendor:"TCS", approvalState:"idle", tasks:[
          {name:"Triage queue", plannedStart:"2026-03-15", plannedEnd:"2026-04-05", actualStart:"2026-03-15"}
        ]}
      ]}
    ]
  },
  {
    id:"PRJ006", name:"Field Office Data Sync",
    description:"Resilient sync agent for field offices with intermittent connectivity.",
    organisation:"Infosys", division:"TMD-I", owner:"R. Kumar", status:"NEW",
    plannedStart:"2026-04-10", plannedEnd:"2026-06-30",
    milestones:[
      {name:"Discovery", plannedStart:"2026-04-10", plannedEnd:"2026-05-10", activities:[
        {name:"Field Survey", owner:"TMD-I", vendor:"Infosys", approvalState:"idle", tasks:[
          {name:"Visit 5 pilot offices", plannedStart:"2026-04-10", plannedEnd:"2026-04-30"},
          {name:"Collect site readiness data", plannedStart:"2026-04-15", plannedEnd:"2026-05-05"}
        ]}
      ]}
    ]
  },
];

function buildProject(id, name, organisation, division, owner, type, n) {
  const completed = type === "completed";
  const delayed = type === "delayed";
  const active = type === "active";
  const start = completed ? "2026-01-10" : delayed ? "2026-02-15" : active ? "2026-05-20" : "2026-04-20";
  const end = completed ? "2026-04-20" : delayed ? "2026-04-25" : active ? "2026-07-15" : "2026-07-20";
  const doneEnd = completed ? "2026-04-18" : null;
  const liveStart = active ? null : start;
  const taskOne = completed
    ? {name:"Baseline validation", plannedStart:start, plannedEnd:"2026-02-05", actualStart:start, actualEnd:"2026-02-04"}
    : {name:"Baseline validation", plannedStart:start, plannedEnd:delayed ? "2026-04-02" : "2026-06-10", actualStart:liveStart};
  const taskTwo = completed
    ? {name:"Configuration review", plannedStart:"2026-02-06", plannedEnd:"2026-03-05", actualStart:"2026-02-06", actualEnd:"2026-03-04"}
    : {name:"Configuration review", plannedStart:delayed ? "2026-03-10" : "2026-05-15", plannedEnd:delayed ? "2026-04-10" : "2026-06-25", actualStart:active ? null : (delayed ? "2026-03-10" : "2026-05-15"),
       subtasks:[
         {name:"Prepare review checklist", plannedStart:delayed ? "2026-03-10" : "2026-05-15", plannedEnd:delayed ? "2026-03-24" : "2026-06-01", actualStart:active ? null : (delayed ? "2026-03-10" : "2026-05-15"), actualEnd:delayed ? "2026-03-28" : null},
         {name:"Resolve review observations", plannedStart:delayed ? "2026-03-25" : "2026-06-02", plannedEnd:delayed ? "2026-04-10" : "2026-06-25", actualStart:active ? null : (delayed ? "2026-03-25" : "2026-06-02")}
       ]};
  const taskThree = completed
    ? {name:"Final sign-off", plannedStart:"2026-03-06", plannedEnd:"2026-04-20", actualStart:"2026-03-06", actualEnd:doneEnd}
    : {name:"Final sign-off", plannedStart:delayed ? "2026-04-11" : "2026-06-26", plannedEnd:delayed ? "2026-04-25" : "2026-07-20", actualStart:null};
  return {
    id, name, description:`${name} delivery tracked through milestone, activity, task and sub-task hierarchy.`,
    organisation, division, owner, status:completed ? "COMPLETED" : "PUBLISHED",
    plannedStart:start, plannedEnd:end,
    actualStart:completed || delayed || type === "ontrack" ? start : null,
    actualEnd:doneEnd,
    milestones:[
      {name:"Planning and Baseline", plannedStart:start, plannedEnd:completed ? "2026-03-05" : delayed ? "2026-04-10" : "2026-06-25", activities:[
        {name:"Scope and Configuration", owner:division, vendor:organisation, approvalState:completed ? "completed" : delayed && n % 2 ? "pending_division" : "idle", tasks:[taskOne, taskTwo]}
      ]},
      {name:"Rollout and Closure", plannedStart:completed ? "2026-03-06" : delayed ? "2026-04-11" : "2026-06-26", plannedEnd:end, activities:[
        {name:"Deployment and Sign-off", owner:division, vendor:organisation, approvalState:completed ? "completed" : delayed ? "pending_owner" : "idle", tasks:[taskThree]}
      ]}
    ]
  };
}

const generated = [
  ["PRJ007","KYC Reconciliation Service","KPMG","Audit","M. Iyer","completed"],
  ["PRJ008","Operator Training Platform","EY","PMC","S. Sharma","ontrack"],
  ["PRJ009","Resident Demographic Update","TCS","TMD-I","R. Kumar","completed"],
  ["PRJ010","Authentication Analytics Dashboard","Infosys","Operations","V. Singh","ontrack"],
  ["PRJ011","Aadhaar Seeding Monitor","Wipro","TMD-II","P. Joshi","completed"],
  ["PRJ012","Document Verification Queue","Deloitte","Audit","A. Patel","completed"],
  ["PRJ013","Field Kit Inventory Service","Tech Mahindra","Operations","V. Singh","ontrack"],
  ["PRJ014","Enrollment Centre Heatmap","EY","PMC","S. Sharma","completed"],
  ["PRJ015","Resident Consent Ledger","TCS","TMD-II","P. Joshi","ontrack"],
  ["PRJ016","Operator Attendance Sync","Infosys","TMD-I","R. Kumar","completed"],
  ["PRJ017","Exception Case Workflow","Wipro","TMD-II","S. Sharma","delayed"],
  ["PRJ018","Fraud Signal Review Board","KPMG","Audit","M. Iyer","ontrack"],
  ["PRJ019","Regional Office MIS Pack","Deloitte","PMC","A. Patel","completed"],
  ["PRJ020","Biometric Device Registry","Tech Mahindra","Operations","V. Singh","ontrack"],
  ["PRJ021","Aadhaar Letter Dispatch Tracker","TCS","Operations","P. Joshi","completed"],
  ["PRJ022","API Consumer Onboarding","Infosys","TMD-I","R. Kumar","ontrack"],
  ["PRJ023","Data Quality Correction Drive","EY","TMD-II","S. Sharma","ontrack"],
  ["PRJ024","Audit Evidence Repository","KPMG","Audit","M. Iyer","completed"],
  ["PRJ025","Grievance SLA Escalation","Wipro","PMC","P. Joshi","ontrack"],
  ["PRJ026","Enrollment Packet Reprocess","Tech Mahindra","Operations","V. Singh","delayed"],
  ["PRJ027","Division Approval Console","Deloitte","TMD-I","A. Patel","active"],
  ["PRJ028","UIDAI Knowledge Base Refresh","EY","PMC","S. Sharma","completed"],
  ["PRJ029","Mobile Number Update Flow","TCS","TMD-II","R. Kumar","ontrack"],
  ["PRJ030","Vendor Invoice Milestone Linkage","Infosys","PMC","P. Joshi","active"],
].map((args, i) => buildProject(...args, i));

export const mockDashboardProjects = [...hand, ...generated];
