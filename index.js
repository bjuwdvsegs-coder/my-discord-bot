require('dotenv').config();
const https = require('https');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  PermissionsBitField, 
  AttachmentBuilder,
  ActivityType,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

// Auto-detect and bind ffmpeg-static binary
try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
  }
} catch (e) {}

const path = require('path');
const { spawn } = require('child_process');

// ── Audio engine paths ──
const FFMPEG_PATH = (() => { try { return require('ffmpeg-static'); } catch(e) { return 'ffmpeg'; } })();
const fs = require('fs');
const YTDlpWrap = require('yt-dlp-wrap').default;

const YTDLP_BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
let YTDLP_PATH = path.join(__dirname, YTDLP_BINARY_NAME);

async function ensureYtDlpBinary() {
  try {
    if (!fs.existsSync(YTDLP_PATH)) {
      console.log(`📦 Downloading yt-dlp binary for ${process.platform}...`);
      await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
      if (process.platform !== 'win32') {
        try { fs.chmodSync(YTDLP_PATH, 0o755); } catch(e) {}
      }
      console.log('✅ yt-dlp binary ready!');
    }
  } catch (err) {
    console.log('⚠️ Failed to auto-download yt-dlp, using system fallback:', err.message);
    YTDLP_PATH = 'yt-dlp';
  }
}
ensureYtDlpBinary();

let voicePkg, playDl, spotifyUrlInfo;
try {
  voicePkg = require('@discordjs/voice');
  playDl = require('play-dl');  // used for search() only
  spotifyUrlInfo = require('spotify-url-info')(fetch);
} catch (e) {
  console.log('Package loading error:', e.message);
}

let createCanvas, loadImage;
try {
  const canvasPkg = require('@napi-rs/canvas');
  createCanvas = canvasPkg.createCanvas;
  loadImage = canvasPkg.loadImage;
} catch (e) {}

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

// ONLY NEW ANIME EMOJIS
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

