import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './CriticalPathAnalysis.css';
import { authorizedFetch, API_BASE } from '../../api/client';
import { getToken, logout } from '../../api/auth';
import { ENDPOINTS } from '../../api/endpoint';

/* ===================================================================
   DEPENDENCY TABLE
   =================================================================== */
function DependencyTable({ activities, durationOverrides, onDurationChange }) {
  return (
    <div className="cpa-table-wrap">
      <table className="cpa-grid" aria-label="Activities and their dependencies">
        <thead>
          <tr>
            <th>#</th>
            <th>Activity ID</th>
            <th>Milestone</th>
            <th>Activity Name</th>
            <th>Duration (days)</th>
            <th>Delay (days)</th>
            <th>Depends On</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a, idx) => (
            <tr key={a.activityId}>
              <td className="cpa-col-num">{idx + 1}</td>
              <td className="cpa-col-id">{a.id}</td>
              <td>
                <span className="cpa-chip cpa-chip-milestone">{a.milestoneId}</span> {a.milestone}
              </td>
              <td>{a.name}</td>
              <td>
                <input
                  type="number"
                  min="1"
                  max="999"
                  className="cpa-num-input"
                  value={durationOverrides[a.activityId] ?? a.daysNeeded}
                  onChange={(e) => onDurationChange(a.activityId, e.target.value)}
                  aria-label={`Duration for ${a.id}`}
                />
              </td>
              <td className="cpa-col-num">{a.daysDelayed}</td>
              <td>
                <div className="cpa-cell-chips">
                  {a.dependsOn.length === 0 ? (
                    <span className="cpa-chip-empty">— None</span>
                  ) : (
                    a.dependsOn.map(p => <span key={p} className="cpa-chip">{p}</span>)
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ===================================================================
   CRITICAL PATH STRIP
   =================================================================== */
function CriticalPathStrip({ criticalPath, totalDays }) {
  return (
    <div className="cpa-cp-strip">
      <div className="cpa-cp-strip-title">
        Critical Path · {totalDays} days end-to-end (with delays)
      </div>
      <div className="cpa-cp-strip-explain">
        If any of these activities is late, the project will be late.
      </div>
      <div className="cpa-cp-chips">
        {criticalPath.length === 0 ? (
          <span className="cpa-cp-empty">No critical path identified.</span>
        ) : (
          criticalPath.map((c, i) => (
            <React.Fragment key={c.displayCode}>
              {i > 0 && <span className="cpa-cp-arrow">→</span>}
              <span className="cpa-cp-chip" title={c.name}>
                <span className="cpa-cp-chip-id">{c.displayCode}</span>
                {c.name}
                <span className="cpa-cp-chip-dur">
                  ({c.daysNeeded}d{c.daysDelayed > 0 ? ` +${c.daysDelayed}d` : ''} = {c.duration}d)
                </span>
              </span>
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}

/* ===================================================================
   SUMMARY TILES
   =================================================================== */
function SummaryTiles({ metadata }) {
  const { totalProjectDays, activitiesOnCriticalPath, totalActivities, totalBufferSlack, projectDelayDays } = metadata;
  const baselineDays = totalProjectDays - projectDelayDays;
  return (
    <div className="cpa-summary-tiles">
      <div className={`cpa-summary-tile ${projectDelayDays > 0 ? 'cpa-t-slip' : 'cpa-t-ok'}`}>
        <div className="cpa-summary-tile-label">Project Finishes In</div>
        <div className="cpa-summary-tile-value">
          {totalProjectDays}<small> days</small>
        </div>
        <div className="cpa-summary-tile-sub">Total project duration with delays</div>
      </div>
      <div className="cpa-summary-tile cpa-t-critical">
        <div className="cpa-summary-tile-label">Activities on Critical Path</div>
        <div className="cpa-summary-tile-value">
          {activitiesOnCriticalPath}<small> of {totalActivities}</small>
        </div>
        <div className="cpa-summary-tile-sub">These must finish on time</div>
      </div>
      <div className="cpa-summary-tile">
        <div className="cpa-summary-tile-label">Total Buffer (Slack)</div>
        <div className="cpa-summary-tile-value">
          {totalBufferSlack}<small> days</small>
        </div>
        <div className="cpa-summary-tile-sub">Spare time on non-critical activities</div>
      </div>
      <div className={`cpa-summary-tile ${projectDelayDays > 0 ? 'cpa-t-slip' : ''}`}>
        <div className="cpa-summary-tile-label">Project Delay</div>
        <div className="cpa-summary-tile-value">
          {projectDelayDays}<small> days</small>
        </div>
        <div className="cpa-summary-tile-sub">vs planned {baselineDays} days</div>
      </div>
    </div>
  );
}

/* ===================================================================
   FORMULA REFERENCE CARDS
   =================================================================== */
function FormulaCards({ totalDays }) {
  return (
    <div className="cpa-formula-grid">
      <div className="cpa-formula-card">
        <div className="cpa-formula-label">Early Start (ES)</div>
        <div className="cpa-formula-text">The earliest day this activity can begin.</div>
        <div className="cpa-formula-math">ES = max(EF of all predecessors) + 1</div>
        <div className="cpa-formula-note">If there are no predecessors → ES = 1</div>
      </div>
      <div className="cpa-formula-card">
        <div className="cpa-formula-label">Early Finish (EF)</div>
        <div className="cpa-formula-text">The earliest day this activity can be finished.</div>
        <div className="cpa-formula-math">EF = ES + Duration − 1</div>
      </div>
      <div className="cpa-formula-card">
        <div className="cpa-formula-label">Late Finish (LF)</div>
        <div className="cpa-formula-text">The latest day this activity must finish without delaying the project.</div>
        <div className="cpa-formula-math">LF = min(LS of all successors) − 1</div>
        <div className="cpa-formula-note">
          If there are no successors → LF = Project Finish Day ({totalDays})
        </div>
      </div>
      <div className="cpa-formula-card">
        <div className="cpa-formula-label">Late Start (LS)</div>
        <div className="cpa-formula-text">The latest day this activity can begin.</div>
        <div className="cpa-formula-math">LS = LF − Duration + 1</div>
      </div>
      <div className="cpa-formula-card cpa-formula-card-wide">
        <div className="cpa-formula-label">Slack</div>
        <div className="cpa-formula-text">How many days this activity can slip before delaying the project.</div>
        <div className="cpa-formula-math">Slack = LS − ES &nbsp; (equivalently LF − EF)</div>
        <div className="cpa-formula-note">
          <strong>Slack = 0 → activity is on the Critical Path.</strong>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   SCHEDULE TABLE
   =================================================================== */
function ScheduleTable({ activitySchedule }) {
  return (
    <div className="cpa-table-wrap">
      <table className="cpa-grid" aria-label="Activity schedule">
        <thead>
          <tr>
            <th>#</th>
            <th>Activity ID</th>
            <th>Milestone</th>
            <th>Activity Name</th>
            <th>Duration<br />(Planned)</th>
            <th>Duration<br />(With Delays)</th>
            <th>Depends On</th>
            <th>Early<br />Start (ES)</th>
            <th>Early<br />Finish (EF)</th>
            <th>Late<br />Start (LS)</th>
            <th>Late<br />Finish (LF)</th>
            <th>Slack</th>
            <th>On Critical<br />Path?</th>
          </tr>
        </thead>
        <tbody>
          {activitySchedule.map((a, idx) => {
            const isCrit = a.onCriticalPath;
            return (
              <tr key={a.activityId} className={isCrit ? 'cpa-row-critical' : ''}>
                <td className="cpa-col-num">{idx + 1}</td>
                <td className="cpa-col-id">{a.displayCode}</td>
                <td>
                  <span className="cpa-chip cpa-chip-milestone">{a.milestoneDisplayCode}</span> {a.milestoneName}
                </td>
                <td>{a.name}</td>
                <td className="cpa-col-num">{a.daysNeeded}</td>
                <td className="cpa-col-num">
                  {a.effectiveDuration}
                  {a.daysDelayed > 0 && <span className="cpa-delay-extra"> (+{a.daysDelayed})</span>}
                </td>
                <td>
                  <div className="cpa-cell-chips">
                    {a.dependsOn.length === 0 ? (
                      <span className="cpa-chip-empty">—</span>
                    ) : (
                      a.dependsOn.map(p => (
                        <span key={p.activityId} className={`cpa-chip ${isCrit ? 'cpa-chip-critical' : ''}`}>
                          {p.displayCode}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="cpa-col-num">{a.earlyStart}</td>
                <td className="cpa-col-num">{a.earlyFinish}</td>
                <td className="cpa-col-num">{a.lateStart}</td>
                <td className="cpa-col-num">{a.lateFinish}</td>
                <td className="cpa-col-num">
                  <strong className={isCrit ? 'cpa-buffer-crit' : 'cpa-buffer-ok'}>{a.slack}</strong>
                </td>
                <td>
                  <span className={`cpa-yesno ${isCrit ? 'cpa-yes' : 'cpa-no'}`}>
                    {isCrit ? '● Yes' : 'No'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ===================================================================
   CALCULATION CARD — uses pre-computed steps from API
   =================================================================== */
function CalculationCard({ a }) {
  const cs = a.calculationSteps;
  const isCrit = a.onCriticalPath;

  const StepRow = ({ label, step }) => (
    <div className="cpa-calc-row">
      <div className="cpa-calc-name">{label}</div>
      <div className="cpa-calc-formula">
        <div className="cpa-calc-step">{step.formula}</div>
        {step.note && <div className="cpa-calc-step" style={{ fontStyle: 'italic', color: '#666' }}>{step.note}</div>}
        <div className="cpa-calc-step">{step.substituted}</div>
        <div className="cpa-calc-step cpa-calc-result">= <strong>{step.result}</strong></div>
      </div>
    </div>
  );

  return (
    <div className={`cpa-calc-card ${isCrit ? 'cpa-calc-critical' : ''}`}>
      <div className="cpa-calc-card-head">
        <span className="cpa-calc-card-id">{a.displayCode}</span>
        <span className="cpa-calc-card-name">{a.name}</span>
        <span className="cpa-calc-card-dur">
          {a.effectiveDuration} day{a.effectiveDuration === 1 ? '' : 's'}
          {a.daysDelayed > 0 && (
            <span className="cpa-calc-delay-note">
              {' '}incl. +{a.daysDelayed} day{a.daysDelayed === 1 ? '' : 's'} delay
            </span>
          )}
        </span>
      </div>
      <div className="cpa-calc-card-body">
        <StepRow label="ES" step={cs.earlyStart} />
        <StepRow label="EF" step={cs.earlyFinish} />
        <StepRow label="LF" step={cs.lateFinish} />
        <StepRow label="LS" step={cs.lateStart} />
        <div className="cpa-calc-row cpa-calc-row-slack">
          <div className="cpa-calc-name">Slack</div>
          <div className="cpa-calc-formula">
            <div className="cpa-calc-step">{cs.slack.formula}</div>
            <div className="cpa-calc-step">{cs.slack.substituted}</div>
            <div className="cpa-calc-step cpa-calc-result">= <strong>{cs.slack.result}</strong></div>
          </div>
        </div>
      </div>
      <div className={`cpa-calc-verdict ${isCrit ? 'cpa-verdict-critical' : 'cpa-verdict-ok'}`}>
        {cs.verdict}
      </div>
    </div>
  );
}

/* ===================================================================
   FLOW DIAGRAM (SVG)
   =================================================================== */
function FlowDiagram({ activitySchedule }) {
  if (!activitySchedule || !activitySchedule.length) {
    return <div className="cpa-empty-state">No activities to draw.</div>;
  }

  const map = Object.fromEntries(activitySchedule.map(a => [a.displayCode, a]));

  const predMap = {};
  activitySchedule.forEach(a => {
    predMap[a.displayCode] = a.dependsOn.map(d => d.displayCode).filter(id => map[id]);
  });

  const level = {};
  const computing = new Set();
  function computeLevel(id) {
    if (id in level) return level[id];
    if (computing.has(id)) { level[id] = 0; return 0; }
    computing.add(id);
    const preds = predMap[id] || [];
    level[id] = preds.length === 0 ? 0 : Math.max(...preds.map(p => computeLevel(p))) + 1;
    computing.delete(id);
    return level[id];
  }
  activitySchedule.forEach(a => computeLevel(a.displayCode));

  const byLevel = {};
  activitySchedule.forEach(a => {
    const l = level[a.displayCode] ?? 0;
    (byLevel[l] = byLevel[l] || []).push(a);
  });
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);

  const nodeW = 200, nodeH = 82;
  const hGap = 60, vGap = 24;
  const padX = 60, padY = 28;

  const colXs = [];
  let x = padX;
  colXs.push(x); x += nodeW + hGap;
  levels.forEach(() => { colXs.push(x); x += nodeW + hGap; });
  colXs.push(x);
  const svgWidth = x + nodeW + padX;

  const maxPerCol = Math.max(...levels.map(l => byLevel[l].length), 1);
  const colHeight = maxPerCol * nodeH + (maxPerCol - 1) * vGap;
  const svgHeight = colHeight + padY * 2;

  const pos = {};
  levels.forEach((lv, i) => {
    const items = byLevel[lv];
    const totalH = items.length * nodeH + (items.length - 1) * vGap;
    let yy = padY + (colHeight - totalH) / 2;
    items.forEach(a => {
      pos[a.displayCode] = { x: colXs[i + 1], y: yy };
      yy += nodeH + vGap;
    });
  });
  const startPos = { x: colXs[0], y: padY + (colHeight - nodeH) / 2 };
  const endPos = { x: colXs[colXs.length - 1], y: padY + (colHeight - nodeH) / 2 };

  const renderEdge = (key, from, to, isCritical) => {
    const x1 = from.x + nodeW, y1 = from.y + nodeH / 2;
    const x2 = to.x, y2 = to.y + nodeH / 2;
    const dx = (x2 - x1) * 0.45;
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    const ax = x2 - 7;
    const cls = isCritical ? 'cpa-flow-edge cpa-flow-edge-critical' : 'cpa-flow-edge';
    const arrowCls = isCritical ? 'cpa-flow-arrow cpa-flow-arrow-critical' : 'cpa-flow-arrow';
    return (
      <g key={key}>
        <path d={d} className={cls} />
        <path d={`M ${x2} ${y2} L ${ax} ${y2 - 4} L ${ax} ${y2 + 4} Z`} className={arrowCls} />
      </g>
    );
  };

  const svgEdges = [];
  activitySchedule.filter(a => predMap[a.displayCode].length === 0).forEach(a => {
    svgEdges.push(renderEdge(`start-${a.displayCode}`, startPos, pos[a.displayCode], a.onCriticalPath));
  });
  activitySchedule.forEach(a => {
    predMap[a.displayCode].forEach(predId => {
      if (!pos[predId] || !pos[a.displayCode]) return;
      svgEdges.push(renderEdge(
        `${predId}-${a.displayCode}`,
        pos[predId], pos[a.displayCode],
        a.onCriticalPath && map[predId]?.onCriticalPath
      ));
    });
  });
  const succCount = {};
  activitySchedule.forEach(a => predMap[a.displayCode].forEach(p => { succCount[p] = (succCount[p] || 0) + 1; }));
  activitySchedule.filter(a => !succCount[a.displayCode]).forEach(a => {
    if (pos[a.displayCode]) svgEdges.push(renderEdge(`${a.displayCode}-end`, pos[a.displayCode], endPos, a.onCriticalPath));
  });

  const truncate = (s, n) => (s.length > n ? s.substring(0, n - 2) + '…' : s);

  return (
    <svg
      className="cpa-flow-svg"
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width={svgWidth}
      height={svgHeight}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Critical path flow diagram"
    >
      {svgEdges}
      <g transform={`translate(${startPos.x},${startPos.y})`}>
        <rect className="cpa-flow-node-bg cpa-flow-node-terminal" width={nodeW} height={nodeH} rx="6" ry="6" />
        <text className="cpa-flow-text cpa-flow-text-terminal" x={nodeW / 2} y={nodeH / 2 + 5} textAnchor="middle">
          ▶ Start
        </text>
      </g>
      {activitySchedule.map(a => {
        if (!pos[a.displayCode]) return null;
        const { x: nx, y: ny } = pos[a.displayCode];
        const isCrit = a.onCriticalPath;
        const bgCls = isCrit ? 'cpa-flow-node-bg cpa-flow-node-critical' : 'cpa-flow-node-bg';
        const idCls = isCrit ? 'cpa-flow-text cpa-flow-text-id cpa-flow-text-id-critical' : 'cpa-flow-text cpa-flow-text-id';
        const daysCls = isCrit ? 'cpa-flow-text cpa-flow-text-days cpa-flow-text-days-critical' : 'cpa-flow-text cpa-flow-text-days';
        const stripeCls = isCrit ? 'cpa-flow-stripe cpa-flow-stripe-critical' : 'cpa-flow-stripe';
        const durLabel = a.daysDelayed > 0 ? `${a.effectiveDuration}d (+${a.daysDelayed})` : `${a.effectiveDuration}d`;
        return (
          <g key={a.displayCode} transform={`translate(${nx},${ny})`}>
            <rect className={bgCls} width={nodeW} height={nodeH} rx="6" ry="6" />
            <rect className={stripeCls} width={nodeW} height="3" rx="2" ry="2" />
            <text className={idCls} x="10" y="20">{a.displayCode}</text>
            <text className={daysCls} x={nodeW - 10} y="20" textAnchor="end">{durLabel}</text>
            <text className="cpa-flow-text cpa-flow-text-name" x={nodeW / 2} y="42" textAnchor="middle">
              {truncate(a.name, 26)}
            </text>
            <text className="cpa-flow-text cpa-flow-text-range" x={nodeW / 2} y="64" textAnchor="middle">
              Day {a.earlyStart} → Day {a.earlyFinish}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${endPos.x},${endPos.y})`}>
        <rect className="cpa-flow-node-bg cpa-flow-node-terminal" width={nodeW} height={nodeH} rx="6" ry="6" />
        <text className="cpa-flow-text cpa-flow-text-terminal" x={nodeW / 2} y={nodeH / 2 + 5} textAnchor="middle">
          Finish ◼
        </text>
      </g>
    </svg>
  );
}

/* ===================================================================
   RESULTS SECTION
   =================================================================== */
function ResultsSection({ analysisData }) {
  const { metadata, criticalPath, activitySchedule } = analysisData;

  if (metadata.hasCycle) {
    return (
      <div className="cpa-card" id="cpa-resultsSection">
        <div className="cpa-banner cpa-banner-error">
          <span className="cpa-banner-icon">⚠</span>
          <div>
            <div className="cpa-banner-title">Circular dependency detected — cannot compute critical path</div>
            Two or more activities depend on each other in a loop. Fix the dependency links first, then run the analysis again.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cpa-card" id="cpa-resultsSection">
      <h3 className="cpa-section-title">
        Step 2 · Critical Path Results
        <span className="cpa-badge-count">Total {metadata.totalProjectDays} days</span>
      </h3>
      <p className="cpa-section-hint">
        Below is the full project schedule with dependencies and delays factored in.
        Activities highlighted in red are on the <strong>critical path</strong> — any slip there pushes the whole project out.
      </p>

      {/* Delay banner */}
      {metadata.projectDelayDays > 0 ? (
        <div className="cpa-banner cpa-banner-warn">
          <span className="cpa-banner-icon">⏱</span>
          <div>
            <div className="cpa-banner-title">
              This project is running {metadata.projectDelayDays} day{metadata.projectDelayDays === 1 ? '' : 's'} late
            </div>
            Planned finish was day {metadata.totalProjectDays - metadata.projectDelayDays}; current finish is day {metadata.totalProjectDays}.
          </div>
        </div>
      ) : (
        <div className="cpa-banner cpa-banner-success">
          <span className="cpa-banner-icon">✓</span>
          <div>
            <div className="cpa-banner-title">This project is on schedule</div>
            No delays detected. The project will finish on day {metadata.totalProjectDays}.
          </div>
        </div>
      )}

      <CriticalPathStrip criticalPath={criticalPath} totalDays={metadata.totalProjectDays} />
      <SummaryTiles metadata={metadata} />

      <h4 className="cpa-section-title cpa-subhead">How the Critical Path Is Calculated</h4>
      <p className="cpa-section-hint">
        For every activity we compute four day-numbers (Early Start, Early Finish, Late Start, Late Finish) and one slack value using these formulas:
      </p>
      <FormulaCards totalDays={metadata.totalProjectDays} />

      <h4 className="cpa-section-title cpa-subhead">Activity Schedule</h4>
      <p className="cpa-section-hint">
        Each row shows one activity with its planned duration, its effective duration including delays, and the four day-numbers plus slack from the formulas above.
      </p>
      <ScheduleTable activitySchedule={activitySchedule} />

      <h4 className="cpa-section-title cpa-subhead">Calculation Steps — Activity by Activity</h4>
      <p className="cpa-section-hint">
        For each activity the formulas are shown with actual values substituted in. Red boxes are on the critical path (slack = 0).
      </p>
      <div className="cpa-calc-grid">
        {activitySchedule.map(a => (
          <CalculationCard key={a.activityId} a={a} />
        ))}
      </div>

      <h4 className="cpa-section-title cpa-subhead">Flow Diagram</h4>
      <p className="cpa-section-hint">
        Each box is one activity. Arrows show what depends on what. Red boxes are on the critical path.
      </p>
      <div className="cpa-flow-wrap">
        <FlowDiagram activitySchedule={activitySchedule} />
      </div>
      <div className="cpa-legend">
        <span className="cpa-legend-item">
          <span className="cpa-legend-swatch cpa-legend-normal"></span>
          Regular activity — has spare time (slack &gt; 0)
        </span>
        <span className="cpa-legend-item">
          <span className="cpa-legend-swatch cpa-legend-critical"></span>
          On critical path — must finish on time (slack = 0)
        </span>
      </div>
    </div>
  );
}

/* ===================================================================
   MAIN COMPONENT
   =================================================================== */
export default function CriticalPathAnalysis() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();

  const [depLoading, setDepLoading] = useState(false);
  const [depError, setDepError] = useState('');
  const [depData, setDepData] = useState(null);

  const [durationOverrides, setDurationOverrides] = useState({});

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisData, setAnalysisData] = useState(null);
  const [showResults, setShowResults] = useState(false);

  /* Fetch dependency table on mount */
  useEffect(() => {
    if (!projectId) return;
    const token = getToken();
    if (!token) { navigate('/login'); return; }
    let cancelled = false;

    async function loadDeps() {
      setDepLoading(true);
      setDepError('');
      try {
        const res = await authorizedFetch(
          `${API_BASE}${ENDPOINTS.projects.criticalPathDependencies(projectId)}`,
          { method: 'GET', headers: { accept: 'application/json' } }
        );
        if (res.status === 401) { logout(); navigate('/login'); return; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `Request failed (${res.status})`);
        }
        const raw = await res.json();
        if (!cancelled) {
          setDepData(raw?.data ?? raw);
          setDurationOverrides({});
          setAnalysisData(null);
          setShowResults(false);
        }
      } catch (err) {
        if (!cancelled) setDepError(err?.message || 'Failed to load dependencies');
      } finally {
        if (!cancelled) setDepLoading(false);
      }
    }

    loadDeps();
    return () => { cancelled = true; };
  }, [projectId]);

  /* Map API dependencies to display-friendly activity objects */
  const activities = useMemo(() => {
    if (!depData) return [];
    return depData.dependencies.map(a => ({
      activityId: a.activityId,
      id: a.displayCode,
      name: a.name,
      milestoneId: a.milestoneDisplayCode,
      milestone: a.milestoneName,
      daysNeeded: a.daysNeeded,
      daysDelayed: a.daysDelayed,
      effectiveDuration: a.effectiveDuration,
      status: a.status,
      dependsOn: a.dependsOn.map(d => d.displayCode),
    }));
  }, [depData]);

  function handleDurationChange(activityId, raw) {
    const v = Math.max(1, Math.min(999, parseInt(raw, 10) || 1));
    setDurationOverrides(prev => ({ ...prev, [activityId]: v }));
    setShowResults(false);
  }

  async function handleCalculate() {
    if (!projectId) return;
    const token = getToken();
    if (!token) { navigate('/login'); return; }

    const overrides = Object.entries(durationOverrides).map(([activity_id, days_needed]) => ({
      activity_id,
      days_needed,
    }));

    setAnalysisLoading(true);
    setAnalysisError('');
    try {
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.projects.criticalPathAnalysis(projectId)}`,
        {
          method: 'POST',
          headers: { accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(overrides.length ? { overrides } : {}),
        }
      );
      if (res.status === 401) { logout(); navigate('/login'); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Request failed (${res.status})`);
      }
      const raw = await res.json();
      setAnalysisData(raw?.data ?? raw);
      setShowResults(true);
      setTimeout(() => {
        const el = document.getElementById('cpa-resultsSection');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (err) {
      setAnalysisError(err?.message || 'Failed to run critical path analysis');
    } finally {
      setAnalysisLoading(false);
    }
  }

  return (
    <div className="cpa-root">
      <div className="cpa-page-header">
        <div className="cpa-pm-title">
          Critical Path Analysis
          {depData?.projectId && <span style={{ marginLeft: 12, opacity: 0.7, fontWeight: 400, fontSize: '0.85em' }}>{depData.projectId}</span>}
        </div>
        <div className="cpa-pm-subtitle">
          {depData ? `${depData.totalActivities} activities loaded` : ''}
        </div>
      </div>

      {depLoading && (
        <div className="cpa-banner cpa-banner-success">
          <span className="cpa-banner-icon">⏳</span>
          <div>Loading activity dependencies…</div>
        </div>
      )}

      {depError && (
        <div className="cpa-banner cpa-banner-error" role="alert">
          <span className="cpa-banner-icon">⚠</span>
          <div>
            <div className="cpa-banner-title">Failed to load activities</div>
            {depError}
          </div>
        </div>
      )}

      {depData && (
        <div className="cpa-card">
          <h3 className="cpa-section-title">
            Step 1 · Activities &amp; What They Depend On
            <span className="cpa-badge-count">{activities.length} activities</span>
          </h3>
          <p className="cpa-section-hint">
            Each activity needs a certain number of days and may depend on other activities finishing first.
            Edit <em>Duration</em> to model what-if scenarios — overrides are sent to the server when you click Find Critical Path.
          </p>

          <DependencyTable
            activities={activities}
            durationOverrides={durationOverrides}
            onDurationChange={handleDurationChange}
          />

          {analysisError && (
            <div className="cpa-banner cpa-banner-error" style={{ marginTop: 12 }}>
              <span className="cpa-banner-icon">⚠</span>
              <div>{analysisError}</div>
            </div>
          )}

          <div className="cpa-button-row">
            <button
              className="cpa-btn"
              onClick={handleCalculate}
              disabled={analysisLoading}
            >
              {analysisLoading ? '⏳ Calculating…' : '▶ Find Critical Path'}
            </button>
          </div>
        </div>
      )}

      {showResults && analysisData && (
        <ResultsSection analysisData={analysisData} />
      )}
    </div>
  );
}
