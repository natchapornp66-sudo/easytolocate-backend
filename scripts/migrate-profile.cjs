// Additive migration, resolved through the connection search_path (including isolated QA schemas).
async function migrateProfile(pool) {
    await pool.query(`ALTER TABLE users
        ADD COLUMN IF NOT EXISTS address text,
        ADD COLUMN IF NOT EXISTS latitude numeric(10,7),
        ADD COLUMN IF NOT EXISTS longitude numeric(10,7)`);
}
module.exports = migrateProfile;
if (require.main === module) {
    const pool = require('../db');
    migrateProfile(pool).then(() => console.log('Profile fields ready; existing records preserved.'))
        .catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
}
