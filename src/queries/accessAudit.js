/*
 * Access-audit queries, built on the supported `sdk` views.
 *
 * The access chain both directions share:
 *   user -> UsersEx.AccessLevelName -> AccessLevels
 *        -> AccessLevelMembers (area grants, skipping TimezoneID 0 = "At no
 *           time") -> AreaGateways (area <- reader) -> PeripheralNames
 *           (reader <-> ACU serial = door)
 */
const { getPool, sql } = require('../db');

// Active users, for the picker in the "Access by user" report.
async function getUsers() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT UserID,
      COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(FirstName, '') + ' ' + ISNULL(Surname, ''))), ''), Username) AS fullName,
      AccessLevelName, DepartmentName
    FROM sdk.UsersEx
    WHERE Active = 1
    ORDER BY fullName
  `);
  return r.recordset.map((u) => ({
    userId: u.UserID,
    name: u.fullName,
    accessLevel: u.AccessLevelName,
    department: u.DepartmentName,
  }));
}

// Doors a single user can currently open, with the access window(s).
async function getUserDoors(userId) {
  const pool = await getPool();
  const r = await pool.request().input('uid', sql.Int, userId).query(`
    SELECT pn.SerialNumber, MAX(pn.PeripheralName) AS peripheralName, tz.Name AS timezone
    FROM sdk.UsersEx u
    JOIN sdk.AccessLevels al ON al.AccessLevelName = u.AccessLevelName
    JOIN sdk.AccessLevelMembers alm ON alm.AccessLevelID = al.AccessLevelID AND alm.TimezoneID <> 0
    JOIN sdk.AreaGateways ag ON ag.ToAreaID = alm.AreaID
    JOIN sdk.PeripheralNames pn ON pn.PeripheralID = ag.PeripheralID
    LEFT JOIN sdk.Timezones tz ON tz.TimezoneID = alm.TimezoneID
    WHERE u.UserID = @uid
    GROUP BY pn.SerialNumber, tz.Name
    ORDER BY peripheralName
  `);
  const byDoor = new Map();
  for (const row of r.recordset) {
    const key = row.SerialNumber;
    if (!byDoor.has(key)) {
      byDoor.set(key, { serialNumber: key, peripheralName: row.peripheralName, timezones: [] });
    }
    if (row.timezone) byDoor.get(key).timezones.push(row.timezone);
  }
  return [...byDoor.values()];
}

// Every door with the active users who can open it (the by-door audit).
async function getDoorsWithUsers() {
  const pool = await getPool();
  const r = await pool.request().query(`
    WITH door_name AS (
      SELECT SerialNumber, MAX(PeripheralName) AS peripheralName
      FROM sdk.PeripheralNames GROUP BY SerialNumber
    ),
    door_al AS (
      SELECT DISTINCT pn.SerialNumber, al.AccessLevelName
      FROM sdk.PeripheralNames pn
      JOIN sdk.AreaGateways ag ON ag.PeripheralID = pn.PeripheralID
      JOIN sdk.AccessLevelMembers alm ON alm.AreaID = ag.ToAreaID AND alm.TimezoneID <> 0
      JOIN sdk.AccessLevels al ON al.AccessLevelID = alm.AccessLevelID
    ),
    door_user AS (
      SELECT DISTINCT da.SerialNumber, u.UserID,
        COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(u.FirstName, '') + ' ' + ISNULL(u.Surname, ''))), ''), u.Username) AS fullName
      FROM door_al da
      JOIN sdk.UsersEx u ON u.AccessLevelName = da.AccessLevelName AND u.Active = 1
    )
    SELECT du.SerialNumber,
           dn.peripheralName,
           COUNT(*) AS userCount,
           STRING_AGG(du.fullName, ', ') WITHIN GROUP (ORDER BY du.fullName) AS users
    FROM door_user du
    LEFT JOIN door_name dn ON dn.SerialNumber = du.SerialNumber
    GROUP BY du.SerialNumber, dn.peripheralName
    ORDER BY dn.peripheralName
  `);
  return r.recordset.map((d) => ({
    serialNumber: d.SerialNumber,
    peripheralName: d.peripheralName || '',
    userCount: d.userCount || 0,
    users: d.users || '',
  }));
}

module.exports = { getUsers, getUserDoors, getDoorsWithUsers };
