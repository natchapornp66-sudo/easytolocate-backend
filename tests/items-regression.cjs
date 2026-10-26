const fs = require('node:fs');
const stamp = Date.now(), results = [], items = [];
let owner, other, category;
async function call(url, method = 'GET', body, user) {
 const headers = user ? { Authorization: `Bearer ${user.token}` } : {};
 if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
 const r = await fetch((process.env.TEST_API_URL || 'http://localhost:5000/api') + url, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
 return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.arrayBuffer() };
}
function check(name, actual, expected) { const pass = actual === expected; results.push({ name, actual, expected, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}`); }
async function account(role) {
 const email = `qa.items.${role}.${stamp}@example.invalid`, password = `QaItems-${stamp}!`;
 await call('/auth/register', 'POST', { email, password, full_name: `QA ITEMS ${role}` });
 const r = await call('/auth/login', 'POST', { email, password });
 return { token: r.data.token, id: r.data.data.id };
}
const body = extra => ({ category_id: category, title: `QA ITEMS CAMERA ${stamp}`, description: 'QA description', conditions: 'QA only', daily_price: 100.5, images: [], ...extra });
async function create(extra, expected = 400, name = 'invalid item rejected') {
 const r = await call('/items', 'POST', body(extra), owner);
 if (r.data?.data?.item_id) items.push(r.data.data.item_id);
 check(name, r.status, expected); return r;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function upload(invalid = false, count = 1) { const f = new FormData(); for (let i = 0; i < count; i++) f.append('images', new Blob([invalid ? Buffer.from('not a png') : png], { type: 'image/png' }), 'QA.png'); return f; }
async function main() {
 owner = await account('owner'); other = await account('other');
 const cats = await call('/categories'); check('categories load', cats.status, 200); category = cats.data[0].category_id;
 check('anonymous cannot post', (await call('/items', 'POST', body())).status, 401);
 check('anonymous cannot upload', (await call('/upload/item-images', 'POST', upload())).status, 401);
 check('empty upload rejected', (await call('/upload/item-images', 'POST', new FormData(), owner)).status, 400);
 check('fake PNG rejected', (await call('/upload/item-images', 'POST', upload(true), owner)).status, 400);
 check('over five uploaded images rejected', (await call('/upload/item-images', 'POST', upload(false, 6), owner)).status, 400);
 const uploaded = await call('/upload/item-images', 'POST', upload(), owner); check('valid upload', uploaded.status, 201);
 const created = await create({ images: uploaded.data.images }, 201, 'post with decimal price and image'); const id = created.data.data.item_id;
 check('decimal price preserved', Number(created.data.data.daily_price), 100.5);
 check('image URL persisted', created.data.data.images[0], uploaded.data.images[0]);
 const publicList = await call('/items'); check('active item publicly listed', publicList.data.some(i => i.item_id === id), true);
 check('no fabricated distance', publicList.data.find(i => i.item_id === id).distance_km, null);
 const mine = await call('/my-items', 'GET', undefined, owner); check('owner sees own listing', mine.data.data.some(i => i.item_id === id), true);
 check('other does not see owner listing', (await call('/my-items', 'GET', undefined, other)).data.data.some(i => i.item_id === id), false);
 const edit = { title: `QA ITEMS PS5 EDITED ${stamp}`, description: 'QA new description', conditions: 'QA new conditions', daily_price: 175.25 };
 check('anonymous cannot edit', (await call(`/items/${id}`, 'PUT', edit)).status, 401);
 check('other cannot edit', (await call(`/items/${id}`, 'PUT', edit, other)).status, 404);
 check('owner edits', (await call(`/items/${id}`, 'PUT', edit, owner)).status, 200);
 const detail = await call(`/items/${id}`); check('edited title persists', detail.data.title || detail.data.data?.title, edit.title);
 const edited = (await call('/my-items', 'GET', undefined, owner)).data.data.find(i => i.item_id === id);
 check('edit preserves image', edited.images[0], uploaded.data.images[0]); check('edit preserves category', edited.category_id, category);
 check('invalid edit price rejected', (await call(`/items/${id}`, 'PUT', { ...edit, daily_price: -1 }, owner)).status, 400);
 await create({ title: 42 }, 400, 'non-string title rejected');
 await create({ category_id: 2147483647 }, 400, 'unknown category rejected');
 await create({ images: ['javascript:alert(1)'] }, 400, 'invalid image URL rejected');
 await create({ images: [{ bad: 'value' }] }, 400, 'image objects rejected');
 await create({ images: Array(6).fill('https://example.invalid/qa.png') }, 400, 'over five stored images rejected');
 await create({ daily_price: 100.001 }, 400, 'fractional cent price rejected');
 await create({ title: 'x'.repeat(256) }, 400, 'oversized title rejected');
 check('malformed item detail ID rejected', (await call('/items/not-a-uuid')).status, 400);
 check('malformed reviews ID rejected', (await call('/items/not-a-uuid/reviews')).status, 400);
 check('deactivate item', (await call(`/items/${id}/status`, 'PATCH', { status: 'inactive' }, owner)).status, 200);
 check('inactive removed from search feed', (await call('/items')).data.some(i => i.item_id === id), false);
 check('reactivate item', (await call(`/items/${id}/status`, 'PATCH', { status: 'active' }, owner)).status, 200);
 const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
 const rental = await call('/rentals', 'POST', { item_id: id, start_date: today, end_date: today, agreement_accepted: true }, other);
 check('create pending rental', rental.status, 201);
 check('cannot delete rental history', (await call(`/items/${id}`, 'DELETE', undefined, owner)).status, 409);
 if (rental.status === 201) await call(`/rentals/${rental.data.data.rental_id}/status`, 'PATCH', { status: 'rejected' }, owner);
 const unused = await create({ title: `QA DELETE ${stamp}` }, 201, 'create unused deletion fixture');
 check('other cannot delete', (await call(`/items/${unused.data.data.item_id}`, 'DELETE', undefined, other)).status, 404);
 check('unused item can be deleted', (await call(`/items/${unused.data.data.item_id}`, 'DELETE', undefined, owner)).status, 200);
}
main().catch(e => { console.error(e.message); results.push({ name: 'unexpected failure', error: e.message, pass: false }); }).finally(async () => {
 if (owner) for (const id of items) await call(`/items/${id}/status`, 'PATCH', { status: 'inactive' }, owner).catch(() => {});
 fs.writeFileSync('items-regression-result.json', JSON.stringify({ stamp, items, results }, null, 2));
 if (results.some(r => !r.pass)) process.exitCode = 1;
});
