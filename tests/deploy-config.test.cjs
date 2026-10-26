const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://qa:qa@localhost/qa',
    JWT_SECRET: 'a'.repeat(64), UPLOAD_DIR: path.join(root, '.deploy-test', 'uploads'),
    FRONTEND_URL: 'https://example.invalid', SERVE_FRONTEND: 'false', DB_SSL: 'false' };
function validate(overrides = {}) {
    return spawnSync(process.execPath, ['-e', "require('./config').validateProduction()"],
        { cwd: root, env: { ...base, ...overrides }, encoding: 'utf8', windowsHide: true });
}
test('valid production configuration starts validation', () => assert.equal(validate().status, 0));
test('production rejects weak or sample signing secrets', () => {
    for (const JWT_SECRET of ['short', 'REPLACE_ME_WITH_A_UNIQUE_RANDOM_SECRET']) assert.notEqual(validate({ JWT_SECRET }).status, 0);
});
test('production requires explicit persistent absolute upload directory', () => assert.notEqual(validate({ UPLOAD_DIR: 'uploads' }).status, 0));
test('production rejects insecure external origins and origins containing paths', () => {
    for (const FRONTEND_URL of ['http://example.invalid', 'https://example.invalid/login']) assert.notEqual(validate({ FRONTEND_URL }).status, 0);
});
test('local production verification is supported', () => assert.equal(validate({ FRONTEND_URL: 'http://127.0.0.1:5101' }).status, 0));
test('production serving refuses a missing frontend artifact', () => assert.notEqual(validate({ SERVE_FRONTEND: 'true', FRONTEND_DIST_DIR: path.join(root, '.deploy-test', 'missing-dist') }).status, 0));
test('development does not require production configuration', () => assert.equal(validate({ NODE_ENV: 'development', JWT_SECRET: 'dev', UPLOAD_DIR: 'uploads' }).status, 0));
test('cloud production requires a backend storage key', () => assert.notEqual(validate({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '' }).status, 0));