const ANIME_GIFS = {
  hug: [
    'https://media.tenor.com/images/3f9b2f90b1e8f7cdef9bc1b8e17b6bde/tenor.gif',
    'https://media.tenor.com/images/c92b2a4e2b0f1d1e8f44b8a3f9c5d7e2/tenor.gif',
    'https://media.tenor.com/images/7f44b15db35ea1c7cef3e22d0f0c2e18/tenor.gif',
    'https://media.tenor.com/images/e10c59ab614fc9cbf0b09a9d81bb7748/tenor.gif',
  ],
  kiss: [
    'https://media.tenor.com/images/1f1810c6f79db72f7e30f6fdbf82c8d7/tenor.gif',
    'https://media.tenor.com/images/6a01e29c40b30a44c1d8e21e28d88de9/tenor.gif',
    'https://media.tenor.com/images/9f4d7823c1e2b0a5f3d8c6e1a7b4f2d9/tenor.gif',
  ],
  pat: [
    'https://media.tenor.com/images/01a3ad8a5a1c0abf2b1f44b0b07b53a4/tenor.gif',
    'https://media.tenor.com/images/5a3c7e9b1f2d4e6a8c0b2d4f6a8c0e2a/tenor.gif',
    'https://media.tenor.com/images/a8c2e4f6b8d0e2a4c6e8a0b2d4f6a8c0/tenor.gif',
  ],
  slap: [
    'https://media.tenor.com/images/e0aef44a40df0f90dcb06b0e65a8c3ab/tenor.gif',
    'https://media.tenor.com/images/b4c6e8a0b2d4f6a8c0e2a4c6e8a0b2d4/tenor.gif',
    'https://media.tenor.com/images/d0e2a4c6e8a0b2d4f6a8c0e2a4c6e8a0/tenor.gif',
  ],
  cuddle: [
    'https://media.tenor.com/images/06f27dbbfb5f3218614668f571ab1b88/tenor.gif',
    'https://media.tenor.com/images/8a0b2d4f6a8c0e2a4c6e8a0b2d4f6a8c/tenor.gif',
    'https://media.tenor.com/images/c2e4f6a8c0e2a4c6e8a0b2d4f6a8c0e2/tenor.gif',
  ],
  poke: [
    'https://media.tenor.com/images/d2f68da0f3b24fc60feada22bd40e71d/tenor.gif',
    'https://media.tenor.com/images/e4f6a8c0e2a4c6e8a0b2d4f6a8c0e2a4/tenor.gif',
  ],
  punch: [
    'https://media.tenor.com/images/2ee8e9ef849de6b2b5b2dcf6e3e47ad3/tenor.gif',
    'https://media.tenor.com/images/f6a8c0e2a4c6e8a0b2d4f6a8c0e2a4c6/tenor.gif',
  ],
  bite: [
    'https://media.tenor.com/images/5d89a0c18c0ad0db82a9cedc1eff36ed/tenor.gif',
    'https://media.tenor.com/images/a0b2d4f6a8c0e2a4c6e8a0b2d4f6a8c0/tenor.gif',
  ],
  lick: [
    'https://media.tenor.com/images/9a19ce3e89dac3ad7d79e08e8a7b6d02/tenor.gif',
    'https://media.tenor.com/images/b2d4f6a8c0e2a4c6e8a0b2d4f6a8c0e2/tenor.gif',
  ],
  highfive: [
    'https://media.tenor.com/images/5048f68d61a10bfd9451e0c52b038db3/tenor.gif',
    'https://media.tenor.com/images/c4e6a8c0e2a4c6e8a0b2d4f6a8c0e2a4/tenor.gif',
  ],
  wave: [
    'https://media.tenor.com/images/2f4b5bed6e1e7e19e0e0f51b8eb36fa2/tenor.gif',
    'https://media.tenor.com/images/d6a8c0e2a4c6e8a0b2d4f6a8c0e2a4c6/tenor.gif',
  ],
  bonk: [
    'https://media.tenor.com/images/b7c3ab26d1c4ec4b64e20c76fcd1de8f/tenor.gif',
    'https://media.tenor.com/images/e8a0b2d4f6a8c0e2a4c6e8a0b2d4f6a8/tenor.gif',
  ],
  kill:  ['https://media.tenor.com/images/ee9d4ac2bf6e0e99a7e3de9b26a48c8a/tenor.gif'],
  shoot: ['https://media.tenor.com/images/ee9d4ac2bf6e0e99a7e3de9b26a48c8a/tenor.gif'],
  nom:   ['https://media.tenor.com/images/5d89a0c18c0ad0db82a9cedc1eff36ed/tenor.gif'],
  kick:  ['https://media.tenor.com/images/2ee8e9ef849de6b2b5b2dcf6e3e47ad3/tenor.gif'],
  feed:  ['https://media.tenor.com/images/5d89a0c18c0ad0db82a9cedc1eff36ed/tenor.gif'],
  wink:  ['https://media.tenor.com/images/6a01e29c40b30a44c1d8e21e28d88de9/tenor.gif'],
  dance: [
    'https://media.tenor.com/images/c4d4cf5ae2ed3c8f79494acba7b2e9dd/tenor.gif',
    'https://media.tenor.com/images/a3c5e7a9b1d3f5a7c9e1b3d5f7a9c1e3/tenor.gif',
    'https://media.tenor.com/images/f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5/tenor.gif',
  ],
  smug: [
    'https://media.tenor.com/images/a6e88236d8c31e10e2e76eff1f68e6e5/tenor.gif',
    'https://media.tenor.com/images/c8e0a2c4e6a8c0e2a4c6e8a0b2d4f6a8/tenor.gif',
  ],
  cry: [
    'https://media.tenor.com/images/8459ff5e53e9c2680f2fd0fc27cbf6e7/tenor.gif',
    'https://media.tenor.com/images/e0a2c4e6a8c0e2a4c6e8a0b2d4f6a8c0/tenor.gif',
    'https://media.tenor.com/images/a2c4e6a8c0e2a4c6e8a0b2d4f6a8c0e2/tenor.gif',
  ],
  blush: [
    'https://media.tenor.com/images/e7e59c8db741fc37c3d9ccfa84ac1fce/tenor.gif',
    'https://media.tenor.com/images/c4e6a8c0e2a4c6e8a0b2d4f6a8c0e2a4/tenor.gif',
  ],
  happy: [
    'https://media.tenor.com/images/0ba3f3e0a1ed01b2f4b23e9cb07af69d/tenor.gif',
    'https://media.tenor.com/images/e6a8c0e2a4c6e8a0b2d4f6a8c0e2a4c6/tenor.gif',
  ],
  sleep: [
    'https://media.tenor.com/images/37a11eef7d7aabc36c9dba37e63f2a0e/tenor.gif',
    'https://media.tenor.com/images/a8c0e2a4c6e8a0b2d4f6a8c0e2a4c6e8/tenor.gif',
  ],
  bored: [
    'https://media.tenor.com/images/4fd05e53e59a9b6e74c0d76f2dda9ec8/tenor.gif',
    'https://media.tenor.com/images/b0d2f4a6c8e0a2c4e6a8c0e2a4c6e8a0/tenor.gif',
  ],
  think: [
    'https://media.tenor.com/images/9c05e9a2de8da7d35f3a820e8f0ac6e4/tenor.gif',
    'https://media.tenor.com/images/c2e4f6a8c0e2a4c6e8a0b2d4f6a8c0e2/tenor.gif',
  ],
  facepalm: [
    'https://media.tenor.com/images/fe57f60a69d6c0d2e0bd1d7efdacea97/tenor.gif',
    'https://media.tenor.com/images/d4f6a8c0e2a4c6e8a0b2d4f6a8c0e2a4/tenor.gif',
  ],
  clap: [
    'https://media.tenor.com/images/6d2b5eea9e4f4e64de83c5a90f8d26ea/tenor.gif',
    'https://media.tenor.com/images/e6a8c0e2a4c6e8a0b2d4f6a8c0e2a4c6/tenor.gif',
  ],
  shrug: [
    'https://media.tenor.com/images/46b15ae9cef27f86fd04b8553f7e57a0/tenor.gif',
    'https://media.tenor.com/images/f8c0e2a4c6e8a0b2d4f6a8c0e2a4c6e8/tenor.gif',
  ],
  peek: [
    'https://media.tenor.com/images/3b2e58e20ff64d8b02c3c2ef1f0c5ee8/tenor.gif',
    'https://media.tenor.com/images/a0c2e4f6a8c0e2a4c6e8a0b2d4f6a8c0/tenor.gif',
  ],
  confused: [
    'https://media.tenor.com/images/9c05e9a2de8da7d35f3a820e8f0ac6e4/tenor.gif',
    'https://media.tenor.com/images/b2d4f6a8c0e2a4c6e8a0b2d4f6a8c0e2/tenor.gif',
  ],
  nervous: [
    'https://media.tenor.com/images/e7e59c8db741fc37c3d9ccfa84ac1fce/tenor.gif',
    'https://media.tenor.com/images/c4e6a8c0e2a4c6e8a0b2d4f6a8c0e2a4/tenor.gif',
  ],
  triggered: [
    'https://media.tenor.com/images/2ee8e9ef849de6b2b5b2dcf6e3e47ad3/tenor.gif',
    'https://media.tenor.com/images/d6a8c0e2a4c6e8a0b2d4f6a8c0e2a4c6/tenor.gif',
  ],
  run: [
    'https://media.tenor.com/images/c4d4cf5ae2ed3c8f79494acba7b2e9dd/tenor.gif',
    'https://media.tenor.com/images/e8a0b2d4f6a8c0e2a4c6e8a0b2d4f6a8/tenor.gif',
  ],
  thumbsup: [
    'https://media.tenor.com/images/5048f68d61a10bfd9451e0c52b038db3/tenor.gif',
    'https://media.tenor.com/images/f0b2d4f6a8c0e2a4c6e8a0b2d4f6a8c0/tenor.gif',
  ],
  waifu: [
    'https://media.tenor.com/images/3b2e58e20ff64d8b02c3c2ef1f0c5ee8/tenor.gif',
    'https://media.tenor.com/images/a6e88236d8c31e10e2e76eff1f68e6e5/tenor.gif',
  ],
  neko: [
    'https://media.tenor.com/images/06f27dbbfb5f3218614668f571ab1b88/tenor.gif',
    'https://media.tenor.com/images/e7e59c8db741fc37c3d9ccfa84ac1fce/tenor.gif',
  ],
};

