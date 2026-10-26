# คู่มือเตรียม deploy

เตรียมเมื่อ 27 ตุลาคม 2026 โดยคง React/Vite + Express + PostgreSQL เดิมไว้ ยังไม่มีการเผยแพร่ขึ้นออนไลน์

## รูปแบบที่เตรียมไว้

ใช้ Express ให้บริการทั้งเว็บที่ build แล้วและ `/api` ใต้โดเมนเดียวกันเป็นค่าเริ่มต้น ไม่ต้องพึ่ง Vite dev proxy ในระบบจริง รูปสาธารณะอยู่ `/uploads/items` และ `/uploads/reviews` ส่วนสลิป รูปตรวจสภาพ หลักฐานข้อพิพาท และเอกสารยืนยันตัวตนต้องผ่าน API ตรวจสิทธิ์เหมือนเดิม

ทดสอบบน Node.js 24 และ PostgreSQL 18.1 ชุดติดตั้งอยู่ `db/bootstrap.sql` มีเฉพาะโครงสร้างปัจจุบันและหมวดหมู่ 13 หมวด ไม่มีบัญชี รหัสผ่าน เอกสาร หรือธุรกรรมจริง ไม่ใช้ `schema.sql` เก่าติดตั้งระบบใหม่

## เตรียมไฟล์รันจริง

ในโฟลเดอร์ frontend:

```powershell
npm ci
npm test
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

ในโฟลเดอร์ backend:

```powershell
npm ci --omit=dev
npm run prepare:release -- D:\Pjeasy_to_locate\dist
```

เปลี่ยนเส้นทาง `dist` ให้ตรงเครื่อง build คำสั่งนี้สร้าง/แทนที่เฉพาะ `backend/public-app` ซึ่งเป็นผล build ไม่ลบ source, `.env` หรือ uploads

ไฟล์ที่ต้องใช้ฝั่ง backend คือ `server.js`, `config.js`, `db.js`, `middleware/`, `routes/`, `scripts/`, `db/`, `package.json`, `package-lock.json` และ `public-app/` ติดตั้ง dependencies ด้วย lockfile บนเครื่องปลายทาง ไม่ส่ง `.env` ใน repository หรือไฟล์เว็บ ไม่ส่ง `.audit*`, `.deploy-test`, `.backups`, ข้อมูลทดสอบ หรือ `node_modules` จากเครื่องพัฒนา

## ค่าบนเครื่องปลายทาง

ใช้ `.env.example` เป็นรายการอ้างอิง และกำหนดผ่าน environment ของเครื่องปลายทางหรือ `.env` ฝั่ง backend เท่านั้น:

- `NODE_ENV=production`
- `DATABASE_URL` ชี้ PostgreSQL ของระบบจริง ใช้บัญชีสำหรับแอป ตั้ง TLS ตามผู้ให้บริการ; `DB_SSL=true` เปิดการตรวจใบรับรอง และ `DB_SSL_CA_FILE` สำหรับ CA เฉพาะผู้ให้บริการ
- `JWT_SECRET` สุ่มใหม่อย่างน้อย 32 ตัวอักษร เก็บค่าเดิมไว้ระหว่างการเปลี่ยน release เพื่อไม่ให้ session ผู้ใช้หลุด ห้ามใช้ค่า example
- `FRONTEND_URL` เป็น origin HTTPS จริง ไม่มี path เช่น `https://rent.example.com`; หลาย origin แยกด้วย comma โดยระบุเฉพาะที่ใช้
- `UPLOAD_DIR` เป็น absolute path บน persistent disk/volume นอกโฟลเดอร์ release เช่น Linux `/var/lib/easytolocate/uploads` หรือ Windows `D:\EasyToLocateData\uploads` ต้องอ่าน/เขียนได้และเก็บข้าม restart/redeploy
- `SERVE_FRONTEND=true` และค่าเริ่มต้น `FRONTEND_DIST_DIR=backend/public-app` (ไม่ต้องกำหนดถ้าใช้ตำแหน่งนี้)
- `PORT` ตามเครื่องปลายทาง; `HOST=127.0.0.1` เมื่อ reverse proxy อยู่เครื่องเดียวกัน หรือ `0.0.0.0` ตามเครือข่าย container
- `TRUST_PROXY=0` เป็นค่าเริ่มต้น เปลี่ยนเป็น `1` เฉพาะกรณีมี reverse proxy ที่เชื่อถือได้หนึ่งชั้น และเข้าถึงแอปผ่าน proxy นั้นเท่านั้น

