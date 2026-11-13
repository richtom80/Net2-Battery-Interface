/*
 * Access review: active users ranked by how long since they last used a
 * credential, for spotting dormant access that should be reviewed or
 * revoked. Reads sdk.UsersEx (LastAccessTime is maintained by Net2).
 *
 * Returns rows with a computed daysSince and bucket:
 *   never | 90d+ | 30-90d | <30d
 */
const { getPool } = require('../db');

function bucketFor(lastAccess) {
  if (!lastAccess) return 'never';
  const days = Math.floor((Date.now() - new Date(lastAccess).getTime()) / 86400000);
  if (days >= 90) return '90d+';
  if (days >= 30) return '30-90d';
  return '<30d';
}

async function getUserActivity() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT UserID,
      COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(FirstName, '') + ' ' + ISNULL(Surname, ''))), ''), Username) AS fullName,
      DepartmentName, AccessLevelName, LastAccessTime, LastKnownLocation
    FROM sdk.UsersEx
    WHERE Active = 1
  `);

  const rows = result.recordset.map((u) => {
    const last = u.LastAccessTime || null;
    const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    return {
      userId: u.UserID,
      name: u.fullName,
      department: u.DepartmentName || '',
      accessLevel: u.AccessLevelName || '',
      lastAccess: last,
      lastLocation: u.LastKnownLocation || '',
      daysSince,
      bucket: bucketFor(last),
    };
  });

  // Dormant first: never, then oldest last-access.
  rows.sort((a, b) => {
    if (a.lastAccess === null && b.lastAccess === null) return a.name.localeCompare(b.name);
    if (a.lastAccess === null) return -1;
    if (b.lastAccess === null) return 1;
    return new Date(a.lastAccess) - new Date(b.lastAccess);
  });

  const counts = { never: 0, '90d+': 0, '30-90d': 0, '<30d': 0 };
  rows.forEach((r) => { counts[r.bucket]++; });

  return { rows, counts };
}

module.exports = { getUserActivity };
