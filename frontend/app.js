/**
 * Mainframe Bank Reconciliation System — Frontend App Logic
 * Handles: Tab navigation, WebSocket, API calls, charts, job management
 */

const API = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ? `${window.location.origin}/api`
  : 'http://localhost:3000/api';
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_HOST = window.location.host || 'localhost:3000';
const WS_URL = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ? `${WS_PROTOCOL}//${WS_HOST}/ws`
  : 'ws://localhost:3000/ws';

// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════
let ws = null;
let wsReconnectTimer = null;
let currentTrackingId = null;
let stepCount = 0;
let stepsCompleted = 0;
let donutChart = null;

// ═══════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initTimeBadge();
  initTabs();
  initWebSocket();
  initButtons();
  initTemplateSelect();
  loadDashboardStats();
});

// ═══════════════════════════════════════════════════════════════════
// Time Badge
// ═══════════════════════════════════════════════════════════════════
function initTimeBadge() {
  const el = document.getElementById('time-badge');
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', { hour12: false }) + ' IST';
  }
  tick();
  setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════════════════
// Tab Navigation
// ═══════════════════════════════════════════════════════════════════
const TAB_META = {
  dashboard: { title: 'Dashboard',       breadcrumb: 'Overview & Analytics' },
  jcl:       { title: 'Run Jobs',        breadcrumb: 'JCL Editor & Job Submission' },
  results:   { title: 'Recon Results',   breadcrumb: 'Reconciliation Result Records' },
  audit:     { title: 'Audit Log',       breadcrumb: 'Job Execution History' },
  catalog:   { title: 'Dataset Catalog', breadcrumb: 'Mainframe Dataset Browser' },
  spool:     { title: 'JES Spool',       breadcrumb: 'JES Spool Output Viewer' }
};

function initTabs() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const tab = item.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  // Update content
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
  // Update page title
  const meta = TAB_META[tab] || {};
  document.getElementById('page-title').textContent = meta.title || tab;
  document.getElementById('page-breadcrumb').textContent = meta.breadcrumb || '';

  // Lazy load
  if (tab === 'results') loadResults();
  if (tab === 'audit')   loadAuditLog();
  if (tab === 'catalog') loadCatalog();
  if (tab === 'dashboard') loadDashboardStats();
  if (tab === 'spool')   loadSpoolJobs();
}

// ═══════════════════════════════════════════════════════════════════
// WebSocket
// ═══════════════════════════════════════════════════════════════════
function initWebSocket() {
  if (ws) try { ws.close(); } catch(e) {}
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setWsStatus('connected', 'Live');
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    feedLog('WebSocket connected to server.', 'info');
  };

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    handleWsMessage(msg);
  };

  ws.onclose = () => {
    setWsStatus('error', 'Disconnected');
    feedLog('WebSocket disconnected. Reconnecting…', 'warn');
    wsReconnectTimer = setTimeout(initWebSocket, 4000);
  };

  ws.onerror = () => {
    setWsStatus('error', 'Error');
  };
}

