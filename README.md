# Chess AI (เล่นหมากรุกกับ AI)

เว็บแอปพลิเคชันเล่นหมากรุกสากลกับ AI (Gemini) พัฒนาด้วย React, TypeScript, Tailwind CSS, chess.js และ react-chessboard

## 🚀 การ Deploy ขึ้น Vercel

1. อัปโหลดโปรเจกต์นี้ขึ้น **GitHub**
2. ไปที่ [Vercel](https://vercel.com) แล้วกด **Add New Project** -> เลือก Repository นี้จาก GitHub
3. ในส่วน **Environment Variables** ให้เพิ่มตัวแปรดังนี้:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** `ใส่ Gemini API Key ของคุณที่นี่` (รับคีย์ฟรีได้ที่ [Google AI Studio](https://aistudio.google.com/app/apikey))
   - *(ทางเลือก)* **Key:** `GEMINI_MODEL`
   - *(ทางเลือก)* **Value:** `gemini-3.1-flash-lite`
4. กดปุ่ม **Deploy** ระบบจะ Build และพร้อมใช้งานทันที!

---

## 🛠️ การรันในเครื่อง (Local Development)

1. ติดตั้ง Dependencies:
   ```bash
   npm install
   ```

2. สร้างไฟล์ `.env.local` หรือ `.env`:
   ```bash
   cp .env.example .env.local
   ```
   จากนั้นใส่ API Key:
   ```env
   GEMINI_API_KEY=ใส่_API_KEY_ของคุณที่นี่
   GEMINI_MODEL=gemini-3.1-flash-lite
   ```

3. รัน Development Server:
   ```bash
   npm run dev
   ```
   เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`
