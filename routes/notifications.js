const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');

module.exports = (pool) => {
    const router = express.Router();

    // ทุก Route ต้องเข้าสู่ระบบก่อน
    router.use(authenticateToken);

    // ดึงการแจ้งเตือนของผู้ใช้ที่เข้าสู่ระบบ
    router.get('/', async (req, res) => {
        const userId = req.user.userId;

        try {
            const result = await pool.query(
                `SELECT *
                 FROM notifications
                 WHERE user_id = $1
                 ORDER BY created_at DESC`,
                [userId]
            );

            res.json({
                success: true,
                data: result.rows
            });
        } catch (err) {
            console.error('Get notifications error:', err);
            res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดการแจ้งเตือนได้'
            });
        }
    });

    // เปลี่ยนสถานะเป็นอ่านแล้ว เฉพาะของผู้ใช้ที่เข้าสู่ระบบ
    router.patch('/:notification_id/read', async (req, res) => {
        const { notification_id } = req.params;
        const userId = req.user.userId;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notification_id)) {
            return res.status(400).json({ success: false, error: 'รหัสการแจ้งเตือนไม่ถูกต้อง' });
        }

        try {
            const result = await pool.query(
                `UPDATE notifications
                 SET is_read = TRUE
                 WHERE notification_id = $1
                   AND user_id = $2
                 RETURNING *`,
                [notification_id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบการแจ้งเตือน'
                });
            }

            res.json({
                success: true,
                data: result.rows[0]
            });
        } catch (err) {
            console.error('Mark notification read error:', err);
            res.status(500).json({
                success: false,
                error: 'ไม่สามารถอัปเดตการแจ้งเตือนได้'
            });
        }
    });

    return router;
};
