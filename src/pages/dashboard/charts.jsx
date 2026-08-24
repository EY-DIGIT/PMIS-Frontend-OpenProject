/* ══════════════════════════════════════════════════════════════════
   src/pages/dashboard/charts.jsx

   Recharts-based chart primitives for the redesigned dashboard. Every
   chart is a thin, theme-aware wrapper so the three view files stay
   focused on layout. All charts degrade gracefully to a small "No data"
   note when handed empty input (so a missing/slow data source never
   breaks the page).

   Palette is shared with _shared.jsx (COLORS) plus a few domain accents
   used only here (finance / sla / workflow / tickets).
   ══════════════════════════════════════════════════════════════════ */

import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend as RLegend,
  AreaChart, Area,
  LineChart, Line,
} from "recharts";
import { COLORS, LABELS } from "./_shared";

/* Domain accent colors — one hue family per data domain so a chart's
   color instantly signals what it's about. */
export const DOMAIN = {
  schedule: "#0b3c88",
  scheduleSoft: "#0aa1c0",
  finance: "#1a8a3d",
  financeSoft: "#4bbf73",
  sla: "#b25900",
  slaSoft: "#e0a04a",
  workflow: "#5e3fb1",
  workflowSoft: "#9878e0",
  tickets: "#d4440e",
  ticketsSoft: "#f08762",
  neutral: "#9aa6bd",
};

/* Extra palette used for series that don't map to a status bucket. */
const SERIES = [
  "#0b3c88", "#0aa1c0", "#1a8a3d", "#b25900", "#5e3fb1",
  "#d4440e", "#3a6cb5", "#4bbf73", "#e0a04a", "#9878e0",
];

export function seriesColor(i) { return SERIES[i % SERIES.length]; }

/* ─── ₹ formatting (Indian Lakh / Crore) ───────────────────────── */

