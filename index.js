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

// ── ffmpeg path ──
const FFMPEG_PATH = (() => { try { return require('ffmpeg-static'); } catch(e) { return 'ffmpeg'; } })();
console.log('🎬 FFMPEG path:', FFMPEG_PATH);

// ── yt-dlp binary (cross-platform) ──
const YTDLP_BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
let YTDLP_PATH = path.join(__dirname, YTDLP_BINARY_NAME);

async function ensureYtDlpBinary() {
  try {
    if (!fs.existsSync(YTDLP_PATH)) {
      console.log(`📦 Downloading yt-dlp for ${process.platform}...`);
      const YTDlpWrap = require('yt-dlp-wrap').default;
      await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
      if (process.platform !== 'win32') fs.chmodSync(YTDLP_PATH, 0o755);
      console.log('✅ yt-dlp ready!');
    }
  } catch (err) {
    console.log('⚠️ yt-dlp download failed, using system fallback:', err.message);
    YTDLP_PATH = 'yt-dlp';
  }
}

// ── Voice & play-dl ──
let voicePkg, playDl, spotifyUrlInfo;
try {
  voicePkg = require('@discordjs/voice');
  playDl = require('play-dl');
  spotifyUrlInfo = require('spotify-url-info')(fetch);
} catch (e) {
  console.log('Package error:', e.message);
}

// ── Canvas ──
let createCanvas, loadImage;
try {
  const c = require('@napi-rs/canvas');
  createCanvas = c.createCanvas;
  loadImage = c.loadImage;
} catch (e) {}

// ── Discord Client ──
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
const voiceData = new Map(); // guildId -> { connection, player, processes }

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
  kill:      ['https://cdn.otakugifs.xyz/gifs/kill/a1b2c3d4e5f6a7b8.gif'],
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
    guildSettings.set(guildId, { antiLink: true, antiImage: true, antiFile: true, timeoutMinutes: DEFAULT_TIMEOUT_MIN });
  }
  return guildSettings.get(guildId);
}

function getUptimeString() {
  const t = Math.floor((Date.now() - startTime) / 1000);
  return `${Math.floor(t/86400)}d ${Math.floor((t%86400)/3600)}h ${Math.floor((t%3600)/60)}m ${t%60}s`;
}

const LINK_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|io|me|li)\/[^\s]+)/gi;
const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;

// ── Help Embed ──
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
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}antifile <on/off>\` ➔ حماية الملفات\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}protection\` ➔ عرض حالة الحماية`
    );
  if (category === 'images') return base
    .setTitle(`${EMOJIS.SHARK_HUG} تأثيرات الصور | Image Magic`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}avatar [@user]\` ➔ عرض وتنزيل الافتار\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}banner [@user]\` ➔ عرض وتنزيل البنر\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}wanted [@user]\` ➔ تصميم ملصق مطلوب\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}blur [@user]\` ➔ تأثير التغبيش الضبابي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}invert [@user]\` ➔ عكس ألوان الصورة\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}greyscale [@user]\` ➔ تحويل لأبيض وأسود`
    );
  if (category === 'anime') return base
    .setTitle(`${EMOJIS.REM_DANCE} تفاعلات الأنمي | Anime Actions`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}hug [@user]\` ➔ عناق أنمي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kiss [@user]\` ➔ قبلة أنمي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}pat [@user]\` ➔ تربيت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}slap [@user]\` ➔ صفعة\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}cuddle [@user]\` ➔ احتضان\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}dance\` ➔ رقصة أنمي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}cry\` ➔ بكاء\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}wink [@user]\` ➔ غمزة\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}smug [@user]\` ➔ ابتسامة ساخرة\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}punch [@user]\` ➔ لكمة\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}poke [@user]\` ➔ وخز\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}waifu\` ➔ صور Waifu`
    );
  if (category === 'music') return base
    .setTitle(`🎤 الروم الصوتي | Voice & Music`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}join\` ➔ الانضمام للروم الصوتي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}play <اسم / رابط YouTube / Spotify>\` ➔ تشغيل الأغاني\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}stop\` / \`${PREFIX}leave\` ➔ إيقاف ومغادرة`
    );
  if (category === 'bio') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} سيرة البروفايل | Profile Bio Card`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}bio [@user]\` ➔ بطاقة البروفايل\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}botinfo\` ➔ معلومات البوت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}userinfo [@user]\` ➔ معلومات العضو\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}serverinfo\` ➔ معلومات السيرفر`
    );
  if (category === 'moderation') return base
    .setTitle(`${EMOJIS.STAFF_DISCORD} الأوامر الإدارية | Moderation`)
    .setDescription(
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}timeout <@user> <دقائق> [سبب]\` ➔ تايم أوت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}untimeout <@user>\` ➔ فك التايم أوت\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}kick <@user> [سبب]\` ➔ طرد عضو\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}ban <@user> [سبب]\` ➔ حظر نهائي\n` +
      `> ${EMOJIS.PINK_BUTTERFLY} \`${PREFIX}clear <1-100>\` ➔ مسح رسائل`
    );
  if (category === 'owner') return base
    .setTitle(`${EMOJIS.PINK_VERIFIED} قسم المالك | Owner System`)
    .setDescription(
      `> 👑 **المالك المعتمد:** <@${OWNER_ID}>\n` +
      `> ✨ **حصانة شاملة:** استثناء تام للمالك من جميع التايم أوت.\n` +
      `> 🎬 **منشن المالك:** يرد ببطاقة GIF مباشرة.`
    );
  return base;
}