const ANIME_GIF_FALLBACKS = {
  hug: ['https://cdn.otakugifs.xyz/gifs/hug/df0840a507aa481a.gif', 'https://cdn.otakugifs.xyz/gifs/hug/6d915e537c818fa9.gif'],
  kiss: ['https://cdn.otakugifs.xyz/gifs/kiss/e8620e4b5d4907df.gif'],
  pat: ['https://cdn.otakugifs.xyz/gifs/pat/13ec930fd42770f6.gif'],
  slap: ['https://cdn.otakugifs.xyz/gifs/slap/728770007827600b.gif'],
  cuddle: ['https://cdn.otakugifs.xyz/gifs/cuddle/7dca23f6128a1897.gif'],
  dance: ['https://cdn.otakugifs.xyz/gifs/dance/0fd2b6003eb5dad1.gif'],
  cry: ['https://cdn.otakugifs.xyz/gifs/cry/c97b378c7184ea59.gif'],
  blush: ['https://cdn.otakugifs.xyz/gifs/blush/rh8KXQBMWBka.gif'],
  happy: ['https://cdn.otakugifs.xyz/gifs/happy/vhplowmpdJ.gif'],
  wave: ['https://cdn.otakugifs.xyz/gifs/wave/d8a72db89663ed79.gif'],
  poke: ['https://cdn.otakugifs.xyz/gifs/poke/08002e2d348de3f5.gif'],
  punch: ['https://cdn.otakugifs.xyz/gifs/punch/a68e34a1994c91f7.gif'],
  bite: ['https://cdn.otakugifs.xyz/gifs/bite/1c10d5980ba1830b.gif'],
  wink: ['https://cdn.otakugifs.xyz/gifs/wink/1c383c21519a03f2.gif'],
  smug: ['https://cdn.otakugifs.xyz/gifs/smug/65b7d98434dd9b51.gif'],
  shrug: ['https://cdn.otakugifs.xyz/gifs/shrug/9647cbc5d03a7b8b.gif'],
  sleep: ['https://cdn.otakugifs.xyz/gifs/sleep/93653e80a930251f.gif'],
  facepalm: ['https://cdn.otakugifs.xyz/gifs/facepalm/de2fe17a75556e04.gif'],
  thumbsup: ['https://cdn.otakugifs.xyz/gifs/thumbsup/86c02b24f136e08f.gif']
};

