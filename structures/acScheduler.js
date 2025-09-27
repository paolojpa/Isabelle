// acscheduler.js
const cron = require('node-cron');
const { DateTime } = require('luxon');
const config = require('../config.json');
const { ChannelType } = require('discord.js');

// Helpers
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function prettyDate(dt) {
  return `${dt.toFormat('cccc')}, ${dt.toFormat('LLLL')} ${ordinal(dt.day)}, ${dt.toFormat('yyyy')}`;
}

// Western Easter (Meeus/Jones/Butcher)
function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar,4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

// Global events desactivados
function getDailyGlobal() { return []; }

// Evaluación reglas v2 (sirve para special events y staff events)
function occursToday(rule, dt) {
  if (rule.rule_type === 'fixed') {
    return rule.month === dt.month && rule.day === dt.day;
  }
  if (rule.rule_type === 'nth_weekday') {
    if (rule.month !== dt.month) return false;
    if (rule.weekday !== dt.weekday) return false; // 1..7
    if (rule.nth === -1) {
      // Último WEEKDAY del mes
      let w = dt.endOf('month');
      while (w.weekday !== rule.weekday) w = w.minus({ days: 1 });
      return w.day === dt.day;
    }
    const nthToday = Math.ceil(dt.day / 7);
    return nthToday === rule.nth;
  }
  if (rule.rule_type === 'relative') {
    if (rule.rel_anchor === 'easter') {
      const { month, day } = easterDate(dt.year);
      const easter = DateTime.fromObject({ year: dt.year, month, day, zone: dt.zone });
      const target = easter.plus({ days: Number(rule.rel_offset_days || 0) });
      return target.hasSame(dt, 'day');
    }
  }
  if (rule.rule_type === 'weekday') {
    // Cada semana (1=Mon..7=Sun)
    return rule.weekday === dt.weekday;
  }
  return false;
}

/* ===================== STAFF EVENTS ===================== */
function staffLine(e) {
  // Menciona al usuario + título opcional
  const who = `<@${e.user_id}>`;
  const title = e.title ? ` — **${e.title}**` : '';
  return `- ${who}${title}`;
}

async function postStaffEventsDaily(client, guild) {
  const cfg = client.acdb.getGuildCfg.get(guild.id);
  if (!cfg) return;

  const chCfg = client.acdb.getStaffEvChannels.get(guild.id);
  if (!chCfg || !chCfg.ch1) return; // requiere al menos 1 canal configurado

  const tz = cfg.timezone || 'UTC';
  const now = DateTime.now().setZone(tz);

  const all = client.acdb.allStaffEv.all(guild.id);
  const todays = all.filter(r => occursToday(r, now));
  if (!todays.length) return;

  const title = `## **__${prettyDate(now)} — Staff Events__**`;
  const lines = todays.map(staffLine);
  const content = [title, '', ...lines].join('\n');

  const files = todays.filter(e => e.image_url).map(e => e.image_url);

  const channelIds = [chCfg.ch1, chCfg.ch2, chCfg.ch3].filter(Boolean);
  for (const cid of channelIds) {
    const ch = guild.channels.cache.get(cid) || await guild.channels.fetch(cid).catch(() => null);
    if (!ch) continue;
    const sent = await ch.send({ content, files }).catch(() => null);
    if (sent && ch.type === ChannelType.GuildAnnouncement && sent.crosspostable) {
      try { await sent.crosspost(); } catch {}
    }
  }
}

