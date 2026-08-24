/* ══════════════════════════════════════════════════════════════════
   src/pages/dashboard/kit.jsx

   Presentational building blocks for the mockup "pro" dashboard layout:
   gradient KPI cards, mini gauge ring, the view-switcher bar, widget
   card shell, segmented toggle and a couple of compact stat/bar blocks.
   Kept separate from charts.jsx (recharts) so these stay dependency-free.
   ══════════════════════════════════════════════════════════════════ */

import { useNavigate } from "react-router-dom";
import { Sparkline } from "./charts";

/* ─── View switcher bar (Summary / Project / Organization) ───────── */

const VIEW_OPTIONS = [
  { value: "/dashboard/summary", label: "Summary View" },
  { value: "/dashboard/project", label: "Project View" },
  { value: "/dashboard/org", label: "Organization View" },
];

export function ViewBar({ title, current, right }) {
  const navigate = useNavigate();
  return (
    <div className="dp-viewbar">
      <span className="dp-viewbar-title">{title}</span>
      <span className="dp-viewswitch">
        <select value={current} onChange={(e) => navigate(e.target.value)}>
          {VIEW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </span>
      <span className="dp-viewbar-spacer" />
      {right}
    </div>
  );
}

/* ─── Mini gauge ring (for On-Track% / SLA% KPI cards) ───────────── */

export function MiniGauge({ value, size = 62, stroke = 7, track = "rgba(255,255,255,.3)", color = "#fff", textColor = "#fff" }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="dp-minigauge" style={{ width: size, height: size, flexBasis: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} />
      </svg>
      <span className="dp-minigauge-txt" style={{ color: textColor }}>{pct}%</span>
    </div>
  );
}

/* ─── Gradient KPI card ──────────────────────────────────────────
   tone: blue|cyan|teal|green|orange|red|amber|purple|slate
   value: big number/string
   split: [{k,v}, …]  small paired sub-stats
   foot / delta: caption lines
   gauge: number → renders a mini ring on the right
   spark: number[] → sparkline bottom-right
   icon: emoji/char */
export function KpiCard({ tone = "blue", label, value, split, foot, delta, gauge, spark, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`dp-kpi ${tone}`} onClick={onClick || undefined}>
      <div className="dp-kpi-top">
        <div>
          <div className="dp-kpi-label">{label}</div>
          <div className="dp-kpi-value">{value}</div>
        </div>
      </div>
      <div className="dp-kpi-body">
        <div>
          {split && (
            <div className="dp-kpi-split">
              {split.map((s) => (
                <div key={s.k} className="dp-kpi-split-item">
                  <span className="dp-kpi-split-k">{s.k}</span>
                  <span className="dp-kpi-split-v">{s.v}</span>
                </div>
              ))}
            </div>
          )}
          {foot && <div className="dp-kpi-foot">{foot}</div>}
          {delta && <div className="dp-kpi-delta">{delta}</div>}
        </div>
        {gauge != null && <MiniGauge value={gauge} size={74} stroke={8} />}
      </div>
      {spark && spark.length > 1 && (
        <div className="dp-kpi-spark"><Sparkline points={spark} color="rgba(255,255,255,.92)" height={42} strokeWidth={2.6} /></div>
      )}
    </Tag>
  );
}

/* ─── Widget card shell ──────────────────────────────────────────── */

export function Widget({ title, sub, link, onLink, onClick, children, className = "" }) {
  const clickable = !!onClick;
  // Whole-card click navigates, but let inner interactive elements (buttons,
  // links, inputs, chart rows) handle their own clicks first.
  const handleCard = (e) => {
    if (e.target.closest("button, a, input, select, textarea, label")) return;
    onClick();
  };
  return (
    <div
      className={`dp-widget ${clickable ? "clickable" : ""} ${className}`}
      onClick={clickable ? handleCard : undefined}
    >
      <div className="dp-widget-head">
        <span className="dp-widget-title">{title}</span>
        {sub && <span className="dp-widget-sub">{sub}</span>}
      </div>
      {children}
      {link && <button type="button" className="dp-widget-link" onClick={onLink}>{link} →</button>}
    </div>
  );
}