function fetchAnimeGif(type) {
  return new Promise((resolve) => {
    const useFallback = () => {
      const list = ANIME_GIF_FALLBACKS[type] || ANIME_GIF_FALLBACKS.hug;
      resolve(list[Math.floor(Math.random() * list.length)]);
    };

    const req = https.get(`https://api.otakugifs.xyz/gif?reaction=${type}`, {
      timeout: 3500,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.url && j.url.startsWith('http')) return resolve(j.url);
        } catch(e) {}
        useFallback();
      });
    });
    req.on('error', useFallback);
    req.on('timeout', () => { req.destroy(); useFallback(); });
  });
}


const guildSettings = new Map();
function getGuildConfig(guildId) {
  if (!guildSettings.has(guildId)) {
    guildSettings.set(guildId, {
      antiLink: true,
      antiImage: true,
      antiFile: true,
      timeoutMinutes: DEFAULT_TIMEOUT_MIN
    });
  }
  return guildSettings.get(guildId);
}

function getUptimeString() {
  const totalSeconds = Math.floor((Date.now() - startTime) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

const LINK_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|io|me|li)\/[^\s]+)/gi;
const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;

function createHelpEmbed(category, user, client) {
  const baseEmbed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setAuthor({ name: `${client.user.username} Suite`, iconURL: client.user.displayAvatarURL() })
    .setFooter({ text: `طُلب بواسطة: ${user.tag} • المالك: ${OWNER_ID}`, iconURL: user.displayAvatarURL() })
    .setTimestamp();

  if (category === 'main') {
    return baseEmbed
      .setTitle(`${EMOJIS.PINK_VERIFIED} ${EMOJIS.REM_DANCE} لوحة التحكم الرئيسية | System Control`)
      .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 512 }))
      .setDescription(
        `> ${EMOJIS.PINK_BUTTERFLY} **مرحباً بك في البوت الشامل للحماية والتفاعل وصوت البث!**\n\n` +
        `> ⚡ **البادئة:** \`${PREFIX}\`\n` +
        `> 👑 **المالك:** <@${OWNER_ID}>\n` +
        `> 📺 **الحالة:** \`Stream Mode 24/7\`\n\n` +
        `🌸 **يرجى اختيار القسم المطلوب من القائمة المنسدلة أدناه:**`
      );
  }
  if (category === 'protection') {
    return baseEmbed
      .setTitle(`${EMOJIS.SHINOBU_GUN} أنظمة الحماية والتايم أوت | Protection`)
      .setDescription(
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antilink <on/off>\` ➔ حماية الروابط\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antiimage <on/off>\` ➔ حماية الصور\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antifile <on/off>\` ➔ حماية الملفات\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}protection\` ➔ عرض حالة الحماية`
      );
  }
  if (category === 'images') {
    return baseEmbed
      .setTitle(`${EMOJIS.SHARK_HUG} تأثيرات الصور | Image Magic`)
      .setDescription(
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}avatar [@user]\` ➔ عرض وتنزيل الافتار\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}banner [@user]\` ➔ عرض وتنزيل البنر\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}wanted [@user]\` ➔ تصميم ملصق مطلوب\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}blur [@user]\` ➔ تأثير التغبيش الضبابي\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}invert [@user]\` ➔ عكس ألوان الصورة\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}greyscale [@user]\` ➔ تحويل لأبيض وأسود`
      );
  }
  if (category === 'anime') {
    return baseEmbed
      .setTitle(`${EMOJIS.REM_DANCE} تفاعلات وصور الأنمي | Anime Actions`)
      .setDescription(
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}hug [@user]\` ➔ عناق أنمي كيوت\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kiss [@user]\` ➔ قبلة أنمي لطيفة\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}pat [@user]\` ➔ تربيت على الرأس\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}slap [@user]\` ➔ صفعة أنمي\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}cuddle [@user]\` ➔ احتضان دافئ\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}dance\` ➔ رقصة أنمي\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}smug [@user]\` ➔ ابتسامة أنمي\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}poke [@user]\` ➔ وخز العضو\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}punch [@user]\` ➔ لكمة أنمي\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}cry\` ➔ صور بكاء\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kill [@user]\` ➔ إطلاق نار أو قتال\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}waifu\` ➔ صور Waifu متجددة`
      );
  }
  if (category === 'music') {
    return baseEmbed
      .setTitle(`🎤 الروم الصوتي وتشغيل الصوت | Voice Channel`)
      .setDescription(
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}join\` ➔ الانضمام للروم الصوتي في السيرفر\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}play <اسم الأغنية / رابط YouTube / Spotify>\` ➔ البحث والتشغيل الفائق\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}stop\` / \`${PREFIX}leave\` ➔ إيقاف ومغادرة الروم الصوتي`
      );
  }
  if (category === 'bio') {
    return baseEmbed
      .setTitle(`${EMOJIS.PINK_VERIFIED} سيرة البروفايل | Profile Bio Card`)
      .setDescription(
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}bio [@user]\` / \`${PREFIX}profile\` ➔ بطاقة البروفايل والسيرة الذاتية\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}botinfo\` ➔ سيرة ومعلومات البوت الرسمية\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}userinfo [@user]\` ➔ معلومات العضو بالتفصيل\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}serverinfo\` ➔ معلومات السيرفر`
      );
  }
  if (category === 'moderation') {
    return baseEmbed
      .setTitle(`${EMOJIS.STAFF_DISCORD} الأوامر الإدارية | Moderation`)
      .setDescription(
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}timeout <@user> <دقائق> [سبب]\` ➔ تايم أوت\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}untimeout <@user>\` ➔ فك التايم أوت\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kick <@user> [سبب]\` ➔ طرد عضو\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}ban <@user> [سبب]\` ➔ حظر نهائي\n` +
        `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}clear <1-100>\` ➔ مسح رسائل الشات`
      );
  }
  if (category === 'owner') {
    return baseEmbed
      .setTitle(`${EMOJIS.PINK_VERIFIED} قسم المالك | Owner System`)
      .setDescription(
        `> 👑 **المالك المعتمد:** <@${OWNER_ID}>\n` +
        `> ✨ **حصانة شاملة:** استثناء تام للمالك من جميع التايم أوت والحماية.\n` +
        `> 🎬 **منشن المالك:** عند منشن المالك يتم الرد ببطاقة الـ GIF مباشرة.`
      );
  }
  return baseEmbed;
}

