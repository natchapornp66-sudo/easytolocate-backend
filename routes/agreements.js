const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');

module.exports = (pool) => {
    const router = express.Router();

    // ทุก API ต้องเข้าสู่ระบบก่อน
    router.use(authenticateToken);

    // ยอมรับสัญญาเช่า (แยกสิทธิ์ผู้เช่าและผู้ให้เช่า)
    router.post('/', async (req, res) => {
        const { rental_id } = req.body;
        const userId = req.user.userId;

        if (!rental_id) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาระบุ rental_id'
            });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // ตรวจสอบรายการเช่าและล็อกแถวระหว่างทำรายการ
            const rentalResult = await client.query(`
            SELECT
                r.rental_id,
                r.borrower_id,
                r.status,
                i.lender_id
            FROM rentals r
            JOIN items i ON r.item_id = i.item_id
            WHERE r.rental_id = $1
            FOR UPDATE OF r
            `, [rental_id]);

            if (rentalResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่า'
                });
            }

            const rental = rentalResult.rows[0];

            const isBorrower = String(rental.borrower_id) === String(userId);
            const isLender = String(rental.lender_id) === String(userId);

            if (!isBorrower && !isLender) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    error: 'คุณไม่มีสิทธิ์ยอมรับสัญญานี้'
                });
            }

            // ต้องมีสัญญาที่สร้างไว้แล้วก่อนยอมรับ
            const agreementResult = await client.query(
                `SELECT *
                 FROM agreements
                 WHERE rental_id = $1
                 FOR UPDATE`,
                [rental_id]
            );

            if (agreementResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ยังไม่มีสัญญาสำหรับรายการเช่านี้'
                });
            }

            const agreement = agreementResult.rows[0];

            // ไม่อนุญาตให้กดยอมรับแทนอีกฝ่าย
            const result = await client.query(
                isBorrower
                    ? `UPDATE agreements
                       SET borrower_accepted = TRUE,
                           borrower_accepted_at = COALESCE(
                               borrower_accepted_at,
                               CURRENT_TIMESTAMP
                           ),
                           updated_at = CURRENT_TIMESTAMP
                       WHERE rental_id = $1
                       RETURNING *`
                    : `UPDATE agreements
                       SET lender_accepted = TRUE,
                           lender_accepted_at = COALESCE(
                               lender_accepted_at,
                               CURRENT_TIMESTAMP
                           ),
                           updated_at = CURRENT_TIMESTAMP
                       WHERE rental_id = $1
                       RETURNING *`,
                [rental_id]
            );

            const updated = result.rows[0];

            // บันทึกเวลาที่ทั้งสองฝ่ายยอมรับครบ
            if (
                updated.borrower_accepted &&
                updated.lender_accepted &&
                !agreement.accepted_at
            ) {
                await client.query(
                    `UPDATE agreements
                     SET accepted_at = CURRENT_TIMESTAMP
                     WHERE rental_id = $1`,
                    [rental_id]
                );
            }

            const finalResult = await client.query(
                `SELECT *
                 FROM agreements
                 WHERE rental_id = $1`,
                [rental_id]
            );

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: 'ยอมรับสัญญาเรียบร้อยแล้ว',
                fully_accepted:
                    finalResult.rows[0].borrower_accepted &&
                    finalResult.rows[0].lender_accepted,
                data: finalResult.rows[0]
            });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Agreement error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถยอมรับสัญญาได้'
            });
        } finally {
            client.release();
        }
    });

    // ดึงรายละเอียดสัญญา เฉพาะคู่สัญญา
    router.get('/rental/:rental_id', async (req, res) => {
        const { rental_id } = req.params;
        const userId = req.user.userId;

        try {
            const result = await pool.query(`
            SELECT
                a.*,
                r.status AS rental_status,
                i.title AS item_title
                FROM agreements a
                JOIN rentals r ON a.rental_id = r.rental_id
                JOIN items i ON r.item_id = i.item_id
                WHERE a.rental_id = $1
            AND (
                r.borrower_id = $2
                OR i.lender_id = $2
                 )
            `, [rental_id, userId]);

            return res.json({
                success: true,
                data: result.rows[0] || null
            });

        } catch (err) {
            console.error('Get agreement error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดสัญญาได้'
            });
        }
    });

    return router;
};