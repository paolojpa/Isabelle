// commands/ac/tomorrow.js
const { DateTime } = require('luxon');
const { ChannelType } = require('discord.js');
const config = require('../../config.json');
const { getDailyGlobal, occursToday } = require('../../structures/acScheduler');

// helpers para el título
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

module.exports.run = async (client, message, args, level) => {
  // → Usa el timezone guardado por servidor (fallback a defaults o UTC)
  const guildCfg = client.acdb.getGuildCfg.get(message.guild.id);
  const tz = guildCfg?.timezone || config.defaults?.timezone || 'UTC';

  // Mañana según el timezone del servidor
  const dt = DateTime.now().setZone(tz).plus({ days: 1 });

  const villagers = client.acdb.getVillagersByDate.all(dt.month, dt.day);
  const globals = getDailyGlobal(dt);
  const seRules = client.acdb.allSEv2.all();
  const todaysSE = seRules.filter(r => occursToday(r, dt));

  const title = `## **__${dt.toFormat('cccc')}, ${dt.toFormat('LLLL')} ${ordinal(dt.day)}, ${dt.year}__**`;
  const lines = [];

  // hemisferio bonito
  const hemiLabel = (h) => {
    if (!h || h === 'both') return '';
    if ((h + '').toLowerCase() === 'north') return ' (Northern Hemisphere)';
    if ((h + '').toLowerCase() === 'south') return ' (Southern Hemisphere)';
    return '';
  };

  // mention del rol de noticias (si está configurado)
  const eventNewsMention = (config.roles?.event_news_role_id && config.roles.event_news_role_id !== '0')
    ? `<@&${config.roles.event_news_role_id}>`
    : '';

  // Villagers
  if (villagers.length) {
    const plural = villagers.length > 1 ? 'birthdays' : 'birthday';
    const names = villagers.map(v => `**${v.name}**`).join(', ');
    lines.push(`- ${names}'s ${plural}`);
  }

  // Globales (si los usas)
  for (const ev of globals) lines.push(`- **${ev.title}** — ${ev.text}`);

  // Special Events: primero listamos todos,
  // y solo si hay alguno con ping_required=1, agregamos el ping al ÚLTIMO que lo requiera
  const startIdx = lines.length;
  const seWithPing = [];
  for (const e of todaysSE) {
    const hemi = hemiLabel(e.hemisphere);
    const text = e.text ? ` — ${e.text}` : '';
    lines.push(`- **${e.title}**${text}${hemi}`);
    if (Number(e.ping_required) === 1) {
      // Guardamos el índice relativo en 'lines' para luego añadir el ping aquí
      seWithPing.push(lines.length - 1);
    }
  }

  if (seWithPing.length > 0 && eventNewsMention) {
    const lastPingIdx = seWithPing[seWithPing.length - 1];
    lines[lastPingIdx] = `${lines[lastPingIdx]} ${eventNewsMention}`;
  }

  if (lines.length === 0) lines.push('• No special events tomorrow.');

  const content = [title, '', ...lines].join('\n');

  const files = [
    ...villagers.filter(v => v.image_url).map(v => v.image_url),
    ...todaysSE.filter(e => e.image_url).map(e => e.image_url)
  ];

  const sent = await message.channel.send({ content, files }).catch(() => null);

  // Auto-Publish si el canal es Announcement
  if (sent && message.channel.type === ChannelType.GuildAnnouncement && sent.crosspostable) {
    try { await sent.crosspost(); } catch {}
  }
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['tmrw'],
  permLevel: 'CalendarManager',
};

module.exports.help = {
  name: 'tomorrow',
  category: 'ac',
  description: 'Preview tomorrow’s calendar in the current channel (uses guild timezone, respects per-event ping).',
  usage: 'tomorrow',
};