client.once('clientReady', () => {
  console.log(`===========================================`);
  console.log(` 🤖 Bot is online as: ${client.user.tag}`);
  console.log(` 👑 Owner ID set to: ${OWNER_ID}`);
  console.log(` ⚡ Command Prefix set to: ${PREFIX}`);
  console.log(` 🎬 Owner Mention GIF: ${GIF_URL}`);
  console.log(`===========================================`);

  client.user.setPresence({
    activities: [{
      name: `${PREFIX}help | Live Voice & Anime GIFs`,
      type: ActivityType.Streaming,
      url: 'https://www.twitch.tv/discord'
    }],
    status: 'online'
  });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId === 'help_select_menu') {
    const selectedCategory = interaction.values[0];
    const newEmbed = createHelpEmbed(selectedCategory, interaction.user, client);
    await interaction.update({ embeds: [newEmbed] });
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const config = getGuildConfig(message.guild.id);

  if (message.mentions.users.has(OWNER_ID) || message.content.includes(`<@${OWNER_ID}>`) || message.content.includes(`<@!${OWNER_ID}>`)) {
    try {
      const ownerEmbed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setDescription(`${EMOJIS.PINK_VERIFIED} **تاج الرأس والمالك | Bot Owner:** <@${OWNER_ID}>`)
        .setImage(GIF_URL);
      await message.reply({ embeds: [ownerEmbed] });
    } catch (err) {}
  }

  if (!isOwner) {
    const hasAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!hasAdmin) {
      let isViolation = false;
      let violationReason = "";
      if (config.antiLink && LINK_REGEX.test(message.content)) {
        isViolation = true;
        violationReason = "إرسال روابط (Anti-Link)";
      }
      if (!isViolation && config.antiImage) {
        const hasImageAttachment = message.attachments.some(att => {
          const mime = att.contentType || "";
          return mime.startsWith('image/') || IMAGE_EXT_REGEX.test(att.name || "");
        });
        if (hasImageAttachment || IMAGE_EXT_REGEX.test(message.content)) {
          isViolation = true;
          violationReason = "إرسال صور (Anti-Image)";
        }
      }
      if (!isViolation && config.antiFile) {
        const hasFileAttachment = message.attachments.some(att => {
          const mime = att.contentType || "";
          return !mime.startsWith('image/');
        });
        if (hasFileAttachment) {
          isViolation = true;
          violationReason = "إرسال ملفات (Anti-File)";
        }
      }
      if (isViolation) {
        try {
          if (message.deletable) await message.delete();
          if (message.member && message.member.moderatable) {
            await message.member.timeout(config.timeoutMinutes * 60 * 1000, `Protection: ${violationReason}`);
          }
          const warnEmbed = new EmbedBuilder()
            .setColor(0xFF1493)
            .setTitle(`${EMOJIS.SHINOBU_GUN} نظام الحماية | Auto Protection Alert`)
            .setDescription(`⚠️ **تم إعطاء تايم أوت تلقائي!**\n\nالعضو: <@${message.author.id}>\nالمدة: ${config.timeoutMinutes} دقائق\nالسبب: ${violationReason}`);
          const msg = await message.channel.send({ embeds: [warnEmbed] });
          setTimeout(() => msg.delete().catch(() => {}), 8000);
          return;
        } catch (err) {}
      }
    }
  }

  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const getTargetMember = () => message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.member;
  const getTargetUser = () => message.mentions.users.first() || client.users.cache.get(args[0]) || message.author;

  if (command === 'help' || command === 'مساعدة' || command === 'الأوامر') {
    const mainEmbed = createHelpEmbed('main', message.author, client);
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_select_menu')
      .setPlaceholder('🌸 اختر القائمة التي تريد عرضها | Select Category...')
      .addOptions([
        { label: 'الرئيسية | Main Overview', value: 'main', emoji: '🌸' },
        { label: 'أنظمة الحماية | Protection Suite', value: 'protection', emoji: '🛡️' },
        { label: 'ميزات الصور | Image Magic', value: 'images', emoji: '🎨' },
        { label: 'تفاعلات الأنمي | Anime Reactions', value: 'anime', emoji: '🎭' },
        { label: 'الروم الصوتي والصوت | Voice Join & Music', value: 'music', emoji: '🎤' },
        { label: 'سيرة البروفايل | Profile Bio Card', value: 'bio', emoji: '🌸' },
        { label: 'الأوامر الإدارية | Moderation', value: 'moderation', emoji: '🔨' },
        { label: 'معلومات المالك | Owner System', value: 'owner', emoji: '👑' }
      ]);
    return message.reply({ embeds: [mainEmbed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
  }

  // --- MUSIC COMMANDS ---
  if (['join', 'connect', 'play', 'stop', 'leave'].includes(command)) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply(`${EMOJIS.ANIME_SCREAM} **يجب أن تكون متصلاً بروم صوتي أولاً!**`);
    }

    if (command === 'join' || command === 'connect') {
      try {
        const connection = voicePkg.joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });
        voiceData.set(message.guild.id, { connection });
        return message.reply(`${EMOJIS.SUCCESS} تم الانضمام للروم الصوتي: <#${voiceChannel.id}>`);
      } catch (err) {
        return message.reply(`حدث خطأ: ${err.message}`);
      }
    }

    if (command === 'play') {
      let searchQuery = args.join(' ');
      if (!searchQuery) {
        return message.reply(`${EMOJIS.TOHRU_SMUG} يرجى إدخال اسم الأغنية أو رابط Spotify/YouTube.`);
      }

      const statusMsg = await message.reply(`${EMOJIS.REM_DANCE} 🎵 جاري البحث والتشغيل...`);

      try {
        let songTitle = searchQuery;
        let songArtist = '';
        let coverImage = client.user.displayAvatarURL();
        let youtubeUrl = null;

        // ── Step 1: Resolve Spotify URL → get title + artist ──
        if (searchQuery.includes('spotify.com')) {
          try {
            if (spotifyUrlInfo && spotifyUrlInfo.getPreview) {
              const preview = await spotifyUrlInfo.getPreview(searchQuery);
              if (preview && preview.title) {
                songTitle = preview.title;
                songArtist = preview.artist || '';
                if (preview.image) coverImage = preview.image;
              }
            }
          } catch (spErr) {
            console.log('Spotify resolve error:', spErr.message);
          }
          // Always search YouTube by text after Spotify resolve
          const spotifySearch = `${songTitle} ${songArtist}`.trim();
          try {
            const results = await playDl.search(spotifySearch, { source: { youtube: 'video' }, limit: 1 });
            if (results && results.length > 0) {
              const r = results[0];
              youtubeUrl = r.url || (r.id ? `https://www.youtube.com/watch?v=${r.id}` : null);
              if (youtubeUrl && !songArtist) songTitle = r.title || songTitle;
              if (youtubeUrl && (!coverImage || coverImage === client.user.displayAvatarURL())) {
                coverImage = r.thumbnails?.[0]?.url || coverImage;
              }
            }
          } catch (srchErr) {
            console.log('YouTube search error:', srchErr.message);
          }

        // ── Step 2: YouTube URL (including Shorts) ──
        } else if (searchQuery.includes('youtube.com') || searchQuery.includes('youtu.be')) {
          try {
            // Normalize Shorts URLs
            let cleanUrl = searchQuery;
            if (cleanUrl.includes('/shorts/')) {
              const videoId = cleanUrl.split('/shorts/')[1].split('?')[0];
              cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
            }
            const info = await playDl.video_basic_info(cleanUrl);
            youtubeUrl = cleanUrl;
            songTitle = info.video_details.title || searchQuery;
            coverImage = info.video_details.thumbnails?.[0]?.url || coverImage;
          } catch (ytErr) {
            console.log('YT info error:', ytErr.message);
            // Try to stream it directly even if info fails
            youtubeUrl = searchQuery;
          }

        // ── Step 3: Plain text search → YouTube ──
        } else {
          try {
            const results = await playDl.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
            if (results && results.length > 0) {
              const r = results[0];
              youtubeUrl = r.url || (r.id ? `https://www.youtube.com/watch?v=${r.id}` : null);
              if (youtubeUrl) {
                songTitle = r.title || songTitle;
                coverImage = r.thumbnails?.[0]?.url || coverImage;
              }
            }
          } catch (srchErr) {
            console.log('Text search error:', srchErr.message);
          }
        }

        // Strict URL check
        if (!youtubeUrl || youtubeUrl === 'undefined' || typeof youtubeUrl !== 'string') {
          return statusMsg.edit(`❌ لم يتم العثور على نتائج لـ: \`${searchQuery}\` — حاول بكتابة اسم الأغنية بشكل مختلف.`);
        }

        console.log('▶ Streaming via yt-dlp:', youtubeUrl);
        await ensureYtDlpBinary();

        // ── Step 4: Create stream using yt-dlp + ffmpeg ──
        // yt-dlp downloads audio and pipes to ffmpeg which encodes to opus
        const ytdlpProc = spawn(YTDLP_PATH, [
          '-f', 'bestaudio/best',
          '--ffmpeg-location', FFMPEG_PATH,
          '-o', '-',
          '--no-playlist',
          '-q',
          youtubeUrl
        ]);

        const ffmpegProc = spawn(FFMPEG_PATH, [
          '-i', 'pipe:0',
          '-analyzeduration', '0',
          '-loglevel', 'error',
          '-f', 'opus',
          '-ar', '48000',
          '-ac', '2',
          'pipe:1'
        ]);

        // Pipe yt-dlp output into ffmpeg
        ytdlpProc.stdout.pipe(ffmpegProc.stdin);
        ytdlpProc.stderr.on('data', d => {});
        ffmpegProc.stderr.on('data', d => console.log('[ffmpeg]', d.toString().trim()));

        ytdlpProc.on('error', err => console.log('yt-dlp spawn error:', err.message));
        ffmpegProc.on('error', err => console.log('ffmpeg spawn error:', err.message));

        // ── Step 5: Join voice channel ──
        const connection = voicePkg.joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });

        // ── Step 6: Create audio resource from ffmpeg stdout ──
        const resource = voicePkg.createAudioResource(ffmpegProc.stdout, {
          inputType: voicePkg.StreamType.OggOpus,
          inlineVolume: true
        });

        if (resource.volume) resource.volume.setVolume(1.0);

        const player = voicePkg.createAudioPlayer({
          behaviors: { noSubscriber: voicePkg.NoSubscriberBehavior.Play }
        });

        player.play(resource);
        connection.subscribe(player);

        voiceData.set(message.guild.id, { connection, player, ytdlpProc, ffmpegProc });

        player.on(voicePkg.AudioPlayerStatus.Idle, () => {
          try { ytdlpProc.kill(); } catch(e) {}
          try { ffmpegProc.kill(); } catch(e) {}
          connection.destroy();
          voiceData.delete(message.guild.id);
        });
        player.on('error', err => console.log('Player error:', err.message));
        connection.on('error', err => console.log('Connection error:', err.message));

        // ── Step 7: Success embed ──
        const displayTitle = songArtist ? `${songTitle} — ${songArtist}` : songTitle;
        const playEmbed = new EmbedBuilder()
          .setColor(0xFF1493)
          .setTitle(`🎤 يتم الآن البث | Now Streaming`)
          .setDescription(`> 🎵 **${displayTitle}**\n> 🔊 **الروم:** <#${voiceChannel.id}>\n> 👤 **بواسطة:** <@${message.author.id}>`)
          .setThumbnail(coverImage)
          .setFooter({ text: 'Powered by yt-dlp + FFmpeg 🎧' });

        return statusMsg.edit({ content: null, embeds: [playEmbed] });
      } catch (err) {
        console.error('Play command error:', err);
        return statusMsg.edit(`❌ حدث خطأ: ${err.message || 'خطأ غير معروف'}`);
      }
    }

    if (['stop', 'leave'].includes(command)) {
      const data = voiceData.get(message.guild.id);
      if (data) {
        if (data.player) data.player.stop();
        try { if (data.ytdlpProc) data.ytdlpProc.kill(); } catch(e) {}
        try { if (data.ffmpegProc) data.ffmpegProc.kill(); } catch(e) {}
        if (data.connection) data.connection.destroy();
        voiceData.delete(message.guild.id);
        return message.reply(`${EMOJIS.SUCCESS} تم إيقاف الصوت ومغادرة الروم الصوتي.`);
      }
      return message.reply(`البوت غير متصل حالياً!`);
    }
  }

  // --- PROFILE BIO CARD ---
  if (['bio', 'profile'].includes(command)) {
    const member = getTargetMember();
    const user = member.user;
    const isTargetOwner = user.id === OWNER_ID;
    const rolesList = member.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).slice(0, 8).join(' ') || 'عضو عادي';
    const createdTime = Math.floor(user.createdTimestamp / 1000);
    const joinedTime = Math.floor(member.joinedTimestamp / 1000);

    const bioEmbed = new EmbedBuilder()
      .setColor(isTargetOwner ? 0xFFD700 : 0xFF69B4)
      .setTitle(`${EMOJIS.PINK_VERIFIED} Profile Bio Card`)
      .setDescription(`### ${user.username} ${isTargetOwner ? '👑' : ''}\n> **السيرة:** ${isTargetOwner ? 'تاج الرأس ومالك البوت الرسمي.' : 'عضو مميز في السيرفر.'}`)
      .addFields(
        { name: 'الرتب', value: rolesList },
        { name: 'تاريخ الإنشاء', value: `<t:${createdTime}:D> (<t:${createdTime}:R>)`, inline: true },
        { name: 'الانضمام', value: `<t:${joinedTime}:D> (<t:${joinedTime}:R>)`, inline: true }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true }));
    return message.reply({ embeds: [bioEmbed] });
  }

  // --- ANIME ACTIONS (35+ Commands) ---
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

    // Solo commands (emotion / no target needed)
    const SOLO = ['waifu','neko','dance','cry','blush','happy','sleep','bored',
      'think','facepalm','clap','shrug','confused','nervous','triggered','run','thumbsup'];

    if (SOLO.includes(command)) {
      const soloMsgs = {
        dance:     `💃 **${message.author.username}** يرقص بسعادة!`,
        cry:       `😢 **${message.author.username}** يبكي بحرقة...`,
        blush:     `😳 **${message.author.username}** يحمر خجلاً!`,
        happy:     `😊 **${message.author.username}** سعيد جداً!`,
        sleep:     `😴 **${message.author.username}** نايم... لا تصحيه!`,
        bored:     `😑 **${message.author.username}** يشعر بالملل...`,
        think:     `🤔 **${message.author.username}** يفكر...`,
        facepalm:  `🤦 **${message.author.username}** يضرب وجهه بيده!`,
        clap:      `👏 **${message.author.username}** يصفّق!`,
        shrug:     `🤷 **${message.author.username}** مش عارف!`,
        confused:  `😕 **${message.author.username}** محتار!`,
        nervous:   `😰 **${message.author.username}** متوتر!`,
        triggered: `😤 **${message.author.username}** فقد أعصابه!!!`,
        run:       `🏃 **${message.author.username}** يجري!`,
        thumbsup:  `👍 **${message.author.username}** يعطي إبهاماً للأعلى!`,
        waifu:     `🌸 وايفو خاصة بـ **${message.author.username}**`,
        neko:      `🐱 نيكو لـ **${message.author.username}**`,
      };
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setColor(0xFF1493)
          .setDescription(soloMsgs[command] || `**${message.author.username}** ${command}`)
          .setImage(gifUrl)
      ]});
    }

    // Targeted commands
    const targetMsgs = {
      hug:       isSelf ? `🤗 **${message.author.username}** يعانق نفسه!` : `🤗 **${message.author.username}** يعانق <@${targetUser.id}>!`,
      kiss:      `💋 **${message.author.username}** يقبّل <@${targetUser.id}>!`,
      pat:       `✋ **${message.author.username}** يربّت على رأس <@${targetUser.id}>!`,
      slap:      `👋 **${message.author.username}** يصفع <@${targetUser.id}>!`,
      cuddle:    `🥰 **${message.author.username}** يحتضن <@${targetUser.id}>!`,
      poke:      `👉 **${message.author.username}** يوخز <@${targetUser.id}>!`,
      punch:     `👊 **${message.author.username}** يلكم <@${targetUser.id}>!`,
      bite:      `😬 **${message.author.username}** يعض <@${targetUser.id}>!`,
      lick:      `👅 **${message.author.username}** يلحس <@${targetUser.id}>!`,
      highfive:  `🙌 **${message.author.username}** يعطي هاي فايف لـ <@${targetUser.id}>!`,
      wave:      `👋 **${message.author.username}** يلوّح لـ <@${targetUser.id}>!`,
      bonk:      `🔨 **${message.author.username}** يضرب <@${targetUser.id}> على رأسه!`,
      kill:      `💀 **${message.author.username}** يطلق النار على <@${targetUser.id}>!`,
      shoot:     `🔫 **${message.author.username}** يصوّب على <@${targetUser.id}>!`,
      nom:       `🍪 **${message.author.username}** يأكل <@${targetUser.id}>!`,
      kick:      `🦵 **${message.author.username}** يركل <@${targetUser.id}>!`,
      feed:      `🍱 **${message.author.username}** يطعم <@${targetUser.id}>!`,
      wink:      `😉 **${message.author.username}** يغمز لـ <@${targetUser.id}>!`,
      smug:      `😏 **${message.author.username}** يبتسم بسخرية لـ <@${targetUser.id}>!`,
      peek:      `👀 **${message.author.username}** يتلصص على <@${targetUser.id}>!`,
    };
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(0xFF1493)
        .setDescription(targetMsgs[command] || `**${message.author.username}** ${command} <@${targetUser.id}>`)
        .setImage(gifUrl)
    ]});
  }

  // --- BOTINFO & OTHER ---
  if (command === 'botinfo') {
    const botInfoEmbed = new EmbedBuilder()
      .setColor(0xFF1493)
      .setTitle(`معلومات البوت`)
      .setDescription(`المالك: <@${OWNER_ID}>\nالسرعة: \`${client.ws.ping}ms\`\nالتشغيل: \`${getUptimeString()}\``);
    return message.reply({ embeds: [botInfoEmbed] });
  }

  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) && !isOwner) return;
    const amount = parseInt(args[0]) || 10;
    await message.channel.bulkDelete(Math.min(amount + 1, 100), true);
  }
});

const token = process.env.DISCORD_TOKEN;
client.login(token).catch(err => console.error('Failed to login:', err));
