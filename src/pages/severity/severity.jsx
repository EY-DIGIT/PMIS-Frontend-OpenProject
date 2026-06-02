import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import { uiStore } from "../../store/project/uiStore";
import "./Severity.css";

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
      setLdRows((prev) => [...prev, { id: null, points_threshold: 0, ld_percent: 100, label: `Band ${prev.length + 1}` }]);
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

  return (
    <div className="severity-page">
      <h1 className="severity-title">Severity</h1>
      <p className="severity-sub">
        Set severity levels, points, and labels below. Levels are 0–4, points are -100 to 100, and label text must be 1–100 characters.
      </p>

      <div className="severity-card">
        <h3>Severity Levels & Points</h3>
        
        {!editMode ? (
          <>
            <div className="severity-table">
              <div className="severity-header">
                <div>Severity Level (SL)</div>
                <div>Points</div>
                <div>Label</div>
              </div>
              {rows.map((r, i) => (
                <div key={i} className="severity-row">
                  <div>{r.level}</div>
                  <div>{r.points}</div>
                  <div>{r.label}</div>
                </div>
              ))}
            </div>
            <div className="severity-actions" style={{ marginTop: '20px' }}>
              <button className="btn edit" onClick={() => setEditMode(true)} disabled={loading}>Edit</button>
            </div>
          </>
        ) : (
          <>
            <div className="severity-table">
              <div className="severity-header">
                <div>Severity Level (SL)</div>
                <div>Points</div>
                <div>Label</div>
                <div></div>
              </div>

              {rows.map((r, i) => (
                <div key={i} className="severity-row">
                  <input type="number" min="0" max="4" value={r.level} onChange={(e) => updateRow(i, 'level', e.target.value)} />
                  <input type="number" min="-100" max="100" value={r.points} onChange={(e) => updateRow(i, 'points', e.target.value)} />
                  <input type="text" maxLength="100" value={r.label || ''} onChange={(e) => updateRow(i, 'label', e.target.value)} />
                  <button className="remove" onClick={() => removeRow(i)}>×</button>
                </div>
              ))}

              <button className="add" onClick={addRow}>+ Add Severity</button>
            </div>
            <div className="severity-actions" style={{ marginTop: '20px' }}>
              <button className="btn cancel" onClick={() => setEditMode(false)} disabled={loading}>Cancel</button>
              <button className="btn save" onClick={doSave} disabled={loading}>Save</button>
            </div>
          </>
        )}
      </div>
      
      <div className="severity-card" style={{ marginTop: 20 }}>
        <h3>LD Bands</h3>
        {!ldEditMode ? (
          <>
            <div className="severity-table">
              <div className="severity-header">
                <div>Points Threshold</div>
                <div>LD Percent</div>
                <div>Label</div>
              </div>
              {ldRows.length === 0 && !ldLoading ? (
                <div className="severity-row"><div colSpan={3}>No LD bands configured.</div></div>
              ) : ldRows.map((b, i) => (
                <div key={b.id || i} className="severity-row">
                  <div>{b.points_threshold}</div>
                  <div>{b.ld_percent}</div>
                  <div>{b.label}</div>
                </div>
              ))}
            </div>
            <div className="severity-actions" style={{ marginTop: '20px' }}>
              <button className="btn edit" onClick={() => setLdEditMode(true)} disabled={ldLoading}>Edit</button>
            </div>
          </>
        ) : (
          <>
            <div className="severity-table">
              <div className="severity-header">
                <div>Points Threshold</div>
                <div>LD Percent</div>
                <div>Label</div>
                <div></div>
              </div>
              {ldRows.map((b, i) => (
                <div key={b.id || i} className="severity-row">
                  <input type="number" value={b.points_threshold} onChange={(e) => updateLdRow(i, 'points_threshold', e.target.value)} />
                  <input type="number" value={b.ld_percent} min={0} max={100} onChange={(e) => updateLdRow(i, 'ld_percent', e.target.value)} />
                  <input type="text" value={b.label || ''} onChange={(e) => updateLdRow(i, 'label', e.target.value)} />
                  <button className="remove" onClick={() => removeLdRow(i)}>×</button>
                </div>
              ))}
              <button className="add" onClick={addLdRow}>+ Add Band</button>
            </div>
            <div className="severity-actions" style={{ marginTop: '20px' }}>
              <button className="btn cancel" onClick={() => setLdEditMode(false)} disabled={ldLoading}>Cancel</button>
              <button className="btn save" onClick={doSaveLd} disabled={ldLoading}>Save</button>
            </div>
          </>
        )}
      </div>
{/* this is for severity and ld calculation for future use, currently hidden  */}
      {/* <div className="severity-card" style={{ marginTop: 20 }}>
        <h3>Seed Master Defaults</h3>
        <p>Use this to create default severity levels and LD bands for the project.</p>
        <div className="severity-actions" style={{ marginTop: '20px' }}>
          <button className="btn save" onClick={seedMasterDefaults} disabled={seedLoading}>
            {seedLoading ? 'Seeding…' : 'Seed Master Defaults'}
          </button>
        </div>
        {seedResult && (
          <div className="severity-table" style={{ marginTop: 16 }}>
            <div className="severity-header">
              <div>Severity Levels</div>
              <div>LD Bands</div>
              <div>Message</div>
            </div>
            <div className="severity-row">
              <div>{seedResult?.data?.severity_levels ?? seedResult.severityLevels ?? '-'}</div>
              <div>{seedResult?.data?.ld_bands ?? seedResult.ldBands ?? '-'}</div>
              <div>{seedResult.message ?? seedResult.message ?? ''}</div>
            </div>
          </div>
        )}
      </div> */}

    </div>
  );
}