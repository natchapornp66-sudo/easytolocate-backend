// โค้ดสร้างตาราง ชุด1
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    role VARCHAR(20) DEFAULT 'user',
    status VARCHAR(20) DEFAULT 'active',
    terms_accepted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
    category_id SERIAL PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL
);

CREATE TABLE items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lender_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    category_id INT REFERENCES categories(category_id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    conditions TEXT,
    daily_price DECIMAL(10, 2) NOT NULL,
    images JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rentals (
    rental_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID REFERENCES items(item_id) ON DELETE CASCADE,
    borrower_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INT NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    contract_accepted BOOLEAN DEFAULT FALSE,
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rental_inspections (
    inspection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID REFERENCES rentals(rental_id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(user_id),
    stage VARCHAR(30) NOT NULL,
    image_urls JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE disputes (
    dispute_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID REFERENCES rentals(rental_id) ON DELETE CASCADE,
    reported_by UUID REFERENCES users(user_id),
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    admin_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID REFERENCES rentals(rental_id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES users(user_id),
    reviewee_id UUID REFERENCES users(user_id),
    rating INT CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
// โค้ดสร้างตาราง ชุด2
-- 1. ตาราง users
CREATE TABLE users (
    user_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50),
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. ตาราง categories
CREATE TABLE categories (
    category_id SERIAL PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL,
    description TEXT
);

-- 3. ตาราง items
CREATE TABLE items (
    item_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lender_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    category_id INT REFERENCES categories(category_id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    conditions TEXT,
    daily_price NUMERIC(10, 2) NOT NULL,
    images JSONB,
    status VARCHAR(50) DEFAULT 'available',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. ตาราง rentals
CREATE TABLE rentals (
    rental_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id UUID REFERENCES items(item_id) ON DELETE CASCADE,
    borrower_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INT NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. ตาราง reviews
CREATE TABLE reviews (
    review_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rental_id UUID REFERENCES rentals(rental_id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. ตาราง rental_inspections
CREATE TABLE rental_inspections (
    inspection_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rental_id UUID REFERENCES rentals(rental_id) ON DELETE CASCADE,
    inspector_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    inspection_type VARCHAR(50), -- เช่น 'checkin', 'checkout'
    condition_notes TEXT,
    photo_urls JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. ตาราง disputes
CREATE TABLE disputes (
    dispute_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rental_id UUID REFERENCES rentals(rental_id) ON DELETE CASCADE,
    reported_by UUID REFERENCES users(user_id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
// ใส่ข้อมูลแบบมี1-2ชุด
-- ใส่ข้อมูล Users
INSERT INTO users (email, full_name, phone_number, password_hash) 
VALUES 
('owner@example.com', 'สมชาย สายเช่า', '0812345678', 'hashed_pass_1'),
('renter@example.com', 'สมหญิง รักดี', '0898765432', 'hashed_pass_2');

-- ใส่ข้อมูล Categories
INSERT INTO categories (category_name, description) 
VALUES 
('กล้องและอุปกรณ์ถ่ายภาพ', 'กล้อง เลนส์ และอุปกรณ์ถ่ายภาพทุกชนิด'),
('อุปกรณ์แคมป์ปิ้ง', 'เต็นท์ ถุงนอน และอุปกรณ์เดินป่า'),
('เครื่องใช้ไฟฟ้าและเกม', 'คอนโซลเกม และอุปกรณ์ไอที');

-- ใส่ข้อมูล Items
INSERT INTO items (lender_id, category_id, title, description, conditions, daily_price, images) 
VALUES 
(
    (SELECT user_id FROM users WHERE email = 'owner@example.com'), 
    (SELECT category_id FROM categories WHERE category_name = 'กล้องและอุปกรณ์ถ่ายภาพ'), 
    'กล้อง Sony A7IV + เลนส์ Kit', 
    'กล้องสภาพดีมาก เหมาะสำหรับถ่ายภาพนิ่งและวิดีโอ 4K', 
    'ต้องวางเงินประกัน 2,000 บาท', 
    550.00, 
    '["https://example.com/sony1.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'owner@example.com'), 
    (SELECT category_id FROM categories WHERE category_name = 'อุปกรณ์แคมป์ปิ้ง'), 
    'เต็นท์ Coleman สำหรับ 4 คน', 
    'เต็นท์กันน้ำกันลมอย่างดี กางง่าย', 
    'ทำความสะอาดก่อนคืน', 
    300.00, 
    '["https://example.com/tent1.jpg"]'
);

-- ใส่ข้อมูล Rentals
INSERT INTO rentals (item_id, borrower_id, start_date, end_date, total_days, total_price, status)
VALUES (
    (SELECT item_id FROM items WHERE title LIKE 'กล้อง Sony%'),
    (SELECT user_id FROM users WHERE email = 'renter@example.com'),
    '2026-09-01',
    '2026-09-03',
    2,
    1100.00,
    'completed'
);

-- ใส่ข้อมูล Reviews
INSERT INTO reviews (rental_id, reviewer_id, rating, comment)
VALUES (
    (SELECT rental_id FROM rentals LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'renter@example.com'),
    5,
    'กล้องใช้งานได้ดีมาก เจ้าของใจดีตอบไวครับ'
);

-- ใส่ข้อมูล Rental Inspections
INSERT INTO rental_inspections (rental_id, inspector_id, inspection_type, condition_notes, photo_urls)
VALUES (
    (SELECT rental_id FROM rentals LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'owner@example.com'),
    'checkout',
    'ตัวเลนส์ไม่มีรอยขีดข่วน บอดี้กล้องสะอาด สมบูรณ์ดี',
    '["https://example.com/check1.jpg"]'
);

-- ใส่ข้อมูล Disputes
INSERT INTO disputes (rental_id, reported_by, reason, status)
VALUES (
    (SELECT rental_id FROM rentals LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'renter@example.com'),
    'ส่งมอบสินค้าช้ากว่าเวลาที่นัดหมายไว้ 1 ชั่วโมง',
    'resolved'
);
//ใส่ข้อมูลที่เพิ่มมา10ชุด
-- ============================================================
-- 1. เพิ่ม USERS อีก 10 คน
-- ============================================================
INSERT INTO users (email, full_name, phone_number, password_hash) VALUES
('ananda.k@example.com', 'อนันดา กิจเจริญ', '0811112233', 'pass_hash_101'),
('boonyarit.p@example.com', 'บุญญฤทธิ์ ประเสริฐ', '0822223344', 'pass_hash_102'),
('chanya.s@example.com', 'ชัญญา สุวรรณ', '0833334455', 'pass_hash_103'),
('danai.t@example.com', 'ดนัย ตั้งมั่น', '0844445566', 'pass_hash_104'),
('ekkapol.m@example.com', 'เอกพล มีสุข', '0855556677', 'pass_hash_105'),
('fahsai.r@example.com', 'ฟ้าใส รุ่งเรือง', '0866667788', 'pass_hash_106'),
('kamon.w@example.com', 'กมล วงศ์สว่าง', '0877778899', 'pass_hash_107'),
('ladda.c@example.com', 'ลัดดา เจริญสุข', '0888889900', 'pass_hash_108'),
('manoch.n@example.com', 'มานพ นามวงศ์', '0899990011', 'pass_hash_109'),
('nattaya.k@example.com', 'ณัฐธิดา แก้วมณี', '0800001122', 'pass_hash_110');

-- ============================================================
-- 2. เพิ่ม CATEGORIES อีก 10 หมวดหมู่
-- ============================================================
INSERT INTO categories (category_name, description) VALUES
('เสื้อผ้าและแฟชั่น', 'ชุดราตรี ชุดสูท และ costume สำหรับงานต่าง ๆ'),
('เครื่องดนตรี', 'กีตาร์ คีย์บอร์ด ดนตรีสากลและดนตรีไทย'),
('กระเป๋าและแบรนด์เนม', 'กระเป๋าเดินทาง และกระเป๋าแบรนด์เนมแท้'),
('ยานพาหนะและสกู๊ตเตอร์', 'จักรยาน สกู๊ตเตอร์ไฟฟ้า และอุปกรณ์เดินทาง'),
('อุปกรณ์กีฬาและออกกำลังกาย', 'เซิร์ฟบอร์ด แร็กเกต และอุปกรณ์ฟิตเนส'),
('ของแต่งบ้านและอีเวนต์', 'ไฟตกแต่ง ซุ้มงานแต่ง และอุปกรณ์ปาร์ตี้'),
('เครื่องมือช่างและ DIY', 'สว่านไร้สาย เครื่องฉีดน้ำแรงดันสูง และอุปกรณ์งานช่าง'),
('หนังสือและสื่อความรู้', 'ตำราเรียน การ์ตูนชุด และบอร์ดเกม'),
('อุปกรณ์เด็กและแม่', 'คาร์ซีท รถผลักเดิน และเปลเด็ก'),
('ของสะสมและโมเดล', 'ฟิกเกอร์ กล้องฟิล์มวินเทจ และของสะสมหายาก');

-- ============================================================
-- 3. เพิ่ม ITEMS อีก 10 รายการ
-- ============================================================
INSERT INTO items (lender_id, category_id, title, description, conditions, daily_price, images) VALUES
(
    (SELECT user_id FROM users WHERE email = 'ananda.k@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'เครื่องใช้ไฟฟ้าและเกม'),
    'PlayStation 5 (Disc Edition) พร้อม 2 จอย', 'เครื่อง PS5 สภาพใหม่ พร้อมเกมยอดฮิตในเครื่อง', 'ต้องใช้นำบัตรประชาชนมาคืนเครื่อง', 450.00, '["https://example.com/ps5_1.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'boonyarit.p@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'อุปกรณ์แคมป์ปิ้ง'),
    'เก้าอี้แคมป์ปิ้ง Helinox Chair One', 'เก้าอี้พับน้ำหนักเบา นั่งสบาย พกพาสะดวก', 'ห้ามใช้วางใกล้กองไฟ', 80.00, '["https://example.com/helinox.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'chanya.s@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'เสื้อผ้าและแฟชั่น'),
    'ชุดราตรียาวสีส้มอิฐ ไซส์ M', 'ชุดออกงานทรงสวย ผ้านุ่มใส่สบาย ไม่ร้อน', 'ซักแห้งให้ก่อนส่งคืน หรือจ่ายค่าซัก 150 บาท', 350.00, '["https://example.com/dress.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'danai.t@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'เครื่องดนตรี'),
    'กีตาร์โปร่ง Taylor GS Mini', 'เสียงกังวาน ขนาดพกพาง่าย พร้อมกระเป๋าคู่ตัว', 'วางเงินประกัน 1,000 บาท', 300.00, '["https://example.com/taylor.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'ekkapol.m@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'กระเป๋าและแบรนด์เนม'),
    'กระเป๋าเดินทาง Samsonite 28 นิ้ว', 'กระเป๋าเดินทางใบใหญ่ ล้อลากลื่น 360 องศา', 'ทำความสะอาดภายในก่อนคืน', 200.00, '["https://example.com/samsonite.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'fahsai.r@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'เครื่องมือช่างและ DIY'),
    'สว่านไร้สาย BOSCH 18V พร้อมชุดดอกสว่าน', 'สว่านเจาะไม้และเหล็ก พลังสูง แบตเตอรี่ 2 ก้อน', 'ทำความสะอาดคราบฝุ่นก่อนคืน', 150.00, '["https://example.com/drill.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'kamon.w@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'กล้องและอุปกรณ์ถ่ายภาพ'),
    'โดรน DJI Mini 3 Pro + ชุด Fly More Combo', 'โดรนถ่ายภาพและวิดีโอ 4K น้ำหนักเบา ไม่ต้องลงทะเบียนยาก', 'ผู้เช่าต้องรับผิดชอบหากทำตกเสียหาย', 800.00, '["https://example.com/dji.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'ladda.c@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'ยานพาหนะและสกู๊ตเตอร์'),
    'สกู๊ตเตอร์ไฟฟ้า Xiaomi Pro 2', 'วิ่งได้ไกลสูงสุด 45 กม. พับใส่ท้ายรถได้', 'สวมหมวกกันน็อคขณะขับขี่', 250.00, '["https://example.com/scooter.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'manoch.n@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'อุปกรณ์กีฬาและออกกำลังกาย'),
    'เซิร์ฟบอร์ด Surfskate Smoothstar 33 นิ้ว', 'บอร์ดสภาพดี ล้อลื่น สำหรับซ้อมเล่นบนบก', 'สวมอุปกรณ์ป้องกันขณะเล่น', 180.00, '["https://example.com/surfskate.jpg"]'
),
(
    (SELECT user_id FROM users WHERE email = 'nattaya.k@example.com'),
    (SELECT category_id FROM categories WHERE category_name = 'ของแต่งบ้านและอีเวนต์'),
    'ชุดโปรเจกเตอร์ 4K + จอพกพา 100 นิ้ว', 'เหมาะสำหรับทำหนังกลางแปลงส่วนตัวหรือจัดปาร์ตี้', 'ระวังอย่าให้จอมุมยับ', 400.00, '["https://example.com/projector.jpg"]'
);

-- ============================================================
-- 4. เพิ่ม RENTALS อีก 10 รายการ
-- ============================================================
INSERT INTO rentals (item_id, borrower_id, start_date, end_date, total_days, total_price, status) VALUES
(
    (SELECT item_id FROM items WHERE title LIKE 'PlayStation 5%'),
    (SELECT user_id FROM users WHERE email = 'chanya.s@example.com'),
    '2026-09-02', '2026-09-05', 3, 1350.00, 'completed'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'เก้าอี้แคมป์ปิ้ง%'),
    (SELECT user_id FROM users WHERE email = 'danai.t@example.com'),
    '2026-09-03', '2026-09-06', 3, 240.00, 'completed'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'ชุดราตรียาว%'),
    (SELECT user_id FROM users WHERE email = 'fahsai.r@example.com'),
    '2026-09-04', '2026-09-05', 1, 350.00, 'completed'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'กีตาร์โปร่ง%'),
    (SELECT user_id FROM users WHERE email = 'ekkapol.m@example.com'),
    '2026-09-05', '2026-09-08', 3, 900.00, 'completed'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'กระเป๋าเดินทาง%'),
    (SELECT user_id FROM users WHERE email = 'kamon.w@example.com'),
    '2026-09-01', '2026-09-07', 6, 1200.00, 'completed'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'สว่านไร้สาย%'),
    (SELECT user_id FROM users WHERE email = 'ladda.c@example.com'),
    '2026-09-06', '2026-09-07', 1, 150.00, 'completed'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'โดรน DJI%'),
    (SELECT user_id FROM users WHERE email = 'manoch.n@example.com'),
    '2026-09-07', '2026-09-09', 2, 1600.00, 'completed'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'สกู๊ตเตอร์ไฟฟ้า%'),
    (SELECT user_id FROM users WHERE email = 'nattaya.k@example.com'),
    '2026-09-08', '2026-09-10', 2, 500.00, 'approved'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'เซิร์ฟบอร์ด%'),
    (SELECT user_id FROM users WHERE email = 'ananda.k@example.com'),
    '2026-09-09', '2026-09-11', 2, 360.00, 'pending'
),
(
    (SELECT item_id FROM items WHERE title LIKE 'ชุดโปรเจกเตอร์%'),
    (SELECT user_id FROM users WHERE email = 'boonyarit.p@example.com'),
    '2026-09-10', '2026-09-12', 2, 800.00, 'pending'
);

