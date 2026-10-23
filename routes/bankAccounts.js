const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');

module.exports = (pool) => {
    const router = express.Router();

    router.use(authenticateToken);

    // ดูบัญชีธนาคารของตัวเอง
    router.get('/me', async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT bank_account_id, bank_name, account_name,
                account_number, updated_at
         FROM user_bank_accounts
         WHERE user_id = $1`,
                [req.user.userId]
            );

            res.json({
                success: true,
                data: result.rows[0] || null,
            });
        } catch (err) {
            console.error('Get bank account error:', err);
            res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดบัญชีธนาคารได้',
            });
        }
    });

    // เพิ่มหรือแก้ไขบัญชีธนาคารของตัวเอง
    router.put('/me', async (req, res) => {
        try {
            const { bank_name, account_name, account_number } = req.body;

            if (
                typeof bank_name !== 'string' ||
                typeof account_name !== 'string' ||
                typeof account_number !== 'string' ||
                !bank_name.trim() ||
                !account_name.trim() ||
                !/^[0-9]{10,15}$/.test(account_number.replace(/-/g, ''))
            ) {
                return res.status(400).json({
                    success: false,
                    error: 'กรุณากรอกข้อมูลบัญชีธนาคารให้ถูกต้อง',
                });
            }

            const result = await pool.query(
                `INSERT INTO user_bank_accounts (
           user_id, bank_name, account_name, account_number
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id)
         DO UPDATE SET
           bank_name = EXCLUDED.bank_name,
           account_name = EXCLUDED.account_name,
           account_number = EXCLUDED.account_number,
           updated_at = NOW()
         RETURNING bank_account_id, bank_name,
                   account_name, account_number, updated_at`,
                [
                    req.user.userId,
                    bank_name.trim(),
                    account_name.trim(),
                    account_number.replace(/-/g, ''),
                ]
            );

            res.json({
                success: true,
                message: 'บันทึกบัญชีธนาคารสำเร็จ',
                data: result.rows[0],
            });
        } catch (err) {
            console.error('Save bank account error:', err);
            res.status(500).json({
                success: false,
                error: 'ไม่สามารถบันทึกบัญชีธนาคารได้',
            });
        }
    });

    // ดูบัญชีของผู้ให้เช่าจากรายการเช่าที่ตนเป็นคู่สัญญา
    router.get('/rental/:rentalId', async (req, res) => {
        try {
            const { rentalId } = req.params;
            const userId = req.user.userId;

            const result = await pool.query(
                `SELECT
           b.bank_account_id,
           b.bank_name,
           b.account_name,
           b.account_number,
           r.total_price AS rental_amount
         FROM rentals r
         JOIN items i ON r.item_id = i.item_id
         LEFT JOIN user_bank_accounts b ON i.lender_id = b.user_id
         WHERE r.rental_id = $1
           AND (r.borrower_id = $2 OR i.lender_id = $2)`,
                [rentalId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่าหรือไม่มีสิทธิ์เข้าถึง',
                });
            }

            res.json({
                success: true,
                data: result.rows[0],
            });
        } catch (err) {
            console.error('Get rental bank account error:', err);
            res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดบัญชีธนาคารได้',
            });
        }
    });

    return router;
};