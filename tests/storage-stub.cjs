// In-memory stand-in for the documented Storage REST contract. No Supabase account needed.
const http = require('node:http');
async function createStorageStub() {
    const objects = new Map();
    const state = { public: false, failUploads: false };
    const token = 'qa-storage-key';
    const bucket = 'easytolocate-files';
    const server = http.createServer(async (req, res) => {
        if (req.headers.apikey !== token || req.headers.authorization !== 'Bearer ' + token) { res.writeHead(403).end(); return; }
        const path = decodeURIComponent(req.url.replace('/storage/v1/', ''));
        const chunks = []; for await (const chunk of req) chunks.push(chunk); const data = Buffer.concat(chunks);
        const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value)); };
        if (req.method === 'GET' && path === 'bucket/' + bucket) return json(200, { id: bucket, public: state.public });
        if (req.method === 'POST' && path === 'object/list/' + bucket) {
            const { prefix, limit, offset } = JSON.parse(data);
            return json(200, [...objects.keys()].filter(k => k.startsWith(prefix + '/')).sort().slice(offset, offset + limit).map(k => ({ name: k.slice(prefix.length + 1) })));
        }
        if (req.method === 'GET' && path.startsWith('object/authenticated/' + bucket + '/')) {
            const object = objects.get(path.slice(('object/authenticated/' + bucket + '/').length));
            if (!object) return json(400, { statusCode: '404', message: 'Not found' });
            return res.writeHead(200, { 'Content-Type': object.type }).end(object.data);
        }
        if (req.method === 'POST' && path.startsWith('object/' + bucket + '/')) {
            if (state.failUploads) return json(503, { message: 'Simulated outage' });
            const key = path.slice(('object/' + bucket + '/').length);
            if (objects.has(key)) return json(409, { message: 'Duplicate' });
            objects.set(key, { data, type: req.headers['content-type'] }); return json(200, { Key: bucket + '/' + key });
        }
        if (req.method === 'DELETE' && path === 'object/' + bucket) {
            for (const key of JSON.parse(data).prefixes) objects.delete(key); return json(200, []);
        }
        json(404, { statusCode: 404 });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { url: 'http://127.0.0.1:' + server.address().port, token, objects, state, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { createStorageStub };