-- ============================================================
-- 5. เพิ่ม REVIEWS อีก 10 รายการ
-- ============================================================
INSERT INTO reviews (rental_id, reviewer_id, rating, comment) VALUES
(
    (SELECT rental_id FROM rentals WHERE total_price = 1350.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'chanya.s@example.com'),
    5, 'เครื่องใหม่มากครับ เกมเยอะ เล่นสนุกกับเพื่อนยาวๆ เลย'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 240.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'danai.t@example.com'),
    5, 'เก้าอี้พกพาสะดวก เบามาก นั่งสบายเหมาะกับการไปแคมป์'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 350.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'fahsai.r@example.com'),
    4, 'ชุดตรงตามรูปครับ ผ้าดีมาก ใส่พอดีตัวเลย'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 900.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ekkapol.m@example.com'),
    5, 'กีตาร์เสียงดีมาก เสียงใส เจ้าของแลกเปลี่ยนคำแนะนำดีมากครับ'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 1200.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'kamon.w@example.com'),
    5, 'กระเป๋าแข็งแรง จุของได้เยอะมาก ล้อลากลื่นดีครับ'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 150.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ladda.c@example.com'),
    4, 'สว่านแบตอึด เจาะงานไม้ในบ้านผ่านฉลุยครับ'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 1600.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'manoch.n@example.com'),
    5, 'โดรนบินนิ่ง ภาพสวยสมคำลือ เจ้าของสอนวิธีใช้เบื้องต้นให้ด้วย'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 500.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'nattaya.k@example.com'),
    4, 'สกู๊ตเตอร์ขี่สนุกมาก แบตเตอรี่อึดใช้งานได้ทั้งวัน'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 360.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ananda.k@example.com'),
    5, 'บอร์ดเลี้ยวง่าย วงล้อลื่นดี เอาไปซ้อมท่าได้ดีมาก'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 800.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'boonyarit.p@example.com'),
    5, 'ภาพคมชัด ลำโพงเสียงดังจัดปาร์ตี้กลางแจ้งได้สบายๆ'
);

