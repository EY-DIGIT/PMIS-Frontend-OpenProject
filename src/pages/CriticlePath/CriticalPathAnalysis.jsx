import React, { useState, useMemo, useEffect } from 'react';
import './CriticalPathAnalysis.css';

/* ===================================================================
   DETERMINISTIC RANDOM (for reproducible demo data)
   =================================================================== */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===================================================================
   DEMO DATA POOLS
   =================================================================== */
const PROJECT_NAMES = [
  'Aadhaar Service Migration', 'Authentication Module Upgrade', 'Resident Self-Service Portal',
  'eKYC API Modernization', 'Biometric Enrolment Platform', 'Mobile App Refresh',
  'Data Lake Implementation', 'Identity Verification Suite', 'CIDR Capacity Expansion',
  'API Gateway Rollout', 'Fraud Detection Engine', 'Document Management System',
  'Grievance Portal Redesign', 'Vault Migration Programme', 'Audit Logging Modernization',
  'DR Site Activation', 'PKI Infrastructure Refresh', 'PMIS Module Enhancement',
  'Notification Service Migration', 'Citizen Helpdesk Upgrade', 'Operator Onboarding Workflow',
  'Network Segmentation Project'
];
const OWNERS = ['TMD1', 'TMD2', 'PMO', 'ITD', 'LegalD'];
const MILESTONE_PATTERNS = [
  ['Initiation', 'Planning', 'Design', 'Development', 'Testing', 'Deployment'],
  ['Discovery', 'Design', 'Build', 'Testing', 'Release'],
  ['Requirements', 'Architecture', 'Implementation', 'UAT', 'Closure'],
  ['Initiation', 'Procurement', 'Implementation', 'Rollout', 'Closure'],
  ['Planning', 'Design', 'Development', 'Integration', 'Deployment']
];
const ACTIVITY_POOL = {
  Initiation: ['Stakeholder Mapping', 'Charter Drafting', 'Kickoff Meeting', 'Sponsor Sign-off', 'Initial Risk Review'],
  Planning: ['Resource Planning', 'Schedule Baseline', 'Risk Register', 'Communication Plan', 'Procurement Plan'],
  Requirements: ['Requirement Gathering', 'Stakeholder Interviews', 'BRD Drafting', 'Use Case Workshop', 'Requirement Sign-off'],
  Discovery: ['Market Analysis', 'Feasibility Study', 'Solution Discovery', 'Tech Spike', 'Vendor Survey'],
  Design: ['Architecture Design', 'UX Wireframes', 'Database Schema', 'API Design', 'Design Review'],
  Architecture: ['Solution Architecture', 'Tech Stack Selection', 'NFR Definition', 'POC Build', 'Architecture Review'],
  Procurement: ['RFP Drafting', 'Vendor Shortlisting', 'Bid Evaluation', 'Contract Negotiation', 'Vendor Onboarding'],
  Build: ['Component Build', 'Module Assembly', 'Build Integration', 'Build Verification', 'Release Candidate'],
  Development: ['Module Build', 'Code Integration', 'Unit Testing', 'Code Review', 'Build Automation'],
  Implementation: ['Environment Setup', 'Configuration', 'Data Migration', 'Pilot Run', 'Cutover Plan'],
  Integration: ['Interface Design', 'API Wiring', 'Data Integration', 'Integration Testing', 'Endpoint Validation'],
  Testing: ['Test Case Design', 'Functional Testing', 'Integration Testing', 'Security Audit', 'Performance Testing'],
  UAT: ['UAT Setup', 'UAT Execution', 'Defect Triage', 'UAT Sign-off', 'Bug Fix Cycle'],
  Deployment: ['Deployment Plan', 'Staging Rollout', 'Production Deploy', 'Smoke Testing', 'Go-Live Cutover'],
  Release: ['Release Notes', 'Release Approval', 'Production Push', 'Hypercare', 'Stabilization'],
  Rollout: ['Pilot Phase', 'Phased Rollout', 'Full Deployment', 'Training & Support', 'Post-Launch Review'],
  Closure: ['Documentation', 'Knowledge Transfer', 'Project Retrospective', 'Final Audit', 'Closure Sign-off']
};

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/* ===================================================================
   BUILD ONE PROJECT
   =================================================================== */