export function formatINR(n, { compact = true } = {}) {
  const v = Number(n) || 0;
  if (!compact) return "₹ " + v.toLocaleString("en-IN");
  const abs = Math.abs(v);
  if (abs >= 1e7) return "₹ " + (v / 1e7).toFixed(2).replace(/\.00$/, "") + " Cr";
  if (abs >= 1e5) return "₹ " + (v / 1e5).toFixed(2).replace(/\.00$/, "") + " L";
  if (abs >= 1e3) return "₹ " + (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return "₹ " + v.toLocaleString("en-IN");
}

/* ─── Value-axis ticks ──────────────────────────────────────────────
   Recharts word-wraps a tick label that is wider than the axis band it
   sits in. On a value axis the end ticks sit flush with the edge of the
   plot area, so a wrapped "₹ 140 Cr" loses its first line off the top of
   the SVG. Non-breaking spaces remove every break opportunity, so a value
   label always renders on one line; VALUE_AXIS_W reserves the width that
   one line needs, and AXIS_GUTTER keeps the end tick off the canvas edge. */
const valueTick = (money) =>
  money ? (v) => formatINR(v).replace(/ /g, " ") : (v) => v;
const VALUE_AXIS_W = (money) => (money ? 64 : 32);
const AXIS_GUTTER = 14;

/* ─── Shared empty state ────────────────────────────────────────── */

function NoData({ height = 220, label = "No data" }) {
  return (
    <div className="dash-chart-empty" style={{ height }}>
      <span>{label}</span>
    </div>
  );
}

/* ─── Shared tooltip ────────────────────────────────────────────── */

function ChartTooltip({ active, payload, label, money }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="dash-chart-tip">
      {label != null && <div className="dash-chart-tip-title">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="dash-chart-tip-row">
          <span className="dash-chart-tip-dot" style={{ background: p.color || p.fill }} />
          <span className="dash-chart-tip-name">{p.name}</span>
          <span className="dash-chart-tip-val">
            {money ? formatINR(p.value, { compact: false }) : (p.value ?? 0).toLocaleString("en-IN")}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Donut (status distribution) ───────────────────────────────────
   `counts` = { key: number }, `keys` = ordered keys to render. Colors
   pulled from the shared COLORS map, labels from LABELS. Renders a
   centered total + a compact legend below. */
export function DonutChart({ counts, keys, height = 230, centerLabel = "items", money = false }) {
  keys = keys || Object.keys(counts || {}).filter((k) => k !== "total");
  const data = keys
    .map((k) => ({ key: k, name: LABELS[k] || k, value: Number(counts?.[k]) || 0 }))
    .filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <NoData height={height} />;
  // A money total ("₹ 240.75 Cr") is far wider than the plain counts most
  // donuts show, and at the base size it runs into the ring. Step the font
  // down by text length so long readouts fit and short ones stay large.
  const centerText = money ? formatINR(total) : String(total);
  const sizeClass = centerText.length >= 10 ? " dash-donut-total--xs"
                  : centerText.length >= 8  ? " dash-donut-total--sm"
                  : "";
  return (
    <div className="dash-chart-flex">
      <div className="dash-chart-canvas" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data} dataKey="value" nameKey="name"
              innerRadius="62%" outerRadius="88%" paddingAngle={2}
              startAngle={90} endAngle={-270} stroke="none"
            >
              {data.map((d) => <Cell key={d.key} fill={COLORS[d.key] || DOMAIN.neutral} />)}
            </Pie>
            <Tooltip content={<ChartTooltip money={money} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="dash-donut-center">
          <span className={`dash-donut-total${sizeClass}`}>{centerText}</span>
          <span className="dash-donut-caption">{centerLabel}</span>
        </div>
      </div>
      <div className="dash-chart-legend">
        {data.map((d) => (
          <div key={d.key} className="dash-legend-item">
            <span className="dash-swatch" style={{ background: COLORS[d.key] || DOMAIN.neutral }} />
            <span className="dash-legend-name">{d.name}</span>
            <span className="dash-legend-value">
              {money ? formatINR(d.value) : d.value} ({Math.round(d.value / total * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Stacked bar ───────────────────────────────────────────────────
   `data` = [{ label, [seriesKey]: number, ... }]
   `series` = [{ key, name, color }]. Horizontal category axis. */
export function StackedBar({ data, series, height = 260, money = false, vertical = false }) {
  if (!data || !data.length || !series || !series.length) return <NoData height={height} />;
  const tickFmt = valueTick(money);
  // Angle the category axis when it would otherwise collide: many bars OR
  // long phase labels ("Phase 2 - TDS Recovery"). Truncate very long text so
  // an angled label doesn't run off the canvas.
  const maxLabelLen = Math.max(...data.map((d) => String(d.label ?? "").length), 0);
  const angled = data.length > 5 || maxLabelLen > 8;
  const catTickFmt = (v) => {
    const s = String(v ?? "");
    return s.length > 16 ? `${s.slice(0, 15)}…` : s;
  };
  return (
    <div className="dash-chart-canvas" style={{ height, flex: height === "100%" ? 1 : undefined }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={vertical ? "vertical" : "horizontal"}
          margin={{ top: AXIS_GUTTER, right: 12, bottom: angled && !vertical ? 8 : 4, left: vertical ? 8 : 0 }}
          barCategoryGap={vertical ? "22%" : "28%"}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#eef3fa" vertical={vertical} horizontal={!vertical} />
          {vertical ? (
            <>
              <XAxis type="number" tickFormatter={tickFmt} tick={{ fontSize: 10, fill: "#7a869a" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={110} tickFormatter={catTickFmt} tick={{ fontSize: 10.5, fill: "#3d4c6b" }} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tickFormatter={catTickFmt} tick={{ fontSize: 10.5, fill: "#3d4c6b" }} axisLine={false} tickLine={false}
                interval={0}
                angle={angled ? -28 : 0}
                textAnchor={angled ? "end" : "middle"}
                height={angled ? 64 : 24} />
              <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: "#7a869a" }} axisLine={false} tickLine={false} width={VALUE_AXIS_W(money)} />
            </>
          )}
          <Tooltip content={<ChartTooltip money={money} />} cursor={{ fill: "rgba(11,60,136,.05)" }} />
          <RLegend wrapperStyle={{ fontSize: 11.5, fontWeight: 700 }} iconType="circle" iconSize={9} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a"
              fill={s.color || seriesColor(i)}
              radius={i === series.length - 1 ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Horizontal ranked bar (single series) ─────────────────────────
   `data` = [{ label, value, color? }]. Good for leaderboards. */
export function RankedBar({ data, height = 260, money = false, color = DOMAIN.schedule }) {
  if (!data || !data.length) return <NoData height={height} />;
  const tickFmt = valueTick(money);
  return (
    <div className="dash-chart-canvas" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: AXIS_GUTTER, bottom: 4, left: 8 }} barCategoryGap="26%">
          <CartesianGrid strokeDasharray="3 3" stroke="#eef3fa" horizontal={false} />
          <XAxis type="number" tickFormatter={tickFmt} tick={{ fontSize: 10, fill: "#7a869a" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10.5, fill: "#3d4c6b" }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip money={money} />} cursor={{ fill: "rgba(11,60,136,.05)" }} />
          <Bar dataKey="value" name="Value" radius={[0, 5, 5, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color || color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Gauge (single % — e.g. SLA compliance, on-track) ──────────────
   `value` 0..100. Renders a radial arc + big center %. */
export function GaugeRing({ value, height = 200, label = "", color = DOMAIN.finance }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  // Semicircular speedometer arc (180°). strokeDasharray pins the fill to
  // the true 0–100 scale, so the arc length always matches the value.
  const r = 80, arc = Math.PI * r;              // semicircle length
  const fill = (pct / 100) * arc;
  const gaugeColor = pct >= 75 ? color : pct >= 50 ? "#b25900" : "#e11d48";
  return (
    <div className="dash-chart-canvas" style={{ height, position: "relative" }}>
      <svg viewBox="0 0 200 118" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#eef3fa" strokeWidth="16" strokeLinecap="round" />
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={gaugeColor} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${fill.toFixed(1)} ${arc.toFixed(1)}`} />
      </svg>
      <div className="dash-gauge-center" style={{ justifyContent: "flex-end", paddingBottom: "16%" }}>
        <span className="dash-gauge-value" style={{ color: gaugeColor }}>{pct}%</span>
        {label && <span className="dash-gauge-label">{label}</span>}
      </div>
    </div>
  );
}

/* ─── Funnel (workflow pipeline) ────────────────────────────────────
   `stages` = [{ label, value, color? }]. Rendered as tapering bars so
   it reads as a pipeline (recharts Funnel needs FunnelChart; a custom
   CSS funnel is lighter and matches the theme). */
export function FunnelBars({ stages, height }) {
  const list = (stages || []).filter(Boolean);
  if (!list.length) return <NoData height={height || 200} />;
  const max = Math.max(...list.map((s) => s.value || 0), 1);
  return (
    <div className="dash-funnel">
      {list.map((s, i) => {
        const w = Math.max(14, (s.value / max) * 100);
        const color = s.color || seriesColor(i);
        return (
          <div key={s.label} className="dash-funnel-row">
            <span className="dash-funnel-label">{s.label}</span>
            <div className="dash-funnel-track">
              <div className="dash-funnel-bar" style={{ width: `${w}%`, background: color }}>
                <span className="dash-funnel-val">{s.value}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Trend (area / line over time) ─────────────────────────────────
   `data` = [{ label, [seriesKey]: number }], `series` = [{key,name,color}] */
export function TrendArea({ data, series, height = 240, money = false }) {
  if (!data || !data.length || !series || !series.length) return <NoData height={height} />;
  const tickFmt = valueTick(money);
  return (
    <div className="dash-chart-canvas" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: AXIS_GUTTER, right: 12, bottom: 4, left: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color || seriesColor(i)} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color || seriesColor(i)} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef3fa" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#3d4c6b" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: "#7a869a" }} axisLine={false} tickLine={false} width={VALUE_AXIS_W(money)} />
          <Tooltip content={<ChartTooltip money={money} />} />
          <RLegend wrapperStyle={{ fontSize: 11.5, fontWeight: 700 }} iconType="circle" iconSize={9} />
          {series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name}
              stroke={s.color || seriesColor(i)} strokeWidth={2.4}
              fill={`url(#grad-${s.key})`} dot={false} activeDot={{ r: 4 }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Mini sparkline (for KPI tiles) ────────────────────────────────
   `points` = number[]. No axes, no tooltip — pure trend hint. */
export function Sparkline({ points, color = DOMAIN.schedule, height = 34, strokeWidth = 2 }) {
  const data = (points || []).map((v, i) => ({ i, v: Number(v) || 0 }));
  if (data.length < 2) return null;
  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={strokeWidth} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}