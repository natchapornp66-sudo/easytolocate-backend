const express = require('express');

module.exports = (pool) => {
    const router = express.Router();

    // เซ็น/ยอมรับสัญญาเช่า
    router.post('/', async (req, res) => {
        const { rental_id, contract_terms, borrower_accepted, lender_accepted } = req.body;
        try {
            const result = await pool.query(
                `INSERT INTO agreements (agreement_id, rental_id, contract_terms, borrower_accepted, lender_accepted, accepted_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (rental_id) 
         DO UPDATE SET borrower_accepted = EXCLUDED.borrower_accepted, lender_accepted = EXCLUDED.lender_accepted, accepted_at = CURRENT_TIMESTAMP
         RETURNING *`,
                [rental_id, contract_terms, borrower_accepted, lender_accepted]
            );
            res.status(200).json({ success: true, data: result.rows[0] });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ดึงรายละเอียดสัญญาตาม rental_id
    router.get('/rental/:rental_id', async (req, res) => {
        const { rental_id } = req.params;
        try {
            const result = await pool.query(
                `SELECT a.*, r.status AS rental_status, i.title AS item_title
         FROM agreements a
         JOIN rentals r ON a.rental_id = r.rental_id
         JOIN items i ON r.item_id = i.item_id
         WHERE a.rental_id = $1`,
                [rental_id]
            );
            res.json({ success: true, data: result.rows[0] || null });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};