const jwt = require('jsonwebtoken');
const pool = require('../db');

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    // ต้องส่ง Authorization: Bearer <token>
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'กรุณาเข้าสู่ระบบก่อน',
        });
    }

    if (!process.env.JWT_SECRET) {
        return res.status(500).json({
            success: false,
            error: 'ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า',
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256'],
        });

        if (!decoded.userId) {
            return res.status(401).json({
                success: false,
                error: 'Token ไม่ถูกต้อง',
            });
        }

        // เก็บ userId ที่ตรวจสอบแล้วไว้ใช้ใน API
        const result = await pool.query(
            'SELECT status FROM users WHERE user_id = $1',
            [decoded.userId]
        );

        if (
            result.rows.length === 0 ||
            result.rows[0].status !== 'active'
        ) {
            return res.status(403).json({
                success: false,
                error: 'บัญชีนี้ถูกระงับการใช้งาน'
            });
        }

        req.user = {
            userId: decoded.userId,
        };

        next();
    } catch (error) {
        console.error('Authentication error:', error.message);

        if (error.name === 'TokenExpiredError' ||
            error.name === 'JsonWebTokenError' ||
            error.name === 'NotBeforeError') {
            return res.status(401).json({
                success: false,
                error: 'Token ไม่ถูกต้องหรือหมดอายุ',
            });
        }

        return res.status(500).json({
            success: false,
            error: 'เกิดข้อผิดพลาดในการตรวจสอบบัญชีผู้ใช้',
        });
    }
};

module.exports = authenticateToken;
