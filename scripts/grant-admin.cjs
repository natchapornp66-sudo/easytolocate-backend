// Operator-only command. Requires direct database credentials; never exposed as an API.
const pool = require('../db');
async function main() {
    const email = (process.argv[2] || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: npm run admin:grant -- existing-account@example.com');
    const result = await pool.query("UPDATE users SET role='admin', updated_at=NOW() WHERE LOWER(email)=$1 RETURNING user_id", [email]);
    if (result.rowCount !== 1) throw new Error('Existing registered account not found');
    console.log('Administrator role granted to the specified registered account.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
