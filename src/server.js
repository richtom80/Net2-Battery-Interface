require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const { getBatteryLevels } = require('./queries/batteryLevels');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/battery-levels', async (req, res) => {
  try {
    const levels = await getBatteryLevels();
    res.json({ ok: true, levels, fetchedAt: new Date().toISOString() });
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

app.get('/api/worksheet.pdf', async (req, res) => {
  try {
    const levels = await getBatteryLevels();
    const payload = JSON.stringify({ fetchedAt: new Date().toISOString(), levels });
    const script = path.join(ROOT, 'scripts', 'make-report.py');
    const py = spawn(pythonCmd(), [script, '-', '-']);

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

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="battery-worksheet-${date}.pdf"`);
    py.stdout.pipe(res);
    py.stdin.write(payload);
    py.stdin.end();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Paxton battery dashboard running at http://localhost:${PORT}`);
});
