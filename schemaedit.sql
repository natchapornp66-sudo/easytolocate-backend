-- 1. ตารางสัญญาเช่าอิเล็กทรอนิกส์ (agreements)
CREATE TABLE agreements (
    agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID NOT NULL UNIQUE,
    contract_terms TEXT NOT NULL,
    borrower_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    lender_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    accepted_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agreements_rental FOREIGN KEY (rental_id) REFERENCES rentals(rental_id) ON DELETE CASCADE
);

-- 2. ตารางการยืนยันตัวตน / KYC (user_verifications)
CREATE TABLE user_verifications (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    id_card_number VARCHAR(20) NOT NULL,
    id_card_image_url VARCHAR(255) NOT NULL,
    selfie_image_url VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    verified_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_verifications_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT chk_verification_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- 3. ตารางระบบแจ้งเตือน (notifications)
CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 4. ตารางบันทึกการสนทนาภายในระบบ (chat_messages)
CREATE TABLE chat_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL,
    receiver_id UUID NOT NULL,
    rental_id UUID NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_chat_sender FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_receiver FOREIGN KEY (receiver_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_rental FOREIGN KEY (rental_id) REFERENCES rentals(rental_id) ON DELETE SET NULL
);

-- Index สำหรับสปีดการดึงแชท
CREATE INDEX idx_chat_conversation ON chat_messages(sender_id, receiver_id);
*//

-- 1. เพิ่มข้อมูล user_verifications (12 รายการ)
INSERT INTO user_verifications (verification_id, user_id, id_card_number, id_card_image_url, selfie_image_url, status, verified_at)
SELECT 
    gen_random_uuid(),
    u.user_id,
    LPAD((1000000000000 + i)::text, 13, '0'),
    'https://example.com/idcards/id_' || i || '.jpg',
    'https://example.com/selfies/selfie_' || i || '.jpg',
    CASE WHEN i % 3 = 0 THEN 'pending' WHEN i % 5 = 0 THEN 'rejected' ELSE 'approved' END,
    CURRENT_TIMESTAMP - (i || ' days')::INTERVAL
FROM generate_series(1, 12) AS i
CROSS JOIN LATERAL (SELECT user_id FROM users ORDER BY random() LIMIT 1) u;


-- 2. เพิ่มข้อมูล agreements (ดึงเฉพาะ rental_id ที่ยังไม่มีสัญญา และสุ่มไม่ซ้ำกัน)
INSERT INTO agreements (agreement_id, rental_id, contract_terms, borrower_accepted, lender_accepted, accepted_at)
SELECT 
    gen_random_uuid(),
    r.rental_id,
    'ข้อตกลงและเงื่อนไขการเช่า: ผู้เช่ายินยอมรับผิดชอบค่าเสียหายตามจริงหากอุปกรณ์ชำรุด',
    TRUE,
    (random() > 0.5), -- สุ่มสถานะ TRUE/FALSE
    CURRENT_TIMESTAMP - (floor(random() * 100) || ' hours')::INTERVAL
FROM (
    SELECT rental_id 
    FROM rentals 
    WHERE rental_id NOT IN (SELECT rental_id FROM agreements)
    ORDER BY random() 
    LIMIT 12
) r;


-- 3. เพิ่มข้อมูล notifications (12 รายการ)
INSERT INTO notifications (notification_id, user_id, title, message, type, is_read)
SELECT 
    gen_random_uuid(),
    u.user_id,
    CASE (i % 4)
        WHEN 0 THEN 'คำขอเช่าสินค้าใหม่'
        WHEN 1 THEN 'อนุมัติการเช่าแล้ว'
        WHEN 2 THEN 'แจ้งเตือนใกล้กำหนดคืน'
        ELSE 'คุณได้รับข้อความใหม่'
    END,
    'ข้อความแจ้งเตือนระบบรายการที่ ' || i || ' กรุณาตรวจสอบรายละเอียดในแอปพลิเคชัน',
    CASE (i % 4)
        WHEN 0 THEN 'rental_request'
        WHEN 1 THEN 'approved'
        WHEN 2 THEN 'due_return'
        ELSE 'chat'
    END,
    CASE WHEN i % 2 = 0 THEN TRUE ELSE FALSE END
FROM generate_series(1, 12) AS i
CROSS JOIN LATERAL (SELECT user_id FROM users ORDER BY random() LIMIT 1) u;


-- 4. เพิ่มข้อมูล chat_messages (12 รายการ)
INSERT INTO chat_messages (message_id, sender_id, receiver_id, rental_id, message, is_read)
SELECT 
    gen_random_uuid(),
    u1.user_id,
    u2.user_id,
    r.rental_id,
    'ข้อความแชททดสอบลำดับที่ ' || i || ': สะดวกนัดรับสินค้ารอบกี่โมงครับ?',
    CASE WHEN i % 2 = 0 THEN TRUE ELSE FALSE END
FROM generate_series(1, 12) AS i
CROSS JOIN LATERAL (SELECT user_id FROM users ORDER BY random() LIMIT 1) u1
CROSS JOIN LATERAL (SELECT user_id FROM users WHERE user_id <> u1.user_id ORDER BY random() LIMIT 1) u2
LEFT JOIN LATERAL (SELECT rental_id FROM rentals ORDER BY random() LIMIT 1) r ON TRUE;
*//

-- 1. เพิ่มฟิลด์ในตาราง users (คะแนนความน่าเชื่อถือ และ สถานะบัญชี)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS trust_score NUMERIC(3,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE users 
DROP CONSTRAINT IF EXISTS chk_user_status,
ADD CONSTRAINT chk_user_status CHECK (status IN ('active', 'suspended', 'banned'));


-- 2. เพิ่มฟิลด์ในตาราง items (เงื่อนไขการเช่า, ค่าประกัน, สถานะโพสต์)
ALTER TABLE items 
ADD COLUMN IF NOT EXISTS rental_conditions TEXT NULL,
ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE items 
DROP CONSTRAINT IF EXISTS chk_item_status,
ADD CONSTRAINT chk_item_status CHECK (status IN ('active', 'hidden', 'banned'));


-- 3. เพิ่มฟิลด์ในตาราง rentals (สถานะการเช่ารองรับ Lifecycle เพิ่มเติม)
-- (อิงจากภาพก่อนหน้า ตาราง rentals มี start_date, end_date, total_price แล้ว)
ALTER TABLE rentals 
DROP CONSTRAINT IF EXISTS chk_rental_status,
ADD CONSTRAINT chk_rental_status CHECK (
    status IN ('pending', 'approved', 'renting', 'returned', 'completed', 'rejected', 'disputed')
);


-- 4. เพิ่มฟิลด์ในตาราง rental_inspections (ประเภทรูปถ่ายตรวจสภาพ)
ALTER TABLE rental_inspections 
ADD COLUMN IF NOT EXISTS inspection_type VARCHAR(30) NOT NULL DEFAULT 'lender_before';

ALTER TABLE rental_inspections 
DROP CONSTRAINT IF EXISTS chk_inspection_type,
ADD CONSTRAINT chk_inspection_type CHECK (
    inspection_type IN ('lender_before', 'borrower_before', 'borrower_after')
);


-- 5. เพิ่มฟิลด์ในตาราง reviews (ผู้ถูกรีวิว สำหรับ Two-way Review)
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS reviewee_id UUID NULL;

ALTER TABLE reviews 
DROP CONSTRAINT IF EXISTS fk_reviews_reviewee,
ADD CONSTRAINT fk_reviews_reviewee FOREIGN KEY (reviewee_id) REFERENCES users(user_id) ON DELETE CASCADE;


-- 6. เพิ่ม updated_at ให้ตารางหลัก (ไว้ทำ Audit Trail)
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

*//

