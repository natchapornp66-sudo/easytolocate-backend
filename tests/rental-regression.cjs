// Run against the local API only. Creates QA accounts/items; never transfers money.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = (process.env.TEST_API_URL || 'http://localhost:5000/api');
const stamp = Date.now();
const results = [];
let lender, borrower, outsider, item;
async function call(endpoint, method = 'GET', body, user) {
    const headers = user ? { Authorization: `Bearer ${user.token}` } : {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + endpoint, {
        method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : await response.arrayBuffer();
    return { status: response.status, data };
}
function check(name, actual, expected) {
    const pass = actual === expected;
    results.push({ name, actual, expected, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}`);
    assert.equal(actual, expected, name);
}
async function account(role) {
    const credentials = { email: `qa.fix.${role}.${stamp}@example.invalid`, password: `QaFix-${stamp}!` };
    const registered = await call('/auth/register', 'POST', { ...credentials, full_name: `QA FIX ${role} ${stamp}` });
    check(`register ${role}`, registered.status, 201);
    const login = await call('/auth/login', 'POST', credentials);
    check(`login ${role}`, login.status, 200);
    return { id: login.data.data.id, token: login.data.token };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function image(field, mode) {
    const form = new FormData();
    if (mode) form.set('mode', mode);
    form.set(field, new Blob([png], { type: 'image/png' }), 'QA-NO-REAL-PAYMENT.png');
    return form;
}
function dates(offset = 0) {
    const date = new Date(Date.now() + offset * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
async function request(start = dates(1), end = dates(2)) {
    return call('/rentals', 'POST', { item_id: item, start_date: start, end_date: end, agreement_accepted: true }, borrower);
}
async function update(id, status, user = lender, extra = {}) {
    return call(`/rentals/${id}/status`, 'PATCH', { status, ...extra }, user);
}
async function cycle(id, fine = false) {
    const slip = await call(`/rental-payments/${id}/slip`, 'POST', image('slip'), borrower);
    check('upload rental slip', slip.status, 201);
    check('borrower cannot verify own slip', (await call(`/rental-payments/${slip.data.data.payment_id}/verify`, 'PATCH', { action: 'verify' }, borrower)).status, 403);
    check('verify rental slip', (await call(`/rental-payments/${slip.data.data.payment_id}/verify`, 'PATCH', { action: 'verify' }, lender)).status, 200);
    check('cannot receive without handover photo', (await call(`/rentals/${id}/confirm-receipt`, 'PATCH', {}, borrower)).status, 400);
    const photo = await call(`/rentals/${id}/photos`, 'POST', image('photos', 'lenderBefore'), lender);
    check('upload handover photo', photo.status, 200);
    const filename = photo.data.image_urls[0].split('/').pop();
    const route = `/rentals/${id}/photo-file/${filename}`;
    check('lender can read photo', (await call(route, 'GET', undefined, lender)).status, 200);
    check('borrower can read photo', (await call(route, 'GET', undefined, borrower)).status, 200);
    check('anonymous cannot read photo', (await call(route)).status, 401);
    check('outsider cannot read photo', (await call(route, 'GET', undefined, outsider)).status, 403);
    check('photo cannot be read under wrong rental', (await call(`/rentals/${crypto.randomUUID()}/photo-file/${filename}`, 'GET', undefined, borrower)).status, 403);
    check('confirm receipt', (await call(`/rentals/${id}/confirm-receipt`, 'PATCH', {}, borrower)).status, 200);
    check('upload before-use photo', (await call(`/rentals/${id}/photos`, 'POST', image('photos', 'beforeUse'), borrower)).status, 200);
    check('return requires after-use photo', (await update(id, 'return_requested', borrower)).status, 400);
    check('upload after-use photo', (await call(`/rentals/${id}/photos`, 'POST', image('photos', 'afterUse'), borrower)).status, 200);
    check('request return', (await update(id, 'return_requested', borrower)).status, 200);
    check('start inspection', (await update(id, 'inspection_pending')).status, 200);
    if (fine) {
        check('set fine', (await update(id, 'fine_pending', lender, { fine_amount: 50, fine_reason: 'QA test only' })).status, 200);
        check('accept fine', (await call(`/rentals/${id}/fine/confirm`, 'PATCH', {}, borrower)).status, 200);
        const fineSlip = await call(`/rental-payments/${id}/fine-slip`, 'POST', image('slip'), borrower);
        check('upload fine slip', fineSlip.status, 201);
        check('verify fine', (await call(`/rental-payments/${fineSlip.data.data.payment_id}/verify`, 'PATCH', { action: 'verify' }, lender)).status, 200);
        const payments = await call(`/rental-payments/${id}`, 'GET', undefined, borrower);
        check('fine payment persisted', payments.data.data.find(p => p.payment_type === 'fine').status, 'verified');
    } else check('complete rental', (await update(id, 'completed')).status, 200);
    const final = await call(`/rentals/${id}`, 'GET', undefined, borrower);
    check('final status', final.data.data.status, 'completed');
    check('final rent payment', final.data.data.payment_status, 'paid');
}
async function main() {
    check('anonymous chat blocked', (await call('/chats')).status, 401);
    lender = await account('lender'); borrower = await account('borrower'); outsider = await account('outsider');
    const cats = await call('/categories');
    const upload = await call('/upload/item-images', 'POST', image('images'), lender);
    check('upload item image', upload.status, 201);
    const created = await call('/items', 'POST', { category_id: cats.data[0].category_id, title: `QA FIX ${stamp}`, description: 'QA only', conditions: 'No real rental', daily_price: 100, images: upload.data.images }, lender);
    check('create item', created.status, 201); item = created.data.data.item_id;
    check('bank account', (await call('/bank-accounts/me', 'PUT', { bank_name: 'QA TEST', account_name: 'QA TEST', account_number: '0000000000' }, lender)).status, 200);
    check('past date blocked', (await request('2020-01-01', '2020-01-02')).status, 400);
    check('invalid date blocked', (await request('2026-02-30', '2026-03-01')).status, 400);
    const first = await request(); const second = await request();
    check('first pending request', first.status, 201); check('second pending request', second.status, 201);
    const ids = [first.data.data.rental_id, second.data.data.rental_id];
    check('approval requires agreement', (await update(ids[0], 'approved')).status, 400);
    for (const id of ids) check('lender signs', (await call('/agreements', 'POST', { rental_id: id }, lender)).status, 200);
    const approvals = await Promise.all(ids.map(id => update(id, 'approved')));
    check('one concurrent approval wins', approvals.filter(r => r.status === 200).length, 1);
    check('other concurrent approval blocked', approvals.filter(r => r.status === 409).length, 1);
    check('new overlapping request blocked', (await request()).status, 409);
    const winner = ids[approvals.findIndex(r => r.status === 200)];
    const loser = ids.find(id => id !== winner);
    const nonoverlap = await request(dates(3), dates(4));
    check('nonoverlapping request allowed', nonoverlap.status, 201);
    check('reject spare request', (await update(nonoverlap.data.data.rental_id, 'rejected')).status, 200);
    await cycle(winner);
    check('approve after previous rental completed', (await update(loser, 'approved')).status, 200);
    await cycle(loser, true);
    const review = new FormData(); review.set('rental_id', winner); review.set('rating', '5'); review.set('comment', 'QA regression test only');
    check('review completed rental', (await call('/reviews', 'POST', review, borrower)).status, 201);
    check('duplicate review blocked', (await call('/reviews', 'POST', review, borrower)).status, 409);
    check('send authenticated chat', (await call(`/chats/${lender.id}/messages`, 'POST', { message: 'QA regression message', rental_id: winner }, borrower)).status, 201);
    const chatPath = `/chats/${lender.id}/messages?userId=${borrower.id}`;
    check('anonymous cannot read existing chat', (await call(chatPath)).status, 401);
    check('outsider cannot spoof chat reader', (await call(chatPath, 'GET', undefined, outsider)).status, 403);
    check('cannot spoof sender', (await call(`/chats/${lender.id}/messages`, 'POST', { sender_id: outsider.id, message: 'QA spoof' }, borrower)).status, 403);
    check('cannot attach another rental', (await call(`/chats/${lender.id}/messages`, 'POST', { message: 'QA unrelated', rental_id: winner }, outsider)).status, 403);
    const history = await call(chatPath, 'GET', undefined, borrower);
    check('participant reads own history', history.status, 200);
    check('message persisted', history.data.data[0].message, 'QA regression message');
    check('chat list without legacy userId', (await call('/chats', 'GET', undefined, borrower)).status, 200);
    check('bank account in chat still works', (await call(`/chats/${lender.id}/bank-account`, 'GET', undefined, borrower)).status, 200);
    check('notifications still work', (await call('/notifications', 'GET', undefined, borrower)).status, 200);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
    if (item && lender) {
        try { check('close QA listing', (await call(`/items/${item}/status`, 'PATCH', { status: 'inactive' }, lender)).status, 200); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
    fs.writeFileSync('rental-regression-result.json', JSON.stringify({ stamp, item, results }, null, 2));
});
