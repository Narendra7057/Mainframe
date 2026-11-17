/**
 * Mainframe Bank Reconciliation System - Backend API Server
 * Express REST API + WebSocket (ws) for real-time job execution updates
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');

const { ResultsDatabase } = require('./db');

// Lazy-load mainframe runner modules (they live one directory up)
const MAINFRAME_DIR = path.join(__dirname, '..', 'mainframe');
const { JCLRunner } = require(path.join(MAINFRAME_DIR, 'runner', 'jcl-runner'));

// ─── App & Server Setup ─────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
}

// ─── Multer: JCL file upload ─────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jcl', '.tmpl', '.txt', '.jcl.tmpl'];
    const ext = file.originalname.toLowerCase();
    if (allowed.some(e => ext.endsWith(e))) cb(null, true);
    else cb(new Error('Only .jcl, .tmpl, .txt files are allowed'));
  }
});

// ─── Multer: .dat input data upload ──────────────────────────────────────────
const uploadDat = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.dat')) cb(null, true);
    else cb(new Error('Only .dat files are allowed for input data upload'));
  }
});

// ─── Database Singleton ───────────────────────────────────────────────────────
let db;
try {
  db = new ResultsDatabase(path.join(__dirname, 'results.db'));
} catch (e) {
  console.error('DB init error:', e.message);
}

// ─── Shared JCL Runner ────────────────────────────────────────────────────────
// Use a single runner so catalog state is shared across requests (in-memory)
let sharedRunner = null;
function getRunner() {
  if (!sharedRunner) sharedRunner = new JCLRunner();
  return sharedRunner;
}

// ─── WebSocket helpers ────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Mainframe Runtime WebSocket ready' }));
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ─── Utility: load available JCL templates ───────────────────────────────────
function listJclTemplates() {
  const jclDir = path.join(MAINFRAME_DIR, 'jcl');
  if (!fs.existsSync(jclDir)) return [];
  return fs.readdirSync(jclDir)
    .filter(f => f.endsWith('.jcl.tmpl') || f.endsWith('.jcl'))
    .map(f => ({
      name: f,
      content: fs.readFileSync(path.join(jclDir, f), 'utf8')
    }));
}

// ─── Utility: active jobs in-memory ──────────────────────────────────────────
const activeJobs = new Map(); // trackingId -> job result

// ════════════════════════════════════════════════════════════════════════════════
//  REST Routes
// ════════════════════════════════════════════════════════════════════════════════

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    system: 'Mainframe Bank Reconciliation System',
    version: '1.0.0'
  });
});

// ── Input Data File Info ──────────────────────────────────────────────────────
app.get('/api/data/info', (req, res) => {
  const testdataDir = path.join(MAINFRAME_DIR, 'testdata');
  const files = ['CORETXN_INPUT.dat', 'BANKTXN_INPUT.dat', 'ACCTMSTR_SEED.dat'];
  const info = {};
  files.forEach(name => {
    const fp = path.join(testdataDir, name);
    try {
      const stat = fs.statSync(fp);
      const content = fs.readFileSync(fp, 'utf8');
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
      info[name] = {
        exists: true,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        lineCount: lines.length,
        preview: lines.slice(0, 3)
      };
    } catch (e) {
      info[name] = { exists: false };
    }
  });
  res.json({ files: info });
});

// ── Upload Input Data (.dat) ──────────────────────────────────────────────────
const ALLOWED_DAT_FILES = new Set(['CORETXN_INPUT.dat', 'BANKTXN_INPUT.dat', 'ACCTMSTR_SEED.dat']);

app.post('/api/data/upload', uploadDat.single('datFile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No .dat file provided' });

    const targetName = (req.body.target || req.file.originalname).replace(/[^a-zA-Z0-9_.\-]/g, '');
    if (!ALLOWED_DAT_FILES.has(targetName)) {
      return res.status(400).json({ error: `Invalid target. Allowed: ${[...ALLOWED_DAT_FILES].join(', ')}` });
    }

    const content = req.file.buffer.toString('utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

    if (lines.length === 0) return res.status(400).json({ error: 'File is empty' });

    // Warn if records look wrong (LRECL=80)
    const badLines = lines.filter(l => l.length !== 80);
    const warnings = badLines.length > 0
      ? [`${badLines.length} line(s) are not exactly 80 chars (LRECL=80 required)`]
      : [];

    const testdataDir = path.join(MAINFRAME_DIR, 'testdata');
    const destPath = path.join(testdataDir, targetName);

    // Backup existing file
    if (fs.existsSync(destPath)) {
      fs.copyFileSync(destPath, destPath + '.bak');
    }

    fs.writeFileSync(destPath, content, 'utf8');

    console.log(`[DATA] Uploaded ${targetName}: ${lines.length} records`);
    res.json({
      success: true,
      target: targetName,
      lineCount: lines.length,
      size: req.file.size,
      warnings
    });
  } catch (e) {
    console.error('Data upload error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Restore Input Data backup ─────────────────────────────────────────────────
app.post('/api/data/restore/:name', (req, res) => {
  try {
    const name = req.params.name.replace(/[^a-zA-Z0-9_.\-]/g, '');
    if (!ALLOWED_DAT_FILES.has(name)) return res.status(400).json({ error: 'Invalid file name' });
    const testdataDir = path.join(MAINFRAME_DIR, 'testdata');
    const bakPath = path.join(testdataDir, name + '.bak');
    const destPath = path.join(testdataDir, name);
    if (!fs.existsSync(bakPath)) return res.status(404).json({ error: 'No backup found for ' + name });
    fs.copyFileSync(bakPath, destPath);
    fs.unlinkSync(bakPath);
    res.json({ success: true, message: `${name} restored from backup` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Dashboard Stats ───────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  try {
    const stats = db ? db.getSummaryStats() : {};
    const audits = db ? db.getAuditLogs() : [];

    const lastJob = audits.length > 0 ? audits[0] : null;
    const jobsToday = audits.filter(a => {
      const d = new Date(a.timestamp);
      const today = new Date();
      return d.toDateString() === today.toDateString();
    }).length;

    res.json({
      total: stats.total || 0,
      matched: stats.matched || 0,
      amount_mismatch: stats.amount_mismatch || 0,
      missing_bank: stats.missing_bank || 0,
      missing_core: stats.missing_core || 0,
      duplicate: stats.duplicate || 0,
      total_core_amt: stats.total_core_amt || 0,
      total_bank_amt: stats.total_bank_amt || 0,
      jobs_today: jobsToday,
      last_job: lastJob
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Reconciliation Results ────────────────────────────────────────────────────
app.get('/api/results', (req, res) => {
  try {
    const filters = {
      status: (req.query.status || '').trim(),
      account_no: (req.query.account_no || '').trim(),
      date: (req.query.date || '').trim()
    };
    const results = db ? db.queryResults(filters) : [];
    res.json({ count: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Audit Logs ────────────────────────────────────────────────────────────────
app.get('/api/audit', (req, res) => {
  try {
    const logs = db ? db.getAuditLogs() : [];
    res.json({ count: logs.length, logs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── List JCL Templates ────────────────────────────────────────────────────────
app.get('/api/jcl/templates', (req, res) => {
  try {
    const templates = listJclTemplates();
    res.json({ count: templates.length, templates: templates.map(t => t.name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get specific JCL template content ─────────────────────────────────────────
app.get('/api/jcl/templates/:name', (req, res) => {
  try {
    const jclDir = path.join(MAINFRAME_DIR, 'jcl');
    const filePath = path.join(jclDir, req.params.name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Template not found: ${req.params.name}` });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ name: req.params.name, content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Submit JCL (text body or template name) ───────────────────────────────────
app.post('/api/jobs/submit', async (req, res) => {
  try {
    const { jcl, templateName, params = {} } = req.body;
    let jclText = jcl;

    if (!jclText && templateName) {
      const jclDir = path.join(MAINFRAME_DIR, 'jcl');
      const tmplPath = path.join(jclDir, templateName);
      if (!fs.existsSync(tmplPath)) {
        return res.status(404).json({ error: `Template not found: ${templateName}` });
      }
      jclText = fs.readFileSync(tmplPath, 'utf8');
    }

    if (!jclText) {
      return res.status(400).json({ error: 'No JCL text or template provided' });
    }

    // Return immediately with a job tracking ID
    const trackingId = `TRK${Date.now()}`;
    res.json({ accepted: true, trackingId, message: 'Job submitted to JES queue' });

    // Run asynchronously and broadcast progress
    broadcast({ type: 'JOB_QUEUED', trackingId });

    const runner = getRunner();
    const jobResult = await runner.submitJob(jclText, params, (stepName, status, rc) => {
      broadcast({ type: 'STEP_UPDATE', trackingId, stepName, status, rc });
    });

    activeJobs.set(trackingId, jobResult);
    broadcast({ type: 'JOB_COMPLETED', trackingId, result: jobResult });

    if (db && jobResult.maxRC <= 8) {
      try {
        db.insertAudit({
          job_id: jobResult.jobId,
          job_name: jobResult.jobName,
          total_rows: 0,
          status: jobResult.status,
          system: 'GNUCBO_API',
          jcl_used: templateName || 'INLINE',
          max_rc: jobResult.maxRC
        });
      } catch (e) {}
    }
  } catch (e) {
    broadcast({ type: 'JOB_ERROR', error: e.message });
    console.error('Job submit error:', e);
  }
});

// ── Upload JCL file and submit ────────────────────────────────────────────────
app.post('/api/jobs/upload', upload.single('jclFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No JCL file uploaded' });
    const jclText = req.file.buffer.toString('utf8');
    const params = req.body.params ? JSON.parse(req.body.params) : {};
    const trackingId = `TRK${Date.now()}`;

    res.json({ accepted: true, trackingId, message: 'JCL file received and queued' });

    broadcast({ type: 'JOB_QUEUED', trackingId, fileName: req.file.originalname });

    const runner = getRunner();
    const jobResult = await runner.submitJob(jclText, params, (stepName, status, rc) => {
      broadcast({ type: 'STEP_UPDATE', trackingId, stepName, status, rc });
    });

    activeJobs.set(trackingId, jobResult);
    broadcast({ type: 'JOB_COMPLETED', trackingId, result: jobResult });
  } catch (e) {
    broadcast({ type: 'JOB_ERROR', error: e.message });
    console.error('Upload job error:', e);
  }
});

// ── Get job result by tracking ID ─────────────────────────────────────────────
app.get('/api/jobs/:trackingId', (req, res) => {
  const job = activeJobs.get(req.params.trackingId);
  if (!job) return res.status(404).json({ error: 'Job not found or still running' });
  res.json(job);
});

// ── List recent jobs ──────────────────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
  const jobs = [];
  activeJobs.forEach((v, k) => jobs.push({ trackingId: k, ...v }));
  res.json({ count: jobs.length, jobs: jobs.slice(-20).reverse() });
});

// ── Run Full Nightly BANKRECN with live data seeding ──────────────────────────
app.post('/api/jobs/run-bankrecn', async (req, res) => {
  try {
    const busdate = req.body.busdate || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const env = req.body.env || 'PROD';
    const trackingId = `TRK${Date.now()}`;

    res.json({ accepted: true, trackingId, message: `BANKRECN job submitted for ${env}/${busdate}` });

    broadcast({ type: 'JOB_QUEUED', trackingId, jobName: 'BANKRECN', env, busdate });

    const runner = getRunner();
    const catalog = runner.catalog;

    // Ensure seed data is present (apply requested busdate to valid seed records at TXN-DATE cols 29-36)
    const testdataDir = path.join(MAINFRAME_DIR, 'testdata');
    const applyBusDate = (records) => {
      if (!/^\d{8}$/.test(busdate)) return records;
      return records.map(line =>
        line.length >= 36 && line.slice(28, 36) === '20260930'
          ? line.slice(0, 28) + busdate + line.slice(36)
          : line
      );
    };
    const seedRecords = fs.readFileSync(path.join(testdataDir, 'ACCTMSTR_SEED.dat'), 'utf8').split(/\r?\n/).filter(l => l.length > 0);
    const coreRecords = applyBusDate(fs.readFileSync(path.join(testdataDir, 'CORETXN_INPUT.dat'), 'utf8').split(/\r?\n/).filter(l => l.length > 0));
    const bankRecords = applyBusDate(fs.readFileSync(path.join(testdataDir, 'BANKTXN_INPUT.dat'), 'utf8').split(/\r?\n/).filter(l => l.length > 0));

    const cat = catalog.loadCatalog();

    const acctKey = `BANK.${env}.ACCTMSTR`;
    const coreKey = `BANK.${env}.CORETXN`;
    const bankKey = `BANK.${env}.BANKTXN`;

    if (!cat.datasets[acctKey]) {
      catalog.defineCluster({ name: acctKey, keys: { length: 12, offset: 0 }, recordsize: { avg: 80, max: 80 }, volumes: ['WORK01'] });
    }
    catalog.writeDataset(acctKey, seedRecords, false);

    if (!cat.datasets[coreKey]) {
      catalog.allocateDataset({ name: coreKey, dcb: { recfm: 'FB', lrecl: 80, blksize: 800 } });
    }
    catalog.writeDataset(coreKey, coreRecords, false);

    if (!cat.datasets[bankKey]) {
      catalog.allocateDataset({ name: bankKey, dcb: { recfm: 'FB', lrecl: 80, blksize: 800 } });
    }
    catalog.writeDataset(bankKey, bankRecords, false);

    ['RPTSUM', 'RPTMAT', 'RPTEXC', 'RPTREJ'].forEach(rpt => {
      const base = `BANK.${env}.RECON.${rpt}`;
      const freshCat = catalog.loadCatalog();
      if (!freshCat.gdgBases || !freshCat.gdgBases[base]) {
        catalog.defineGDG(base, 5, true);
      }
    });

    const bankrecnTemplate = fs.readFileSync(path.join(MAINFRAME_DIR, 'jcl', 'BANKRECN.jcl.tmpl'), 'utf8');
    const jobResult = await runner.submitJob(bankrecnTemplate, { ENV: env, BUSDATE: busdate }, (stepName, status, rc) => {
      broadcast({ type: 'STEP_UPDATE', trackingId, stepName, status, rc });
    });

    activeJobs.set(trackingId, jobResult);
    broadcast({ type: 'JOB_COMPLETED', trackingId, result: jobResult });

    if (db) {
      try {
        db.insertAudit({
          job_id: jobResult.jobId,
          job_name: 'BANKRECN',
          total_rows: 0,
          status: jobResult.status,
          system: 'GNUCBO_API',
          jcl_used: 'BANKRECN.jcl.tmpl',
          max_rc: jobResult.maxRC
        });
      } catch (e) {}
    }
  } catch (e) {
    broadcast({ type: 'JOB_ERROR', error: e.message });
    console.error('BANKRECN run error:', e);
  }
});

// ── Spool list & output for jobs ─────────────────────────────────────────────
app.get('/api/spool', (req, res) => {
  try {
    const { SpoolManager } = require(path.join(MAINFRAME_DIR, 'runner', 'spool'));
    const spoolRoot = path.join(MAINFRAME_DIR, 'data', 'spool');
    const jobs = SpoolManager.listJobs(spoolRoot);
    res.json({ count: jobs.length, jobs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/spool/:jobId', (req, res) => {
  const { SpoolManager } = require(path.join(MAINFRAME_DIR, 'runner', 'spool'));
  const spoolRoot = path.join(MAINFRAME_DIR, 'data', 'spool');
  const data = SpoolManager.readSpool(req.params.jobId, spoolRoot);
  if (!data) return res.status(404).json({ error: 'Spool not found for job: ' + req.params.jobId });

  const sections = ['JESMSGLG', 'JESJCL', 'JESYSMSG', 'SYSOUT'];
  const lines = [];
  sections.forEach(sec => {
    if (data[sec]) {
      lines.push(`${'─'.repeat(60)}`);
      lines.push(`DD: ${sec}`);
      lines.push(`${'─'.repeat(60)}`);
      lines.push(...data[sec].split('\n'));
    }
  });
  res.json({ jobId: req.params.jobId, jobName: data.jobName, status: data.status, maxRC: data.maxRC, lineCount: lines.length, lines });
});

// ── Catalog browser ───────────────────────────────────────────────────────────
app.get('/api/catalog', (req, res) => {
  try {
    const runner = getRunner();
    const cat = runner.catalog.loadCatalog();
    const prefix = (req.query.prefix || '').toUpperCase();
    const datasets = Object.values(cat.datasets || {})
      .filter(d => !prefix || d.name.startsWith(prefix))
      .map(d => ({
        name: d.name,
        type: d.type || 'PS',
        recfm: d.recfm,
        lrecl: d.lrecl,
        cataloged: d.cataloged,
        created: d.created,
        updated: d.updated
      }));
    const gdgBases = Object.values(cat.gdgBases || {})
      .filter(g => !prefix || g.name.startsWith(prefix));
    res.json({ datasets, gdgBases, total: datasets.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Catalog: read dataset records ─────────────────────────────────────────────
app.get('/api/catalog/read/:dsname', (req, res) => {
  try {
    const runner = getRunner();
    const dsname = req.params.dsname.toUpperCase();
    const limit = parseInt(req.query.limit || '100', 10);
    const data = runner.catalog.readDataset(dsname, limit);
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ── Run Automated Test Suite ──────────────────────────────────────────────────
app.post('/api/test/run', async (req, res) => {
  const trackingId = `TEST${Date.now()}`;
  res.json({ accepted: true, trackingId, message: 'Automated test suite initiated' });

  broadcast({ type: 'TEST_STARTED', trackingId });

  const { spawn } = require('child_process');
  const child = spawn('node', [path.join(MAINFRAME_DIR, 'test_suite.js')], {
    cwd: MAINFRAME_DIR,
    env: { ...process.env }
  });

  const lines = [];
  child.stdout.on('data', d => {
    d.toString().split('\n').filter(l => l.trim()).forEach(line => {
      lines.push(line);
      broadcast({ type: 'TEST_OUTPUT', trackingId, line });
    });
  });
  child.stderr.on('data', d => {
    d.toString().split('\n').filter(l => l.trim()).forEach(line => {
      broadcast({ type: 'TEST_ERROR', trackingId, line });
    });
  });
  child.on('close', code => {
    broadcast({ type: 'TEST_COMPLETED', trackingId, exitCode: code, summary: lines.slice(-5).join('\n') });
  });
});

// ── Fallback: serve frontend ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built' });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('API Error:', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║    MAINFRAME BANK RECONCILIATION SYSTEM - API SERVER         ║');
  console.log(`║    HTTP  : http://localhost:${PORT}                              ║`);
  console.log(`║    WS    : ws://localhost:${PORT}/ws                             ║`);
  console.log(`║    API   : http://localhost:${PORT}/api/health                   ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
});

module.exports = { app, server };
