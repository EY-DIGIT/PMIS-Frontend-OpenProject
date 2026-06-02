/* ══════════════════════════════════════════════════════════════════
   _shared.jsx — bits reused across the three Meeting Management
   pages: badges, link pills, and the toast notifier.
   ══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useState } from "react";
import {
  TYPE_META,
  STATUS_META,
  AIS_META,
  projectById
} from "../../data/meetingsMock";

export function TypeBadge({ type }) {
  const m = TYPE_META[type] || { cls: "b-adhoc" };
  return <span className={`badge ${m.cls}`}>{type}</span>;
}

export function StatusBadge({ status }) {
  const m = STATUS_META[status] || { cls: "st-draft" };
  return <span className={`badge ${m.cls}`}>{status}</span>;
}

export function AiStatusBadge({ status }) {
  const m = AIS_META[status] || { cls: "ai-open" };
  return <span className={`badge ${m.cls}`}>{status}</span>;
}

export function LinkPill({ meeting }) {
  if (meeting.link === "general") {
    return <span className="pill-link pill-general">General</span>;
  }
  const p = projectById(meeting.projectId);
  return (
    <span className="pill-link">
      {meeting.projectId} · {p ? p.name : ""}
    </span>
  );
}

/* Toast — single shared instance per page mount. The hook returns a
   `show(msg, kind?)` function and the JSX node to render at the page
   root. `kind` is "ok" | "warn" | undefined.
   eslint-disable-next-line react-refresh/only-export-components — the
   hook is intentionally co-located with the Badge/Pill components used
   by the same three Meeting Management pages; splitting it would
   fragment a 70-line shared module for a HMR nicety. */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const [state, setState] = useState({ msg: "", kind: "", show: false });
  useEffect(() => {
    if (!state.show) return undefined;
    const t = setTimeout(() => setState((s) => ({ ...s, show: false })), 3200);
    return () => clearTimeout(t);
  }, [state.show, state.msg]);
  const show = useCallback((msg, kind = "") => {
    setState({ msg, kind, show: true });
  }, []);
  const node = (
    <div
      className={`pmis-mtg-toast${state.show ? " show" : ""}${
        state.kind ? " " + state.kind : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <span>{state.msg}</span>
    </div>
  );
  return { show, node };
}
