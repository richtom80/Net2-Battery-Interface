require('dotenv').config();
const path = require('path');
const express = require('express');
const { getBatteryLevels } = require('./queries/batteryLevels');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/battery-levels', async (req, res) => {
  try {
    const levels = await getBatteryLevels();
    res.json({ ok: true, levels, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Paxton battery dashboard running at http://localhost:${PORT}`);
});
