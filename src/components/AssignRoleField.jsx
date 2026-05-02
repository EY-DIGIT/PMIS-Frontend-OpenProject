import React, { useEffect, useMemo, useState } from "react";

/* Permission catalogue, mirrored from the HTML reference. Grouped by module
   so the modal can render category sections and a Select-all per group. */
export const PERMISSION_CATEGORIES = [
  {
    id: "project",
    label: "Project Management",
    description: "Create, modify, and remove project records",
    icon: "📁",
    permissions: [
      { id: "project_add", label: "Add Project" },
      { id: "project_update", label: "Update Project" },
      { id: "project_delete", label: "Delete Project" }
    ]
  },
  {
    id: "vendor",
    label: "Vendor Management",
    description: "Onboard and maintain vendor master data",
    icon: "🏢",
    permissions: [
      { id: "vendor_add", label: "Add Vendor" },
      { id: "vendor_update", label: "Update Vendor" },
      { id: "vendor_delete", label: "Delete Vendor" }
    ]
  },
  {
    id: "user",
    label: "User Management",
    description: "Manage user accounts and access control",
    icon: "👤",
    permissions: [
      { id: "user_add", label: "Add User" },
      { id: "user_update", label: "Update User" },
      { id: "user_delete", label: "Delete User" }
    ]
  },
  {
    id: "masterdata",
    label: "Master Data",
    description: "Read consolidated vendor and user records",
    icon: "🗂️",
    permissions: [
      { id: "masterdata_view_vendor", label: "View Vendor Data" },
      { id: "masterdata_view_user", label: "View User Data" }
    ]
  },
  {
    id: "reports",
    label: "Reports",
    description: "Generate, export and download reports",
    icon: "📊",
    permissions: [
      { id: "reports_view", label: "View Reports" },
      { id: "reports_download", label: "Download Reports" }
    ]
  }
];

export const PERMISSION_LOOKUP = (() => {
  const map = {};
  PERMISSION_CATEGORIES.forEach((cat) => {
    cat.permissions.forEach((p) => {
      map[p.id] = { label: p.label, category: cat.label, categoryId: cat.id, icon: cat.icon };
    });
  });
  return map;
})();

const TOTAL_PERMISSIONS = PERMISSION_CATEGORIES.reduce(
  (sum, c) => sum + c.permissions.length,
  0
);

const MAX_INLINE_TAGS = 6;

/* The card shown inline on the Add User / User Details form. Renders the
   selected permissions as tags with an "Assign Role" / "Edit Role" /
   "View Role" button that opens the modal. */
