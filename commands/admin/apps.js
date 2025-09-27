// commands/admin/apps.js
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const config = require('../../config.json');

/* ---------------- Utils ---------------- */
function parseChannelId(str) {
  if (!str) return null;
  const m = /<#(\d+)>/.exec(str);
  if (m) return m[1];
  if (/^\d{17,20}$/.test(str)) return str;
  return null;
}

function consumeQuoted(arr) {
  // consume "Label con espacios" desde args
  const a = Array.from(arr);
  if (!a.length || !a[0].startsWith('"')) return { value: null, rest: a };
  const buf = [a[0]];
  let i = 1;
  while (i < a.length && !a[i].endsWith('"')) { buf.push(a[i]); i++; }
  if (i < a.length) { buf.push(a[i]); i++; }
  const joined = buf.join(' ');
  const value = joined.replace(/^"/, '').replace(/"$/, '');
  return { value, rest: a.slice(i) };
}

// Sustituye splitQuestionsInline(...) por esta versión "safe"
function splitQuestionsInline(str) {
  const s = String(str || '').trim();
  const out = [];
  let buf = '';
  let depth = 0; // nivel de paréntesis

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') {
      depth++;
      buf += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      buf += ch;
    } else if (ch === '|' && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());

  // máx 50 preguntas
  return out.slice(0, 50);
}

// Mantén toStoredQuestions como está, solo asegúrate de no tocar el contenido entre paréntesis
function toStoredQuestions(parts) {
  return parts.map(p => String(p).trim());
}


