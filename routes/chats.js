const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');

module.exports = (pool) => {
    const router = express.Router();
    router.use(authenticateToken);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    router.param('id', (req, res, next, id) => {
        if (!uuid.test(id)) return res.status(400).json({ success: false, error: 'รหัสคู่สนทนาไม่ถูกต้อง' });
        next();
    });
    router.use((req, res, next) => {
        if ((req.query.userId && req.query.userId !== req.user.userId) ||
            (req.body?.sender_id && req.body.sender_id !== req.user.userId)) {
            return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์ใช้บัญชีของผู้อื่น' });
        }
        next();
    });


    // 1. ดึงรายการแชททั้งหมดของผู้ใช้ (กรองเฉพาะที่เราเกี่ยวข้อง)
    router.get('/', async (req, res) => {
        const userId = req.user.userId;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required'
            });
        }

        try {
            const result = await pool.query(`
            SELECT latest_chats.*, (
                SELECT COUNT(*)::int FROM chat_messages incoming
                WHERE incoming.receiver_id = $1 AND incoming.is_read = FALSE
                  AND incoming.sender_id = CASE WHEN latest_chats.sender_id = $1
                    THEN latest_chats.receiver_id ELSE latest_chats.sender_id END
            ) AS unread_count
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

                    unread_count: row.unread_count
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
            message,
            rental_id
        } = req.body;
        const sender_id = req.user.userId;

        if (!sender_id) {
            return res.status(400).json({
                success: false,
                error: 'sender_id is required'
            });
        }

        if (typeof message !== 'string' || !message.trim() || message.trim().length > 3000) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาระบุข้อความ 1–3000 ตัวอักษร'
            });
        }

        if (String(sender_id) === String(receiverId)) {
            return res.status(400).json({
                success: false,
                error: 'ไม่สามารถส่งข้อความหาตัวเองได้'
            });
        }

        try {
            if (rental_id && (typeof rental_id !== 'string' || !uuid.test(rental_id))) {
                return res.status(400).json({ success: false, error: 'รหัสรายการเช่าไม่ถูกต้อง' });
            }
            const recipient = await pool.query('SELECT user_id FROM users WHERE user_id=$1', [receiverId]);
            if (!recipient.rows.length) {
                return res.status(404).json({ success: false, error: 'ไม่พบคู่สนทนา' });
            }
            if (rental_id) {
                const access = await pool.query(`
                    SELECT r.rental_id FROM rentals r
                    JOIN items i ON i.item_id = r.item_id
                    WHERE r.rental_id = $1 AND
                    ((r.borrower_id = $2 AND i.lender_id = $3) OR
                     (r.borrower_id = $3 AND i.lender_id = $2))
                `, [rental_id, sender_id, receiverId]);
                if (!access.rows.length) {
                    return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์แนบรายการเช่านี้' });
                }
            }
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
        const userId = req.user.userId;

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

            // Mark only incoming messages actually returned by this fetch as read.
            const incomingIds = result.rows.filter(row => String(row.receiver_id) === String(userId)).map(row => row.message_id);
            if (incomingIds.length) {
                await pool.query('UPDATE chat_messages SET is_read=TRUE WHERE receiver_id=$1 AND message_id=ANY($2::uuid[])', [userId, incomingIds]);
                for (const row of result.rows) if (String(row.receiver_id) === String(userId)) row.is_read = true;
            }

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
