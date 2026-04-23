import React, { useState } from "react";

/* Generic chip-based multi-select control.
   Props:
     value: array of selected values (strings for vendors, or uids)
     options: array of strings OR array of {uid, id, name}
     onChange: (nextArray) => void
     label: display label used in placeholder
     disabled: boolean
*/
export default function ChipControl({ value = [], options = [], onChange, label = "item", disabled = false }) {
  const [selected, setSelected] = useState("");
  const isObjects = options.length > 0 && typeof options[0] === "object";
  const selSet = new Set(value);

  const remaining = isObjects
    ? options.filter((o) => !selSet.has(o.uid))
    : options.filter((o) => !selSet.has(o));

  function handleAdd() {
    if (!selected) return;
    if (value.includes(selected)) {
      setSelected("");
      return;
    }
    onChange([...value, selected]);
    setSelected("");
  }

  function handleRemove(val) {
    onChange(value.filter((v) => v !== val));
  }

  if (disabled) {
    return (
      <div className="uidai-chip-wrap">
        {value.length === 0 && <span className="uidai-hint">No items</span>}
        {value.map((val) => {
          const info = isObjects ? options.find((o) => o.uid === val) : null;
          const display = info ? (info.id ? `${info.id} — ${info.name}` : info.name) : val;
          return (
            <span key={val} className="uidai-chip">
              {display}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="uidai-chip-control">
      <div className="uidai-chip-wrap">
        {value.map((val) => {
          const info = isObjects ? options.find((o) => o.uid === val) : null;
          const display = info ? (info.id ? `${info.id} — ${info.name}` : info.name) : val;
          return (
            <span key={val} className="uidai-chip">
              {display}
              <button
                type="button"
                className="uidai-chip__remove"
                onClick={() => handleRemove(val)}
                aria-label="Remove"
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
      <div className="uidai-chip__add-row">
        <select className="uidai-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— Select {label} —</option>
          {remaining.map((o) =>
            isObjects ? (
              <option key={o.uid} value={o.uid}>
                {o.id ? `${o.id} — ` : ""}
                {o.name}
              </option>
            ) : (
              <option key={o} value={o}>
                {o}
              </option>
            )
          )}
        </select>
        <button type="button" className="uidai-btn uidai-btn--small" onClick={handleAdd}>
          + Add
        </button>
      </div>
    </div>
  );
}
