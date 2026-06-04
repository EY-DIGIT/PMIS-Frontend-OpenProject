import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import { uiStore } from "../../store/project/uiStore";
import "../../styles/global.css";

function normalizeServerItems(payload) {
  if (!payload) return [];
  const raw = payload.data ?? payload ?? {};
  const elements = raw.levels ?? raw._embedded?.elements ?? raw.elements ?? raw;
  const list = Array.isArray(elements) ? elements : [];
  return list.map((it, idx) => ({
    level: Number(it.level ?? it.severity_level ?? it.sl ?? it.severityLevel ?? it.levelValue ?? 0),
    points: Number(it.points ?? it.point ?? it.value ?? 0),
    label: String(it.label ?? it.name ?? `Level ${it.level ?? it.severity_level ?? idx}`)
  }));
}

function normalizeLdBands(payload) {
  if (!payload) return [];
  const raw = payload.data ?? payload ?? {};
  const elements = raw._embedded?.elements ?? raw.bands ?? raw.elements ?? raw;
  const list = Array.isArray(elements) ? elements : [];
  return list.map((it, idx) => ({
    id: it.id ?? it.band_id ?? it.bandId ?? null,
    points_threshold: Number(it.points_threshold ?? it.pointsThreshold ?? it.points ?? 0),
    ld_percent: Number(it.ld_percent ?? it.ldPercent ?? it.ld ?? 0),
    label: String(it.label ?? it.name ?? `Band ${idx}`),
  }));
}

