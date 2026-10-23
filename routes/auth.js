const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

module.exports = (pool) => {
    // 1. API สมัครสมาชิก
    router.post('/register', async (req, res) => {
        const { full_name, email, phone_number, password } = req.body;
        try {
            // ตรวจสอบว่ามีอีเมลนี้ในระบบหรือยัง
            const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userCheck.rows.length > 0) {
                return res.status(400).json({ success: false, error: 'อีเมลนี้ถูกใช้งานแล้ว' });
            }

            // เข้ารหัสรหัสผ่าน (Hash Password)
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);

            // บันทึกลงตาราง users
            const newUser = await pool.query(
                `INSERT INTO users (user_id, full_name, email, phone_number, password_hash, created_at, updated_at)
 VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
 RETURNING user_id, full_name, email, phone_number`,
                [full_name, email, phone_number || null, password_hash]
            );

            res.status(201).json({ success: true, data: newUser.rows[0] });
        } catch (err) {
            console.error('Register Error:', err);
            res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        }
    });

    // 2. API เข้าสู่ระบบ
    router.post('/login', async (req, res) => {
        const { email, password } = req.body;
        try {
            // ค้นหาผู้ใช้จากอีเมล
            const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (result.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'ไม่พบอีเมลนี้ในระบบ' });
            }

            const user = result.rows[0];

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