// ── Bot Ready ──
client.once('clientReady', async () => {
  console.log(`===========================================`);
  console.log(` 🤖 Bot is online as: ${client.user.tag}`);
  console.log(` 👑 Owner ID: ${OWNER_ID}`);
  console.log(` ⚡ Prefix: ${PREFIX}`);
  console.log(`===========================================`);
  await ensureYtDlpBinary();
  client.user.setPresence({
    activities: [{ name: `${PREFIX}help | Live Voice & Anime GIFs`, type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' }],
    status: 'online'
  });
});

// ── Help Menu Interaction ──
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId === 'help_select_menu') {
    const newEmbed = createHelpEmbed(interaction.values[0], interaction.user, client);
    await interaction.update({ embeds: [newEmbed] });
  }
});

// ── Message Handler ──
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const config = getGuildConfig(message.guild.id);

  // Owner mention reply
  if (message.mentions.users.has(OWNER_ID) || message.content.includes(`<@${OWNER_ID}>`) || message.content.includes(`<@!${OWNER_ID}>`)) {
    try {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xFF69B4).setDescription(`${EMOJIS.PINK_VERIFIED} **تاج الرأس والمالك | Bot Owner:** <@${OWNER_ID}>`).setImage(GIF_URL)] });
    } catch (err) {}
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
          const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xFF1493).setTitle(`${EMOJIS.SHINOBU_GUN} نظام الحماية | Auto Protection Alert`).setDescription(`⚠️ **تم إعطاء تايم أوت تلقائي!**\n\nالعضو: <@${message.author.id}>\nالمدة: ${config.timeoutMinutes} دقائق\nالسبب: ${reason}`)] });
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

  // ── HELP ──
  if (['help', 'مساعدة', 'الأوامر'].includes(command)) {
    const mainEmbed = createHelpEmbed('main', message.author, client);
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_select_menu')
      .setPlaceholder('🌸 اختر القائمة | Select Category...')
      .addOptions([
        { label: 'الرئيسية | Main Overview', value: 'main', emoji: '🌸' },
        { label: 'أنظمة الحماية | Protection Suite', value: 'protection', emoji: '🛡️' },
        { label: 'ميزات الصور | Image Magic', value: 'images', emoji: '🎨' },
        { label: 'تفاعلات الأنمي | Anime Reactions', value: 'anime', emoji: '🎭' },
        { label: 'الروم الصوتي | Voice & Music', value: 'music', emoji: '🎤' },
        { label: 'سيرة البروفايل | Profile Bio', value: 'bio', emoji: '🌸' },
        { label: 'الأوامر الإدارية | Moderation', value: 'moderation', emoji: '🔨' },
        { label: 'معلومات المالك | Owner System', value: 'owner', emoji: '👑' }
      ]);
    return message.reply({ embeds: [mainEmbed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
  }

  // ══════════════════════════════════════════
  // ── MUSIC / VOICE COMMANDS ──
  // ══════════════════════════════════════════
  if (['join', 'connect', 'play', 'stop', 'leave'].includes(command)) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply(`${EMOJIS.ANIME_SCREAM} **يجب أن تكون متصلاً بروم صوتي أولاً!**`);

    // ── JOIN ──
    if (command === 'join' || command === 'connect') {
      try {
        let connection = voicePkg.getVoiceConnection(message.guild.id);
        if (!connection) {
          connection = voicePkg.joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
          });
          await voicePkg.entersState(connection, voicePkg.VoiceConnectionStatus.Ready, 15_000);
        }
        voiceData.set(message.guild.id, { connection });
        return message.reply(`${EMOJIS.SUCCESS} تم الانضمام للروم الصوتي: <#${voiceChannel.id}>`);
      } catch (err) {
        return message.reply(`❌ خطأ: ${err.message}`);
      }
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
        return message.reply(`${EMOJIS.SUCCESS} تم إيقاف الصوت ومغادرة الروم الصوتي.`);
      }
      // Try to destroy any lingering connection
      const lingering = voicePkg.getVoiceConnection(message.guild.id);
      if (lingering) { lingering.destroy(); return message.reply(`${EMOJIS.SUCCESS} تم مغادرة الروم الصوتي.`); }
      return message.reply(`البوت غير متصل حالياً!`);
    }

    // ── PLAY ──
    if (command === 'play') {
      let searchQuery = args.join(' ');
      if (!searchQuery) return message.reply(`${EMOJIS.TOHRU_SMUG} يرجى إدخال اسم الأغنية أو رابط.`);

      const statusMsg = await message.reply(`${EMOJIS.REM_DANCE} 🎵 جاري البحث والتشغيل...`);

      try {
        let songTitle = searchQuery;
        let songArtist = '';
        let coverImage = client.user.displayAvatarURL();
        let youtubeUrl = null;

        // Step 1: Resolve source
        if (searchQuery.includes('spotify.com')) {
          try {
            if (spotifyUrlInfo?.getPreview) {
              const preview = await spotifyUrlInfo.getPreview(searchQuery);
              if (preview?.title) {
                songTitle = preview.title;
                songArtist = preview.artist || '';
                if (preview.image) coverImage = preview.image;
              }
            }
          } catch (e) {}
          try {
            const results = await playDl.search(`${songTitle} ${songArtist}`.trim(), { source: { youtube: 'video' }, limit: 1 });
            if (results?.length > 0) {
              youtubeUrl = results[0].url || `https://www.youtube.com/watch?v=${results[0].id}`;
              coverImage = results[0].thumbnails?.[0]?.url || coverImage;
            }
          } catch (e) {}

        } else if (searchQuery.includes('youtube.com') || searchQuery.includes('youtu.be')) {
          let cleanUrl = searchQuery;
          if (cleanUrl.includes('/shorts/')) {
            const vid = cleanUrl.split('/shorts/')[1].split('?')[0];
            cleanUrl = `https://www.youtube.com/watch?v=${vid}`;
          }
          youtubeUrl = cleanUrl;
          try {
            const info = await playDl.video_basic_info(cleanUrl);
            songTitle = info.video_details.title || searchQuery;
            coverImage = info.video_details.thumbnails?.[0]?.url || coverImage;
          } catch (e) {}

        } else {
          try {
            const results = await playDl.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
            if (results?.length > 0) {
              const r = results[0];
              youtubeUrl = r.url || `https://www.youtube.com/watch?v=${r.id}`;
              songTitle = r.title || songTitle;
              coverImage = r.thumbnails?.[0]?.url || coverImage;
            }
          } catch (e) {}
        }

        if (!youtubeUrl || typeof youtubeUrl !== 'string') {
          return statusMsg.edit(`❌ لم يتم العثور على نتائج لـ: \`${searchQuery}\``);
        }

        console.log('▶ Playing:', youtubeUrl);
        await ensureYtDlpBinary();

        // Stop any existing audio first
        const existingData = voiceData.get(message.guild.id);
        if (existingData) {
          try { if (existingData.player) existingData.player.stop(true); } catch(e) {}
          try { if (existingData.ytdlpProc) existingData.ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { if (existingData.ffmpegProc) existingData.ffmpegProc.kill('SIGKILL'); } catch(e) {}
        }

        // Step 2: Spawn yt-dlp → pipe to ffmpeg
        const ytdlpArgs = [
          '-f', 'bestaudio',
          '--no-playlist',
          '-q',
          '--no-warnings',
          '-o', '-',
          youtubeUrl
        ];
        // Add ffmpeg location only if we have a real path
        if (FFMPEG_PATH && FFMPEG_PATH !== 'ffmpeg') {
          ytdlpArgs.splice(ytdlpArgs.indexOf('-o') - 1, 0, '--ffmpeg-location', path.dirname(FFMPEG_PATH));
        }

        const ytdlpProc = spawn(YTDLP_PATH, ytdlpArgs);

        // ffmpeg: read raw audio from yt-dlp → encode to PCM S16LE → discordjs/voice reads it
        const ffmpegProc = spawn(FFMPEG_PATH, [
          '-i', 'pipe:0',        // input from yt-dlp
          '-analyzeduration', '0',
          '-loglevel', 'error',
          '-f', 's16le',         // raw PCM 16-bit little-endian (Arbitrary type — most compatible)
          '-ar', '48000',
          '-ac', '2',
          'pipe:1'               // output to stdout
        ]);

        ytdlpProc.stdout.pipe(ffmpegProc.stdin);
        ytdlpProc.stderr.on('data', d => console.log('[yt-dlp]', d.toString().trim()));
        ffmpegProc.stderr.on('data', d => console.log('[ffmpeg]', d.toString().trim()));
        ytdlpProc.on('error', e => console.log('[yt-dlp error]', e.message));
        ffmpegProc.on('error', e => console.log('[ffmpeg error]', e.message));

        // Step 3: Get or create voice connection
        let connection = voicePkg.getVoiceConnection(message.guild.id);
        if (!connection || connection.state.status === voicePkg.VoiceConnectionStatus.Destroyed) {
          connection = voicePkg.joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
          });
        }

        // Wait for voice to be ready (max 20s)
        try {
          await voicePkg.entersState(connection, voicePkg.VoiceConnectionStatus.Ready, 20_000);
        } catch (connErr) {
          console.log('Voice not ready:', connErr.message);
          ytdlpProc.kill('SIGKILL');
          ffmpegProc.kill('SIGKILL');
          return statusMsg.edit(`❌ لم يتمكن البوت من الاتصال بالروم الصوتي. حاول مجدداً.`);
        }

        // Step 4: Create audio resource from raw PCM
        const resource = voicePkg.createAudioResource(ffmpegProc.stdout, {
          inputType: voicePkg.StreamType.Raw,   // PCM S16LE
          inlineVolume: true
        });
        if (resource.volume) resource.volume.setVolume(1.0);

        // Step 5: Create player
        const player = voicePkg.createAudioPlayer({
          behaviors: { noSubscriber: voicePkg.NoSubscriberBehavior.Play }
        });
        connection.subscribe(player);
        player.play(resource);

        // Store guild data
        voiceData.set(message.guild.id, { connection, player, ytdlpProc, ffmpegProc });

        // Step 6: Auto-cleanup ONLY after song actually plays and finishes
        let hasPlayed = false;
        let cleanupDone = false;

        const doCleanup = () => {
          if (cleanupDone) return;
          cleanupDone = true;
          console.log('🎵 Song ended - cleaning up');
          try { ytdlpProc.kill('SIGKILL'); } catch(e) {}
          try { ffmpegProc.kill('SIGKILL'); } catch(e) {}
          // DON'T destroy connection here - let the bot stay in voice
          // Only delete player from data
          const d = voiceData.get(message.guild.id);
          if (d) {
            voiceData.set(message.guild.id, { connection: d.connection });
          }
        };

        player.on('stateChange', (oldState, newState) => {
          console.log(`Player: ${oldState.status} → ${newState.status}`);
          if (newState.status === voicePkg.AudioPlayerStatus.Playing) {
            hasPlayed = true;
          }
          if (hasPlayed && newState.status === voicePkg.AudioPlayerStatus.Idle) {
            doCleanup();
          }
        });

        player.on('error', err => {
          console.log('[Player error]', err.message);
          doCleanup();
        });

        // Step 7: Send success embed with REAL download button
        const displayTitle = songArtist ? `${songTitle} — ${songArtist}` : songTitle;
        
        // Build download button (opens YouTube link)
        const downloadBtn = new ButtonBuilder()
          .setLabel('📥 تحميل / Download')
          .setStyle(ButtonStyle.Link)
          .setURL(youtubeUrl);

        const playEmbed = new EmbedBuilder()
          .setColor(0xFF1493)
          .setTitle(`🎤 يتم الآن البث | Now Streaming`)
          .setDescription(
            `> 🎵 **${displayTitle}**\n` +
            `> 🔊 **الروم:** <#${voiceChannel.id}>\n` +
            `> 👤 **بواسطة:** <@${message.author.id}>\n\n` +
            `> 💡 اضغط زر **📥 تحميل** لفتح الأغنية على YouTube وتحميلها!`
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
      const soloMsgs = {
        dance: `💃 **${message.author.username}** يرقص بسعادة!`,
        cry: `😢 **${message.author.username}** يبكي بحرقة...`,
        blush: `😳 **${message.author.username}** يحمر خجلاً!`,
        happy: `😊 **${message.author.username}** سعيد جداً!`,
        sleep: `😴 **${message.author.username}** نايم... لا تصحيه!`,
        bored: `😑 **${message.author.username}** يشعر بالملل...`,
        think: `🤔 **${message.author.username}** يفكر...`,
        facepalm: `🤦 **${message.author.username}** يضرب وجهه بيده!`,
        clap: `👏 **${message.author.username}** يصفّق!`,
        shrug: `🤷 **${message.author.username}** مش عارف!`,
        confused: `😕 **${message.author.username}** محتار!`,
        nervous: `😰 **${message.author.username}** متوتر!`,
        triggered: `😤 **${message.author.username}** فقد أعصابه!!!`,
        run: `🏃 **${message.author.username}** يجري!`,
        thumbsup: `👍 **${message.author.username}** يعطي إبهاماً للأعلى!`,
        waifu: `🌸 وايفو خاصة بـ **${message.author.username}**`,
        neko: `🐱 نيكو لـ **${message.author.username}**`,
      };
      return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF1493).setDescription(soloMsgs[command] || `**${message.author.username}** ${command}`).setImage(gifUrl)] });
    }

    const targetMsgs = {
      hug: isSelf ? `🤗 **${message.author.username}** يعانق نفسه!` : `🤗 **${message.author.username}** يعانق <@${targetUser.id}>!`,
      kiss: `💋 **${message.author.username}** يقبّل <@${targetUser.id}>!`,
      pat: `✋ **${message.author.username}** يربّت على رأس <@${targetUser.id}>!`,
      slap: `👋 **${message.author.username}** يصفع <@${targetUser.id}>!`,
      cuddle: `🥰 **${message.author.username}** يحتضن <@${targetUser.id}>!`,
      poke: `👉 **${message.author.username}** يوخز <@${targetUser.id}>!`,
      punch: `👊 **${message.author.username}** يلكم <@${targetUser.id}>!`,
      bite: `😬 **${message.author.username}** يعض <@${targetUser.id}>!`,
      lick: `👅 **${message.author.username}** يلحس <@${targetUser.id}>!`,
      highfive: `🙌 **${message.author.username}** يعطي هاي فايف لـ <@${targetUser.id}>!`,
      wave: `👋 **${message.author.username}** يلوّح لـ <@${targetUser.id}>!`,
      bonk: `🔨 **${message.author.username}** يضرب <@${targetUser.id}> على رأسه!`,
      kill: `💀 **${message.author.username}** يطلق النار على <@${targetUser.id}>!`,
      shoot: `🔫 **${message.author.username}** يصوّب على <@${targetUser.id}>!`,
      nom: `🍪 **${message.author.username}** يأكل <@${targetUser.id}>!`,
      kick: `🦵 **${message.author.username}** يركل <@${targetUser.id}>!`,
      feed: `🍱 **${message.author.username}** يطعم <@${targetUser.id}>!`,
      wink: `😉 **${message.author.username}** يغمز لـ <@${targetUser.id}>!`,
      smug: `😏 **${message.author.username}** يبتسم بسخرية لـ <@${targetUser.id}>!`,
      peek: `👀 **${message.author.username}** يتلصص على <@${targetUser.id}>!`,
    };
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF1493).setDescription(targetMsgs[command] || `**${message.author.username}** ${command} <@${targetUser.id}>`).setImage(gifUrl)] });
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
if (!token) { console.error('❌ No DISCORD_TOKEN found!'); process.exit(1); }
client.login(token).catch(err => console.error('❌ Login failed:', err));
