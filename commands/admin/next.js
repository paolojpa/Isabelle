// commands/ac/next.js
const { DateTime } = require('luxon');
const config = require('../../config.json');
const { occursToday, getDailyGlobal } = require('../../structures/acScheduler');

// helpers: ordinal y fecha bonita
function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function prettyDate(dt) {
  return `${dt.toFormat('cccc')}, ${dt.toFormat('LLLL')} ${ordinal(dt.day)}, ${dt.year}`;
}
// hemisferio
function hemiLabel(h) {
  if (!h || h === 'both') return '';
  const v = String(h).toLowerCase();
  if (v === 'north') return ' (Northern Hemisphere)';
  if (v === 'south') return ' (Southern Hemisphere)';
  return '';
}

module.exports.run = async (client, message, args, level) => {
  // cuántos días mostrar
  let n = Number(args[0] || 7);
  if (!Number.isFinite(n) || n < 1) n = 7;
  if (n > 30) n = 30; // límite sano para no spamear

  // timezone del guild
  const cfg = client.acdb.getGuildCfg.get(message.guild.id);
  const tz = (cfg && cfg.timezone) || config.defaults?.timezone || 'America/New_York';

  // construir bloques por día
  const blocks = [];
  let dt = DateTime.now().setZone(tz);

  for (let i = 0; i < n; i++) {
    const day = dt.plus({ days: i });

    const villagers = client.acdb.getVillagersByDate.all(day.month, day.day);
    const globals = getDailyGlobal(day); // si no usas globales, devolverá []
    const seRules = client.acdb.allSEv2.all();
    const todaysSE = seRules.filter(r => occursToday(r, day));

    const lines = [];

    if (villagers.length) {
      const plural = villagers.length > 1 ? 'birthdays' : 'birthday';
      const names = villagers.map(v => `**${v.name}**`).join(', ');
      lines.push(`- ${names}'s ${plural}`);
    }

    for (const ev of globals) {
      lines.push(`- **${ev.title}** — ${ev.text}`);
    }

    for (const e of todaysSE) {
      const hemi = hemiLabel(e.hemisphere);
      const text = e.text ? ` — ${e.text}` : '';
      lines.push(`- **${e.title}**${text}${hemi}`);
    }

    if (lines.length === 0) {
      lines.push('• No special events.');
    }

    const block = `### **__${prettyDate(day)}__**\n${lines.join('\n')}`;
    blocks.push(block);
  }

  const all = blocks.join('\n');
  const MAX = 1900; // margen seguro < 2000
  if (all.length <= MAX) {
    return message.channel.send(all);
  }

  let buf = '';
  for (const b of blocks) {
    if ((buf + '\n' + b).length > MAX) {
      await message.channel.send(buf);
      buf = b;
    } else {
      buf = buf ? `${buf}\n\n${b}` : b;
    }
  }
  if (buf) await message.channel.send(buf);
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['upcoming', 'n'],
  permLevel: 'Mod',
};

module.exports.help = {
  name: 'next',
  category: 'ac',
  description: 'Shows the next N days of villagers and special events (preview, no pings).',
  usage: 'next [days]',
};
