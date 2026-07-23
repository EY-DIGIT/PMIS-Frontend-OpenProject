/* ══════════════════════════════════════════════════════════════════
   DocumentAccess.jsx — the superadmin/admin menu for role-based
   document access (#323).

   Pick a target (project / milestone / activity / task / subtask), get
   its documents newest-first, then grant one or more roles — optionally
   narrowed to an organization or division — via
   PUT /documents/{commentId}/access.

   A document with NO rules is public. The first rule flips it to a
   whitelist; saving an EMPTY rule set makes it public again. Everything
   else in the app is unaffected: the server already filters restricted
   documents out of every other list, so no other view needs a "locked"
   state.
   ══════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { FaTrashAlt } from 'react-icons/fa';
import { tokenStore } from '../../api/client';
import {
  TARGET_KINDS,
  listDocumentsForTarget,
  setDocumentAccess,
} from '../../api/documentAccess';
import * as projectsApi from '../../api/projects';
import * as rolesApi from '../../api/roles';
import * as divisionsApi from '../../api/divisions';
import * as vendorsApi from '../../api/vendors';
import { normalizeText } from '../../utils/helpers';

/* Role slugs the access API accepts. Used as the fallback when the role
   catalog endpoint is unavailable so the picker is never empty. */
const FALLBACK_ROLE_SLUGS = [
  'super_admin',
  'admin',
  'org_admin',
  'project_admin',
  'project_member',
  'division_owner',
  'division_approver',
  'division_member',
];

/* "division_approver" → "Division Approver" — good enough for the slugs
   the backend hands back without a display name. */
