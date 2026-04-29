import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeMapping } from '../utils/helpers';

function toOption(opt) {
  if (opt && typeof opt === 'object') {
    return { label: String(opt.label ?? opt.value ?? ''), value: opt.value ?? opt.label ?? '' };
  }
  return { label: String(opt ?? ''), value: opt };
}

export default function MultiSelect({
  name,
  value,
  options,
  onChange,
  placeholder = 'Select projects',
  disabled = false
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  const normalizedOptions = useMemo(() => (options || []).map(toOption), [options]);
  const selected = normalizeMapping(value);
  const labelByValue = useMemo(() => {
    const map = new Map();
    normalizedOptions.forEach((o) => map.set(String(o.value), o.label));
    return map;
  }, [normalizedOptions]);

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, []);

  function toggleValue(val) {
    if (disabled) return;
    const key = String(val);
    const set = new Set(selected.map(String));
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange?.(Array.from(set));
  }

  const filteredOptions = normalizedOptions.filter((opt) =>
    opt.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="uidai-pmis-ms-wrap" ref={wrapRef} data-ms={name}>
      <button
        type="button"
        className="uidai-pmis-ms-toggle"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <div className="uidai-pmis-ms-display">
          {selected.length ? (
            <div className="uidai-pmis-ms-tags">
              {selected.map((v) => (
                <span className="uidai-pmis-ms-tag" key={v}>
                  {labelByValue.get(String(v)) ?? v}
                </span>
              ))}
            </div>
          ) : (
            <span className="uidai-pmis-ms-placeholder">{placeholder}</span>
          )}
        </div>
        <span className="uidai-pmis-ms-caret">▾</span>
      </button>

      {open && (
        <div className="uidai-pmis-ms-panel">
          <input
            type="text"
            className="uidai-pmis-ms-search"
            placeholder="Search project..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
          />
          <div className="uidai-pmis-ms-options">
            {filteredOptions.length ? (
              filteredOptions.map((opt) => (
                <label className="uidai-pmis-ms-option" key={String(opt.value)}>
                  <input
                    type="checkbox"
                    checked={selected.map(String).includes(String(opt.value))}
                    disabled={disabled}
                    onChange={() => toggleValue(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))
            ) : (
              <div className="uidai-pmis-ms-empty">No matching projects</div>
            )}
          </div>
        </div>
      )}

      <input type="hidden" name={name} value={selected.join(', ')} readOnly />
    </div>
  );
}
