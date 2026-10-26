// Only creates and modifies QA fixtures. No real transfers or existing admin credentials.
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('node:fs');
const pool = new Pool(require('../config').databaseOptions);
const stamp = Date.now();
const results = [], items = [], disputes = [];
let admin, lender, borrower, outsider;
const uiMode = process.argv.includes('--ui');
async function call(url, method = 'GET', body, user) {
    const headers = user ? { Authorization: `Bearer ${user.token}` } : {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const r = await fetch((process.env.TEST_API_URL || 'http://localhost:5000/api') + url, { method, headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000) });
    const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, data };
}
function check(name, actual, expected) {
    const pass = actual === expected; results.push({ name, actual, expected, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}`);
}
async function account(role) {
    const credentials = { email: `qa.dispute.${role}.${stamp}@example.invalid`, password: `QaDispute-${stamp}!` };
    const created = await call('/auth/register', 'POST', { ...credentials, full_name: `QA DISPUTE ${role} ${stamp}` });
    if (created.status !== 201) throw new Error('Fixture registration failed');
    const login = await call('/auth/login', 'POST', credentials);
    return { id: login.data.data.id, token: login.data.token, email: credentials.email };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function image(field = 'photos', mode, count = 1, invalid = false) {
    const f = new FormData(); if (mode) f.set('mode', mode);
    for (let i = 0; i < count; i++) f.append(field, new Blob([invalid ? Buffer.from('not a png') : png], { type: 'image/png' }), 'QA-ONLY.png');
    return f;
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
async function update(id, status, user = lender, extra = {}) {
    return call(`/rentals/${id}/status`, 'PATCH', { status, ...extra }, user);
}
async function rental(label, fine = false, paidFine = false) {
    const category = (await call('/categories')).data[0].category_id;
    const it = await call('/items', 'POST', { category_id: category, title: `QA DISPUTE ${label} ${stamp}`, description: 'QA only', conditions: 'No real transfer', daily_price: 100, images: [] }, lender);
    if (it.status !== 201) throw new Error('Fixture item failed');
    const item = it.data.data.item_id; items.push(item);
    const r = await call('/rentals', 'POST', { item_id: item, start_date: today(), end_date: today(), agreement_accepted: true }, borrower);
    if (r.status !== 201) throw new Error('Fixture rental failed: ' + JSON.stringify(r.data));
    const id = r.data.data.rental_id;
    if (fine) {
        await call('/agreements', 'POST', { rental_id: id }, lender);
        await update(id, 'approved');
        const p = await call(`/rental-payments/${id}/slip`, 'POST', image('slip'), borrower);
        await call(`/rental-payments/${p.data.data.payment_id}/verify`, 'PATCH', { action: 'verify' }, lender);
        await call(`/rentals/${id}/photos`, 'POST', image('photos', 'lenderBefore'), lender);
        await call(`/rentals/${id}/confirm-receipt`, 'PATCH', {}, borrower);
        await call(`/rentals/${id}/photos`, 'POST', image('photos', 'beforeUse'), borrower);
        await call(`/rentals/${id}/photos`, 'POST', image('photos', 'afterUse'), borrower);
        await update(id, 'return_requested', borrower); await update(id, 'inspection_pending');
        await update(id, 'fine_pending', lender, { fine_amount: 100, fine_reason: 'QA damage simulation only' });
        if (paidFine) await payFine(id);
    }
    return { id, item };
}
async function payFine(id) {
    await call(`/rentals/${id}/fine/confirm`, 'PATCH', {}, borrower);
    const p = await call(`/rental-payments/${id}/fine-slip`, 'POST', image('slip'), borrower);
    if (p.status !== 201) throw new Error('Fine fixture failed: ' + JSON.stringify(p.data));
    return call(`/rental-payments/${p.data.data.payment_id}/verify`, 'PATCH', { action: 'verify' }, lender);
}
async function dispute(id, category = 'fine') {
    const r = await call('/disputes', 'POST', { rental_id: id, category, reason: 'QA dispute regression test only' }, borrower);
    if (r.status !== 201) throw new Error('Create dispute failed: ' + JSON.stringify(r.data));
    disputes.push(r.data.data.dispute_id); return r.data.data.dispute_id;
}
async function resolve(id, decision, amount, user = admin) {
    return call(`/admin/disputes/${id}/resolve`, 'PATCH', { decision, decision_reason: 'QA decision for simulated rental only', adjusted_fine_amount: amount }, user);
}
async function main() {
    check('anonymous admin blocked', (await call('/admin/summary')).status, 401);
    check('anonymous disputes blocked', (await call('/disputes')).status, 401);
    admin = await account('admin'); lender = await account('lender'); borrower = await account('borrower'); outsider = await account('outsider');
    await call('/bank-accounts/me', 'PUT', { bank_name: 'QA TEST', account_name: 'QA TEST ONLY', account_number: '0000000000' }, lender);
    // Explicitly scoped to this newly registered disposable fixture. Always revoked below.
    await pool.query("UPDATE users SET role = 'admin' WHERE user_id = $1 AND email = $2", [admin.id, admin.email]);
    for (const endpoint of ['/me', '/summary', '/users', '/items', '/rentals', '/disputes']) {
        check('admin reads ' + endpoint, (await call('/admin' + endpoint, 'GET', undefined, admin)).status, 200);
        check('user blocked from ' + endpoint, (await call('/admin' + endpoint, 'GET', undefined, borrower)).status, 403);
    }
    check('suspend QA user', (await call(`/admin/users/${outsider.id}/status`, 'PATCH', { status: 'suspended' }, admin)).status, 200);
    check('suspended existing token blocked', (await call('/disputes', 'GET', undefined, outsider)).status, 403);
    check('restore QA user', (await call(`/admin/users/${outsider.id}/status`, 'PATCH', { status: 'active' }, admin)).status, 200);
    check('admin cannot suspend self', (await call(`/admin/users/${admin.id}/status`, 'PATCH', { status: 'suspended' }, admin)).status, 403);
    check('malformed admin user ID', (await call('/admin/users/not-a-uuid/status', 'PATCH', { status: 'suspended' }, admin)).status, 400);
    const general = await rental('general');
    check('hide QA item', (await call(`/admin/items/${general.item}/status`, 'PATCH', { status: 'hidden' }, admin)).status, 200);
    check('hidden item not publicly readable', (await call(`/items/${general.item}`)).status, 404);
    check('owner cannot unhide moderated item', (await call(`/items/${general.item}/status`, 'PATCH', { status: 'active' }, lender)).status, 403);
    await call(`/admin/items/${general.item}/status`, 'PATCH', { status: 'active' }, admin);
    check('restore QA item', (await call(`/items/${general.item}`)).status, 200);
    check('malformed admin item ID', (await call('/admin/items/not-a-uuid/status', 'PATCH', { status: 'hidden' }, admin)).status, 400);
    check('fine dispute without fine rejected', (await call('/disputes', 'POST', { rental_id: general.id, category: 'fine', reason: 'QA invalid fine dispute only' }, borrower)).status, 400);
    // Resolve any unsupported fine dispute accidentally accepted by the old implementation.
    const prior = await call('/disputes', 'GET', undefined, borrower);
    for (const d of prior.data.data.filter(d => d.rental_id === general.id && d.status === 'open')) await resolve(d.dispute_id, 'general');
    const g = await dispute(general.id, 'other');
    check('duplicate dispute rejected', (await call('/disputes', 'POST', { rental_id: general.id, category: 'other', reason: 'QA duplicate request only' }, lender)).status, 409);
    check('outsider cannot open dispute', (await call('/disputes', 'POST', { rental_id: general.id, category: 'other', reason: 'QA unauthorized request only' }, outsider)).status, 403);
    for (const user of [borrower, lender]) {
        check('participant reads dispute', (await call(`/disputes/${g}`, 'GET', undefined, user)).status, 200);
        check('participant sends explanation', (await call(`/disputes/${g}/messages`, 'POST', { message: 'QA explanation from participant only' }, user)).status, 201);
        const ev = await call(`/disputes/${g}/evidence`, 'POST', image(), user);
        check('participant uploads evidence', ev.status, 201);
        check('participant opens evidence', (await call(`/disputes/${g}/evidence/${ev.data.data[0].evidence_id}/file`, 'GET', undefined, user)).status, 200);
        check('outsider denied evidence', (await call(`/disputes/${g}/evidence/${ev.data.data[0].evidence_id}/file`, 'GET', undefined, outsider)).status, 403);
        check('admin opens evidence', (await call(`/disputes/${g}/evidence/${ev.data.data[0].evidence_id}/file`, 'GET', undefined, admin)).status, 200);
    }
    check('fake PNG rejected', (await call(`/disputes/${g}/evidence`, 'POST', image('photos', undefined, 1, true), borrower)).status, 400);
    check('evidence count limit', (await call(`/disputes/${g}/evidence`, 'POST', image('photos', undefined, 5), borrower)).status, 400);
    check('admin reads explanations', (await call(`/admin/disputes/${g}/messages`, 'GET', undefined, admin)).data.data.length, 2);
    check('admin reads combined evidence', (await call(`/admin/disputes/${g}/evidence`, 'GET', undefined, admin)).status, 200);
    check('ordinary user cannot decide', (await resolve(g, 'general', undefined, borrower)).status, 403);
    check('resolve general', (await resolve(g, 'general')).status, 200);
    const decidedList = await call('/admin/disputes', 'GET', undefined, admin);
    const decided = decidedList.data.data.find(d => d.dispute_id === g);
    check('admin history includes decision', decided?.decision, 'general');
    check('admin history includes decision reason', decided?.decision_reason, 'QA decision for simulated rental only');
    check('repeat decision blocked', (await resolve(g, 'general')).status, 409);
    check('closed evidence blocked', (await call(`/disputes/${g}/evidence`, 'POST', image(), borrower)).status, 409);
    check('closed explanation blocked', (await call(`/disputes/${g}/messages`, 'POST', { message: 'QA closed explanation only' }, borrower)).status, 403);
    await update(general.id, 'rejected');
    for (const mode of ['waive-unpaid', 'adjust-unpaid', 'uphold-unpaid', 'adjust-paid', 'waive-paid']) {
        const r = await rental(mode, true, mode.endsWith('-paid'));
        const d = await dispute(r.id);
        check('payment blocked during dispute', (await call(`/rental-payments/${r.id}/fine-slip`, 'POST', image('slip'), borrower)).status, 409);
        const evidence = await call(`/admin/disputes/${d}/evidence`, 'GET', undefined, admin);
        check('three inspection sets available', evidence.data.data.inspections.length, 3);
        const filename = evidence.data.data.inspections[0].photo_urls[0].split('/').pop();
        check('admin opens inspection image', (await call(`/admin/disputes/${d}/inspection-image/${filename}`, 'GET', undefined, admin)).status, 200);
        const decision = mode.split('-')[0];
        if (decision === 'adjust') check('reject invalid adjusted fine', (await resolve(d, 'adjust', 100.01)).status, 400);
        check('resolve ' + mode, (await resolve(d, decision, 40)).status, 200);
        const final = await call(`/rentals/${r.id}`, 'GET', undefined, borrower);
        if (mode === 'waive-unpaid') check('waived unpaid rental completes', final.data.data.status, 'completed');
        if (mode.endsWith('-paid')) {
            check('paid rental remains completed', final.data.data.status, 'completed');
            const refunds = await call('/disputes/refunds', 'GET', undefined, borrower);
            const refund = refunds.data.data.find(f => f.dispute_id === d);
            check('refund difference ' + mode, Number(refund?.refund_amount), decision === 'adjust' ? 60 : 100);
            check('refund remains pending (no real transfer)', refund?.status, 'pending');
        } else if (decision !== 'waive') check('pay corrected fine ' + mode, (await payFine(r.id)).status, 200);
    }
    if (uiMode) {
        console.log(`UI fixture email: ${admin.email}`);
        console.log(`UI fixture stamp: ${stamp}`);
        fs.writeFileSync('dispute-ui-fixture.json', JSON.stringify({ stamp, adminEmail: admin.email, disputes }, null, 2));
        console.log('Waiting for UI verification; send done to revoke the QA admin role.');
        await new Promise(resolve => {
            const timer = setTimeout(() => { process.stdin.pause(); resolve(); }, 600000);
            process.stdin.once('data', () => { clearTimeout(timer); process.stdin.pause(); resolve(); });
        });
    }
}
main().catch(e => { console.error(e.stack); results.push({ name: 'unexpected failure', pass: false, error: e.message }); }).finally(async () => {
    if (admin) {
        await pool.query("UPDATE users SET role = 'user' WHERE user_id = $1 AND email = $2", [admin.id, admin.email]);
        console.log('QA admin role revoked');
    }
    if (lender) for (const id of items) await call(`/items/${id}/status`, 'PATCH', { status: 'inactive' }, lender);
    fs.writeFileSync('dispute-admin-regression-result.json', JSON.stringify({ stamp, items, disputes, results }, null, 2));
    await pool.end();
    if (results.some(r => !r.pass)) process.exitCode = 1;
});