/* ─── Segmented toggle ───────────────────────────────────────────── */

export function SegToggle({ options, value, onChange }) {
  return (
    <div className="dp-seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─── 2x2 mini-stat block ────────────────────────────────────────── */

export function Stat4({ items }) {
  return (
    <div className="dp-stat4">
      {items.map((it) => (
        <div key={it.k} className="dp-stat4-cell">
          <span className="dp-stat4-k">{it.icon && <span>{it.icon}</span>}{it.k}</span>
          <span className="dp-stat4-v">{it.v}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Met / Breached split bars (SLA health) ─────────────────────── */

export function SplitBars({ rows }) {
  return (
    <div>
      {rows.map((r) => {
        const total = (r.a || 0) + (r.b || 0) || 1;
        return (
          <div key={r.label} className="dp-mbrow">
            <span>{r.label}</span>
            <span className="dp-mbtrack">
              <span className="dp-mbfill" style={{ width: `${(r.a / total) * 100}%`, background: r.aColor || "#1a8a3d" }} />
              <span className="dp-mbfill" style={{ width: `${(r.b / total) * 100}%`, background: r.bColor || "#e11d48" }} />
            </span>
            <span className="num">{r.aLabel ?? r.a}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Sample-data markers (for panels backed by demoFill) ────────── */

export function SampleTag() {
  return <span className="dp-sample" title="Sample data — backend endpoint pending">sample</span>;
}

export function SampleBanner() {
  return (
    <div className="dp-sample-banner">
      <span className="dp-sample">sample</span>
      Panels marked <b>sample</b> use placeholder data pending backend endpoints
      (SLA compliance, amount released, month-on-month trends). Everything else is live.
    </div>
  );
}

/* ─── Priority bars (tickets by priority) ────────────────────────── */

export function PriorityBars({ rows }) {
  const palette = ["#e11d48", "#d4440e", "#b25900", "#0aa1c0", "#1a8a3d"];
  const list = Array.isArray(rows) ? rows : [];
  const max = Math.max(...list.map((r) => Number(r.total) || 0), 1);
  const openTotal = list.reduce((sum, r) => sum + (Number(r.open) || 0), 0);
  const closedTotal = list.reduce((sum, r) => sum + (Number(r.closed) || 0), 0);
  return (
    <div className="dp-ticket-priority">
      <div className="dp-ticket-summary">
        <span><b>{openTotal}</b> open</span>
        <span><b>{closedTotal}</b> closed</span>
      </div>
      {list.map((r, index) => {
        const total = Number(r.total) || 0;
        const open = Number(r.open) || 0;
        const closed = Number(r.closed) || 0;
        const scale = total > 0 ? Math.max(12, (total / max) * 100) : 12;
        const openWidth = total > 0 ? Math.max(open ? 8 : 0, (open / total) * scale) : 0;
        const closedWidth = total > 0 ? Math.max(closed ? 8 : 0, (closed / total) * scale) : 0;
        const color = r.color || palette[index % palette.length];
        return (
        <div key={r.label} className="dp-prow" style={{ "--priority-color": color }}>
          <span className="dp-plabel"><span className="dp-pswatch" style={{ background: color }} />{r.label}</span>
          <span className="dp-ptrack" title={`${r.label}: ${open} open, ${closed} closed, ${total} total`}>
            {total > 0 ? (
              <>
                <span className="dp-pfill open" style={{ width: `${openWidth}%` }} />
                <span className="dp-pfill closed" style={{ width: `${closedWidth}%` }} />
              </>
            ) : <span className="dp-pfill zero" />}
          </span>
          <span className="dp-pmeta"><b>{total}</b><small>{open} open</small></span>
        </div>
        );
      })}
      <div className="dp-ticket-legend"><span className="open">Open</span><span className="closed">Closed</span><span className="zero">No tickets</span></div>
    </div>
  );
}