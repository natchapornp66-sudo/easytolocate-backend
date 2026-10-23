const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');

module.exports = (pool) => {
    const router = express.Router();


    // 1. ดึงรายการแชททั้งหมดของผู้ใช้ (กรองเฉพาะที่เราเกี่ยวข้อง)
    router.get('/', async (req, res) => {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required'
            });
        }

        try {
            const result = await pool.query(`
            SELECT *
            FROM (
                SELECT DISTINCT ON (
                    CASE
                        WHEN cm.sender_id < cm.receiver_id
                        THEN cm.sender_id || '-' || cm.receiver_id
                        ELSE cm.receiver_id || '-' || cm.sender_id
                    END
                )
                    cm.*,
                    sender.full_name AS sender_name,
                    receiver.full_name AS receiver_name

                FROM chat_messages cm

                LEFT JOIN users sender
                    ON cm.sender_id = sender.user_id

                LEFT JOIN users receiver
                    ON cm.receiver_id = receiver.user_id

                WHERE
                    cm.sender_id = $1
                    OR cm.receiver_id = $1

                ORDER BY
                    CASE
                        WHEN cm.sender_id < cm.receiver_id
                        THEN cm.sender_id || '-' || cm.receiver_id
                        ELSE cm.receiver_id || '-' || cm.sender_id
                    END,
                    cm.created_at DESC
            ) latest_chats

            ORDER BY latest_chats.created_at DESC
        `, [userId]);

            const formattedChats = result.rows.map((row) => {

                const isSender =
                    String(row.sender_id) === String(userId);

                const otherUserId = isSender
                    ? row.receiver_id
                    : row.sender_id;

                const otherUserName = isSender
                    ? row.receiver_name
                    : row.sender_name;

                return {
                    chat_id: otherUserId,
                    other_user_name:
                        otherUserName || 'ผู้ใช้งาน',

                    last_message:
                        row.message || '',

                    last_timestamp:
                        row.created_at,

                    unread_count: 0
                };
            });

            return res.json({
                success: true,
                data: formattedChats
            });

        } catch (err) {
            console.error(
                'Error fetching chats:',
                err
            );

            return res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        }
    });

    // 2. สร้างหรือเปิดห้องแชท
    router.post('/:id/messages', async (req, res) => {
        const receiverId = req.params.id;
        const {
            sender_id,
            message,
            rental_id
        } = req.body;

        if (!sender_id) {
            return res.status(400).json({
                success: false,
                error: 'sender_id is required'
            });
        }

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'message is required'
            });
        }

        if (String(sender_id) === String(receiverId)) {
            return res.status(400).json({
                success: false,
                error: 'ไม่สามารถส่งข้อความหาตัวเองได้'
            });
        }

        try {
            const result = await pool.query(`
            INSERT INTO chat_messages (
                message_id,
                sender_id,
                receiver_id,
                rental_id,
                message,
                is_read
            )
            VALUES (
                gen_random_uuid(),
                $1,
                $2,
                $3,
                $4,
                FALSE
            )
            RETURNING *
        `, [
                sender_id,
                receiverId,
                rental_id || null,
                message.trim()
            ]);

            res.status(201).json({
                success: true,
                data: result.rows[0]
            });

        } catch (err) {
            console.error('Error sending message:', err);

            return res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        }
    });

    // 3. ดึงข้อมูลรายละเอียดห้องแชท
    router.get('/:id', async (req, res) => {
        const otherUserId = req.params.id;
        try {
            const userResult = await pool.query(
                `SELECT user_id, full_name FROM users WHERE user_id = $1`,
                [otherUserId]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }

            res.json({
                success: true,
                data: {
                    chat_id: otherUserId,
                    other_user_name: userResult.rows[0].full_name,
                }
            });
        } catch (err) {
            res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        }
    });

    // 4. ดึงข้อความเฉพาะในห้องแชทระหว่างเรากับอีกฝ่าย
    router.get('/:id/messages', async (req, res) => {
        const otherUserId = req.params.id;
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required'
            });
        }

        try {
            const result = await pool.query(`
            SELECT
                cm.*,
                sender.full_name AS sender_name
            FROM chat_messages cm

            LEFT JOIN users sender
                ON cm.sender_id = sender.user_id

            WHERE
                (cm.sender_id = $1 AND cm.receiver_id = $2)
                OR
                (cm.sender_id = $2 AND cm.receiver_id = $1)

            ORDER BY cm.created_at ASC
        `, [userId, otherUserId]);

            res.json({
                success: true,
                data: result.rows
            });

        } catch (err) {
            console.error('Error fetching messages:', err);

            return res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        }
    });

    // 5. ส่งข้อความใหม่
    router.post('/:id/messages', async (req, res) => {
        const receiverId = req.params.id;

        const {
            sender_id,
            message,
            rental_id
        } = req.body;

        // ตรวจ sender
        if (!sender_id) {
            return res.status(400).json({
                success: false,
                error: 'sender_id is required'
            });
        }

        // ตรวจข้อความ
        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'message is required'
            });
        }

        // ห้ามส่งข้อความหาตัวเอง
        if (String(sender_id) === String(receiverId)) {
            return res.status(400).json({
                success: false,
                error: 'ไม่สามารถส่งข้อความหาตัวเองได้'
            });
        }

        try {
            const result = await pool.query(
                `
            INSERT INTO chat_messages (
                message_id,
                sender_id,
                receiver_id,
                rental_id,
                message,
                is_read
            )
            VALUES (
                gen_random_uuid(),
                $1,
                $2,
                $3,
                $4,
                FALSE
            )
            RETURNING *
            `,
                [
                    sender_id,
                    receiverId,
                    rental_id || null,
                    message.trim()
                ]
            );

            return res.status(201).json({
                success: true,
                data: result.rows[0]
            });

        } catch (err) {
            console.error('Error sending message:', err);

            return res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดภายในระบบ'
            });
        }
    });

    // ดึงบัญชีธนาคารผู้ให้เช่าจากคู่สนทนา
    router.get('/:id/bank-account', authenticateToken, async (req, res) => {
        try {
            const otherUserId = req.params.id;
            const currentUserId = req.user.userId;

            if (String(currentUserId) === String(otherUserId)) {
                return res.status(400).json({
                    success: false,
                    error: 'ไม่สามารถดูบัญชีของตัวเองผ่านห้องแชทนี้'
                });
            }

            const result = await pool.query(`
    SELECT
        uba.bank_name,
        uba.account_name,
        uba.account_number
    FROM rentals r
    JOIN items i
        ON r.item_id = i.item_id
    JOIN user_bank_accounts uba
        ON uba.user_id = $2
    WHERE
        (
            r.borrower_id = $1
            AND i.lender_id = $2
        )
        OR
        (
            r.borrower_id = $2
            AND i.lender_id = $1
        )
    ORDER BY uba.updated_at DESC, uba.created_at DESC
    LIMIT 1
`, [currentUserId, otherUserId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบบัญชีธนาคารของผู้ให้เช่าที่เกี่ยวข้องกับรายการเช่า'
                });
            }

            return res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (err) {
            console.error('Get lender bank account error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดบัญชีธนาคารได้'
            });
        }
    });

    return router;
};