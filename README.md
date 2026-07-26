# 🛡️ Discord Protection & Image Bot (بوت حماية وصور ديسكورد)

بوت ديسكورد احترافي مخصص للحماية التلقائية (تايم أوت للروابط والصور والملفات)، الرد التلقائي على منشن المالك، وميزات معالجة الصور والتأثيرات، ويعمل بالبادئة `!`.

---

## 📌 الميزات الرئيسية (Key Features)

1. **بادئة الأوامر (Prefix)**:
   - يعمل بـ `!` بدلاً من أزرار `/`.

2. **تعرف خاص بالمالك (Owner Recognition)**:
   - الآيدي المحدد للمالك: `1325477924035498034`.
   - عند قيام أي عضو بعمل منشن للمالك `<@1325477924035498034>`، يرد البوت تلقائياً بالـ GIF:
     `https://i.pinimg.com/originals/f2/eb/01/f2eb01e229d23e6d98785859de3d9b94.gif`
   - المالك مستثنى تماماً من التايم أوت وأنظمة الحماية.

3. **نظام الحماية التلقائي (7may System)**:
   - **حماية الروابط (Anti-Link)**: إعطاء تايم أوت (5 دقائق) ومسح الرسالة التي تحتوي على روابط.
   - **حماية الصور (Anti-Image)**: إعطاء تايم أوت (5 دقائق) ومسح الرسالة عند إرسال صور.
   - **حماية الملفات (Anti-File)**: إعطاء تايم أوت (5 دقائق) ومسح الرسالة عند إرسال ملفات مرفقة.
   - التحكم في التشغيل/الإيقاف بسهولة:
     - `!antilink <on/off>`
     - `!antiimage <on/off>`
     - `!antifile <on/off>`
     - `!protection` (لعرض الحالة)

4. **ميزات الصور والتأثيرات (Image Features)**:
   - `!avatar [@user]` - عرض وتنزيل افتار الحساب بوضوح عالي.
   - `!banner [@user]` - عرض وتنزيل بنر البروفايل.
   - `!wanted [@user]` - إنشاء بوستر "مطلوب" رسمياً باسم وافتار العضو.
   - `!blur [@user]` - تغبيش وتعتيم افتار العضو.
   - `!invert [@user]` - عكس ألوان افتار العضو.
   - `!greyscale [@user]` - تحويل ألوان افتار العضو لأبيض وأسود.

5. **أوامر الإدارة (Moderation Commands)**:
   - `!timeout <@user> <minutes> [reason]` - تايم أوت يدوي.
   - `!untimeout <@user>` - فك التايم أوت.
   - `!kick <@user> [reason]` - طرد عضو.
   - `!ban <@user> [reason]` - حظر عضو.
   - `!clear <number>` - مسح حتى 100 رسالة.
   - `!help` - قائمة المساعدة المنسقة.

---

## 🚀 طريقة التشغيل (How to Run)

### 1. تثبيت الحزم (Install Dependencies)
افتح موجه الأوامر (Command Prompt / PowerShell) في مجلد `D:\bot` واكتب:
```bash
npm install
```

### 2. إعداد توكن البوت (Configure Bot Token)
قم بفتح ملف `.env` وضِع التوكن الخاص ببوتك:
```env
DISCORD_TOKEN=ضع_التوكن_الخاص_ببوشك_هنا
OWNER_ID=1325477924035498034
PREFIX=!
GIF_URL=https://i.pinimg.com/originals/f2/eb/01/f2eb01e229d23e6d98785859de3d9b94.gif
DEFAULT_TIMEOUT_MINUTES=5
```

### 3. تفعيل الـ Intents من موقع Discord Developer
من حاسوبك، اذهب إلى [Discord Developer Portal](https://discord.com/developers/applications):
- اختر البوت الخاص بك -> اذهب إلى قسم **Bot**.
- قم بتفعيل الخيارات التالية وتحويلها إلى **ON**:
  - `PRESENCE INTENT`
  - `SERVER MEMBERS INTENT`
  - `MESSAGE CONTENT INTENT` *(مهم جداً لعمل البادئة ! وقراءة الرسائل)*

### 4. تشغيل البوت (Start Bot)
```bash
npm start
```
أو
```bash
node index.js
```

---
تم إنشاء هذا البوت بواسطة Antigravity AI.
