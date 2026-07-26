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

// ══════════════════════════════════════════
// ── ffmpeg path ──
// ══════════════════════════════════════════
const FFMPEG_PATH = (() => {
  try { return require('ffmpeg-static'); } catch(e) { return 'ffmpeg'; }
})();
console.log('🎬 FFMPEG:', FFMPEG_PATH);

// ══════════════════════════════════════════
// ── yt-dlp: find or download binary ──
// ══════════════════════════════════════════
const YTDLP_BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
let YTDLP_PATH = null; // will be set in ensureYtDlp()

/**
 * Finds or downloads yt-dlp binary.
 * Checks multiple locations to avoid ENOENT errors.
 */
async function ensureYtDlp() {
  if (YTDLP_PATH) return YTDLP_PATH; // already resolved

  // Priority 1: local binary next to index.js
  const localPath = path.join(__dirname, YTDLP_BINARY_NAME);
  if (fs.existsSync(localPath)) {
    YTDLP_PATH = localPath;
    console.log('✅ yt-dlp found (local):', YTDLP_PATH);
    return YTDLP_PATH;
  }

  // Priority 2: common system paths (Linux/Railway)
  const systemPaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.cwd(), YTDLP_BINARY_NAME)
  ];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) {
      YTDLP_PATH = p;
      console.log('✅ yt-dlp found (system):', YTDLP_PATH);
      return YTDLP_PATH;
    }
  }

  // Priority 3: download from GitHub
  try {
    console.log(`📦 Downloading yt-dlp binary for ${process.platform}...`);
    const YTDlpWrap = require('yt-dlp-wrap').default;
    await YTDlpWrap.downloadFromGithub(localPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(localPath, 0o755);
    }
    YTDLP_PATH = localPath;
    console.log('✅ yt-dlp downloaded:', YTDLP_PATH);
    return YTDLP_PATH;
  } catch (err) {
    console.log('⚠️ yt-dlp download failed:', err.message);
  }

  // Priority 4: hope it's in PATH
  YTDLP_PATH = 'yt-dlp';
  console.log('⚠️ Using system yt-dlp from PATH');
  return YTDLP_PATH;
}

// ══════════════════════════════════════════
// ── Audio stream via yt-dlp + ffmpeg ──
// Bypasses YouTube bot-detection (no play-dl for stream)
// ══════════════════════════════════════════
function createYtDlpStream(youtubeUrl) {
  const ytdlpArgs = [
    '--no-playlist',
    '-q',
    '--no-warnings',
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '-o', '-',
    youtubeUrl
  ];
  if (FFMPEG_PATH && FFMPEG_PATH !== 'ffmpeg') {
    // Pass ffmpeg directory so yt-dlp can use it for merging if needed
    ytdlpArgs.unshift('--ffmpeg-location', path.dirname(FFMPEG_PATH));
  }

  const ytdlpProc = spawn(YTDLP_PATH, ytdlpArgs);

  // ffmpeg converts raw audio → PCM s16le 48kHz stereo
  const ffmpegArgs = [
    '-i', 'pipe:0',
    '-analyzeduration', '0',
    '-loglevel', 'quiet',
    '-f', 's16le',     // PCM 16-bit little endian
    '-ar', '48000',    // 48kHz (Discord requires)
    '-ac', '2',        // stereo
    'pipe:1'
  ];
  const ffmpegProc = spawn(FFMPEG_PATH, ffmpegArgs);

  // Pipe yt-dlp output → ffmpeg input
  ytdlpProc.stdout.pipe(ffmpegProc.stdin);

  ytdlpProc.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.log('[yt-dlp]', msg);
  });
  ffmpegProc.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.log('[ffmpeg]', msg);
  });
  ytdlpProc.on('error', e => console.log('[yt-dlp error]', e.message));
  ffmpegProc.on('error', e => console.log('[ffmpeg error]', e.message));

  // When yt-dlp ends, close ffmpeg stdin
  ytdlpProc.on('close', code => {
    if (code !== 0) console.log('[yt-dlp] exited with code', code);
    try { ffmpegProc.stdin.end(); } catch(e) {}
  });

  return { ytdlpProc, ffmpegProc, audioStream: ffmpegProc.stdout };
}

