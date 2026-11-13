/*
 * For each door (by ACU serial number), the active users whose access rights
 * currently include that door. Chain, all via the supported `sdk` views:
 *
 *   door serial  -> sdk.PeripheralNames   (serial  -> reader PeripheralID)
 *                -> sdk.AreaGateways       (reader  -> the area it opens into)
 *                -> sdk.AccessLevelMembers (area    -> access levels, skipping
 *                                           the "At no time" timezone = never)
 *                -> sdk.AccessLevels       (-> access level name)
 *                -> sdk.UsersEx            (active users holding that level)
 *
 * TimezoneID 0 is "At no time", so those grants are excluded — that is how
 * "No access" and revoked individual permissions appear in the data.
 *
 * Returns a Map: serialNumber -> { users: "Name, Name, ...", userCount }.
 */
const { getPool } = require('../db');

async function getDoorAccess() {
  const pool = await getPool();
  const result = await pool.request().query(`
    WITH door_al AS (
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
    SELECT SerialNumber,
           COUNT(*) AS userCount,
           STRING_AGG(fullName, ', ') WITHIN GROUP (ORDER BY fullName) AS users
    FROM door_user
    GROUP BY SerialNumber
  `);

  const map = new Map();
  for (const r of result.recordset) {
    map.set(r.SerialNumber, { users: r.users || '', userCount: r.userCount || 0 });
  }
  return map;
}

module.exports = { getDoorAccess };
