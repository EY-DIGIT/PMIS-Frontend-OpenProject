// ============================================================
// pages/OnboardingForm.jsx  –  Route: /onboard/:category
//   Step 1 of 2: basic project info
// ============================================================
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useOnboard } from "../store/Onboardstore";
import Field from "./Field";
import Btn   from "./Btn";

export default function OnboardingForm() {
  const { category } = useParams();
  const navigate      = useNavigate();
  const { draft, setDraft, setCategory } = useOnboard();

  const [form, setForm] = useState({
    projectName : draft?.projectName  || "",
    description : draft?.description  || "",
    owner       : draft?.owner        || "",
    startDate   : draft?.startDate    || "",
    endDate     : draft?.endDate      || "",
    isPublic    : draft?.isPublic     || "Yes",
  });
  const [err, setErr] = useState("");

  // Keep category in store so OnboardingConfig can read it
  useEffect(() => { setCategory(category); }, [category, setCategory]);

  const u = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleNext = () => {
    if (!form.projectName || !form.owner || !form.startDate || !form.endDate) {
      setErr("Fill required fields.");
      return;
    }
    // Merge into draft; preserve milestones already added in a prior visit
    const updatedDraft = {
      ...form,
      category,
      baselineId: "-",
      status    : "NEW",
      isVersion : false,
      versionOf : "",
      versionNo : 0,
      auditLogs : [],
      milestones: draft?.milestones || [],
    };
    setDraft(updatedDraft);
    navigate(`/onboard/${encodeURIComponent(category)}/config`);
  };

  return (
    <div>
      <div className="pm-title">Project Management</div>
      <div className="card">
        <h3>{category} Project</h3>
        <br />
        {err && <div style={{ color: "var(--red)", marginBottom: 8, fontSize: 13 }}>{err}</div>}

        <div className="grid">
          <Field label="Project Name" required>
            <input value={form.projectName} onChange={(e) => u("projectName", e.target.value)} />
          </Field>

          <Field label="Description" full>
            <textarea
              value={form.description}
              onChange={(e) => u("description", e.target.value)}
              maxLength={5000}
            />
            <div className="char-count">{5000 - form.description.length} characters remaining</div>
          </Field>

          <Field label="Status" required>
            <input value="NEW" disabled />
          </Field>

          <Field label="Owner" required>
            <input value={form.owner} onChange={(e) => u("owner", e.target.value)} />
          </Field>

          <Field label="Start Date" required>
            <input type="date" value={form.startDate} onChange={(e) => u("startDate", e.target.value)} />
          </Field>

          <Field label="End Date" required>
            <input type="date" value={form.endDate} onChange={(e) => u("endDate", e.target.value)} />
          </Field>

          <Field label="Is Public" required>
            <select value={form.isPublic} onChange={(e) => u("isPublic", e.target.value)}>
              <option>Yes</option>
              <option>No</option>
            </select>
          </Field>

          <Field label="Category" required>
            <input value={category} disabled />
          </Field>
        </div>

        <div style={{ marginTop: 15, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn onClick={handleNext}>Save &amp; Next</Btn>
          <Btn variant="cancel" onClick={() => navigate("/")}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}