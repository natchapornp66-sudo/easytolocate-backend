
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const authenticateToken = require('../middleware/authMiddleware');

module.exports = (pool) => {
    const router = express.Router();

    const uploadDir = path.join(__dirname, '..', 'uploads', 'payments');
    fs.mkdirSync(uploadDir, { recursive: true });

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
        },
    });

    const upload = multer({
        storage,
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
            if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('รองรับเฉพาะ JPG, PNG และ WebP'));
            }
        },
    });

    // ทุก API ต้องเข้าสู่ระบบ
    router.use(authenticateToken);

    // ดึงข้อมูลการชำระเงินของรายการเช่า
    router.get('/:rentalId', async (req, res) => {
        try {
            const userId = req.user.userId || req.user.id;

            const rental = await pool.query(`
        SELECT r.borrower_id, i.lender_id
        FROM rentals r
        JOIN items i ON i.item_id = r.item_id
        WHERE r.rental_id = $1
      `, [req.params.rentalId]);

            if (!rental.rows.length) {
                return res.status(404).json({ success: false, error: 'ไม่พบรายการเช่า' });
            }

            const { borrower_id, lender_id } = rental.rows[0];

            if (String(userId) !== String(borrower_id) &&
                String(userId) !== String(lender_id)) {
                return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์ดูข้อมูล' });
            }

            const result = await pool.query(`
        SELECT *
        FROM rental_payments
        WHERE rental_id = $1
        ORDER BY created_at DESC
      `, [req.params.rentalId]);

            return res.json({ success: true, data: result.rows });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: 'โหลดข้อมูลไม่สำเร็จ' });
        }
    });

    // ผู้เช่าอัปโหลดสลิปค่าเช่า
    router.post('/:rentalId/slip', (req, res) => {
        upload.single('slip')(req, res, async (uploadError) => {
            if (uploadError) {
                return res.status(400).json({
                    success: false,
                    error: uploadError.message,
                });
            }

            if (!req.file) {
                return res.status(400).json({ success: false, error: 'กรุณาแนบสลิป' });
            }

            const removeFile = () => {
                fs.unlink(req.file.path, () => { });
            };

            try {
                const userId = req.user.userId || req.user.id;
                const rentalId = req.params.rentalId;

                const rentalResult = await pool.query(`
          SELECT r.borrower_id, r.total_price, i.lender_id
          FROM rentals r
          JOIN items i ON i.item_id = r.item_id
          WHERE r.rental_id = $1
        `, [rentalId]);

                if (!rentalResult.rows.length) {
                    removeFile();
                    return res.status(404).json({ success: false, error: 'ไม่พบรายการเช่า' });
                }

                const rental = rentalResult.rows[0];

                if (String(rental.borrower_id) !== String(userId)) {
                    removeFile();
                    return res.status(403).json({
                        success: false,
                        error: 'เฉพาะผู้เช่าเท่านั้นที่อัปโหลดสลิปได้',
                    });
                }

                const bankResult = await pool.query(`
          SELECT bank_account_id
          FROM user_bank_accounts
          WHERE user_id = $1
          ORDER BY updated_at DESC
          LIMIT 1
        `, [rental.lender_id]);

                if (!bankResult.rows.length) {
                    removeFile();
                    return res.status(400).json({
                        success: false,
                        error: 'ผู้ให้เช่ายังไม่ได้ตั้งค่าบัญชีธนาคาร',
                    });
                }

                const existing = await pool.query(`
          SELECT payment_id, status
          FROM rental_payments
          WHERE rental_id = $1 AND payment_type = 'rental'
            AND status IN ('submitted', 'verified')
          LIMIT 1
        `, [rentalId]);

                if (existing.rows.length) {
                    removeFile();
                    return res.status(409).json({
                        success: false,
                        error: 'รายการนี้มีสลิปที่รอตรวจสอบหรือยืนยันแล้ว',
                    });
                }

                const slipUrl = `/uploads/payments/${req.file.filename}`;

                const result = await pool.query(`
          INSERT INTO rental_payments (
            payment_id, rental_id, payment_type, amount,
            bank_account_id, slip_url, status, submitted_by,
            created_at, updated_at
          )
          VALUES (
            gen_random_uuid(), $1, 'rental', $2,
            $3, $4, 'submitted', $5, NOW(), NOW()
          )
          RETURNING *
        `, [
                    rentalId,
                    rental.total_price,
                    bankResult.rows[0].bank_account_id,
                    slipUrl,
                    userId,
                ]);

                return res.status(201).json({
                    success: true,
                    data: result.rows[0],
                });
            } catch (err) {
                removeFile();
                console.error(err);
                return res.status(500).json({
                    success: false,
                    error: 'อัปโหลดสลิปไม่สำเร็จ',
                });
            }
        });
    });

    // ผู้ให้เช่ายืนยันหรือปฏิเสธการรับเงิน

    router.patch('/:paymentId/verify', async (req, res) => {
        const userId = req.user.userId || req.user.id;
        const { action, rejection_reason } = req.body;

        if (!['verify', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'action ต้องเป็น verify หรือ reject',
            });
        }

        if (
            action === 'reject' &&
            !String(rejection_reason || '').trim()
        ) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาระบุเหตุผลที่ปฏิเสธ',
            });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // อัปเดตสลิป เฉพาะผู้ให้เช่าที่มีสิทธิ์
            const result = await client.query(`
            UPDATE rental_payments rp
            SET
                status = CASE
                    WHEN $2 = 'verify' THEN 'verified'
                    ELSE 'rejected'
                END,
                verified_by = CASE
                    WHEN $2 = 'verify' THEN $3::uuid
                    ELSE NULL
                END,
                verified_at = CASE
                    WHEN $2 = 'verify' THEN NOW()
                    ELSE NULL
                END,
                rejection_reason = CASE
                    WHEN $2 = 'reject' THEN $4
                    ELSE NULL
                END,
                updated_at = NOW()
            FROM rentals r
            JOIN items i ON i.item_id = r.item_id
            WHERE rp.payment_id = $1
              AND rp.rental_id = r.rental_id
              AND i.lender_id = $3
              AND rp.payment_type = 'rental'
              AND rp.status = 'submitted'
            RETURNING rp.*
        `, [
                req.params.paymentId,
                action,
                userId,
                String(rejection_reason || '').trim(),
            ]);

            if (!result.rows.length) {
                await client.query('ROLLBACK');

                return res.status(403).json({
                    success: false,
                    error: 'ไม่มีสิทธิ์ตรวจสอบ หรือรายการไม่ได้อยู่ในสถานะรอตรวจสอบ',
                });
            }

            // ยืนยันรับเงินแล้ว อัปเดตสถานะใน rentals ด้วย
            if (action === 'verify') {
                await client.query(`
                UPDATE rentals
                SET
                    payment_status = 'paid',
                    updated_at = NOW()
                WHERE rental_id = $1
            `, [result.rows[0].rental_id]);
            }

            await client.query('COMMIT');

            return res.json({
                success: true,
                message:
                    action === 'verify'
                        ? 'ยืนยันรับเงินสำเร็จ'
                        : 'ปฏิเสธสลิปเรียบร้อยแล้ว',
                data: result.rows[0],
            });

        } catch (err) {
            await client.query('ROLLBACK');

            console.error('Verify rental payment error:', err);

            return res.status(500).json({
                success: false,
                error: 'ตรวจสอบการชำระเงินไม่สำเร็จ',
            });

        } finally {
            client.release();
        }
    });


    return router;
};
