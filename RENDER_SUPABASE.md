# Deploy ฟรี: Render + Supabase

ใช้ frontend และ backend คนละ repository เดิม ไม่เปลี่ยนระบบสมาชิก JWT/การเช่า/การชำระเงิน ใช้ Supabase เฉพาะ PostgreSQL กับ Storage; ไม่ย้ายไป Supabase Auth

## บัญชีที่ต้องมี

1. GitHub — มีแล้ว ใช้ repository `natchapornp66-sudo/easytolocate_edit` และ `natchapornp66-sudo/easytolocate-backend`
2. [Render](https://dashboard.render.com/register) — สมัคร/เข้าใช้ด้วย GitHub อนุญาตเข้าถึงเฉพาะสอง repository นี้
3. [Supabase](https://supabase.com/dashboard/sign-up) — สมัครด้วย GitHub สร้าง organization แบบ Free และสร้าง project ใหม่ แนะนำเลือกภูมิภาคใกล้ผู้ใช้ไทยและใกล้ Render เช่น Singapore ถ้ามีให้เลือก เก็บรหัสผ่านฐานข้อมูลในที่ปลอดภัย ไม่ส่งลงแชต

ไม่ต้องซื้อโดเมน ใช้ชื่อ `.onrender.com` ที่ Render จัดให้ อย่าสมัครบริการเสียเงินหรือเพิ่ม paid disk สำหรับชุดนี้

## Supabase: เตรียมฐานข้อมูลกับพื้นที่ไฟล์

- ในหน้า Connect เลือก **Session pooler** (ปกติ port 5432) และคัดลอก connection string สำหรับ backend โดยใส่รหัสผ่านจริงแทน placeholder หากรหัสผ่านมีอักขระพิเศษต้อง URL-encode ส่วนนั้น ไม่ใช้ Transaction pooler port 6543 สำหรับชุดนี้ และไม่ใส่ URL นี้ใน frontend
- Database ต้องเป็น project ใหม่ที่ยังไม่มีตารางแอป backend จะติดตั้ง bootstrap เฉพาะเมื่อ public schema ว่าง ถ้ามีตารางอยู่แล้วจะตรวจความเข้ากันได้และหยุดเมื่อไม่ผ่าน ไม่ทับตารางเดิม
- ไป Storage สร้าง bucket ชื่อ **easytolocate-files** ตั้ง **Private** ไม่เปิด Public กำหนดขนาดต่อไฟล์อย่างน้อย 5 MB และรองรับ image/jpeg, image/png, image/webp, image/gif ไม่ต้องเพิ่ม policy อนุญาต anonymous/authenticated
- จาก Settings/API Keys ใช้ Project URL และ **legacy service_role key** สำหรับ backend เท่านั้น เก็บลง Environment ของ Render โดยตรง ห้ามใส่ key นี้ใน VITE_*, source, GitHub หรือแชต
- ปิด **Data API** ของ Supabase เพราะแอปใช้ Express ตรวจสิทธิ์และเข้าถึง PostgreSQL โดยตรง ไม่ได้ใช้ REST/GraphQL database API การปิดนี้ไม่ใช่การปิด Storage API
- start:render จะเปิด RLS และถอนสิทธิ์ anon/authenticated เฉพาะตารางแอปอีกชั้น บัญชีเชื่อมต่อควรเป็น postgres/table owner ตาม Session pooler ที่เตรียมไว้
- เปิด TLS สำหรับ DB ด้วย DB_SSL=true และถ้า project ต้องใช้ CA เฉพาะ ให้ดาวน์โหลดใบรับรองจาก Supabase ใส่ Render Secret File แล้วตั้ง DB_SSL_CA_FILE ให้ตรง ห้ามแก้ด้วย rejectUnauthorized=false

เอกสารอ้างอิง: [Session pooler](https://supabase.com/docs/guides/database/connecting-to-postgres), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [ปิด Data API](https://supabase.com/docs/guides/api/securing-your-api)

## Render: สร้าง frontend ก่อนเพื่อรับ URL

สร้าง **Static Site** จาก repository frontend เลือก branch ที่มีไฟล์ deploy รอบนี้:

| ช่อง | ค่า |
|---|---|
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |
| NODE_VERSION | `24.13.0` |
| VITE_API_URL | เว้นว่างชั่วคราว จากนั้นใส่ URL backend แล้ว rebuild |
| Rewrite | `/*` → `/index.html` |

เว็บรอบแรกใช้รับชื่อ URL ก่อน ยังโหลดข้อมูลไม่ได้จนตั้ง VITE_API_URL เสร็จ จด URL frontend ที่ Render ให้จริง ไม่เดาชื่อโดเมน

สามารถใช้ `render.yaml` ใน repo สร้าง Blueprint แทนการกรอกช่องต่าง ๆ ได้ ไฟล์นี้กำหนด static site เท่านั้น ไม่มี paid database/disk

## Render: สร้าง backend

สร้าง **Web Service** จาก repository backend เลือก **Free** และ branch ที่เตรียม:

| ช่อง | ค่า |
|---|---|
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `npm run start:render` |
| Health check | `/api/health` |
| NODE_VERSION | `24.13.0` |
| NODE_ENV | `production` |
| HOST | `0.0.0.0` |
| SERVE_FRONTEND | `false` |
| FRONTEND_URL | URL HTTPS frontend จากขั้นก่อน ไม่มี `/` ท้ายหรือ path |
| DATABASE_URL | Session pooler connection string ของ Supabase |
| DB_SSL | `true` |
| JWT_SECRET | สุ่มใหม่อย่างน้อย 32 ตัวอักษร เก็บค่าเดิมไว้เมื่อ deploy รอบต่อไป |
| STORAGE_DRIVER | `supabase` |
| UPLOAD_DIR | `/tmp/easytolocate-uploads` — ใช้พักไฟล์ระหว่างตรวจเท่านั้น |
| SUPABASE_URL | Project URL เช่น `https://PROJECT_REF.supabase.co` |
| SUPABASE_SERVICE_ROLE_KEY | legacy service_role key — backend เท่านั้น |
| SUPABASE_STORAGE_BUCKET | `easytolocate-files` |

PORT ให้ใช้ค่าที่ Render กำหนด ไม่ต้องเพิ่ม persistent disk ไฟล์อยู่ใน Supabase แล้ว การเริ่ม backend ครั้งแรกจะติดตั้งเฉพาะ schema ว่าง, ตรวจ DB และตรวจว่า bucket เป็น private ถ้าพบปัญหาจะไม่รับการอัปโหลดแบบเก็บไฟล์ลงเครื่องชั่วคราวเงียบ ๆ

ใช้ `render.yaml` เป็น Blueprint ได้เช่นกัน โดยเลือก Free ตามไฟล์; secret ใช้ sync:false เพื่อกรอกใน Dashboard และ JWT ใช้ generateValue

หลัง backend ขึ้นแล้ว คัดลอก URL จริงกลับไปตั้ง **VITE_API_URL** ของ frontend จากนั้น deploy/rebuild frontend อีกครั้ง

## ตรวจหลังขึ้นออนไลน์

ต้องเปิดเว็บจาก URL จริง ทดสอบสมัคร/ล็อกอิน ลงประกาศและรูป การเช่าจนครบ สลิป รีวิว แชต ข้อพิพาท KYC และแอดมินอีกครั้ง ทดสอบ restart backend แล้วเปิดไฟล์เดิม และทดสอบว่าบัญชีอื่นเปิดเอกสารส่วนตัวไม่ได้ ต้องทำรอบนี้ก่อนถือว่า deploy สำเร็จ การทดสอบ local ใช้ Storage REST จำลอง จึงยังไม่ยืนยัน credentials/เครือข่าย/สิทธิ์บนบัญชีจริง

บัญชี admin แรก: สมัครบัญชีผ่านเว็บก่อน แล้วให้ผู้ดูแลเครื่องรัน `npm run admin:grant -- EMAIL` โดยตั้ง DATABASE_URL ไปที่ฐานข้อมูล production ผ่าน environment อย่างปลอดภัย ไม่เพิ่ม endpoint ยกระดับสิทธิ์หรือรหัสผ่าน admin เริ่มต้น

เริ่มฐานข้อมูลใหม่โดยไม่มี QA accounts/ธุรกรรมเดิม ไม่อัปโหลด backend/uploads ทั้งโฟลเดอร์จากเครื่องพัฒนาไป production เพราะมีไฟล์ทดสอบ หากต้องย้ายข้อมูลจริงต้องเลือกชุดข้อมูลและสำรองก่อน

## การเก็บไฟล์และสำรอง

ทุกไฟล์อยู่ใน private bucket แยกเป็น items/reviews/rentals/payments/disputes/verifications โดยยังใช้ URL เดิม รูปสินค้า/รีวิวถูกอ่านผ่านเส้นทางสาธารณะเดิม เอกสารส่วนตัวต้องผ่าน API และการตรวจสิทธิ์เดิมก่อน Backend ไม่ส่ง service_role key หรือ signed URL ถาวรออกไป frontend

ก่อนตอบว่าอัปโหลดสำเร็จจะบันทึกไฟล์บน Storage ให้เสร็จ หาก Storage ล่มจะตอบ error ไม่ยืนยันสำเร็จโดยอาศัยไฟล์ชั่วคราว เมื่อ request จบจะลบไฟล์พักใน Render และชดเชยไฟล์บน Storage กรณี request ล้มเหลวที่ทราบผล ส่วนการเชื่อมต่อที่ถูกตัดระหว่างบันทึกอาจเหลือ orphan file จึงต้องตรวจ quota เป็นระยะ

`npm run backup -- PATH` ใน cloud mode จะสำรอง public schema ของแอปพร้อมดาวน์โหลดไฟล์จาก bucket ทั้งหกโฟลเดอร์ ไม่สำรองไฟล์พักใน Render หยุดการเขียนทุก instance ก่อนทำจากเครื่องผู้ดูแลที่มี pg_dump/credentials เก็บสำเนาให้ปลอดภัย การกู้คืนต้องคืนทั้งข้อมูลและไฟล์ใน bucket คู่กัน ไม่ใช้คู่มือ copy กลับเข้า Render/tmp เพื่อแทน permanent storage

## ข้อจำกัดแผนฟรี

Render backend พักหลังไม่มีคำขอ 15 นาที คนแรกต้องรอเปิดบริการ Supabase Free มีโควตาฐานข้อมูล/ไฟล์และอาจพักเมื่อไม่ได้ใช้งาน ตรวจโควตาปัจจุบันใน Dashboard อย่าใช้การ ping หลอกเพื่อเลี่ยงข้อจำกัด และยังไม่มีการรับประกัน uptime สำหรับผู้ใช้จริงจำนวนมาก: [Render Free](https://render.com/docs/free), [Supabase Free](https://supabase.com/pricing)
