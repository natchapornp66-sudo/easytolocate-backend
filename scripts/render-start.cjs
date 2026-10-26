// Render Free has no pre-deploy job/shell: initialize only an empty application database.
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const { databaseOptions, validateProduction } = require('../config');
const tables = ['users','categories','items','rentals','reviews','rental_inspections','agreements','chat_messages','notifications','user_verifications','user_bank_accounts','rental_payments','disputes','dispute_history','dispute_messages','dispute_evidence','fine_refunds','item_price_benchmarks','item_price_sources'];
async function command(args) {
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { cwd: require('node:path').resolve(__dirname, '..'), env: process.env, stdio: 'inherit', windowsHide: true });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Database preparation failed')));
    });
}
async function main() {
    validateProduction();
    if (process.env.STORAGE_DRIVER !== 'supabase') throw new Error('Render Free requires Supabase storage');
    const pool = new Pool(databaseOptions);
    try {
        const current = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
        if (current.rows.some(row => row.table_name === 'users')) await require('./migrate-profile.cjs')(pool);
        await command(['scripts/database.cjs', ...(current.rowCount === 0 ? ['--init'] : [])]);
        // Backend connects as table owner/postgres. Browser/Data API roles must not read app tables.
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const table of tables) await client.query(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
            const roles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')");
            for (const { rolname } of roles.rows) {
                await client.query(`REVOKE ALL ON ${tables.map(t => 'public."' + t + '"').join(',')} FROM "${rolname}"`);
            }
            await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    } finally { await pool.end(); }
    const server = spawn(process.execPath, ['server.js'], { cwd: require('node:path').resolve(__dirname, '..'), stdio: 'inherit', env: process.env, windowsHide: true });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
    server.on('exit', code => { process.exitCode = code ?? 1; });
}
main().catch(error => { console.error('Render startup failed:', error.code || error.message); process.exitCode = 1; });
