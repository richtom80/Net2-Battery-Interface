/*
 * Reads wireless lock (Net2 Nano) battery status from Paxton's own
 * supported read surface: the `sdk` schema (sdk.Net2NanoDevices), not the
 * raw dbo tables. The SQL login used here (net2_battery_reader) is a
 * member of the `sdk_reader` role, which Net2's own installer sets up
 * specifically to grant SELECT on `sdk.*` while denying direct access to
 * `dbo.*` - this is the intended integration path, confirmed by inspecting
 * sys.database_permissions.
 *
 * BatteryLevel is a 0-10 scale from the device (10 = full), not a percent.
 */
const { getPool } = require('../db');

async function getBatteryLevels() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT SerialNumber, DeviceName, BatteryLevel, LastHeartBeat, OnlineStatus, SignalStrength
    FROM sdk.Net2NanoDevices
    ORDER BY BatteryLevel ASC, DeviceName ASC
  `);

  return result.recordset.map((r) => ({
    serialNumber: r.SerialNumber,
    door: r.DeviceName,
    batteryLevel: r.BatteryLevel,
    lastReported: r.LastHeartBeat,
    online: r.OnlineStatus === 0,
    signalStrength: r.SignalStrength,
  }));
}

module.exports = { getBatteryLevels };
