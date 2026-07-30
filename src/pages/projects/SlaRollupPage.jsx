/* ──────────────────────────────────────────────────────────────────
   SLA Rollup — the evidence view that sits between activity-level
   evaluation and the quarter's money close.

   Activity Mapping shows one activity's SLAs. Settlement & LD shows one
   quarter's money. Neither answers "SLA 005 cost us 2% this quarter —
   which activities did that, and when?". This page does, grouped by SLA
   and scoped to a contract quarter.

   Thin by design: the panel is prop-driven so it can also be embedded on
   the Settlement page later without being rewritten.
   ────────────────────────────────────────────────────────────────── */
import { useParams } from "react-router-dom";
import SlaQuarterRollupPanel from "../../components/projects/sla/SlaQuarterRollupPanel";
import { useProject } from "../../store/project/projectsStore";
import "../../styles/global.css";

export default function SlaRollupPage() {
    const { projectId } = useParams();
    const project = useProject(projectId);

    return (
        <div className="uidai-pmis-content">
            <div className="uidai-pmis-title">SLA Rollup</div>
            <div className="uidai-pmis-subtitle" style={{ marginTop: -10 }}>
                Pick a contract year and quarter to see every SLA for{" "}
                {project?.projectName || "this project"} — the breaches behind it, the
                points it accumulated after the severity cap, and the LD % it carries
                into the quarter&rsquo;s settlement.
            </div>

            {projectId ? (
                <SlaQuarterRollupPanel
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
