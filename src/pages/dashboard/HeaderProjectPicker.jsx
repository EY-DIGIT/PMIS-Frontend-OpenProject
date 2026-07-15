/* Header-mounted project picker for the Project View (matches the mockup,
   where the project dropdown lives in the top bar next to "Project View").
   Self-contained: fetches the dashboard project list once, renders a
   searchable combo, and navigates to /dashboard/project?id=<code> on pick.
   Rendered by Layout only on the /dashboard/project route. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { projectsList as fetchDashboardProjects, projectCardToLegacy } from "../../api/dashboard";

export default function HeaderProjectPicker() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectedId = params.get("id") || "";

  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchDashboardProjects({ pageSize: 200 })
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        setList(cards.map(projectCardToLegacy).filter(Boolean));
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // The Project view loads by UUID (the /full endpoint is keyed by uuid),
  // so navigate with p.uuid while still showing the human project code.
  const selected = list.find((p) => p.uuid === selectedId || p.id === selectedId);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((p) => [p.id, p.name, p.organisation].join(" ").toLowerCase().includes(q)) : list;
  }, [list, query]);

  function pick(uuid) {
    setOpen(false); setQuery("");
    navigate(`/dashboard/project?id=${encodeURIComponent(uuid)}`, { state: { tick: Date.now() } });
  }

  return (
    <div className={`pmis-hpick${open ? " open" : ""}`} ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="pmis-hpick-btn" onClick={() => setOpen((o) => !o)}>
        <span className="pmis-hpick-label">
          {selected ? `${selected.id}  ${selected.name}` : "Select a project"}
        </span>
        <span className="pmis-hpick-caret">▾</span>
      </button>
      <div className="pmis-hpick-menu">
        <input
          className="pmis-hpick-search" type="search" placeholder="Search project"
          value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
        />
        <div className="pmis-hpick-list">
          {!loaded && <div className="pmis-hpick-empty">Loading…</div>}
          {loaded && filtered.length === 0 && <div className="pmis-hpick-empty">No matching project.</div>}
          {filtered.map((p) => (
            <button key={p.id} type="button"
              className={`pmis-hpick-opt${p.uuid === selectedId ? " active" : ""}`}
              onClick={() => pick(p.uuid)}>
              <span className="pmis-hpick-opt-id">{p.id}</span>
              <span className="pmis-hpick-opt-name">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
