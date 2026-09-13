require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// 1. ดึงรายการสินค้าทั้งหมด (Items)
app.get('/api/items', async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT items.*, categories.category_name, users.full_name AS lender_name 
      FROM items
      LEFT JOIN categories ON items.category_id = categories.category_id
      LEFT JOIN users ON items.lender_id = users.user_id
      ORDER BY items.created_at DESC
    `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// 2. ดึงหมวดหมู่ทั้งหมด (Categories)
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY category_id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// 3. ดึงรายการเช่าทั้งหมด (Rentals)
app.get('/api/rentals', async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT rentals.*, items.title AS item_title, users.full_name AS borrower_name 
      FROM rentals
      LEFT JOIN items ON rentals.item_id = items.item_id
      LEFT JOIN users ON rentals.borrower_id = users.user_id
      ORDER BY rentals.created_at DESC
    `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// 4. ดึงข้อมูลผู้ใช้ทั้งหมด (Users)
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT user_id, email, full_name, phone_number, created_at FROM users');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});