function setWsStatus(cls, text) {
  const dot = document.getElementById('ws-dot');
  const status = document.getElementById('ws-status');
  dot.className = `ws-dot ${cls}`;
  status.textContent = text;
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'JOB_QUEUED':
      currentTrackingId = msg.trackingId;
      feedLog(`Job queued: ${msg.trackingId} ${msg.jobName || ''}`, 'info');
      showJobProgress(true);
      break;
    case 'STEP_UPDATE':
      if (!currentTrackingId || msg.trackingId === currentTrackingId) {
        currentTrackingId = msg.trackingId;
        updateStepCard(msg.stepName, msg.status, msg.rc);
        feedLog(`Step ${msg.stepName}: ${msg.status} (RC=${msg.rc !== null ? msg.rc : '-'})`, msg.status === 'ABENDED' ? 'error' : 'success');
      }
      break;
    case 'JOB_COMPLETED':
      feedLog(`Job ${msg.trackingId} completed: Status=${msg.result.status}, MAXCC=${msg.result.maxRC}`, msg.result.status === 'ABENDED' ? 'error' : 'success');
      onJobCompleted(msg.result);
      break;
    case 'JOB_ERROR':
      feedLog(`Job error: ${msg.error}`, 'error');
      toast('error', 'Job error: ' + msg.error);
      break;
    case 'TEST_OUTPUT':
      feedLog(msg.line, msg.line.includes('FAIL') ? 'error' : (msg.line.includes('PASS') ? 'success' : 'info'));
      appendJobOutput(msg.line);
      break;
    case 'TEST_COMPLETED':
      feedLog(`Test suite done. Exit code: ${msg.exitCode}`, msg.exitCode === 0 ? 'success' : 'error');
      toast(msg.exitCode === 0 ? 'success' : 'error', `Test suite completed (exit ${msg.exitCode})`);
      break;
    default:
      if (msg.message) feedLog(msg.message, 'info');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Buttons
// ═══════════════════════════════════════════════════════════════════
function initButtons() {
  // Topbar BANKRECN button
  document.getElementById('run-bankrecn-btn').onclick = () => showModal();

  // Modal
  document.getElementById('modal-close-btn').onclick = hideModal;
  document.getElementById('modal-cancel-btn').onclick = hideModal;
  document.getElementById('modal-run-btn').onclick = runBankrecnFromModal;
  document.getElementById('bankrecn-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal();
  });

  // Quick actions
  document.getElementById('qbtn-bankrecn').onclick = () => showModal();
  document.getElementById('qbtn-template').onclick = () => {
    document.getElementById('template-select').focus();
    toast('info', 'Select a template from the dropdown in the JCL editor.');
  };
  document.getElementById('qbtn-upload').onclick = () => {
    document.getElementById('jcl-upload-input').click();
  };
  document.getElementById('qbtn-test').onclick = runTestSuite;

  // JCL submit
  document.getElementById('submit-jcl-btn').onclick = submitInlineJCL;

  // JCL file upload
  document.getElementById('jcl-upload-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      document.getElementById('jcl-editor').value = evt.target.result;
      toast('info', `Loaded: ${file.name}`);
    };
    reader.readAsText(file);
  });

  // Clear output
  document.getElementById('clear-output-btn').onclick = () => {
    document.getElementById('job-output-pre').textContent = '';
  };

  // Clear feed
  document.getElementById('clear-feed-btn').onclick = () => {
    document.getElementById('live-feed').innerHTML = '';
  };

  // Results filters
  let accountFilterTimer = null;
  const filterStatusEl = document.getElementById('filter-status');
  const filterAccountEl = document.getElementById('filter-account');
  const filterDateEl = document.getElementById('filter-date');

  document.getElementById('apply-filters-btn').onclick = () => loadResults();
  filterStatusEl.addEventListener('change', () => loadResults());
  filterDateEl.addEventListener('change', () => loadResults());
  filterDateEl.addEventListener('input', () => loadResults());
  filterAccountEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (accountFilterTimer) clearTimeout(accountFilterTimer);
      loadResults();
    }
  });
  filterAccountEl.addEventListener('input', () => {
    if (accountFilterTimer) clearTimeout(accountFilterTimer);
    accountFilterTimer = setTimeout(() => loadResults(), 200);
  });
  document.getElementById('clear-filters-btn').onclick = () => {
    if (accountFilterTimer) clearTimeout(accountFilterTimer);
    filterStatusEl.value = '';
    filterAccountEl.value = '';
    filterDateEl.value = '';
    loadResults();
  };
  document.getElementById('refresh-results-btn').onclick = () => loadResults();

  // Audit refresh
  document.getElementById('refresh-audit-btn').onclick = loadAuditLog;

  // Catalog
  document.getElementById('browse-catalog-btn').onclick = loadCatalog;
  document.getElementById('refresh-catalog-btn').onclick = loadCatalog;
  document.getElementById('close-reader-btn').onclick = () => {
    document.getElementById('dataset-reader').style.display = 'none';
  };

  // Spool
  document.getElementById('load-spool-btn').onclick = () => loadSpool();
  const spoolSel = document.getElementById('spool-select');
  if (spoolSel) {
    spoolSel.addEventListener('change', () => {
      if (spoolSel.value) {
        document.getElementById('spool-jobid').value = spoolSel.value;
        loadSpool(spoolSel.value);
      }
    });
  }

  // Run with Parameters button
  const runParamsBtn = document.getElementById('run-params-btn');
  if (runParamsBtn) {
    runParamsBtn.onclick = async () => {
      const busdate = document.getElementById('busdate-input').value.trim() || new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const env = document.getElementById('env-select').value || 'PROD';
      await runBankrecn(busdate, env);
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Template select
// ═══════════════════════════════════════════════════════════════════
async function initTemplateSelect() {
  try {
    const resp = await fetch(`${API}/jcl/templates`);
    const data = await resp.json();
    const sel = document.getElementById('template-select');
    (data.templates || []).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      try {
        const r = await fetch(`${API}/jcl/templates/${encodeURIComponent(sel.value)}`);
        const d = await r.json();
        document.getElementById('jcl-editor').value = d.content || '';
        toast('info', `Loaded template: ${sel.value}`);
      } catch (e) {
        toast('error', 'Failed to load template');
      }
    });
  } catch (e) {
    console.warn('Could not load templates:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Modal
// ═══════════════════════════════════════════════════════════════════
function showModal() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  document.getElementById('modal-busdate').value = today;
  document.getElementById('bankrecn-modal').style.display = 'flex';
}

function hideModal() {
  document.getElementById('bankrecn-modal').style.display = 'none';
}

async function runBankrecnFromModal() {
  const busdate = document.getElementById('modal-busdate').value || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const env = document.getElementById('modal-env').value || 'PROD';
  hideModal();
  switchTab('jcl');
  await runBankrecn(busdate, env);
}

// ═══════════════════════════════════════════════════════════════════
// Job Submission
// ═══════════════════════════════════════════════════════════════════
async function runBankrecn(busdate, env) {
  try {
    resetJobProgress();
    showJobProgress(true);
    const resp = await fetch(`${API}/jobs/run-bankrecn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ busdate, env })
    });
    const data = await resp.json();
    if (data.trackingId) {
      currentTrackingId = data.trackingId;
      toast('info', `BANKRECN submitted — ${data.trackingId}`);
    } else {
      toast('error', data.error || 'Submission failed');
    }
  } catch (e) {
    toast('error', 'Server connection failed: ' + e.message);
    feedLog('Cannot reach server at ' + API, 'error');
  }
}

async function submitInlineJCL() {
  const jcl = document.getElementById('jcl-editor').value.trim();
  if (!jcl) { toast('warn', 'JCL editor is empty.'); return; }

  try {
    resetJobProgress();
    showJobProgress(true);
    const resp = await fetch(`${API}/jobs/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jcl })
    });
    const data = await resp.json();
    if (data.trackingId) {
      currentTrackingId = data.trackingId;
      toast('info', `Job submitted — ${data.trackingId}`);
    } else {
      toast('error', data.error || 'Submission failed');
    }
  } catch (e) {
    toast('error', 'Server connection failed: ' + e.message);
  }
}