/* ---------------- Panel publisher ---------------- */
async function publishPanel(client, guild) {
  const panel = client.acdb.getApplyPanel?.get(guild.id);
  const apps = client.acdb.listAppTypes.all(guild.id).filter(a => a.active);

  if (!panel || !panel.panel_channel_id) return null;
  const channel = await guild.channels.fetch(panel.panel_channel_id).catch(() => null);
  if (!channel) return null;

  const activeCount = apps.length;
  const embed = new EmbedBuilder()
    .setTitle('📨 Applications')
    .setDescription(
      `Click a button to start an application\n` +
      `Questions marked with * are required.\n`
    )
    .setColor(0x5865F2);

  const rows = [];
  let row = new ActionRowBuilder();
  let countInRow = 0;

  for (const a of apps) {
    if (countInRow === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
      countInRow = 0;
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`apply_start:${a.type_key}`)
        .setLabel(`${a.type_label}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    countInRow++;
  }
  if (countInRow > 0) rows.push(row);

  let message;
  if (panel.panel_message_id) {
    message = await channel.messages.fetch(panel.panel_message_id).catch(() => null);
  }
  if (message) {
    await message.edit({ embeds: [embed], components: rows });
    return message;
  } else {
    const sent = await channel.send({ embeds: [embed], components: rows });
    client.acdb.upsertApplyPanel.run({
      guild_id: guild.id,
      panel_channel_id: channel.id,
      panel_message_id: sent.id
    });
    return sent;
  }
}

/* ---------------- Command ---------------- */
module.exports.run = async (client, message, args, level) => {
  // AppsManager (o Admin) requerido
  const has = (id) => id && id !== '0' && message.member?.roles?.cache?.has(id);
  const isAdmin = has(config.roles?.admin_role_id);
  const isApps  = isAdmin || has(config.roles?.apps_role_id);
  if (!isApps) return message.reply('You do not have permission to configure applications. (Apps Manager/Admin only)');

  const sub = (args.shift() || '').toLowerCase();

  /* ---- setup panel ---- */
  if (sub === 'setup') {
    const panelCh = message.mentions.channels.first();
    if (!panelCh) return message.reply('Usage: `!apps setup #panelChannel`');
    client.acdb.upsertApplyPanel.run({
      guild_id: message.guild.id,
      panel_channel_id: panelCh.id,
      panel_message_id: null
    });
    await publishPanel(client, message.guild);
    return message.channel.send('✅ Application panel created/updated.');
  }

  /* ---- review log ---- */
  if (sub === 'setlog') {
    const logCh = message.mentions.channels.first();
    if (!logCh) return message.reply('Usage: `!apps setlog #reviewLogChannel`');
    const s = client.acdb.getAppSettings.get(message.guild.id) || {};
    client.acdb.upsertAppSettings.run({
      guild_id: message.guild.id,
      review_log_channel_id: logCh.id,
      cooldown_days: s?.cooldown_days ?? 7
    });
    return message.channel.send(`✅ Review log channel set to ${logCh}.`);
  }

  /* ---- global cooldown view/set ---- */
  if (sub === 'cooldown') {
    const s = client.acdb.getAppSettings.get(message.guild.id);
    const days = s?.cooldown_days ?? 7;
    return message.channel.send(`⏳ Current application cooldown (global): **${days} day(s)**.`);
  }
  if (sub === 'setcooldown') {
    const d = Number(args[0]);
    if (!Number.isFinite(d) || d < 0 || d > 365) {
      return message.reply('Usage: `!apps setcooldown <days>` (0–365)');
    }
    const s = client.acdb.getAppSettings.get(message.guild.id) || {};
    client.acdb.upsertAppSettings.run({
      guild_id: message.guild.id,
      review_log_channel_id: s?.review_log_channel_id ?? null,
      cooldown_days: Math.floor(d)
    });
    return message.channel.send(`✅ Global cooldown updated: **${Math.floor(d)} day(s)**.`);
  }

  /* ---- add (SIN preguntas) ---- */
  if (sub === 'add') {
    // !apps add <key> "Label con espacios" #dest [cooldownDays]
    const key = (args.shift() || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const { value: label, rest } = consumeQuoted(args);
    args = rest;

    const destRaw = args.shift();
    const destId = parseChannelId(destRaw);
    const cd = args.length ? Number(args[0]) : null;
    const cooldown = (cd != null && !Number.isNaN(cd) && cd >= 0 && cd <= 365) ? Math.floor(cd) : null;

    if (!key || !label || !destId) {
      return message.reply(
        'Usage: `!apps add <key> "Label" #destination [cooldownDays]`\n' +
        'Example: `!apps add helper "Helper Application" #reviews 7`'
      );
    }

    // Crear/actualizar tipo sin preguntas (de momento [])
    const current = client.acdb.getAppType.get(message.guild.id, key);
    client.acdb.upsertAppType.run({
      guild_id: message.guild.id,
      type_key: key,
      type_label: label,
      destination_channel_id: destId,
      questions_json: current?.questions_json ?? '[]',
      active: 1,
      cooldown_days: cooldown ?? current?.cooldown_days ?? null
    });

    await publishPanel(client, message.guild);
    return message.channel.send(`✅ Application **${label}** (\`${key}\`) saved. Dest: <#${destId}>${cooldown!=null?` • Cooldown: ${cooldown}d`:''}`);
  }

  /* ---- update label/dest (OPCIONAL) ---- */
  if (sub === 'update') {
    // !apps update <key> "New Label" #dest
    const key = (args.shift() || '').toLowerCase();
    const app = client.acdb.getAppType.get(message.guild.id, key);
    if (!app) return message.reply('Application not found.');

    let newLabel = app.type_label;
    if (args[0]?.startsWith('"')) {
      const res = consumeQuoted(args);
      newLabel = res.value || newLabel;
      args = res.rest;
    }
    const destRaw = args.shift();
    const destId = destRaw ? parseChannelId(destRaw) : app.destination_channel_id;

    client.acdb.upsertAppType.run({
      guild_id: message.guild.id,
      type_key: key,
      type_label: newLabel,
      destination_channel_id: destId,
      questions_json: app.questions_json,
      active: app.active,
      cooldown_days: app.cooldown_days ?? null
    });

    await publishPanel(client, message.guild);
    return message.channel.send(`✅ Application **${newLabel}** (\`${key}\`) updated. Dest: <#${destId}>`);
  }

  /* ---- QUESTIONS: view / set / append / clear ---- */
  if (sub === 'questions') {
    const action = (args.shift() || '').toLowerCase(); // view|set|append|clear
    const key = (args.shift() || '').toLowerCase();

    if (!['view','set','append','clear'].includes(action) || !key) {
      return message.channel.send('Usage: `!apps questions <view|set|append|clear> <key> [q1|q2|...]`');
    }
    const app = client.acdb.getAppType.get(message.guild.id, key);
    if (!app) return message.reply('Application not found.');

    // --- VIEW ---
    if (action === 'view') {
      let arr = [];
      try { arr = JSON.parse(app.questions_json || '[]'); } catch { arr = []; }

      if (!arr.length) {
        return message.channel.send(`No questions configured for **${app.type_label}** (\`${app.type_key}\`).`);
      }

      const lines = arr.map((raw, i) => {
        const q = String(raw || '');
        const required = (/^\*\s*/.test(q) || /\s*\*$/.test(q));
        const base = q.replace(/^\*\s*/, '').replace(/\s*\*$/, '');
        return `${i + 1}. ${base}${required ? ' *' : ''}`;
      });

      return message.channel.send(
        [
          `**Questions for ${app.type_label}** (\`${app.type_key}\`):`,
          ...lines
        ].join('\n')
      );
    }

    // --- CLEAR ---
    if (action === 'clear') {
      client.acdb.upsertAppType.run({
        guild_id: message.guild.id,
        type_key: key,
        type_label: app.type_label,
        destination_channel_id: app.destination_channel_id,
        questions_json: '[]',
        active: app.active,
        cooldown_days: app.cooldown_days ?? null
      });
      return message.channel.send(`✅ Cleared questions for **${app.type_label}**.`);
    }

    // --- SET / APPEND ---
    const tail = args.join(' ').trim();
    if (!tail) {
      return message.reply('Provide questions separated by `|`. Use `*` to require and `(Yes|No)` for options.\nExample: `Name*|Age|Accept rules?(Yes|No)*`');
    }

    const parts = splitQuestionsInline(tail);
    const toStore = toStoredQuestions(parts);

    let current = [];
    try { current = JSON.parse(app.questions_json || '[]'); } catch { current = []; }

    let finalQs = [];
    if (action === 'set')     finalQs = toStore;
    if (action === 'append')  finalQs = current.concat(toStore).slice(0, 50);

    client.acdb.upsertAppType.run({
      guild_id: message.guild.id,
      type_key: key,
      type_label: app.type_label,
      destination_channel_id: app.destination_channel_id,
      questions_json: JSON.stringify(finalQs),
      active: app.active,
      cooldown_days: app.cooldown_days ?? null
    });

    return message.channel.send(`✅ Saved **${finalQs.length}** question(s) for **${app.type_label}**.`);
  }

  /* ---- enable/disable/delete ---- */
  if (sub === 'enable' || sub === 'disable') {
    const key = (args.shift() || '').toLowerCase();
    const a = client.acdb.getAppType.get(message.guild.id, key);
    if (!a) return message.reply('Application not found.');
    client.acdb.upsertAppType.run({
      guild_id: message.guild.id,
      type_key: key,
      type_label: a.type_label,
      destination_channel_id: a.destination_channel_id,
      questions_json: a.questions_json,
      active: sub === 'enable' ? 1 : 0,
      cooldown_days: a.cooldown_days ?? null
    });
    await publishPanel(client, message.guild);
    return message.channel.send(`✅ Application **${a.type_label}** is now ${sub === 'enable' ? 'enabled' : 'disabled'}.`);
  }

  if (sub === 'delete') {
    const key = (args.shift() || '').toLowerCase();
    const a = client.acdb.getAppType.get(message.guild.id, key);
    if (!a) return message.reply('Application not found.');
    client.acdb.deleteAppType.run(message.guild.id, key);
    await publishPanel(client, message.guild);
    return message.channel.send(`🗑️ Application **${a.type_label}** deleted.`);
  }

  /* ---- list ---- */
  if (sub === 'list') {
    const sGlobal = client.acdb.getAppSettings.get(message.guild.id);
    const globalCD = sGlobal?.cooldown_days ?? 7;
    const apps = client.acdb.listAppTypes.all(message.guild.id);
    if (!apps.length) return message.channel.send('No applications configured.');
    const lines = apps.map(a => {
      let arr = [];
      try { arr = JSON.parse(a.questions_json || '[]'); } catch {}
      const qn = arr.length;
      const reqCount = arr.filter(x => String(x).trim().startsWith('*') || String(x).trim().endsWith('*')).length;
      const cd = (a.cooldown_days == null) ? `${globalCD}d (global)` : `${a.cooldown_days}d`;
      return `• **${a.type_label}** (\`${a.type_key}\`) → Dest: <#${a.destination_channel_id}> — ${a.active ? '✅ active' : '⛔ disabled'} (${qn} q, ${reqCount} req) [cooldown: ${cd}]`;
    });
    return message.channel.send(lines.join('\n'));
  }

  /* ---- per-app cooldown ---- */
  if (sub === 'setcooldownapp') {
    const key = (args.shift() || '').toLowerCase();
    const days = Number(args.shift());
    if (!key) return message.reply('Usage: `!apps setcooldownapp <key> <days>`');
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return message.reply('Days must be between 0 and 365.');
    }
    const a = client.acdb.getAppType.get(message.guild.id, key);
    if (!a) return message.reply('Application not found.');

    client.acdb.upsertAppType.run({
      guild_id: message.guild.id,
      type_key: key,
      type_label: a.type_label,
      destination_channel_id: a.destination_channel_id,
      questions_json: a.questions_json,
      active: a.active,
      cooldown_days: Math.floor(days)
    });

    await publishPanel(client, message.guild);
    return message.channel.send(`✅ Application **${a.type_label}** cooldown set to **${Math.floor(days)} day(s)**.`);
  }

  /* ---- reset cooldown(s) ---- */
  if (sub === 'resetcd') {
    const key = (args.shift() || '').toLowerCase();
    const userArg = args.shift();
    if (!key || !userArg) return message.reply('Usage: `!apps resetcd <key> @user|<id>`');

    const a = client.acdb.getAppType.get(message.guild.id, key);
    if (!a) return message.reply('Application not found.');

    let user = message.mentions.users.first();
    if (!user) {
      try { user = await client.users.fetch(userArg); } catch { return message.reply('Invalid user. Use @mention or ID.'); }
    }

    client.acdb.deleteSubmission.run(message.guild.id, user.id, key);
    return message.channel.send(`✅ Cooldown reset for **${a.type_label}** (\`${key}\`) — ${user}.`);
  }

  if (sub === 'resetcdall') {
    const userArg = args.shift();
    if (!userArg) return message.reply('Usage: `!apps resetcdall @user|<id>`');

    let user = message.mentions.users.first();
    if (!user) {
      try { user = await client.users.fetch(userArg); } catch { return message.reply('Invalid user. Use @mention or ID.'); }
    }

    client.acdb.deleteAllSubmissionsForUser.run(message.guild.id, user.id);
    return message.channel.send(`✅ All application cooldowns cleared for ${user}.`);
  }

  /* ---- rebuild panel ---- */
  if (sub === 'rebuild') {
    await publishPanel(client, message.guild);
    return message.channel.send('✅ Application panel rebuilt.');
  }

  /* ---- view ---- */
  if (sub === 'view') {
    const panel = client.acdb.getApplyPanel.get(message.guild.id);
    const s = client.acdb.getAppSettings.get(message.guild.id);
    const apps = client.acdb.listAppTypes.all(message.guild.id);
    const globalCD = s?.cooldown_days ?? 7;

    const lines = [
      `**Panel Channel:** ${panel?.panel_channel_id ? `<#${panel.panel_channel_id}>` : '—'}`,
      `**Panel Message:** ${panel?.panel_message_id || '—'}`,
      `**Review Log:** ${s?.review_log_channel_id ? `<#${s.review_log_channel_id}>` : '—'}`,
      `**Global Cooldown:** ${globalCD} day(s)`,
      '',
      `**Applications (${apps.length})**:`,
      ...apps.map(a => {
        let arr = [];
        try { arr = JSON.parse(a.questions_json || '[]'); } catch {}
        const qn = arr.length;
        const reqCount = arr.filter(x => String(x).trim().startsWith('*') || String(x).trim().endsWith('*')).length;
        const cd = (a.cooldown_days == null) ? `${globalCD}d (global)` : `${a.cooldown_days}d`;
        return `• **${a.type_label}** (\`${a.type_key}\`) → Dest: <#${a.destination_channel_id}> — ${a.active ? '✅ active' : '⛔ disabled'} (${qn} q, ${reqCount} req) [cooldown: ${cd}]`;
      })
    ];

    return message.channel.send({
      embeds: [new EmbedBuilder().setTitle('Application Panel — Config').setDescription(lines.join('\n')).setColor(0x00AE86)]
    });
  }

  /* ---- help ---- */
  return message.channel.send(
    [
      '**Apps — Commands**',
      '`!apps setup #panel` — set panel channel',
      '`!apps setlog #review-log` — set approve/reject log channel',
      '`!apps cooldown` / `!apps setcooldown <days>` — global cooldown',
      '`!apps add <key> "Label" #dest [cooldownDays]` — create/update type (no questions yet)',
      '`!apps update <key> "New Label" #dest` — change label/destination',
      '`!apps questions <view|set|append|clear> <key> [q1|q2|...]` — use * to require; `(Yes|No)` options',
      '`!apps enable <key>` / `!apps disable <key>`',
      '`!apps delete <key>`',
      '`!apps list`',
      '`!apps setcooldownapp <key> <days>`',
      '`!apps resetcd <key> @user|<id>`',
      '`!apps resetcdall @user|<id>`',
      '`!apps rebuild` / `!apps view`',
    ].join('\n')
  );
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['applications', 'apply', 'apps'],
  permLevel: 'AppsManager',
};

module.exports.help = {
  name: 'apps',
  category: 'admin',
  description: 'Manage application panel and types. Add/update/enable/disable, global & per-app cooldowns, questions, and panel publishing.',
  usage: 'apps setup|setlog|cooldown|setcooldown|add|update|questions|enable|disable|delete|list|setcooldownapp|resetcd|resetcdall|rebuild|view',
};

// export para llamadas externas (opcional)
module.exports.__rebuild = publishPanel;
