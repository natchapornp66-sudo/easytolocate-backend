const express = require('express');

module.exports = (pool) => {
    const router = express.Router();

    // ส่งข้อมูล KYC
    router.post('/', async (req, res) => {
        const { user_id, id_card_number, id_card_image_url, selfie_image_url } = req.body;
        try {
            const result = await pool.query(
                `INSERT INTO user_verifications (verification_id, user_id, id_card_number, id_card_image_url, selfie_image_url, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending') RETURNING *`,
                [user_id, id_card_number, id_card_image_url, selfie_image_url]
            );
            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (err) {
            console.error('Create verification error:', err);

            res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดในการส่งข้อมูลยืนยันตัวตน'
            });
        }
    });

    // ดูสถานะ KYC ของผู้ใช้
    router.get('/user/:user_id', async (req, res) => {
        const { user_id } = req.params;
        try {
            const result = await pool.query(
                `SELECT * FROM user_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
                [user_id]
            );
            res.json({ success: true, data: result.rows[0] || null });
        } catch (err) {
            console.error('Get verification status error:', err);

            res.status(500).json({
                success: false,
                error: 'ไม่สามารถตรวจสอบสถานะการยืนยันตัวตนได้'
            });
        }
    });

    return router;
};