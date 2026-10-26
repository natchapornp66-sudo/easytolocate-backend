const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const authenticateToken = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const { uploadRoot } = require('../config');
const storageService = require('../storage');
const directory = path.join(uploadRoot, 'verifications');
fs.mkdirSync(directory, { recursive: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const upload = multer({
    storage: multer.diskStorage({
        destination: directory,
        filename: (req, file, cb) => cb(null, crypto.randomUUID() + (file.mimetype === 'image/png' ? '.png' : '.jpg')),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 3 },
    fileFilter: (req, file, cb) => ['image/png', 'image/jpeg'].includes(file.mimetype)
        ? cb(null, true) : cb(new Error('รองรับเฉพาะ JPG และ PNG')),
}).fields([{ name: 'id_card_image', maxCount: 1 }, { name: 'selfie_image', maxCount: 1 }]);
const summary = row => row ? ({
    verification_id: row.verification_id, user_id: row.user_id, status: row.status,
    id_card_last4: row.id_card_number.slice(-4), verified_at: row.verified_at,
    created_at: row.created_at, updated_at: row.updated_at,
}) : null;
function validNumber(value) {
    if (typeof value !== 'string' || !/^[0-9]{13}$/.test(value)) return false;
    const sum = [...value.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (13 - index), 0);
    return Number(value[12]) === (11 - sum % 11) % 10;
}
function validImage(file) {
    const fd = fs.openSync(file.path, 'r');
    try {
        const b = Buffer.alloc(8), n = fs.readSync(fd, b, 0, 8, 0);
        return file.mimetype === 'image/png'
            ? n === 8 && b.equals(Buffer.from('89504e470d0a1a0a', 'hex'))
            : n >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    } finally { fs.closeSync(fd); }
}
module.exports = pool => {
    const router = express.Router();
    router.use(authenticateToken);
    router.get('/admin', requireAdmin, async (req, res) => {
        try {
            const r = await pool.query(`SELECT v.*, u.full_name, u.email FROM user_verifications v
                JOIN users u ON u.user_id=v.user_id ORDER BY (v.status='pending') DESC, v.created_at DESC`);
            res.json({ success: true, data: r.rows.map(row => ({ ...summary(row), full_name: row.full_name, email: row.email })) });
        } catch (error) {
            console.error('KYC queue error:', error.message);
            res.status(500).json({ success: false, error: 'ไม่สามารถโหลดคำขอยืนยันตัวตนได้' });
        }
    });
    router.get('/user/:user_id', async (req, res) => {
        if (req.params.user_id !== req.user.userId) return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์ดูข้อมูลยืนยันตัวตนของผู้อื่น' });
        try {
            const r = await pool.query('SELECT * FROM user_verifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.userId]);
            return res.json({ success: true, data: summary(r.rows[0]) });
        } catch (error) {
            console.error('Read KYC error:', error.message);
            return res.status(500).json({ success: false, error: 'ไม่สามารถโหลดสถานะยืนยันตัวตนได้' });
        }
    });
    router.post('/', (req, res) => {
        upload(req, res, async uploadError => {
            const files = Object.values(req.files || {}).flat();
            const cleanup = () => Promise.all(files.map(f => fs.promises.unlink(f.path).catch(() => {})));
            if (uploadError) { await cleanup(); return res.status(400).json({ success: false, error: uploadError.message }); }
            let client;
            try {
                if (req.body.user_id && req.body.user_id !== req.user.userId) {
                    await cleanup(); return res.status(403).json({ success: false, error: 'ส่งข้อมูลได้เฉพาะบัญชีของตัวเอง' });
                }
                if (!validNumber(req.body.id_card_number) || !req.files?.id_card_image?.[0] ||
                    !req.files?.selfie_image?.[0] || !files.every(validImage)) {
                    await cleanup(); return res.status(400).json({ success: false, error: 'กรุณาระบุเลขบัตร 13 หลักที่ถูกต้อง พร้อมภาพบัตรและภาพเซลฟี JPG/PNG ขนาดไม่เกิน 5 MB ต่อภาพ' });
                }
                client = await pool.connect(); await client.query('BEGIN');
                await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [req.user.userId]);
                const current = await client.query('SELECT status FROM user_verifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.userId]);
                if (['pending', 'approved'].includes(current.rows[0]?.status)) {
                    await client.query('ROLLBACK'); await cleanup();
                    return res.status(409).json({ success: false, error: 'มีคำขอที่รอตรวจสอบหรือผ่านการยืนยันแล้ว' });
                }
                await storageService.persist('verifications', files);
                const r = await client.query(`INSERT INTO user_verifications
                    (user_id,id_card_number,id_card_image_url,selfie_image_url,status)
                    VALUES ($1,$2,$3,$4,'pending') RETURNING *`,
                    [req.user.userId, req.body.id_card_number, req.files.id_card_image[0].filename, req.files.selfie_image[0].filename]);
                await client.query('COMMIT');
                return res.status(201).json({ success: true, data: summary(r.rows[0]) });
            } catch (error) {
                if (client) await client.query('ROLLBACK').catch(() => {});
                await cleanup(); console.error('Submit KYC error:', error.message);
                return res.status(500).json({ success: false, error: 'ไม่สามารถส่งข้อมูลยืนยันตัวตนได้' });
            } finally { if (client) client.release(); }
        });
    });
    router.get('/:id/files/:type', async (req, res) => {
        if (!uuid.test(req.params.id) || !['id-card', 'selfie'].includes(req.params.type)) {
            return res.status(400).json({ success: false, error: 'รหัสเอกสารไม่ถูกต้อง' });
        }
        try {
            const r = await pool.query(`SELECT v.*, u.role AS viewer_role FROM user_verifications v
                JOIN users u ON u.user_id=$2 WHERE v.verification_id=$1`, [req.params.id, req.user.userId]);
            const row = r.rows[0];
            if (!row) return res.status(404).json({ success: false, error: 'ไม่พบเอกสาร' });
            if (row.user_id !== req.user.userId && row.viewer_role !== 'admin') return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์ดูเอกสารนี้' });
            const filename = req.params.type === 'id-card' ? row.id_card_image_url : row.selfie_image_url;
            if (!/^[0-9a-f-]{36}\.(png|jpg)$/i.test(filename)) return res.status(404).json({ success: false, error: 'เอกสารเดิมยังไม่มีไฟล์ในระบบ' });
            res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
            return storageService.send(res, 'verifications', filename);
        } catch (error) {
            console.error('KYC file error:', error.message);
            return res.status(500).json({ success: false, error: 'ไม่สามารถเปิดเอกสารได้' });
        }
    });
    router.patch('/:id/review', requireAdmin, async (req, res) => {
        if (!uuid.test(req.params.id) || !['approved', 'rejected'].includes(req.body?.status)) {
            return res.status(400).json({ success: false, error: 'ผลการตรวจสอบไม่ถูกต้อง' });
        }
        let client;
        try {
            client = await pool.connect(); await client.query('BEGIN');
            const r = await client.query('SELECT * FROM user_verifications WHERE verification_id=$1 FOR UPDATE', [req.params.id]);
            const row = r.rows[0];
            if (!row || row.status !== 'pending' || row.user_id === req.user.userId) {
                await client.query('ROLLBACK');
                return res.status(!row ? 404 : row.user_id === req.user.userId ? 403 : 409).json({ success: false, error: 'ไม่สามารถตรวจคำขอนี้ได้ หรือคำขอถูกพิจารณาแล้ว' });
            }
            if (req.body.status === 'approved') {
                const documents = [row.id_card_image_url, row.selfie_image_url];
                const present = await Promise.all(documents.map(async filename => {
                    if (!/^[0-9a-f-]{36}\.(png|jpg)$/i.test(filename)) return false;
                    return storageService.exists('verifications', filename);
                }));
                if (!present.every(Boolean)) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ success: false, error: 'เอกสารไม่ครบหรือเป็นข้อมูลตัวอย่าง กรุณาปฏิเสธคำขอเพื่อให้ผู้ใช้ส่งเอกสารใหม่' });
                }
            }
            const updated = await client.query(`UPDATE user_verifications SET status=$1::text,
                verified_at=CASE WHEN $1::text='approved' THEN NOW() ELSE NULL END, updated_at=NOW()
                WHERE verification_id=$2 RETURNING *`, [req.body.status, row.verification_id]);
            await client.query(`INSERT INTO notifications (user_id,title,message,type)
                VALUES ($1,$2,$3,$4)`, [row.user_id, 'ผลการยืนยันตัวตน',
                req.body.status === 'approved' ? 'การยืนยันตัวตนของคุณผ่านการตรวจสอบแล้ว' : 'การยืนยันตัวตนยังไม่ผ่าน กรุณาตรวจสอบเอกสารและส่งใหม่ในหน้าโปรไฟล์',
                'verification_' + req.body.status]);
            await client.query('COMMIT');
            return res.json({ success: true, data: summary(updated.rows[0]) });
        } catch (error) {
            if (client) await client.query('ROLLBACK').catch(() => {});
            console.error('Review KYC error:', error.message);
            return res.status(500).json({ success: false, error: 'ไม่สามารถบันทึกผลยืนยันตัวตนได้' });
        } finally { if (client) client.release(); }
    });
    return router;
};
