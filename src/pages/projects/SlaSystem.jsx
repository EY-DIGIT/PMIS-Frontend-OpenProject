/* ══════════════════════════════════════════════════════════════════
   SLA System — the SLA cluster's shell and landing page.

   Severity/LD configuration, the SLA library, activity mappings,
   quarterly settlement and the penalty report are one chain of work:
   points → bands → mapped SLA → evaluation → LD → payment. They were
   spread across the project ⋮ menu, the global sidebar and the bottom
   of the activity-mapping page, so reaching any one of them meant
   walking the milestone tree. They're presented as one section now.

   `SlaSystemLayout` is mounted as a PATHLESS layout route wrapping the
   existing page routes (see App.jsx). Every current URL — /severity,
   /activity-slas, /penalty-report — and every link and bookmark
   pointing at one keeps working untouched, while each page gets the
   section nav for free.

   Deliberately mirrors AttendanceSystem.jsx rather than sharing a shell
   with it: the two sections stay independently stylable, and neither
   can break the other.
   ══════════════════════════════════════════════════════════════════ */
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import {
  FiGrid,
  FiSliders,
  FiBookOpen,
  FiLink2,
  FiLayers,
  FiPieChart,
  FiAlertTriangle,
  FiArrowLeft,
  FiExternalLink,
} from "react-icons/fi";

/* One source of truth for the section: drives the tab strip, the hub
   cards and the active-tab lookup. To add a page, add an entry here and
   wrap its route in the layout — nothing else needs touching.

   `slug` is the path segment directly under /projects/:projectId/. The
   overview's own segment is "sla-system", which is also what the project
   ⋮ menu links to.

   Order here is SET-UP ORDER, not alphabetical: an SLA can only be
   scored once severity levels and LD bands exist, and can only be
   settled once it is mapped and evaluated.

   `external` marks a destination outside the project (the SLA library is
   a global master). Those tabs navigate away and never read as active. */
