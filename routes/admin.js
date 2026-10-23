const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');



module.exports = (pool) => {
    const router = express.Router();

    router.use(authenticateToken, requireAdmin);

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
    // Admin: ดูหลักฐานการตรวจสภาพของข้อพิพาท
    router.get('/disputes/:id/evidence', async (req, res) => {
        try {
            const { id } = req.params;

            const disputeResult = await pool.query(
                `
            SELECT dispute_id, rental_id, reason, status
            FROM disputes
            WHERE dispute_id = $1
            `,
                [id]
            );

            if (disputeResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาท'
                });
            }

            const dispute = disputeResult.rows[0];

            const evidenceResult = dispute.rental_id
                ? await pool.query(
                    `
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
                `,
                    [dispute.rental_id]
                )
                : { rows: [] };

            return res.json({
                success: true,
                data: {
                    dispute,
                    inspections: evidenceResult.rows
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
    // ADMIN: RESOLVE DISPUTE
    // ======================================
    router.patch('/disputes/:disputeId/resolve', async (req, res) => {
        try {
            const { disputeId } = req.params;

            const result = await pool.query(
                `
                UPDATE disputes
                SET status = 'resolved'
                WHERE dispute_id = $1
                  AND status = 'open'
                RETURNING dispute_id, rental_id, reason, status
                `,
                [disputeId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบข้อพิพาทที่เปิดอยู่ หรือข้อพิพาทถูกจัดการแล้ว'
                });
            }

            return res.json({
                success: true,
                message: 'จัดการข้อพิพาทเรียบร้อยแล้ว',
                data: result.rows[0]
            });

        } catch (error) {
            console.error('Resolve dispute error:', error);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถจัดการข้อพิพาทได้'
            });
        }
    });

    return router;
};