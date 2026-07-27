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
// ── Audio Stream via yt-dlp + ffmpeg ──
// Bypasses YouTube bot checks without relying on play-dl
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

  const ffmpegArgs = [
    '-i', 'pipe:0',
    '-analyzeduration', '0',
    '-loglevel', 'quiet',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
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
// ── Video Downloader (YouTube, Instagram, TikTok, etc.) ──
// ══════════════════════════════════════════
async function downloadVideo(url, outputPath) {
  const binaryPath = await ensureYtDlp();
  return new Promise((resolve, reject) => {
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
      if (code === 0) resolve();
      else reject(new Error(errOut.slice(0, 300) || `yt-dlp exited with code ${code}`));
    });
    proc.on('error', e => reject(new Error(`Failed to run yt-dlp binary (${binaryPath}): ${e.message}`)));
  });
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
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}hug / kiss / pat / slap / cuddle / poke / punch\`\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}dance / cry / blush / happy / sleep / waifu\``
    );
  if (category === 'music') return base
    .setTitle(`🎤 الروم الصوتي والموسيقى | Voice Channel`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}join\` ➔ الانضمام للروم الصوتي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}play <اسم أغنية / رابط YouTube / Spotify>\` ➔ تشغيل البث الصوتي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}stop\` / \`${PREFIX}leave\` ➔ إيقاف ومغادرة الروم`
    );
  if (category === 'download') return base
    .setTitle(`📥 تحميل الفيديوهات | Media Downloader`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}download <رابط>\` أو \`${PREFIX}dl <رابط>\`\n\n` +
      `> 🎬 **YouTube** (فيديوهات وShorts)\n` +
      `> 📸 **Instagram** (ريلز، بوستات)\n` +
      `> 🎵 **TikTok**\n` +
      `> 🐦 **Twitter/X**`
    );
  if (category === 'bio') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} سيرة البروفايل | Profile Bio`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}bio [@user]\` ➔ بطاقة البروفايل\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}botinfo\` ➔ معلومات البوت الرسمية`
    );
  if (category === 'moderation') return base
    .setTitle(`${EMOJIS.STAFF_DISCORD} الأوامر الإدارية | Moderation`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}timeout <@user> <دقائق>\` ➔ تايم أوت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kick / ban <@user>\` ➔ طرد أو حظر\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}clear <1-100>\` ➔ مسح الرسائل`
    );
  if (category === 'owner') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} قسم المالك | Owner System`)
    .setDescription(`> 👑 **المالك الرسمية:** <@${OWNER_ID}>\n> ✨ حصانة كاملة واستجابة خاصة عند المنشن.`);
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
    activities: [{ name: `${PREFIX}help | Music & Download 📥`, type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' }],
    status: 'online'
  });
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

  // Anti-spam & Protection
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
        { label: 'معلومات المالك | Owner System', value: 'owner', emoji: '👑' }
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
        .setColor(0xFF1493).setTitle('📥 تحميل الفيديوهات | Video Downloader')
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

    const tmpFile = path.join(os.tmpdir(), `dl_${Date.now()}.mp4`);
    try {
      await downloadVideo(url, tmpFile);
      if (!fs.existsSync(tmpFile)) return statusMsg.edit(`❌ لم ينشأ ملف الفيديو.`);

      const fileSizeMB = fs.statSync(tmpFile).size / (1024 * 1024);
      if (fileSizeMB > MAX_UPLOAD_MB) {
        fs.unlinkSync(tmpFile);
        return statusMsg.edit({ content: null, embeds: [new EmbedBuilder()
          .setColor(0xFF6600).setTitle('⚠️ الملف كبير جداً')
          .setDescription(`حجم الفيديو **${fileSizeMB.toFixed(1)}MB** أعلى من حد الرفع المباشر (${MAX_UPLOAD_MB}MB).\n\n**📥 [افتح واعرض الرابط مباشرة](${url})**`)]});
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF1493).setTitle('✅ تم التحميل والرفع بنجاح!')
        .setDescription(`> 📌 **المنصة:** ${platform}\n> 📦 **الحجم:** ${fileSizeMB.toFixed(2)} MB\n> 👤 **بواسطة:** <@${message.author.id}>`)
        .setFooter({ text: 'Powered by yt-dlp 📥' });

      await statusMsg.edit({ content: null, embeds: [embed], files: [new AttachmentBuilder(tmpFile, { name: 'video.mp4' })] });
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch(e) {} }, 15000);
    } catch (err) {
      console.error('[download error]', err.message);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      return statusMsg.edit({ content: null, embeds: [new EmbedBuilder()
        .setColor(0xFF0000).setTitle('❌ فشل التحميل')
        .setDescription(`**السبب:** \`${err.message?.slice(0, 200) || 'خطأ غير معروف'}\`\n\n> تأكد من صحة الرابط وأن الحساب عام (Instagram)`)]});
    }
    return;
  }

  // ══════════════════════════════════════════
  // ── VOICE / MUSIC COMMANDS ──
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

    // ── PLAY ──
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

        // ── 3. Plain Text search via yt-search (no bot detection) ──
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

        // Stop previous processes if any
        const existingData = voiceData.get(message.guild.id);
        if (existingData) {
          try { if (existingData.player) existingData.player.stop(true); } catch(e) {}
          try { if (existingData.ytdlpProc) existingData.ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { if (existingData.ffmpegProc) existingData.ffmpegProc.kill('SIGKILL'); } catch(e) {}
        }

        // Create stream
        const { ytdlpProc, ffmpegProc, audioStream } = createYtDlpStream(youtubeUrl, binaryPath);

        // Join/get voice channel
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

        // Create AudioResource from PCM s16le stream
        const resource = voicePkg.createAudioResource(audioStream, {
          inputType: voicePkg.StreamType.Raw,
          inlineVolume: true
        });
        if (resource.volume) resource.volume.setVolume(1.0);

        const player = voicePkg.createAudioPlayer({
          behaviors: { noSubscriber: voicePkg.NoSubscriberBehavior.Play }
        });
        connection.subscribe(player);
        player.play(resource);

        voiceData.set(message.guild.id, { connection, player, ytdlpProc, ffmpegProc });

        // Keep connection active even when song finishes
        let hasPlayed = false;
        player.on('stateChange', (oldState, newState) => {
          console.log(`🎵 Player status: ${oldState.status} → ${newState.status}`);
          if (newState.status === voicePkg.AudioPlayerStatus.Playing) hasPlayed = true;
          if (hasPlayed && newState.status === voicePkg.AudioPlayerStatus.Idle) {
            try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
            try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
            const d = voiceData.get(message.guild.id);
            if (d) voiceData.set(message.guild.id, { connection: d.connection });
            console.log('✅ Song ended. Bot stays in voice channel.');
          }
        });

        player.on('error', err => {
          console.log('[Audio player error]', err.message);
          try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
        });

        const displayTitle = songArtist ? `${songTitle} — ${songArtist}` : songTitle;

        // Button link to YouTube
        const downloadBtn = new ButtonBuilder()
          .setLabel('📥 تحميل / Download')
          .setStyle(ButtonStyle.Link)
          .setURL(youtubeUrl);

        const playEmbed = new EmbedBuilder()
          .setColor(0xFF1493)
          .setTitle(`🎤 يتم الآن البث الصوتـي | Streaming Now`)
          .setDescription(
            `> 🎵 **${displayTitle}**\n` +
            `> 🔊 **الروم الصوتي:** <#${voiceChannel.id}>\n` +
            `> 👤 **بواسطة:** <@${message.author.id}>\n\n` +
            `> 💡 **اضغط الزر أدناه لتحميل الأغنية مباشرة!**`
          )
          .setThumbnail(coverImage)
          .setFooter({ text: 'Powered by yt-dlp + FFmpeg 🎧' });

        return statusMsg.edit({
          content: null,
          embeds: [playEmbed],
          components: [new ActionRowBuilder().addComponents(downloadBtn)]
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
        dance: `💃 **${message.author.username}** يرقص بسعادة!`, cry: `😢 **${message.author.username}** يبكي...`,
        blush: `😳 **${message.author.username}** يحمر خجلاً!`, happy: `😊 **${message.author.username}** سعيد جداً!`,
        sleep: `😴 **${message.author.username}** نايم!`, bored: `😑 **${message.author.username}** يشعر بالملل...`,
        think: `🤔 **${message.author.username}** يفكر...`, facepalm: `🤦 **${message.author.username}** يضرب وجهه!`,
        clap: `👏 **${message.author.username}** يصفّق!`, shrug: `🤷 **${message.author.username}** لا يعرف!`,
        confused: `😕 **${message.author.username}** محتار!`, nervous: `😰 **${message.author.username}** متوتر!`,
        triggered: `😤 **${message.author.username}** غاضب جداً!`, run: `🏃 **${message.author.username}** يجري!`,
        thumbsup: `👍 **${message.author.username}** ممتاز!`,
        waifu: `🌸 Waifu لـ **${message.author.username}**`, neko: `🐱 Neko لـ **${message.author.username}**`,
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
if (!token) { console.error('❌ DISCORD_TOKEN is missing!'); process.exit(1); }
client.login(token).catch(err => console.error('❌ Login failed:', err));
