# แก้บั๊กจากการตรวจระบบ 27 ตุลาคม 2026

แก้เฉพาะรายการที่พบ โดยคง React/Express/PostgreSQL, JWT, เส้นทาง API, Storage และขั้นตอนการเช่าเดิม

## สิ่งที่แก้

1. สลิปค่าเช่า: รับและยืนยันได้เฉพาะรายการ approved ที่ยังไม่ paid ใช้ transaction และ row lock กันส่งพร้อมกัน และยังปฏิเสธสลิปเก่าที่ค้างได้โดยไม่เปลี่ยนรายการเป็นจ่ายแล้ว
2. การสมัคร: ตรวจชื่อ อีเมล รหัสผ่าน และข้อมูล optional ก่อนเข้า DB ป้องกัน password ว่าง/สั้นและอีเมลผิดรูปแบบ ตอบ 400 แทน 500 เมื่อข้อมูลไม่ครบ
3. รหัสผ่าน: จำกัดไม่เกิน 72 UTF-8 bytes ทั้งสมัครและ login เพื่อไม่ให้ bcrypt ตัดส่วนท้ายเงียบ ๆ มีข้อความแจ้งและการตรวจในหน้าสมัครด้วย
4. อีเมล: trim และ normalize ตอนสมัคร, login แบบไม่ขึ้นกับตัวพิมพ์ใหญ่/เล็ก ป้องกันสมัครซ้ำพร้อมกันด้วย advisory lock; บัญชีเก่าที่ซ้ำกันต่างตัวพิมพ์ยังแยกกัน โดยเลือก exact email ก่อน ไม่ merge บัญชีหรือข้อมูลเดิม
5. ไฟล์สลิปค่าเช่า/ค่าปรับ: ตรวจ signature จริงของ PNG/JPEG/WebP และตั้งนามสกุลจาก MIME ที่ผ่านการตรวจ ไม่เชื่อชื่อไฟล์อย่างเดียว
6. รูปสิ่งของหลายภาพ: API ส่งกลับทุกภาพ หน้า ItemDetail แสดง thumbnail ให้เลือกภาพ มี fallback รูปเดิมสำหรับข้อมูลเก่า
7. รหัสรายการเช่า: UUID ผิดรูปแบบตอบ 400 ก่อน query
8. ที่อยู่/GPS: หน้าสมัครเก็บ coordinates จริงและส่งพร้อม address ไป backend เพิ่ม nullable columns address/latitude/longitude ให้ users แบบ additive/idempotent ไม่ลบหรือเขียนทับข้อมูลเก่า เฉพาะ API โปรไฟล์ของเจ้าของบัญชีจึงอ่านข้อมูลนี้ได้
9. เปลี่ยนคำว่า “สินค้า” เป็น “สิ่งของ” ในข้อความ source ของ frontend และข้อความตอบกลับ backend โดยไม่เปลี่ยนชื่อ field/API/ข้อมูลที่ผู้ใช้เคยกรอก

## การย้ายข้อมูลและ compatibility

- `scripts/migrate-profile.cjs` เพิ่มเฉพาะ columns ที่ยังไม่มี ไม่แก้ password hash, email เดิม หรือสถานะธุรกรรม
- Render startup เรียก migration ก่อนตรวจ DB และ server startup ตรวจซ้ำอย่าง idempotent รองรับทั้งฐานข้อมูลที่มีอยู่และ fresh bootstrap
- ทดสอบ migration กับตารางรูปแบบเก่าที่มีข้อมูลอยู่ ยืนยันว่าแถวเดิมอยู่และรันซ้ำได้
- ไม่เขียนสถานะ paid/rejected ในข้อมูลจริงย้อนหลังอัตโนมัติ รายการที่ผิดไปแล้วต้องตรวจหลักฐานก่อนตัดสินใจแก้ข้อมูล
- ที่อยู่/GPS ของบัญชีเก่าซึ่งไม่เคยถูกส่งมาบันทึกไม่สามารถสร้างย้อนหลังได้ fields ใหม่จะเป็น NULL
- บัญชีเก่าที่เคยตั้งรหัสผ่านเกิน 72 bytes ต้องเปลี่ยนรหัสผ่านกับผู้ดูแล; ไม่สามารถกู้ส่วนท้ายที่ bcrypt เคยตัดออกจาก hash เดิมได้ และไม่ได้ reset รหัสผ่านผู้ใช้โดยพลการ

## ผลทดสอบ

- Regression เดิม 283/283 ผ่าน: การเช่า 78, ข้อพิพาท/admin 81, profile/KYC/notifications 50, ประกาศ/ค้นหา 38, chat/reviews 36
- กรณีบั๊กเพิ่มเติม 39/39 ผ่าน รวมส่งสลิปพร้อมกัน, สลิปค้างใน rejected, fake binary, อีเมลซ้ำต่าง case, legacy case variants, byte length ภาษาไทย, พิกัด 0, การเก็บ address, migration ไม่ทำข้อมูลเดิมหาย และภาพที่สอง
- รวม API regression 322 checks ผ่านทั้งโหมด local storage และ Supabase REST จำลอง โดยแต่ละรอบใช้ schema QA ที่สร้างใหม่และลบเมื่อจบ ไม่ทดสอบเขียนข้อมูลผู้ใช้จริง
- Frontend 24/24 ผ่าน รวมเลือกภาพที่สอง, ส่ง address/GPS จริงจากแบบฟอร์ม และกัน password เกิน byte limit
- Backend configuration/storage tests 15/15 ผ่าน
- TypeScript, production build, syntax check และ diff whitespace check ผ่าน
- การพิสูจน์บนเว็บจริงหลัง deploy จะตรวจแบบไม่สร้างธุรกรรม/บัญชีจริงเพิ่ม; ผล integration ข้างต้นอยู่ในสภาพแวดล้อมแยก ไม่ใช่การโอนเงินจริง

รายละเอียดผลในเครื่อง: `system-fixes-regression-result.json`, `deploy-regression-result.json`, `supabase-regression-result.json` และผล regression เดิมของแต่ละส่วน