export default function AssignRoleField({
  value = [],
  onChange,
  editable = true
}) {
  const [open, setOpen] = useState(false);

  const safeValue = Array.isArray(value) ? value : [];
  const hasSelections = safeValue.length > 0;
  const btnLabel = editable
    ? hasSelections
      ? "Edit Role"
      : "Assign Role"
    : "View Role";

  const visibleTags = safeValue.slice(0, MAX_INLINE_TAGS);
  const extra = safeValue.length - visibleTags.length;

  return (
    <>
      <div className={`uidai-role-card${hasSelections ? " uidai-role-card--has-selections" : ""}`}>
        <div className="uidai-role-card__tags">
          {!hasSelections ? (
            <span className="uidai-role-card__empty">No permissions assigned yet</span>
          ) : (
            <>
              {visibleTags.map((id) => {
                const meta = PERMISSION_LOOKUP[id];
                const lbl = meta ? meta.label : id;
                const title = meta ? `${meta.category} • ${meta.label}` : lbl;
                return (
                  <span key={id} className="uidai-role-tag" title={title}>
                    {lbl}
                  </span>
                );
              })}
              {extra > 0 && <span className="uidai-role-tag-more">+{extra} more</span>}
            </>
          )}
        </div>
        <button
          type="button"
          className={`uidai-role-card__btn${hasSelections ? "" : " uidai-role-card__btn--outline"}`}
          onClick={() => setOpen(true)}
          aria-label={btnLabel}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span>{btnLabel}</span>
        </button>
      </div>

      {open && (
        <AssignRoleModal
          initialSelected={safeValue}
          readOnly={!editable}
          onClose={() => setOpen(false)}
          onSave={(next) => {
            if (typeof onChange === "function") onChange(next);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function AssignRoleModal({ initialSelected, readOnly, onClose, onSave }) {
  const [selected, setSelected] = useState(() => new Set(initialSelected || []));
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => {
    // Auto-expand any section with at least one selection so users can
    // immediately see what's checked when the modal opens.
    const init = {};
    const sel = new Set(initialSelected || []);
    PERMISSION_CATEGORIES.forEach((cat) => {
      init[cat.id] = cat.permissions.some((p) => sel.has(p.id));
    });
    return init;
  });

  // Lock background scroll while the modal is open
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Close on ESC for a11y
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = search.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    return PERMISSION_CATEGORIES.map((cat) => {
      const matches = cat.permissions.filter((p) => {
        if (!q) return true;
        return p.label.toLowerCase().includes(q) || cat.label.toLowerCase().includes(q);
      });
      return { ...cat, visible: matches };
    }).filter((cat) => cat.visible.length > 0);
  }, [q]);

  function togglePerm(id) {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(catId, shouldSelect) {
    if (readOnly) return;
    const cat = PERMISSION_CATEGORIES.find((c) => c.id === catId);
    if (!cat) return;
    setSelected((prev) => {
      const next = new Set(prev);
      cat.permissions.forEach((p) => {
        if (shouldSelect) next.add(p.id);
        else next.delete(p.id);
      });
      return next;
    });
    if (shouldSelect) setExpanded((p) => ({ ...p, [catId]: true }));
  }

  function toggleSection(catId) {
    setExpanded((p) => ({ ...p, [catId]: !p[catId] }));
  }

  function handleSave() {
    onSave(Array.from(selected));
  }

  const totalSelected = selected.size;
  const hasSelections = totalSelected > 0;

  let footerText;
  if (totalSelected === 0) footerText = "No permissions selected.";
  else if (totalSelected === TOTAL_PERMISSIONS)
    footerText = (
      <>
        All <strong>{TOTAL_PERMISSIONS}</strong> permissions selected.
      </>
    );
  else
    footerText = (
      <>
        <strong>{totalSelected}</strong> permission{totalSelected === 1 ? "" : "s"} selected across modules.
      </>
    );

  return (
    <div
      className="uidai-role-overlay uidai-role-overlay--open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="uidai-role-modal-title"
      onMouseDown={(e) => {
        // backdrop click closes
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="uidai-role-modal" role="document">
        <div className="uidai-role-modal__header">
          <div className="uidai-role-modal__header-text">
            <div id="uidai-role-modal-title" className="uidai-role-modal__title">
              <span className="uidai-role-modal__title-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </span>
              <span>Assign Role &amp; Permissions</span>
            </div>
            <div className="uidai-role-modal__subtitle">
              {readOnly
                ? "Read-only view of the operations this user is currently allowed to perform."
                : "Select the operations this user is allowed to perform across modules. Granular control over access keeps the system secure."}
            </div>
          </div>
          <button
            type="button"
            className="uidai-role-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="uidai-role-modal__toolbar">
          <div className="uidai-role-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="uidai-role-search-input"
              placeholder="Search permissions or modules..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search permissions"
              autoFocus={!readOnly}
            />
          </div>
          <div
            className={`uidai-role-counter${hasSelections ? " uidai-role-counter--has-selections" : ""}`}
          >
            <span>Selected:</span>
            <strong>{totalSelected}</strong>
            <span>/</span>
            <strong>{TOTAL_PERMISSIONS}</strong>
          </div>
        </div>

        <div className="uidai-role-modal__body" tabIndex={0}>
          {filteredSections.length === 0 ? (
            <div className="uidai-role-empty">No permissions match your search.</div>
          ) : (
            filteredSections.map((cat) => {
              const totalInCat = cat.permissions.length;
              const selectedInCat = cat.permissions.filter((p) => selected.has(p.id)).length;
              const isExpanded = !!expanded[cat.id];
              const allSelected = selectedInCat === totalInCat;
              const someSelected = selectedInCat > 0 && !allSelected;
              return (
                <div
                  key={cat.id}
                  className={[
                    "uidai-role-section",
                    isExpanded ? "uidai-role-section--expanded" : "",
                    selectedInCat > 0 ? "uidai-role-section--has-selected" : "",
                    readOnly ? "uidai-role-section--disabled" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-category={cat.id}
                >
                  <div
                    className="uidai-role-section__head"
                    onClick={() => toggleSection(cat.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSection(cat.id);
                      }
                    }}
                  >
                    <div className="uidai-role-section__icon" aria-hidden="true">
                      {cat.icon}
                    </div>
                    <div className="uidai-role-section__info">
                      <div className="uidai-role-section__title">
                        <span>{cat.label}</span>
                        <span className="uidai-role-section__pill">
                          {selectedInCat}/{totalInCat}
                        </span>
                      </div>
                      <div className="uidai-role-section__meta">{cat.description}</div>
                    </div>
                    <div className="uidai-role-section__actions">
                      <label
                        className="uidai-role-select-all" 
                        style={{display:"inline-flex",margin:0}}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          disabled={readOnly}
                          aria-label={`Select all in ${cat.label}`}
                          onChange={(e) => toggleSelectAll(cat.id, e.target.checked)}
                        />
                        <span className="uidai-role-select-all__label">Select all</span>
                      </label>
                      <span className="uidai-role-section__arrow" aria-hidden="true">
                        ▾
                      </span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="uidai-role-section__body">
                      <div className="uidai-role-grid">
                        {cat.visible.map((p) => {
                          const checked = selected.has(p.id);
                          return (
                            <label key={p.id} className="uidai-role-perm">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={readOnly}
                                onChange={() => togglePerm(p.id)}
                              />
                              <span className="uidai-role-perm__label">{p.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="uidai-role-modal__footer">
          <div className="uidai-role-modal__footer-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>{footerText}</span>
          </div>
          <div className="uidai-role-modal__footer-actions">
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-cancel"
              onClick={onClose}
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button type="button" className="uidai-pmis-btn" onClick={handleSave}>
                Save Permissions
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
