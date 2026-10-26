// Preserve existing upload URLs and authorization; only the storage location changes.
const fs = require('node:fs');
const path = require('node:path');
const { uploadRoot } = require('./config');
const cloud = process.env.STORAGE_DRIVER === 'supabase';
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'easytolocate-files';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const kinds = new Set(['items', 'reviews', 'rentals', 'payments', 'disputes', 'verifications']);
function objectKey(kind, filename) {
    if (!kinds.has(kind) || !/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) throw new Error('Invalid upload key');
    return kind + '/' + filename;
}
async function request(endpoint, options = {}) {
    const response = await fetch(base + '/storage/v1/' + endpoint, {
        ...options, headers: { apikey: key, Authorization: 'Bearer ' + key, ...options.headers },
        signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    if (!response.ok) {
        // Storage can return a 400 HTTP response with a 404 statusCode in its JSON body.
        const body = await response.json().catch(() => ({}));
        const error = new Error('File storage request failed');
        error.status = response.status === 404 || Number(body.statusCode) === 404 ? 404 : 502;
        throw error;
    }
    return response;
}
async function ready() {
    if (!cloud) return fs.promises.access(uploadRoot, fs.constants.R_OK | fs.constants.W_OK);
    const info = await (await request('bucket/' + encodeURIComponent(bucket))).json();
    if (info.public !== false) throw new Error('Storage bucket must be private');
}
async function persist(kind, files) {
    if (!cloud) return;
    for (const file of files) {
        const name = objectKey(kind, file.filename);
        await request('object/' + encodeURIComponent(bucket) + '/' + name, {
            method: 'POST', headers: { 'Content-Type': file.mimetype, 'x-upsert': 'false' },
            body: await fs.promises.readFile(file.path),
        });
        file.storageKey = name;
    }
}
async function exists(kind, filename) {
    objectKey(kind, filename);
    if (!cloud) return !!(await fs.promises.stat(path.join(uploadRoot, kind, filename)).catch(() => null))?.isFile();
    try { const r = await request('object/authenticated/' + encodeURIComponent(bucket) + '/' + objectKey(kind, filename)); await r.body.cancel(); return true; }
    catch (error) { if (error.status === 404) return false; throw error; }
}
async function send(res, kind, filename) {
    const name = objectKey(kind, filename);
    if (!cloud) return res.sendFile(filename, { root: path.join(uploadRoot, kind) }, error => {
        if (error && !res.headersSent) res.status(error.statusCode === 404 ? 404 : 500).json({ success: false, error: 'ไม่พบไฟล์' });
    });
    try {
        const r = await request('object/authenticated/' + encodeURIComponent(bucket) + '/' + name);
        const data = Buffer.from(await r.arrayBuffer());
        const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[filename.split('.').pop().toLowerCase()];
        res.type(type).send(data);
    } catch (error) {
        if (!res.headersSent) res.status(error.status === 404 ? 404 : 502).json({ success: false, error: 'ไม่สามารถเปิดไฟล์ได้' });
    }
}
function cleanupTemporaryUploads(req, res, next) {
    if (cloud) {
        let done = false;
        const finish = async () => {
            if (done) return; done = true;
            const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
            for (const file of files) {
                try {
                    if (file.storageKey && res.writableFinished && res.statusCode >= 400) {
                        await request('object/' + encodeURIComponent(bucket), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [file.storageKey] }) });
                    }
                } catch { console.error('Storage cleanup failed; review orphan uploads'); }
                finally { await fs.promises.unlink(file.path).catch(() => {}); }
            }
        };
        res.once('finish', finish); res.once('close', finish);
    }
    next();
}
async function backup(destination) {
    for (const kind of kinds) {
        fs.mkdirSync(path.join(destination, kind), { recursive: true });
        for (let offset = 0; ; offset += 1000) {
            const files = await (await request('object/list/' + encodeURIComponent(bucket), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: kind, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) })).json();
            for (const file of files) {
                const name = objectKey(kind, file.name);
                const response = await request('object/authenticated/' + encodeURIComponent(bucket) + '/' + name);
                fs.writeFileSync(path.join(destination, kind, file.name), Buffer.from(await response.arrayBuffer()));
            }
            if (files.length < 1000) break;
        }
    }
}
module.exports = { cloud, ready, persist, exists, send, backup, cleanupTemporaryUploads };