-- ============================================================
-- 6. เพิ่ม RENTAL_INSPECTIONS อีก 10 รายการ
-- ============================================================
INSERT INTO rental_inspections (rental_id, inspector_id, inspection_type, condition_notes, photo_urls) VALUES
(
    (SELECT rental_id FROM rentals WHERE total_price = 1350.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ananda.k@example.com'),
    'checkout', 'ตัวเครื่อง PS5 ไม่มีรอย จอยควบคุมทำงานปกติทั้ง 2 ตัว', '["https://example.com/check_ps5.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 240.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'boonyarit.p@example.com'),
    'checkout', 'ผ้าเก้าอี้สะอาด ขาพับไม่มีรอยบุบ', '["https://example.com/check_chair.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 350.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'chanya.s@example.com'),
    'checkout', 'ชุดไม่มีรอยฉีกขาด ซักสะอาดเรียบร้อย', '["https://example.com/check_dress.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 900.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'danai.t@example.com'),
    'checkout', 'บอร์ดี้กีตาร์ไม่มีรอยขีดข่วน สายครบ 6 สาย', '["https://example.com/check_guitar.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 1200.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ekkapol.m@example.com'),
    'checkout', 'ล้อลากสมบูรณ์ ซิปใช้งานได้ดี รหัสล็อคเซ็ตคืนเป็น 000', '["https://example.com/check_bag.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 150.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'fahsai.r@example.com'),
    'checkout', 'ดอกสว่านอยู่ครบ แบตเตอรี่ชาร์จเต็มคืน', '["https://example.com/check_drill.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 1600.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'kamon.w@example.com'),
    'checkout', 'ใบพัดโดรนไม่มีรอยบิ่น เซ็นเซอร์ทำงานสมบูรณ์', '["https://example.com/check_drone.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 500.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ladda.c@example.com'),
    'checkin', 'ตรวจสอบก่อนส่งมอบ มีรอยข่วนเล็กน้อยด้านล่างพุ่มบังโคลน', '["https://example.com/check_scooter.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 360.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'manoch.n@example.com'),
    'checkin', 'สภาพบอร์ดพร้อมใช้งาน ตรวจสอบน็อตยึดล้อแน่นหนาดี', '["https://example.com/check_surf.jpg"]'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 800.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'nattaya.k@example.com'),
    'checkin', 'เลนส์โปรเจกเตอร์ไร้รอย สายต่อครบชุดพร้อมรีโมท', '["https://example.com/check_proj.jpg"]'
);

