const express = require('express');

module.exports = (pool) => {
    const router = express.Router();

    // ส่งข้อความ
    router.post('/messages', async (req, res) => {
        const { sender_id, receiver_id, rental_id, message } = req.body;
        try {
            const result = await pool.query(
                `INSERT INTO chat_messages (message_id, sender_id, receiver_id, rental_id, message, is_read)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, FALSE) RETURNING *`,
                [sender_id, receiver_id, rental_id || null, message]
            );
            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ดึงประวัติแชท
    router.get('/messages', async (req, res) => {
        const { user1_id, user2_id, rental_id } = req.query;
        try {
            let query = '';
            let params = [];

            if (rental_id) {
                query = `SELECT cm.*, sender.full_name AS sender_name 
                 FROM chat_messages cm
                 JOIN users sender ON cm.sender_id = sender.user_id
                 WHERE cm.rental_id = $1 ORDER BY cm.created_at ASC`;
                params = [rental_id];
            } else {
                query = `SELECT cm.*, sender.full_name AS sender_name 
                 FROM chat_messages cm
                 JOIN users sender ON cm.sender_id = sender.user_id
                 WHERE (cm.sender_id = $1 AND cm.receiver_id = $2) 
                    OR (cm.sender_id = $2 AND cm.receiver_id = $1)
                 ORDER BY cm.created_at ASC`;
                params = [user1_id, user2_id];
            }

            const result = await pool.query(query, params);
            res.json({ success: true, data: result.rows });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};