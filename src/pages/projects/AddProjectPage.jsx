import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { draftStore, useDraft } from "../../store/project/draftStore";
import { uiStore } from "../../store/project/uiStore";
import { CATEGORY_OPTIONS, VENDOR_MASTER } from "../../utils/project/constants";
import { safeArray } from "../../utils/project/helpers";
import ChipControl from "../../components/projects/ChipControl";

function makeEmpty() {
  return {
    projectName: "",
    description: "",
    owner: "",
    startDate: "",
    endDate: "",
    actualEndDate: "",
    isPublic: "Yes",
    category: "",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
    auditLogs: [],
    milestones: [],
    vendors: [],
    resources: []
  };
}

export default function AddProjectPage() {
  const navigate = useNavigate();
  const existingDraft = useDraft();
  const [form, setForm] = useState(() => existingDraft || makeEmpty());

  const categoryInList = CATEGORY_OPTIONS.includes(form.category);
  const selCat = categoryInList ? form.category : form.category ? "Others" : "MSAP";
  const otherCat = !categoryInList && form.category ? form.category : "";

  const [otherCategory, setOtherCategory] = useState(otherCat);
  const [selectedCategory, setSelectedCategory] = useState(selCat);

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function goNext() {
    const finalCat =
      selectedCategory === "Others" ? otherCategory.trim() : selectedCategory;
    if (selectedCategory === "Others" && !otherCategory.trim()) {
      uiStore.showMessage("Please specify the category.");
      return;
    }
    if (!form.projectName.trim() || !form.owner.trim() || !form.startDate || !form.endDate) {
      uiStore.showMessage("Fill required fields");
      return;
    }
    if (form.endDate < form.startDate) {
      uiStore.showMessage("Expected End Date cannot be earlier than Expected Start Date.");
      return;
    }
    const next = {
      ...form,
      projectName: form.projectName.trim(),
      description: form.description.trim(),
      owner: form.owner.trim(),
      category: finalCat,
      baselineId: "-",
      status: "DRAFT",
      milestones: safeArray(form.milestones)
    };
    draftStore.set(next);
    navigate("/projects/add/config");
  }

  function cancel() {
    draftStore.clear();
    navigate("/");
  }

  return (
    <div>
      <div className="uidai-page-title">Project Management</div>
      <div className="uidai-card-project">
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>New Project</h3>
        <div className="uidai-grid">
          <div className="uidai-field">
            <label className="uidai-field__label">
              Project Name <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.projectName}
              onChange={(e) => update({ projectName: e.target.value })}
            />
          </div>

          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Description</label>
            <textarea
              className="uidai-textarea"
              maxLength={5000}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
            />
            <div className="uidai-char-count">
              {5000 - form.description.length} characters remaining
            </div>
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">Status</label>
            <input className="uidai-input" value="DRAFT" disabled />
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Owner <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.owner}
              onChange={(e) => update({ owner: e.target.value })}
            />
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected Start Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              value={form.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
            />
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected End Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              value={form.endDate}
              onChange={(e) => update({ endDate: e.target.value })}
            />
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Is Public <span className="uidai-required-project">*</span>
            </label>
            <select
              className="uidai-select"
              value={form.isPublic}
              onChange={(e) => update({ isPublic: e.target.value })}
            >
              <option>Yes</option>
              <option>No</option>
            </select>
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Category <span className="uidai-required-project">*</span>
            </label>
            <select
              className="uidai-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>

          {selectedCategory === "Others" && (
            <div className="uidai-field">
              <label className="uidai-field__label">
                Specify Category <span className="uidai-required-project">*</span>
              </label>
              <input
                className="uidai-input"
                value={otherCategory}
                onChange={(e) => setOtherCategory(e.target.value)}
              />
            </div>
          )}

          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Associated Vendors</label>
            <div className="uidai-hint" style={{ marginBottom: 8 }}>
              Select vendors for this project
            </div>
            <ChipControl
              value={safeArray(form.vendors)}
              options={VENDOR_MASTER}
              onChange={(next) => update({ vendors: next })}
              label="vendor"
            />
          </div>
        </div>

        <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button className="uidai-btn" onClick={goNext}>
            Save &amp; Next
          </button>
          <button className="uidai-btn uidai-btn--cancel" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
