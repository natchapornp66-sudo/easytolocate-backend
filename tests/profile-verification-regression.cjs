require('dotenv').config();
const { Pool } = require('pg');
const fs = require('node:fs');
const pool = new Pool(require('../config').databaseOptions);
const stamp = Date.now(), results = [];
let owner, other, admin;
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
    const email = `qa.profile.${role}.${stamp}@example.invalid`, password = `QaProfile-${stamp}!`;
    const r = await call('/auth/register', 'POST', { email, password, full_name: `QA PROFILE ${role}`, phone_number: '0000000000' });
    if (r.status !== 201) throw new Error('Fixture registration failed');
    const login = await call('/auth/login', 'POST', { email, password });
    return { id: login.data.data.id, token: login.data.token, email };
}
function form(invalid = false) {
    const f = new FormData();
    // Synthetic checksum-valid test identifier. Never use actual identity documents.
    const prefix = '000000000001';
    const sum = [...prefix].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
    f.set('id_card_number', prefix + ((11 - sum % 11) % 10));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    for (const key of ['id_card_image', 'selfie_image']) f.set(key, new Blob([invalid ? Buffer.from('not png') : png], { type: 'image/png' }), 'QA-FAKE-DOCUMENT.png');
    return f;
}
async function main() {
    owner = await account('owner'); other = await account('other'); admin = await account('admin');
    await pool.query('UPDATE users SET role=$1 WHERE user_id=$2 AND email=$3', ['admin', admin.id, admin.email]);
    check('profile requires login', (await call('/auth/me')).status, 401);
    const profile = await call('/auth/me', 'GET', undefined, owner);
    check('read own profile', profile.status, 200);
    if (profile.status === 200) {
        check('profile belongs to token', profile.data.data.user_id, owner.id);
        check('no fabricated transactions', Number(profile.data.data.completed_count), 0);
        check('no fabricated reviews', profile.data.data.reviews.length, 0);
        check('no password hash returned', 'password_hash' in profile.data.data, false);
    }
    check('update own name and phone', (await call('/auth/me', 'PATCH', { full_name: 'QA PROFILE UPDATED', phone_number: '0000000001' }, owner)).status, 200);
    const savedProfile = await call('/auth/me', 'GET', undefined, owner);
    check('updated name persists', savedProfile.data?.data?.full_name, 'QA PROFILE UPDATED');
    check('updated phone persists', savedProfile.data?.data?.phone_number, '0000000001');
    check('blank name rejected', (await call('/auth/me', 'PATCH', { full_name: ' ', phone_number: '0000000001' }, owner)).status, 400);
    check('invalid phone rejected', (await call('/auth/me', 'PATCH', { full_name: 'QA', phone_number: 'abc' }, owner)).status, 400);
    check('cannot modify privileged fields', (await call('/auth/me', 'PATCH', { full_name: 'QA', phone_number: '', role: 'admin', trust_score: 5 }, owner)).status, 400);
    check('other profile stays unchanged', (await call('/auth/me', 'GET', undefined, other)).data?.data?.full_name, 'QA PROFILE other');
    check('anonymous cannot read verification', (await call(`/verifications/user/${owner.id}`)).status, 401);
    check('other cannot read verification', (await call(`/verifications/user/${owner.id}`, 'GET', undefined, other)).status, 403);
    check('anonymous cannot submit verification', (await call('/verifications', 'POST', form())).status, 401);
    const badNumber = form(); badNumber.set('id_card_number', '0000000000010');
    check('invalid ID checksum rejected', (await call('/verifications', 'POST', badNumber, owner)).status, 400);
    check('fake image content rejected', (await call('/verifications', 'POST', form(true), owner)).status, 400);
    const spoof = form(); spoof.set('user_id', other.id);
    check('cannot submit for someone else', (await call('/verifications', 'POST', spoof, owner)).status, 403);
    const submitted = await call('/verifications', 'POST', form(), owner);
    check('submit real multipart test files', submitted.status, 201);
    if (submitted.status === 201) {
        const id = submitted.data.data.verification_id;
        check('pending status', submitted.data.data.status, 'pending');
        check('full ID not returned', 'id_card_number' in submitted.data.data, false);
        check('duplicate pending blocked', (await call('/verifications', 'POST', form(), owner)).status, 409);
        for (const type of ['id-card', 'selfie']) {
            const url = `/verifications/${id}/files/${type}`;
            check('owner reads private ' + type, (await call(url, 'GET', undefined, owner)).status, 200);
            check('other denied private ' + type, (await call(url, 'GET', undefined, other)).status, 403);
            check('anonymous denied private ' + type, (await call(url)).status, 401);
            check('admin reads private ' + type, (await call(url, 'GET', undefined, admin)).status, 200);
        }
        check('normal user cannot list KYC queue', (await call('/verifications/admin', 'GET', undefined, owner)).status, 403);
        check('admin lists KYC queue', (await call('/verifications/admin', 'GET', undefined, admin)).status, 200);
        check('user cannot self approve', (await call(`/verifications/${id}/review`, 'PATCH', { status: 'approved' }, owner)).status, 403);
        check('admin rejects test submission', (await call(`/verifications/${id}/review`, 'PATCH', { status: 'rejected' }, admin)).status, 200);
        check('review cannot be repeated', (await call(`/verifications/${id}/review`, 'PATCH', { status: 'approved' }, admin)).status, 409);
        const retry = await call('/verifications', 'POST', form(), owner);
        check('resubmit after rejection', retry.status, 201);
        if (retry.status === 201) {
            check('admin approves test submission', (await call(`/verifications/${retry.data.data.verification_id}/review`, 'PATCH', { status: 'approved' }, admin)).status, 200);
            const status = await call(`/verifications/user/${owner.id}`, 'GET', undefined, owner);
            check('approval persists', status.data.data.status, 'approved');
            check('verified timestamp set', !!status.data.data.verified_at, true);
            check('approved account cannot resubmit', (await call('/verifications', 'POST', form(), owner)).status, 409);
        }
    }
    check('notifications require login', (await call('/notifications')).status, 401);
    const n = await pool.query('INSERT INTO notifications (user_id,title,message,type) VALUES ($1,$2,$3,$4) RETURNING notification_id', [owner.id, 'QA profile notification', 'QA fixture only', 'system']);
    const nid = n.rows[0].notification_id;
    check('other cannot mark notification read', (await call(`/notifications/${nid}/read`, 'PATCH', {}, other)).status, 404);
    check('malformed notification ID rejected', (await call('/notifications/not-a-uuid/read', 'PATCH', {}, owner)).status, 400);
    const before = await call('/notifications', 'GET', undefined, owner);
    check('new notification unread', before.data.data.find(n => n.notification_id === nid)?.is_read, false);
    check('mark read', (await call(`/notifications/${nid}/read`, 'PATCH', {}, owner)).status, 200);
    check('mark read idempotent', (await call(`/notifications/${nid}/read`, 'PATCH', {}, owner)).status, 200);
    const after = await call('/notifications', 'GET', undefined, owner);
    check('read status persists', after.data.data.find(n => n.notification_id === nid)?.is_read, true);
    const others = await call('/notifications', 'GET', undefined, other);
    check('notification lists isolated', others.data.data.some(n => n.notification_id === nid), false);
    if (submitted.status === 201) check('KYC decisions notify owner', after.data.data.filter(n => /^verification_/.test(n.type)).length, 2);
    if (process.argv.includes('--ui')) {
        const pending = await call('/verifications', 'POST', form(), other);
        check('UI pending test submission', pending.status, 201);
        console.log('UI fixture stamp: ' + stamp);
        fs.writeFileSync('profile-ui-fixture.json', JSON.stringify({ stamp, adminEmail: admin.email, verificationId: pending.data.data.verification_id }, null, 2));
        await new Promise(resolve => {
            const timer = setTimeout(() => { process.stdin.pause(); resolve(); }, 360000);
            process.stdin.once('data', () => { clearTimeout(timer); process.stdin.pause(); resolve(); });
        });
        const reviewed = await call(`/verifications/user/${other.id}`, 'GET', undefined, other);
        check('UI approval persists for owner', reviewed.data.data.status, 'approved');
    }
}
main().catch(e => { console.error(e.message); results.push({ name: 'unexpected failure', error: e.message, pass: false }); }).finally(async () => {
    if (admin) await pool.query('UPDATE users SET role=$1 WHERE user_id=$2 AND email=$3', ['user', admin.id, admin.email]);
    fs.writeFileSync('profile-verification-regression-result.json', JSON.stringify({ stamp, results }, null, 2));
    await pool.end(); if (results.some(r => !r.pass)) process.exitCode = 1;
});