function buildProject(seed, projectId, projectName, startDate, includesCycle) {
  const rng = mulberry32(seed);
  const pattern = pick(MILESTONE_PATTERNS, rng);
  const targetCount = 10 + Math.floor(rng() * 6);
  const numMilestones = Math.min(pattern.length, 3 + Math.floor(rng() * 3));
  const milestoneNames = pattern.slice(0, numMilestones);

  const distribution = [];
  let remaining = targetCount;
  milestoneNames.forEach((m, i) => {
    const minLeft = milestoneNames.length - i - 1;
    const max = Math.min(4, remaining - minLeft * 2);
    const count = Math.max(2, Math.min(max, 2 + Math.floor(rng() * 3)));
    distribution.push(count);
    remaining -= count;
  });
  while (remaining > 0 && distribution.some(c => c < 5)) {
    const idx = Math.floor(rng() * milestoneNames.length);
    if (distribution[idx] < 5) { distribution[idx]++; remaining--; }
  }

  const milestones = milestoneNames.map((name, i) => ({ id: 'M' + (i + 1), name }));
  const activities = [];
  const milestoneTails = [];

  milestoneNames.forEach((mName, mi) => {
    const numActs = distribution[mi];
    const pool = [...(ACTIVITY_POOL[mName] || ['Activity'])];
    const inMilestone = [];
    const mNum = mi + 1;

    for (let k = 0; k < numActs; k++) {
      const nameIdx = Math.floor(rng() * pool.length);
      const aName = pool[nameIdx] || ('Activity ' + (k + 1));
      if (pool.length > 1) pool.splice(nameIdx, 1);

      const a = {
        id: `A${mNum}.${k + 1}`,
        name: aName,
        milestoneId: 'M' + mNum,
        milestone: mName,
        milestoneIndex: mi,
        duration: 2 + Math.floor(rng() * 7),
        delay: 0,
        owner: pick(OWNERS, rng),
        status: 'Not Started',
        dependsOn: []
      };

      if (k > 0 && rng() < 0.7) a.dependsOn.push(inMilestone[k - 1].id);
      if (k > 1 && rng() < 0.25) {
        const idx = Math.floor(rng() * (k - 1));
        const link = inMilestone[idx].id;
        if (!a.dependsOn.includes(link)) a.dependsOn.push(link);
      }
      if (k === 0 && mi > 0) a.dependsOn.push(milestoneTails[mi - 1]);
      if (mi > 0 && k > 0 && rng() < 0.2) {
        const backMi = Math.floor(rng() * mi);
        const candidates = activities.filter(x => x.milestoneIndex === backMi);
        if (candidates.length) {
          const link = candidates[Math.floor(rng() * candidates.length)].id;
          if (!a.dependsOn.includes(link)) a.dependsOn.push(link);
        }
      }

      activities.push(a);
      inMilestone.push(a);
    }
    if (inMilestone.length) milestoneTails.push(inMilestone[inMilestone.length - 1].id);
  });

  activities.forEach(a => {
    const r = rng();
    if (r < 0.2) { a.delay = 1 + Math.floor(rng() * 3); a.status = 'Delayed'; }
    else if (r < 0.4) { a.status = 'In Progress'; }
    else if (r < 0.55) { a.status = 'Completed'; }
  });

  if (includesCycle && activities.length >= 4) {
    const src = activities[2], tgt = activities[1];
    if (!src.dependsOn.includes(tgt.id)) src.dependsOn.push(tgt.id);
    if (!tgt.dependsOn.includes(src.id)) tgt.dependsOn.push(src.id);
  }

  return { projectId, projectName, startDate, status: 'PUBLISHED', milestones, activities };
}

function generateAllProjects() {
  return PROJECT_NAMES.map((name, i) => {
    const id = 'PRJ' + String(i + 1).padStart(3, '0');
    const startMonth = 4 + (i % 6);
    const startDate = `2026-${String(startMonth).padStart(2, '0')}-01`;
    return buildProject(1000 + i * 17, id, name, startDate, i === 4);
  });
}

