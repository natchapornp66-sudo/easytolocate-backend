const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const path = require('path');
const fs = require('fs');
const { uploadRoot } = require('../config');
const storageService = require('../storage');


module.exports = (pool) => {
    const router = express.Router();

    router.use(authenticateToken, requireAdmin);
    router.param('id', (req, res, next, id) => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ success: false, error: 'รหัสรายการไม่ถูกต้อง' });
        }
        next();
    });

    router.get('/me', (req, res) => {
        res.json({
            success: true,
            message: 'เข้าสู่ระบบผู้ดูแลสำเร็จ',
            userId: req.user.userId,
            role: 'admin',
        });
    });

    // Dashboard: ดึงสถิติจริงจาก PostgreSQL
    router.get('/summary', async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    (SELECT COUNT(*) FROM users) AS total_users,
                    (SELECT COUNT(*) FROM items) AS total_items,
                    (SELECT COUNT(*) FROM rentals) AS total_rentals,
                    (
                        SELECT COUNT(*)
                        FROM users
                        WHERE status <> 'active'
                    ) AS blocked_accounts
            `);

            const row = result.rows[0];

            res.json({
                success: true,
                data: {
                    totalUsers: Number(row.total_users),
                    totalItems: Number(row.total_items),
                    totalRentals: Number(row.total_rentals),
                    blockedAccounts: Number(row.blocked_accounts),
                },
            });
        } catch (error) {
            console.error('Admin summary error:', error);
            res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดสถิติระบบได้',
            });
        }
    });

    router.get('/users', async (req, res) => {
        try {
            const result = await pool.query(`
      SELECT user_id, full_name, email, role, status, created_at
      FROM users
      ORDER BY created_at DESC
    `);

            return res.json({
                success: true,
                data: result.rows,
            });
        } catch (error) {
            console.error('Admin users error:', error);
            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดรายชื่อสมาชิกได้',
            });
        }
    });

    router.patch('/users/:id/status', async (req, res) => {
        try {
            const { status } = req.body;
            const { id } = req.params;

            if (!['active', 'suspended'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'สถานะบัญชีไม่ถูกต้อง',
                });
            }

            if (String(id) === String(req.user.userId)) {
                return res.status(403).json({
                    success: false,
                    error: 'ไม่สามารถระงับบัญชีตัวเองได้',
                });
            }

            const result = await pool.query(`
      UPDATE users
      SET status = $1, updated_at = NOW()
      WHERE user_id = $2
        AND role = 'user'
      RETURNING user_id, full_name, email, role, status
    `, [status, id]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบบัญชีผู้ใช้ที่สามารถจัดการได้',
                });
            }

            return res.json({
                success: true,
                data: result.rows[0],
            });
        } catch (error) {
            console.error('Admin update user status error:', error);
            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถเปลี่ยนสถานะบัญชีได้',
            });
        }
    });


    // ======================================
    // ADMIN: GET ALL ITEMS
    // ======================================
    router.get('/items', async (req, res) => {
        try {
            const result = await pool.query(`
            SELECT
                i.item_id,
                i.title,
                i.description,
                i.daily_price,
                i.status,
                i.images,
                i.created_at,
                i.lender_id,
                u.full_name AS lender_name,
                u.email AS lender_email
            FROM items i
            LEFT JOIN users u
                ON i.lender_id = u.user_id
            ORDER BY i.created_at DESC
        `);

            return res.json({
                success: true,
                data: result.rows,
            });

        } catch (error) {
            console.error('Admin items error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดรายการโพสต์ได้',
            });
        }
    });

    // ======================================
    // ADMIN: HIDE / RESTORE ITEM
    // ======================================
    router.patch('/items/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            // Admin เปลี่ยนสถานะได้เฉพาะ active / hidden
            if (!['active', 'hidden'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'สถานะโพสต์ไม่ถูกต้อง',
                });
            }

            const result = await pool.query(`
            UPDATE items
            SET status = $1,
                updated_at = NOW()
            WHERE item_id = $2
            RETURNING
                item_id,
                title,
                status,
                updated_at
        `, [status, id]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบโพสต์ที่ต้องการจัดการ',
                });
            }

            return res.json({
                success: true,
                message: status === 'hidden'
                    ? 'ซ่อนโพสต์เรียบร้อยแล้ว'
                    : 'เปิดใช้งานโพสต์เรียบร้อยแล้ว',
                data: result.rows[0],
            });

        } catch (error) {
            console.error('Admin update item status error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถเปลี่ยนสถานะโพสต์ได้',
            });
        }
    });
    // ======================================
    // ADMIN: GET ALL RENTALS
    // ======================================
    router.get('/rentals', async (req, res) => {
        try {
            const result = await pool.query(`
            SELECT
                r.rental_id,
                r.item_id,
                i.title AS item_title,
                r.borrower_id,
                borrower.full_name AS borrower_name,
                lender.full_name AS lender_name,
                r.start_date,
                r.end_date,
                r.total_days,
                r.total_price,
                r.status,
                r.payment_status,
                r.fine_amount,
                r.fine_status,
                r.received_confirmed_at,
                r.created_at
            FROM rentals r
            LEFT JOIN items i
                ON r.item_id = i.item_id
            LEFT JOIN users borrower
                ON r.borrower_id = borrower.user_id
            LEFT JOIN users lender
                ON i.lender_id = lender.user_id
            ORDER BY r.created_at DESC
        `);

            return res.json({
                success: true,
                data: result.rows,
            });
        } catch (error) {
            console.error('Admin rentals error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดรายการเช่าได้',
            });
        }
    });
    // ======================================
    // ADMIN: GET ALL DISPUTES
    // ======================================
    router.get('/disputes', async (req, res) => {
        try {
            const result = await pool.query(`
            SELECT
                d.dispute_id,
                d.rental_id,
                d.reported_by,
                d.reason,
                d.status,
                d.created_at,
                d.category,
                d.decision,
                d.decision_reason,
                d.adjusted_fine_amount,
                d.resolved_at,

                reporter.full_name AS reporter_name,
                reporter.email AS reporter_email,

                r.status AS rental_status,
                r.total_price,

                i.title AS item_title,

                borrower.full_name AS borrower_name,
                lender.full_name AS lender_name

            FROM disputes d

            LEFT JOIN users reporter
                ON d.reported_by = reporter.user_id

            LEFT JOIN rentals r
                ON d.rental_id = r.rental_id

            LEFT JOIN items i
                ON r.item_id = i.item_id

            LEFT JOIN users borrower
                ON r.borrower_id = borrower.user_id

            LEFT JOIN users lender
                ON i.lender_id = lender.user_id

            ORDER BY
                CASE WHEN d.status = 'open' THEN 0 ELSE 1 END,
                d.created_at DESC
        `);

            return res.json({
                success: true,
                data: result.rows,
            });

        } catch (error) {
            console.error('Admin disputes error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดรายการข้อพิพาทได้',
            });
        }
    });

    // ADMIN: ดูหลักฐานประกอบข้อพิพาทจากทั้งสองแหล่ง
    router.get('/disputes/:id/evidence', async (req, res) => {
        const { id } = req.params;



        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;



        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสข้อพิพาทไม่ถูกต้อง'
            });
        }

        try {
            // 1. ข้อมูลคำร้องและรายการเช่า
            const disputeResult = await pool.query(`
                SELECT
                    d.dispute_id,
                    d.rental_id,
                    d.reported_by,
                    d.category,
                    d.reason,
                    d.status,
                    d.created_at,

                    r.fine_amount,
                    r.fine_reason,
                    r.fine_status,

                    i.title AS item_title,

                    reporter.full_name AS reporter_name,
                    borrower.full_name AS borrower_name,
                    lender.full_name AS lender_name

                FROM disputes d

                LEFT JOIN rentals r
                    ON r.rental_id = d.rental_id

                LEFT JOIN items i
                    ON i.item_id = r.item_id

                LEFT JOIN users reporter
                    ON reporter.user_id = d.reported_by

                LEFT JOIN users borrower
                    ON borrower.user_id = r.borrower_id

                LEFT JOIN users lender
                    ON lender.user_id = i.lender_id

                WHERE d.dispute_id = $1
            `, [id]);

            if (disputeResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาท'
                });
            }

            const dispute = disputeResult.rows[0];

            // 2. รูปตรวจสภาพเดิมก่อนและหลังการเช่า
            const inspectionResult = dispute.rental_id
                ? await pool.query(`
                    SELECT
                        inspection_id,
                        rental_id,
                        inspector_id,
                        inspection_type,
                        condition_notes,
                        photo_urls,
                        created_at
                    FROM rental_inspections
                    WHERE rental_id = $1
                    ORDER BY created_at ASC
                `, [dispute.rental_id])
                : { rows: [] };

            // 3. หลักฐานที่คู่กรณีแนบเพิ่มเติม
            const additionalResult = await pool.query(`
                SELECT
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
                ORDER BY e.created_at ASC, e.evidence_id ASC
            `, [id]);

            // คืน URL ของ API ที่ตรวจสิทธิ์
            // ไม่เปิดเผย file_path ภายในเซิร์ฟเวอร์
            const additionalEvidence = additionalResult.rows.map(
                (evidence) => ({
                    ...evidence,
                    file_url:
                        `/api/disputes/${id}/evidence/${evidence.evidence_id}/file`
                })
            );

            return res.json({
                success: true,
                data: {
                    dispute,

                    // คงชื่อเดิมให้ Frontend เก่ายังอ่านได้
                    inspections: inspectionResult.rows,

                    // หลักฐานเพิ่มเติมจากผู้เช่าและผู้ให้เช่า
                    additional_evidence: additionalEvidence
                }
            });

        } catch (error) {
            console.error('Admin dispute evidence error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดหลักฐานข้อพิพาทได้'
            });
        }
    });

    // ======================================
    // ADMIN: อ่านคำชี้แจงจากทั้งสองฝ่าย
    // GET /api/admin/disputes/:id/messages
    // ======================================
    router.get('/disputes/:id/messages', async (req, res) => {
        const { id } = req.params;


        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสข้อพิพาทไม่ถูกต้อง',
            });
        }

        try {
            // ตรวจว่ามีข้อพิพาทจริง
            const disputeResult = await pool.query(
                `
        SELECT dispute_id
        FROM disputes
        WHERE dispute_id = $1
        `,
                [id]
            );

            if (disputeResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาท',
                });
            }

            // อ่านคำชี้แจง พร้อมชื่อและบทบาทผู้ส่ง
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

        LEFT JOIN rentals r
          ON r.rental_id = d.rental_id

        LEFT JOIN items i
          ON i.item_id = r.item_id

        LEFT JOIN users u
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
            console.error('Admin dispute messages error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถโหลดคำชี้แจงข้อพิพาทได้',
            });
        }
    });


    // ADMIN: เปิดรูปตรวจสภาพที่ใช้เป็นหลักฐานข้อพิพาท
    router.get(
        '/disputes/:id/inspection-image/:filename',
        async (req, res) => {
            const { id, filename } = req.params;


            const uuidRegex =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


            const imageRegex =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/i;

            if (!uuidRegex.test(id) || !imageRegex.test(filename)) {
                return res.status(400).json({
                    success: false,
                    error: 'ข้อมูลรูปภาพไม่ถูกต้อง'
                });
            }

            try {
                // ตรวจว่าภาพถูกบันทึกไว้ในรายการเช่าของข้อพิพาทนี้จริง
                const result = await pool.query(`
                    SELECT 1
                    FROM disputes d
                    JOIN rental_inspections ri
                      ON ri.rental_id = d.rental_id
                    WHERE d.dispute_id = $1
                      AND ri.photo_urls @> $2::jsonb
                    LIMIT 1
                `, [
                    id,
                    JSON.stringify([`/uploads/rentals/${filename}`])
                ]);

                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'ไม่พบรูปหลักฐานของข้อพิพาทนี้'
                    });
                }

                const imagePath = path.join(
                    uploadRoot,
                    'rentals',
                    filename
                );

                if (!await storageService.exists('rentals', filename)) {
                    return res.status(404).json({
                        success: false,
                        error: 'ไม่พบไฟล์รูปภาพ'
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

                return storageService.send(res, 'rentals', filename);
            } catch (error) {
                console.error('Admin inspection image error:', error);

                if (!res.headersSent) {
                    return res.status(500).json({
                        success: false,
                        error: 'ไม่สามารถโหลดรูปหลักฐานได้'
                    });
                }
            }
        }
    );


    // ======================================
    // ADMIN: RESOLVE DISPUTE
    // ======================================

    // ADMIN: พิจารณาและตัดสินข้อพิพาท
    router.patch('/disputes/:disputeId/resolve', async (req, res) => {
        const { disputeId } = req.params;
        const {
            decision,
            decision_reason,
            adjusted_fine_amount
        } = req.body;

        const adminId = req.user.userId;

        // ตรวจรูปแบบรหัสข้อพิพาทก่อน Query ฐานข้อมูล

        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


        if (!uuidRegex.test(disputeId)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสข้อพิพาทไม่ถูกต้อง'
            });
        }



        const allowedDecisions = [
            'uphold',  // ยืนยันค่าปรับเดิม
            'adjust',  // ปรับลดค่าปรับ
            'waive',   // ยกเลิกค่าปรับ
            'general'  // พิจารณาข้อร้องเรียนทั่วไป
        ];

        if (!allowedDecisions.includes(decision)) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาเลือกผลการพิจารณา'
            });
        }

        if (
            typeof decision_reason !== 'string' ||
            decision_reason.trim().length < 10 ||
            decision_reason.trim().length > 3000
        ) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาระบุเหตุผลการตัดสิน 10–3000 ตัวอักษร'
            });
        }

        const newFine =
            decision === 'adjust'
                ? Number(adjusted_fine_amount)
                : decision === 'waive'
                    ? 0
                    : null;

        if (
            decision === 'adjust' &&
            (
                adjusted_fine_amount === null ||
                adjusted_fine_amount === undefined ||
                adjusted_fine_amount === '' ||
                !Number.isFinite(newFine) ||
                newFine <= 0
            )
        ) {
            return res.status(400).json({
                success: false,
                error: 'จำนวนค่าปรับใหม่ไม่ถูกต้อง'
            });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');


            // ค้นหา rental_id ก่อน โดยยังไม่ล็อกแถว disputes
            const disputeLookup = await client.query(`
                SELECT rental_id
                FROM disputes
                WHERE dispute_id = $1
            `, [disputeId]);

            if (disputeLookup.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาท'
                });
            }

            if (!disputeLookup.rows[0].rental_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'ข้อพิพาทนี้ไม่มีรายการเช่าที่เกี่ยวข้อง'
                });
            }

            // ล็อก rentals ก่อน ให้ตรงกับ rentalPayments.js
            const rentalLock = await client.query(`
                SELECT rental_id
                FROM rentals
                WHERE rental_id = $1
                FOR UPDATE
            `, [disputeLookup.rows[0].rental_id]);

            if (rentalLock.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่าของข้อพิพาท'
                });
            }

            // หลังจากล็อก rentals แล้ว จึงล็อก disputes
            const disputeResult = await client.query(`
                SELECT
                    d.dispute_id,
                    d.rental_id,
                    d.status,
                    r.fine_amount
                FROM disputes d
                JOIN rentals r
                    ON r.rental_id = d.rental_id
                WHERE d.dispute_id = $1
                FOR UPDATE OF d
            `, [disputeId]);

            // ตรวจสอบว่าความสัมพันธ์ไม่เปลี่ยนระหว่างล็อก
            if (
                disputeResult.rows.length > 0 &&
                String(disputeResult.rows[0].rental_id) !==
                String(rentalLock.rows[0].rental_id)
            ) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: 'รายการเช่าของข้อพิพาทมีการเปลี่ยนแปลง'
                });
            }


            if (disputeResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาท'
                });
            }

            const dispute = disputeResult.rows[0];

            if (dispute.status !== 'open') {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: 'ข้อพิพาทนี้ถูกปิดแล้ว'
                });
            }


            // จัดการค่าปรับตามคำตัดสิน
            if (decision === 'adjust' || decision === 'waive') {
                if (!dispute.rental_id) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'ข้อพิพาทนี้ไม่มีรายการเช่าที่เกี่ยวข้อง'
                    });
                }

                // ล็อก Rental เพื่อป้องกันการแก้ยอดพร้อมกัน
                const rentalResult = await client.query(`
                    SELECT rental_id, fine_amount, fine_status
                    FROM rentals
                    WHERE rental_id = $1
                    FOR UPDATE
                `, [dispute.rental_id]);

                if (rentalResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'ไม่พบรายการเช่า'
                    });
                }

                const rental = rentalResult.rows[0];

                const originalFine = Number(rental.fine_amount);
                const finalFine = decision === 'waive' ? 0 : newFine;

                const originalCents = Math.round(originalFine * 100);
                const finalCents = Math.round(finalFine * 100);

                const validMoney = (value, cents) =>
                    Number.isFinite(value) &&
                    Number.isSafeInteger(cents) &&
                    Math.abs(cents / 100 - value) < 0.000001;

                if (
                    !validMoney(originalFine, originalCents) ||
                    originalCents <= 0
                ) {
                    await client.query('ROLLBACK');

                    return res.status(400).json({
                        success: false,
                        error: 'ยอดค่าปรับเดิมไม่ถูกต้อง'
                    });
                }

                if (
                    !validMoney(finalFine, finalCents) ||
                    finalCents < 0 ||
                    finalCents >= originalCents
                ) {
                    await client.query('ROLLBACK');

                    return res.status(400).json({
                        success: false,
                        error: 'ค่าปรับใหม่ต้องน้อยกว่าค่าปรับเดิม และมีทศนิยมไม่เกิน 2 ตำแหน่ง'
                    });
                }


                // ตรวจรายการชำระค่าปรับเดิมและล็อกข้อมูล
                const paymentResult = await client.query(`
                    SELECT payment_id, amount, status
                    FROM rental_payments
                    WHERE rental_id = $1
                      AND payment_type = 'fine'
                    FOR UPDATE
                `, [dispute.rental_id]);

                const payments = paymentResult.rows;

                // สถานะที่ยังไม่สามารถปรับยอดได้อย่างปลอดภัย
                const uncertainPayments = payments.filter(
                    (p) => !['verified', 'rejected'].includes(p.status)
                );

                if (uncertainPayments.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: 'มีรายการชำระค่าปรับที่ยังรอตรวจสอบ กรุณาจัดการรายการชำระก่อนตัดสิน'
                    });
                }

                const verifiedPayments = payments.filter(
                    (p) => p.status === 'verified'
                );

                // ตาราง fine_refunds ปัจจุบันรองรับการคืนเงิน
                // จากรายการชำระที่ยืนยันแล้วหนึ่งรายการ
                if (verifiedPayments.length > 1) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: 'พบการชำระค่าปรับที่ยืนยันแล้วหลายรายการ ต้องตรวจสอบยอดก่อน'
                    });
                }

                if (verifiedPayments.length === 1) {
                    const verifiedPayment = verifiedPayments[0];
                    const paidCents = Math.round(
                        Number(verifiedPayment.amount) * 100
                    );
                    const originalCents = Math.round(originalFine * 100);

                    if (paidCents !== originalCents) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({
                            success: false,
                            error: 'ยอดค่าปรับกับยอดที่ชำระจริงไม่ตรงกัน ต้องตรวจสอบก่อน'
                        });
                    }

                    const refundAmount = (paidCents - finalCents) / 100;

                    // บันทึกยอดคืนเงินที่รอดำเนินการ
                    // ไม่เปลี่ยนยอดหรือสถานะของ Payment เดิม
                    await client.query(`
                        INSERT INTO fine_refunds (
                            dispute_id,
                            rental_id,
                            original_payment_id,
                            original_fine_amount,
                            adjusted_fine_amount,
                            refund_amount,
                            status
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
                    `, [
                        disputeId,
                        dispute.rental_id,
                        verifiedPayment.payment_id,
                        originalFine,
                        finalCents / 100,
                        refundAmount
                    ]);
                }


                // ปรับยอดและสถานะค่าปรับตามคำตัดสิน
                // ไม่เปลี่ยนสถานะกระบวนการเช่า
                const updatedFineStatus =
                    decision === 'waive'
                        ? 'none'
                        : 'confirmed';

                await client.query(`
                    UPDATE rentals
                    SET
                        fine_amount = $1,
                        fine_status = $2,
                        status = CASE
                            WHEN $4 = 'waive' AND status = 'fine_pending' THEN 'completed'
                            ELSE status
                        END,
                        updated_at = NOW()
                    WHERE rental_id = $3
                `, [
                    finalCents / 100,
                    updatedFineStatus,
                    dispute.rental_id,
                    decision
                ]);

            }


            const result = await client.query(`
                UPDATE disputes
                SET
                    status = 'resolved',
                    decision = $1,
                    decision_reason = $2,
                    adjusted_fine_amount = $3,
                    resolved_by = $4,
                    resolved_at = NOW(),
                    updated_at = NOW()
                WHERE dispute_id = $5
                  AND status = 'open'
                RETURNING *
            `, [
                decision,
                decision_reason.trim(),
                newFine,
                adminId,
                disputeId
            ]);

            await client.query(`
                INSERT INTO dispute_history (
                    dispute_id,
                    action_by,
                    action_type,
                    old_status,
                    new_status,
                    details
                )
                VALUES (
                    $1, $2, 'resolved',
                    'open', 'resolved', $3
                )
            `, [
                disputeId,
                adminId,
                JSON.stringify({
                    decision,
                    decision_reason: decision_reason.trim(),
                    original_fine_amount: dispute.fine_amount,
                    adjusted_fine_amount: newFine
                })
            ]);

            // ======================================
            // แจ้งผลการพิจารณาให้ผู้เช่าและผู้ให้เช่า
            // ======================================
            const participantsResult = await client.query(`
                SELECT DISTINCT participant.user_id
                FROM disputes d
                JOIN rentals r
                    ON r.rental_id = d.rental_id
                JOIN items i
                    ON i.item_id = r.item_id
                CROSS JOIN LATERAL (
                    VALUES (r.borrower_id), (i.lender_id)
                ) AS participant(user_id)
                WHERE d.dispute_id = $1
                  AND participant.user_id IS NOT NULL
            `, [disputeId]);

            const decisionLabels = {
                general: 'พิจารณาเรื่องร้องเรียนทั่วไป',
                uphold: 'ยืนยันค่าปรับเดิม',
                adjust: 'ปรับลดค่าปรับ',
                waive: 'ยกเลิกค่าปรับ'
            };

            for (const participant of participantsResult.rows) {
                await client.query(`
                    INSERT INTO notifications (
                        notification_id,
                        user_id,
                        title,
                        message,
                        type,
                        is_read,
                        created_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1, $2, $3, $4, FALSE, NOW()
                    )
                `, [
                    participant.user_id,
                    'แจ้งผลการพิจารณาข้อพิพาท',
                    `ข้อพิพาทของคุณได้รับการพิจารณาแล้ว: ${decisionLabels[decision]
                    } กรุณาตรวจสอบเหตุผลและรายละเอียดคำตัดสิน รหัสข้อพิพาท: ${disputeId}`,
                    'dispute_resolved'
                ]);
            }


            await client.query('COMMIT');

            return res.json({
                success: true,
                message: 'บันทึกผลการพิจารณาข้อพิพาทสำเร็จ',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');

            console.error('Resolve dispute error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถบันทึกผลการพิจารณาได้'
            });
        } finally {
            client.release();
        }
    });

    return router;
};