export default function SeverityPage() {
  const { projectId } = useParams();
  const [rows, setRows] = useState([{ level: 0, points: 0, label: 'Level 0' }]);
  const [loading, setLoading] = useState(false);
  const [serverPresent, setServerPresent] = useState(false);
  const [debugOpen, setDebugOpen] = useState(true);
  const [lastResponseText, setLastResponseText] = useState("");
  const [lastStatus, setLastStatus] = useState(null);
  const [lastHeaders, setLastHeaders] = useState({});
  const [editMode, setEditMode] = useState(false);
  // LD bands state
  const [ldRows, setLdRows] = useState([]);
  const [ldLoading, setLdLoading] = useState(false);
  const [ldServerPresent, setLdServerPresent] = useState(false);
  const [ldEditMode, setLdEditMode] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  const basePath = () => `/contracts/api/v3/projects/${encodeURIComponent(projectId)}/severity-master`;
  const baseLdPath = () => `/contracts/api/v3/projects/${encodeURIComponent(projectId)}/ld-bands`;

  async function captureResponse(res) {
    const text = await res.text().catch(() => "");
    setLastResponseText(text || "");
    setLastStatus(res.status);
    const headers = {};
    try { res.headers.forEach((v, k) => { headers[k] = v; }); } catch (e) { }
    setLastHeaders(headers);
    return text;
  }

  async function loadSeverity() {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await authorizedFetch(basePath(), { method: 'GET' });
      const text = await captureResponse(res);

      if (res.ok) {
        const payload = text ? JSON.parse(text) : null;
        const items = normalizeServerItems(payload?.data ?? payload ?? {});
        setRows(items.length ? items : [{ level: 0, points: 0, label: 'Level 0' }]);
        setServerPresent(!!items.length);
        setEditMode(false);
        return;
      }

      // 404 = no severity config yet, that's fine — start fresh
      if (res.status === 404) {
        setRows([{ level: 0, points: 0, label: 'Level 0' }]);
        setServerPresent(false);
        setEditMode(false);
        return;
      }

      // Any other error
      const parsedErr = (() => { try { return JSON.parse(text); } catch { return text; } })();
      const msg = parsedErr?.message || parsedErr?.error?.message || `Request failed (${res.status})`;
      setEditMode(false);
      uiStore.showError(msg);
    } catch (err) {
      setEditMode(false);
      uiStore.showError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadLdBands() {
    if (!projectId) return;
    setLdLoading(true);
    try {
      const res = await authorizedFetch(baseLdPath(), { method: 'GET' });
      const text = await captureResponse(res);
      if (res.ok) {
        const payload = text ? JSON.parse(text) : null;
        const items = normalizeLdBands(payload?.data ?? payload ?? {});
        setLdRows(items.length ? items : []);
        setLdServerPresent(!!items.length);
        setLdEditMode(false);
        return;
      }
      if (res.status === 404) {
        setLdRows([]);
        setLdServerPresent(false);
        setLdEditMode(false);
        return;
      }
      const parsedErr = (() => { try { return JSON.parse(text); } catch { return text; } })();
      const msg = parsedErr?.message || parsedErr?.error?.message || `Request failed (${res.status})`;
      uiStore.showError(msg);
    } catch (err) {
      uiStore.showError(err?.message || String(err));
    } finally {
      setLdLoading(false);
    }
  }

  useEffect(() => {
    loadSeverity();
    loadLdBands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function updateRow(index, field, value) {
    setRows((prev) => {
      const copy = prev.map((r) => ({ ...r }));
      copy[index][field] = field === 'level' || field === 'points' ? Number(value) : value;
      return copy;
    });
  }

  function addRow() {
    setRows((prev) => {
      const usedLevels = prev.map((r) => Number.isFinite(r.level) ? r.level : 0);
      const nextLevel = usedLevels.length ? Math.max(...usedLevels) + 1 : 0;
      return [...prev, { level: Math.min(4, nextLevel), points: 0, label: `Level ${Math.min(4, nextLevel)}` }];
    });
  }

  function removeRow(index) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function validateRows() {
    for (const item of rows) {
      if (Number.isNaN(item.level) || item.level < 0 || item.level > 4)
        return 'Severity level must be an integer between 0 and 4.';
      if (Number.isNaN(item.points) || item.points < -100 || item.points > 100)
        return 'Points must be an integer between -100 and 100.';
      if (!item.label?.trim())
        return 'Each severity level requires a label.';
    }
    return null;
  }

  async function doSave() {
    if (!projectId) return uiStore.showError('Missing project id');

    const validationError = validateRows();
    if (validationError) return uiStore.showError(validationError);

    const normalized = rows.map((r) => ({
      level: Number(r.level),
      points: Number(r.points),
      label: String(r.label || `Level ${r.level}`)
    }));

    uiStore.showLoader('Saving severity settings');

    try {
      if (!serverPresent) {
        // No existing config → POST the full list
        const res = await authorizedFetch(basePath(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ levels: normalized })
        });
        const text = await captureResponse(res);

        if (res.ok) {
          setServerPresent(true);
          setEditMode(false);
          uiStore.hideLoader();
          uiStore.showMessage('Severity settings saved successfully');
          return;
        }

        const parsedErr = (() => { try { return JSON.parse(text); } catch { return text; } })();
        const msg = parsedErr?.message || parsedErr?.error?.message || `Save failed (${res.status})`;
        uiStore.hideLoader();
        uiStore.showError(msg);

      } else {
        // Existing config → PATCH each level individually
        // PATCH /api/v3/projects/{project_id}/severity-master/{level}
        const results = await Promise.all(
          normalized.map(async (item) => {
            const res = await authorizedFetch(`${basePath()}/${item.level}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ points: item.points, label: item.label })
            });
            const text = await res.text().catch(() => "");
            return { ok: res.ok, status: res.status, text, level: item.level };
          })
        );

        // Update debug panel with last result

        uiStore.hideLoader();
        setEditMode(false);
        uiStore.showMessage('Severity settings saved successfully');
      }
    } catch (err) {
      uiStore.hideLoader();
      uiStore.showError(err?.message || 'Failed to save severity settings');
    }
  }

    // LD helpers and save
    function updateLdRow(index, field, value) {
      setLdRows((prev) => {
        const copy = prev.map((r) => ({ ...r }));
        copy[index][field] = field === 'points_threshold' || field === 'ld_percent' ? Number(value) : value;
        return copy;
      });
    }

    function addLdRow() {
      setLdRows((prev) => [...prev, { id: null, points_threshold: 0, ld_percent: 10, label: `Band ${prev.length + 1}` }]);
    }

    function removeLdRow(index) {
      setLdRows((prev) => prev.filter((_, i) => i !== index));
    }

    function validateLdRows() {
      for (const item of ldRows) {
        if (Number.isNaN(item.points_threshold)) return 'Points threshold must be a number.';
        if (Number.isNaN(item.ld_percent) || item.ld_percent < 0 || item.ld_percent > 100) return 'LD percent must be 0–100.';
        if (!item.label?.trim()) return 'Each LD band requires a label.';
      }
      return null;
    }

    async function doSaveLd() {
      if (!projectId) return uiStore.showError('Missing project id');
      const validationError = validateLdRows();
      if (validationError) return uiStore.showError(validationError);

      uiStore.showLoader('Saving LD bands');
      try {
        const normalized = ldRows.map((r) => ({ points_threshold: Number(r.points_threshold), ld_percent: Number(r.ld_percent), label: String(r.label) }));
        if (!ldServerPresent) {
          const res = await authorizedFetch(baseLdPath(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ bands: normalized }),
          });
          const text = await captureResponse(res);
          if (res.ok) {
            setLdServerPresent(true);
            setLdEditMode(false);
            uiStore.hideLoader();
            uiStore.showMessage('LD bands saved successfully');
            await loadLdBands();
            return;
          }
          const parsedErr = (() => { try { return JSON.parse(text); } catch { return text; } })();
          const msg = parsedErr?.message || parsedErr?.error?.message || `Save failed (${res.status})`;
          uiStore.hideLoader();
          uiStore.showError(msg);
          return;
        }

        const toPatch = [];
        const toCreate = [];
        for (const r of ldRows) {
          if (r.id) toPatch.push(r);
          else toCreate.push(r);
        }

        await Promise.all(toPatch.map(async (item) => {
          const res = await authorizedFetch(`${baseLdPath()}/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ points_threshold: Number(item.points_threshold), ld_percent: Number(item.ld_percent), label: item.label }),
          });
          await res.text().catch(() => '');
        }));

        if (toCreate.length) {
          await authorizedFetch(baseLdPath(), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ bands: toCreate.map((r) => ({ points_threshold: Number(r.points_threshold), ld_percent: Number(r.ld_percent), label: r.label })) }) });
        }

        uiStore.hideLoader();
        setLdEditMode(false);
        uiStore.showMessage('LD bands saved successfully');
        await loadLdBands();
      } catch (err) {
        uiStore.hideLoader();
        uiStore.showError(err?.message || 'Failed to save LD bands');
      }
    }

    async function seedMasterDefaults() {
      if (!projectId) return uiStore.showError('Missing project id');
      setSeedLoading(true);
      setSeedResult(null);
      try {
        const res = await authorizedFetch(`/contracts/api/v3/projects/${encodeURIComponent(projectId)}/seed-master-defaults`, {
          method: 'POST',
          headers: { Accept: 'application/json' },
        });
        const text = await captureResponse(res);
        const payload = text ? JSON.parse(text) : null;
        if (res.ok) {
          setSeedResult( payload ?? null);
          uiStore.showMessage('Seed defaults completed successfully');
          await loadSeverity();
          await loadLdBands();
          return;
        }
        const parsedErr = (() => { try { return JSON.parse(text); } catch { return text; } })();
        const msg = parsedErr?.message || parsedErr?.error?.message || `Seed failed (${res.status})`;
        uiStore.showError(msg);
      } catch (err) {
        uiStore.showError(err?.message || 'Failed to seed master defaults');
      } finally {
        setSeedLoading(false);
      }
    }

  // Inline control styling for inputs that live inside table cells (matches
  // the convention used by the other project pages, e.g. ActivitySlasPage).
  const ctrl = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--uidai-pmis-border)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--uidai-pmis-text)",
    font: "inherit",
    fontSize: 13,
    boxSizing: "border-box",
  };
  const sectionHead = { fontSize: 16, fontWeight: 800, color: "#173e77", marginBottom: 16 };
  const muted = { color: "var(--uidai-pmis-muted)" };

  return (
    <div className="uidai-pmis-content">
      <div className="uidai-pmis-title">Severity</div>
      <div className="uidai-pmis-subtitle" style={{ marginTop: -10 }}>
        Set severity levels, points, and labels below. Levels are 0–4, points are -100 to 100, and label text must be 1–100 characters.
      </div>

      {/* Severity levels & points */}
      <div className="uidai-pmis-card">
        <div style={sectionHead}>Severity Levels &amp; Points</div>
        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ minWidth: 520, marginTop: 0 }}>
            <thead>
              <tr>
                <th>Severity Level (SL)</th>
                <th>Points</th>
                <th>Label</th>
                {editMode && <th style={{ textAlign: "center", width: 70 }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={editMode ? 4 : 3} style={{ textAlign: "center", padding: 24, ...muted }}>Loading…</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i}>
                  {editMode ? (
                    <>
                      <td><input style={ctrl} type="number" min="0" max="4" value={r.level} onChange={(e) => updateRow(i, 'level', e.target.value)} /></td>
                      <td><input style={ctrl} type="number" min="-100" max="100" value={r.points} onChange={(e) => updateRow(i, 'points', e.target.value)} /></td>
                      <td><input style={ctrl} type="text" maxLength="100" value={r.label || ''} onChange={(e) => updateRow(i, 'label', e.target.value)} /></td>
                      <td style={{ textAlign: "center" }}>
                        <button type="button" className="uidai-pm-icon-btn uidai-pm-icon-btn--danger" title="Remove" onClick={() => removeRow(i)}>✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{r.level}</td>
                      <td>{r.points}</td>
                      <td>{r.label}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editMode && (
          <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 12 }} onClick={addRow}>
            + Add Severity
          </button>
        )}

        <div className="uidai-pmis-action-row">
          {!editMode ? (
            <button type="button" className="uidai-pmis-btn" onClick={() => setEditMode(true)} disabled={loading}>Edit</button>
          ) : (
            <>
              <button type="button" className="uidai-pmis-btn" onClick={doSave} disabled={loading}>Save</button>
              <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => setEditMode(false)} disabled={loading}>Cancel</button>
            </>
          )}
        </div>
      </div>

      {/* LD bands */}
      <div className="uidai-pmis-card">
        <div style={sectionHead}>LD Bands</div>
        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ minWidth: 520, marginTop: 0 }}>
            <thead>
              <tr>
                <th>Points Threshold</th>
                <th>LD Percent</th>
                <th>Label</th>
                {ldEditMode && <th style={{ textAlign: "center", width: 70 }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {ldLoading ? (
                <tr><td colSpan={ldEditMode ? 4 : 3} style={{ textAlign: "center", padding: 24, ...muted }}>Loading…</td></tr>
              ) : ldRows.length === 0 ? (
                <tr><td colSpan={ldEditMode ? 4 : 3} style={{ textAlign: "center", padding: 24, ...muted }}>No LD bands configured.</td></tr>
              ) : ldRows.map((b, i) => (
                <tr key={b.id || i}>
                  {ldEditMode ? (
                    <>
                      <td><input style={ctrl} type="number" value={b.points_threshold} onChange={(e) => updateLdRow(i, 'points_threshold', e.target.value)} /></td>
                      <td><input style={ctrl} type="number" min={0} max={100} value={b.ld_percent} onChange={(e) => updateLdRow(i, 'ld_percent', e.target.value)} /></td>
                      <td><input style={ctrl} type="text" value={b.label || ''} onChange={(e) => updateLdRow(i, 'label', e.target.value)} /></td>
                      <td style={{ textAlign: "center" }}>
                        <button type="button" className="uidai-pm-icon-btn uidai-pm-icon-btn--danger" title="Remove" onClick={() => removeLdRow(i)}>✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{b.points_threshold}</td>
                      <td>{b.ld_percent}</td>
                      <td>{b.label}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ldEditMode && (
          <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 12 }} onClick={addLdRow}>
            + Add Band
          </button>
        )}

        <div className="uidai-pmis-action-row">
          {!ldEditMode ? (
            <button type="button" className="uidai-pmis-btn" onClick={() => setLdEditMode(true)} disabled={ldLoading}>Edit</button>
          ) : (
            <>
              <button type="button" className="uidai-pmis-btn" onClick={doSaveLd} disabled={ldLoading}>Save</button>
              <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => setLdEditMode(false)} disabled={ldLoading}>Cancel</button>
            </>
          )}
        </div>
      </div>

      {/* this is for severity and ld calculation for future use, currently hidden  */}
      {/* <div className="uidai-pmis-card">
        <div style={sectionHead}>Seed Master Defaults</div>
        <p style={muted}>Use this to create default severity levels and LD bands for the project.</p>
        <div className="uidai-pmis-action-row">
          <button type="button" className="uidai-pmis-btn" onClick={seedMasterDefaults} disabled={seedLoading}>
            {seedLoading ? 'Seeding…' : 'Seed Master Defaults'}
          </button>
        </div>
        {seedResult && (
          <div className="uidai-pmis-table-wrap" style={{ marginTop: 16 }}>
            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ minWidth: 520, marginTop: 0 }}>
              <thead>
                <tr><th>Severity Levels</th><th>LD Bands</th><th>Message</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{seedResult?.data?.severity_levels ?? seedResult.severityLevels ?? '-'}</td>
                  <td>{seedResult?.data?.ld_bands ?? seedResult.ldBands ?? '-'}</td>
                  <td>{seedResult.message ?? ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div> */}

    </div>
  );
}