/* ===================================================================
   SCHEDULE ENGINE
   =================================================================== */
function detectCycles(activities) {
  const map = Object.fromEntries(activities.map(a => [a.id, a]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = Object.fromEntries(activities.map(a => [a.id, WHITE]));
  const cycles = [];
  const onPath = [];

  function dfs(id) {
    color[id] = GRAY;
    onPath.push(id);
    const node = map[id];
    if (node) {
      for (const pid of node.dependsOn) {
        if (!map[pid]) continue;
        if (color[pid] === GRAY) {
          const start = onPath.indexOf(pid);
          if (start >= 0) cycles.push([...onPath.slice(start), pid]);
        } else if (color[pid] === WHITE) {
          dfs(pid);
        }
      }
    }
    onPath.pop();
    color[id] = BLACK;
  }

  for (const a of activities) if (color[a.id] === WHITE) dfs(a.id);
  return cycles;
}

function extractCriticalPath(activities, map, succ) {
  const criticals = activities.filter(a => a.critical);
  if (!criticals.length) return [];
  const sources = criticals.filter(a => a.dependsOn.every(p => !map[p] || !map[p].critical));
  if (!sources.length) return [];
  sources.sort((a, b) => a.earliestStart - b.earliestStart);

  const path = [];
  let cur = sources[0];
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    path.push(cur.id);
    const nexts = succ[cur.id]
      .map(sid => map[sid])
      .filter(s => s.critical && s.earliestStart === cur.earliestEnd + 1);
    if (nexts.length === 0) {
      const any = succ[cur.id].map(sid => map[sid]).filter(s => s.critical);
      cur = any.length ? any[0] : null;
    } else {
      cur = nexts[0];
    }
  }
  return path;
}

function computeSchedule(rawActivities) {
  const activities = rawActivities.map(a => ({
    ...a,
    effectiveDuration: Math.max(0, (a.duration || 0) + (a.delay || 0)),
    earliestStart: null, earliestEnd: null,
    latestStart: null, latestEnd: null,
    buffer: null, critical: false, baselineEnd: null
  }));
  const map = Object.fromEntries(activities.map(a => [a.id, a]));

  const cycles = detectCycles(activities);
  if (cycles.length > 0) {
    return { valid: false, cycles, activities, map };
  }

  const succ = Object.fromEntries(activities.map(a => [a.id, []]));
  const indeg = Object.fromEntries(activities.map(a => [a.id, 0]));
  activities.forEach(a => a.dependsOn.forEach(p => {
    if (map[p]) { succ[p].push(a.id); indeg[a.id]++; }
  }));

  const queue = activities.filter(a => indeg[a.id] === 0).map(a => a.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    succ[id].forEach(sid => { if (--indeg[sid] === 0) queue.push(sid); });
  }

  order.forEach(id => {
    const a = map[id];
    const preds = a.dependsOn.filter(p => map[p]);
    a.earliestStart = preds.length === 0 ? 1 : Math.max(...preds.map(p => map[p].earliestEnd)) + 1;
    a.earliestEnd = a.earliestStart + a.effectiveDuration - 1;
  });
  const projectFinish = activities.length ? Math.max(...activities.map(a => a.earliestEnd)) : 0;

  for (let i = order.length - 1; i >= 0; i--) {
    const a = map[order[i]];
    const successors = succ[a.id];
    a.latestEnd = successors.length === 0 ? projectFinish : Math.min(...successors.map(sid => map[sid].latestStart)) - 1;
    a.latestStart = a.latestEnd - a.effectiveDuration + 1;
    a.buffer = a.latestStart - a.earliestStart;
    a.critical = a.buffer === 0;
  }

  const baselineEnds = {};
  order.forEach(id => {
    const a = map[id];
    const preds = a.dependsOn.filter(p => map[p]);
    const baseStart = preds.length === 0 ? 1 : Math.max(...preds.map(p => baselineEnds[p])) + 1;
    const baseEnd = baseStart + a.duration - 1;
    a.baselineEnd = baseEnd;
    baselineEnds[id] = baseEnd;
  });
  const baselineFinish = activities.length ? Math.max(...activities.map(a => a.baselineEnd)) : 0;

  const criticalPath = extractCriticalPath(activities, map, succ);

  return {
    valid: true, cycles: [], activities, map, succ, order,
    projectFinish, baselineFinish,
    projectSlip: projectFinish - baselineFinish,
    criticalPath,
    totals: {
      total: activities.length,
      criticalCount: activities.filter(a => a.critical).length,
      totalBuffer: activities.reduce((s, a) => s + Math.max(a.buffer || 0, 0), 0),
      delayedCount: activities.filter(a => (a.delay || 0) > 0).length,
      totalDelayDays: activities.reduce((s, a) => s + Math.max(a.delay || 0, 0), 0)
    }
  };
}

/* ===================================================================
   HELPERS
   =================================================================== */
function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d;
}
function fmtDate(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/* ===================================================================
   SUB-COMPONENTS
   =================================================================== */

function Banner({ sched }) {
  if (!sched.valid) {
    return (
      <div className="cpa-banner cpa-banner-error" role="alert">
        <span className="cpa-banner-icon">⚠</span>
        <div>
          <div className="cpa-banner-title">This project has a circular dependency</div>
          Two or more activities depend on each other in a loop — none of them can ever start.
          You&apos;ll need to remove one of the links before the critical path can be found.
          <div className="cpa-cycle-display">
            {sched.cycles.map((c, i) => (
              <div key={i}>{c.join(' → ')}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (sched.projectSlip > 0) {
    return (
      <div className="cpa-banner cpa-banner-warn">
        <span className="cpa-banner-icon">⏱</span>
        <div>
          <div className="cpa-banner-title">
            This project is running {sched.projectSlip} day{sched.projectSlip === 1 ? '' : 's'} late
          </div>
          {sched.totals.delayedCount} activit{sched.totals.delayedCount === 1 ? 'y is' : 'ies are'} delayed by a total of {sched.totals.totalDelayDays} day{sched.totals.totalDelayDays === 1 ? '' : 's'}.
          Planned finish was day {sched.baselineFinish}; the new finish is day {sched.projectFinish}.
        </div>
      </div>
    );
  }
  return (
    <div className="cpa-banner cpa-banner-success">
      <span className="cpa-banner-icon">✓</span>
      <div>
        <div className="cpa-banner-title">This project is on schedule</div>
        No delays right now. The project will finish on day {sched.projectFinish}.
      </div>
    </div>
  );
}

function DependencyTable({ activities, onDurationChange }) {
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
            <th>Depends On</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a, idx) => (
            <tr key={a.id}>
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
                  max="60"
                  className="cpa-num-input"
                  value={a.duration}
                  onChange={(e) => onDurationChange(a.id, e.target.value)}
                  aria-label={`Duration for ${a.id}`}
                />
              </td>
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

function CriticalPathStrip({ sched }) {
  const path = sched.criticalPath;
  return (
    <div className="cpa-cp-strip">
      <div className="cpa-cp-strip-title">
        Critical Path · {sched.projectFinish} days end-to-end (with delays)
      </div>
      <div className="cpa-cp-strip-explain">
        If any of these activities is late, the project will be late.
      </div>
      <div className="cpa-cp-chips">
        {path.length === 0 ? (
          <span className="cpa-cp-empty">No critical path identified.</span>
        ) : (
          path.map((id, i) => {
            const a = sched.map[id];
            return (
              <React.Fragment key={id}>
                {i > 0 && <span className="cpa-cp-arrow">→</span>}
                <span className="cpa-cp-chip" title={a.name}>
                  <span className="cpa-cp-chip-id">{id}</span>
                  {a.name}
                  <span className="cpa-cp-chip-dur">({a.effectiveDuration}d)</span>
                </span>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

function SummaryTiles({ sched, project }) {
  return (
    <div className="cpa-summary-tiles">
      <div className={`cpa-summary-tile ${sched.projectSlip > 0 ? 'cpa-t-slip' : 'cpa-t-ok'}`}>
        <div className="cpa-summary-tile-label">Project Finishes In</div>
        <div className="cpa-summary-tile-value">
          {sched.projectFinish}<small> days</small>
        </div>
        <div className="cpa-summary-tile-sub">
          {fmtDate(addDays(project.startDate, 0))} → {fmtDate(addDays(project.startDate, sched.projectFinish - 1))}
        </div>
      </div>
      <div className="cpa-summary-tile cpa-t-critical">
        <div className="cpa-summary-tile-label">Activities on Critical Path</div>
        <div className="cpa-summary-tile-value">
          {sched.totals.criticalCount}<small> of {sched.totals.total}</small>
        </div>
        <div className="cpa-summary-tile-sub">These must finish on time</div>
      </div>
      <div className="cpa-summary-tile">
        <div className="cpa-summary-tile-label">Total Buffer (Slack)</div>
        <div className="cpa-summary-tile-value">
          {sched.totals.totalBuffer}<small> days</small>
        </div>
        <div className="cpa-summary-tile-sub">Spare time on other activities</div>
      </div>
      <div className={`cpa-summary-tile ${sched.projectSlip > 0 ? 'cpa-t-slip' : ''}`}>
        <div className="cpa-summary-tile-label">Project Delay</div>
        <div className="cpa-summary-tile-value">
          {sched.projectSlip}<small> days</small>
        </div>
        <div className="cpa-summary-tile-sub">vs planned {sched.baselineFinish} days</div>
      </div>
    </div>
  );
}

function FormulaCards({ sched }) {
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
        <div className="cpa-formula-text">The latest day this activity must be finished by, without pushing the project out.</div>
        <div className="cpa-formula-math">LF = min(LS of all successors) − 1</div>
        <div className="cpa-formula-note">
          If there are no successors → LF = Project Finish Day ({sched.projectFinish})
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

function ScheduleTable({ sched }) {
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
          {sched.activities.map((a, idx) => {
            const isCrit = a.critical;
            const hasDelay = (a.delay || 0) > 0;
            return (
              <tr key={a.id} className={isCrit ? 'cpa-row-critical' : ''}>
                <td className="cpa-col-num">{idx + 1}</td>
                <td className="cpa-col-id">{a.id}</td>
                <td>
                  <span className="cpa-chip cpa-chip-milestone">{a.milestoneId}</span> {a.milestone}
                </td>
                <td>{a.name}</td>
                <td className="cpa-col-num">{a.duration}</td>
                <td className="cpa-col-num">
                  {a.effectiveDuration}
                  {hasDelay && <span className="cpa-delay-extra"> (+{a.delay})</span>}
                </td>
                <td>
                  <div className="cpa-cell-chips">
                    {a.dependsOn.length === 0 ? (
                      <span className="cpa-chip-empty">—</span>
                    ) : (
                      a.dependsOn.map(p => (
                        <span
                          key={p}
                          className={`cpa-chip ${isCrit && sched.map[p]?.critical ? 'cpa-chip-critical' : ''}`}
                        >
                          {p}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="cpa-col-num">{a.earliestStart}</td>
                <td className="cpa-col-num">{a.earliestEnd}</td>
                <td className="cpa-col-num">{a.latestStart}</td>
                <td className="cpa-col-num">{a.latestEnd}</td>
                <td className="cpa-col-num">
                  <strong className={isCrit ? 'cpa-buffer-crit' : 'cpa-buffer-ok'}>{a.buffer}</strong>
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

function CalculationCard({ a, sched }) {
  const preds = a.dependsOn.filter(p => sched.map[p]);
  const succs = sched.succ[a.id].filter(s => sched.map[s]);
  const isCrit = a.critical;

  return (
    <div className={`cpa-calc-card ${isCrit ? 'cpa-calc-critical' : ''}`}>
      <div className="cpa-calc-card-head">
        <span className="cpa-calc-card-id">{a.id}</span>
        <span className="cpa-calc-card-name">{a.name}</span>
        <span className="cpa-calc-card-dur">
          {a.effectiveDuration} day{a.effectiveDuration === 1 ? '' : 's'}
          {(a.delay || 0) > 0 && (
            <span className="cpa-calc-delay-note">
              {' '}incl. +{a.delay} day{a.delay === 1 ? '' : 's'} delay
            </span>
          )}
        </span>
      </div>
      <div className="cpa-calc-card-body">
        {/* ES */}
        <div className="cpa-calc-row">
          <div className="cpa-calc-name">ES</div>
          <div className="cpa-calc-formula">
            {preds.length === 0 ? (
              <>
                <div className="cpa-calc-step">(no predecessors)</div>
                <div className="cpa-calc-step cpa-calc-result">= <strong>1</strong></div>
              </>
            ) : (
              <>
                <div className="cpa-calc-step">
                  = max({preds.map((p, i) => (
                    <React.Fragment key={p}>
                      {i > 0 && ', '}EF<sub>{p}</sub>
                    </React.Fragment>
                  ))}) + 1
                </div>
                <div className="cpa-calc-step">
                  = max({preds.map(p => sched.map[p].earliestEnd).join(', ')}) + 1
                </div>
                <div className="cpa-calc-step cpa-calc-result">= <strong>{a.earliestStart}</strong></div>
              </>
            )}
          </div>
        </div>
        {/* EF */}
        <div className="cpa-calc-row">
          <div className="cpa-calc-name">EF</div>
          <div className="cpa-calc-formula">
            <div className="cpa-calc-step">= ES + Duration − 1</div>
            <div className="cpa-calc-step">= {a.earliestStart} + {a.effectiveDuration} − 1</div>
            <div className="cpa-calc-step cpa-calc-result">= <strong>{a.earliestEnd}</strong></div>
          </div>
        </div>
        {/* LF */}
        <div className="cpa-calc-row">
          <div className="cpa-calc-name">LF</div>
          <div className="cpa-calc-formula">
            {succs.length === 0 ? (
              <>
                <div className="cpa-calc-step">(no successors → Project Finish)</div>
                <div className="cpa-calc-step cpa-calc-result">= <strong>{a.latestEnd}</strong></div>
              </>
            ) : (
              <>
                <div className="cpa-calc-step">
                  = min({succs.map((s, i) => (
                    <React.Fragment key={s}>
                      {i > 0 && ', '}LS<sub>{s}</sub>
                    </React.Fragment>
                  ))}) − 1
                </div>
                <div className="cpa-calc-step">
                  = min({succs.map(s => sched.map[s].latestStart).join(', ')}) − 1
                </div>
                <div className="cpa-calc-step cpa-calc-result">= <strong>{a.latestEnd}</strong></div>
              </>
            )}
          </div>
        </div>
        {/* LS */}
        <div className="cpa-calc-row">
          <div className="cpa-calc-name">LS</div>
          <div className="cpa-calc-formula">
            <div className="cpa-calc-step">= LF − Duration + 1</div>
            <div className="cpa-calc-step">= {a.latestEnd} − {a.effectiveDuration} + 1</div>
            <div className="cpa-calc-step cpa-calc-result">= <strong>{a.latestStart}</strong></div>
          </div>
        </div>
        {/* Slack */}
        <div className="cpa-calc-row cpa-calc-row-slack">
          <div className="cpa-calc-name">Slack</div>
          <div className="cpa-calc-formula">
            <div className="cpa-calc-step">= LS − ES</div>
            <div className="cpa-calc-step">= {a.latestStart} − {a.earliestStart}</div>
            <div className="cpa-calc-step cpa-calc-result">= <strong>{a.buffer}</strong></div>
          </div>
        </div>
      </div>
      <div className={`cpa-calc-verdict ${isCrit ? 'cpa-verdict-critical' : 'cpa-verdict-ok'}`}>
        {isCrit
          ? '● Slack = 0 → ON CRITICAL PATH'
          : `✓ Slack > 0 → not on critical path (can slip up to ${a.buffer} day${a.buffer === 1 ? '' : 's'})`}
      </div>
    </div>
  );
}

/* ===================================================================
   FLOW DIAGRAM (SVG)
   =================================================================== */
function FlowDiagram({ sched }) {
  const acts = sched.activities;
  if (!acts.length) return <div className="cpa-empty-state">No activities to draw.</div>;

  const level = {};
  sched.order.forEach(id => {
    const a = sched.map[id];
    const preds = a.dependsOn.filter(p => sched.map[p]);
    level[id] = preds.length === 0 ? 0 : Math.max(...preds.map(p => level[p] + 1));
  });
  const byLevel = {};
  acts.forEach(a => {
    const l = level[a.id] ?? 0;
    (byLevel[l] = byLevel[l] || []).push(a);
  });
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);

  const nodeW = 180, nodeH = 72;
  const hGap = 56, vGap = 22;
  const padX = 60, padY = 24;

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
      pos[a.id] = { x: colXs[i + 1], y: yy };
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

  const edges = [];
  acts.filter(a => a.dependsOn.filter(p => sched.map[p]).length === 0).forEach(a => {
    edges.push(renderEdge(`start-${a.id}`, startPos, pos[a.id], a.critical));
  });
  acts.forEach(a => {
    a.dependsOn.forEach(pid => {
      const p = sched.map[pid];
      if (!p) return;
      edges.push(renderEdge(`${pid}-${a.id}`, pos[pid], pos[a.id], a.critical && p.critical));
    });
  });
  acts.filter(a => sched.succ[a.id].length === 0).forEach(a => {
    edges.push(renderEdge(`${a.id}-end`, pos[a.id], endPos, a.critical));
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
      {edges}
      {/* Start terminal */}
      <g transform={`translate(${startPos.x},${startPos.y})`}>
        <rect className="cpa-flow-node-bg cpa-flow-node-terminal" width={nodeW} height={nodeH} rx="6" ry="6" />
        <text className="cpa-flow-text cpa-flow-text-terminal" x={nodeW / 2} y={nodeH / 2 + 5} textAnchor="middle">
          ▶ Start
        </text>
      </g>
      {/* Activity nodes */}
      {acts.map(a => {
        const { x: nx, y: ny } = pos[a.id];
        const bgCls = a.critical ? 'cpa-flow-node-bg cpa-flow-node-critical' : 'cpa-flow-node-bg';
        const idCls = a.critical ? 'cpa-flow-text cpa-flow-text-id cpa-flow-text-id-critical' : 'cpa-flow-text cpa-flow-text-id';
        const daysCls = a.critical ? 'cpa-flow-text cpa-flow-text-days cpa-flow-text-days-critical' : 'cpa-flow-text cpa-flow-text-days';
        const stripeCls = a.critical ? 'cpa-flow-stripe cpa-flow-stripe-critical' : 'cpa-flow-stripe';
        return (
          <g key={a.id} transform={`translate(${nx},${ny})`}>
            <rect className={bgCls} width={nodeW} height={nodeH} rx="6" ry="6" />
            <rect className={stripeCls} width={nodeW} height="3" rx="2" ry="2" />
            <text className={idCls} x="10" y="18">{a.id}</text>
            <text className={daysCls} x={nodeW - 10} y="18" textAnchor="end">
              {a.effectiveDuration} day{a.effectiveDuration === 1 ? '' : 's'}
            </text>
            <text className="cpa-flow-text cpa-flow-text-name" x={nodeW / 2} y="38" textAnchor="middle">
              {truncate(a.name, 24)}
            </text>
            <text className="cpa-flow-text cpa-flow-text-range" x={nodeW / 2} y="58" textAnchor="middle">
              Day {a.earliestStart} → Day {a.earliestEnd}
            </text>
          </g>
        );
      })}
      {/* End terminal */}
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
function ResultsSection({ project, sched }) {
  if (!sched.valid) {
    return (
      <div className="cpa-card" id="cpa-resultsSection">
        <div className="cpa-banner cpa-banner-error">
          <span className="cpa-banner-icon">⚠</span>
          <div>
            <div className="cpa-banner-title">Can&apos;t find the critical path yet</div>
            The project still has a circular dependency. Fix that first, then try again.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cpa-card" id="cpa-resultsSection">
      <h3 className="cpa-section-title">
        Step 2 · Critical Path Results
        <span className="cpa-badge-count">Total {sched.projectFinish} days</span>
      </h3>
      <p className="cpa-section-hint">
        Below is the project schedule once dependencies and delays are taken into account.
        The activities highlighted in red are on the <strong>critical path</strong> — any slip there pushes the whole project out.
      </p>

      <CriticalPathStrip sched={sched} />
      <SummaryTiles sched={sched} project={project} />

      <h4 className="cpa-section-title cpa-subhead">How the Critical Path Is Calculated</h4>
      <p className="cpa-section-hint">
        For every activity we compute four day-numbers (Early Start, Early Finish, Late Start, Late Finish) and one slack value, using these formulas:
      </p>
      <FormulaCards sched={sched} />

      <h4 className="cpa-section-title cpa-subhead">Activity Schedule</h4>
      <p className="cpa-section-hint">
        Each row shows one activity with its planned duration, its duration including delays, and the four day-numbers plus slack from the formulas above.
      </p>
      <ScheduleTable sched={sched} />

      <h4 className="cpa-section-title cpa-subhead">Calculation Steps — Activity by Activity</h4>
      <p className="cpa-section-hint">
        For each activity below, the formulas above are applied with the actual numbers plugged in. Red boxes are on the critical path (slack = 0).
      </p>
      <div className="cpa-calc-grid">
        {sched.activities.map(a => (
          <CalculationCard key={a.id} a={a} sched={sched} />
        ))}
      </div>

      <h4 className="cpa-section-title cpa-subhead">Flow Diagram</h4>
      <p className="cpa-section-hint">
        Each box is one activity. Arrows show what depends on what. Boxes in red are on the critical path.
      </p>
      <div className="cpa-flow-wrap">
        <FlowDiagram sched={sched} />
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
   MAIN EXPORTED COMPONENT
   =================================================================== */
export default function CriticalPathAnalysis({ projectId = 'PRJ001' }) {
  const allProjects = useMemo(() => generateAllProjects(), []);
  const project = useMemo(
    () => allProjects.find(p => p.projectId === projectId) || allProjects[0],
    [allProjects, projectId]
  );

  const [activities, setActivities] = useState(() =>
    project.activities.map(a => ({ ...a, dependsOn: [...a.dependsOn] }))
  );
  const [showResults, setShowResults] = useState(false);

  // Reset state when switching projects via prop
  useEffect(() => {
    setActivities(project.activities.map(a => ({ ...a, dependsOn: [...a.dependsOn] })));
    setShowResults(false);
  }, [project]);

  const sched = useMemo(() => computeSchedule(activities), [activities]);

  const handleDurationChange = (id, raw) => {
    const v = Math.max(1, Math.min(60, parseInt(raw, 10) || 1));
    setActivities(prev => prev.map(a => (a.id === id ? { ...a, duration: v } : a)));
    setShowResults(false); // editing invalidates previous results
  };

  const handleCalculate = () => {
    setShowResults(true);
    setTimeout(() => {
      const el = document.getElementById('cpa-resultsSection');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  return (
    <div className="cpa-root">
      <div className="cpa-page-header">
        <div className="cpa-pm-title">
          {project.projectId} — {project.projectName}
        </div>
        <div className="cpa-pm-subtitle">
          {project.milestones.length} milestones · {activities.length} activities · starts {fmtDate(addDays(project.startDate, 0))}
        </div>
      </div>

      <Banner sched={sched} />

      <div className="cpa-card">
        <h3 className="cpa-section-title">
          Step 1 · Activities &amp; What They Depend On
          <span className="cpa-badge-count">{activities.length} activities</span>
        </h3>
        <p className="cpa-section-hint">
          Each activity needs a certain number of days and may have to wait for other activities to finish first.
          Edit <em>Duration</em> to see how it changes the project&apos;s critical path.
        </p>

        <DependencyTable activities={activities} onDurationChange={handleDurationChange} />

        <div className="cpa-button-row">
          <button className="cpa-btn" onClick={handleCalculate} disabled={!sched.valid}>
            {sched.valid ? '▶ Find Critical Path' : '⚠ Cannot Run (Fix Loop First)'}
          </button>
        </div>
      </div>

      {showResults && <ResultsSection project={project} sched={sched} />}
    </div>
  );
}