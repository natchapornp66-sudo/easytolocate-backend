const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authenticateToken = require('../middleware/authMiddleware');

module.exports = (pool) => {
    router.get('/me', authenticateToken, async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT user_id, full_name, email, phone_number, address, latitude, longitude, trust_score, role, status, created_at
                FROM users WHERE user_id = $1
            `, [req.user.userId]);
            const completed = await pool.query(`
                SELECT COUNT(*)::int AS total FROM rentals r JOIN items i ON i.item_id = r.item_id
                WHERE r.status = 'completed' AND (r.borrower_id = $1 OR i.lender_id = $1)
            `, [req.user.userId]);
            const reviews = await pool.query(`
                SELECT rv.review_id AS id, rv.reviewer_id, rv.reviewee_id, rv.rating,
                       rv.comment, rv.created_at, i.title AS item_title, u.full_name AS reviewer_name
                FROM reviews rv LEFT JOIN rentals r ON r.rental_id = rv.rental_id
                LEFT JOIN items i ON i.item_id = r.item_id
                LEFT JOIN users u ON u.user_id = rv.reviewer_id
                WHERE rv.reviewer_id = $1 OR rv.reviewee_id = $1 ORDER BY rv.created_at DESC
            `, [req.user.userId]);
            return res.json({ success: true, data: {
                ...result.rows[0], trust_score: Number(result.rows[0].trust_score || 0),
                completed_count: completed.rows[0].total, reviews: reviews.rows
            } });
        } catch (error) {
            console.error('Get profile error:', error.message);
            return res.status(500).json({ success: false, error: 'ไม่สามารถโหลดโปรไฟล์ได้' });
        }
    });
    router.patch('/me', authenticateToken, async (req, res) => {
        const { full_name, phone_number } = req.body || {};
        if (Object.keys(req.body || {}).some(key => !['full_name', 'phone_number'].includes(key)) ||
            typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 100 ||
            typeof phone_number !== 'string' || (phone_number !== '' && !/^[0-9]{9,15}$/.test(phone_number))) {
            return res.status(400).json({ success: false, error: 'กรุณาระบุชื่อและเบอร์โทรศัพท์ให้ถูกต้อง' });
        }
        try {
            const result = await pool.query(`
                UPDATE users SET full_name = $1, phone_number = $2, updated_at = NOW()
                WHERE user_id = $3 RETURNING user_id, full_name, email, phone_number
            `, [full_name.trim(), phone_number || null, req.user.userId]);
            return res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('Update profile error:', error.message);
            return res.status(500).json({ success: false, error: 'ไม่สามารถบันทึกโปรไฟล์ได้' });
        }
    });
    // 1. API สมัครสมาชิก
    router.post('/register', async (req, res) => {
        const { full_name, phone_number, password, address, latitude, longitude } = req.body || {};
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const hasLocation = latitude != null || longitude != null;
        if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 100 ||
            email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72 ||
            (phone_number != null && phone_number !== '' && (typeof phone_number !== 'string' || !/^[0-9]{9,15}$/.test(phone_number))) ||
            (address != null && (typeof address !== 'string' || address.trim().length > 2000)) ||
            (hasLocation && (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
                typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180))) {
            return res.status(400).json({ success: false, error: 'กรุณาระบุข้อมูลสมัครให้ถูกต้อง รหัสผ่านอย่างน้อย 6 ตัวอักษรและไม่เกิน 72 ไบต์' });
        }
        let client, committed = false;
        try {
            const password_hash = await bcrypt.hash(password, 10);
            client = await pool.connect();
            await client.query('BEGIN');
            // Serialize registrations for the same normalized email across all app instances.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
            // ตรวจสอบว่ามีอีเมลนี้ในระบบหรือยัง
            const userCheck = await client.query('SELECT user_id FROM users WHERE LOWER(BTRIM(email)) = $1', [email]);
            if (userCheck.rows.length > 0) {
                return res.status(400).json({ success: false, error: 'อีเมลนี้ถูกใช้งานแล้ว' });
            }

            // บันทึกลงตาราง users
            const newUser = await client.query(
                `INSERT INTO users (user_id, full_name, email, phone_number, password_hash, address, latitude, longitude, created_at, updated_at)
 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
 RETURNING user_id, full_name, email, phone_number`,
                [full_name.trim(), email, phone_number || null, password_hash, address?.trim() || null, latitude ?? null, longitude ?? null]
            );
            await client.query('COMMIT');
            committed = true;
            res.status(201).json({ success: true, data: newUser.rows[0] });
        } catch (err) {
            console.error('Register Error:', err);
            res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        } finally {
            if (client) { if (!committed) await client.query('ROLLBACK').catch(() => {}); client.release(); }
        }
    });

    // 2. API เข้าสู่ระบบ
    router.post('/login', async (req, res) => {
        const { password } = req.body || {};
        const originalEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const email = originalEmail.toLowerCase();
        if (!email || email.length > 255 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ success: false, error: 'กรุณาระบุอีเมลและรหัสผ่านที่ถูกต้อง รหัสผ่านต้องไม่เกิน 72 ไบต์' });
        }
        try {
            // ค้นหาผู้ใช้จากอีเมล
            const result = await pool.query('SELECT * FROM users WHERE LOWER(BTRIM(email)) = $1', [email]);
            if (result.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'ไม่พบอีเมลนี้ในระบบ' });
            }

            // Preserve distinct legacy accounts; never silently merge case-variant emails.
            const user = result.rows.find(row => row.email.trim() === originalEmail) || (result.rows.length === 1 ? result.rows[0] : null);
            if (!user) return res.status(400).json({ success: false, error: 'กรุณากรอกอีเมลตรงตามที่สมัคร เนื่องจากมีบัญชีเดิมต่างตัวพิมพ์' });

            // ตรวจสอบรหัสผ่าน
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(400).json({ success: false, error: 'รหัสผ่านไม่ถูกต้อง' });
            }
            if (user.status !== 'active') {
                return res.status(403).json({
                    success: false,
                    error: 'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
                });
            }

            // ส่งข้อมูลผู้ใช้กลับไป (ไม่ส่ง password_hash)
            // สร้าง JWT หลังตรวจสอบรหัสผ่านสำเร็จ
            if (!process.env.JWT_SECRET) {
                throw new Error('JWT_SECRET is not configured');
            }

            const token = jwt.sign(
                {
                    userId: user.user_id
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: '24h'
                }
            );

            // ส่งข้อมูลผู้ใช้พร้อม Token กลับไป
            res.json({
                success: true,
                token: token,
                data: {
                    id: user.user_id,
                    full_name: user.full_name,
                    email: user.email,
                    phone_number: user.phone_number
                }
            });
        } catch (err) {
            console.error('Login Error:', err);
            res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        }
    });

    return router;
};
