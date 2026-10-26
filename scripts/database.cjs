const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { databaseOptions } = require('../config');
const pool = new Pool(databaseOptions);
const tables = ['users', 'categories', 'items', 'rentals', 'reviews', 'rental_inspections', 'agreements', 'chat_messages', 'notifications', 'user_verifications', 'user_bank_accounts', 'rental_payments', 'disputes', 'dispute_history', 'dispute_messages', 'dispute_evidence', 'fine_refunds', 'item_price_benchmarks', 'item_price_sources'];
const schemaArgument = process.argv.find(arg => arg.startsWith('--schema='));
const schema = schemaArgument ? schemaArgument.slice(9) : 'public';
if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid schema name');
async function main() {
    const client = await pool.connect();
    try {
        if (process.argv.includes('--init')) {
            await client.query('BEGIN');
            // Refuse a database/schema already containing tables, even if only partially installed.
            const existing = await client.query('SELECT 1 FROM information_schema.tables WHERE table_schema=$1 LIMIT 1', [schema]);
            if (existing.rows.length) throw new Error('Initialization refused: target schema is not empty. Existing data was not modified.');
            const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'bootstrap.sql'), 'utf8')
                .split(/\r?\n/).filter(line => !line.startsWith('\\')).join('\n')
                .replace(/^CREATE SCHEMA public;$/m, '')
                .replace(/^SET transaction_timeout = 0;$/m, '')
                .replace(/\bpublic\./g, `"${schema}".`);
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
            await client.query(sql);
            await client.query('COMMIT');
            console.log('Empty schema initialized successfully.');
        }
        const present = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1', [schema]);
        const names = new Set(present.rows.map(row => row.table_name));
        const missing = tables.filter(name => !names.has(name));
        if (missing.length) throw new Error('Missing required tables: ' + missing.join(', '));
        const columns = await client.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1', [schema]);
        const columnSet = new Set(columns.rows.map(row => row.table_name + '.' + row.column_name));
        const required = ['users.role', 'users.status', 'users.updated_at', 'rentals.payment_status', 'rentals.received_confirmed_at', 'rentals.fine_status', 'agreements.borrower_accepted_at', 'agreements.lender_accepted_at', 'reviews.photo_urls', 'items.clothing_size', 'disputes.category', 'disputes.decision', 'fine_refunds.refund_amount'];
        const absent = required.filter(column => !columnSet.has(column));
        if (absent.length) throw new Error('Missing required columns: ' + absent.join(', '));
        const categories = await client.query(`SELECT COUNT(*)::int AS total FROM "${schema}".categories`);
        if (!categories.rows[0].total) throw new Error('Category reference data is missing');
        console.log('Database compatibility check passed.');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
