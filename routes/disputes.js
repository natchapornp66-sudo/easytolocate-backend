
const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { uploadRoot } = require('../config');
const storageService = require('../storage');

const evidenceDir = path.join(
    uploadRoot,
    'disputes'
);

fs.mkdirSync(evidenceDir, { recursive: true });

const evidenceStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, evidenceDir);
    },
    filename: (req, file, cb) => {
        const ext = file.mimetype === 'image/png'
            ? '.png'
            : '.jpg';

        cb(null, `${crypto.randomUUID()}${ext}`);
    },
});

const evidenceUpload = multer({
    storage: evidenceStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 5,
    },
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype === 'image/jpeg' ||
            file.mimetype === 'image/png'
        ) {
            cb(null, true);
        } else {
            cb(new Error('รองรับเฉพาะ JPG และ PNG'));
        }
    },
});

module.exports = (pool) => {
    const router = express.Router();

    router.use(authenticateToken);

    const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


    // รายการเช่าที่ผู้ใช้สามารถเลือกเพื่อยื่นข้อพิพาท
    router.get('/eligible-rentals', async (req, res) => {
        try {
            const userId = req.user.userId;

            const result = await pool.query(
                `
        SELECT
          r.rental_id,
          r.status AS rental_status,
          r.created_at,
          r.fine_amount,
          r.fine_status,

          i.title AS item_title,

          borrower.full_name AS borrower_name,
          lender.full_name AS lender_name,

          CASE
            WHEN r.borrower_id = $1 THEN 'borrower'
            WHEN i.lender_id = $1 THEN 'lender'
          END AS my_role,

          EXISTS (
            SELECT 1
            FROM disputes d
            WHERE d.rental_id = r.rental_id
              AND d.status = 'open'
          ) AS has_open_dispute

        FROM rentals r

        JOIN items i
          ON i.item_id = r.item_id

        LEFT JOIN users borrower
          ON borrower.user_id = r.borrower_id

        LEFT JOIN users lender
          ON lender.user_id = i.lender_id

        WHERE
          r.borrower_id = $1
          OR i.lender_id = $1

        ORDER BY r.created_at DESC
        `,
                [userId]
            );

            return res.json({
                success: true,
                data: result.rows,
            });
        } catch (error) {
            console.error('Eligible dispute rentals error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดรายการเช่าได้',
            });
        }
    });


    // 1. ยื่นข้อพิพาท
    router.post('/', async (req, res) => {
        const { rental_id, category, reason } = req.body;
        const userId = req.user.userId;

        if (!uuidRegex.test(rental_id || '')) {
            return res.status(400).json({
                success: false,
                error: 'รหัสรายการเช่าไม่ถูกต้อง',
            });
        }

        const allowedCategories = [
            'fine',
            'damage',
            'return',
            'other',
        ];

        if (!allowedCategories.includes(category)) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาเลือกประเภทข้อพิพาท',
            });
        }

        if (
            typeof reason !== 'string' ||
            reason.trim().length < 10 ||
            reason.trim().length > 3000
        ) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาระบุรายละเอียด 10–3000 ตัวอักษร',
            });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const rentalResult = await client.query(
                `SELECT r.rental_id, r.borrower_id, r.fine_amount, r.status, i.lender_id
         FROM rentals r
         JOIN items i ON i.item_id = r.item_id
         WHERE r.rental_id = $1
         FOR UPDATE OF r`,
                [rental_id]
            );

            if (rentalResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่า',
                });
            }

            const rental = rentalResult.rows[0];

            if (
                String(rental.borrower_id) !== String(userId) &&
                String(rental.lender_id) !== String(userId)
            ) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    error: 'คุณไม่มีสิทธิ์ยื่นข้อพิพาทสำหรับรายการนี้',
                });
            }

            // ตรวจรายการชำระค่าปรับที่ยังรอตรวจสอบ
            // Rental ถูกล็อกด้วย FOR UPDATE แล้วด้านบน
            if (category === 'fine') {
                if (!(Number(rental.fine_amount) > 0) ||
                    !['fine_pending', 'completed'].includes(rental.status)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'รายการนี้ยังไม่มีค่าปรับที่สามารถยื่นข้อพิพาทได้'
                    });
                }
                const pendingPayment = await client.query(`
                    SELECT payment_id
                    FROM rental_payments
                    WHERE rental_id = $1
                      AND payment_type = 'fine'
                      AND status = 'submitted'
                    LIMIT 1
                `, [rental_id]);

                if (pendingPayment.rows.length > 0) {
                    await client.query('ROLLBACK');

                    return res.status(409).json({
                        success: false,
                        error: 'รายการนี้มีสลิปค่าปรับที่รอตรวจสอบ กรุณารอผลการตรวจสอบสลิปก่อนยื่นข้อพิพาทค่าปรับ'
                    });
                }
            }


            // ป้องกันคำร้องที่ยังเปิดอยู่ซ้ำในรายการเช่าเดียวกัน
            const existing = await client.query(
                `SELECT dispute_id
         FROM disputes
         WHERE rental_id = $1 AND status = 'open'
         LIMIT 1`,
                [rental_id]
            );

            if (existing.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: 'รายการเช่านี้มีข้อพิพาทที่รอพิจารณาอยู่แล้ว',
                });
            }

            const result = await client.query(
                `INSERT INTO disputes (
           rental_id, reported_by, category,
           reason, status, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, 'open', NOW(), NOW())
         RETURNING *`,
                [rental_id, userId, category, reason.trim()]
            );

            await client.query(
                `INSERT INTO dispute_history (
           dispute_id, action_by, action_type,
           new_status, details
         )
         VALUES ($1, $2, 'created', 'open', $3)`,
                [result.rows[0].dispute_id, userId, 'สร้างคำร้องข้อพิพาท']
            );

            await client.query('COMMIT');

            return res.status(201).json({
                success: true,
                message: 'ยื่นข้อพิพาทเรียบร้อยแล้ว',
                data: result.rows[0],
            });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Create dispute error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถยื่นข้อพิพาทได้',
            });
        } finally {
            client.release();
        }
    });

    // ======================================
    // GET: รายการคืนเงินค่าปรับของผู้ใช้
    // ======================================
    router.get('/refunds', async (req, res) => {
        try {
            const userId = req.user.userId;

            const result = await pool.query(`
                SELECT
                    fr.refund_id,
                    fr.dispute_id,
                    fr.rental_id,
                    fr.original_fine_amount,
                    fr.adjusted_fine_amount,
                    fr.refund_amount,
                    fr.status,
                    fr.created_at,
                    fr.processed_at,
                    d.decision,
                    d.decision_reason,
                    i.title AS item_title
                FROM fine_refunds fr
                JOIN disputes d
                    ON d.dispute_id = fr.dispute_id
                JOIN rentals r
                    ON r.rental_id = fr.rental_id
                JOIN items i
                    ON i.item_id = r.item_id
                WHERE
                    r.borrower_id = $1
                    OR i.lender_id = $1
                ORDER BY fr.created_at DESC
            `, [userId]);

            return res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            console.error('Get fine refunds error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดข้อมูลคืนเงินค่าปรับได้'
            });
        }
    });


    // 2. รายการข้อพิพาทที่ผู้ใช้เกี่ยวข้อง
    router.get('/', async (req, res) => {
        try {
            const userId = req.user.userId;

            const result = await pool.query(
                `SELECT
           d.*,
           i.title AS item_title,
           borrower.full_name AS borrower_name,
           lender.full_name AS lender_name,
           reporter.full_name AS reporter_name
         FROM disputes d
         JOIN rentals r ON r.rental_id = d.rental_id
         JOIN items i ON i.item_id = r.item_id
         LEFT JOIN users borrower
           ON borrower.user_id = r.borrower_id
         LEFT JOIN users lender
           ON lender.user_id = i.lender_id
         LEFT JOIN users reporter
           ON reporter.user_id = d.reported_by
         WHERE r.borrower_id = $1 OR i.lender_id = $1
         ORDER BY d.created_at DESC`,
                [userId]
            );

            return res.json({
                success: true,
                data: result.rows,
            });
        } catch (err) {
            console.error('List disputes error:', err);
            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดรายการข้อพิพาทได้',
            });
        }
    });

    // 3. รายละเอียดข้อพิพาท
    router.get('/:id', async (req, res) => {
        const { id } = req.params;

        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสข้อพิพาทไม่ถูกต้อง',
            });
        }

        try {
            const userId = req.user.userId;

            const result = await pool.query(
                `SELECT
           d.*,
           i.title AS item_title,
           borrower.full_name AS borrower_name,
           lender.full_name AS lender_name,
           reporter.full_name AS reporter_name
         FROM disputes d
         JOIN rentals r ON r.rental_id = d.rental_id
         JOIN items i ON i.item_id = r.item_id
         LEFT JOIN users borrower
           ON borrower.user_id = r.borrower_id
         LEFT JOIN users lender
           ON lender.user_id = i.lender_id
         LEFT JOIN users reporter
           ON reporter.user_id = d.reported_by
         WHERE d.dispute_id = $1
           AND (r.borrower_id = $2 OR i.lender_id = $2)`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาทหรือไม่มีสิทธิ์เข้าถึง',
                });
            }

            return res.json({
                success: true,
                data: result.rows[0],
            });
        } catch (err) {
            console.error('Get dispute error:', err);
            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดรายละเอียดข้อพิพาทได้',
            });
        }
    });

    // ตรวจว่าผู้ใช้เกี่ยวข้องกับข้อพิพาทหรือเป็น Admin
    const checkDisputeAccess = async (req, res, next) => {
        const { id } = req.params;
        const userId = req.user.userId;

        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสข้อพิพาทไม่ถูกต้อง',
            });
        }

        try {
            const result = await pool.query(
                `SELECT d.dispute_id, d.status,
                r.borrower_id, i.lender_id,
                u.role
         FROM disputes d
         JOIN rentals r ON r.rental_id = d.rental_id
         JOIN items i ON i.item_id = r.item_id
         JOIN users u ON u.user_id = $2
         WHERE d.dispute_id = $1`,
                [id, userId]
            );

            if (!result.rows.length) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาท',
                });
            }

            const dispute = result.rows[0];

            const allowed =
                String(dispute.borrower_id) === String(userId) ||
                String(dispute.lender_id) === String(userId) ||
                dispute.role === 'admin';

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'ไม่มีสิทธิ์เข้าถึงข้อพิพาทนี้',
                });
            }

            req.disputeAccess = dispute;
            next();
        } catch (err) {
            console.error('Check dispute access error:', err);
            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถตรวจสอบสิทธิ์ได้',
            });
        }
    };

    // อัปโหลดหลักฐานข้อพิพาท
    router.post(
        '/:id/evidence',
        checkDisputeAccess,
        (req, res, next) => {
            if (req.disputeAccess.status !== 'open') {
                return res.status(409).json({
                    success: false,
                    error: 'ข้อพิพาทนี้ปิดแล้ว ไม่สามารถเพิ่มหลักฐานได้',
                });
            }

            evidenceUpload.array('photos', 5)(req, res, (err) => {
                if (err) {
                    return res.status(400).json({
                        success: false,
                        error: err.message || 'อัปโหลดไฟล์ไม่สำเร็จ',
                    });
                }
                next();
            });
        },
        async (req, res) => {
            const { id } = req.params;
            const userId = req.user.userId;
            const files = req.files || [];

            const cleanup = async () => {
                await Promise.all(
                    files.map((file) =>
                        fs.promises.unlink(file.path).catch(() => { })
                    )
                );
            };

            if (files.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'กรุณาเลือกรูปอย่างน้อย 1 รูป',
                });
            }

            // ตรวจลายเซ็นไฟล์จริง ไม่เชื่อ MIME type เพียงอย่างเดียว
            const isValidImage = (file) => {
                const buffer = Buffer.alloc(12);
                const fd = fs.openSync(file.path, 'r');

                try {
                    const bytes = fs.readSync(fd, buffer, 0, 12, 0);

                    if (file.mimetype === 'image/png') {
                        return bytes >= 8 &&
                            buffer.subarray(0, 8).equals(
                                Buffer.from('89504e470d0a1a0a', 'hex')
                            );
                    }

                    return bytes >= 3 &&
                        buffer[0] === 0xff &&
                        buffer[1] === 0xd8 &&
                        buffer[2] === 0xff;
                } finally {
                    fs.closeSync(fd);
                }
            };

            let client;
            let committed = false;

            try {
                if (!files.every(isValidImage)) {
                    await cleanup();
                    return res.status(400).json({
                        success: false,
                        error: 'พบไฟล์ที่ไม่ใช่รูปภาพ JPG หรือ PNG',
                    });
                }

                client = await pool.connect();
                await client.query('BEGIN');

                // ล็อกข้อพิพาทเพื่อป้องกันการเพิ่มรูปพร้อมกันเกินจำนวน
                const disputeResult = await client.query(
                    `SELECT status
           FROM disputes
           WHERE dispute_id = $1
           FOR UPDATE`,
                    [id]
                );

                if (
                    !disputeResult.rows.length ||
                    disputeResult.rows[0].status !== 'open'
                ) {
                    await client.query('ROLLBACK');
                    await cleanup();

                    return res.status(409).json({
                        success: false,
                        error: 'ข้อพิพาทนี้ไม่เปิดรับหลักฐานแล้ว',
                    });
                }

                const countResult = await client.query(
                    `SELECT COUNT(*)::int AS total
           FROM dispute_evidence
           WHERE dispute_id = $1 AND uploaded_by = $2`,
                    [id, userId]
                );

                if (countResult.rows[0].total + files.length > 5) {
                    await client.query('ROLLBACK');
                    await cleanup();

                    return res.status(400).json({
                        success: false,
                        error: 'แนบหลักฐานได้สูงสุด 5 รูปต่อผู้ใช้ต่อข้อพิพาท',
                    });
                }

                await storageService.persist('disputes', files);
                const evidence = [];

                for (const file of files) {
                    const result = await client.query(
                        `INSERT INTO dispute_evidence
               (dispute_id, uploaded_by, file_path)
             VALUES ($1, $2, $3)
             RETURNING
               evidence_id, dispute_id, uploaded_by, created_at`,
                        [id, userId, file.filename]
                    );

                    evidence.push(result.rows[0]);
                }

                await client.query(
                    `INSERT INTO dispute_history
             (dispute_id, action_by, action_type, details)
           VALUES ($1, $2, 'evidence_uploaded', $3)`,
                    [id, userId, `แนบหลักฐาน ${files.length} รูป`]
                );

                await client.query('COMMIT');
                committed = true;

                return res.status(201).json({
                    success: true,
                    message: 'อัปโหลดหลักฐานข้อพิพาทสำเร็จ',
                    data: evidence,
                });
            } catch (err) {
                if (client && !committed) {
                    await client.query('ROLLBACK').catch(() => { });
                }

                if (!committed) await cleanup();

                console.error('Upload dispute evidence error:', err);

                return res.status(500).json({
                    success: false,
                    error: 'ไม่สามารถบันทึกหลักฐานข้อพิพาทได้',
                });
            } finally {
                if (client) client.release();
            }
        }
    );

    // ดูรายการหลักฐานของข้อพิพาท
    router.get(
        '/:id/evidence',
        checkDisputeAccess,
        async (req, res) => {
            try {
                const { id } = req.params;

                const result = await pool.query(
                    `SELECT
             e.evidence_id,
             e.dispute_id,
             e.uploaded_by,
             u.full_name AS uploader_name,
             e.description,
             e.created_at
           FROM dispute_evidence e
           LEFT JOIN users u
             ON u.user_id = e.uploaded_by
           WHERE e.dispute_id = $1
           ORDER BY e.created_at ASC, e.evidence_id ASC`,
                    [id]
                );

                return res.json({
                    success: true,
                    data: result.rows,
                });
            } catch (err) {
                console.error('List dispute evidence error:', err);

                return res.status(500).json({
                    success: false,
                    error: 'ไม่สามารถโหลดหลักฐานข้อพิพาทได้',
                });
            }
        }
    );

    // เปิดภาพหลักฐาน โดยตรวจสิทธิ์ก่อนส่งไฟล์
    router.get(
        '/:id/evidence/:evidenceId/file',
        checkDisputeAccess,
        async (req, res) => {
            const { id, evidenceId } = req.params;

            if (!uuidRegex.test(evidenceId)) {
                return res.status(400).json({
                    success: false,
                    error: 'รหัสหลักฐานไม่ถูกต้อง',
                });
            }

            try {
                const result = await pool.query(
                    `SELECT evidence_id, file_path
           FROM dispute_evidence
           WHERE evidence_id = $1
             AND dispute_id = $2`,
                    [evidenceId, id]
                );

                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'ไม่พบหลักฐาน',
                    });
                }

                const filename = result.rows[0].file_path;

                // ยอมรับเฉพาะชื่อไฟล์ UUID ที่ระบบสร้างเอง
                const validFilename =
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/i;

                if (
                    typeof filename !== 'string' ||
                    !validFilename.test(filename)
                ) {
                    return res.status(400).json({
                        success: false,
                        error: 'รูปแบบไฟล์หลักฐานไม่ถูกต้อง',
                    });
                }

                const filePath = path.join(evidenceDir, filename);

                if (!await storageService.exists('disputes', filename)) {
                    return res.status(404).json({
                        success: false,
                        error: 'ไม่พบไฟล์หลักฐานในระบบ',
                    });
                }

                res.setHeader('Cache-Control', 'private, no-store');
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader(
                    'Content-Type',
                    filename.toLowerCase().endsWith('.png')
                        ? 'image/png'
                        : 'image/jpeg'
                );

                return storageService.send(res, 'disputes', filename);
            } catch (err) {
                console.error('Open dispute evidence error:', err);

                if (!res.headersSent) {
                    return res.status(500).json({
                        success: false,
                        error: 'ไม่สามารถเปิดไฟล์หลักฐานได้',
                    });
                }
            }
        }
    );

    // ======================================
    // GET: อ่านคำชี้แจงของคู่กรณี
    // ======================================
    router.get(
        '/:id/messages',
        checkDisputeAccess,
        async (req, res) => {
            const { id } = req.params;

            try {
                const result = await pool.query(
                    `
          SELECT
            m.message_id,
            m.dispute_id,
            m.sender_id,
            m.message,
            m.created_at,
            u.full_name AS sender_name,

            CASE
              WHEN m.sender_id = r.borrower_id
                THEN 'borrower'
              WHEN m.sender_id = i.lender_id
                THEN 'lender'
              ELSE 'admin'
            END AS sender_role

          FROM dispute_messages m

          JOIN disputes d
            ON d.dispute_id = m.dispute_id

          JOIN rentals r
            ON r.rental_id = d.rental_id

          JOIN items i
            ON i.item_id = r.item_id

          JOIN users u
            ON u.user_id = m.sender_id

          WHERE m.dispute_id = $1

          ORDER BY
            m.created_at ASC,
            m.message_id ASC
          `,
                    [id]
                );

                return res.json({
                    success: true,
                    data: result.rows,
                });
            } catch (error) {
                console.error('Get dispute messages error:', error);

                return res.status(500).json({
                    success: false,
                    error: 'ไม่สามารถโหลดคำชี้แจงได้',
                });
            }
        }
    );

    // ======================================
    // POST: ส่งคำชี้แจงใหม่
    // ======================================
    router.post(
        '/:id/messages',
        checkDisputeAccess,
        async (req, res) => {
            const { id } = req.params;
            const senderId = req.user.userId;
            const message = req.body?.message;

            if (
                typeof message !== 'string' ||
                message.trim().length < 10 ||
                message.trim().length > 3000
            ) {
                return res.status(400).json({
                    success: false,
                    error: 'กรุณากรอกคำชี้แจง 10–3000 ตัวอักษร',
                });
            }

            try {
                const result = await pool.query(
                    `
          INSERT INTO dispute_messages (
            dispute_id,
            sender_id,
            message
          )
          SELECT
            d.dispute_id,
            $2,
            $3

          FROM disputes d

          JOIN rentals r
            ON r.rental_id = d.rental_id

          JOIN items i
            ON i.item_id = r.item_id

          WHERE d.dispute_id = $1
            AND d.status = 'open'
            AND (
              r.borrower_id = $2
              OR i.lender_id = $2
            )

          RETURNING
            message_id,
            dispute_id,
            sender_id,
            message,
            created_at
          `,
                    [id, senderId, message.trim()]
                );

                if (result.rows.length === 0) {
                    return res.status(403).json({
                        success: false,
                        error:
                            'ไม่สามารถส่งคำชี้แจงได้ เนื่องจากไม่มีสิทธิ์หรือข้อพิพาทถูกปิดแล้ว',
                    });
                }

                return res.status(201).json({
                    success: true,
                    message: 'ส่งคำชี้แจงสำเร็จ',
                    data: result.rows[0],
                });
            } catch (error) {
                console.error('Create dispute message error:', error);

                return res.status(500).json({
                    success: false,
                    error: 'ไม่สามารถบันทึกคำชี้แจงได้',
                });
            }
        }
    );


    return router;
};
