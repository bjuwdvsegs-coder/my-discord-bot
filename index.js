require('dotenv').config();
const https = require('https');
const http = require('http');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  PermissionsBitField, 
  AttachmentBuilder,
  ActivityType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const yts = require('yt-search');

// ══════════════════════════════════════════
// ── ffmpeg path ──
// ══════════════════════════════════════════
const FFMPEG_PATH = (() => {
  try { return require('ffmpeg-static'); } catch(e) { return 'ffmpeg'; }
})();
console.log('🎬 FFMPEG Path:', FFMPEG_PATH);

// ══════════════════════════════════════════
// ── yt-dlp binary resolution & auto-downloader ──
// ══════════════════════════════════════════
const YTDLP_BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
let YTDLP_PATH = null;

async function ensureYtDlp() {
  if (YTDLP_PATH && fs.existsSync(YTDLP_PATH)) return YTDLP_PATH;

  const localPath = path.join(__dirname, YTDLP_BINARY_NAME);
  if (fs.existsSync(localPath)) {
    YTDLP_PATH = localPath;
    console.log('✅ yt-dlp binary located at:', YTDLP_PATH);
    return YTDLP_PATH;
  }

  const systemPaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.cwd(), YTDLP_BINARY_NAME)
  ];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) {
      YTDLP_PATH = p;
      console.log('✅ yt-dlp found in system:', YTDLP_PATH);
      return YTDLP_PATH;
    }
  }

  try {
    console.log(`📦 Auto-downloading yt-dlp for ${process.platform}...`);
    const YTDlpWrap = require('yt-dlp-wrap').default;
    await YTDlpWrap.downloadFromGithub(localPath);
    if (process.platform !== 'win32') {
      try { fs.chmodSync(localPath, 0o755); } catch(e) {}
    }
    YTDLP_PATH = localPath;
    console.log('✅ yt-dlp downloaded successfully:', YTDLP_PATH);
    return YTDLP_PATH;
  } catch (err) {
    console.log('⚠️ yt-dlp download failed, falling back to system PATH:', err.message);
    YTDLP_PATH = 'yt-dlp';
    return YTDLP_PATH;
  }
}

// ══════════════════════════════════════════
// ── Audio Stream via yt-dlp + FFmpeg (OggOpus Output) ──
// Direct Opus encoding guarantees loud & clear Discord voice audio
// ══════════════════════════════════════════
function createYtDlpStream(youtubeUrl, binaryPath) {
  const ytdlpArgs = [
    '--no-playlist',
    '-q',
    '--no-warnings',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    '--extractor-args', 'youtube:player_client=android,web',
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '-o', '-',
    youtubeUrl
  ];

  if (FFMPEG_PATH && FFMPEG_PATH !== 'ffmpeg') {
    ytdlpArgs.unshift('--ffmpeg-location', path.dirname(FFMPEG_PATH));
  }

  const ytdlpProc = spawn(binaryPath, ytdlpArgs);

  // Encode directly to OggOpus for Discord Native Voice playback
  const ffmpegArgs = [
    '-i', 'pipe:0',
    '-analyzeduration', '0',
    '-loglevel', 'quiet',
    '-acodec', 'libopus',
    '-f', 'opus',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '128k',
    'pipe:1'
  ];

  const ffmpegProc = spawn(FFMPEG_PATH, ffmpegArgs);

  ytdlpProc.stdout.pipe(ffmpegProc.stdin);

  ytdlpProc.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.log('[yt-dlp log]', msg);
  });
  ffmpegProc.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.log('[ffmpeg log]', msg);
  });

  ytdlpProc.on('error', e => console.log('[yt-dlp spawn error]', e.message));
  ffmpegProc.on('error', e => console.log('[ffmpeg spawn error]', e.message));

  ytdlpProc.on('close', code => {
    if (code !== 0 && code !== null) console.log('[yt-dlp] process exited code:', code);
    try { ffmpegProc.stdin.end(); } catch(e) {}
  });

  return { ytdlpProc, ffmpegProc, audioStream: ffmpegProc.stdout };
}

// ══════════════════════════════════════════
// ── Pure Node HTTP Fallback Downloader (Cobalt API) ──
// ══════════════════════════════════════════
function downloadViaCobalt(mediaUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ url: mediaUrl });
    const req = https.request('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const downloadUrl = json.url;
          if (!downloadUrl) return reject(new Error('Cobalt returned no URL'));

          const fileStream = fs.createWriteStream(outputPath);
          const dlProtocol = downloadUrl.startsWith('https') ? https : http;
          
          const dlReq = dlProtocol.get(downloadUrl, (dlRes) => {
            if (dlRes.statusCode >= 300 && dlRes.statusCode < 400 && dlRes.headers.location) {
              const redirectUrl = dlRes.headers.location;
              const redProtocol = redirectUrl.startsWith('https') ? https : http;
              redProtocol.get(redirectUrl, (redRes) => {
                redRes.pipe(fileStream);
                fileStream.on('finish', () => { fileStream.close(); resolve(); });
              }).on('error', reject);
            } else {
              dlRes.pipe(fileStream);
              fileStream.on('finish', () => { fileStream.close(); resolve(); });
            }
          });
          dlReq.on('error', reject);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Cobalt timeout')); });
    req.write(postData);
    req.end();
  });
}

// ══════════════════════════════════════════
// ── Robust Media Downloader ──
// ══════════════════════════════════════════
async function downloadVideo(url, outputPath) {
  try {
    const binaryPath = await ensureYtDlp();
    await new Promise((resolve, reject) => {
      const args = [
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '-q',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '-o', outputPath,
        url
      ];
      if (FFMPEG_PATH && FFMPEG_PATH !== 'ffmpeg') {
        args.unshift('--ffmpeg-location', path.dirname(FFMPEG_PATH));
      }
      const proc = spawn(binaryPath, args);
      let errOut = '';
      proc.stderr.on('data', d => { errOut += d.toString(); });
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) resolve();
        else reject(new Error(errOut.slice(0, 300) || `yt-dlp exited with code ${code}`));
      });
      proc.on('error', e => reject(e));
    });
    return;
  } catch (ytdlpErr) {
    console.log('⚠️ yt-dlp download failed, trying Cobalt API:', ytdlpErr.message);
    try {
      await downloadViaCobalt(url, outputPath);
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
    } catch (cobaltErr) {
      console.log('⚠️ Cobalt API fallback failed:', cobaltErr.message);
    }
    throw ytdlpErr;
  }
}

// Helper to generate direct download page link (YouTubePP / Y2Mate)
function getDirectDownloadLink(ytUrl) {
  if (!ytUrl) return 'https://y2mate.com';
  if (ytUrl.includes('youtube.com/watch?v=')) {
    return ytUrl.replace('youtube.com/watch?v=', 'youtubepp.com/watch?v=');
  }
  if (ytUrl.includes('youtu.be/')) {
    return ytUrl.replace('youtu.be/', 'youtubepp.com/watch?v=');
  }
  return ytUrl;
}

// ══════════════════════════════════════════
// ── Optional Spotify & Voice packages ──
// ══════════════════════════════════════════
let voicePkg, spotifyUrlInfo;
try {
  voicePkg = require('@discordjs/voice');
  spotifyUrlInfo = require('spotify-url-info')(fetch);
} catch (e) { console.log('Optional package load note:', e.message); }

let createCanvas, loadImage;
try { const c = require('@napi-rs/canvas'); createCanvas = c.createCanvas; loadImage = c.loadImage; } catch (e) {}

// ══════════════════════════════════════════
// ── Discord Client ──
// ══════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const startTime = Date.now();
const voiceData = new Map();

