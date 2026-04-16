// ============================================================
// UIDAI PMIS - MainApp Component
// All app logic, state, and UI extracted from App.js
// ============================================================

import { useState } from "react";
import ActivityPage from "../components/ActivityPage";
import Btn from "../components/Btn";
import CommentsPanel from "../components/CommentsPanel";
import CreateVersionModal from "../components/CreateVersionModal";
import DeleteProjectModal from "../components/DeleteProjectModal";
import Field from "../components/Field";
import LoaderModal from "../components/LoaderModal";
import MessageModal from "../components/MessageModal";
import MilestoneConfig from "../components/MilestoneConfig";
import NodePopup from "../components/NodePopup";
import OnboardingForm from "../components/OnboardingForm";
import ProjectDetails from "../components/ProjectDetails";
import ProjectTable from "../components/ProjectTable";
import PublishModal from "../components/PublishModal";
import Sidebar from "../components/Sidebar";
import SubtaskCard from "../components/SubtaskCard";
import TaskModal from "../components/TaskModal";
import Aadhar from "../assets/Aadhaar.png";
import Logo from "../assets/logo.avif";

// ─── Utility Functions ────────────────────────────────────────
const deepClone = (o) => JSON.parse(JSON.stringify(o));
const safeArr = (v) => (Array.isArray(v) ? v : []);
const uid = (p) =>
  `${p}-${Math.random().toString(36).slice(2, 11)}-${Date.now().toString(36)}`;
const fmtDate = (d) => {
  if (!d || d === "-") return "-";
  const p = String(d).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
};
const fmtDT = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB");
};

function ensureFlags(n, exp) {
  if (!n) return n;
  if (!("actualStartDate" in n)) n.actualStartDate = "";
  if (!("actualEndDate" in n)) n.actualEndDate = "";
  if (!Array.isArray(n.comments)) n.comments = [];
  if (!("expanded" in n)) n.expanded = exp;
  return n;
}

function normalizeProject(p) {
  if (!p) return p;
  if (!p.auditLogs) p.auditLogs = [];
  if (!("isVersion" in p)) p.isVersion = false;
  if (!("versionOf" in p)) p.versionOf = "";
  if (!("versionNo" in p)) p.versionNo = 0;
  if (!("actualEndDate" in p)) p.actualEndDate = "";
  if (!p.baselineId) p.baselineId = "-";
  p.milestones = safeArr(p.milestones);
  p.milestones.forEach((m, mi) => {
    if (!m.uid) m.uid = uid("m");
    m.id = `M${mi + 1}`;
    ensureFlags(m, true);
    m.activities = safeArr(m.activities);
    m.activities.forEach((a, ai) => {
      if (!a.uid) a.uid = uid("a");
      a.id = `A${mi + 1}.${ai + 1}`;
      ensureFlags(a, true);
      a.tasks = safeArr(a.tasks);
      a.tasks.forEach((t, ti) => {
        if (!t.uid) t.uid = uid("t");
        t.id = `T${mi + 1}.${ai + 1}.${ti + 1}`;
        ensureFlags(t, false);
        t.subtasks = safeArr(t.subtasks);
        t.subtasks.forEach((s, si) => {
          if (!s.uid) s.uid = uid("s");
          s.id = `S${mi + 1}.${ai + 1}.${ti + 1}.${si + 1}`;
          ensureFlags(s, false);
        });
      });
    });
  });
  return p;
}

function renumber(p) {
  if (!p) return;
  p.milestones = safeArr(p.milestones);
  p.milestones.forEach((m, mi) => {
    m.id = `M${mi + 1}`;
    m.activities = safeArr(m.activities);
    m.activities.forEach((a, ai) => {
      a.id = `A${mi + 1}.${ai + 1}`;
      a.tasks = safeArr(a.tasks);
      a.tasks.forEach((t, ti) => {
        t.id = `T${mi + 1}.${ai + 1}.${ti + 1}`;
        t.subtasks = safeArr(t.subtasks);
        t.subtasks.forEach((s, si) => {
          s.id = `S${mi + 1}.${ai + 1}.${ti + 1}.${si + 1}`;
        });
      });
    });
  });
}

