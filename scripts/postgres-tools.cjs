const path = require('path');
require('../config');
function pgEnvironment() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const url = new URL(process.env.DATABASE_URL);
    return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '10',
        ...(process.env.DB_SSL === 'true' ? { PGSSLMODE: 'verify-full' } : {}),
        ...(url.searchParams.has('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
        ...(process.env.DB_SSL_CA_FILE ? { PGSSLROOTCERT: process.env.DB_SSL_CA_FILE, PGSSLMODE: 'verify-full' } : {}),
    };
}
function pgTool(name) {
    if (process.env.PG_BIN_DIR) return path.join(process.env.PG_BIN_DIR, process.platform === 'win32' ? `${name}.exe` : name);
    return name;
}
module.exports = { pgEnvironment, pgTool };