ระบบจะไม่เริ่มใน production ถ้าค่าสำคัญไม่ครบ secret อ่อนเกินไป หรือไฟล์เว็บหาย ตัวอย่างสร้าง secret บนเครื่องผู้ดูแล: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` เก็บผลไว้ในที่จัดการ secret

ถ้าจะแยก frontend กับ backend ต่างโดเมน: ตั้ง `VITE_API_URL=https://api.example.com` ก่อน build frontend, ตั้ง `SERVE_FRONTEND=false` ฝั่ง backend และ `FRONTEND_URL` ให้ตรงเว็บจริง พร้อมกำหนด SPA fallback บน frontend host ห้ามใส่ database URL หรือ secret ในตัวแปร Vite ทั้งนี้ค่า localhost จาก `.env` พัฒนาจะไม่ถูกฝังใน production build และจะใช้โดเมนเดียวกันแทน

## ติดตั้งฐานข้อมูลและไฟล์

สำหรับ **ฐานข้อมูลใหม่ที่ว่างเท่านั้น**:

```powershell
npm run db:init
npm run db:check
```

`db:init` จะปฏิเสธถ้ามีตารางอยู่แล้ว โดยไม่แก้ข้อมูลเดิม สำหรับฐานข้อมูลที่ใช้อยู่ให้ใช้ `db:check` แบบอ่านอย่างเดียว; หากไม่ผ่านต้องตรวจความต่างก่อน ห้ามทับด้วย bootstrap หรือ schema เก่า บัญชีใช้ติดตั้งต้องมีสิทธิ์สร้างตาราง/sequence ภายหลังใช้บัญชี runtime ที่มีสิทธิ์เฉพาะแอปได้

ถ้าต้องย้ายข้อมูลเดิมจริง ให้หยุดการเขียนข้อมูล สำรองฐานข้อมูลและ uploads เป็นคู่ แล้วกู้ทั้งสองชุด ไม่ย้ายบัญชี `qa.*@example.invalid` และข้อมูลทดสอบไปปนในระบบจริงโดยไม่มีแผนคัดแยก

เมื่อเปลี่ยนจาก `backend/uploads` เป็น `UPLOAD_DIR` ให้หยุดแอปก่อน **คัดลอก** ทุกโฟลเดอร์ย่อย items/reviews/rentals/payments/disputes/verifications ไปที่ปลายทาง โดยเก็บต้นฉบับไว้ ชื่อไฟล์และ URL ในฐานข้อมูลไม่ต้องแก้ ห้ามตั้ง static web server ให้เปิด uploads ทั้งโฟลเดอร์ เพราะมีเอกสารส่วนตัว

ฐานข้อมูลใหม่ไม่มีบัญชี admin เริ่มต้น: สมัครบัญชีผู้ดูแลตามปกติ แล้วให้ผู้ดูแลเครื่องที่เข้าถึงฐานข้อมูลได้รัน:

```powershell
npm run admin:grant -- existing-admin@your-domain.com
```

คำสั่งให้สิทธิ์เฉพาะบัญชีที่สมัครไว้ตรงอีเมลนั้น ไม่มีรหัสผ่านเริ่มต้นหรือ API สำหรับยกระดับสิทธิ์

## เปิดบริการในวัน deploy จริง

```powershell
npm start
```

ใช้ process manager/service ของเครื่องปลายทางให้ restart เมื่อ process ล้มและเริ่มเมื่อเครื่องเปิด ตั้ง reverse proxy/hosting ให้ HTTPS และส่งทั้งเว็บ `/api` และ `/uploads` มาที่ Express เดียวกัน รองรับ request body อย่างน้อย 30 MB สำหรับภาพสูงสุด 5 ภาพ ภาพละ 5 MB; เส้นทางอัปโหลดต้องมี timeout เพียงพอ