/* ===================== CALENDARIO DIARIO ===================== */
async function postDaily(client, guild) {
  const cfg = client.acdb.getGuildCfg.get(guild.id);
  if (!cfg || !cfg.channel_id) return;

  const channel = guild.channels.cache.get(cfg.channel_id)
    || await guild.channels.fetch(cfg.channel_id).catch(() => null);
  if (!channel) return;

  const now = DateTime.now().setZone(cfg.timezone || 'UTC');

  const villagers = client.acdb.getVillagersByDate.all(now.month, now.day);
  const globals = getDailyGlobal(now);
  const seRules = client.acdb.allSEv2.all();
  const todaysSE = seRules.filter(r => occursToday(r, now));

  const title = `## **__${prettyDate(now)}__**`;
  const lines = [];

  const hemiLabel = (h) => {
    if (!h || h === 'both') return '';
    if ((h + '').toLowerCase() === 'north') return ' (Northern Hemisphere)';
    if ((h + '').toLowerCase() === 'south') return ' (Southern Hemisphere)';
    return '';
  };

  const eventNewsMention = (config.roles?.event_news_role_id && config.roles.event_news_role_id !== '0')
    ? `<@&${config.roles.event_news_role_id}>`
    : '';

  // Villagers
  if (villagers.length) {
    const plural = villagers.length > 1 ? 'birthdays' : 'birthday';
    const names = villagers.map(v => `**${v.name}**`).join(', ');
    lines.push(`- ${names}'s ${plural}`);
  }

  for (const ev of globals) lines.push(`- **${ev.title}** — ${ev.text}`);

  // ---- Special events con/ sin ping ----
  const seNoPing   = todaysSE.filter(e => !e.ping_required);
  const seWithPing = todaysSE.filter(e => e.ping_required);

  // Primero los que NO pinguean
  for (const e of seNoPing) {
    const hemi = hemiLabel(e.hemisphere);
    const text = e.text ? ` — ${e.text}` : '';
    lines.push(`- **${e.title}**${text}${hemi}`);
  }

  // Luego los que SÍ pinguean
  const firstPingIdx = lines.length;
  for (const e of seWithPing) {
    const hemi = hemiLabel(e.hemisphere);
    const text = e.text ? ` — ${e.text}` : '';
    lines.push(`- **${e.title}**${text}${hemi}`);
  }

  // Agrega @Event News SOLO al último evento pingueable (si existe)
  if (seWithPing.length > 0 && eventNewsMention) {
    const lastIdx = firstPingIdx + seWithPing.length - 1;
    lines[lastIdx] = `${lines[lastIdx]} ${eventNewsMention}`;
  }

  if (lines.length === 0) lines.push('• No special events today.');

  const content = [title, '', ...lines].join('\n');

  const files = [
    ...villagers.filter(v => v.image_url).map(v => v.image_url),
    ...todaysSE.filter(e => e.image_url).map(e => e.image_url)
  ];

  const sent = await channel.send({ content, files });

  // Auto-Publish si es Announcement channel
  if (channel.type === ChannelType.GuildAnnouncement && sent.crosspostable) {
    try { await sent.crosspost(); } catch {}
  }
}

/* ===================== SCHEDULER ===================== */
function startScheduler(client) {
  // Corre cada minuto, pero postea solo a la hora exacta configurada (minuto 0)
  cron.schedule('* * * * *', async () => {
    for (const [id, guild] of client.guilds.cache) {
      const cfg   = client.acdb.getGuildCfg.get(id);
      const chCfg = client.acdb.getStaffEvChannels.get(id);

      // Si no hay ningún destino (ni calendario ni staff), no seguimos
      const hasCalendarChannel = !!cfg?.channel_id;
      const hasStaffChannels   = !!(chCfg && (chCfg.ch1 || chCfg.ch2 || chCfg.ch3));
      if (!hasCalendarChannel && !hasStaffChannels) continue;

      const tz = (cfg && cfg.timezone) || 'UTC';
      const now = DateTime.now().setZone(tz);

      if (now.minute !== 0) continue;
      if (now.hour !== Number(cfg?.post_hour || 9)) continue;

      const isoDate = now.toISODate(); // YYYY-MM-DD

      // Usamos el mismo log de idempotencia por día
      const res = client.acdb.markDailyPosted.run(id, isoDate);
      if (res.changes === 0) {
        continue; // ya posteamos hoy en este guild
      }

      // Publica calendario general (si hay canal)
      if (hasCalendarChannel) {
        postDaily(client, guild).catch(() => {});
      }
      // Publica staff events (si hay canales)
      if (hasStaffChannels) {
        postStaffEventsDaily(client, guild).catch(() => {});
      }
    }
  }, { timezone: 'UTC' });

  // Exponer helpers para disparar manualmente si hace falta
  client.acCalendar = {
    postDaily: (guild) => postDaily(client, guild),
    postStaffDaily: (guild) => postStaffEventsDaily(client, guild)
  };
}

module.exports = { startScheduler, occursToday, getDailyGlobal, postDaily, postStaffEventsDaily };