function findByUid(list, id) {
  for (const item of safeArr(list)) {
    if (item.uid === id) return item;
    const f =
      findByUid(item.activities || [], id) ||
      findByUid(item.tasks || [], id) ||
      findByUid(item.subtasks || [], id);
    if (f) return f;
  }
  return null;
}

function findTaskOwner(project, taskUid) {
  for (const m of safeArr(project?.milestones)) {
    for (const a of safeArr(m.activities)) {
      const t = safeArr(a.tasks).find((x) => x.uid === taskUid);
      if (t) return { milestone: m, activity: a, task: t };
    }
  }
  return null;
}

function findSubtaskOwner(project, sUid) {
  for (const m of safeArr(project?.milestones)) {
    for (const a of safeArr(m.activities)) {
      for (const t of safeArr(a.tasks)) {
        const s = safeArr(t.subtasks).find((x) => x.uid === sUid);
        if (s) return { milestone: m, activity: a, task: t, subtask: s };
      }
    }
  }
  return null;
}

function rootId(p) {
  if (!p) return "";
  if (p.versionOf) return p.versionOf;
  return String(p.projectId || "").split("-V")[0];
}

function addAudit(p, action, before, after) {
  if (!p) return;
  p.auditLogs = p.auditLogs || [];
  p.auditLogs.unshift({
    when: new Date().toISOString(),
    who: "Admin",
    action,
    before,
    after,
  });
}