// ── Emojis ──
const EMOJIS = {
  REM_DANCE: '<a:remdance:1517201707593896097>',
  SUCCESS: '<:success:1517201800262848613>',
  ANIME_SCREAM: '<a:anime:1515763732016402592>',
  PIKA_L_HEART: '<:pika_left_heart:1521313096541409320>',
  PIKA_R_HEART: '<:pika_right_heart:1521313099213439088>',
  PINK_BUTTERFLY: '<a:pink:1521314314353643621>',
  PINK_VERIFIED: '<a:pinkverified:1521314318136774746>',
  SHARK_HUG: '<:sharkhug:1517201755899826387>',
  PIKA_CHEEKS: '<a:rubbingcheekspik:1517201731522658314>',
  WOLF_RED: '<a:wolfsred:1521313047463989299>',
  TOHRU_SMUG: '<:tohrusmug:1517201834874241055>',
  PARTNER_HANDSHAKE: '<:wolfspartner:1521313043412422677>',
  ANIMATED_SHOCKED: '<a:animado16:1515763720498708631>',
  ANGEL_DEVIL: '<a:angeldevil:1515763714496663725>',
  BLUSHING_BOY: '<a:blushingboy:1515763790568755330>',
  CHIKA: '<a:chikaaaah:1515763824622440600>',
  SHINOBU_GUN: '<:shinobugun:1517201761058689054>',
  STAFF_DISCORD: '<:staffdiscord:1521314324189024326>'
};

const OWNER_ID = process.env.OWNER_ID || "1325477924035498034";
const PREFIX = process.env.PREFIX || "!";
const GIF_URL = process.env.GIF_URL || "https://i.pinimg.com/originals/f2/eb/01/f2eb01e229d23e6d98785859de3d9b94.gif";
const DEFAULT_TIMEOUT_MIN = parseInt(process.env.DEFAULT_TIMEOUT_MINUTES || "5");
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "25");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ── AI Chat via Google Gemini ──
async function askGemini(question) {
  const apiKey = process.env.GEMINI_API_KEY || Buffer.from('QVEuQWI4Uk42S1Q0MEFHYUQzWU44X0c5bmFJM0s2X09UWFN3Ry0xczMwS3kzM2lqcjZlNWc=', 'base64').toString();

  const callGeminiModel = (modelName) => {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: `أنت مساعد ذكي ومفيد اسمك Rilina. أجب باللغة العربية أو الإنجليزية حسب السؤال بشكل واضح ومختصر.\n\nالسؤال: ${question}` }] }]
      });
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return resolve(text);
            reject(json?.error || new Error(data.slice(0, 200)));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  };

  try {
    return await callGeminiModel('gemini-2.0-flash');
  } catch (err1) {
    try {
      return await callGeminiModel('gemini-1.5-flash');
    } catch (err2) {
      console.log('⚠️ Gemini API error:', err2.message || err2);
      return (
        `⚠️ **الذكاء الاصطناعي يتطلب مفتاح API معتمد!**\n\n` +
        `> 💡 **المفتاح الحالي ينتهي بـ Quota أو غير صالح.**\n\n` +
        `**خطوات التفعيل في 30 ثانية (مكفول ومجاني 100%):**\n` +
        `1️⃣ افتح الرابط المجاني: **https://aistudio.google.com/apikey**\n` +
        `2️⃣ اضغط **Create API Key** وانسخ المفتاح (يبدأ بـ \`AIzaSy...\`)\n` +
        `3️⃣ اذهب إلى **Railway.app** ➔ **Variables** ➔ أضف: \`GEMINI_API_KEY\` = المفتاح الجديد`
      );
    }
  }
}

// ── Send DM error alert to owner ──
async function notifyOwnerError(errorMsg, source = 'Bot Error') {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    if (!owner) return;
    await owner.send({ embeds: [
      new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('⚠️ تنبيه خطأ في البوت | Bot Error Alert')
        .setDescription(`**المصدر:** \`${source}\`\n\n\`\`\`\n${String(errorMsg).slice(0, 1800)}\n\`\`\``)
        .setTimestamp()
        .setFooter({ text: 'Rilina Suite — Error Monitor 🔴' })
    ]});
  } catch(e) { console.error('Could not DM owner error:', e.message); }
}

// ── EXPANDED ANIME GIF ENGINE ──
const ANIME_GIF_FALLBACKS = {
  hug:       ['https://cdn.otakugifs.xyz/gifs/hug/df0840a507aa481a.gif','https://cdn.otakugifs.xyz/gifs/hug/6d915e537c818fa9.gif','https://i.giphy.com/media/l2QDM9Jnim1YV55YA/giphy.gif'],
  kiss:      ['https://cdn.otakugifs.xyz/gifs/kiss/e8620e4b5d4907df.gif','https://i.giphy.com/media/G3va31oEEnIkM/giphy.gif'],
  pat:       ['https://cdn.otakugifs.xyz/gifs/pat/13ec930fd42770f6.gif','https://i.giphy.com/media/5tmRHw4oHw8CH0qxYi/giphy.gif'],
  slap:      ['https://cdn.otakugifs.xyz/gifs/slap/728770007827600b.gif','https://i.giphy.com/media/Gf3AUz3eBNbTW/giphy.gif'],
  cuddle:    ['https://cdn.otakugifs.xyz/gifs/cuddle/7dca23f6128a1897.gif'],
  dance:     ['https://cdn.otakugifs.xyz/gifs/dance/0fd2b6003eb5dad1.gif','https://i.giphy.com/media/13l7L7N4tVY5wA/giphy.gif'],
  cry:       ['https://cdn.otakugifs.xyz/gifs/cry/c97b378c7184ea59.gif'],
  blush:     ['https://cdn.otakugifs.xyz/gifs/blush/rh8KXQBMWBka.gif'],
  happy:     ['https://cdn.otakugifs.xyz/gifs/happy/vhplowmpdJ.gif'],
  wave:      ['https://cdn.otakugifs.xyz/gifs/wave/d8a72db89663ed79.gif'],
  poke:      ['https://cdn.otakugifs.xyz/gifs/poke/08002e2d348de3f5.gif'],
  punch:     ['https://cdn.otakugifs.xyz/gifs/punch/a68e34a1994c91f7.gif'],
  bite:      ['https://cdn.otakugifs.xyz/gifs/bite/1c10d5980ba1830b.gif'],
  wink:      ['https://cdn.otakugifs.xyz/gifs/wink/1c383c21519a03f2.gif'],
  smug:      ['https://cdn.otakugifs.xyz/gifs/smug/65b7d98434dd9b51.gif'],
  shrug:     ['https://cdn.otakugifs.xyz/gifs/shrug/9647cbc5d03a7b8b.gif'],
  sleep:     ['https://cdn.otakugifs.xyz/gifs/sleep/93653e80a930251f.gif'],
  facepalm:  ['https://cdn.otakugifs.xyz/gifs/facepalm/de2fe17a75556e04.gif'],
  thumbsup:  ['https://cdn.otakugifs.xyz/gifs/thumbsup/86c02b24f136e08f.gif'],
  kill:      ['https://cdn.otakugifs.xyz/gifs/slap/728770007827600b.gif'],
  shoot:     ['https://cdn.otakugifs.xyz/gifs/poke/08002e2d348de3f5.gif'],
  lick:      ['https://cdn.otakugifs.xyz/gifs/kiss/e8620e4b5d4907df.gif'],
  bonk:      ['https://cdn.otakugifs.xyz/gifs/slap/728770007827600b.gif'],
  nom:       ['https://cdn.otakugifs.xyz/gifs/bite/1c10d5980ba1830b.gif'],
  peek:      ['https://cdn.otakugifs.xyz/gifs/blush/rh8KXQBMWBka.gif'],
  highfive:  ['https://cdn.otakugifs.xyz/gifs/thumbsup/86c02b24f136e08f.gif'],
  feed:      ['https://cdn.otakugifs.xyz/gifs/pat/13ec930fd42770f6.gif'],
  waifu:     ['https://cdn.otakugifs.xyz/gifs/wave/d8a72db89663ed79.gif'],
  neko:      ['https://cdn.otakugifs.xyz/gifs/blush/rh8KXQBMWBka.gif'],
};

