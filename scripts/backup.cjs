// Run while the application is stopped so the database and uploaded files agree.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { uploadRoot } = require('../config');
const { pgEnvironment, pgTool } = require('./postgres-tools.cjs');
const storage = require('../storage');
const base = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(__dirname, '..', '.backups'));
const schemaArgument = process.argv.find(arg => arg.startsWith('--schema='));
const schema = schemaArgument?.slice(9) || (storage.cloud ? 'public' : undefined);
if (schema && !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid schema name');
if (base === uploadRoot || base.startsWith(uploadRoot + path.sep)) throw new Error('Backup directory must be outside uploaded files');
const destination = path.join(base, new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(destination, { recursive: true });
const result = spawnSync(pgTool('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', ...(schema ? ['--schema=' + schema] : []), '--file', path.join(destination, 'database.dump')],
    { env: pgEnvironment(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
if (result.error || result.status !== 0) { console.error('Database backup failed. Check PostgreSQL tools and database access.'); process.exitCode = 1; }
else { (async () => {
    if (storage.cloud) await storage.backup(path.join(destination, 'uploads'));
    else fs.cpSync(uploadRoot, path.join(destination, 'uploads'), { recursive: true, errorOnExist: true, force: false });
    fs.writeFileSync(path.join(destination, 'README.txt'), 'Database dump + uploaded files. Restore both to the same point in time. Contains private data: restrict access.\n');
    console.log('Backup saved to ' + destination);
})().catch(() => { console.error('Uploaded file backup failed; this backup is incomplete.'); process.exitCode = 1; }); }
