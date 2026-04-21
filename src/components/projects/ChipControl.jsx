import React, { useState, useMemo } from 'react';

/**
 * Multi-select chip input.
 * Props:
 *  - values: array of selected keys
 *  - options: array of strings OR array of { uid, id, name }
 *  - onChange(values[])
 *  - disabled
 *  - label: text for the placeholder ("vendor", "dependency")
 */
export default function ChipControl({ values, options, onChange, disabled, label }) {
  const [picked, setPicked] = useState('');

  const isObjectMode = useMemo(
    () => Array.isArray(options) && options.length > 0 && typeof options[0] === 'object',
    [options]
  );

  const valueSet = useMemo(() => new Set(values || []), [values]);
  const remaining = useMemo(() => {
    if (!options) return [];
    return isObjectMode
      ? options.filter((o) => !valueSet.has(o.uid))
      : options.filter((o) => !valueSet.has(o));
  }, [options, valueSet, isObjectMode]);

  const displayFor = (val) => {
    if (isObjectMode) {
      const f = options.find((o) => o.uid === val);
      return f ? (f.id ? `${f.id} — ${f.name}` : f.name) : val;
    }
    return val;
  };

  const handleAdd = () => {
    if (!picked) return;
    if ((values || []).includes(picked)) { setPicked(''); return; }
    onChange([...(values || []), picked]);
    setPicked('');
  };
  const handleRemove = (val) => onChange((values || []).filter((v) => v !== val));

  if (disabled) {
    if (!values || values.length === 0) {
      return <div className="pmis-hint">No {label || 'items'} selected</div>;
    }
    return (
      <div className="pmis-chip-wrap">
        {values.map((v) => <span key={v} className="pmis-chip">{displayFor(v)}</span>)}
      </div>
    );
  }

  return (
    <div className="pmis-chip-control">
      <div className="pmis-chip-wrap">
        {(values || []).map((v) => (
          <span key={v} className="pmis-chip" data-val={v}>
            {displayFor(v)}
            <button type="button" className="pmis-chip-remove" onClick={() => handleRemove(v)} aria-label="Remove">✕</button>
          </span>
        ))}
      </div>
      <div className="pmis-chip-add-row">
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">— Select {label || 'item'} —</option>
          {remaining.map((o) =>
            isObjectMode
              ? <option key={o.uid} value={o.uid}>{o.id ? `${o.id} — ` : ''}{o.name}</option>
              : <option key={o} value={o}>{o}</option>
          )}
        </select>
        <button type="button" className="pmis-btn pmis-btn-small" onClick={handleAdd} disabled={!picked}>+ Add</button>
      </div>
    </div>
  );
}