async function runTestSuite() {
  switchTab('jcl');
  document.getElementById('job-output').style.display = 'block';
  document.getElementById('job-output-pre').textContent = '';
  appendJobOutput('>>> Starting Automated Test Suite…\n');
  try {
    const resp = await fetch(`${API}/test/run`, { method: 'POST' });
    const data = await resp.json();
    toast('info', 'Test suite started — output streaming…');
    currentTrackingId = data.trackingId;
  } catch (e) {
    toast('error', 'Failed to start test suite: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Job Progress UI
// ═══════════════════════════════════════════════════════════════════
function resetJobProgress() {
  stepCount = 0;
  stepsCompleted = 0;
  document.getElementById('step-cards').innerHTML = '';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-label').textContent = 'Initializing…';
  document.getElementById('job-output-pre').textContent = '';
}

function showJobProgress(visible) {
  document.getElementById('job-progress').style.display = visible ? 'block' : 'none';
  document.getElementById('job-output').style.display = visible ? 'block' : 'none';
}

function updateStepCard(stepName, status, rc) {
  stepCount = Math.max(stepCount, 1);
  let chip = document.getElementById(`chip-${stepName}`);
  if (!chip) {
    stepCount++;
    chip = document.createElement('div');
    chip.className = 'step-chip';
    chip.id = `chip-${stepName}`;
    chip.textContent = stepName;
    document.getElementById('step-cards').appendChild(chip);
  }

  chip.className = 'step-chip ' + (status === 'COMPLETED' || status === 'SUCCESS' ? 'done' : status === 'ABENDED' ? 'abended' : status === 'RUNNING' ? 'running' : '');
  chip.textContent = `${stepName} [RC=${rc !== null ? rc : '?'}]`;

  if (status === 'COMPLETED' || status === 'ABENDED' || status === 'BYPASSED') {
    stepsCompleted++;
    const pct = Math.min(100, Math.round((stepsCompleted / Math.max(stepCount, 8)) * 100));
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-label').textContent = `${stepsCompleted} step(s) done`;
  }
}

function onJobCompleted(result) {
  document.getElementById('progress-fill').style.width = '100%';
  document.getElementById('progress-label').textContent = `${result.status} — MAXCC=${result.maxRC}`;

  // Output the step summary
  const lines = [];
  lines.push(`\n${'═'.repeat(64)}`);
  lines.push(`JOB: ${result.jobName}  ID: ${result.jobId}`);
  lines.push(`STATUS: ${result.status}   MAXCC: ${result.maxRC}`);
  lines.push(`${'─'.repeat(64)}`);
  (result.steps || []).forEach(s => {
    const rc = s.returnCode !== null ? String(s.returnCode).padStart(4, '0') : '----';
    lines.push(`  ${s.stepName.padEnd(10)} PGM=${String(s.pgm || '').padEnd(10)} RC=${rc}  ${s.status}`);
  });
  lines.push(`${'═'.repeat(64)}\n`);
  appendJobOutput(lines.join('\n'));

  toast(result.status === 'ABENDED' ? 'error' : 'success',
    `${result.jobName}: ${result.status}, MAXCC=${result.maxRC}`);

  // Update step timeline on dashboard
  renderStepTimeline(result.steps || []);

  // Refresh stats after a job completes
  setTimeout(() => loadDashboardStats(), 1500);

  currentTrackingId = null;
}

function appendJobOutput(text) {
  const pre = document.getElementById('job-output-pre');
  pre.textContent += text + '\n';
  pre.scrollTop = pre.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════════
// Dashboard Stats
// ═══════════════════════════════════════════════════════════════════
async function loadDashboardStats() {
  try {
    const resp = await fetch(`${API}/stats`);
    const d = await resp.json();

    setValue('sv-total',   d.total ?? 0);
    setValue('sv-matched', d.matched ?? 0);
    setValue('sv-mismatch', d.amount_mismatch ?? 0);
    setValue('sv-missing', (d.missing_bank ?? 0) + (d.missing_core ?? 0));
    setValue('sv-dup',     d.duplicate ?? 0);
    setValue('sv-jobs',    d.jobs_today ?? 0);

    renderDonutChart(d);
  } catch (e) {
    ['sv-total','sv-matched','sv-mismatch','sv-missing','sv-dup','sv-jobs'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
  }
}

function setValue(id, val) {
  const el = document.getElementById(id);
  const target = Number(val);
  const current = parseInt(el.textContent) || 0;
  animateCount(el, current, target, 600);
}

function animateCount(el, from, to, duration) {
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(from + (to - from) * easeOut(t)).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// ─── Donut Chart ──────────────────────────────────────────────────
function renderDonutChart(d) {
  const canvas = document.getElementById('donut-chart');
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const r = 70, inner = 48;

  const segments = [
    { label: 'Matched',       value: d.matched ?? 0,        color: '#22c55e' },
    { label: 'Amt Mismatch',  value: d.amount_mismatch ?? 0, color: '#f59e0b' },
    { label: 'Missing Bank',  value: d.missing_bank ?? 0,   color: '#ef4444' },
    { label: 'Missing Core',  value: d.missing_core ?? 0,   color: '#f97316' },
    { label: 'Duplicate',     value: d.duplicate ?? 0,      color: '#a855f7' },
  ].filter(s => s.value > 0);

  const total = segments.reduce((acc, s) => acc + s.value, 0) || 1;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (total === 0) {
    ctx.fillStyle = '#1a1d2e';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f1118';
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  let startAngle = -Math.PI / 2;
  segments.forEach(s => {
    const sweep = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    startAngle += sweep;
  });

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = '#14161f';
  ctx.fill();

  // Center text
  ctx.fillStyle = '#f0f1ff';
  ctx.font = 'bold 18px Inter';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total.toLocaleString(), cx, cy - 8);
  ctx.font = '10px Inter';
  ctx.fillStyle = '#4b5675';
  ctx.fillText('Total', cx, cy + 10);

  // Legend
  const legend = document.getElementById('donut-legend');
  legend.innerHTML = segments.map(s =>
    `<div class="legend-item">
       <div class="legend-dot" style="background:${s.color}"></div>
       <span>${s.label}: <strong>${s.value}</strong></span>
     </div>`
  ).join('');
}

// ─── Step Timeline (last job) ─────────────────────────────────────
function renderStepTimeline(steps) {
  const container = document.getElementById('step-timeline');
  if (!steps.length) {
    container.innerHTML = '<div class="empty-state">No steps recorded.</div>';
    return;
  }
  container.innerHTML = steps.map(s => {
    const rcClass = s.returnCode === 0 ? 'SUCCESS' : s.returnCode >= 8 ? 'ABENDED' : 'WARNING';
    return `<div class="step-entry">
      <span class="step-name">${s.stepName}</span>
      <span class="step-pgm">${s.pgm || ''}</span>
      <span class="step-badge ${s.status.toUpperCase()}">${s.status}</span>
      <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;margin-left:auto">RC=${s.returnCode !== null ? s.returnCode : '—'}</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
let resultsRequestSeq = 0;

async function loadResults() {
  const reqSeq  = ++resultsRequestSeq;
  const status  = document.getElementById('filter-status').value.trim();
  const account = document.getElementById('filter-account').value.trim();
  const date    = document.getElementById('filter-date').value.trim();
  const hasFilters = Boolean(status || account || date);

  const params = new URLSearchParams();
  if (status)  params.set('status', status);
  if (account) params.set('account_no', account);
  if (date)    params.set('date', date.replace(/-/g, ''));

  const query = params.toString();
  const url = query ? `${API}/results?${query}` : `${API}/results`;

  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (reqSeq !== resultsRequestSeq) return; // Ignore stale out-of-order response
    renderResultsTable(data.results || [], hasFilters);
    const active = [];
    if (status) active.push(`Status=${status}`);
    if (account) active.push(`Search="${account}"`);
    if (date) active.push(`Date=${date}`);
    const suffix = active.length ? ` (Filtered: ${active.join(', ')})` : '';
    document.getElementById('results-footer').textContent = `Showing ${data.count ?? 0} record(s)${suffix}`;
  } catch (e) {
    if (reqSeq !== resultsRequestSeq) return;
    renderResultsTable([], hasFilters);
    document.getElementById('results-footer').textContent = 'Failed to load results: ' + e.message;
  }
}

function formatTxnDate(raw) {
  const s = String(raw || '').trim();
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

function renderResultsTable(rows, hasFilters = false) {
  const tbody = document.getElementById('results-tbody');
  if (!rows.length) {
    const msg = hasFilters
      ? 'No matching records found for the current filters.'
      : 'No results found. Run a BANKRECN job first.';
    tbody.innerHTML = `<tr><td colspan="11" class="empty-row">${msg}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const statusClass = (r.status || '').replace(/\s+/g, '-').toUpperCase();
    const diff = (r.diff_sign === '-' ? '-' : '+') + '$' + (r.diff_amount || 0).toFixed(2);
    const dateTitle = r.created_at ? `TXN Date: ${formatTxnDate(r.txn_date)} | Run: ${r.created_at}` : '';
    return `<tr>
      <td><span class="status-badge ${statusClass}">${r.status}</span></td>
      <td>${r.account_no || ''}</td>
      <td>${r.txn_ref || ''}</td>
      <td title="${dateTitle}">${formatTxnDate(r.txn_date)}</td>
      <td>$${(r.core_amount || 0).toFixed(2)}</td>
      <td>$${(r.bank_amount || 0).toFixed(2)}</td>
      <td style="color:${r.diff_sign === '-' ? '#ef4444' : '#22c55e'}">${diff}</td>
      <td>${r.currency || ''}</td>
      <td>${r.channel || ''}</td>
      <td>${r.reason_code || ''}</td>
      <td>${r.account_name || ''}</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// Audit Log
// ═══════════════════════════════════════════════════════════════════
async function loadAuditLog() {
  try {
    const resp = await fetch(`${API}/audit`);
    const data = await resp.json();
    const tbody = document.getElementById('audit-tbody');
    if (!data.logs || !data.logs.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No audit entries yet.</td></tr>';
      return;
    }
    tbody.innerHTML = data.logs.map((log, i) => {
      const sc = (log.status || '').toUpperCase();
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-family:var(--font-mono)"><button class="btn-link" onclick="viewSpool('${log.job_id}')" style="cursor:pointer;text-decoration:underline;color:var(--accent-hover);font-family:inherit;font-size:inherit;" title="View JES Spool">${log.job_id || ''}</button></td>
        <td style="font-weight:600">${log.job_name || ''}</td>
        <td><span class="status-badge ${sc}">${log.status}</span></td>
        <td style="text-align:center">${log.max_rc ?? ''}</td>
        <td>${log.total_rows ?? 0}</td>
        <td>${log.system || ''}</td>
        <td style="font-family:var(--font-mono);font-size:10px">${log.jcl_used || ''}</td>
        <td style="color:var(--text-muted);font-size:11px">${log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : ''}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    document.getElementById('audit-tbody').innerHTML = `<tr><td colspan="9" class="empty-row">Error: ${e.message}</td></tr>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Dataset Catalog
// ═══════════════════════════════════════════════════════════════════
async function loadCatalog() {
  const prefix = document.getElementById('catalog-prefix').value.trim();
  const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';

  try {
    const resp = await fetch(`${API}/catalog${params}`);
    const data = await resp.json();

    // Datasets
    const tbody = document.getElementById('catalog-tbody');
    if (!data.datasets || !data.datasets.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No datasets found.</td></tr>';
    } else {
      tbody.innerHTML = data.datasets.map(d => `<tr>
        <td style="font-family:var(--font-mono);font-size:11px">${d.name}</td>
        <td>${d.type || 'PS'}</td>
        <td>${d.recfm || ''}</td>
        <td>${d.lrecl || ''}</td>
        <td><span class="status-badge ${d.cataloged ? 'MATCHED' : ''}">${d.cataloged ? 'CATLG' : 'UNCATLG'}</span></td>
        <td><button class="btn-link" onclick="readDataset('${d.name}')">Read</button></td>
      </tr>`).join('');
    }

    // GDG Bases
    const gdgTbody = document.getElementById('gdg-tbody');
    if (!data.gdgBases || !data.gdgBases.length) {
      gdgTbody.innerHTML = '<tr><td colspan="5" class="empty-row">No GDG bases.</td></tr>';
    } else {
      gdgTbody.innerHTML = data.gdgBases.map(g => `<tr>
        <td style="font-family:var(--font-mono)">${g.name}</td>
        <td>${g.limit ?? ''}</td>
        <td>${(g.generations || []).length}</td>
        <td>${g.scratch ? '✓' : '✗'}</td>
        <td><button class="btn-link" onclick="readDataset('${g.name}(0)')">Read (0)</button></td>
      </tr>`).join('');
    }
  } catch (e) {
    document.getElementById('catalog-tbody').innerHTML = `<tr><td colspan="6" class="empty-row">Error: ${e.message}</td></tr>`;
  }
}

async function readDataset(dsname) {
  const reader = document.getElementById('dataset-reader');
  const pre = document.getElementById('dataset-reader-pre');
  const title = document.getElementById('dataset-reader-title');
  reader.style.display = 'block';
  title.textContent = `Dataset: ${dsname}`;
  pre.textContent = 'Loading…';

  try {
    const resp = await fetch(`${API}/catalog/read/${encodeURIComponent(dsname)}?limit=200`);
    const data = await resp.json();
    if (data.error) {
      pre.textContent = `ERROR: ${data.error}`;
    } else {
      const recs = data.records || [];
      pre.textContent = recs.length > 0
        ? recs.map((r, i) => `${String(i + 1).padStart(5, ' ')} | ${r}`).join('\n')
        : `(Empty dataset — 0 records)`;
    }
    reader.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    pre.textContent = `Error: ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// JES Spool
// ═══════════════════════════════════════════════════════════════════
async function loadSpool(targetId) {
  const jobId = (targetId || document.getElementById('spool-jobid').value || '').trim();
  if (!jobId) { toast('warn', 'Enter a Job ID'); return; }
  document.getElementById('spool-jobid').value = jobId;

  const out = document.getElementById('spool-output');
  out.textContent = 'Loading spool…';
  try {
    const resp = await fetch(`${API}/spool/${encodeURIComponent(jobId)}`);
    const data = await resp.json();
    if (data.error) {
      out.textContent = `ERROR: ${data.error}`;
    } else {
      out.textContent = (data.lines || []).join('\n');
    }
  } catch (e) {
    out.textContent = `Error: ${e.message}`;
  }
}

async function viewSpool(jobId) {
  switchTab('spool');
  document.getElementById('spool-jobid').value = jobId;
  await loadSpool(jobId);
}

async function loadSpoolJobs() {
  const sel = document.getElementById('spool-select');
  if (!sel) return;
  try {
    const resp = await fetch(`${API}/spool`);
    const data = await resp.json();
    sel.innerHTML = '<option value="">— Select Job to View Spool —</option>';
    (data.jobs || []).forEach(j => {
      const opt = document.createElement('option');
      opt.value = j.jobId;
      opt.textContent = `${j.jobId} — ${j.jobName || 'JOB'} (RC=${j.maxRC ?? '-'}, ${j.status || ''})`;
      sel.appendChild(opt);
    });
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════
// Live Feed
// ═══════════════════════════════════════════════════════════════════
function feedLog(msg, type = 'info') {
  const feed = document.getElementById('live-feed');
  const now = new Date().toTimeString().slice(0, 8);
  const div = document.createElement('div');
  div.className = `feed-line feed-line--${type}`;
  div.textContent = `[${now}] ${msg}`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;

  // Trim old entries
  while (feed.children.length > 200) {
    feed.removeChild(feed.firstChild);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Toast Notifications
// ═══════════════════════════════════════════════════════════════════
function toast(type, message) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const icons = { success: '✓', error: '✕', info: 'ℹ', warn: '⚠' };
  el.innerHTML = `<span style="font-size:16px">${icons[type] || 'ℹ'}</span><span>${message}</span>`;

  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ═══════════════════════════════════════════════════════════════════
// Expose for inline onclick handlers
// ═══════════════════════════════════════════════════════════════════
window.readDataset = readDataset;
window.viewSpool = viewSpool;
window.loadSpool = loadSpool;
