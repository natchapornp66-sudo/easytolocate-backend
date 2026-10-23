const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const requireAdmin = async (req, res, next) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'กรุณาเข้าสู่ระบบก่อน',
            });
        }

        const result = await pool.query(
            `SELECT role, status
             FROM users
             WHERE user_id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'ไม่พบบัญชีผู้ใช้งาน',
            });
        }

        const user = result.rows[0];

        if (user.role !== 'admin' || user.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'คุณไม่มีสิทธิ์เข้าถึงระบบผู้ดูแล',
            });
        }

        next();
    } catch (error) {
        console.error('Admin middleware error:', error);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถตรวจสอบสิทธิ์ผู้ดูแลได้',
        });
    }
};

module.exports = requireAdmin;