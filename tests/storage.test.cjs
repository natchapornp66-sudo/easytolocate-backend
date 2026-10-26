const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStorageStub } = require('./storage-stub.cjs');
test('Supabase storage adapter contract and failures', async t => {
    const stub = await createStorageStub();
    Object.assign(process.env, { STORAGE_DRIVER: 'supabase', SUPABASE_URL: stub.url, SUPABASE_SERVICE_ROLE_KEY: stub.token });
    const storage = require('../storage');
    const directory = path.join(__dirname, '..', '.deploy-test', 'storage-unit-' + Date.now());
    fs.mkdirSync(directory, { recursive: true });
    const filename = require('node:crypto').randomUUID() + '.png';
    const file = { filename, path: path.join(directory, filename), mimetype: 'image/png' };
    fs.writeFileSync(file.path, Buffer.from('synthetic-test-file'));
    try {
        await t.test('private bucket accepted', () => storage.ready());
        await t.test('public bucket rejected', async () => {
            stub.state.public = true; await assert.rejects(storage.ready(), /private/); stub.state.public = false;
        });
        await t.test('upload then remote existence check', async () => {
            await storage.persist('verifications', [file]); assert.equal(await storage.exists('verifications', filename), true);
            assert.equal(file.storageKey, 'verifications/' + filename);
        });
        await t.test('missing object returns false', async () => assert.equal(await storage.exists('items', require('node:crypto').randomUUID() + '.png'), false));
        await t.test('storage outage fails the upload', async () => {
            stub.state.failUploads = true; await assert.rejects(storage.persist('items', [file])); stub.state.failUploads = false;
        });
        await t.test('path traversal rejected before request', async () => assert.rejects(storage.exists('verifications', '../secret.png')));
    } finally { fs.unlinkSync(file.path); await stub.close(); }
});
