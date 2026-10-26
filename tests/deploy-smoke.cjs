// Production rehearsal on loopback using a new, disposable schema and synthetic files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Pool } = require('pg');
const { databaseOptions } = require('../config');
const { pgEnvironment, pgTool } = require('../scripts/postgres-tools.cjs');
const root = path.resolve(__dirname, '..');
const schema = 'qa_deploy_' + Date.now();
const directory = path.join(root, '.deploy-test', schema);
fs.mkdirSync(directory, { recursive: true });
const pool = new Pool(databaseOptions);
const url = new URL(process.env.DATABASE_URL);
// Use ONLY the new schema; never fall back to live public tables if initialization fails.
url.searchParams.set('options', '-c search_path=' + schema);
const base = 'http://127.0.0.1:5101';
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '5101',
    DATABASE_URL: url.toString(), JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    FRONTEND_URL: base, UPLOAD_DIR: path.join(directory, 'uploads'),
    FRONTEND_DIST_DIR: path.join(root, 'public-app'), SERVE_FRONTEND: 'true', TEST_API_URL: base + '/api' };
let server, serverLog;
let storageStub;
const cloudMode = process.argv.includes('--cloud');
const results = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); results.push({ name, pass: true }); console.log('PASS ' + name); }
function run(file, args = [], expected = 0) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [file, ...args], { cwd: root, env, windowsHide: true });
        let output = '';
        child.stdout.on('data', b => output += b);
        child.stderr.on('data', b => output += b);
        child.on('error', reject);
        child.on('exit', code => {
            fs.writeFileSync(path.join(directory, path.basename(file) + (expected ? '-refused' : '') + '.log'), output);
            if (code !== expected) reject(new Error(path.basename(file) + ' failed: ' + output.slice(-2500)));
            else resolve(output);
        });
    });
}
async function stop() {
    if (!server || server.exitCode !== null) return;
    const ended = once(server, 'exit'); server.kill(); await ended; server = undefined;
    serverLog.end();
}
async function start() {
    serverLog = fs.createWriteStream(path.join(directory, 'server.log'), { flags: 'a' });
    server = spawn(process.execPath, ['server.js'], { cwd: root, env, windowsHide: true });
    server.stdout.pipe(serverLog, { end: false }); server.stderr.pipe(serverLog, { end: false });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null) throw new Error('Production server exited; see local test log');
        try { const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Production server not ready');
}
async function api(endpoint, method = 'GET', body, token) {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + '/api' + endpoint, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
}
async function main() {
    if (cloudMode) {
        storageStub = await require('./storage-stub.cjs').createStorageStub();
        Object.assign(env, { STORAGE_DRIVER: 'supabase', SUPABASE_URL: storageStub.url, SUPABASE_SERVICE_ROLE_KEY: storageStub.token, SUPABASE_STORAGE_BUCKET: 'easytolocate-files' });
    } else env.STORAGE_DRIVER = 'local';
    await run('scripts/database.cjs', ['--init', '--schema=' + schema]); check('fresh database initialization and compatibility', true, true);
    await run('scripts/database.cjs', ['--init', '--schema=' + schema], 1); check('existing database initialization refused', true, true);
    const empty = await pool.query(`SELECT COUNT(*)::int AS n FROM "${schema}".users`); check('no real accounts copied into fresh installation', empty.rows[0].n, 0);
    await start();
    for (const route of ['/', '/profile', '/admin/dashboard', '/items/test-deep-link']) {
        const r = await fetch(base + route, { headers: { Accept: 'text/html' } });
        check('production HTML deep link ' + route, r.status === 200 && (r.headers.get('content-type') || '').includes('text/html'), true);
    }
    const html = await (await fetch(base)).text();
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    const script = await (await fetch(base + asset)).text();
    check('production JS contains no local API host', script.includes('http://localhost:5000'), false);
    for (const route of ['/api/does-not-exist', '/uploads/verifications/nope.png', '/missing.js']) check('no HTML fallback for ' + route, (await fetch(base + route)).status, 404);
    const health = await fetch(base + '/api/health', { headers: { Origin: base } });
    check('allowed CORS origin', health.headers.get('access-control-allow-origin'), base);
    check('hide server signature', health.headers.get('x-powered-by'), null);
    check('prevent content sniffing', health.headers.get('x-content-type-options'), 'nosniff');
    const denied = await fetch(base + '/api/health', { headers: { Origin: 'https://untrusted.example.invalid' } });
    check('unlisted CORS origin excluded', denied.headers.get('access-control-allow-origin'), null);
    const credentials = { email: `qa.deploy.${Date.now()}@example.invalid`, password: crypto.randomBytes(20).toString('hex'), full_name: 'QA DEPLOY ONLY' };
    check('fresh installation registration', (await api('/auth/register', 'POST', credentials)).status, 201);
    const login = await api('/auth/login', 'POST', credentials); check('fresh installation login', login.status, 200);
    const token = login.data.token;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const form = new FormData(); form.append('images', new Blob([png], { type: 'image/png' }), 'QA.png');
    const uploaded = await api('/upload/item-images', 'POST', form, token); check('external persistent upload', uploaded.status, 201);
    const image = uploaded.data.images[0];
    if (cloudMode) {
        await new Promise(resolve => setTimeout(resolve, 100));
        check('cloud file saved before upload succeeds', storageStub.objects.has('items/' + path.basename(image)), true);
        check('no local file needed for cloud reads', fs.existsSync(path.join(env.UPLOAD_DIR, 'items', path.basename(image))), false);
    } else check('file written outside release directory', fs.existsSync(path.join(env.UPLOAD_DIR, 'items', path.basename(image))), true);
    await stop(); await start();
    check('uploaded file survives restart', (await fetch(base + image)).status, 200);
    check('session survives restart', (await api('/auth/me', 'GET', undefined, token)).status, 200);
    await run('scripts/grant-admin.cjs', [credentials.email]);
    check('first administrator setup on new installation', (await api('/admin/users', 'GET', undefined, token)).status, 200);
    for (const suite of ['rental', 'dispute-admin', 'profile-verification', 'items', 'chat-review', 'system-fixes']) {
        await run('tests/' + suite + '-regression.cjs');
        const result = JSON.parse(fs.readFileSync(path.join(root, suite + '-regression-result.json'), 'utf8'));
        check(suite + ' regression (' + result.results.length + ' checks)', result.results.every(r => r.pass), true);
    }
    const privateFiles = cloudMode ? [...storageStub.objects.keys()].filter(k => k.startsWith('verifications/')).map(k => k.split('/')[1]) : fs.readdirSync(path.join(env.UPLOAD_DIR, 'verifications'));
    check('private documents stored persistently', privateFiles.length > 0, true);
    for (const name of privateFiles) {
        assert.equal((await fetch(base + '/uploads/verifications/' + name)).status, 404);
    }
    check('private uploaded documents stay protected in production', true, true);
    await stop();
    const backupBase = path.join(directory, 'backups');
    await run('scripts/backup.cjs', [backupBase, '--schema=' + schema]);
    const backup = path.join(backupBase, fs.readdirSync(backupBase)[0]);
    check('backup includes database and uploaded files', fs.existsSync(path.join(backup, 'database.dump')) && fs.existsSync(path.join(backup, 'uploads', 'items', path.basename(image))), true);
    // Rehearse restoration ONLY for the exact disposable schema created above.
    assert.match(schema, /^qa_deploy_[0-9]+$/);
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await new Promise((resolve, reject) => {
        const pgEnv = pgEnvironment();
        const child = spawn(pgTool('pg_restore'), ['--dbname', pgEnv.PGDATABASE, '--no-owner', '--no-privileges', '--exit-on-error', path.join(backup, 'database.dump')], { env: pgEnv, windowsHide: true });
        let output = ''; child.stderr.on('data', b => output += b); child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error('Restore failed: ' + output.slice(-1000))));
    });
    const previousUploads = path.resolve(directory, 'uploads-before-restore');
    assert.equal(path.dirname(previousUploads), directory);
    assert.equal(path.dirname(env.UPLOAD_DIR), directory);
    if (!cloudMode) {
        fs.renameSync(env.UPLOAD_DIR, previousUploads);
        fs.cpSync(path.join(backup, 'uploads'), env.UPLOAD_DIR, { recursive: true });
    }
    await start();
    check('restored database preserves session and account', (await api('/auth/me', 'GET', undefined, token)).status, 200);
    check('restored uploaded image is readable', (await fetch(base + image)).status, 200);
}
main().catch(error => { console.error(error.message); results.push({ name: error.message, pass: false }); process.exitCode = 1; }).finally(async () => {
    await stop();
    if (storageStub) await storageStub.close();
    // This exact random schema was created by this run; never drop public or user-provided schemas.
    if (!/^qa_deploy_[0-9]+$/.test(schema)) throw new Error('Unsafe cleanup target');
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
    fs.writeFileSync(path.join(root, cloudMode ? 'supabase-regression-result.json' : 'deploy-regression-result.json'), JSON.stringify({ schema, directory, cloudMode, results }, null, 2));
});
