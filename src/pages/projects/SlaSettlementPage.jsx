/* ──────────────────────────────────────────────────────────────────
   Settlement & LD — the project-level quarter close.

   The settlement panel is project-scoped (aggregate → NPQP → capped LD
   → invoice lock) but used to render at the bottom of the ACTIVITY
   mapping page, which meant reaching it required picking an activity
   first. It only ever needed `projectId`, so it lives on its own route
   inside the SLA System section now — this page is the whole move.
   ────────────────────────────────────────────────────────────────── */
import { useParams } from "react-router-dom";
import SlaSettlementPanel from "../../components/projects/sla/SlaSettlementPanel";
import { useProject } from "../../store/project/projectsStore";
import "../../styles/global.css";

export default function SlaSettlementPage() {
    const { projectId } = useParams();
    const project = useProject(projectId);

    return (
        <div className="uidai-pmis-content">
            <div className="uidai-pmis-title">Settlement &amp; LD</div>
            <div className="uidai-pmis-subtitle" style={{ marginTop: -10 }}>
                Close a quarter for {project?.projectName || "this project"} — the
                per-SLA rollup rolls into NPQP, the cap is applied, and the
                settlement locks once invoiced.
            </div>

            {projectId ? (
                /* T0 anchors the quarter list — quarters run from the project's
                   start date now, not from the calendar. */
                <SlaSettlementPanel
                    projectId={projectId}
                    projectStartDate={project?.startDate || ""}
                    projectEndDate={project?.endDate || ""}
                />
            ) : (
                <div className="uidai-pmis-card">No project in the URL.</div>
            )}
        </div>
    );
}
