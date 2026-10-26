
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { uploadRoot } = require('../config');
const storageService = require('../storage');
const authenticateToken = require('../middleware/authMiddleware');
function validSlipFile(file) {
    const fd = fs.openSync(file.path, 'r');
    try {
        const b = Buffer.alloc(12), n = fs.readSync(fd, b, 0, 12, 0);
        if (file.mimetype === 'image/png') return n >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
        if (file.mimetype === 'image/jpeg') return n >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
        return file.mimetype === 'image/webp' && n >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    } finally { fs.closeSync(fd); }
}

module.exports = (pool) => {
    const router = express.Router();

    const uploadDir = path.join(uploadRoot, 'payments');
    fs.mkdirSync(uploadDir, { recursive: true });

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
            cb(null, `${crypto.randomUUID()}${extension || ''}`);
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
    // อ่านรูปสลิป เฉพาะผู้เช่าหรือผู้ให้เช่าของรายการ
    router.get('/slip-file/:paymentId', async (req, res) => {
        try {
            const userId = req.user.userId || req.user.id;

            const result = await pool.query(`
            SELECT rp.slip_url
            FROM rental_payments rp
            JOIN rentals r ON r.rental_id = rp.rental_id
            JOIN items i ON i.item_id = r.item_id
            WHERE rp.payment_id = $1
              AND (r.borrower_id = $2 OR i.lender_id = $2)
        `, [req.params.paymentId, userId]);

            if (!result.rows.length) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบสลิปหรือไม่มีสิทธิ์เข้าถึง'
                });
            }

            const filename = path.basename(result.rows[0].slip_url);
            const filePath = path.join(uploadDir, filename);

            res.set('Cache-Control', 'private, no-store');
            return storageService.send(res, 'payments', filename);

        } catch (err) {
            console.error('Read private slip error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถเปิดสลิปได้'
            });
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

            let client, committed = false;
            try {
                if (!validSlipFile(req.file)) {
                    removeFile();
                    return res.status(400).json({ success: false, error: 'ไฟล์สลิปต้องเป็นรูปภาพ JPG, PNG หรือ WebP จริง' });
                }
                const userId = req.user.userId || req.user.id;
                const rentalId = req.params.rentalId;
                client = await pool.connect();
                await client.query('BEGIN');
                const rentalResult = await client.query(`
          SELECT r.borrower_id, r.total_price, r.status, r.payment_status, i.lender_id
          FROM rentals r
          JOIN items i ON i.item_id = r.item_id
          WHERE r.rental_id = $1
          FOR UPDATE OF r
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

                if (rental.status !== 'approved' || rental.payment_status === 'paid') {
                    removeFile();
                    return res.status(409).json({ success: false, error: 'รายการเช่านี้ไม่อยู่ในสถานะรอชำระค่าเช่า' });
                }
                const bankResult = await client.query(`
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

                const existing = await client.query(`
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

                await storageService.persist('payments', [req.file]);
                const slipUrl = `/uploads/payments/${req.file.filename}`;

                const result = await client.query(`
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

                await client.query('COMMIT');
                committed = true;
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
            } finally {
                if (client) { if (!committed) await client.query('ROLLBACK').catch(() => {}); client.release(); }
            }
        });
    });

    // ผู้เช่าอัปโหลดสลิปชำระค่าปรับ
    router.post('/:rentalId/fine-slip', (req, res) => {
        upload.single('slip')(req, res, async (uploadError) => {
            if (uploadError) {
                console.error('Fine slip upload error:', uploadError);
                return res.status(400).json({
                    success: false,
                    error: 'อัปโหลดสลิปไม่สำเร็จ กรุณาตรวจสอบประเภทและขนาดไฟล์',
                });
            }


            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'กรุณาแนบสลิปค่าปรับ',
                });
            }

            const removeFile = () => {
                fs.unlink(req.file.path, (err) => {
                    if (err && err.code !== 'ENOENT') {
                        console.error('Fine slip cleanup error:', err);
                    }
                });
            };

            let client;

            try {
                if (!validSlipFile(req.file)) {
                    removeFile();
                    return res.status(400).json({ success: false, error: 'ไฟล์สลิปต้องเป็นรูปภาพ JPG, PNG หรือ WebP จริง' });
                }
                const userId = req.user.userId || req.user.id;
                const rentalId = req.params.rentalId;

                client = await pool.connect();
                await client.query('BEGIN');

                const rentalResult = await client.query(`
                    SELECT
                        r.borrower_id,
                        r.status,
                        r.fine_status,
                        r.fine_amount,
                        i.lender_id
                    FROM rentals r
                    JOIN items i ON i.item_id = r.item_id
                    WHERE r.rental_id = $1
                    FOR UPDATE OF r
                `, [rentalId]);

                if (!rentalResult.rows.length) {
                    await client.query('ROLLBACK');
                    removeFile();
                    return res.status(404).json({
                        success: false,
                        error: 'ไม่พบรายการเช่า',
                    });
                }

                const rental = rentalResult.rows[0];

                if (String(rental.borrower_id) !== String(userId)) {
                    await client.query('ROLLBACK');
                    removeFile();
                    return res.status(403).json({
                        success: false,
                        error: 'เฉพาะผู้เช่าเท่านั้นที่ชำระค่าปรับได้',
                    });
                }

                // ระงับการรับสลิปค่าปรับระหว่างมีข้อพิพาทที่ยังเปิดอยู่
                // Rental ถูกล็อกด้วย FOR UPDATE แล้วด้านบน
                const openDisputeResult = await client.query(`
                    SELECT dispute_id
                    FROM disputes
                    WHERE rental_id = $1
                      AND status = 'open'
                    LIMIT 1
                `, [rentalId]);

                if (openDisputeResult.rows.length > 0) {
                    await client.query('ROLLBACK');
                    removeFile();

                    return res.status(409).json({
                        success: false,
                        error: 'รายการนี้มีข้อพิพาทที่กำลังพิจารณา กรุณารอผลการตัดสินก่อนชำระค่าปรับ'
                    });
                }


                if (
                    rental.status !== 'fine_pending' ||
                    rental.fine_status !== 'confirmed' ||
                    Number(rental.fine_amount) <= 0
                ) {
                    await client.query('ROLLBACK');
                    removeFile();
                    return res.status(400).json({
                        success: false,
                        error: 'รายการนี้ยังไม่พร้อมชำระค่าปรับ',
                    });
                }

                const existing = await client.query(`
                    SELECT payment_id
                    FROM rental_payments
                    WHERE rental_id = $1
                      AND payment_type = 'fine'
                      AND status IN ('submitted', 'verified')
                    LIMIT 1
                `, [rentalId]);

                if (existing.rows.length) {
                    await client.query('ROLLBACK');
                    removeFile();
                    return res.status(409).json({
                        success: false,
                        error: 'มีสลิปค่าปรับที่รอตรวจสอบหรือยืนยันแล้ว',
                    });
                }

                const bankResult = await client.query(`
                    SELECT bank_account_id
                    FROM user_bank_accounts
                    WHERE user_id = $1
                    ORDER BY updated_at DESC
                    LIMIT 1
                `, [rental.lender_id]);

                if (!bankResult.rows.length) {
                    await client.query('ROLLBACK');
                    removeFile();
                    return res.status(400).json({
                        success: false,
                        error: 'ผู้ให้เช่ายังไม่ได้ตั้งค่าบัญชีธนาคาร',
                    });
                }

                await storageService.persist('payments', [req.file]);
                const slipUrl = `/uploads/payments/${req.file.filename}`;

                const result = await client.query(`
                    INSERT INTO rental_payments (
                        payment_id,
                        rental_id,
                        payment_type,
                        amount,
                        bank_account_id,
                        slip_url,
                        status,
                        submitted_by,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1,
                        'fine',
                        $2,
                        $3,
                        $4,
                        'submitted',
                        $5,
                        NOW(),
                        NOW()
                    )
                    RETURNING *
                `, [
                    rentalId,
                    rental.fine_amount,
                    bankResult.rows[0].bank_account_id,
                    slipUrl,
                    userId,
                ]);

                await client.query('COMMIT');

                return res.status(201).json({
                    success: true,
                    message: 'ส่งสลิปค่าปรับเรียบร้อยแล้ว',
                    data: result.rows[0],
                });

            } catch (err) {
                if (client) {
                    try {
                        await client.query('ROLLBACK');
                    } catch (rollbackError) {
                        console.error('Rollback fine slip error:', rollbackError);
                    }
                }

                removeFile();
                console.error('Upload fine slip error:', err);

                return res.status(500).json({
                    success: false,
                    error: 'อัปโหลดสลิปค่าปรับไม่สำเร็จ',
                });

            } finally {
                if (client) {
                    client.release();
                }
            }
        });
    });



    // ผู้ให้เช่าตรวจสอบสลิปค่าเช่าหรือค่าปรับ
    router.patch('/:paymentId/verify', async (req, res) => {
        const userId = req.user.userId || req.user.id;
        const { action, rejection_reason } = req.body || {};

        if (!['verify', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'action ต้องเป็น verify หรือ reject',
            });
        }

        const reason = String(rejection_reason || '').trim();

        if (action === 'reject' && !reason) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาระบุเหตุผลที่ปฏิเสธ',
            });
        }

        let client;

        try {
            client = await pool.connect();
            await client.query('BEGIN');

            // หารายการเช่าที่เชื่อมกับสลิป
            const paymentLookup = await client.query(`
                SELECT rental_id
                FROM rental_payments
                WHERE payment_id = $1
            `, [req.params.paymentId]);

            if (!paymentLookup.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการชำระเงิน',
                });
            }

            // ล็อกรายการเช่าก่อนตรวจสลิป เพื่อป้องกันการแก้ไขพร้อมกัน
            const rentalResult = await client.query(`
                SELECT
                    r.rental_id,
                    r.status,
                    r.fine_status,
                    r.payment_status,
                    i.lender_id
                FROM rentals r
                JOIN items i ON i.item_id = r.item_id
                WHERE r.rental_id = $1
                FOR UPDATE OF r
            `, [paymentLookup.rows[0].rental_id]);

            if (!rentalResult.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่า',
                });
            }

            const rental = rentalResult.rows[0];

            if (String(rental.lender_id) !== String(userId)) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    error: 'เฉพาะผู้ให้เช่าเท่านั้นที่ตรวจสอบสลิปได้',
                });
            }

            // ล็อกสลิปและตรวจว่ายังรอตรวจสอบ
            const paymentResult = await client.query(`
                SELECT *
                FROM rental_payments
                WHERE payment_id = $1
                  AND rental_id = $2
                FOR UPDATE
            `, [req.params.paymentId, rental.rental_id]);

            if (!paymentResult.rows.length ||
                paymentResult.rows[0].status !== 'submitted') {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: 'สลิปนี้ไม่ได้อยู่ในสถานะรอตรวจสอบ',
                });
            }

            const payment = paymentResult.rows[0];
            if (payment.payment_type === 'rental' && action === 'verify' &&
                (rental.status !== 'approved' || rental.payment_status === 'paid')) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: 'รายการเช่านี้ไม่อยู่ในสถานะรอตรวจรับค่าเช่า' });
            }

            if (!['rental', 'fine'].includes(payment.payment_type)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'ประเภทการชำระเงินไม่ถูกต้อง',
                });
            }

            // ป้องกันการตรวจรับค่าปรับขณะมีข้อพิพาท
            // ไม่กระทบการตรวจสลิปค่าเช่าปกติ
            if (payment.payment_type === 'fine') {
                const openDisputeResult = await client.query(`
                    SELECT dispute_id
                    FROM disputes
                    WHERE rental_id = $1
                      AND status = 'open'
                    LIMIT 1
                `, [rental.rental_id]);

                if (openDisputeResult.rows.length > 0) {
                    await client.query('ROLLBACK');

                    return res.status(409).json({
                        success: false,
                        error: 'ไม่สามารถตรวจรับสลิปค่าปรับได้ เนื่องจากรายการนี้อยู่ระหว่างการพิจารณาข้อพิพาท'
                    });
                }
            }


            // ตรวจเงื่อนไขเฉพาะสลิปค่าปรับ
            if (payment.payment_type === 'fine') {
                if (
                    rental.status !== 'fine_pending' ||
                    rental.fine_status !== 'confirmed'
                ) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: 'รายการเช่ายังไม่พร้อมตรวจสอบค่าปรับ',
                    });
                }
            }

            // บันทึกผลการตรวจสอบสลิป
            const result = await client.query(`
                UPDATE rental_payments
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
                WHERE payment_id = $1
                  AND status = 'submitted'
                RETURNING *
            `, [
                req.params.paymentId,
                action,
                userId,
                reason,
            ]);

            if (!result.rows.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: 'สลิปนี้ถูกตรวจสอบไปแล้ว',
                });
            }

            // อัปเดตรายการเช่าเฉพาะเมื่อยืนยันว่าได้รับเงินจริง
            if (action === 'verify') {
                if (payment.payment_type === 'rental') {
                    await client.query(`
                        UPDATE rentals
                        SET
                            payment_status = 'paid',
                            updated_at = NOW()
                        WHERE rental_id = $1 AND status = 'approved'
                    `, [rental.rental_id]);
                }

                if (payment.payment_type === 'fine') {
                    await client.query(`
                        UPDATE rentals
                        SET
                            status = 'completed',
                            updated_at = NOW()
                        WHERE rental_id = $1
                          AND status = 'fine_pending'
                          AND fine_status = 'confirmed'
                    `, [rental.rental_id]);
                }
            }

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: action === 'verify'
                    ? (payment.payment_type === 'fine'
                        ? 'ยืนยันรับค่าปรับสำเร็จ'
                        : 'ยืนยันรับค่าเช่าสำเร็จ')
                    : 'ปฏิเสธสลิปเรียบร้อยแล้ว',
                data: result.rows[0],
            });

        } catch (err) {
            if (client) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Payment rollback error:', rollbackError);
                }
            }

            console.error('Verify rental payment error:', err);

            return res.status(500).json({
                success: false,
                error: 'ตรวจสอบการชำระเงินไม่สำเร็จ',
            });

        } finally {
            if (client) {
                client.release();
            }
        }
    });


    return router;
};
