const { production, uploadRoot, frontendDist, serveFrontend, allowedOrigins, validateProduction } = require('./config');
validateProduction();
const express = require('express');
const pool = require('./db');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const storage = require('./storage');

const validItemPrice = price => Number.isFinite(price) && price > 0 &&
    price <= 99999999.99 && Math.abs(Math.round(price * 100) - price * 100) < 0.000001;
const validItemImages = images => Array.isArray(images) && images.length <= 5 && images.every(url =>
    typeof url === 'string' && url.length <= 2048 &&
    (/^\/uploads\/items\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i.test(url) || /^https?:\/\/[^\s]+$/i.test(url)));
const validItemImageFile = file => {
    const fd = fs.openSync(file.path, 'r');
    try {
        const b = Buffer.alloc(12), n = fs.readSync(fd, b, 0, 12, 0);
        if (file.mimetype === 'image/png') return n >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
        if (file.mimetype === 'image/jpeg') return n >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
        if (file.mimetype === 'image/gif') return ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6));
        return file.mimetype === 'image/webp' && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    } finally { fs.closeSync(fd); }
};

const reviewUploadDir = path.join(uploadRoot, 'reviews');
fs.mkdirSync(reviewUploadDir, { recursive: true });

const reviewStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, reviewUploadDir);
    },
    filename: (req, file, cb) => {
        const extension = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp'
        }[file.mimetype];

        cb(null, `${require('crypto').randomUUID()}${extension || ''}`);
    }
});

const reviewUpload = multer({
    storage: reviewStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 5
    },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg',
            'image/png',
            'image/webp'
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(new Error('รองรับเฉพาะ JPG, PNG และ WEBP'));
        }

        cb(null, true);
    }
});

const authenticateToken = require('./middleware/authMiddleware');
const app = express();
app.use(storage.cleanupTemporaryUploads);
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin))
}));
app.use(express.json());
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

// เปิดให้เข้าถึงโฟลเดอร์ uploads ได้ผ่าน http://localhost:5000/uploads/...
// เปิดเฉพาะรูปสิ่งของและรีวิวที่เป็นข้อมูลสาธารณะ
if (storage.cloud) app.get('/uploads/items/:filename', (req, res) => storage.send(res, 'items', req.params.filename).catch(() => res.status(404).end()));
else app.use('/uploads/items', express.static(path.join(uploadRoot, 'items')));

if (storage.cloud) app.get('/uploads/reviews/:filename', (req, res) => storage.send(res, 'reviews', req.params.filename).catch(() => res.status(404).end()));
else app.use('/uploads/reviews', express.static(path.join(uploadRoot, 'reviews')));

// สร้าง Database Connection Pool
const itemUploadDir = path.join(uploadRoot, 'items');

fs.mkdirSync(itemUploadDir, { recursive: true });

const itemImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, itemUploadDir);
    },
    filename: (req, file, cb) => {
        const extension = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp',
            'image/gif': '.gif',
        }[file.mimetype];

        cb(null, `${crypto.randomUUID()}${extension}`);
    },
});

const itemImageUpload = multer({
    storage: itemImageStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 5,
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('รองรับเฉพาะไฟล์ JPG, PNG, WEBP และ GIF'));
        }

        cb(null, true);
    },
});

// ===== Rental inspection photo upload =====
const rentalPhotoDir = path.join(uploadRoot, 'rentals');

fs.mkdirSync(rentalPhotoDir, { recursive: true });

const rentalPhotoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, rentalPhotoDir);
    },

    filename: (req, file, cb) => {
        const extension = file.mimetype === 'image/png'
            ? '.png'
            : '.jpg';

        const filename = `${crypto.randomUUID()}${extension}`;

        cb(null, filename);
    },
});

const rentalPhotoUpload = multer({
    storage: rentalPhotoStorage,

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

// อัปโหลดรูปตรวจสอบสภาพการเช่า
app.post(
    '/api/rentals/:id/photos',
    authenticateToken,
    rentalPhotoUpload.array('photos', 5),
    async (req, res) => {
        const { id } = req.params;
        const { mode } = req.body;
        const userId = req.user.userId;

        // 1. ตรวจสอบประเภทการอัปโหลด
        const allowedModes = ['lenderBefore', 'beforeUse', 'afterUse'];

        if (!allowedModes.includes(mode)) {
            return res.status(400).json({
                success: false,
                error: 'ประเภทการอัปโหลดไม่ถูกต้อง',
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาเลือกรูปภาพ',
            });
        }

        try {
            // 2. ดึงข้อมูลผู้เช่าและเจ้าของสิ่งของ
            const rentalResult = await pool.query(`
                SELECT
                    r.borrower_id,
                    r.status,
                    r.payment_status,
                    r.received_confirmed_at,
                    i.lender_id
                FROM rentals r
                JOIN items i ON r.item_id = i.item_id
                WHERE r.rental_id = $1
            `, [id]);

            if (rentalResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่า',
                });
            }

            const rental = rentalResult.rows[0];

            const isBorrower =
                String(rental.borrower_id) === String(userId);

            const isLender =
                String(rental.lender_id) === String(userId);

            // 3. ตรวจสอบสิทธิ์ตามประเภทการอัปโหลด
            if (mode === 'lenderBefore') {
                if (!isLender) {
                    return res.status(403).json({
                        success: false,
                        error: 'เฉพาะผู้ให้เช่าเท่านั้นที่อัปโหลดรูปก่อนให้เช่าได้',
                    });
                }

                if (
                    rental.status !== 'approved' ||
                    rental.payment_status !== 'paid'
                ) {
                    return res.status(400).json({
                        success: false,
                        error: 'ต้องอนุมัติรายการและตรวจสอบสลิปสำเร็จก่อนส่งมอบ',
                    });
                }

                if (rental.received_confirmed_at) {
                    return res.status(400).json({
                        success: false,
                        error: 'ผู้เช่ายืนยันรับสิ่งของแล้ว ไม่สามารถเพิ่มภาพก่อนส่งมอบได้',
                    });
                }
            } else {
                if (!isBorrower) {
                    return res.status(403).json({
                        success: false,
                        error: 'เฉพาะผู้เช่าเท่านั้นที่อัปโหลดรูปได้',
                    });
                }

                if (
                    (mode === 'beforeUse' || mode === 'afterUse') &&
                    rental.status !== 'borrowing'
                ) {
                    return res.status(400).json({
                        success: false,
                        error: 'ต้องยืนยันรับสิ่งของและอยู่ในสถานะกำลังเช่าก่อน',
                    });
                }
            }

            await storage.persist('rentals', req.files);
            // 4. สร้าง URL รูปภาพ
            const imageUrls = req.files.map(file =>
                `/uploads/rentals/${file.filename}`
            );

            // 5. แปลง mode เป็นค่าที่ตรงกับฐานข้อมูล
            const inspectionTypeMap = {
                lenderBefore: 'lender_before',
                beforeUse: 'borrower_before',
                afterUse: 'borrower_after',
            };

            const inspectionType = inspectionTypeMap[mode];

            // 6. บันทึกลง rental_inspections
            const result = await pool.query(`
                INSERT INTO rental_inspections (
                    inspection_id,
                    rental_id,
                    inspector_id,
                    inspection_type,
                    photo_urls,
                    created_at
                )
                VALUES (
                    gen_random_uuid(),
                    $1,
                    $2,
                    $3,
                    $4::jsonb,
                    NOW()
                )
                RETURNING *
            `, [
                id,
                userId,
                inspectionType,
                JSON.stringify(imageUrls),
            ]);

            return res.json({
                success: true,
                message: 'บันทึกรูปภาพสำเร็จ',
                image_urls: imageUrls,
                data: result.rows[0],
            });

        } catch (err) {
            console.error('Upload rental photos error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถบันทึกรูปภาพได้',
            });
        }
    }
);