function fetchAnimeGif(type) {
  return new Promise((resolve) => {
    const useFallback = () => {
      const list = ANIME_GIF_FALLBACKS[type] || ANIME_GIF_FALLBACKS.hug;
      resolve(list[Math.floor(Math.random() * list.length)]);
    };
    const req = https.get(`https://api.otakugifs.xyz/gif?reaction=${type}`, {
      timeout: 4000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot)' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { const j = JSON.parse(d); if (j.url?.startsWith('http')) return resolve(j.url); } catch(e) {}
        useFallback();
      });
    });
    req.on('error', useFallback);
    req.on('timeout', () => { req.destroy(); useFallback(); });
  });
}

const guildSettings = new Map();
function getGuildConfig(guildId) {
  if (!guildSettings.has(guildId)) guildSettings.set(guildId, { antiLink: true, antiImage: true, antiFile: true, timeoutMinutes: DEFAULT_TIMEOUT_MIN });
  return guildSettings.get(guildId);
}
function getUptimeString() {
  const t = Math.floor((Date.now() - startTime) / 1000);
  return `${Math.floor(t/86400)}d ${Math.floor((t%86400)/3600)}h ${Math.floor((t%3600)/60)}m ${t%60}s`;
}

const LINK_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|io|me|li)\/[^\s]+)/gi;
const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;

// ══════════════════════════════════════════
// ── HELP EMBED ──
// ══════════════════════════════════════════
function createHelpEmbed(category, user, client) {
  const base = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setAuthor({ name: `${client.user.username} Suite ✨`, iconURL: client.user.displayAvatarURL() })
    .setFooter({ text: `طُلب بواسطة: ${user.tag} • المالك: ${OWNER_ID}`, iconURL: user.displayAvatarURL() })
    .setTimestamp();

  if (category === 'main') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} ${EMOJIS.REM_DANCE} لوحة التحكم الرئيسية | System Control`)
    .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} **مرحباً بك في البوت الشامل للحماية، التفاعل، الصوت والتحميل!**\n\n` +
      `> ⚡ **البادئة:** \`${PREFIX}\`\n> 👑 **المالك:** <@${OWNER_ID}>\n> 📺 **الحالة:** \`Stream & Voice 24/7\`\n\n` +
      `🌸 **اختر القسم المطلوب من القائمة المنسدلة أدناه:**`
    );

  if (category === 'protection') return base
    .setTitle(`${EMOJIS.SHINOBU_GUN} أنظمة الحماية والتايم أوت | Server Protection`)
    .setDescription(
      `### 🛡️ الأوامر الإدارية للحماية:\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antilink on/off\` ➔ حماية الروابط تلقائياً\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antiimage on/off\` ➔ حماية الصور والصور المتحركة\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antifile on/off\` ➔ حماية الملفات المرفقة\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}protection\` ➔ عرض لوحة حالة جميع أنظمة الحماية\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}settimeout <دقائق>\` ➔ تحديد مدة التايم أوت للمخالفين`
    );

  if (category === 'images') return base
    .setTitle(`${EMOJIS.SHARK_HUG} تأثيرات وصور البروفايل | Image Magic`)
    .setDescription(
      `### 🎨 أداة الصور والاستخراج:\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}avatar [@user]\` ➔ عرض وتنزيل افتار العضو بصيغة عالية\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}banner [@user]\` ➔ عرض وتنزيل بنر العضو\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}wanted [@user]\` ➔ تصميم ملصق مطلوب عالي الجودة`
    );

  if (category === 'anime') return base
    .setTitle(`✨ 𝑨𝒏𝒊𝒎𝒆 𝑺𝒖𝒊𝒕𝒆 — تفاعلات الأنمي 🌸`)
    .setDescription(
      `\`\`\`\n❀ Rilina Suite — Anime Interactions Panel ❀\n\`\`\`` +
      `\n` +
      `**╔══════ 💝 تفاعلات المحبة ══════╗**\n` +
      `> 🫂 \`${PREFIX}hug\` ➜ احتضان عضو بحرارة\n` +
      `> 💋 \`${PREFIX}kiss\` ➜ إرسال قبلة رومانسية\n` +
      `> 🥰 \`${PREFIX}cuddle\` ➜ الاحتضان المدلل\n` +
      `> 🌸 \`${PREFIX}pat\` ➜ دغدغة الرأس بحنان\n` +
      `> 😉 \`${PREFIX}wink\` ➜ غمزة دلع\n` +
      `**╚══════════════════════════╝**\n\n` +
      `**╔══════ 💢 ردود الأفعال القوية ══════╗**\n` +
      `> 👋 \`${PREFIX}slap\` ➜ صفعة بالأنمي ستايل\n` +
      `> 👊 \`${PREFIX}punch\` ➜ لكمة قوية جداً!\n` +
      `> 👉 \`${PREFIX}poke\` ➜ نكزة خفيفة\n` +
      `> 😬 \`${PREFIX}bite\` ➜ عض مؤلم!\n` +
      `> 🔨 \`${PREFIX}bonk\` ➜ بونك! اذهب للسجن 🚔\n` +
      `> 💀 \`${PREFIX}kill\` · \`${PREFIX}shoot\` ➜ نهاية درامية!\n` +
      `> 👅 \`${PREFIX}lick\` · \`${PREFIX}nom\` ➜ لحس / عض دلع\n` +
      `**╚══════════════════════════╝**\n\n` +
      `**╔══════ 🌙 التفاعلات الشخصية ══════╗**\n` +
      `> 💃 \`${PREFIX}dance\` ➜ اعرض رقصة أنمي مذهلة\n` +
      `> 😊 \`${PREFIX}happy\` ➜ فرحة قلبية لا توصف\n` +
      `> 😳 \`${PREFIX}blush\` ➜ احمرار الخدود من الحرج\n` +
      `> 😢 \`${PREFIX}cry\` ➜ دموع الأنمي الحزينة\n` +
      `> 😴 \`${PREFIX}sleep\` ➜ سكون ونعاس أنيمي\n` +
      `> 😏 \`${PREFIX}smug\` ➜ نظرة متعجرفة بامتياز\n` +
      `> 🤔 \`${PREFIX}think\` · \`${PREFIX}bored\` · \`${PREFIX}clap\`\n` +
      `> 🤦 \`${PREFIX}facepalm\` · \`${PREFIX}shrug\` · \`${PREFIX}thumbsup\`\n` +
      `**╚══════════════════════════╝**\n\n` +
      `**╔══════ 🖼️ صور الأنمي العشوائية ══════╗**\n` +
      `> 👗 \`${PREFIX}waifu\` ➜ صورة وايفو عشوائية\n` +
      `> 🐱 \`${PREFIX}neko\` ➜ فتاة نيكو أنيمي\n` +
      `**╚══════════════════════════╝**`
    )
    .setImage('https://media.giphy.com/media/l3q2zVr6cu95nF6O4/giphy.gif');

  if (category === 'music') return base
    .setTitle(`🎤 الروم الصوتي والموسيقى | Live Voice Channel`)
    .setDescription(
      `### 🎵 مشغل الصوت الفائق:\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}join\` ➔ الانضمام للروم الصوتي في السيرفر\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}play <اسم الأغنية / رابط YouTube / Spotify>\` ➔ البث الصوتي المباشر\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}stop\` / \`${PREFIX}leave\` ➔ إيقاف ومغادرة الروم الصوتي`
    );

  if (category === 'download') return base
    .setTitle(`📥 تحميل الفيديوهات والصوتيات | Direct Downloader`)
    .setDescription(
      `### ⏬ أداة التحميل المباشر:\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}download <رابط>\` أو \`${PREFIX}dl <رابط>\`\n\n` +
      `**📌 المنصات المدعومة بالكامل:**\n` +
      `> 🎬 **YouTube** — فيديوهات عادية، أغاني، و Shorts\n` +
      `> 📸 **Instagram** — ريلز (Reels)، بوستات، وستوري\n` +
      `> 🎵 **TikTok** — فيديوهات بدون علامة مائية\n` +
      `> 🐦 **Twitter / X** — مقاطع وتغريدات\n\n` +
      `💡 *الملفات الأصغر من ${MAX_UPLOAD_MB}MB يتم رفعها مباشرة في الشات!*`
    );

  if (category === 'bio') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} سيرة البروفايل | Profile Bio Card`)
    .setDescription(
      `### 🌸 بطاقات البروفايل:\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}bio [@user]\` ➔ عرض بطاقة السيرة الذاتية والرتب\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}botinfo\` ➔ سرعة ومعلومات البوت الرسمية`
    );

  if (category === 'moderation') return base
    .setTitle(`${EMOJIS.STAFF_DISCORD} الأوامر الإدارية | Moderation Suite`)
    .setDescription(
      `### 🔨 التحكم والإشراف:\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}timeout <@user> <دقائق> [سبب]\` ➔ إعطاء تايم أوت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}untimeout <@user>\` ➔ فك التايم أوت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kick <@user> [سبب]\` ➔ طرد عضو من السيرفر\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}ban <@user> [سبب]\` ➔ حظر عضو نهائياً\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}clear <1-100>\` ➔ مسح رسائل الشات`
    );

  if (category === 'owner') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} قسم المالك | Owner System`)
    .setDescription(`> 👑 **المالك الرسمية:** <@${OWNER_ID}>\n> ✨ حصانة كاملة واستجابة خاصة بالبطاقة والـ GIF عند المنشن.`);

  if (category === 'ai') return base
    .setTitle(`🤖 الذكاء الاصطناعي | Rilina AI — Gemini 2.0`)
    .setDescription(
      `\`\`\`\n❀ Rilina AI — مدعوم بـ Google Gemini 2.0 Flash ❀\n\`\`\`` +
      `\n**╔══════ 🧠 كيفية الاستخدام ══════╗**\n` +
      `> 💬 \`${PREFIX}ai <سؤالك>\` ➜ اسأل الذكاء الاصطناعي\n` +
      `> 🗣️ \`@Rilina <سؤالك>\` ➜ منشن البوت مباشرة\n` +
      `> 🌐 \`${PREFIX}ask <question>\` ➜ Ask in any language\n` +
      `**╚══════════════════════════╝**\n\n` +
      `**╔══════ ✨ أمثلة ══════╗**\n` +
      `> \`${PREFIX}ai ما هو الذكاء الاصطناعي؟\`\n` +
      `> \`${PREFIX}ai اكتب لي قصيدة عن الأنمي\`\n` +
      `> \`${PREFIX}ai explain quantum physics\`\n` +
      `> \`@Rilina كيف حالك؟\`\n` +
      `**╚══════════════════════════╝**\n\n` +
      `> 🌟 **النموذج:** Google Gemini 2.0 Flash\n` +
      `> ⚡ **السرعة:** ردود فورية\n` +
      `> 🌍 **اللغات:** عربي, English, وأكثر!`
    );

  return base;
}

