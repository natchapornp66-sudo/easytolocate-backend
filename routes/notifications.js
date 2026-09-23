const express = require('express');

module.exports = (pool) => {
    const router = express.Router();

    // ดึงการแจ้งเตือนของผู้ใช้
    router.get('/user/:user_id', async (req, res) => {
        const { user_id } = req.params;
        try {
            const result = await pool.query(
                `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
                [user_id]
            );
            res.json({ success: true, data: result.rows });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // อัปเดตอ่านแล้ว
    router.patch('/:notification_id/read', async (req, res) => {
        const { notification_id } = req.params;
        try {
            const result = await pool.query(
                `UPDATE notifications SET is_read = TRUE WHERE notification_id = $1 RETURNING *`,
                [notification_id]
            );
            res.json({ success: true, data: result.rows[0] });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};