function prettyRole(slug) {
  return String(slug || '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

/* One rule reads as "project_member" or "division_approver · tmd-i". */
function ruleLabel(rule, divisionLabelByCode, orgNameById) {
  const parts = [prettyRole(rule.roleName)];
  if (rule.organizationId) {
    parts.push(orgNameById.get(String(rule.organizationId)) || rule.organizationId);
  }
  if (rule.division) {
    parts.push(divisionLabelByCode.get(String(rule.division)) || rule.division);
  }
  return parts.join(' · ');
}

export default function DocumentAccess() {
  const [targetKind, setTargetKind] = useState('project');
  const [targetId, setTargetId] = useState('');
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Catalogs backing the pickers.
  const [projects, setProjects] = useState([]);
  const [roleSlugs, setRoleSlugs] = useState(FALLBACK_ROLE_SLUGS);
  const [divisions, setDivisions] = useState([]);
  const [orgs, setOrgs] = useState([]);

  // The document whose rules are being edited (null = modal closed).
  const [editingDoc, setEditingDoc] = useState(null);

  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    (async () => {
      const [proj, roles, divs, vend] = await Promise.all([
        projectsApi.listAll().catch(() => []),
        rolesApi.list().catch(() => []),
        divisionsApi.list().catch(() => []),
        vendorsApi.list().catch(() => []),
      ]);
      if (cancelled) return;
      setProjects(Array.isArray(proj) ? proj : []);
      const slugs = (Array.isArray(roles) ? roles : [])
        .map((r) => r?.name || r?.role_name || r?.code)
        .filter(Boolean);
      if (slugs.length) setRoleSlugs(Array.from(new Set(slugs)));
      setDivisions(Array.isArray(divs) ? divs : []);
      setOrgs(Array.isArray(vend) ? vend : []);
    })();
    return () => { cancelled = true; };
  }, []);

  const divisionLabelByCode = useMemo(() => {
    const m = new Map();
    divisions.forEach((d) => { if (d.code) m.set(String(d.code), d.label || d.code); });
    return m;
  }, [divisions]);

  const orgNameById = useMemo(() => {
    const m = new Map();
    orgs.forEach((o) => {
      if (o?.vendorId) m.set(String(o.vendorId), o.vendorName || o.vendorId);
    });
    return m;
  }, [orgs]);

  /* Switching the target kind invalidates whatever is on screen — the id
     entered for a milestone means nothing for a task. */
  function changeKind(kind) {
    setTargetKind(kind);
    setTargetId('');
    setDocs([]);
    setLoaded(false);
    setError('');
  }

  async function loadDocs(id = targetId) {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const list = await listDocumentsForTarget(targetKind, id);
      setDocs(Array.isArray(list) ? list : []);
      setLoaded(true);
    } catch (err) {
      setDocs([]);
      setLoaded(true);
      setError(err?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }

  async function saveRules(commentId, rules) {
    await setDocumentAccess(commentId, rules);
    setEditingDoc(null);
    await loadDocs();
  }

  const filtered = useMemo(() => {
    const q = normalizeText(search);
    if (!q) return docs;
    return docs.filter((d) =>
      [d.filename, d.uploadedBy]
        .map((s) => normalizeText(s))
        .some((s) => s.includes(q))
    );
  }, [docs, search]);

  const kindLabel =
    TARGET_KINDS.find((k) => k.value === targetKind)?.label || targetKind;

  return (
    <>
      <div className="uidai-pmis-card">
        <h3>Document Access</h3>
        <p className="uidai-pmis-subtitle" style={{ marginTop: 4 }}>
          Documents are visible to everyone by default. Grant one or more roles to
          restrict a document — once any role is granted only Super Admin / PMIS
          Admin, the uploader and holders of a granted role can see or download it.
        </p>

        <div className="uidai-pmis-grid-4" style={{ marginTop: 12 }}>
          <div className="uidai-pmis-field">
            <label>Attached To <span className="uidai-pmis-required">*</span></label>
            <select value={targetKind} onChange={(e) => changeKind(e.target.value)}>
              {TARGET_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field" style={{ gridColumn: 'span 2' }}>
            <label>{kindLabel} <span className="uidai-pmis-required">*</span></label>
            {targetKind === 'project' ? (
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setDocs([]);
                  setLoaded(false);
                  if (e.target.value) loadDocs(e.target.value);
                }}
              >
                <option value="">Select Project</option>
                {projects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.projectCode ? `${p.projectCode} — ${p.projectName}` : p.projectName}
                  </option>
                ))}
              </select>
            ) : (
              /* Milestones / activities / tasks / subtasks have no global
                 picker in this app, so the id is entered directly — it's the
                 same id the milestone-configuration URLs carry. */
              <input
                value={targetId}
                placeholder={`Paste the ${kindLabel.toLowerCase()} id`}
                onChange={(e) => { setTargetId(e.target.value); setLoaded(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') loadDocs(); }}
              />
            )}
          </div>
          <div className="uidai-pmis-field" style={{ justifyContent: 'flex-end' }}>
            <label>&nbsp;</label>
            <button
              type="button"
              className="uidai-pmis-btn"
              onClick={() => loadDocs()}
              disabled={!targetId || loading}
            >
              {loading ? 'Loading…' : 'Load Documents'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: '#b91c1c', fontSize: 13, padding: '8px 0' }}>{error}</div>
        )}
      </div>

      <div className="uidai-pmis-card">
        <div className="uidai-pmis-search-row">
          <input
            className="uidai-pmis-search-input"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!docs.length}
          />
          <button className="uidai-pmis-btn uidai-pmis-btn-small" type="button">Search</button>
        </div>

        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>Document</th>
                <th>Uploaded By</th>
                <th>Uploaded On</th>
                <th>Visibility</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={5}>Pick a {kindLabel.toLowerCase()} above to list its documents.</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={5}>
                    {docs.length === 0 ? 'No documents on this ' + kindLabel.toLowerCase() + '.' : 'No documents match your search.'}
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const rules = Array.isArray(d.rules) ? d.rules : [];
                  const restricted = d.isRestricted || rules.length > 0;
                  return (
                    <tr key={d.commentId}>
                      <td>
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noopener noreferrer">{d.filename}</a>
                        ) : (
                          d.filename || '—'
                        )}
                      </td>
                      <td>{d.uploadedBy || '—'}</td>
                      <td>{fmtDateTime(d.createdAt)}</td>
                      <td>
                        {!restricted ? (
                          <span style={{ color: '#1b7a42', fontWeight: 600 }}>Public</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {rules.map((r, i) => (
                              <span key={i} className="uidai-role-tag">
                                {ruleLabel(r, divisionLabelByCode, orgNameById)}
                              </span>
                            ))}
                            {rules.length === 0 && (
                              <span style={{ color: '#b45309', fontWeight: 600 }}>Restricted</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="uidai-pmis-btn uidai-pmis-btn-small"
                          onClick={() => setEditingDoc(d)}
                        >
                          Manage Access
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingDoc && (
        <AccessModal
          doc={editingDoc}
          roleSlugs={roleSlugs}
          divisions={divisions}
          orgs={orgs}
          onClose={() => setEditingDoc(null)}
          onSave={saveRules}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   AccessModal — pick the roles that may see this document. Each
   granted role can optionally be narrowed to an organization and/or a
   division; leaving both blank grants the role at every scope.

   Saving with nothing checked sends `rules: []`, which is how the
   backend is told to make the document public again.
   ───────────────────────────────────────────────────────────────── */
function AccessModal({ doc, roleSlugs, divisions, orgs, onClose, onSave }) {
  /* Local rule state keyed by role slug so toggling a checkbox doesn't
     lose the scope the user already picked for it. */
  const [byRole, setByRole] = useState(() => {
    const m = {};
    (Array.isArray(doc.rules) ? doc.rules : []).forEach((r) => {
      if (!r?.roleName) return;
      m[r.roleName] = {
        organizationId: r.organizationId || '',
        division: r.division || '',
      };
    });
    return m;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const selected = Object.keys(byRole);

  function toggleRole(slug) {
    setByRole((prev) => {
      const next = { ...prev };
      if (next[slug]) delete next[slug];
      else next[slug] = { organizationId: '', division: '' };
      return next;
    });
  }

  function setScope(slug, key, value) {
    setByRole((prev) => ({ ...prev, [slug]: { ...prev[slug], [key]: value } }));
  }

  async function submit(rules) {
    setSaving(true);
    setError('');
    try {
      await onSave(doc.commentId, rules);
    } catch (err) {
      setError(err?.message || 'Failed to update document access');
      setSaving(false);
    }
  }

  const handleSave = () =>
    submit(selected.map((slug) => ({ roleName: slug, ...byRole[slug] })));

  return (
    <div
      className="uidai-role-overlay uidai-role-overlay--open"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="uidai-role-modal" role="document">
        <div className="uidai-role-modal__header">
          <div className="uidai-role-modal__header-text">
            <div className="uidai-role-modal__title">
              <span>Document Access</span>
            </div>
            <div className="uidai-role-modal__subtitle">
              {doc.filename} — leave every role unchecked to make this document
              public again.
            </div>
          </div>
          <button
            type="button"
            className="uidai-role-modal__close"
            onClick={onClose}
            aria-label="Close"
            disabled={saving}
          >
            ✕
          </button>
        </div>

        <div className="uidai-role-modal__body" tabIndex={0}>
          <div className="uidai-role-grid" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {roleSlugs.map((slug) => {
              const checked = !!byRole[slug];
              return (
                <div
                  key={slug}
                  style={{
                    border: '1px solid #e0e5ec',
                    borderRadius: 6,
                    padding: '8px 10px',
                    background: checked ? '#f5f9ff' : '#fff',
                  }}
                >
                  <label className="uidai-role-perm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={() => toggleRole(slug)}
                    />
                    <span className="uidai-role-perm__label">{prettyRole(slug)}</span>
                    <span style={{ color: '#8a94a6', fontSize: 11 }}>{slug}</span>
                  </label>
                  {checked && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <div className="uidai-pmis-field">
                        <label>Organization (optional)</label>
                        <select
                          value={byRole[slug].organizationId}
                          disabled={saving}
                          onChange={(e) => setScope(slug, 'organizationId', e.target.value)}
                        >
                          <option value="">Any organization</option>
                          {orgs.map((o) => (
                            <option key={o.vendorId} value={o.vendorId}>{o.vendorName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="uidai-pmis-field">
                        <label>Division (optional)</label>
                        <select
                          value={byRole[slug].division}
                          disabled={saving}
                          onChange={(e) => setScope(slug, 'division', e.target.value)}
                        >
                          <option value="">Any division</option>
                          {divisions.map((d) => (
                            <option key={d.code} value={d.code}>{d.label || d.code}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{error}</div>
          )}
        </div>

        <div className="uidai-role-modal__footer">
          <div className="uidai-role-modal__footer-info">
            <span>
              {selected.length === 0
                ? 'No roles granted — this document will be public.'
                : `${selected.length} role${selected.length === 1 ? '' : 's'} granted. Everyone else loses access.`}
            </span>
          </div>
          <div className="uidai-role-modal__footer-actions">
            {selected.length > 0 && (
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-cancel"
                onClick={() => submit([])}
                disabled={saving}
                title="Clear every rule and make this document public"
              >
                <FaTrashAlt style={{ marginRight: 6 }} />
                Make Public
              </button>
            )}
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-cancel"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="uidai-pmis-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Access'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
