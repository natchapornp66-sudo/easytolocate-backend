const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pgEnvironment, pgTool } = require('./postgres-tools.cjs');
const pool = require('../db');
async function main() {
    const output = path.join(__dirname, '..', 'db', 'bootstrap.sql');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const result = spawnSync(pgTool('pg_dump'), ['--schema-only', '--schema=public', '--exclude-table=public.*backup*', '--no-owner', '--no-privileges', '--no-comments', '--file', output], { env: pgEnvironment(), encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error('Schema export failed; check PG_BIN_DIR and PostgreSQL connection');
    const categories = await pool.query('SELECT category_id, category_name FROM categories ORDER BY category_id');
    const seed = categories.rows.map(row => `INSERT INTO public.categories (category_id,category_name) VALUES (${Number(row.category_id)},'${row.category_name.replace(/'/g, "''")}');`).join('\n');
    fs.appendFileSync(output, `\n-- Application category reference data only; no accounts, documents or transactions.\n${seed}\nSELECT setval('public.categories_category_id_seq', COALESCE((SELECT MAX(category_id) FROM public.categories), 1), true);\n`);
    console.log(`Schema-only bootstrap exported with ${categories.rowCount} categories; no user data exported.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
