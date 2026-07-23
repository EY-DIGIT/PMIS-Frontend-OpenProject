/* ══════════════════════════════════════════════════════════════════
   Attendance System — the workforce cluster's shell and landing page.

   Resource records, their rates, attendance, leave policy and penalties
   all read the same underlying data, so they're presented as one section
   instead of five unrelated entries in the project's ⋮ menu.

   `AttendanceSystemLayout` is mounted as a PATHLESS layout route wrapping
   the existing page routes (see App.jsx). That keeps every current URL —
   and every link and bookmark pointing at one — working untouched, while
   giving each page the section nav for free.
   ══════════════════════════════════════════════════════════════════ */
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import {
  FiUsers,
  FiCalendar,
  FiDollarSign,
  FiClipboard,
  // FiAlertTriangle — restore alongside the Penalty Report section below.
  FiGrid,
  FiArrowLeft,
} from "react-icons/fi";

/* One source of truth for the section: drives the tab strip, the hub
   cards and the active-tab lookup. To add a page, add an entry here and
   wrap its route in the layout — nothing else needs touching.

   `slug` is the path segment directly under /projects/:projectId/. The
   overview's own segment is "attendance-system", which is also what the
   project ⋮ menu links to.

   Order here is SET-UP ORDER, not alphabetical: leave policy and rates are
   the configuration a resource's numbers resolve against, so they come
   before resources and attendance. */
export const SECTIONS = [
  {
    slug: "attendance-system",
    label: "Attendance System",
    icon: FiGrid,
    title: "Attendance System",
    blurb: "Everything workforce-related for this project, in one place.",
    hideOnHub: true,
  },
  {
    slug: "leave-config",
    label: "Leave Policy",
    icon: FiClipboard,
    title: "Leave Policy",
    blurb:
      "How leave is earned and counted here — half-day hours, sandwich leave, accrual frequency and proration.",
  },
  {
    slug: "designation-rate",
    label: "Designation Rates",
    icon: FiDollarSign,
    title: "Designation Rates",
    blurb:
      "The per-role, year-wise rate card. Upload this before importing resources so their rates resolve.",
  },
  {
    slug: "resource",
    label: "Resources",
    icon: FiUsers,
    title: "Resources",
    blurb:
      "The people assigned to this project — import them from a workbook, edit their details and track who is active.",
  },
  {
    slug: "attendance",
    label: "Attendance",
    icon: FiCalendar,
    title: "Attendance",
    blurb:
      "Monthly and quarterly attendance per resource, with leave detail and the attendance-upload template.",
  },
  /* Penalty Report — hidden for now. The page and its route are untouched,
     so /projects/:projectId/penalty-report still resolves; only the hub card
     and the nav tab are withdrawn. Restore by uncommenting.
  {
    slug: "penalty-report",
    label: "Penalty Report",
    icon: FiAlertTriangle,
    title: "Penalty Report",
    blurb:
      "Deductions arising from attendance shortfalls, calculated against the rates and leave policy above.",
  },
  */
];

/* The layout sits on a pathless route, so useParams() sees no params of
   its own. The URL shape is fixed — /projects/:projectId/<slug>/... — so
   read both straight off the pathname. */
function readRoute(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  return {
    projectId: segments[1] ? decodeURIComponent(segments[1]) : "",
    slug: segments[2] || "",
  };
}