// 1. ดึงรายการสิ่งของทั้งหมด (Items)
app.get('/api/items', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                items.*,
                categories.category_name,
                users.full_name AS lender_name,
                b.recommended_min_price,
                b.recommended_max_price,
                b.sample_count,
                b.benchmark_status,

                CASE
                    WHEN b.item_id IS NULL
                        THEN 'INSUFFICIENT_DATA'

                    WHEN b.benchmark_status = 'INSUFFICIENT_DATA'
                        THEN 'INSUFFICIENT_DATA'

                    WHEN b.recommended_min_price IS NULL
                        OR b.recommended_max_price IS NULL
                        THEN 'INSUFFICIENT_DATA'

                    WHEN items.daily_price < b.recommended_min_price
                        THEN 'BELOW_MARKET'

                    WHEN items.daily_price <= b.recommended_max_price
                        THEN 'FAIR'

                    ELSE 'ABOVE_MARKET'
                END AS price_evaluation

            FROM items

            LEFT JOIN categories
                ON items.category_id = categories.category_id

            LEFT JOIN users
                ON items.lender_id = users.user_id

            LEFT JOIN item_price_benchmarks b
                ON items.item_id = b.item_id

                WHERE items.status = 'active'

            ORDER BY items.created_at DESC
        `);

        const itemsWithDistance = result.rows.map((item) => ({
            ...item,
            distance_km: null
        }));

        res.json(itemsWithDistance);

    } catch (err) {
        console.error('GET /api/items error:', err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// =====================================
// POST /api/upload/item-images
// อัปโหลดรูปภาพสิ่งของ สูงสุด 5 รูป
// =====================================

app.post('/api/upload/item-images', authenticateToken, (req, res) => {
    itemImageUpload.array('images', 5)(req, res, async (err) => {
        const cleanup = () => Promise.all((req.files || []).map(file => fs.promises.unlink(file.path).catch(() => {})));
        if (err) {
            await cleanup();
            console.error('Item image upload error:', err);

            return res.status(400).json({
                success: false,
                error: 'ไม่สามารถอัปโหลดรูปภาพได้ กรุณาตรวจสอบประเภทและขนาดไฟล์',
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาเลือกรูปภาพอย่างน้อย 1 รูป',
            });
        }

        const imageUrls = req.files.map(
            (file) => `/uploads/items/${file.filename}`
        );
        try {
            if (!req.files.every(validItemImageFile)) {
                await cleanup();
                return res.status(400).json({ success: false, error: 'พบไฟล์ที่ไม่ใช่รูปภาพตามประเภทที่ระบุ' });
            }
        } catch (error) {
            await cleanup();
            return res.status(400).json({ success: false, error: 'ไม่สามารถตรวจสอบรูปภาพได้' });
        }

        try {
            await storage.persist('items', req.files);
            return res.status(201).json({ success: true, message: 'อัปโหลดรูปภาพสำเร็จ', images: imageUrls });
        } catch {
            return res.status(502).json({ success: false, error: 'ไม่สามารถบันทึกรูปภาพได้ กรุณาลองใหม่' });
        }
    });
});

// =====================================
// GET /api/my-items - ดึงโพสต์ของฉัน
// =====================================
app.get('/api/my-items', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await pool.query(`
            SELECT
                items.*,
                categories.category_name
            FROM items
            LEFT JOIN categories
                ON items.category_id = categories.category_id
            WHERE items.lender_id = $1
            ORDER BY items.created_at DESC
        `, [userId]);

        return res.json({
            success: true,
            data: result.rows
        });

    } catch (err) {
        console.error('GET /api/my-items error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถดึงรายการโพสต์ของคุณได้'
        });
    }
});

// API แก้ไขโพสต์สิ่งของ (เฉพาะเจ้าของโพสต์)
app.put('/api/items/:id', authenticateToken, async (req, res) => {
    try {
        const itemId = req.params.id;
        const userId = req.user.userId;

        const {
            title,
            description,
            conditions,
            daily_price
        } = req.body;

        // ตรวจสอบข้อมูลที่ส่งมา
        const price = Number(daily_price);

        if (
            typeof title !== 'string' ||
            !title.trim() ||
            title.trim().length > 255 ||
            typeof description !== 'string' ||
            !description.trim() ||
            typeof conditions !== 'string' ||
            !conditions.trim() ||
            !validItemPrice(price)
        ) {
            return res.status(400).json({
                success: false,
                error: 'กรุณากรอกข้อมูลสิ่งของให้ครบถ้วน'
            });
        }

        // ตรวจสอบรูปแบบ UUID
        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(itemId)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสสิ่งของไม่ถูกต้อง'
            });
        }

        // แก้ไขได้เฉพาะสิ่งของที่เป็นของผู้ใช้คนนี้
        const result = await pool.query(`
            UPDATE items
            SET
                title = $1,
                description = $2,
                conditions = $3,
                daily_price = $4,
                updated_at = NOW()
            WHERE item_id = $5
              AND lender_id = $6
            RETURNING *
        `, [
            title.trim(),
            description.trim(),
            conditions.trim(),
            price,
            itemId,
            userId
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'ไม่พบสิ่งของหรือคุณไม่มีสิทธิ์แก้ไข'
            });
        }

        return res.json({
            success: true,
            message: 'แก้ไขโพสต์สำเร็จ',
            data: result.rows[0]
        });

    } catch (err) {
        console.error('PUT /api/items/:id error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถแก้ไขโพสต์ได้'
        });
    }
});

// API ลบโพสต์สิ่งของ (เฉพาะเจ้าของโพสต์)
app.delete('/api/items/:id', authenticateToken, async (req, res) => {
    let client;
    try {
        const itemId = req.params.id;
        const userId = req.user.userId;

        // ตรวจสอบรูปแบบ UUID
        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(itemId)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสสิ่งของไม่ถูกต้อง'
            });
        }

        client = await pool.connect();
        await client.query('BEGIN');
        const owned = await client.query('SELECT item_id FROM items WHERE item_id=$1 AND lender_id=$2 FOR UPDATE', [itemId, userId]);
        if (!owned.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'ไม่พบสิ่งของหรือคุณไม่มีสิทธิ์ลบ' });
        }
        const history = await client.query('SELECT 1 FROM rentals WHERE item_id=$1 LIMIT 1', [itemId]);
        if (history.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'สิ่งของนี้มีประวัติการเช่าแล้ว กรุณาปิดให้เช่าแทนการลบเพื่อรักษาประวัติ' });
        }
        // Lock the item first, matching rental creation, so a new rental cannot be deleted by a concurrent request.
        const result = await client.query(`
            DELETE FROM items
            WHERE item_id = $1
              AND lender_id = $2
            RETURNING item_id, title
        `, [itemId, userId]);

        await client.query('COMMIT');

        return res.json({
            success: true,
            message: 'ลบโพสต์สำเร็จ',
            data: result.rows[0]
        });

    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('DELETE /api/items/:id error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถลบโพสต์ได้'
        });
    } finally { if (client) client.release(); }
});

// API เปิด/ปิดการให้เช่าสิ่งของ
app.patch('/api/items/:id/status', authenticateToken, async (req, res) => {
    try {
        const itemId = req.params.id;
        const userId = req.user.userId;
        const { status } = req.body;

        // ตรวจสอบ UUID
        const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(itemId)) {
            return res.status(400).json({
                success: false,
                error: 'รหัสสิ่งของไม่ถูกต้อง'
            });
        }

        // อนุญาตให้เปลี่ยนเฉพาะ active และ inactive
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'สถานะสิ่งของต้องเป็น active หรือ inactive เท่านั้น'
            });
        }

        // อัปเดตเฉพาะสิ่งของของผู้ใช้ที่ล็อกอิน
        const result = await pool.query(`
            UPDATE items
            SET
                status = $1,
                updated_at = NOW()
            WHERE item_id = $2
              AND lender_id = $3
              AND status <> 'hidden'
            RETURNING item_id, title, status, updated_at
        `, [status, itemId, userId]);

        if (result.rows.length === 0) {
            const hiddenItem = await pool.query(
                `SELECT 1 FROM items WHERE item_id = $1 AND lender_id = $2 AND status = 'hidden'`,
                [itemId, userId]
            );
            if (hiddenItem.rows.length) {
                return res.status(403).json({ success: false, error: 'ประกาศนี้ถูกซ่อนโดยผู้ดูแล กรุณาติดต่อผู้ดูแลระบบ' });
            }
            return res.status(404).json({
                success: false,
                error: 'ไม่พบสิ่งของหรือคุณไม่มีสิทธิ์แก้ไขสถานะ'
            });
        }

        return res.json({
            success: true,
            message: status === 'active'
                ? 'เปิดให้เช่าสำเร็จ'
                : 'ปิดการให้เช่าชั่วคราวสำเร็จ',
            data: result.rows[0]
        });

    } catch (err) {
        console.error('PATCH /api/items/:id/status error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถเปลี่ยนสถานะสิ่งของได้'
        });
    }
});

// POST /api/items - เพิ่มสิ่งของให้เช่า
app.post('/api/items', authenticateToken, async (req, res) => {
    try {
        const lender_id = req.user.userId;
        const {

            category_id,
            title,
            description,
            conditions,
            daily_price,
            images,
            clothing_size,
            chest,
            waist,
            hips,
            clothing_length
        } = req.body;


        const price = Number(daily_price);
        const categoryId = Number(category_id);

        if (
            !lender_id ||
            typeof title !== 'string' || !title.trim() || title.trim().length > 255 ||
            typeof description !== 'string' || !description.trim() ||
            typeof conditions !== 'string' || !conditions.trim() ||
            !Number.isInteger(categoryId) ||
            categoryId <= 0 ||
            !validItemPrice(price) ||
            (images !== undefined && !validItemImages(images))
        ) {
            return res.status(400).json({
                success: false,
                error: 'กรุณากรอกข้อมูลสิ่งของให้ครบถ้วน'
            });
        }

        const categoryExists = await pool.query('SELECT 1 FROM categories WHERE category_id = $1', [categoryId]);
        if (!categoryExists.rows.length) {
            return res.status(400).json({ success: false, error: 'ไม่พบหมวดหมู่ที่เลือก' });
        }
        // แปลงค่าขนาดเสื้อผ้าเป็นตัวเลข หรือ NULL หากไม่ได้กรอก
        const parseSize = (value) => {
            if (value === undefined || value === null || value === '') {
                return null;
            }

            const number = Number(value);

            if (!Number.isFinite(number) || number <= 0) {
                throw new Error('INVALID_CLOTHING_SIZE');
            }

            return number;
        };

        let clothingMeasurements;

        try {
            clothingMeasurements = [
                parseSize(chest),
                parseSize(waist),
                parseSize(hips),
                parseSize(clothing_length)
            ];
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'กรุณาระบุขนาดเสื้อผ้าเป็นตัวเลขที่มากกว่า 0'
            });
        }

        const result = await pool.query(`
            INSERT INTO items (
                item_id,
                lender_id,
                category_id,
                title,
                description,
                conditions,
                daily_price,
                images,
                clothing_size,
                chest,
                waist,
                hips,
                clothing_length,
                status,
                created_at,
                updated_at
            )
            VALUES (
                gen_random_uuid(),
                $1, $2, $3, $4, $5, $6,
                $7::jsonb,
                $8, $9, $10, $11, $12,
                'active',
                NOW(),
                NOW()
            )
            RETURNING *
        `, [
            lender_id,
            categoryId,
            title.trim(),
            description.trim(),
            conditions.trim(),
            price,
            JSON.stringify(Array.isArray(images) ? images : []),
            clothing_size || null,
            ...clothingMeasurements
        ]);

        return res.status(201).json({
            success: true,
            message: 'ลงประกาศสำเร็จ',
            data: result.rows[0]
        });

    } catch (err) {
        console.error('POST /api/items error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถลงประกาศได้'
        });
    }
});
// 2. ดึงหมวดหมู่ทั้งหมด (Categories)
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY category_id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

// 3. ดึงรายการเช่าทั้งหมด (Rentals)
app.get('/api/rentals', authenticateToken, async (req, res) => {
    try {
        const { view } = req.query;
        const userId = req.user.userId;

        let query = `
      SELECT
    rentals.rental_id AS id,
    rentals.item_id,
    rentals.borrower_id,

    items.lender_id,

    EXISTS (
        SELECT 1
        FROM reviews
        WHERE reviews.rental_id = rentals.rental_id
          AND reviews.reviewer_id = rentals.borrower_id
    ) AS has_review,

    rentals.start_date,
    rentals.end_date,
    rentals.total_days,
    rentals.total_price,
    rentals.status,
    rentals.payment_status,
    rentals.fine_amount,
    rentals.fine_reason,
    rentals.fine_status,
    rentals.created_at,
    rentals.updated_at,

    items.title AS item_title,
    items.daily_price,

    borrower.full_name AS borrower_name,
    lender.full_name AS owner_name,

    items.images

      FROM rentals

      JOIN items
        ON rentals.item_id = items.item_id

      LEFT JOIN users AS borrower
        ON rentals.borrower_id = borrower.user_id

      LEFT JOIN users AS lender
        ON items.lender_id = lender.user_id
    `;

        const queryParams = [];

        if (userId) {
            if (view === 'lent') {
                // ของของฉัน ที่มีคนอื่นมาขอเช่า
                query += `
          WHERE items.lender_id = $1
          AND rentals.borrower_id <> $1
        `;
            } else {
                // ของที่ฉันไปเช่าจากคนอื่น
                query += `
          WHERE rentals.borrower_id = $1
        `;
            }

            queryParams.push(userId);
        }

        query += ` ORDER BY rentals.created_at DESC`;

        const result = await pool.query(query, queryParams);

        const formattedRows = result.rows.map((row) => {
            let imagePath = null;

            if (Array.isArray(row.images) && row.images.length > 0) {
                imagePath = row.images[0];
            }

            if (imagePath && !imagePath.startsWith('http')) {
                imagePath = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
            }

            return {
                ...row,
                rental_price_per_day: Number(row.daily_price || 0),
                total_rental_price: Number(row.total_price || 0),
                item_image: imagePath
            };
        });

        res.json(formattedRows);

    } catch (err) {
        console.error('Error fetching rentals:', err);

        res.status(500).json({
            success: false,
            error: 'เกิดข้อผิดพลาดภายในระบบ',
        });
    }
});

app.get('/api/rentals/:id', authenticateToken, async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
        return res.status(400).json({ success: false, error: 'รหัสรายการเช่าไม่ถูกต้อง' });
    }
    try {
        const rentalId = req.params.id;
        const userId = req.user.userId || req.user.id;

        const result = await pool.query(`
      SELECT
        r.rental_id AS id,
        r.item_id,
        r.borrower_id,
        i.lender_id,
        i.title AS item_title,
        r.start_date,
        r.end_date,
        r.total_days,
        r.total_price,
        r.status,
        r.payment_status,
        r.fine_amount,
        r.fine_reason,
        r.fine_status,
        COALESCE(a.borrower_accepted, FALSE) AS borrower_accepted,
        COALESCE(a.lender_accepted, FALSE) AS lender_accepted,
        borrower.full_name AS borrower_name,
        lender.full_name AS owner_name
      FROM rentals r
      JOIN items i ON i.item_id = r.item_id
      LEFT JOIN users borrower
        ON borrower.user_id = r.borrower_id
      LEFT JOIN users lender
        ON lender.user_id = i.lender_id
        LEFT JOIN agreements a
        ON a.rental_id = r.rental_id
      WHERE r.rental_id = $1
        AND (
          r.borrower_id = $2
          OR i.lender_id = $2
        )
    `, [rentalId, userId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'ไม่พบรายการเช่า หรือไม่มีสิทธิ์เข้าถึง',
            });
        }

        return res.json({
            success: true,
            data: result.rows[0],
        });

    } catch (err) {
        console.error('Get rental detail error:', err);

        return res.status(500).json({
            success: false,
            error: 'โหลดรายละเอียดการเช่าไม่สำเร็จ',
        });
    }
});

// 3.1 บันทึกคำขอเช่าใหม่ (POST /api/rentals)
app.post('/api/rentals', authenticateToken, async (req, res) => {
    const { item_id, start_date, end_date, agreement_accepted } = req.body;
    const borrowerId = req.user.userId;
    if (agreement_accepted !== true) {
        return res.status(400).json({
            success: false,
            error: 'กรุณาอ่านและยอมรับสัญญาเช่าก่อนส่งคำขอ'
        });
    }

    if (
        typeof item_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item_id) ||
        typeof start_date !== 'string' ||
        typeof end_date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(start_date) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(end_date)
    ) {
        return res.status(400).json({
            success: false,
            error: 'กรุณาระบุสิ่งของและวันที่เช่าให้ถูกต้อง'
        });
    }

    const start = new Date(`${start_date}T00:00:00Z`);
    const end = new Date(`${end_date}T00:00:00Z`);

    if (
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        start.toISOString().slice(0, 10) !== start_date ||
        end.toISOString().slice(0, 10) !== end_date ||
        end < start
    ) {
        return res.status(400).json({
            success: false,
            error: 'ช่วงวันที่เช่าไม่ถูกต้อง'
        });
    }

    // นับรวมวันเริ่มต้นและวันสิ้นสุด
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    if (start_date < today) {
        return res.status(400).json({ success: false, error: 'วันเริ่มเช่าต้องไม่เป็นวันที่ผ่านมาแล้ว' });
    }

    const totalDays =
        Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const itemResult = await client.query(`
            SELECT item_id, title, lender_id, daily_price, status
            FROM items
            WHERE item_id = $1
            FOR UPDATE
        `, [item_id]);

        if (itemResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'ไม่พบสิ่งของ'
            });
        }

        const item = itemResult.rows[0];

        if (item.status !== 'active') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'สิ่งของนี้ยังไม่เปิดให้เช่า'
            });
        }

        if (item.lender_id === borrowerId) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'ไม่สามารถเช่าสิ่งของของตัวเองได้'
            });
        }

        const overlapping = await client.query(`
            SELECT 1 FROM rentals WHERE item_id = $1
              AND status IN ('approved', 'borrowing', 'return_requested', 'inspection_pending', 'fine_pending')
              AND start_date::date <= $3::date AND end_date::date >= $2::date
            LIMIT 1
        `, [item_id, start_date, end_date]);
        if (overlapping.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'สิ่งของนี้มีการจองในช่วงวันที่เลือกแล้ว' });
        }

        // ใช้ราคาจากฐานข้อมูล ไม่เชื่อราคาที่ Frontend ส่งมา
        const dailyPrice = Number(item.daily_price);
        const totalPrice = dailyPrice * totalDays;

        if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'ราคาสิ่งของไม่ถูกต้อง'
            });
        }

        const rentalResult = await client.query(`
            INSERT INTO rentals (
                item_id,
                borrower_id,
                total_days,
                total_price,
                start_date,
                end_date,
                status
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            RETURNING *
        `, [
            item_id,
            borrowerId,
            totalDays,
            totalPrice,
            start_date,
            end_date
        ]);
        // สร้างสัญญาและบันทึกการยอมรับของผู้เช่า
        // ทำใน transaction เดียวกับการสร้างคำขอเช่า
        const rental = rentalResult.rows[0];

        const contractTerms = [
            'สัญญาเช่าสิ่งของผ่านระบบ Easy to Locate',
            `ชื่อสิ่งของ: ${item.title}`,
            `วันที่เริ่มเช่า: ${start_date}`,
            `วันที่สิ้นสุดการเช่า: ${end_date}`,
            `ระยะเวลาเช่า: ${totalDays} วัน`,
            `ค่าเช่าต่อวัน: ${dailyPrice} บาท`,
            `ค่าเช่ารวม: ${totalPrice} บาท`,
            'ผู้เช่าตกลงดูแลรักษาสิ่งของและคืนตามกำหนด',
            'กรณีคืนล่าช้าหรือเกิดความเสียหาย ให้พิจารณาตามเงื่อนไขการเช่าที่ตกลงกัน',
            'ผู้ให้เช่าต้องตรวจสอบและยอมรับสัญญาก่อนอนุมัติคำขอเช่า'
        ].join('\n');

        await client.query(`
    INSERT INTO agreements (
        agreement_id,
        rental_id,
        contract_terms,
        borrower_accepted,
        lender_accepted,
        borrower_accepted_at,
        lender_accepted_at,
        accepted_at
    )
    VALUES (
        gen_random_uuid(),
        $1,
        $2,
        TRUE,
        FALSE,
        CURRENT_TIMESTAMP,
        NULL,
        NULL
    )
`, [
            rental.rental_id,
            contractTerms
        ]);

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
            item.lender_id,
            'คำขอเช่าสิ่งของใหม่',
            `มีผู้ใช้ส่งคำขอเช่า "${item.title}"`,
            'rental_request'
        ]);

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'ส่งคำขอเช่าสำเร็จ',
            data: rentalResult.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/rentals error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถส่งคำขอเช่าได้'
        });
    } finally {
        client.release();
    }
});
// ผู้เช่ายืนยันว่าได้รับสิ่งของแล้ว
app.patch(
    '/api/rentals/:id/confirm-receipt',
    authenticateToken,
    async (req, res) => {
        const client = await pool.connect();

        try {
            const { id } = req.params;
            const userId = req.user.userId;

            await client.query('BEGIN');

            const rentalResult = await client.query(`
                SELECT
                    rental_id,
                    borrower_id,
                    status,
                    payment_status,
                    received_confirmed_at
                FROM rentals
                WHERE rental_id = $1
                FOR UPDATE
            `, [id]);

            if (rentalResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่า'
                });
            }

            const rental = rentalResult.rows[0];

            if (String(rental.borrower_id) !== String(userId)) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    error: 'เฉพาะผู้เช่าเท่านั้นที่ยืนยันรับสิ่งของได้'
                });
            }

            if (
                rental.status !== 'approved' ||
                rental.payment_status !== 'paid'
            ) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'รายการต้องได้รับอนุมัติและชำระเงินเรียบร้อยก่อน'
                });
            }

            if (rental.received_confirmed_at) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'ยืนยันรับสิ่งของไปแล้ว'
                });
            }

            // ต้องมีภาพก่อนส่งมอบจากผู้ให้เช่า
            const photoResult = await client.query(`
                SELECT inspection_id
                FROM rental_inspections
                WHERE rental_id = $1
                  AND inspection_type = 'lender_before'
                LIMIT 1
            `, [id]);

            if (photoResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'ผู้ให้เช่าต้องอัปโหลดภาพก่อนส่งมอบ'
                });
            }

            const result = await client.query(`
                UPDATE rentals
                SET
                    received_confirmed_at = NOW(),
                    status = 'borrowing',
                    updated_at = NOW()
                WHERE rental_id = $1
                  AND status = 'approved'
                RETURNING *
            `, [id]);

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: 'ยืนยันรับสิ่งของและเริ่มการเช่าสำเร็จ',
                data: result.rows[0]
            });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Confirm receipt error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถยืนยันรับสิ่งของได้'
            });

        } finally {
            client.release();
        }
    }
);
// 3.2 อัปเดตสถานะการเช่า
// UPDATE rental status + CREATE NOTIFICATION
app.patch('/api/rentals/:id/status', authenticateToken, async (req, res) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;
        const { status, fine_amount, fine_reason } = req.body;

        const allowedStatuses = [
            'pending',
            'approved',
            'borrowing',
            'return_requested',
            'inspection_pending',
            'fine_pending',
            'completed',
            'damaged',
            'rejected'
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'สถานะไม่ถูกต้อง'
            });
        }

        // ป้องกันการเริ่มเช่าโดยข้ามการยืนยันรับสิ่งของ
        if (status === 'borrowing') {
            return res.status(400).json({
                success: false,
                error: 'กรุณายืนยันรับสิ่งของผ่านขั้นตอนส่งมอบก่อนเริ่มเช่า'
            });
        }

        await client.query('BEGIN');


        // ตรวจสอบสิทธิ์และสถานะของรายการเช่าทุกครั้ง
        // Serialize approvals for the same item, including separate pending requests.
        if (status === 'approved') {
            await client.query(`
                SELECT i.item_id FROM items i
                JOIN rentals r ON r.item_id = i.item_id
                WHERE r.rental_id = $1 FOR UPDATE OF i
            `, [id]);
        }
        const rentalCheck = await client.query(`
    SELECT
        r.rental_id,
        r.borrower_id,
        r.status,
        r.payment_status,
        i.lender_id,
        a.borrower_accepted,
        a.lender_accepted
    FROM rentals r
    JOIN items i ON r.item_id = i.item_id
    LEFT JOIN agreements a ON r.rental_id = a.rental_id
    WHERE r.rental_id = $1
    FOR UPDATE OF r
`, [id]);

        if (rentalCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'ไม่พบรายการเช่า'
            });
        }

        const currentRental = rentalCheck.rows[0];

        const userId = String(req.user.userId);
        const isBorrower = String(currentRental.borrower_id) === userId;
        const isLender = String(currentRental.lender_id) === userId;

        // กำหนดว่าใครเปลี่ยนสถานะอะไรได้ และต้องมาจากสถานะไหน
        const transitionRules = {
            approved: {
                from: ['pending'],
                role: 'lender'
            },

            rejected: {
                from: ['pending'],
                role: 'lender'
            },


            return_requested: {
                from: ['borrowing'],
                role: 'borrower'
            },

            inspection_pending: {
                from: ['return_requested'],
                role: 'lender'
            },

            fine_pending: {
                from: ['inspection_pending'],
                role: 'lender'
            },

            completed: {
                from: ['inspection_pending'],
                role: 'lender'
            }
        }

        const rule = transitionRules[status];

        if (!rule) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'ไม่อนุญาตให้เปลี่ยนเป็นสถานะนี้ผ่าน API'
            });
        }

        const hasPermission =
            (rule.role === 'borrower' && isBorrower) ||
            (rule.role === 'lender' && isLender);

        if (!hasPermission) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                error: 'คุณไม่มีสิทธิ์เปลี่ยนสถานะรายการเช่านี้'
            });
        }

        if (!rule.from.includes(currentRental.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `ไม่สามารถเปลี่ยนสถานะจาก ${currentRental.status} เป็น ${status} ได้`
            });
        }

        // อนุมัติได้ก็ต่อเมื่อทั้งสองฝ่ายยอมรับสัญญาแล้ว
        if (status === 'approved') {
            const overlapping = await client.query(`
                SELECT 1 FROM rentals other
                JOIN rentals target ON target.rental_id = $1
                WHERE other.item_id = target.item_id AND other.rental_id <> target.rental_id
                  AND other.status IN ('approved', 'borrowing', 'return_requested', 'inspection_pending', 'fine_pending')
                  AND other.start_date::date <= target.end_date::date
                  AND other.end_date::date >= target.start_date::date
                LIMIT 1
            `, [id]);
            if (overlapping.rows.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: 'สิ่งของนี้มีการจองในช่วงวันที่เลือกแล้ว' });
            }
            if (
                !currentRental.borrower_accepted ||
                !currentRental.lender_accepted
            ) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'ต้องให้ผู้เช่าและผู้ให้เช่ายอมรับสัญญาครบทั้งสองฝ่ายก่อน'
                });
            }
        }
        // ตรวจสอบภาพหลังใช้งานก่อนอนุญาตให้ขอคืน
        if (status === 'return_requested') {
            const afterPhotoResult = await client.query(`
        SELECT EXISTS (
            SELECT 1
            FROM rental_inspections
            WHERE rental_id = $1
              AND inspection_type = 'borrower_after'
              AND jsonb_typeof(photo_urls) = 'array'
              AND jsonb_array_length(photo_urls) > 0
        ) AS has_after_photos
    `, [id]);

            if (!afterPhotoResult.rows[0].has_after_photos) {
                await client.query('ROLLBACK');

                return res.status(400).json({
                    success: false,
                    error: 'กรุณาอัปโหลดรูปภาพหลังใช้งานก่อนขอคืนสิ่งของ'
                });
            }
        }



        // อัปเดตสถานะ + เอาข้อมูลที่จำเป็นสำหรับ notification
        let result;

        if (status === 'fine_pending') {
            const numericFine = Number(fine_amount);

            // ตรวจสอบจำนวนค่าปรับ
            if (!Number.isFinite(numericFine) || numericFine <= 0) {
                await client.query('ROLLBACK');

                return res.status(400).json({
                    success: false,
                    error: 'ค่าปรับไม่ถูกต้อง'
                });
            }

            // เพิ่มตรงนี้: ตรวจสอบเหตุผลค่าปรับ
            if (
                typeof fine_reason !== 'string' ||
                !fine_reason.trim()
            ) {
                await client.query('ROLLBACK');

                return res.status(400).json({
                    success: false,
                    error: 'กรุณาระบุเหตุผลของค่าปรับ'
                });
            }

            // โค้ด UPDATE เดิมของคุณต่อจากตรงนี้
            result = await client.query(`
        UPDATE rentals
        SET
            status = 'fine_pending',
            fine_amount = $1,
            fine_reason = $2,
            fine_status = 'pending_confirmation',
            updated_at = NOW()
        WHERE rental_id = $3
          AND status = 'inspection_pending'
        RETURNING *
    `, [
                numericFine,
                fine_reason.trim(),
                id
            ]);
        } else {
            result = await client.query(`
        UPDATE rentals
        SET
            status = $1,
            updated_at = NOW()
        WHERE rental_id = $2
          AND status = $3
        RETURNING *
    `, [
                status,
                id,
                currentRental.status
            ]);
        }

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');

            return res.status(404).json({
                success: false,
                error: 'ไม่พบรายการเช่า'
            });
        }

        const rental = result.rows[0];

        // ดึงชื่อสิ่งของ
        const itemResult = await client.query(`
            SELECT title
            FROM items
            WHERE item_id = $1
        `, [rental.item_id]);

        const itemTitle =
            itemResult.rows[0]?.title || 'สิ่งของ';

        // =========================
        // Notification
        // =========================

        if (status === 'approved') {
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
                    $1,
                    $2,
                    $3,
                    $4,
                    FALSE,
                    NOW()
                )
            `, [
                rental.borrower_id,
                'อนุมัติการเช่าแล้ว',
                `คำขอเช่า "${itemTitle}" ของคุณได้รับการอนุมัติแล้ว`,
                'approved'
            ]);
        }

        if (status === 'rejected') {
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
                    $1,
                    $2,
                    $3,
                    $4,
                    FALSE,
                    NOW()
                )
            `, [
                rental.borrower_id,
                'คำขอเช่าถูกปฏิเสธ',
                `คำขอเช่า "${itemTitle}" ของคุณถูกปฏิเสธ`,
                'rejected'
            ]);
        }
        if (status === 'borrowing') {
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
            $1,
            $2,
            $3,
            $4,
            FALSE,
            NOW()
        )
    `, [
                rental.borrower_id,
                'เริ่มการเช่าแล้ว',
                `การเช่า "${itemTitle}" ของคุณเริ่มต้นแล้ว`,
                'borrowing'
            ]);
        }

        if (status === 'fine_pending') {
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
            $1,
            $2,
            $3,
            $4,
            FALSE,
            NOW()
        )
    `, [
                rental.borrower_id,
                'มีค่าปรับรอยืนยัน',
                `เจ้าของกำหนดค่าปรับสำหรับ "${itemTitle}" จำนวน ฿${Number(rental.fine_amount || 0).toLocaleString()} กรุณาตรวจสอบและยืนยัน`,
                'fine_pending'
            ]);
        }
        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'อัปเดตสถานะสำเร็จ',
            data: rental
        });

    } catch (err) {
        await client.query('ROLLBACK');

        console.error('Update rental status error:', err);

        res.status(500).json({
            success: false,
            error: 'เกิดข้อผิดพลาดภายในระบบ',
        });
    } finally {
        client.release();
    }
});

// 3.3 ผู้เช่ายืนยันค่าปรับ
app.patch('/api/rentals/:id/fine/confirm', authenticateToken, async (req, res) => {
    let client;

    try {
        const { id } = req.params;

        // ใช้ตัวตนจาก JWT แทน borrower_id ที่ Frontend ส่งมา
        const borrowerId = req.user.userId;

        if (!borrowerId) {
            return res.status(401).json({
                success: false,
                error: 'กรุณาเข้าสู่ระบบก่อน'
            });
        }

        client = await pool.connect();
        await client.query('BEGIN');

        // อนุญาตเฉพาะผู้เช่าของรายการนั้น
        // และต้องอยู่ในสถานะรอยืนยันค่าปรับเท่านั้น
        const result = await client.query(`
            UPDATE rentals
            SET
                fine_status = 'confirmed',
                status = 'fine_pending',
                updated_at = NOW()
            WHERE rental_id = $1
              AND borrower_id = $2
              AND status = 'fine_pending'
              AND fine_status = 'pending_confirmation'
            RETURNING *
        `, [
            id,
            borrowerId
        ]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');

            return res.status(400).json({
                success: false,
                error: 'ไม่มีสิทธิ์ยืนยันค่าปรับ หรือรายการไม่ได้อยู่ในสถานะรอยืนยัน'
            });
        }

        const rental = result.rows[0];

        // ดึงข้อมูลเจ้าของสิ่งของและชื่อสิ่งของ
        const itemResult = await client.query(`
            SELECT
                title,
                lender_id
            FROM items
            WHERE item_id = $1
            LIMIT 1
        `, [rental.item_id]);

        const item = itemResult.rows[0];

        if (item) {
            // แจ้งเตือนเจ้าของสิ่งของเมื่อผู้เช่ายืนยันค่าปรับ
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
                    $1,
                    $2,
                    $3,
                    $4,
                    FALSE,
                    NOW()
                )
            `, [
                item.lender_id,
                'ผู้เช่ายืนยันค่าปรับแล้ว',
                `ผู้เช่ายืนยันค่าปรับสำหรับ "${item.title}" จำนวน ฿${Number(rental.fine_amount || 0).toLocaleString()}`,
                'fine_confirmed'
            ]);
        }

        await client.query('COMMIT');

        return res.json({
            success: true,
            message: 'ยืนยันค่าปรับเรียบร้อย',
            data: rental
        });

    } catch (err) {
        if (client) {
            await client.query('ROLLBACK');
        }

        console.error('Confirm fine error:', err);

        return res.status(500).json({
            success: false,
            error: 'เกิดข้อผิดพลาดในการยืนยันค่าปรับ'
        });

    } finally {
        if (client) {
            client.release();
        }
    }
});
// 4. ดึงข้อมูลผู้ใช้ทั้งหมด (Users)
// ปิดการเปิดเผยรายชื่อและข้อมูลส่วนตัวของผู้ใช้ทั้งหมด
app.get('/api/users', authenticateToken, (req, res) => {
    return res.status(403).json({
        success: false,
        error: 'ไม่อนุญาตให้เข้าถึงรายชื่อผู้ใช้ทั้งหมด'
    });
});

