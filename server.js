require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// เปิดให้เข้าถึงโฟลเดอร์ uploads ได้ผ่าน http://localhost:5000/uploads/...
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// สร้าง Database Connection Pool
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

        // เพิ่มการแนบระยะทาง (Distance) เข้าไปในสินค้าแต่ละชิ้น
        const itemsWithDistance = result.rows.map(item => {
            // สุ่มระยะทางสมจริงระหว่าง 0.8 ถึง 4.5 กิโลเมตร (หรือจะกำหนดเลขตายตัวก็ได้ครับ)
            const mockDistance = (Math.random() * 3.7 + 0.8).toFixed(1);
            return {
                ...item,
                distance: mockDistance
            };
        });

        res.json(itemsWithDistance);
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
        const result = await pool.query(
            'SELECT user_id, email, full_name, phone_number, trust_score, status, created_at FROM users'
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// Import Routes จากโฟลเดอร์ routes
const verificationsRouter = require('./routes/verifications');
const agreementsRouter = require('./routes/agreements');
const chatsRouter = require('./routes/chats');
const notificationsRouter = require('./routes/notifications');

app.use('/api/verifications', verificationsRouter(pool));
app.use('/api/agreements', agreementsRouter(pool));
app.use('/api/chats', chatsRouter(pool));
app.use('/api/notifications', notificationsRouter(pool));

app.get('/api/items/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            SELECT items.*, categories.category_name, users.full_name AS lender_name 
            FROM items
            LEFT JOIN categories ON items.category_id = categories.category_id
            LEFT JOIN users ON items.lender_id = users.user_id
            WHERE items::text LIKE '%' || $1 || '%'
            LIMIT 1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).send('Item not found');
        }

        const rawItem = result.rows[0];

        // ดึงค่ารูปจากฟิลด์ที่เป็นไปได้
        let imgPath = rawItem.image_url || rawItem.image || rawItem.photo;
        if (Array.isArray(rawItem.images)) {
            imgPath = rawItem.images[0];
        }

        // ถ้ามีชื่อไฟล์แต่ไม่ได้ขึ้นต้นด้วย http ให้เติม /uploads/ หรือ path ที่ถูกต้อง
        if (imgPath && !imgPath.startsWith('http') && !imgPath.startsWith('/')) {
            imgPath = `/uploads/${imgPath}`;
        }

        // ถ้าไม่มีรูปเลย ให้ใส่รูป Placeholder สำรองไว้ก่อนเพื่อความชัวร์
        const finalImage = imgPath || 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=500';

        const item = {
            ...rawItem,
            image_url: finalImage,
            image: finalImage,
            images: [finalImage],
            distance: (Math.random() * 3.7 + 0.8).toFixed(1)
        };

        res.json(item);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});
// 6. เส้นดึงรีวิวสินค้า (ส่งค่า Array ว่างกลับไปเพื่อกัน Error 404)
app.get('/api/items/:id/reviews', async (req, res) => {
    res.json([]);
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});