// ─── Initial Demo Data ────────────────────────────────────────
const INITIAL_PROJECTS = [
  {
    projectId: "PRJ001",
    projectName: "Test Project Alpha",
    baselineId: "-",
    description: "Testing description alpha",
    status: "NEW",
    owner: "Admin",
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    actualEndDate: "",
    isPublic: "Yes",
    category: "MSAP",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    milestones: [
      {
        id: "M1",
        name: "Initiation",
        description: "Set up the project, confirm scope, and secure approvals.",
        startDate: "2026-04-01",
        endDate: "2026-04-05",
        activities: [
          {
            id: "A1.1",
            name: "Requirement Collection",
            description: "Collect and confirm functional requirements.",
            startDate: "2026-04-01",
            endDate: "2026-04-02",
            type: "Standard Type",
            tasks: [
              {
                id: "T1.1.1",
                name: "Gather Reference Documents",
                description:
                  "Collect policy documents, forms, and baseline references.",
                startDate: "2026-04-01",
                endDate: "2026-04-01",
                type: "Standard Type",
                subtasks: [],
              },
              {
                id: "T1.1.2",
                name: "Stakeholder Confirmation",
                description:
                  "Finalize internal and external stakeholder list.",
                startDate: "2026-04-02",
                endDate: "2026-04-02",
                type: "Resource Type",
                subtasks: [],
              },
            ],
          },
          {
            id: "A1.2",
            name: "Kickoff Preparation",
            description:
              "Prepare agenda, invite participants, and finalize kickoff materials.",
            startDate: "2026-04-03",
            endDate: "2026-04-04",
            type: "Resource Type",
            tasks: [
              {
                id: "T1.2.1",
                name: "Agenda Drafting",
                description:
                  "Draft the kickoff agenda and circulate for review.",
                startDate: "2026-04-03",
                endDate: "2026-04-03",
                type: "Standard Type",
                subtasks: [],
              },
            ],
          },
        ],
      },
      {
        id: "M2",
        name: "Execution",
        description: "Core delivery and operational implementation phase.",
        startDate: "2026-04-06",
        endDate: "2026-04-18",
        activities: [
          {
            id: "A2.1",
            name: "Configuration Setup",
            description:
              "Configure settings and validate implementation readiness.",
            startDate: "2026-04-06",
            endDate: "2026-04-10",
            type: "Transactional Type",
            tasks: [
              {
                id: "T2.1.1",
                name: "Environment Preparation",
                description: "Prepare the environment for execution.",
                startDate: "2026-04-08",
                endDate: "2026-04-08",
                type: "Standard Type",
                subtasks: [],
              },
              {
                id: "T2.1.2",
                name: "Validation Check",
                description: "Perform sanity validation after setup.",
                startDate: "2026-04-10",
                endDate: "2026-04-10",
                type: "Resource Type",
                subtasks: [],
              },
            ],
          },
          {
            id: "A2.2",
            name: "Functional Testing",
            description:
              "Test the configured flows against expected behavior.",
            startDate: "2026-04-11",
            endDate: "2026-04-16",
            type: "Standard Type",
            tasks: [
              {
                id: "T2.2.1",
                name: "Regression Test",
                description: "Run regression checks for impacted flows.",
                startDate: "2026-04-14",
                endDate: "2026-04-14",
                type: "Transactional Type",
                subtasks: [],
              },
              {
                id: "T2.2.2",
                name: "Defect Closure",
                description: "Fix and re-verify test defects.",
                startDate: "2026-04-16",
                endDate: "2026-04-16",
                type: "Resource Type",
                subtasks: [],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    projectId: "PRJ002",
    projectName: "Test Project Beta",
    baselineId: "-",
    description: "Testing description beta",
    status: "INPROGRESS",
    owner: "Supervisor",
    startDate: "2026-05-01",
    endDate: "2026-05-20",
    actualEndDate: "",
    isPublic: "No",
    category: "MSIP",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    milestones: [
      {
        id: "M1",
        name: "Planning",
        description: "Planning and approvals.",
        startDate: "2026-05-01",
        endDate: "2026-05-04",
        activities: [
          {
            id: "A1.1",
            name: "Scope Finalization",
            description: "Finalize the project scope.",
            startDate: "2026-05-02",
            endDate: "2026-05-03",
            type: "Standard Type",
            tasks: [
              {
                id: "T1.1.1",
                name: "Scope Review",
                description: "Review all planned deliverables.",
                startDate: "2026-05-02",
                endDate: "2026-05-02",
                type: "Standard Type",
                subtasks: [],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    projectId: "PRJ003",
    projectName: "Test Project Gamma",
    baselineId: "-",
    description: "Testing description gamma",
    status: "NEW",
    owner: "Manager",
    startDate: "2026-06-01",
    endDate: "2026-06-25",
    actualEndDate: "",
    isPublic: "Yes",
    category: "BSP",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    milestones: [],
  },
  {
    projectId: "PRJ004",
    projectName: "Test Project Delta",
    baselineId: "-",
    description: "Testing description delta",
    status: "CLOSED",
    owner: "Lead",
    startDate: "2026-07-01",
    endDate: "2026-07-18",
    actualEndDate: "",
    isPublic: "No",
    category: "MSAP",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    milestones: [],
  },
].map((p) => normalizeProject(deepClone(p)));

// ─── MainApp Component ────────────────────────────────────────
export default function MainApp() {
  const [projects, setProjects] = useState(() =>
    INITIAL_PROJECTS.map((p) => normalizeProject(deepClone(p)))
  );
  const [view, setView] = useState("blank");
  const [selectedId, setSelectedId] = useState(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [onboardDraft, setOnboardDraft] = useState(null);
  const [onboardCategory, setOnboardCategory] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState(null);
  const [msg, setMsg] = useState(null);
  const [modal, setModal] = useState(null);

  const findProj = (id) => projects.find((p) => p.projectId === id);

  const mutate = (p) =>
    setProjects((ps) =>
      ps.map((x) =>
        x.projectId === p.projectId ? deepClone(normalizeProject(p)) : x
      )
    );

  const withLoader = (label, workFn, message, onOk) => {
    setLoader(label || "Loading");
    setTimeout(() => {
      try {
        workFn();
      } finally {
        setLoader(null);
        setMsg({ text: message, onOk: onOk || null });
      }
    }, 900);
  };

  const showMsg = (text, onOk) => setMsg({ text, onOk: onOk || null });

  const getNextId = () => {
    const max = projects.reduce((a, p) => {
      const m = String(p.projectId || "").match(/^PRJ(\d+)(?:-V\d+)?$/i);
      return m ? Math.max(a, parseInt(m[1], 10)) : a;
    }, 0);
    return `PRJ${String(max + 1).padStart(3, "0")}`;
  };

  const getNextVerId = (baseId) => {
    const sameRoot = projects.filter((p) => rootId(p) === baseId);
    let maxV = 0;
    sameRoot.forEach((p) => {
      const m = String(p.projectId || "").match(/-V(\d+)$/i);
      if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
    });
    return `${baseId}-V${maxV + 1}`;
  };

  const openDetails = (id) => {
    setSelectedId(id);
    setView("details");
    setEditingDetails(false);
  };

  const openConfig = (id) => {
    setSelectedId(id);
    setView("config");
    setEditingConfig(false);
  };

  const handleOnboardStart = (type) => {
    setOnboardCategory(type);
    setOnboardDraft(null);
    setView("onboarding-form");
  };

  const handleOnboardNext = (data) => {
    setOnboardDraft(data);
    setView("onboarding-config");
  };

  const handleFinalize = (draft) => {
    if (!safeArr(draft.milestones).length) {
      showMsg("Add at least one milestone before onboarding");
      return;
    }
    withLoader(
      "Saving project…",
      () => {
        const p = deepClone(draft);
        p.projectId = getNextId();
        p.status = "NEW";
        p.baselineId = "-";
        p.auditLogs = [];
        normalizeProject(p);
        setProjects((ps) => [p, ...ps]);
        setView("table");
        setOnboardDraft(null);
      },
      `Project onboarded successfully`,
      () => {
        setView("table");
      }
    );
  };

  const handleDetailsSave = (form, errMsg) => {
    if (errMsg) {
      showMsg(errMsg);
      return;
    }
    const p = findProj(selectedId);
    if (!p) return;
    withLoader(
      "Saving project details…",
      () => {
        const before = deepClone(p);
        if (p.isVersion) {
          p.owner = form.owner;
          p.isPublic = form.isPublic;
          p.actualEndDate = form.actualEndDate;
        } else {
          p.projectName = form.projectName;
          p.description = form.description;
          p.owner = form.owner;
          p.startDate = form.startDate;
          p.endDate = form.endDate;
          p.isPublic = form.isPublic;
        }
        addAudit(p, "Update Project Details", before, deepClone(p));
        mutate(p);
        setEditingDetails(false);
      },
      "Project details saved"
    );
  };

  const handlePublish = (id) => setModal({ type: "publish", projectId: id });

  const confirmPublish = (id) => {
    const p = findProj(id);
    if (!p) return;
    setModal(null);
    withLoader(
      "Publishing project…",
      () => {
        const before = deepClone(p);
        p.status = "PUBLISHED";
        p.baselineId = "-";
        addAudit(p, "Publish Project", before, deepClone(p));
        mutate(p);
      },
      "Project published successfully",
      () => openConfig(id)
    );
  };

  const handleDelete = (id) => setModal({ type: "delete", projectId: id });

  const confirmDelete = (id) => {
    setModal(null);
    setProjects((ps) => ps.filter((p) => p.projectId !== id));
    setView("table");
  };

  const handleCreateVersion = (id) =>
    setModal({ type: "version", projectId: id });

  const confirmCreateVersion = (id) => {
    const orig = findProj(id);
    if (!orig) return;
    setModal(null);
    withLoader(
      "Creating version…",
      () => {
        const clone = deepClone(orig);
        const baseId = rootId(orig);
        clone.projectId = getNextVerId(baseId);
        clone.versionOf = baseId;
        clone.isVersion = true;
        clone.versionNo = (orig.versionNo || 0) + 1;
        clone.baselineId = baseId;
        clone.actualEndDate = "";
        clone.status = "NEW";
        clone.auditLogs = [];
        normalizeProject(clone);
        setProjects((ps) => [clone, ...ps]);
      },
      `Version created successfully`,
      () => {}
    );
  };

  const onConfigUpdated = (p, message) => {
    mutate(p);
    if (message) showMsg(message);
  };

  const handleToggleConfigEdit = () => {
    if (!editingConfig) {
      setEditingConfig(true);
      return;
    }
    const p = findProj(selectedId);
    if (!p) return;
    withLoader(
      "Saving milestone configuration…",
      () => {
        renumber(p);
        addAudit(
          p,
          "Save Milestone Configuration",
          "-",
          deepClone(p.milestones)
        );
        mutate(p);
        setEditingConfig(false);
      },
      "Milestone configuration saved"
    );
  };

  const project = selectedId ? findProj(selectedId) : null;

  return (
    <div className="pmis-wrap" onClick={() => setProfileOpen(false)}>
      {/* Header */}
      <div className="pmis-header">
        <img src={Logo} alt="Logo" className="logo-left" />
        <strong>UIDAI Automation Governance Tool</strong>
        <img src={Aadhar} alt="Aadhar" className="logo-right" />
      </div>

      {/* Navbar */}
      <div className="pmis-navbar">
        <div className="pmis-menu-home-block">
          <span onClick={() => setCollapsed(!collapsed)}>☰ Menu</span>
          <span onClick={() => setView("blank")}>🏠 Home</span>
        </div>
        <div
          className="pmis-profile"
          onClick={(e) => {
            e.stopPropagation();
            setProfileOpen(!profileOpen);
          }}
        >
          👤
          <div className={`pmis-profile-menu${profileOpen ? " open" : ""}`}>
            <div>Profile</div>
            <div>Sign Out</div>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="pmis-layout">
        <Sidebar
          collapsed={collapsed}
          onAddProject={handleOnboardStart}
          onSearchProject={() => setView("table")}
        />

        <div className="pmis-content">
          {view === "blank" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "80%",
                flexDirection: "column",
                gap: 16,
                color: "#66788f",
              }}
            >
              <div style={{ fontSize: 48 }}>🏛️</div>
              <div
                style={{ fontSize: 20, fontWeight: 800, color: "#173e77" }}
              >
                UIDAI Automation Governance Tool
              </div>
              <div style={{ fontSize: 14 }}>
                Select a module from the sidebar to get started
              </div>
            </div>
          )}

          {view === "table" && (
            <ProjectTable
              projects={projects}
              onOpen={openDetails}
              query={query}
              setQuery={setQuery}
            />
          )}

          {view === "onboarding-form" && onboardCategory && (
            <OnboardingForm
              category={onboardCategory}
              draft={onboardDraft}
              onNext={handleOnboardNext}
              onCancel={() => setView("blank")}
            />
          )}

          {view === "onboarding-config" && onboardDraft && (
            <MilestoneConfig
              project={null}
              isOnboarding={true}
              onboardDraft={onboardDraft}
              editingConfig={true}
              onBack={() => setView("onboarding-form")}
              onFinalize={() => handleFinalize(onboardDraft)}
              onToggleEdit={() => {}}
              onSaveConfig={() => {}}
              onProjectUpdated={(p) => setOnboardDraft(deepClone(p))}
            />
          )}

          {view === "details" && project && (
            <ProjectDetails
              project={project}
              editing={editingDetails}
              onEdit={() => setEditingDetails(true)}
              onSave={handleDetailsSave}
              onBack={() => setView("table")}
              onPublish={() => handlePublish(project.projectId)}
              onDelete={() => handleDelete(project.projectId)}
              onConfig={() => openConfig(project.projectId)}
              onCreateVersion={() => handleCreateVersion(project.projectId)}
            />
          )}

          {view === "config" && project && (
            <MilestoneConfig
              project={project}
              isOnboarding={false}
              onboardDraft={null}
              editingConfig={editingConfig}
              onBack={() => {
                setView("details");
                setEditingConfig(false);
              }}
              onFinalize={() => {}}
              onToggleEdit={handleToggleConfigEdit}
              onSaveConfig={handleToggleConfigEdit}
              onProjectUpdated={onConfigUpdated}
            />
          )}
        </div>
      </div>

      <div className="pmis-footer">
        © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
      </div>

      {/* Modals */}
      {modal?.type === "publish" && (
        <PublishModal
          project={findProj(modal.projectId)}
          onConfirm={() => confirmPublish(modal.projectId)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "delete" && (
        <DeleteProjectModal
          project={findProj(modal.projectId)}
          onConfirm={() => confirmDelete(modal.projectId)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "version" && (
        <CreateVersionModal
          project={findProj(modal.projectId)}
          onConfirm={() => confirmCreateVersion(modal.projectId)}
          onClose={() => setModal(null)}
        />
      )}
      {loader && <LoaderModal text={loader} />}
      {msg && (
        <MessageModal
          msg={msg.text}
          onOk={() => {
            const cb = msg.onOk;
            setMsg(null);
            if (cb) cb();
          }}
        />
      )}
    </div>
  );
}