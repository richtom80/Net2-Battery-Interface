require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const { getBatteryLevels } = require('./queries/batteryLevels');
const { getDoorAccess } = require('./queries/doorAccess');
const { getUsers, getUserDoors, getDoorsWithUsers } = require('./queries/accessAudit');
const { getUserActivity } = require('./queries/accessReview');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '');
    console.log(`${new Date().toISOString()} ${ip} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use(express.static(path.join(ROOT, 'public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  },
}));

app.get('/api/battery-levels', async (req, res) => {
  try {
    const [levels, access] = await Promise.all([getBatteryLevels(), getDoorAccess()]);
    const withAccess = levels.map((l) => {
      const a = access.get(l.serialNumber) || { users: '', userCount: 0 };
      return { ...l, users: a.users, userCount: a.userCount };
    });
    res.json({ ok: true, levels: withAccess, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    res.json({ ok: true, users: await getUsers() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/user-doors', async (req, res) => {
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ ok: false, error: 'A numeric userId is required.' });
  }
  try {
    res.json({ ok: true, doors: await getUserDoors(userId) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/door-users', async (req, res) => {
  try {
    res.json({ ok: true, doors: await getDoorsWithUsers(), fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/user-activity', async (req, res) => {
  try {
    const { rows, counts } = await getUserActivity();
    res.json({ ok: true, users: rows, counts, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function pythonCmd() {
  const venv = process.platform === 'win32'
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
  if (process.env.PYTHON) return process.env.PYTHON;
  return fs.existsSync(venv) ? venv : 'python3';
}

function streamPdf(res, scriptArgs, payload, filename) {
  const py = spawn(pythonCmd(), scriptArgs);
  let errOut = '';
  py.stderr.on('data', (d) => { errOut += d.toString(); });
  py.on('error', (e) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: `Could not run the PDF generator: ${e.message}` });
  });
  py.on('close', (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ ok: false, error: `PDF generation failed. Is reportlab installed in .venv? ${errOut.trim()}` });
    }
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  py.stdout.pipe(res);
  py.stdin.write(payload);
  py.stdin.end();
}

const REPORT = path.join(ROOT, 'scripts', 'make-report.py');
const ACCESS_REPORT = path.join(ROOT, 'scripts', 'make-access-report.py');

app.get('/api/worksheet.pdf', async (req, res) => {
  try {
    const levels = await getBatteryLevels();
    const payload = JSON.stringify({ fetchedAt: new Date().toISOString(), levels });
    const date = new Date().toISOString().slice(0, 10);
    streamPdf(res, [REPORT, '-', '-'], payload, `battery-worksheet-${date}.pdf`);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/user-doors.pdf', async (req, res) => {
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ ok: false, error: 'A numeric userId is required.' });
  }
  try {
    const [users, doors] = await Promise.all([getUsers(), getUserDoors(userId)]);
    const user = users.find((u) => u.userId === userId) || { name: `User ${userId}` };
    const payload = JSON.stringify({ kind: 'user', generatedAt: new Date().toISOString(), user, rows: doors });
    const safe = (user.name || 'user').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    streamPdf(res, [ACCESS_REPORT], payload, `access-by-user-${safe}.pdf`);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/user-activity.pdf', async (req, res) => {
  try {
    const { rows } = await getUserActivity();
    const buckets = String(req.query.buckets || '').split(',').filter(Boolean);
    const filtered = buckets.length ? rows.filter((r) => buckets.includes(r.bucket)) : rows;
    const filterLabel = buckets.length ? `Filtered to: ${buckets.join(', ')}` : 'All active users';
    const payload = JSON.stringify({ kind: 'review', generatedAt: new Date().toISOString(), filterLabel, rows: filtered });
    const date = new Date().toISOString().slice(0, 10);
    streamPdf(res, [ACCESS_REPORT], payload, `access-review-${date}.pdf`);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/door-users.pdf', async (req, res) => {
  try {
    let doors = await getDoorsWithUsers();
    const serials = new Set(
      String(req.query.serials || '').split(',').map((s) => Number(s)).filter(Number.isInteger)
    );
    if (serials.size) doors = doors.filter((d) => serials.has(d.serialNumber));
    const payload = JSON.stringify({ kind: 'door', generatedAt: new Date().toISOString(), rows: doors });
    const date = new Date().toISOString().slice(0, 10);
    streamPdf(res, [ACCESS_REPORT], payload, `door-access-audit-${date}.pdf`);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Paxton battery dashboard running at http://localhost:${PORT}`);
});