export const SECTIONS = [
  {
    slug: "sla-system",
    label: "SLA System",
    icon: FiGrid,
    title: "SLA System",
    blurb: "Everything SLA-related for this project, in one place.",
    hideOnHub: true,
  },
  {
    slug: "severity",
    label: "Severity & LD",
    icon: FiSliders,
    title: "Severity & LD Bands",
    blurb:
      "Severity levels and their points, plus the LD band lookup table every evaluation scores against. Configure this first.",
  },
  {
    slug: "sla-library",
    external: "/sla-masters",
    label: "SLA Library",
    icon: FiBookOpen,
    title: "SLA Library",
    blurb:
      "The SLA master library — onboard a new SLA, review its clauses, formula and attachments. Shared across projects.",
  },
  {
    slug: "activity-slas",
    label: "Activity Mapping",
    icon: FiLink2,
    title: "Activity SLA Mapping",
    blurb:
      "Pick an activity, map SLAs onto it, set the effective window, then evaluate a single SLA or all of them at once.",
  },
  {
    slug: "sla-rollup",
    label: "SLA Rollup",
    icon: FiLayers,
    title: "SLA Rollup",
    blurb:
      "One contract quarter, grouped by SLA: the activities that breached it, the points after the severity cap, and the LD % it carries.",
  },
  {
    slug: "sla-settlement",
    label: "Settlement & LD",
    icon: FiPieChart,
    title: "Settlement & LD",
    blurb:
      "The project's quarter: aggregate → PQP → capped LD → settlement → invoice lock.",
  },
  {
    slug: "penalty-report",
    label: "Penalty Report",
    icon: FiAlertTriangle,
    title: "Penalty Report",
    blurb:
      "Milestone delay converted to LD% and applied to the milestone's payment — the delay-to-money view.",
  },
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
.sla-shell { --sla-primary: #0b3c88; --sla-ink: #0f1c33; --sla-muted: #64748b; --sla-line: #e6ecf3; }

/* ── section nav ── */
.sla-nav {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 12px; margin-bottom: 18px;
  background: #fff; border: 1px solid var(--sla-line); border-radius: 14px;
  box-shadow: 0 2px 10px rgba(11,60,136,.06);
}
.sla-nav-back {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  border: 1px solid var(--sla-line); background: #fff; color: #334155;
  border-radius: 9px; font-size: 13px; font-weight: 600; font-family: inherit;
  padding: 8px 12px; cursor: pointer; transition: background .15s;
}
.sla-nav-back:hover { background: #f7f9fd; }
.sla-nav-sep { width: 1px; align-self: stretch; background: var(--sla-line); margin: 2px 4px; }
.sla-nav-items { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
.sla-tab {
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid transparent; background: transparent; color: #475569;
  border-radius: 9px; font-size: 13.5px; font-weight: 600; font-family: inherit;
  padding: 8px 13px; cursor: pointer; white-space: nowrap;
  transition: background .15s, color .15s, border-color .15s;
}
.sla-tab:hover { background: #f1f5fb; color: var(--sla-ink); }
.sla-tab[aria-current="page"] {
  background: #eef3fb; color: var(--sla-primary); border-color: #c8d6ee;
}
.sla-tab svg { flex-shrink: 0; opacity: .8; }
.sla-tab[aria-current="page"] svg { opacity: 1; }
.sla-tab-out { opacity: .55; margin-left: -2px; }

/* ── hub ── */
.sla-hub-head { margin-bottom: 22px; }
.sla-eyebrow {
  font-size: 12px; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--sla-primary); margin-bottom: 6px;
}
.sla-cards {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
}
.sla-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  text-align: left; padding: 20px; cursor: pointer; font-family: inherit;
  background: #fff; border: 1px solid var(--sla-line); border-radius: 14px;
  box-shadow: 0 2px 10px rgba(11,60,136,.06);
  transition: transform .15s, box-shadow .15s, border-color .15s;
}
.sla-card:hover {
  transform: translateY(-2px); border-color: #c8d6ee;
  box-shadow: 0 8px 22px rgba(11,60,136,.12);
}
.sla-card:focus-visible { outline: 3px solid #eef3fb; outline-offset: 2px; border-color: var(--sla-primary); }
.sla-card-icon {
  width: 44px; height: 44px; border-radius: 12px; background: #eef3fb;
  display: flex; align-items: center; justify-content: center; color: var(--sla-primary);
}
.sla-card-title { font-size: 15.5px; font-weight: 800; color: var(--sla-ink); }
.sla-card-blurb { font-size: 13px; color: var(--sla-muted); line-height: 1.55; }
.sla-card-go { font-size: 12.5px; font-weight: 700; color: var(--sla-primary); margin-top: auto; padding-top: 4px; }

.sla-note {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 20px;
  background: #f0f6ff; border: 1px solid #c8d6ee; border-radius: 10px;
  padding: 12px 15px; font-size: 12.5px; color: #334155; line-height: 1.55;
}

@media (prefers-reduced-motion: reduce) {
  .sla-card { transition: none; }
  .sla-card:hover { transform: none; }
}
`;

/* ─── Shell: section nav + the routed page ─────────────────────────── */
export function SlaSystemLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { projectId, slug } = readRoute(pathname);

  const go = (section) =>
    navigate(
      section.external ||
        `/projects/${encodeURIComponent(projectId)}/${section.slug}`
    );

  return (
    <div className="sla-shell">
      <style>{STYLES}</style>
      <nav className="sla-nav" aria-label="SLA System sections">
        <button
          type="button"
          className="sla-nav-back"
          onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}
          title="Back to project details"
        >
          <FiArrowLeft size={14} /> Project
        </button>
        <span className="sla-nav-sep" aria-hidden="true" />
        <div className="sla-nav-items">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            // Deeper routes keep their section active — /activity-slas?activityId=…
            // is still Activity Mapping, so match on the slug alone.
            const current = !s.external && s.slug === slug;
            return (
              <button
                key={s.slug}
                type="button"
                className="sla-tab"
                aria-current={current ? "page" : undefined}
                onClick={() => go(s)}
              >
                <Icon size={15} />
                {s.label}
                {s.external && (
                  <FiExternalLink size={12} className="sla-tab-out" aria-hidden="true" />
                )}
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
export default function SlaSystemHub() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { projectId } = readRoute(pathname);
  const project = useProject(projectId);

  const cards = SECTIONS.filter((s) => !s.hideOnHub);

  return (
    <div>
      <div className="sla-hub-head">
        <div className="sla-eyebrow">{project?.projectName || "Project"}</div>
        <h1 className="uidai-pmis-title" style={{ marginBottom: 6 }}>
          SLA System
        </h1>
        <p className="uidai-pmis-subtitle">
          Configuration, mapping, evaluation and settlement all feed the same
          LD calculation. Pick a section below, or use the tabs above to move
          between them at any time.
        </p>
      </div>

      <div className="sla-cards">
        {cards.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.slug}
              type="button"
              className="sla-card"
              onClick={() =>
                navigate(
                  s.external ||
                    `/projects/${encodeURIComponent(projectId)}/${s.slug}`
                )
              }
            >
              <span className="sla-card-icon"><Icon size={21} /></span>
              <span className="sla-card-title">{s.title}</span>
              <span className="sla-card-blurb">{s.blurb}</span>
              <span className="sla-card-go">
                {s.external ? "Open ↗" : "Open →"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sla-note">
        <span>ℹ️</span>
        <span>
          <strong>Setting up for the first time?</strong> Configure{" "}
          <strong>Severity &amp; LD Bands</strong> first — an evaluation turns
          severity points into an LD percentage through those bands, so mapping
          an SLA before they exist leaves every result unscored.
        </span>
      </div>
    </div>
  );
}