-- ============================================================
-- 7. เพิ่ม DISPUTES อีก 10 รายการ
-- ============================================================
INSERT INTO disputes (rental_id, reported_by, reason, status) VALUES
(
    (SELECT rental_id FROM rentals WHERE total_price = 1350.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'chanya.s@example.com'),
    'ได้รับสาย HDMI ไม่ตรงรุ่น ทำให้ภาพกระตุกช่วงแรก', 'resolved'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 240.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'boonyarit.p@example.com'),
    'ผู้เช่าส่งคืนเก้าอี้ล่าช้ากว่ากำหนด 2 ชั่วโมง', 'resolved'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 350.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'chanya.s@example.com'),
    'มีรอยเปื้อนคราบอาหารเล็กน้อยตรงชายกระเป๋า', 'resolved'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 900.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ekkapol.m@example.com'),
    'สายกีตาร์สาย 1 ขาดขณะใช้งาน (ตกลงเปลี่ยนสายใหม่ให้แล้ว)', 'resolved'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 1200.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ekkapol.m@example.com'),
    'ผู้เช่าลืมรหัสล็อคกระเป๋า ทำให้ต้องช่วยปลดรหัสผ่านแชท', 'resolved'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 150.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'fahsai.r@example.com'),
    'ดอกสว่านขนาด 6mm หายไป 1 ดอก', 'open'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 1600.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'manoch.n@example.com'),
    'เมมโมรี่การ์ดในชุดโดรนความจุไม่ตรงตามที่ระบุในรายละเอียด', 'open'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 500.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'nattaya.k@example.com'),
    'ขอนัดเปลี่ยนจุดรับสกู๊ตเตอร์กะทันหัน', 'open'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 360.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'ananda.k@example.com'),
    'ผู้เช่าขอยกเลิกคำขอเช่าล่วงหน้า 1 ชั่วโมง', 'open'
),
(
    (SELECT rental_id FROM rentals WHERE total_price = 800.00 LIMIT 1),
    (SELECT user_id FROM users WHERE email = 'boonyarit.p@example.com'),
    'ปลั๊กต่อโปรเจกเตอร์ไม่แน่น หลุดง่ายระหว่างใช้งาน', 'open'
);

