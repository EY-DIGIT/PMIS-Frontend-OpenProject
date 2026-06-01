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

  const basePath = () => `/contracts/api/v3/projects/${encodeURIComponent(projectId)}/severity-master`;

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

  useEffect(() => {
    loadSeverity();
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
    </div>
  );
}