ตั้ง health check ที่ `/api/health`: 200 เมื่อเชื่อมฐานข้อมูลและเข้าถึงพื้นที่ uploads ได้ หรือ 503 หากไม่พร้อม ไม่แสดง connection string กำหนดให้ app port เข้าถึงได้เฉพาะเครือข่ายที่ต้องใช้ และทดสอบ HTTPS บนโดเมนจริงภายหลัง ระบบรองรับ SIGTERM/SIGINT เพื่อปิด HTTP และ database pool ก่อนออก

หลังเปิดจริงตรวจ login, เปิดหน้าจากลิงก์ตรง, ลงประกาศ/รูปภาพ, เช่าจนครบ, และอ่านไฟล์ส่วนตัวด้วยบัญชีที่มี/ไม่มีสิทธิ์ การทดสอบในเครื่องยังไม่ยืนยัน DNS, certificate, proxy หรือ persistent disk ของผู้ให้บริการที่ยังไม่ได้เลือก

## สำรองและกู้คืน

เตรียม PostgreSQL `pg_dump`/`pg_restore` รุ่นที่รองรับ server (เครื่องนี้ใช้ 18.1) ให้เรียกได้ หรือกำหนด `PG_BIN_DIR` เช่น `C:\Program Files\PostgreSQL\18\bin`

หยุดแอป/หยุดการเขียนทุก instance ก่อน backup เพื่อให้ฐานข้อมูลและไฟล์อยู่ ณ เวลาเดียวกัน แล้วใน backend รัน:

```powershell
npm run backup -- D:\EasyToLocateBackups
```

จะสร้างโฟลเดอร์เวลาที่รันพร้อม `database.dump` และ `uploads/` ไม่มีการลบต้นฉบับ อย่าเก็บ backup ใน UPLOAD_DIR ตั้งสิทธิ์เข้าถึงเฉพาะผู้ดูแลและเก็บสำเนาอีกสถานที่หนึ่งตามรอบที่กำหนด คำสั่งไม่สำรอง `.env` จึงต้องเก็บ secret ไว้ในระบบจัดการ secret แยกต่างหาก

กู้คืนโดยหยุดแอป สร้างฐานข้อมูลปลายทางใหม่ที่ว่าง (ไม่รัน db:init ก่อน restore) ตั้งตัวแปร PostgreSQL `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` และ TLS ให้ตรงปลายทาง แล้วรัน `pg_restore --dbname DB_NAME --no-owner --no-privileges --exit-on-error PATH_TO_DATABASE_DUMP` ไม่ใส่รหัสผ่านในคำสั่ง จากนั้นคัดลอก `uploads/` ของ backup ไปยัง persistent directory ใหม่ ตั้ง DATABASE_URL/UPLOAD_DIR ให้ชี้คู่ที่กู้คืน รัน db:check และเปิดตรวจทั้งรายการเช่าและไฟล์ก่อนเปลี่ยนรับผู้ใช้ เก็บฐานข้อมูล/ไฟล์ต้นฉบับไว้จนตรวจเสร็จ

## ทดสอบซ้ำก่อน release

```powershell
npm test
npm run test:deploy
```

`test:deploy` ต้องมี frontend ที่ prepare แล้ว, PostgreSQL และ pg_dump/pg_restore พร้อมใช้งาน คำสั่งเปิด production API เฉพาะ `127.0.0.1:5101` สร้าง schema `qa_deploy_<เวลา>` ใหม่โดยไม่ใช้ public เป็น fallback ใช้ข้อมูลสังเคราะห์ ทดสอบระบบเดิม 283 checks, routing/CORS, restart, ไฟล์ส่วนตัว และ backup/restore แล้วลบเฉพาะ schema ที่สร้าง โฟลเดอร์ `.deploy-test` และผล JSON เก็บไว้ตรวจสอบ ห้ามชี้เครื่องมือ regression เดี่ยวไปยังระบบ production เพราะสร้างข้อมูล QA

ผลทดสอบรอบนี้บันทึกใน `DEPLOY_READINESS_2026-10-27.md`