// ══════════════════════════════════════════
// ── BOT READY ──
// ══════════════════════════════════════════
client.once('clientReady', async () => {
  console.log(`===========================================`);
  console.log(` 🤖 Bot Tag: ${client.user.tag}`);
  console.log(` 👑 Owner ID: ${OWNER_ID} | Prefix: ${PREFIX}`);
  console.log(`===========================================`);

  await ensureYtDlp();

  client.user.setPresence({
    activities: [{ name: `${PREFIX}help | AI Chat & Music 🎵`, type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' }],
    status: 'online'
  });
});

// ── Global Error Handlers → DM Owner ──
process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled Rejection:', reason);
  await notifyOwnerError(reason?.stack || reason, 'unhandledRejection');
});
process.on('uncaughtException', async (err) => {
  console.error('Uncaught Exception:', err);
  await notifyOwnerError(err?.stack || err.message, 'uncaughtException');
});

// ══════════════════════════════════════════
// ── WELCOME DM ON NEW MEMBER JOIN ──
// ══════════════════════════════════════════
client.on('guildMemberAdd', async (member) => {
  try {
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0xFF69B4)
      .setAuthor({ name: `${member.guild.name} 🌸`, iconURL: member.guild.iconURL({ dynamic: true }) })
      .setTitle(`✨ أهلاً وسهلاً بك ${member.user.username}! ✨`)
      .setDescription(
        `> 🎉 **مرحباً بك في سيرفر** **${member.guild.name}**!\n\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} نحن سعداء جداً بانضمامك إلينا 💖\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} اكتب \`${PREFIX}help\` لمعرفة جميع الأوامر\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} اكتب \`${PREFIX}ai <سؤالك>\` للتحدث مع الذكاء الاصطناعي\n\n` +
        `\`\`\`\n❀ Rilina Suite — يسعدنا تواجدك معنا ❀\n\`\`\``
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
      .setImage('https://media.giphy.com/media/l3q2zVr6cu95nF6O4/giphy.gif')
      .setFooter({ text: `${member.guild.name} • مرحباً بك في العائلة 💕` })
      .setTimestamp();

    await member.send({ embeds: [welcomeEmbed] });
    console.log(`✅ Welcome DM sent to ${member.user.tag}`);
  } catch (e) {
    console.log(`⚠️ Could not DM welcome to ${member.user.tag}:`, e.message);
  }
});

// ── Select Menu Interaction ──
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId === 'help_select_menu') {
    await interaction.update({ embeds: [createHelpEmbed(interaction.values[0], interaction.user, client)] });
  }
});

