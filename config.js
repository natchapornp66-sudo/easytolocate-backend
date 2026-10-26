const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const production = process.env.NODE_ENV === 'production';
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const frontendDist = path.resolve(process.env.FRONTEND_DIST_DIR || path.join(__dirname, 'public-app'));
const serveFrontend = process.env.SERVE_FRONTEND === 'true' || (production && process.env.SERVE_FRONTEND !== 'false');
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:8080').split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
const databaseOptions = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 };
if (process.env.DB_SSL === 'true') {
    databaseOptions.ssl = { rejectUnauthorized: true };
    if (process.env.DB_SSL_CA_FILE) databaseOptions.ssl.ca = fs.readFileSync(process.env.DB_SSL_CA_FILE, 'utf8');
}
function validateProduction() {
    if (!production) return;
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /change.?me|example|replace.?me/i.test(process.env.JWT_SECRET)) {
        throw new Error('Set JWT_SECRET to a unique random value of at least 32 characters');
    }
    if (!process.env.UPLOAD_DIR || !path.isAbsolute(process.env.UPLOAD_DIR)) throw new Error('UPLOAD_DIR must be an absolute directory');
    if (process.env.STORAGE_DRIVER && !['local', 'supabase'].includes(process.env.STORAGE_DRIVER)) throw new Error('Unsupported STORAGE_DRIVER');
    if (process.env.STORAGE_DRIVER === 'supabase') {
        const url = new URL(process.env.SUPABASE_URL || '');
        if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('SUPABASE_URL must use HTTPS');
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase server storage key is required');
        if (!/^[a-z0-9-]+$/.test(process.env.SUPABASE_STORAGE_BUCKET || 'easytolocate-files')) throw new Error('Invalid storage bucket');
    }
    if (!process.env.FRONTEND_URL || !allowedOrigins.length) throw new Error('FRONTEND_URL is required');
    for (const origin of allowedOrigins) {
        const url = new URL(origin);
        if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
            throw new Error('FRONTEND_URL must contain HTTPS origins (HTTP is allowed only for local verification)');
        }
    }
    if (serveFrontend && !fs.existsSync(path.join(frontendDist, 'index.html'))) throw new Error('Frontend build missing; run prepare:release or set FRONTEND_DIST_DIR');
}
module.exports = { production, uploadRoot, frontendDist, serveFrontend, allowedOrigins, databaseOptions, validateProduction };
