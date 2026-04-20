import { useState } from 'react';

export default function FilterShell({ children }) {
  const [hidden, setHidden] = useState(false);
  return (
    <div className="uidai-pmis-filter-shell">
      <div className="uidai-pmis-filter-head">
        <div className="uidai-pmis-filter-title">Filters</div>
        <button
          type="button"
          className="uidai-pmis-filter-toggle"
          onClick={() => setHidden((v) => !v)}
        >
          {hidden ? 'Show Filters' : 'Hide Filters'}
        </button>
      </div>
      <div className={`uidai-pmis-filter-body${hidden ? ' uidai-pmis-filter-hidden' : ''}`}>
        {children}
      </div>
    </div>
  );
}