// ══════════════════════════════════════════
// ── MESSAGE LISTENER ──
// ══════════════════════════════════════════
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const config = getGuildConfig(message.guild.id);

  // Owner mention reply
  if (message.mentions.users.has(OWNER_ID) || message.content.includes(`<@${OWNER_ID}>`) || message.content.includes(`<@!${OWNER_ID}>`)) {
    try { await message.reply({ embeds: [new EmbedBuilder().setColor(0xFF69B4).setDescription(`${EMOJIS.PINK_VERIFIED} **تاج الرأس والمالك | Bot Owner:** <@${OWNER_ID}>`).setImage(GIF_URL)] }); } catch(e) {}
  }

  // ── AI Chat via Bot Mention ──
  const botMentioned = message.mentions.has(client.user) && !message.mentions.users.has(OWNER_ID);
  if (botMentioned) {
    const question = message.content.replace(/<@!?\d+>/g, '').trim();
    if (question.length > 0) {
      const typing = await message.channel.sendTyping().catch(() => {});
      const aiReply = await askGemini(question);
      const aiEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setAuthor({ name: `Rilina AI 🤖✨`, iconURL: client.user.displayAvatarURL() })
        .setDescription(aiReply.slice(0, 4000))
        .setFooter({ text: `سألك: ${message.author.username} • Gemini AI 🌟`, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();
      return message.reply({ embeds: [aiEmbed] });
    }
  }

  // Anti-spam & Protection logic
  if (!isOwner) {
    const hasAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!hasAdmin) {
      let isViolation = false, reason = "";
      if (config.antiLink && LINK_REGEX.test(message.content)) { isViolation = true; reason = "إرسال روابط (Anti-Link)"; }
      if (!isViolation && config.antiImage) {
        const hasImg = message.attachments.some(a => (a.contentType||"").startsWith('image/') || IMAGE_EXT_REGEX.test(a.name||""));
        if (hasImg || IMAGE_EXT_REGEX.test(message.content)) { isViolation = true; reason = "إرسال صور (Anti-Image)"; }
      }
      if (!isViolation && config.antiFile) {
        const hasFile = message.attachments.some(a => !(a.contentType||"").startsWith('image/'));
        if (hasFile) { isViolation = true; reason = "إرسال ملفات (Anti-File)"; }
      }
      if (isViolation) {
        try {
          if (message.deletable) await message.delete();
          if (message.member?.moderatable) await message.member.timeout(config.timeoutMinutes * 60 * 1000, `Protection: ${reason}`);
          const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xFF1493).setTitle(`${EMOJIS.SHINOBU_GUN} نظام الحماية التلقائية`).setDescription(`⚠️ **تايم أوت تلقائي!**\nالعضو: <@${message.author.id}>\nالمدة: ${config.timeoutMinutes} دقائق\nالسبب: ${reason}`)] });
          setTimeout(() => msg.delete().catch(() => {}), 8000);
          return;
        } catch(e) {}
      }
    }
  }

  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const getTargetMember = () => message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.member;
  const getTargetUser = () => message.mentions.users.first() || client.users.cache.get(args[0]) || message.author;
  const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator) || isOwner;

  // ── HELP ──
  if (['help', 'مساعدة', 'الأوامر'].includes(command)) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_select_menu')
      .setPlaceholder('🌸 اختر القائمة | Select Category...')
      .addOptions([
        { label: 'الرئيسية | Main', value: 'main', emoji: '🌸' },
        { label: 'الحماية | Protection', value: 'protection', emoji: '🛡️' },
        { label: 'تأثيرات الصور | Image Magic', value: 'images', emoji: '🎨' },
        { label: 'تفاعلات الأنمي | Anime Reactions', value: 'anime', emoji: '🎭' },
        { label: 'الروم الصوتي | Voice Channel', value: 'music', emoji: '🎤' },
        { label: '📥 تحميل الفيديوهات | Media Downloader', value: 'download', emoji: '📥' },
        { label: 'البروفايل | Profile Bio', value: 'bio', emoji: '🌸' },
        { label: 'الأوامر الإدارية | Moderation', value: 'moderation', emoji: '🔨' },
        { label: 'الذكاء الاصطناعي | AI Chat', value: 'ai', emoji: '🤖' },
        { label: 'معلومات المالك | Owner System', value: 'owner', emoji: '👑' }
      ]);
    return message.reply({ embeds: [createHelpEmbed('main', message.author, client)], components: [new ActionRowBuilder().addComponents(selectMenu)] });
  }

  // ══════════════════════════════════════════
  // ── 🛡️ PROTECTION CONTROL COMMANDS ──
  // ══════════════════════════════════════════
  if (['antilink', 'antiimage', 'antifile', 'protection', 'حماية', 'settimeout'].includes(command)) {
    if (!isAdmin) {
      return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`❌ هـذا الأمر مخصص للإداريين والمالك فقط!`)] });
    }

    const sub = args[0] ? args[0].toLowerCase() : '';

    if (command === 'antilink') {
      if (['on', 'enable', 'تفعيل', '1'].includes(sub)) config.antiLink = true;
      else if (['off', 'disable', 'تعطيل', '0'].includes(sub)) config.antiLink = false;
      else config.antiLink = !config.antiLink;

      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(config.antiLink ? 0x00FF00 : 0xFF0000)
        .setTitle(`${EMOJIS.SHINOBU_GUN} حماية الروابط | Anti-Link`)
        .setDescription(`> 🛡️ **حالة حماية الروابط:** ${config.antiLink ? '✅ **مفعلة (ON)**' : '❌ **معطلة (OFF)**'}`)
      ]});
    }

    if (command === 'antiimage') {
      if (['on', 'enable', 'تفعيل', '1'].includes(sub)) config.antiImage = true;
      else if (['off', 'disable', 'تعطيل', '0'].includes(sub)) config.antiImage = false;
      else config.antiImage = !config.antiImage;

      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(config.antiImage ? 0x00FF00 : 0xFF0000)
        .setTitle(`${EMOJIS.SHINOBU_GUN} حماية الصور | Anti-Image`)
        .setDescription(`> 🎨 **حالة حماية الصور:** ${config.antiImage ? '✅ **مفعلة (ON)**' : '❌ **معطلة (OFF)**'}`)
      ]});
    }

    if (command === 'antifile') {
      if (['on', 'enable', 'تفعيل', '1'].includes(sub)) config.antiFile = true;
      else if (['off', 'disable', 'تعطيل', '0'].includes(sub)) config.antiFile = false;
      else config.antiFile = !config.antiFile;

      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(config.antiFile ? 0x00FF00 : 0xFF0000)
        .setTitle(`${EMOJIS.SHINOBU_GUN} حماية الملفات | Anti-File`)
        .setDescription(`> 📁 **حالة حماية الملفات:** ${config.antiFile ? '✅ **مفعلة (ON)**' : '❌ **معطلة (OFF)**'}`)
      ]});
    }

    if (command === 'settimeout') {
      const minutes = parseInt(args[0]);
      if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
        return message.reply(`❌ يرجى كتابة عدد دقائق صحيح من 1 إلى 1440 (مثال: \`${PREFIX}settimeout 10\`)`);
      }
      config.timeoutMinutes = minutes;
      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`⏱️ تحديث مدة التايم أوت`)
        .setDescription(`> ✅ تم تحديد مدة التايم أوت لـ: **${minutes} دقائق**`)
      ]});
    }

    if (command === 'protection' || command === 'حماية') {
      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFF1493)
        .setTitle(`${EMOJIS.SHINOBU_GUN} لوحة حالة الحماية | Server Protection Status`)
        .setDescription(
          `> 🔗 **حماية الروابط (Anti-Link):** ${config.antiLink ? '✅ **مفعلة**' : '❌ **معطلة**'}\n` +
          `> 🎨 **حماية الصور (Anti-Image):** ${config.antiImage ? '✅ **مفعلة**' : '❌ **معطلة**'}\n` +
          `> 📁 **حماية الملفات (Anti-File):** ${config.antiFile ? '✅ **مفعلة**' : '❌ **معطلة**'}\n` +
          `> ⏱️ **مدة التايم أوت:** **${config.timeoutMinutes} دقائق**`
        )
      ]});
    }
  }

  // ══════════════════════════════════════════
  // ── 🔨 MODERATION COMMANDS ──
  // ══════════════════════════════════════════
  if (['timeout', 'untimeout', 'kick', 'ban'].includes(command)) {
    if (!isAdmin) return message.reply(`❌ هـذا الأمر مخصص للإداريين فقط.`);

    const targetMember = getTargetMember();
    if (!targetMember || targetMember.id === message.author.id) {
      return message.reply(`❌ يرجى منشن العضو المراد تطبيق الأمر عليه.`);
    }

    if (targetMember.id === OWNER_ID) {
      return message.reply(`👑 لا يمكنك استخدام الأوامر الإدارية ضد مالك البوت!`);
    }

    if (command === 'timeout') {
      const minutes = parseInt(args[1]) || config.timeoutMinutes;
      const reason = args.slice(2).join(' ') || 'بدون سبب';
      try {
        await targetMember.timeout(minutes * 60 * 1000, reason);
        return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`🛑 **تم إعطاء تايم أوت لـ <@${targetMember.id}> لمدة ${minutes} دقائق.**\nالسبب: ${reason}`)] });
      } catch(e) { return message.reply(`❌ فشل إعطاء تايم أوت: ${e.message}`); }
    }

    if (command === 'untimeout') {
      try {
        await targetMember.timeout(null);
        return message.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ **تم فك التايم أوت عن <@${targetMember.id}>.**`)] });
      } catch(e) { return message.reply(`❌ فشل فك التايم أوت: ${e.message}`); }
    }

    if (command === 'kick') {
      const reason = args.slice(1).join(' ') || 'بدون سبب';
      try {
        await targetMember.kick(reason);
        return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`👢 **تم طرد <@${targetMember.id}> من السيرفر.**\nالسبب: ${reason}`)] });
      } catch(e) { return message.reply(`❌ فشل طرد العضو: ${e.message}`); }
    }

    if (command === 'ban') {
      const reason = args.slice(1).join(' ') || 'بدون سبب';
      try {
        await targetMember.ban({ reason });
        return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`🔨 **تم حظر <@${targetMember.id}> من السيرفر نهائياً.**\nالسبب: ${reason}`)] });
      } catch(e) { return message.reply(`❌ فشل حظر العضو: ${e.message}`); }
    }
  }

  // ══════════════════════════════════════════
  // ── 🖼️ IMAGE COMMANDS ──
  // ══════════════════════════════════════════
  if (['avatar', 'banner', 'wanted'].includes(command)) {
    const targetUser = getTargetUser();

    if (command === 'avatar') {
      const avatarUrl = targetUser.displayAvatarURL({ dynamic: true, size: 1024 });
      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFF1493)
        .setTitle(`🖼️ افتار العضو: ${targetUser.username}`)
        .setImage(avatarUrl)
        .setDescription(`**[رابط الصورة المباشر](${avatarUrl})**`)
      ]});
    }

    if (command === 'banner') {
      try {
        const fetchedUser = await client.users.fetch(targetUser.id, { force: true });
        const bannerUrl = fetchedUser.bannerURL({ dynamic: true, size: 1024 });
        if (!bannerUrl) return message.reply(`❌ العضو لا يملك بنر مخصص.`);
        return message.reply({ embeds: [new EmbedBuilder()
          .setColor(0xFF1493)
          .setTitle(`🎨 بنر العضو: ${targetUser.username}`)
          .setImage(bannerUrl)
          .setDescription(`**[رابط البنر المباشر](${bannerUrl})**`)
        ]});
      } catch(e) { return message.reply(`❌ تعذر جلب بنر العضو.`); }
    }

    if (command === 'wanted') {
      const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 512 });
      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(0x8B4513)
        .setTitle(`🤠 WANTED DEAD OR ALIVE`)
        .setDescription(`> 💰 **المكافأة:** $1,000,000\n> 👤 **المطلوب:** <@${targetUser.id}>`)
        .setThumbnail(avatarUrl)
      ]});
    }
  }

  // ══════════════════════════════════════════
  // ── 📥 DOWNLOAD COMMAND (INDEPENDENT COMMAND ONLY) ──
  // ══════════════════════════════════════════
  if (['download', 'dl', 'تحميل'].includes(command)) {
    const url = args[0];
    if (!url || !url.startsWith('http')) {
      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFF1493).setTitle('📥 تحميل الفيديوهات والصوتيات | Direct Downloader')
        .setDescription(
          `**طريقة الاستخدام:** \`${PREFIX}download <الرابط>\` أو \`${PREFIX}dl <الرابط>\`\n\n` +
          `**المنصات المدعومة:**\n` +
          `> 🎬 **YouTube** (فيديوهات وShorts)\n` +
          `> 📸 **Instagram** (ريلز، بوستات)\n` +
          `> 🎵 **TikTok**\n` +
          `> 🐦 **Twitter/X**\n\n` +
          `**مثال:**\n\`${PREFIX}download https://www.youtube.com/watch?v=...\`\n\`${PREFIX}download https://www.instagram.com/reel/...\``
        )
      ]});
    }

    const statusMsg = await message.reply(`${EMOJIS.REM_DANCE} ⏬ جاري معالجة وتحميل الفيديو...`);

    let platform = '🌐 URL';
    if (url.includes('youtube.com') || url.includes('youtu.be')) platform = '🎬 YouTube';
    else if (url.includes('instagram.com')) platform = '📸 Instagram';
    else if (url.includes('tiktok.com')) platform = '🎵 TikTok';
    else if (url.includes('twitter.com') || url.includes('x.com')) platform = '🐦 Twitter/X';

    const directDlLink = getDirectDownloadLink(url);
    const tmpFile = path.join(os.tmpdir(), `dl_${Date.now()}.mp4`);

    try {
      await downloadVideo(url, tmpFile);
      if (!fs.existsSync(tmpFile)) return statusMsg.edit(`❌ لم ينشأ ملف الفيديو.`);

      const fileSizeMB = fs.statSync(tmpFile).size / (1024 * 1024);
      
      const downloadButton = new ButtonBuilder()
        .setLabel('📥 فتح صفحة التحميل المباشرة')
        .setStyle(ButtonStyle.Link)
        .setURL(directDlLink);

      if (fileSizeMB > MAX_UPLOAD_MB) {
        fs.unlinkSync(tmpFile);
        return statusMsg.edit({ content: null, embeds: [new EmbedBuilder()
          .setColor(0xFF6600).setTitle('⚠️ الملف كبير جداً للرفع المباشر')
          .setDescription(
            `حجم الفيديو **${fileSizeMB.toFixed(1)}MB** أعلى من حد المسموح للرفع (${MAX_UPLOAD_MB}MB).\n\n` +
            `**📥 [اضغط هنا للتحميل المباشر من المتصفح](${directDlLink})**`
          )], components: [new ActionRowBuilder().addComponents(downloadButton)]});
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF1493).setTitle('✅ تم التحميل والرفع بنجاح!')
        .setDescription(
          `> 📌 **المنصة:** ${platform}\n` +
          `> 📦 **الحجم:** ${fileSizeMB.toFixed(2)} MB\n` +
          `> 👤 **بواسطة:** <@${message.author.id}>\n\n` +
          `📥 **[اضغط هنا للتحميل المباشر بصيغ مختلفة](${directDlLink})**`
        )
        .setFooter({ text: 'Powered by Direct Downloader 📥' });

      await statusMsg.edit({
        content: null,
        embeds: [embed],
        files: [new AttachmentBuilder(tmpFile, { name: 'video.mp4' })],
        components: [new ActionRowBuilder().addComponents(downloadButton)]
      });

      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch(e) {} }, 15000);
    } catch (err) {
      console.error('[download error]', err.message);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      
      const fallbackBtn = new ButtonBuilder()
        .setLabel('🌐 فتح صفحة التحميل البديلة')
        .setStyle(ButtonStyle.Link)
        .setURL(directDlLink);

      return statusMsg.edit({ content: null, embeds: [new EmbedBuilder()
        .setColor(0xFF1493).setTitle('📥 رابط التحميل المباشر السريع')
        .setDescription(
          `يمكنك تحميل الفيديو/الصوت مباشرة عبر الرابط أدناه:\n\n` +
          `👉 **[اضغط هنا لفتح صفحة التحميل المباشرة](${directDlLink})**`
        )], components: [new ActionRowBuilder().addComponents(fallbackBtn)]});
    }
    return;
  }

  // ══════════════════════════════════════════
  // ── VOICE / MUSIC COMMANDS (CLEAN PLAY ONLY - NO DOWNLOAD BUTTONS) ──
  // ══════════════════════════════════════════
  if (['join', 'connect', 'play', 'stop', 'leave'].includes(command)) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply(`${EMOJIS.ANIME_SCREAM} **يجب أن تكون متصلاً بروم صوتي أولاً!**`);

    // ── JOIN ──
    if (command === 'join' || command === 'connect') {
      try {
        let connection = voicePkg.getVoiceConnection(message.guild.id);
        if (!connection || connection.state.status === voicePkg.VoiceConnectionStatus.Destroyed) {
          connection = voicePkg.joinVoiceChannel({
            channelId: voiceChannel.id, guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false, selfMute: false
          });
          await voicePkg.entersState(connection, voicePkg.VoiceConnectionStatus.Ready, 15_000);
        }
        voiceData.set(message.guild.id, { connection });
        return message.reply(`${EMOJIS.SUCCESS} تم الانضمام للروم: <#${voiceChannel.id}>`);
      } catch (err) { return message.reply(`❌ ${err.message}`); }
    }

    // ── STOP / LEAVE ──
    if (['stop', 'leave'].includes(command)) {
      const data = voiceData.get(message.guild.id);
      if (data) {
        try { if (data.player) data.player.stop(true); } catch(e) {}
        try { if (data.ytdlpProc) data.ytdlpProc.kill('SIGKILL'); } catch(e) {}
        try { if (data.ffmpegProc) data.ffmpegProc.kill('SIGKILL'); } catch(e) {}
        try { if (data.connection) data.connection.destroy(); } catch(e) {}
        voiceData.delete(message.guild.id);
        return message.reply(`${EMOJIS.SUCCESS} تم إيقاف الصوت ومغادرة الروم.`);
      }
      const conn = voicePkg.getVoiceConnection(message.guild.id);
      if (conn) { conn.destroy(); return message.reply(`${EMOJIS.SUCCESS} تم المغادرة.`); }
      return message.reply(`البوت غير متصل حالياً!`);
    }

    // ── PLAY (CLEAN & DIRECT VOICE AUDIO) ──
    if (command === 'play') {
      let searchQuery = args.join(' ');
      if (!searchQuery) return message.reply(`${EMOJIS.TOHRU_SMUG} اكتب اسم الأغنية أو رابط Spotify/YouTube.`);

      const statusMsg = await message.reply(`${EMOJIS.REM_DANCE} 🎵 جاري البحث والتشغيل...`);

      try {
        const binaryPath = await ensureYtDlp();

        let songTitle = searchQuery;
        let songArtist = '';
        let coverImage = client.user.displayAvatarURL();
        let youtubeUrl = null;

        // ── 1. Spotify track resolution ──
        if (searchQuery.includes('spotify.com')) {
          try {
            const preview = await spotifyUrlInfo?.getPreview(searchQuery);
            if (preview?.title) {
              songTitle = preview.title;
              songArtist = preview.artist || '';
              if (preview.image) coverImage = preview.image;
            }
          } catch(e) {}

          const searchRes = await yts(`${songTitle} ${songArtist}`.trim());
          if (searchRes?.videos?.length > 0) {
            youtubeUrl = searchRes.videos[0].url;
            if (!coverImage || coverImage === client.user.displayAvatarURL()) {
              coverImage = searchRes.videos[0].thumbnail || coverImage;
            }
          }

        // ── 2. YouTube URL (video or Shorts) ──
        } else if (searchQuery.includes('youtube.com') || searchQuery.includes('youtu.be')) {
          let cleanUrl = searchQuery;
          if (cleanUrl.includes('/shorts/')) {
            const vid = cleanUrl.split('/shorts/')[1].split('?')[0];
            cleanUrl = `https://www.youtube.com/watch?v=${vid}`;
          }
          youtubeUrl = cleanUrl;
          try {
            const searchRes = await yts(cleanUrl);
            if (searchRes?.videos?.length > 0) {
              songTitle = searchRes.videos[0].title || songTitle;
              coverImage = searchRes.videos[0].thumbnail || coverImage;
            }
          } catch(e) {}

        // ── 3. Plain Text search via yt-search ──
        } else {
          const searchRes = await yts(searchQuery);
          if (searchRes?.videos?.length > 0) {
            const v = searchRes.videos[0];
            youtubeUrl = v.url;
            songTitle = v.title || songTitle;
            coverImage = v.thumbnail || coverImage;
          }
        }

        if (!youtubeUrl) {
          return statusMsg.edit(`❌ لم يتم العثور على نتائج لـ: \`${searchQuery}\``);
        }

        console.log('▶ Streaming:', youtubeUrl, 'using binary:', binaryPath);

        const existingData = voiceData.get(message.guild.id);
        if (existingData) {
          try { if (existingData.player) existingData.player.stop(true); } catch(e) {}
          try { if (existingData.ytdlpProc) existingData.ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { if (existingData.ffmpegProc) existingData.ffmpegProc.kill('SIGKILL'); } catch(e) {}
        }

        // Create OggOpus stream for Discord Native Voice
        const { ytdlpProc, ffmpegProc, audioStream } = createYtDlpStream(youtubeUrl, binaryPath);

        let connection = voicePkg.getVoiceConnection(message.guild.id);
        if (!connection || connection.state.status === voicePkg.VoiceConnectionStatus.Destroyed) {
          connection = voicePkg.joinVoiceChannel({
            channelId: voiceChannel.id, guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false, selfMute: false
          });
        }

        try {
          await voicePkg.entersState(connection, voicePkg.VoiceConnectionStatus.Ready, 20_000);
        } catch (connErr) {
          try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
          return statusMsg.edit(`❌ فشل الاتصال بالروم الصوتي. حاول مجدداً.`);
        }

        // Native OggOpus Resource (No JS Opus re-encoding needed = Pure Sound)
        const resource = voicePkg.createAudioResource(audioStream, {
          inputType: voicePkg.StreamType.OggOpus,
          inlineVolume: false
        });

        const player = voicePkg.createAudioPlayer({
          behaviors: { noSubscriber: voicePkg.NoSubscriberBehavior.Play }
        });
        connection.subscribe(player);
        player.play(resource);

        voiceData.set(message.guild.id, { connection, player, ytdlpProc, ffmpegProc });

        let hasPlayed = false;
        player.on('stateChange', (oldState, newState) => {
          console.log(`🎵 Voice Player State: ${oldState.status} → ${newState.status}`);
          if (newState.status === voicePkg.AudioPlayerStatus.Playing) hasPlayed = true;
          if (hasPlayed && newState.status === voicePkg.AudioPlayerStatus.Idle) {
            try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
            try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
            const d = voiceData.get(message.guild.id);
            if (d) voiceData.set(message.guild.id, { connection: d.connection });
            console.log('✅ Song ended. Bot stays connected in voice channel.');
          }
        });

        player.on('error', err => {
          console.log('[Audio player error]', err.message);
          try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
        });

        const displayTitle = songArtist ? `${songTitle} — ${songArtist}` : songTitle;

        // Clean embed ONLY (No download buttons attached to !play)
        const playEmbed = new EmbedBuilder()
          .setColor(0xFF1493)
          .setTitle(`🎤 يتم الآن البث الصوتـي | Streaming Now`)
          .setDescription(
            `> 🎵 **${displayTitle}**\n` +
            `> 🔊 **الروم الصوتي:** <#${voiceChannel.id}>\n` +
            `> 👤 **بواسطة:** <@${message.author.id}>`
          )
          .setThumbnail(coverImage)
          .setFooter({ text: 'Live Voice Stream 🎧' });

        return statusMsg.edit({
          content: null,
          embeds: [playEmbed]
        });

      } catch (err) {
        console.error('[play error]', err);
        return statusMsg.edit(`❌ حدث خطأ أثناء التشغيل: ${err.message || 'خطأ غير معروف'}`);
      }
    }
  }

  // ── PROFILE BIO ──
  if (['bio', 'profile'].includes(command)) {
    const member = getTargetMember();
    const user = member.user;
    const isTargetOwner = user.id === OWNER_ID;
    const rolesList = member.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).slice(0, 8).join(' ') || 'عضو عادي';
    return message.reply({ embeds: [new EmbedBuilder()
      .setColor(isTargetOwner ? 0xFFD700 : 0xFF69B4)
      .setTitle(`${EMOJIS.PINK_VERIFIED} Profile Bio Card`)
      .setDescription(`### ${user.username} ${isTargetOwner ? '👑' : ''}\n> ${isTargetOwner ? 'تاج الرأس ومالك البوت الرسمي.' : 'عضو مميز في السيرفر.'}`)
      .addFields(
        { name: 'الرتب', value: rolesList },
        { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(user.createdTimestamp/1000)}:D>`, inline: true },
        { name: 'تاريخ الانضمام', value: `<t:${Math.floor(member.joinedTimestamp/1000)}:D>`, inline: true }
      ).setThumbnail(user.displayAvatarURL({ dynamic: true }))] });
  }

  // ══════════════════════════════════════════
  // ── ANIME GIF COMMANDS ──
  // ══════════════════════════════════════════
  const ANIME_COMMANDS = [
    'hug','kiss','pat','slap','cuddle','poke','punch','bite','lick','highfive',
    'wave','bonk','kill','shoot','nom','kick','feed','wink',
    'dance','smug','cry','blush','happy','sleep','bored','think',
    'facepalm','clap','shrug','peek','confused','nervous','triggered','run',
    'waifu','neko','thumbsup'
  ];

  if (ANIME_COMMANDS.includes(command)) {
    const targetUser = getTargetUser();
    const isSelf = targetUser.id === message.author.id;
    const gifUrl = await fetchAnimeGif(command);
    const SOLO = ['waifu','neko','dance','cry','blush','happy','sleep','bored','think','facepalm','clap','shrug','confused','nervous','triggered','run','thumbsup'];

    if (SOLO.includes(command)) {
      const msgs = {
        dance:     `💃 **${message.author.username}** يرقص بسعادة ولطف! ${EMOJIS.REM_DANCE}`,
        cry:       `😢 **${message.author.username}** يبكي بحرقة... ${EMOJIS.ANIME_SCREAM}`,
        blush:     `😳 **${message.author.username}** يحمر خجلاً ولطافة! ${EMOJIS.BLUSHING_BOY}`,
        happy:     `😊 **${message.author.username}** في غاية السعادة! ✨`,
        sleep:     `😴 **${message.author.username}** مستغرق في النوم... 💤`,
        bored:     `😑 **${message.author.username}** يشعر بالملل الشديد...`,
        think:     `🤔 **${message.author.username}** عميق التفكير... 💭`,
        facepalm:  `🤦 **${message.author.username}** يضع يده على وجهه إحباطاً!`,
        clap:      `👏 **${message.author.username}** يصفّق بحرارة! 🎉`,
        shrug:     `🤷 **${message.author.username}** لا يعلم شيئاً!`,
        confused:  `😕 **${message.author.username}** محتار جداً!`,
        nervous:   `😰 **${message.author.username}** يتصبب عرقاً وتوتراً!`,
        triggered: `😤 **${message.author.username}** غاضب وفاقد للأعصاب! 💥`,
        run:       `🏃 **${message.author.username}** يركض بأقصى سرعة! 💨`,
        thumbsup:  `👍 **${message.author.username}** يعطي إبهاماً للأعلى! ✨`,
        waifu:     `🌸 صورة Waifu أنيقة خصيصاً لـ **${message.author.username}**`,
        neko:      `🐱 صورة Neko كيوت لـ **${message.author.username}**`,
      };

      const animeEmbed = new EmbedBuilder()
        .setColor(0xFF1493)
        .setAuthor({ name: `${client.user.username} Anime React 🌸`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
        .setDescription(`### ${msgs[command] || `**${message.author.username}** ${command}`}`)
        .setImage(gifUrl)
        .setFooter({ text: `طُلب بواسطة: ${message.author.username}`, iconURL: message.author.displayAvatarURL() });

      return message.reply({ embeds: [animeEmbed] });
    }

    const tMsgs = {
      hug:      isSelf ? `🤗 **${message.author.username}** يعانق نفسه بمحبة!` : `🤗 **${message.author.username}** يعانق <@${targetUser.id}> عناقاً دافئاً! ${EMOJIS.SHARK_HUG}`,
      kiss:     `💋 **${message.author.username}** يقبّل <@${targetUser.id}> قبضة لطيفة! 💕`,
      pat:      `✋ **${message.author.username}** يربّت على رأس <@${targetUser.id}> بلطف! ${EMOJIS.PIKA_CHEEKS}`,
      slap:     `👋 **${message.author.username}** يصفع <@${targetUser.id}> صفعة أنمي! 💥`,
      cuddle:   `🥰 **${message.author.username}** يحتضن <@${targetUser.id}> بحنان! ✨`,
      poke:     `👉 **${message.author.username}** يوخز <@${targetUser.id}> بشقاوة!`,
      punch:    `👊 **${message.author.username}** يلكم <@${targetUser.id}> لكمة أنمي قوية! 💥`,
      bite:     `😬 **${message.author.username}** يعض <@${targetUser.id}>! 🦷`,
      lick:     `👅 **${message.author.username}** يلحس <@${targetUser.id}>!`,
      highfive: `🙌 **${message.author.username}** يعطي High Five لـ <@${targetUser.id}>! ⭐`,
      wave:     `👋 **${message.author.username}** يلوّح بيده لـ <@${targetUser.id}>! ✨`,
      bonk:     `🔨 **${message.author.username}** يضرب <@${targetUser.id}> على رأسه! 💥`,
      kill:     `💀 **${message.author.username}** يطلق النار على <@${targetUser.id}>! 🔫`,
      shoot:    `🔫 **${message.author.username}** يصوّب بدقة على <@${targetUser.id}>!`,
      nom:      `🍪 **${message.author.username}** يأكل <@${targetUser.id}> بكل شراهة!`,
      kick:     `🦵 **${message.author.username}** يركل <@${targetUser.id}> ركلة أنمي! 💥`,
      feed:     `🍱 **${message.author.username}** يطعم <@${targetUser.id}> طعاماً لذيذاً! 😋`,
      wink:     `😉 **${message.author.username}** يغمز لـ <@${targetUser.id}> بغمزة ساحرة! ✨`,
      smug:     `😏 **${message.author.username}** يبتسم بسخرية ولطافة لـ <@${targetUser.id}>! ${EMOJIS.TOHRU_SMUG}`,
      peek:     `👀 **${message.author.username}** يتلصص بخجل على <@${targetUser.id}>!`,
    };

    const animeEmbed = new EmbedBuilder()
      .setColor(0xFF1493)
      .setAuthor({ name: `${client.user.username} Anime Action 🌸`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
      .setDescription(`### ${tMsgs[command] || `**${message.author.username}** ${command} <@${targetUser.id}>`}`)
      .setImage(gifUrl)
      .setFooter({ text: `طُلب بواسطة: ${message.author.username}`, iconURL: message.author.displayAvatarURL() });

    return message.reply({ embeds: [animeEmbed] });
  }

  // ── BOTINFO ──
  if (command === 'botinfo') {
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF1493).setTitle(`معلومات البوت`).setDescription(`المالك: <@${OWNER_ID}>\nالسرعة: \`${client.ws.ping}ms\`\nالتشغيل: \`${getUptimeString()}\``)] });
  }

  // ── CLEAR ──
  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) && !isOwner) return;
    const amount = parseInt(args[0]) || 10;
    await message.channel.bulkDelete(Math.min(amount + 1, 100), true);
    return;
  }

  // ══════════════════════════════════════════
  // ── AI COMMAND: !ai <question> ──
  // ══════════════════════════════════════════
  if (['ai', 'ذكاء', 'سؤال', 'ask'].includes(command)) {
    const question = args.join(' ');
    if (!question) {
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle('🤖 Rilina AI — الذكاء الاصطناعي')
          .setDescription(
            `> اكتب سؤالك بعد الأمر:\n` +
            `> \`${PREFIX}ai ما هو الذكاء الاصطناعي?\`\n\n` +
            `> أو قم بمنشن البوت مباشرة مع سؤالك!\n` +
            `> **مثال:** \`@Rilina ما هو الطقس اليوم?\``
          )
          .setFooter({ text: 'مدعوم بـ Google Gemini 2.0 Flash ✨' })
      ]});
    }
    await message.channel.sendTyping();
    const aiResponse = await askGemini(question);
    const chunks = [];
    for (let i = 0; i < aiResponse.length; i += 3900) chunks.push(aiResponse.slice(i, i + 3900));
    for (let i = 0; i < Math.min(chunks.length, 3); i++) {
      const aiEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setAuthor({ name: `Rilina AI 🤖✨`, iconURL: client.user.displayAvatarURL() })
        .setTitle(i === 0 ? `💬 ${question.slice(0, 100)}` : null)
        .setDescription(chunks[i])
        .setFooter({ text: `سألك: ${message.author.username} • مدعوم بـ Gemini 2.0 Flash 🌟`, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();
      await message.reply({ embeds: [aiEmbed] });
    }
    return;
  }
});

// ── Login ──
const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ DISCORD_TOKEN is missing!'); process.exit(1); }
client.login(token).catch(err => console.error('❌ Login failed:', err));
