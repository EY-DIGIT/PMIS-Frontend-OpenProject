import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";

export default function ProjectAttendancePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  return <div style={{ minHeight: 220, padding: 24 }} />;
}