// ══════════════════════════════════════════
// ── Video download (YouTube/Instagram/etc) ──
// ══════════════════════════════════════════
function downloadVideo(url, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '-q',
      '--no-warnings',
      '-o', outputPath,
      url
    ];
    if (FFMPEG_PATH && FFMPEG_PATH !== 'ffmpeg') {
      args.unshift('--ffmpeg-location', path.dirname(FFMPEG_PATH));
    }
    const proc = spawn(YTDLP_PATH, args);
    let errOut = '';
    proc.stderr.on('data', d => { errOut += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(errOut.slice(0, 300) || `yt-dlp exit ${code}`));
    });
    proc.on('error', e => reject(new Error(`spawn yt-dlp: ${e.message} — binary: ${YTDLP_PATH}`)));
  });
}

// ══════════════════════════════════════════
// ── Voice & play-dl (for search ONLY) ──
// ══════════════════════════════════════════
let voicePkg, playDl, spotifyUrlInfo;
try {
  voicePkg = require('@discordjs/voice');
  playDl = require('play-dl');
  spotifyUrlInfo = require('spotify-url-info')(fetch);
} catch (e) { console.log('Package error:', e.message); }

// ── Canvas ──
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

// ── Anime GIF Engine ──
const ANIME_GIF_FALLBACKS = {
  hug:       ['https://cdn.otakugifs.xyz/gifs/hug/df0840a507aa481a.gif','https://cdn.otakugifs.xyz/gifs/hug/6d915e537c818fa9.gif'],
  kiss:      ['https://cdn.otakugifs.xyz/gifs/kiss/e8620e4b5d4907df.gif'],
  pat:       ['https://cdn.otakugifs.xyz/gifs/pat/13ec930fd42770f6.gif'],
  slap:      ['https://cdn.otakugifs.xyz/gifs/slap/728770007827600b.gif'],
  cuddle:    ['https://cdn.otakugifs.xyz/gifs/cuddle/7dca23f6128a1897.gif'],
  dance:     ['https://cdn.otakugifs.xyz/gifs/dance/0fd2b6003eb5dad1.gif'],
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
    .setAuthor({ name: `${client.user.username} Suite`, iconURL: client.user.displayAvatarURL() })
    .setFooter({ text: `طُلب بواسطة: ${user.tag} • المالك: ${OWNER_ID}`, iconURL: user.displayAvatarURL() })
    .setTimestamp();

  if (category === 'main') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} ${EMOJIS.REM_DANCE} لوحة التحكم الرئيسية | System Control`)
    .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} **مرحباً بك في البوت الشامل للحماية والتفاعل وصوت البث!**\n\n` +
      `> ⚡ **البادئة:** \`${PREFIX}\`\n> 👑 **المالك:** <@${OWNER_ID}>\n> 📺 **الحالة:** \`Stream Mode 24/7\`\n\n` +
      `🌸 **يرجى اختيار القسم المطلوب من القائمة المنسدلة أدناه:**`
    );
  if (category === 'protection') return base
    .setTitle(`${EMOJIS.SHINOBU_GUN} أنظمة الحماية | Protection`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antilink <on/off>\` ➔ حماية الروابط\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antiimage <on/off>\` ➔ حماية الصور\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antifile <on/off>\` ➔ حماية الملفات`
    );
  if (category === 'images') return base
    .setTitle(`${EMOJIS.SHARK_HUG} تأثيرات الصور | Image Magic`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}avatar [@user]\` ➔ عرض الافتار\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}banner [@user]\` ➔ عرض البنر\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}wanted [@user]\` ➔ ملصق مطلوب`
    );
  if (category === 'anime') return base
    .setTitle(`${EMOJIS.REM_DANCE} تفاعلات الأنمي | Anime Actions`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}hug/kiss/pat/slap/cuddle/poke/punch\` ➔ تفاعلات مع @عضو\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}dance/cry/blush/happy/sleep/waifu\` ➔ تفاعلات شخصية`
    );
  if (category === 'music') return base
    .setTitle(`🎤 الروم الصوتي | Voice & Music`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}join\` ➔ الانضمام للروم الصوتي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}play <اسم / رابط YouTube / Spotify>\` ➔ تشغيل الأغاني\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}stop\` / \`${PREFIX}leave\` ➔ إيقاف ومغادرة\n\n` +
      `> 🎵 **مدعوم:** YouTube · Spotify · YouTube Shorts`
    );
  if (category === 'download') return base
    .setTitle(`📥 تحميل الفيديوهات | Video Downloader`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}download <رابط>\`\n\n` +
      `> 🎬 **YouTube** — فيديوهات عادية وShortsI\n` +
      `> 📸 **Instagram** — ريلز، بوستات\n` +
      `> 🎵 **TikTok** — فيديوهات TikTok\n` +
      `> 🐦 **Twitter/X** — فيديوهات تويتر\n\n` +
      `> ⚠️ الملفات أكبر من **${MAX_UPLOAD_MB}MB** لن يتم رفعها مباشرة.`
    );
  if (category === 'bio') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} سيرة البروفايل | Profile Bio`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}bio [@user]\` ➔ بطاقة البروفايل\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}botinfo\` ➔ معلومات البوت`
    );
  if (category === 'moderation') return base
    .setTitle(`${EMOJIS.STAFF_DISCORD} الأوامر الإدارية | Moderation`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}timeout <@user> <دقائق>\` ➔ تايم أوت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kick/ban <@user>\` ➔ طرد / حظر\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}clear <1-100>\` ➔ مسح رسائل`
    );
  if (category === 'owner') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} قسم المالك | Owner System`)
    .setDescription(`> 👑 **المالك:** <@${OWNER_ID}>\n> ✨ حصانة شاملة من جميع القيود.`);
  return base;
}

// ══════════════════════════════════════════
// ── BOT READY ──
// ══════════════════════════════════════════
client.once('clientReady', async () => {
  console.log(`===========================================`);
  console.log(` 🤖 Bot: ${client.user.tag}`);
  console.log(` 👑 Owner: ${OWNER_ID} | Prefix: ${PREFIX}`);
  console.log(`===========================================`);

  // Pre-load yt-dlp binary on startup
  await ensureYtDlp();
  console.log('🎧 yt-dlp binary path:', YTDLP_PATH);

  client.user.setPresence({
    activities: [{ name: `${PREFIX}help | Voice & Download 📥`, type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' }],
    status: 'online'
  });
});

// ── Help select menu ──
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId === 'help_select_menu') {
    await interaction.update({ embeds: [createHelpEmbed(interaction.values[0], interaction.user, client)] });
  }
});

// ══════════════════════════════════════════
// ── MESSAGE HANDLER ──
// ══════════════════════════════════════════
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const config = getGuildConfig(message.guild.id);

  // Owner mention reply
  if (message.mentions.users.has(OWNER_ID) || message.content.includes(`<@${OWNER_ID}>`) || message.content.includes(`<@!${OWNER_ID}>`)) {
    try { await message.reply({ embeds: [new EmbedBuilder().setColor(0xFF69B4).setDescription(`${EMOJIS.PINK_VERIFIED} **تاج الرأس والمالك | Bot Owner:** <@${OWNER_ID}>`).setImage(GIF_URL)] }); } catch(e) {}
  }

  // Anti-spam protection
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
          const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xFF1493).setTitle(`${EMOJIS.SHINOBU_GUN} نظام الحماية`).setDescription(`⚠️ تايم أوت تلقائي!\nالعضو: <@${message.author.id}>\nالمدة: ${config.timeoutMinutes} دقائق\nالسبب: ${reason}`)] });
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

  // ── HELP ──
  if (['help', 'مساعدة', 'الأوامر'].includes(command)) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_select_menu')
      .setPlaceholder('🌸 اختر القائمة | Select Category...')
      .addOptions([
        { label: 'الرئيسية | Main', value: 'main', emoji: '🌸' },
        { label: 'الحماية | Protection', value: 'protection', emoji: '🛡️' },
        { label: 'الصور | Image Magic', value: 'images', emoji: '🎨' },
        { label: 'الأنمي | Anime', value: 'anime', emoji: '🎭' },
        { label: 'الصوت | Voice & Music', value: 'music', emoji: '🎤' },
        { label: '📥 تحميل فيديوهات | Downloader', value: 'download', emoji: '📥' },
        { label: 'البروفايل | Profile', value: 'bio', emoji: '🌸' },
        { label: 'الإدارة | Moderation', value: 'moderation', emoji: '🔨' },
        { label: 'المالك | Owner', value: 'owner', emoji: '👑' }
      ]);
    return message.reply({ embeds: [createHelpEmbed('main', message.author, client)], components: [new ActionRowBuilder().addComponents(selectMenu)] });
  }

  // ══════════════════════════════════════════
  // ── 📥 DOWNLOAD COMMAND ──
  // ══════════════════════════════════════════
  if (['download', 'dl', 'تحميل'].includes(command)) {
    const url = args[0];
    if (!url || !url.startsWith('http')) {
      return message.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFF1493).setTitle('📥 تحميل فيديوهات')
        .setDescription(`**الاستخدام:** \`${PREFIX}download <رابط>\`\n\n**يدعم:** YouTube · Instagram · TikTok · Twitter\n\n**مثال:**\n\`${PREFIX}download https://www.youtube.com/watch?v=xxx\`\n\`${PREFIX}download https://www.instagram.com/reel/xxx\``)
      ]});
    }

    await ensureYtDlp();
    const statusMsg = await message.reply(`${EMOJIS.REM_DANCE} ⏬ جاري تحميل الفيديو...`);

    let platform = '🌐';
    if (url.includes('youtube.com') || url.includes('youtu.be')) platform = '🎬 YouTube';
    else if (url.includes('instagram.com')) platform = '📸 Instagram';
    else if (url.includes('tiktok.com')) platform = '🎵 TikTok';
    else if (url.includes('twitter.com') || url.includes('x.com')) platform = '🐦 Twitter/X';

    const tmpFile = path.join(os.tmpdir(), `discord_dl_${Date.now()}.mp4`);
    try {
      await downloadVideo(url, tmpFile);
      if (!fs.existsSync(tmpFile)) return statusMsg.edit(`❌ فشل التحميل — الملف لم يُنشأ.`);

      const fileSizeMB = fs.statSync(tmpFile).size / (1024 * 1024);
      if (fileSizeMB > MAX_UPLOAD_MB) {
        fs.unlinkSync(tmpFile);
        return statusMsg.edit({ content: null, embeds: [new EmbedBuilder()
          .setColor(0xFF6600).setTitle('⚠️ الملف كبير جداً')
          .setDescription(`حجم الفيديو **${fileSizeMB.toFixed(1)}MB** أكبر من الحد (${MAX_UPLOAD_MB}MB).\n\n**📥 [افتح الرابط مباشرة](${url})**`)]});
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF1493).setTitle('✅ تم التحميل بنجاح!')
        .setDescription(`> 📌 **المنصة:** ${platform}\n> 📦 **الحجم:** ${fileSizeMB.toFixed(2)} MB\n> 👤 **بواسطة:** <@${message.author.id}>`)
        .setFooter({ text: 'Powered by yt-dlp 📥' });

      await statusMsg.edit({ content: null, embeds: [embed], files: [new AttachmentBuilder(tmpFile, { name: 'video.mp4' })] });
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch(e) {} }, 15000);
    } catch (err) {
      console.error('[download error]', err.message);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      return statusMsg.edit({ content: null, embeds: [new EmbedBuilder()
        .setColor(0xFF0000).setTitle('❌ فشل التحميل')
        .setDescription(`**السبب:** ${err.message?.slice(0, 300) || 'خطأ'}\n\n> تأكد أن الرابط صحيح وأن الحساب عام`)]});
    }
    return;
  }

  // ══════════════════════════════════════════
  // ── VOICE / MUSIC COMMANDS ──
  // ══════════════════════════════════════════
  if (['join', 'connect', 'play', 'stop', 'leave'].includes(command)) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply(`${EMOJIS.ANIME_SCREAM} **يجب أن تكون في روم صوتي أولاً!**`);

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
        return message.reply(`${EMOJIS.SUCCESS} انضممت إلى <#${voiceChannel.id}>`);
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
        return message.reply(`${EMOJIS.SUCCESS} تم الإيقاف والمغادرة.`);
      }
      const conn = voicePkg.getVoiceConnection(message.guild.id);
      if (conn) { conn.destroy(); return message.reply(`${EMOJIS.SUCCESS} تم المغادرة.`); }
      return message.reply(`البوت غير متصل!`);
    }

    // ── PLAY ──
    if (command === 'play') {
      let searchQuery = args.join(' ');
      if (!searchQuery) return message.reply(`${EMOJIS.TOHRU_SMUG} اكتب اسم الأغنية أو رابط.`);

      const statusMsg = await message.reply(`${EMOJIS.REM_DANCE} 🎵 جاري البحث والتشغيل...`);

      try {
        // ── Ensure yt-dlp is ready ──
        await ensureYtDlp();
        if (!YTDLP_PATH) return statusMsg.edit('❌ yt-dlp غير متوفر على الخادم.');

        let songTitle = searchQuery;
        let songArtist = '';
        let coverImage = client.user.displayAvatarURL();
        let youtubeUrl = null;

        // ── Resolve to YouTube URL ──
        if (searchQuery.includes('spotify.com')) {
          try {
            const preview = await spotifyUrlInfo?.getPreview(searchQuery);
            if (preview?.title) { songTitle = preview.title; songArtist = preview.artist || ''; if (preview.image) coverImage = preview.image; }
          } catch(e) {}
          try {
            const results = await playDl.search(`${songTitle} ${songArtist}`.trim(), { source: { youtube: 'video' }, limit: 1 });
            if (results?.length) { youtubeUrl = results[0].url; coverImage = results[0].thumbnails?.[0]?.url || coverImage; }
          } catch(e) {}

        } else if (searchQuery.includes('youtube.com') || searchQuery.includes('youtu.be')) {
          let cleanUrl = searchQuery;
          if (cleanUrl.includes('/shorts/')) {
            const vid = cleanUrl.split('/shorts/')[1].split('?')[0];
            cleanUrl = `https://www.youtube.com/watch?v=${vid}`;
          }
          youtubeUrl = cleanUrl;
          // Get title via yt-dlp (not play-dl, to avoid bot-detection)
          try {
            const results = await playDl.search(cleanUrl, { source: { youtube: 'video' }, limit: 1 });
            if (results?.length) { songTitle = results[0].title || songTitle; coverImage = results[0].thumbnails?.[0]?.url || coverImage; }
          } catch(e) {}

        } else {
          // Text search
          try {
            const results = await playDl.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
            if (results?.length) {
              const r = results[0];
              youtubeUrl = r.url;
              songTitle = r.title || songTitle;
              coverImage = r.thumbnails?.[0]?.url || coverImage;
            }
          } catch(e) {}
        }

        if (!youtubeUrl) return statusMsg.edit(`❌ لم يُعثر على نتائج لـ: \`${searchQuery}\``);

        console.log('▶ yt-dlp stream:', youtubeUrl);

        // ── Stop existing playback ──
        const existingData = voiceData.get(message.guild.id);
        if (existingData) {
          try { if (existingData.player) existingData.player.stop(true); } catch(e) {}
          try { if (existingData.ytdlpProc) existingData.ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { if (existingData.ffmpegProc) existingData.ffmpegProc.kill('SIGKILL'); } catch(e) {}
        }

        // ── Create audio stream via yt-dlp → ffmpeg (PCM) ──
        const { ytdlpProc, ffmpegProc, audioStream } = createYtDlpStream(youtubeUrl);

        // ── Voice connection ──
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
          ytdlpProc.kill('SIGKILL');
          ffmpegProc.kill('SIGKILL');
          return statusMsg.edit(`❌ فشل الاتصال بالروم الصوتي. حاول مجدداً.`);
        }

        // ── Audio resource (Raw PCM s16le) ──
        const resource = voicePkg.createAudioResource(audioStream, {
          inputType: voicePkg.StreamType.Raw,
          inlineVolume: true
        });
        if (resource.volume) resource.volume.setVolume(1.0);

        // ── Player ──
        const player = voicePkg.createAudioPlayer({
          behaviors: { noSubscriber: voicePkg.NoSubscriberBehavior.Play }
        });
        connection.subscribe(player);
        player.play(resource);

        voiceData.set(message.guild.id, { connection, player, ytdlpProc, ffmpegProc });

        // ── Track state (no auto-disconnect) ──
        let hasPlayed = false;
        player.on('stateChange', (oldState, newState) => {
          console.log(`🎵 ${oldState.status} → ${newState.status}`);
          if (newState.status === voicePkg.AudioPlayerStatus.Playing) hasPlayed = true;
          if (hasPlayed && newState.status === voicePkg.AudioPlayerStatus.Idle) {
            try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
            try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
            const d = voiceData.get(message.guild.id);
            if (d) voiceData.set(message.guild.id, { connection: d.connection });
            console.log('✅ Song finished, staying in voice.');
          }
        });
        player.on('error', err => {
          console.log('[Player error]', err.message);
          try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
        });

        // ── Success embed ──
        const displayTitle = songArtist ? `${songTitle} — ${songArtist}` : songTitle;
        const downloadBtn = new ButtonBuilder()
          .setLabel('📥 تحميل / Download').setStyle(ButtonStyle.Link).setURL(youtubeUrl);

        return statusMsg.edit({
          content: null,
          embeds: [new EmbedBuilder()
            .setColor(0xFF1493)
            .setTitle(`🎤 يتم الآن البث | Now Streaming`)
            .setDescription(
              `> 🎵 **${displayTitle}**\n` +
              `> 🔊 **الروم:** <#${voiceChannel.id}>\n` +
              `> 👤 **بواسطة:** <@${message.author.id}>\n\n` +
              `> 💡 اضغط **📥 تحميل** لتحميل الأغنية!`
            )
            .setThumbnail(coverImage)
            .setFooter({ text: 'Powered by yt-dlp + FFmpeg 🎧' })],
          components: [new ActionRowBuilder().addComponents(downloadBtn)]
        });

      } catch (err) {
        console.error('[play error]', err);
        return statusMsg.edit(`❌ حدث خطأ: ${err.message || 'خطأ غير معروف'}`);
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
        { name: 'الإنشاء', value: `<t:${Math.floor(user.createdTimestamp/1000)}:D>`, inline: true },
        { name: 'الانضمام', value: `<t:${Math.floor(member.joinedTimestamp/1000)}:D>`, inline: true }
      ).setThumbnail(user.displayAvatarURL({ dynamic: true }))] });
  }

  // ── ANIME COMMANDS ──
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
        dance: `💃 **${message.author.username}** يرقص!`, cry: `😢 **${message.author.username}** يبكي...`,
        blush: `😳 **${message.author.username}** يحمر خجلاً!`, happy: `😊 **${message.author.username}** سعيد!`,
        sleep: `😴 **${message.author.username}** نايم!`, bored: `😑 **${message.author.username}** يشعر بالملل...`,
        think: `🤔 **${message.author.username}** يفكر...`, facepalm: `🤦 **${message.author.username}**!`,
        clap: `👏 **${message.author.username}** يصفّق!`, shrug: `🤷 **${message.author.username}** مش عارف!`,
        confused: `😕 **${message.author.username}** محتار!`, nervous: `😰 **${message.author.username}** متوتر!`,
        triggered: `😤 **${message.author.username}** فقد أعصابه!!!`, run: `🏃 **${message.author.username}** يجري!`,
        thumbsup: `👍 **${message.author.username}**!`,
        waifu: `🌸 وايفو بـ **${message.author.username}**`, neko: `🐱 نيكو لـ **${message.author.username}**`,
      };
      return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF1493).setDescription(msgs[command] || `**${message.author.username}** ${command}`).setImage(gifUrl)] });
    }

    const tMsgs = {
      hug: isSelf ? `🤗 **${message.author.username}** يعانق نفسه!` : `🤗 **${message.author.username}** يعانق <@${targetUser.id}>!`,
      kiss: `💋 **${message.author.username}** يقبّل <@${targetUser.id}>!`,
      pat: `✋ **${message.author.username}** يربّت على رأس <@${targetUser.id}>!`,
      slap: `👋 **${message.author.username}** يصفع <@${targetUser.id}>!`,
      cuddle: `🥰 **${message.author.username}** يحتضن <@${targetUser.id}>!`,
      poke: `👉 **${message.author.username}** يوخز <@${targetUser.id}>!`,
      punch: `👊 **${message.author.username}** يلكم <@${targetUser.id}>!`,
      bite: `😬 **${message.author.username}** يعض <@${targetUser.id}>!`,
      lick: `👅 **${message.author.username}** يلحس <@${targetUser.id}>!`,
      highfive: `🙌 **${message.author.username}** هاي فايف لـ <@${targetUser.id}>!`,
      wave: `👋 **${message.author.username}** يلوّح لـ <@${targetUser.id}>!`,
      bonk: `🔨 **${message.author.username}** يضرب <@${targetUser.id}>!`,
      kill: `💀 **${message.author.username}** يطلق النار على <@${targetUser.id}>!`,
      shoot: `🔫 **${message.author.username}** يصوّب على <@${targetUser.id}>!`,
      nom: `🍪 **${message.author.username}** يأكل <@${targetUser.id}>!`,
      kick: `🦵 **${message.author.username}** يركل <@${targetUser.id}>!`,
      feed: `🍱 **${message.author.username}** يطعم <@${targetUser.id}>!`,
      wink: `😉 **${message.author.username}** يغمز لـ <@${targetUser.id}>!`,
      smug: `😏 **${message.author.username}** يبتسم لـ <@${targetUser.id}>!`,
      peek: `👀 **${message.author.username}** يتلصص على <@${targetUser.id}>!`,
    };
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF1493).setDescription(tMsgs[command] || `**${message.author.username}** ${command} <@${targetUser.id}>`).setImage(gifUrl)] });
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
  }
});

// ── Login ──
const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ DISCORD_TOKEN missing!'); process.exit(1); }
client.login(token).catch(err => console.error('❌ Login failed:', err));