const STYLES = `
.as-shell { --as-primary: #0b3c88; --as-ink: #0f1c33; --as-muted: #64748b; --as-line: #e6ecf3; }

/* ── section nav ── */
.as-nav {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 12px; margin-bottom: 18px;
  background: #fff; border: 1px solid var(--as-line); border-radius: 14px;
  box-shadow: 0 2px 10px rgba(11,60,136,.06);
}
.as-nav-back {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  border: 1px solid var(--as-line); background: #fff; color: #334155;
  border-radius: 9px; font-size: 13px; font-weight: 600; font-family: inherit;
  padding: 8px 12px; cursor: pointer; transition: background .15s;
}
.as-nav-back:hover { background: #f7f9fd; }
.as-nav-sep { width: 1px; align-self: stretch; background: var(--as-line); margin: 2px 4px; }
.as-nav-items { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
.as-tab {
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid transparent; background: transparent; color: #475569;
  border-radius: 9px; font-size: 13.5px; font-weight: 600; font-family: inherit;
  padding: 8px 13px; cursor: pointer; white-space: nowrap;
  transition: background .15s, color .15s, border-color .15s;
}
.as-tab:hover { background: #f1f5fb; color: var(--as-ink); }
.as-tab[aria-current="page"] {
  background: #eef3fb; color: var(--as-primary); border-color: #c8d6ee;
}
.as-tab svg { flex-shrink: 0; opacity: .8; }
.as-tab[aria-current="page"] svg { opacity: 1; }

/* ── hub ── */
.as-hub-head { margin-bottom: 22px; }
.as-eyebrow {
  font-size: 12px; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--as-primary); margin-bottom: 6px;
}
.as-cards {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
}
.as-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  text-align: left; padding: 20px; cursor: pointer; font-family: inherit;
  background: #fff; border: 1px solid var(--as-line); border-radius: 14px;
  box-shadow: 0 2px 10px rgba(11,60,136,.06);
  transition: transform .15s, box-shadow .15s, border-color .15s;
}
.as-card:hover {
  transform: translateY(-2px); border-color: #c8d6ee;
  box-shadow: 0 8px 22px rgba(11,60,136,.12);
}
.as-card:focus-visible { outline: 3px solid #eef3fb; outline-offset: 2px; border-color: var(--as-primary); }
.as-card-icon {
  width: 44px; height: 44px; border-radius: 12px; background: #eef3fb;
  display: flex; align-items: center; justify-content: center; color: var(--as-primary);
}
.as-card-title { font-size: 15.5px; font-weight: 800; color: var(--as-ink); }
.as-card-blurb { font-size: 13px; color: var(--as-muted); line-height: 1.55; }
.as-card-go { font-size: 12.5px; font-weight: 700; color: var(--as-primary); margin-top: auto; padding-top: 4px; }

.as-note {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 20px;
  background: #f0f6ff; border: 1px solid #c8d6ee; border-radius: 10px;
  padding: 12px 15px; font-size: 12.5px; color: #334155; line-height: 1.55;
}

@media (prefers-reduced-motion: reduce) {
  .as-card { transition: none; }
  .as-card:hover { transform: none; }
}
`;

/* ─── Shell: section nav + the routed page ─────────────────────────── */
export function AttendanceSystemLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { projectId, slug } = readRoute(pathname);

  const go = (target) =>
    navigate(`/projects/${encodeURIComponent(projectId)}/${target}`);

  return (
    <div className="as-shell">
      <style>{STYLES}</style>
      <nav className="as-nav" aria-label="Attendance System sections">
        <button
          type="button"
          className="as-nav-back"
          onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}
          title="Back to project details"
        >
          <FiArrowLeft size={14} /> Project
        </button>
        <span className="as-nav-sep" aria-hidden="true" />
        <div className="as-nav-items">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            // Deeper routes keep their section active — /attendance/leave/:id
            // is still Attendance, so match on the slug alone.
            const current = s.slug === slug;
            return (
              <button
                key={s.slug}
                type="button"
                className="as-tab"
                aria-current={current ? "page" : undefined}
                onClick={() => go(s.slug)}
              >
                <Icon size={15} />
                {s.label}
              </button>
            );
          })}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}

/* ─── Landing page ─────────────────────────────────────────────────── */
export default function AttendanceSystemHub() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { projectId } = readRoute(pathname);
  const project = useProject(projectId);

  const cards = SECTIONS.filter((s) => !s.hideOnHub);

  return (
    <div>
      <div className="as-hub-head">
        <div className="as-eyebrow">{project?.projectName || "Project"}</div>
        <h1 className="uidai-pmis-title" style={{ marginBottom: 6 }}>
          Attendance System
        </h1>
        <p className="uidai-pmis-subtitle">
          Resources, their rates, attendance and leave all draw on the same
          records. Pick a section below, or use the tabs above to move between
          them at any time.
        </p>
      </div>

      <div className="as-cards">
        {cards.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.slug}
              type="button"
              className="as-card"
              onClick={() =>
                navigate(`/projects/${encodeURIComponent(projectId)}/${s.slug}`)
              }
            >
              <span className="as-card-icon"><Icon size={21} /></span>
              <span className="as-card-title">{s.title}</span>
              <span className="as-card-blurb">{s.blurb}</span>
              <span className="as-card-go">Open →</span>
            </button>
          );
        })}
      </div>

      <div className="as-note">
        <span>ℹ️</span>
        <span>
          <strong>Setting up for the first time?</strong> Upload the{" "}
          <strong>Designation Rates</strong> first, then import{" "}
          <strong>Resources</strong> — a resource's rate is resolved from its
          designation, so importing in the other order leaves rates unset.
        </span>
      </div>
    </div>
  );
}
