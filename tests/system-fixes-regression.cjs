// Synthetic fixtures only; run via test:deploy/test:cloud for an isolated database schema.
const fs = require('node:fs');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const pool = new Pool(require('../config').databaseOptions);
const stamp = Date.now(), results = [], ownedItems = [];
const password = 'QaFixes123!';
let lender;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function call(endpoint, method = 'GET', body, token) {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const r = await fetch((process.env.TEST_API_URL || 'http://localhost:5000/api') + endpoint, {
        method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    return { status: r.status, data: await r.json() };
}
function check(name, actual, expected) {
    const pass = actual === expected; results.push({ name, actual, expected, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}`);
}
function registration(label, extra = {}) { return { full_name: 'QA FIXES', email: `qa.fixes.${label}.${stamp}@example.invalid`, password, ...extra }; }
async function account(label, extra = {}) {
    const body = registration(label, extra);
    const registered = await call('/auth/register', 'POST', body);
    if (registered.status !== 201) throw new Error('QA registration failed: ' + label);
    const login = await call('/auth/login', 'POST', { email: body.email, password: body.password });
    if (login.status !== 200) throw new Error('QA login failed: ' + label);
    return { id: login.data.data.id, token: login.data.token, email: body.email };
}
function slip(contents = png, mimetype = 'image/png') {
    const form = new FormData(); form.set('slip', new Blob([contents], { type: mimetype }), 'QA.png'); return form;
}
async function main() {
    for (const [label, extra] of [
        ['empty', { password: '' }], ['short', { password: 'abc' }], ['missing', { password: undefined }],
        ['invalid-email', { email: 'not-an-email' }], ['blank-name', { full_name: ' ' }],
        ['long', { password: 'a'.repeat(73) }], ['unicode-long', { password: 'ก'.repeat(25) }],
        ['bad-location', { latitude: 91, longitude: 100 }], ['partial-location', { latitude: 12 }],
        ['bad-address', { address: {} }],
    ]) check('reject invalid registration ' + label, (await call('/auth/register', 'POST', registration(label, extra))).status, 400);
    check('reject overlong login before bcrypt truncation', (await call('/auth/login', 'POST', { email: registration('long').email, password: 'a'.repeat(72) + 'B' })).status, 400);
    const utf = await account('unicode-limit', { password: 'ก'.repeat(24) });
    check('72 UTF-8 byte password remains usable', !!utf.token, true);
    lender = await account('owner', { address: 'QA SYNTHETIC ADDRESS', latitude: 0, longitude: 100.1234567 });
    const profile = (await call('/auth/me', 'GET', undefined, lender.token)).data.data;
    check('address persists privately', profile.address, 'QA SYNTHETIC ADDRESS');
    check('zero latitude persists', Number(profile.latitude), 0);
    check('longitude persists', Number(profile.longitude), 100.1234567);
    const upper = await call('/auth/login', 'POST', { email: '  ' + lender.email.toUpperCase() + '  ', password });
    check('email case and whitespace login', upper.status, 200);
    check('normalized login returns original account', upper.data.data?.id, lender.id);
    check('case-variant duplicate registration rejected', (await call('/auth/register', 'POST', registration('owner', { email: lender.email.toUpperCase() }))).status, 400);
    const raceEmail = registration('race').email;
    const race = await Promise.all([call('/auth/register', 'POST', registration('race')), call('/auth/register', 'POST', registration('race', { email: raceEmail.toUpperCase() }))]);
    check('concurrent case-variant signup creates one account', race.filter(r => r.status === 201).length, 1);
    check('concurrent duplicate gets validation response', race.filter(r => r.status === 400).length, 1);
    const legacy = await account('legacy');
    await pool.query('UPDATE users SET email=$1 WHERE user_id=$2', [legacy.email.toUpperCase(), legacy.id]);
    check('legacy uppercase account accessible with lowercase email', (await call('/auth/login', 'POST', { email: legacy.email, password })).data.data?.id, legacy.id);
    const second = await pool.query(`INSERT INTO users (email,full_name,password_hash) VALUES ($1,'QA LEGACY SECOND',$2) RETURNING user_id`, [legacy.email, await bcrypt.hash('QaSecond123!', 10)]);
    check('legacy exact uppercase account remains distinct', (await call('/auth/login', 'POST', { email: legacy.email.toUpperCase(), password })).data.data?.id, legacy.id);
    check('legacy exact lowercase account remains distinct', (await call('/auth/login', 'POST', { email: legacy.email, password: 'QaSecond123!' })).data.data?.id, second.rows[0].user_id);
    check('ambiguous legacy case cannot select an arbitrary account', (await call('/auth/login', 'POST', { email: 'Qa.' + legacy.email.slice(3), password })).status, 400);
    const migrationClient = await pool.connect();
    try {
        await migrationClient.query('BEGIN');
        await migrationClient.query("CREATE TEMP TABLE users (full_name text); INSERT INTO users VALUES ('QA EXISTING')");
        await require('../scripts/migrate-profile.cjs')(migrationClient);
        await require('../scripts/migrate-profile.cjs')(migrationClient);
        const preserved = (await migrationClient.query('SELECT full_name,address,latitude,longitude FROM users')).rows[0];
        check('additive migration preserves existing records and is repeatable', preserved.full_name === 'QA EXISTING' && preserved.address === null, true);
    } finally { await migrationClient.query('ROLLBACK'); migrationClient.release(); }
    const borrower = await account('borrower');
    const form = new FormData(); for (let i = 0; i < 2; i++) form.append('images', new Blob([png], { type: 'image/png' }), 'QA.png');
    const uploaded = await call('/upload/item-images', 'POST', form, lender.token);
    const category = (await call('/categories')).data[0].category_id;
    const item = await call('/items', 'POST', { title: 'QA FIXES MULTI ' + stamp, category_id: category, daily_price: 100, description: 'QA', conditions: 'QA', images: uploaded.data.images }, lender.token);
    const itemId = item.data.data.item_id; ownedItems.push(itemId);
    const detail = (await call('/items/' + itemId)).data;
    check('all uploaded images returned by detail endpoint', detail.images.length, 2);
    check('second image address preserved', detail.images[1], uploaded.data.images[1]);
    await call('/bank-accounts/me', 'PUT', { bank_name: 'QA ONLY', account_name: 'QA ONLY', account_number: '0000000000' }, lender.token);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));
    const request = async () => (await call('/rentals', 'POST', { item_id: itemId, start_date: day, end_date: day, agreement_accepted: true }, borrower.token)).data.data.rental_id;
    const pending = await request();
    check('pending rental cannot accept rent slip', (await call(`/rental-payments/${pending}/slip`, 'POST', slip(), borrower.token)).status, 409);
    await call(`/rentals/${pending}/status`, 'PATCH', { status: 'rejected' }, lender.token);
    check('rejected rental cannot accept rent slip', (await call(`/rental-payments/${pending}/slip`, 'POST', slip(), borrower.token)).status, 409);
    const approved = await request();
    await call('/agreements', 'POST', { rental_id: approved }, lender.token);
    check('valid rental approval still works', (await call(`/rentals/${approved}/status`, 'PATCH', { status: 'approved' }, lender.token)).status, 200);
    check('fake PNG slip rejected', (await call(`/rental-payments/${approved}/slip`, 'POST', slip(Buffer.from('NOT PNG')), borrower.token)).status, 400);
    check('PNG disguised as JPEG rejected', (await call(`/rental-payments/${approved}/slip`, 'POST', slip(png, 'image/jpeg'), borrower.token)).status, 400);
    check('fake fine slip rejected', (await call(`/rental-payments/${approved}/fine-slip`, 'POST', slip(Buffer.from('NOT PNG')), borrower.token)).status, 400);
    const slips = await Promise.all([call(`/rental-payments/${approved}/slip`, 'POST', slip(), borrower.token), call(`/rental-payments/${approved}/slip`, 'POST', slip(), borrower.token)]);
    check('only one concurrent rent slip accepted', slips.filter(r => r.status === 201).length, 1);
    check('duplicate concurrent rent slip rejected', slips.filter(r => r.status === 409).length, 1);
    const paymentId = slips.find(r => r.status === 201)?.data.data.payment_id;
    if (!paymentId) throw new Error('Missing QA payment');
    // Emulate a legacy rejected rental with a submitted slip, only in this new QA fixture.
    await pool.query("UPDATE rentals SET status='rejected' WHERE rental_id=$1 AND borrower_id=$2", [approved, borrower.id]);
    check('cannot verify legacy slip on rejected rental', (await call(`/rental-payments/${paymentId}/verify`, 'PATCH', { action: 'verify' }, lender.token)).status, 409);
    const state = (await call('/rentals/' + approved, 'GET', undefined, borrower.token)).data.data;
    check('failed verification preserves unpaid status', state.payment_status, 'pending');
    check('owner can reject stale slip safely', (await call(`/rental-payments/${paymentId}/verify`, 'PATCH', { action: 'reject', rejection_reason: 'QA TEST' }, lender.token)).status, 200);
    check('malformed rental ID returns validation error', (await call('/rentals/not-a-uuid', 'GET', undefined, borrower.token)).status, 400);
}
main().catch(error => { console.error(error.message); results.push({ name: error.message, pass: false }); }).finally(async () => {
    if (lender) for (const id of ownedItems) await call('/items/' + id + '/status', 'PATCH', { status: 'inactive' }, lender.token).catch(() => {});
    fs.writeFileSync('system-fixes-regression-result.json', JSON.stringify({ stamp, results }, null, 2));
    await pool.end(); if (results.some(r => !r.pass)) process.exitCode = 1;
});