// Import Routes จากโฟลเดอร์ routes
const authRouter = require('./routes/auth');
const verificationsRouter = require('./routes/verifications');
const agreementsRouter = require('./routes/agreements');
const chatsRouter = require('./routes/chats');
const notificationsRouter = require('./routes/notifications');
const bankAccountsRouter = require('./routes/bankAccounts');
const rentalPaymentsRouter = require('./routes/rentalPayments');

app.use('/api/auth', authRouter(pool));
app.use('/api/verifications', verificationsRouter(pool));
app.use('/api/agreements', agreementsRouter(pool));
app.use('/api/chats', chatsRouter(pool));
app.use('/api/notifications', notificationsRouter(pool));
app.use('/api/rental-payments', rentalPaymentsRouter(pool));


app.get('/api/items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ success: false, error: 'รหัสสิ่งของไม่ถูกต้อง' });
        }

        const result = await pool.query(`
            SELECT
                items.*,
                categories.category_name,
                users.full_name AS lender_name,

                b.recommended_min_price,
                b.recommended_max_price,
                b.sample_count,
                b.benchmark_status,

                CASE
                    WHEN b.item_id IS NULL
                        THEN 'INSUFFICIENT_DATA'

                    WHEN b.benchmark_status = 'INSUFFICIENT_DATA'
                        THEN 'INSUFFICIENT_DATA'

                    WHEN b.recommended_min_price IS NULL
                        OR b.recommended_max_price IS NULL
                        THEN 'INSUFFICIENT_DATA'

                    WHEN items.daily_price < b.recommended_min_price
                        THEN 'BELOW_MARKET'

                    WHEN items.daily_price <= b.recommended_max_price
                        THEN 'FAIR'

                    ELSE 'ABOVE_MARKET'
                END AS price_evaluation

            FROM items

            LEFT JOIN categories
                ON items.category_id = categories.category_id

            LEFT JOIN users
                ON items.lender_id = users.user_id

            LEFT JOIN item_price_benchmarks b
                ON items.item_id = b.item_id

            WHERE items.item_id = $1
              AND items.status <> 'hidden'
            LIMIT 1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Item not found'
            });
        }

        const rawItem = result.rows[0];

        // จัดการรูปภาพ
        let imgPath =
            rawItem.image_url ||
            rawItem.image ||
            rawItem.photo;

        if (Array.isArray(rawItem.images) && rawItem.images.length > 0) {
            imgPath = rawItem.images[0];
        }

        if (
            imgPath &&
            !imgPath.startsWith('http') &&
            !imgPath.startsWith('/')
        ) {
            imgPath = `/uploads/${imgPath}`;
        }

        const finalImage =
            imgPath ||
            'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=500';

        const item = {
            ...rawItem,

            image_url: finalImage,
            image: finalImage,
            images: Array.isArray(rawItem.images) && rawItem.images.length
                ? rawItem.images.map(image => typeof image === 'string' && !image.startsWith('http') && !image.startsWith('/') ? `/uploads/${image}` : image)
                : [finalImage],


        };

        res.json(item);

    } catch (err) {
        console.error('GET /api/items/:id error:', err);

        res.status(500).json({
            error: 'Database Error'
        });
    }
});
const bcrypt = require('bcrypt');

// 6. ดึงรีวิวจริงของสิ่งของ
// 6.1 ดึงรีวิวของสิ่งของ พร้อมรูปภาพ
app.get('/api/items/:id/reviews', async (req, res) => {
    try {
        const { id } = req.params;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ success: false, error: 'รหัสสิ่งของไม่ถูกต้อง' });
        }

        const result = await pool.query(`
            SELECT
                reviews.review_id,
                reviews.rental_id,
                reviews.reviewer_id,
                reviews.reviewee_id,
                reviews.rating,
                reviews.comment,
                reviews.photo_urls,
                reviews.created_at,
                users.full_name AS reviewer_name
            FROM reviews
            JOIN rentals
                ON reviews.rental_id = rentals.rental_id
            LEFT JOIN users
                ON reviews.reviewer_id = users.user_id
            WHERE rentals.item_id = $1
            ORDER BY reviews.created_at DESC
        `, [id]);

        return res.json(result.rows);

    } catch (err) {
        console.error('Error fetching reviews:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถโหลดรีวิวได้'
        });
    }
});
// 6.2 เพิ่มรีวิวใหม่
app.post(
    '/api/reviews',
    authenticateToken,
    (req, res, next) => {
        reviewUpload.array('photos', 5)(req, res, (err) => {
            if (err) {
                console.error('Review upload error:', err);
                for (const file of req.files || []) fs.unlink(file.path, () => {});

                return res.status(400).json({
                    success: false,
                    error: 'ไม่สามารถอัปโหลดรูปภาพได้ กรุณาตรวจสอบประเภทและขนาดไฟล์'
                });
            }
            next();
        });
    },
    async (req, res) => {
        const uploadedFiles = req.files || [];
        let client;
        let committed = false;

        const cleanupFiles = () => {
            uploadedFiles.forEach(file => {
                fs.unlink(file.path, () => { });
            });
        };

        try {
            const { rental_id, rating, comment } = req.body;
            const reviewerId = req.user.userId;
            const numericRating = Number(rating);

            if (typeof rental_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rental_id) ||
                !Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5 ||
                typeof comment !== 'string' || !comment.trim() || comment.trim().length > 3000 ||
                !uploadedFiles.every(validItemImageFile)) {
                cleanupFiles();
                return res.status(400).json({
                    success: false,
                    error: 'ข้อมูลรีวิวหรือคะแนนไม่ถูกต้อง'
                });
            }

            client = await pool.connect();
            await client.query('BEGIN');
            const rentalCheck = await client.query(`
                SELECT
                    r.rental_id,
                    r.borrower_id,
                    r.status,
                    i.lender_id,
                    i.title AS item_title
                FROM rentals r
                JOIN items i ON r.item_id = i.item_id
                WHERE r.rental_id = $1
                FOR UPDATE OF r
            `, [rental_id]);

            if (rentalCheck.rows.length === 0) {
                cleanupFiles();
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบรายการเช่า'
                });
            }

            const rental = rentalCheck.rows[0];

            if (String(rental.borrower_id) !== String(reviewerId)) {
                cleanupFiles();
                return res.status(403).json({
                    success: false,
                    error: 'คุณไม่มีสิทธิ์รีวิวรายการนี้'
                });
            }

            if (rental.status !== 'completed') {
                cleanupFiles();
                return res.status(400).json({
                    success: false,
                    error: 'รีวิวได้เฉพาะรายการเช่าที่เสร็จสิ้นแล้ว'
                });
            }

            const existing = await client.query(`
                SELECT review_id
                FROM reviews
                WHERE rental_id = $1 AND reviewer_id = $2
                LIMIT 1
            `, [rental_id, reviewerId]);

            if (existing.rows.length > 0) {
                cleanupFiles();
                return res.status(409).json({
                    success: false,
                    error: 'รายการเช่านี้ถูกรีวิวแล้ว'
                });
            }

            await storage.persist('reviews', uploadedFiles);
            const photoUrls = uploadedFiles.map(
                file => `/uploads/reviews/${file.filename}`
            );

            // Serialize ratings for a recipient so concurrent reviews cannot leave a stale average.
            await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [rental.lender_id]);
            const result = await client.query(`
                INSERT INTO reviews (
                    review_id,
                    rental_id,
                    reviewer_id,
                    reviewee_id,
                    rating,
                    comment,
                    photo_urls,
                    created_at
                )
                VALUES (
                    gen_random_uuid(),
                    $1, $2, $3, $4, $5, $6::jsonb, NOW()
                )
                RETURNING *
            `, [
                rental_id,
                reviewerId,
                rental.lender_id,
                numericRating,
                typeof comment === 'string'
                    ? comment.trim()
                    : null,
                JSON.stringify(photoUrls)
            ]);

            await client.query(`UPDATE users SET trust_score = (
                SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE reviewee_id = $1
            ), updated_at = NOW() WHERE user_id = $1`, [rental.lender_id]);
            await client.query(`INSERT INTO notifications (user_id, title, message, type)
                VALUES ($1, $2, $3, 'review')`, [rental.lender_id, 'ได้รับรีวิวใหม่', `คุณได้รับรีวิวสำหรับ "${rental.item_title}"`]);
            await client.query('COMMIT');
            committed = true;

            return res.status(201).json({
                success: true,
                message: 'เพิ่มรีวิวพร้อมรูปภาพสำเร็จ',
                data: result.rows[0]
            });

        } catch (err) {
            cleanupFiles();
            console.error('Create review error:', err);

            return res.status(500).json({
                success: false,
                error: 'ไม่สามารถบันทึกรีวิวได้'
            });
        } finally {
            if (client) {
                if (!committed) await client.query('ROLLBACK').catch(() => {});
                client.release();
            }
        }
    }
);

// GET /api/notifications
// ดึงการแจ้งเตือนของผู้ใช้ที่เข้าสู่ระบบเท่านั้น
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await pool.query(`
            SELECT
                notification_id,
                user_id,
                title,
                message,
                type,
                is_read,
                created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        `, [userId]);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (err) {
        console.error('GET /api/notifications error:', err);

        res.status(500).json({
            success: false,
            error: 'ไม่สามารถโหลดการแจ้งเตือนได้'
        });
    }
});
app.get('/api/rentals/:id/photo-file/:filename', authenticateToken, async (req, res) => {
    const { id, filename } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}\.(jpg|png)$/i.test(filename)) {
        return res.status(400).json({ success: false, error: 'รหัสรูปภาพไม่ถูกต้อง' });
    }
    try {
        const access = await pool.query(`
            SELECT 1 FROM rental_inspections ri
            JOIN rentals r ON r.rental_id = ri.rental_id
            JOIN items i ON i.item_id = r.item_id
            WHERE r.rental_id = $1 AND (r.borrower_id = $2 OR i.lender_id = $2)
              AND ri.photo_urls @> $3::jsonb LIMIT 1
        `, [id, req.user.userId, JSON.stringify([`/uploads/rentals/${filename}`])]);
        if (!access.rows.length) {
            return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์ดูรูปภาพนี้' });
        }
        res.set('Cache-Control', 'private, no-store');
        return storage.send(res, 'rentals', filename);
    } catch (error) {
        console.error('Read rental photo error:', error);
        return res.status(500).json({ success: false, error: 'ไม่สามารถเปิดรูปภาพได้' });
    }
});

app.get('/api/rentals/:id/photos', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const rentalResult = await pool.query(`
            SELECT r.borrower_id, i.lender_id
            FROM rentals r
            JOIN items i ON r.item_id = i.item_id
            WHERE r.rental_id = $1
        `, [id]);

        if (rentalResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'ไม่พบรายการเช่า'
            });
        }

        const rental = rentalResult.rows[0];

        if (
            String(userId) !== String(rental.borrower_id) &&
            String(userId) !== String(rental.lender_id)
        ) {
            return res.status(403).json({
                success: false,
                error: 'ไม่มีสิทธิ์ดูรูปภาพรายการนี้'
            });
        }

        const result = await pool.query(`
            SELECT
                inspection_id,
                inspection_type,
                photo_urls,
                created_at
            FROM rental_inspections
            WHERE rental_id = $1
            ORDER BY created_at DESC
        `, [id]);

        return res.json({
            success: true,
            data: result.rows
        });

    } catch (err) {
        console.error('Get rental photos error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถโหลดรูปภาพได้'
        });
    }
});
const PORT = process.env.PORT || 5000;
// ดึงบัญชีธนาคารของผู้ใช้ที่เข้าสู่ระบบ
app.get('/api/bank-accounts/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await pool.query(`
            SELECT
                bank_account_id,
                bank_name,
                account_name,
                account_number
            FROM user_bank_accounts
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId]);

        return res.json({
            success: true,
            data: result.rows[0] || null
        });

    } catch (err) {
        console.error('Get bank account error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถโหลดบัญชีธนาคารได้'
        });
    }
});
// เพิ่มหรือแก้ไขบัญชีธนาคารของผู้ใช้
app.put('/api/bank-accounts/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const {
            bank_name,
            account_name,
            account_number
        } = req.body;

        const bankName = String(bank_name || '').trim();
        const accountName = String(account_name || '').trim();
        const accountNumber = String(account_number || '')
            .replace(/-/g, '')
            .trim();

        // ตรวจสอบข้อมูล
        if (!bankName || !accountName) {
            return res.status(400).json({
                success: false,
                error: 'กรุณากรอกชื่อธนาคารและชื่อเจ้าของบัญชี'
            });
        }

        if (!/^[0-9]{10,15}$/.test(accountNumber)) {
            return res.status(400).json({
                success: false,
                error: 'เลขบัญชีต้องเป็นตัวเลข 10-15 หลัก'
            });
        }

        // ตรวจสอบว่าผู้ใช้มีบัญชีอยู่แล้วหรือไม่
        const existing = await pool.query(`
            SELECT bank_account_id
            FROM user_bank_accounts
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId]);

        let result;

        if (existing.rows.length > 0) {
            // มีบัญชีแล้ว -> อัปเดต
            result = await pool.query(`
                UPDATE user_bank_accounts
                SET
                    bank_name = $1,
                    account_name = $2,
                    account_number = $3,
                    updated_at = NOW()
                WHERE bank_account_id = $4
                  AND user_id = $5
                RETURNING *
            `, [
                bankName,
                accountName,
                accountNumber,
                existing.rows[0].bank_account_id,
                userId
            ]);
        } else {
            // ยังไม่มีบัญชี -> เพิ่มใหม่
            result = await pool.query(`
                INSERT INTO user_bank_accounts (
                    bank_account_id,
                    user_id,
                    bank_name,
                    account_name,
                    account_number,
                    created_at,
                    updated_at
                )
                VALUES (
                    gen_random_uuid(),
                    $1, $2, $3, $4,
                    NOW(), NOW()
                )
                RETURNING *
            `, [
                userId,
                bankName,
                accountName,
                accountNumber
            ]);
        }

        return res.json({
            success: true,
            message: 'บันทึกบัญชีธนาคารสำเร็จ',
            data: {
                bank_account_id: result.rows[0].bank_account_id,
                bank_name: result.rows[0].bank_name,
                account_name: result.rows[0].account_name,
                account_number: result.rows[0].account_number
            }
        });

    } catch (err) {
        console.error('Save bank account error:', err);

        return res.status(500).json({
            success: false,
            error: 'ไม่สามารถบันทึกบัญชีธนาคารได้'
        });
    }
});

app.use('/api/admin', require('./routes/admin')(pool));

// ระบบข้อพิพาทสำหรับผู้เช่าและผู้ให้เช่า
app.use('/api/disputes', require('./routes/disputes')(pool));

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        await storage.ready();
        res.json({ success: true, status: 'ready' });
    } catch {
        res.status(503).json({ success: false, status: 'unavailable' });
    }
});
if (serveFrontend) {
    app.use(express.static(frontendDist, { index: false }));
    app.get(/^(?!\/(?:api|uploads)(?:\/|$)).*/, (req, res, next) => {
        if (path.extname(req.path) || !req.accepts('html')) return next();
        res.set('Cache-Control', 'no-store');
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}
app.use((req, res) => res.status(404).json({ success: false, error: 'ไม่พบหน้าหรือบริการที่เรียกใช้' }));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('Request error:', error.message);
    res.status(error.status >= 400 && error.status < 500 ? error.status : 500).json({ success: false, error: 'ไม่สามารถดำเนินการคำขอนี้ได้' });
});
let server;
async function start() {
    await require('./scripts/migrate-profile.cjs')(pool);
    if (production) { await pool.query('SELECT 1'); await storage.ready(); }
    server = app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
    server.on('error', error => { console.error('Server startup failed:', error.code); process.exitCode = 1; pool.end(); });
}
start().catch(error => { console.error('Server startup failed:', error.code || error.message); process.exitCode = 1; pool.end(); });
const shutdown = () => {
    if (!server) return;
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
