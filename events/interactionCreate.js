// events/interactionCreate.js
const {
  ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle,
  ButtonBuilder, ButtonStyle
} = require('discord.js');
const { DateTime } = require('luxon');
const config = require('../config.json');
const { handleApplyInteraction } = require('../structures/applyHandlers');

/* ========= Maps ========= */
const MONTHS = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12
};
const WEEKDAYS = {
  mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,
  thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6,
  sun:7,sunday:7
};

/* ========= Helpers ========= */
function normalizeHemi(val) {
  if (val == null || String(val).trim() === '') return 'both';
  const v = String(val).trim().toLowerCase();
  if (v === 'north' || v === 'n') return 'north';
  if (v === 'south' || v === 's') return 'south';
  if (v === 'both' || v === 'all' || v === 'global') return 'both';
  return null;
}

function parseRule(rule_type, rule_data){
  const t = (rule_type||'').trim().toLowerCase();
  const d = (rule_data||'').trim();

  // fixed: MM/DD
  if (t === 'fixed') {
    const m = /^(\d{1,2})[\/\-](\d{1,2})$/.exec(d);
    if (!m) throw new Error('Use MM/DD for fixed rule.');
    return { rule_type:'fixed', month:Number(m[1]), day:Number(m[2]) };
  }

  // nth_weekday: "2 Saturday April" | "last Sun Aug"
  if (t === 'nth_weekday') {
    const parts = d.split(/\s+/);
    if (parts.length < 3) throw new Error('Use: N WEEKDAY MONTH (e.g., "2 Saturday April" or "last Sun Aug").');
    let nthRaw = parts[0].toLowerCase();
    let nth = (nthRaw === 'last') ? -1 : Number(nthRaw);
    if (isNaN(nth) && nth !== -1) throw new Error('N must be 1..5 or "last".');

    const wd = WEEKDAYS[(parts[1]||'').toLowerCase()];
    if (!wd) throw new Error('Unknown weekday. Use Mon..Sun.');

    const mName = (parts[2]||'').toLowerCase();
    const month = MONTHS[mName] || Number(parts[2]);
    if (!month || month < 1 || month > 12) throw new Error('Unknown month.');

    return { rule_type:'nth_weekday', nth, weekday:wd, month };
  }

  // weekday: "Saturday" | "Sun" → every week
  if (t === 'weekday') {
    const wd = WEEKDAYS[d.toLowerCase()];
    if (!wd) throw new Error('Use a weekday like Monday, Tue, Saturday, etc.');
    return { rule_type:'weekday', weekday: wd };
  }

  // relative: "easter -48"
  if (t === 'relative') {
    const m = /^easter\s+(-?\d+)$/.exec(d.toLowerCase());
    if (!m) throw new Error('Use: easter <offsetDays> (e.g., "easter -48").');
    return { rule_type:'relative', rel_anchor:'easter', rel_offset_days:Number(m[1]) };
  }

  throw new Error('rule_type must be fixed | nth_weekday | relative | weekday');
}

// Parsear user id desde @mención o ID
function parseUserId(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = /^<@!?(\d{17,20})>$/.exec(s);
  if (m) return m[1];
  if (/^\d{17,20}$/.test(s)) return s;
  return null;
}

// Responder ephemeral (flags:64)
async function respond(interaction, options) {
  const payload = { ...options };
  if (payload.ephemeral) { delete payload.ephemeral; payload.flags = 64; }
  try {
    if (interaction.deferred) return await interaction.followUp({ ...payload, flags: 64 });
    if (interaction.replied)  return await interaction.followUp({ ...payload, flags: 64 });
    return await interaction.reply({ ...payload, flags: 64 });
  } catch {
    try { return await interaction.followUp({ ...payload, flags: 64 }); } catch {}
  }
}

// Defer ephemeral seguro
async function safeDeferEphemeral(interaction) {
  try {
    return await interaction.deferReply({ flags: 64 });
  } catch {
    try { return await interaction.deferReply({ ephemeral: true }); } catch {}
  }
}

/* ========= Main handler ========= */
module.exports = async (client, interaction) => {
  /* ---------- APPS: Bloqueo de review para solo Apps Manager ---------- */
  if (interaction.isButton() && interaction.customId?.startsWith('apply_review:')) {
    const appsRoleId = config.roles?.apps_role_id;
    const hasAppsRole = appsRoleId && appsRoleId !== '0' && interaction.member?.roles?.cache?.has(appsRoleId);
    if (!hasAppsRole) {
      return interaction.reply({
        content: '❌ You are not allowed to review applications. (Apps Manager role required)',
        flags: 64
      });
    }
    // si tiene el rol, dejamos que el handler de aplicaciones procese más abajo
  }

  /* ---------- VILLAGERS, SPECIAL EVENTS y STAFF EVENTS (Modals y Botones) ---------- */
  if (interaction.isModalSubmit()) {
    // ===================== VILLAGERS =====================
    if (interaction.customId === 'v_add_modal') {
      const name = interaction.fields.getTextInputValue('name').trim();
      const month = Number(interaction.fields.getTextInputValue('month'));
      const day = Number(interaction.fields.getTextInputValue('day'));
      const image = interaction.fields.getTextInputValue('image')?.trim() || null;

      if (!name || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) {
        return respond(interaction, { content: 'Invalid data. Month 1-12, Day 1-31.' });
      }

      const exists = client.acdb.db
        .prepare('SELECT 1 FROM villagers WHERE LOWER(name)=LOWER(?) AND month=? AND day=?')
        .get(name, month, day);
      if (exists) return respond(interaction, { content: `⚠️ Villager **${name}** (${month}/${day}) is already registered.` });

      await safeDeferEphemeral(interaction);
      client.acdb.addVillager.run(name, month, day, image);
      return interaction.editReply({ content: `✅ Added **${name}** (${month}/${day})` }).catch(() => {});
    }

    if (interaction.customId === 'v_edit_select') {
      const id = Number(interaction.fields.getTextInputValue('id'));
      const v = client.acdb.getVillagerById.get(id);
      if (!v) return respond(interaction, { content: 'ID not found.' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`v_edit_open_${id}`).setLabel('Open editor').setStyle(ButtonStyle.Primary)
      );
      return respond(interaction, { content: `Villager **#${id} ${v.name}** found. Click to open the editor:`, components: [row] });
    }

    if (interaction.customId.startsWith('v_edit_modal_')) {
      const id = Number(interaction.customId.split('_').pop());
      const name = interaction.fields.getTextInputValue('name').trim();
      const month = Number(interaction.fields.getTextInputValue('month'));
      const day = Number(interaction.fields.getTextInputValue('day'));
      const image = interaction.fields.getTextInputValue('image')?.trim() || null;

      if (!name || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) {
        return respond(interaction, { content: 'Invalid data.' });
      }

      await safeDeferEphemeral(interaction);
      client.acdb.updateVillager.run(name, month, day, image, id);
      return interaction.editReply({ content: `✏️ Updated **#${id} ${name}** (${month}/${day})` }).catch(() => {});
    }

    if (interaction.customId === 'v_del_select') {
      const id = Number(interaction.fields.getTextInputValue('id'));
      const v = client.acdb.getVillagerById.get(id);
      if (!v) return respond(interaction, { content: 'ID not found.' });

      await safeDeferEphemeral(interaction);
      client.acdb.deleteVillager.run(id);
      return interaction.editReply({ content: `🗑️ Deleted **#${id} ${v.name}**` }).catch(() => {});
    }

    // ===================== SPECIAL EVENTS (AC) =====================
    if (interaction.customId === 'se_add_modal') {
      const title = interaction.fields.getTextInputValue('title').trim();
      const rule_type = interaction.fields.getTextInputValue('rule_type')?.trim();
      const rule_data = interaction.fields.getTextInputValue('rule_data')?.trim();
      const hemisphereRaw = interaction.fields.getTextInputValue('hemisphere')?.trim();
      const pingRaw = interaction.fields.getTextInputValue('ping')?.trim();

      const hemi = normalizeHemi(hemisphereRaw);
      if (!title || !hemi) return respond(interaction, { content: 'Invalid data. Hemisphere must be north/south/both.' });

      let rule;
      try { rule = parseRule(rule_type, rule_data); }
      catch (e) { return respond(interaction, { content: `Rule error: ${e.message}` }); }

      const ping_required = (/^(yes|y|true|1)$/i.test(pingRaw || 'no')) ? 1 : 0;

      await safeDeferEphemeral(interaction);
      client.acdb.addSEv2.run({
        title,
        text: null,
        rule_type: rule.rule_type,
        month: rule.month ?? null,
        day: rule.day ?? null,
        nth: rule.nth ?? null,
        weekday: rule.weekday ?? null,
        rel_anchor: rule.rel_anchor ?? null,
        rel_offset_days: rule.rel_offset_days ?? null,
        hemisphere: hemi,
        image_url: null,
        ping_required
      });

      return interaction.editReply({ content: `✅ Added **${title}** (${rule_type}) • Ping: ${ping_required ? 'yes' : 'no'}` }).catch(() => {});
    }

    if (interaction.customId === 'se_edit_select') {
      const id = Number(interaction.fields.getTextInputValue('id'));
      const e = client.acdb.getSEv2ById.get(id);
      if (!e) return respond(interaction, { content: 'ID not found.' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`se_edit_open_${id}`).setLabel('Edit rule/date').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`se_edit_details_open_${id}`).setLabel('Edit details').setStyle(ButtonStyle.Secondary)
      );
      return respond(interaction, { content: `Event **#${id} ${e.title}** found. Choose what to edit:`, components: [row] });
    }

    if (interaction.customId.startsWith('se_edit_modal_')) {
      const id = Number(interaction.customId.split('_').pop());
      const title = interaction.fields.getTextInputValue('title').trim();
      const rule_type = interaction.fields.getTextInputValue('rule_type')?.trim();
      const rule_data = interaction.fields.getTextInputValue('rule_data')?.trim();
      const hemisphereRaw = interaction.fields.getTextInputValue('hemisphere')?.trim();
      const pingRaw = interaction.fields.getTextInputValue('ping')?.trim();

      const hemi = normalizeHemi(hemisphereRaw);
      if (!title || !hemi) return respond(interaction, { content: 'Invalid data. Hemisphere must be north/south/both.' });

      const existing = client.acdb.getSEv2ById.get(id);
      if (!existing) return respond(interaction, { content: 'ID not found.' });

      let rule;
      try { rule = parseRule(rule_type, rule_data); }
      catch (e) { return respond(interaction, { content: `Rule error: ${e.message}` }); }

      const ping_required = (/^(yes|y|true|1)$/i.test(pingRaw || String(existing.ping_required ? 'yes' : 'no'))) ? 1 : 0;

      await safeDeferEphemeral(interaction);
      client.acdb.updateSEv2.run({
        id,
        title,
        text: existing.text || null,
        rule_type: rule.rule_type,
        month: rule.month ?? null,
        day: rule.day ?? null,
        nth: rule.nth ?? null,
        weekday: rule.weekday ?? null,
        rel_anchor: rule.rel_anchor ?? null,
        rel_offset_days: rule.rel_offset_days ?? null,
        hemisphere: hemi,
        image_url: existing.image_url || null,
        ping_required
      });

      return interaction.editReply({ content: `✏️ Updated **#${id} ${title}** (${rule_type}) • Ping: ${ping_required ? 'yes' : 'no'}` }).catch(() => {});
    }

    if (interaction.customId.startsWith('se_edit_details_modal_')) {
      const id = Number(interaction.customId.split('_').pop());
      const existing = client.acdb.getSEv2ById.get(id);
      if (!existing) return respond(interaction, { content: 'ID not found.' });

      const text = interaction.fields.getTextInputValue('text')?.trim() || null;
      const image = interaction.fields.getTextInputValue('image')?.trim() || null;

      await safeDeferEphemeral(interaction);
      client.acdb.updateSEv2.run({
        id,
        title: existing.title,
        text,
        rule_type: existing.rule_type,
        month: existing.month,
        day: existing.day,
        nth: existing.nth,
        weekday: existing.weekday,
        rel_anchor: existing.rel_anchor,
        rel_offset_days: existing.rel_offset_days,
        hemisphere: existing.hemisphere,
        image_url: image,
        ping_required: existing.ping_required ?? 0
      });

      return interaction.editReply({ content: `✅ Updated details for **#${id} ${existing.title}**` }).catch(() => {});
    }

    if (interaction.customId === 'se_del_select') {
      const id = Number(interaction.fields.getTextInputValue('id'));
      const e = client.acdb.getSEv2ById.get(id);
      if (!e) return respond(interaction, { content: 'ID not found.' });

      await safeDeferEphemeral(interaction);
      client.acdb.deleteSEv2.run(id);
      return interaction.editReply({ content: `🗑️ Deleted **#${id} ${e.title}**` }).catch(() => {});
    }

 // ===================== STAFF EVENTS (ADD / EDIT / DELETE) =====================

if (interaction.customId === 'staffse_add_modal') {
  const userRaw   = interaction.fields.getTextInputValue('user')?.trim();
  const title     = interaction.fields.getTextInputValue('title')?.trim();
  const rule_type = interaction.fields.getTextInputValue('rule_type')?.trim();
  const rule_data = interaction.fields.getTextInputValue('rule_data')?.trim();
  const image     = interaction.fields.getTextInputValue('image')?.trim() || null;

  const userId = parseUserId(userRaw);
  if (!userId) return respond(interaction, { content: 'Invalid user. Use @mention or numeric ID.' });
  if (!title)  return respond(interaction, { content: 'Title is required.' });

  let rule;
  try { rule = parseRule(rule_type, rule_data); }
  catch (e) { return respond(interaction, { content: `Rule error: ${e.message}` }); }

  await safeDeferEphemeral(interaction);
  client.acdb.addStaffEv.run({
    guild_id: interaction.guild.id,
    user_id: userId,
    title,
    rule_type: rule.rule_type,
    month: rule.month ?? null,
    day: rule.day ?? null,
    nth: rule.nth ?? null,
    weekday: rule.weekday ?? null,
    rel_anchor: rule.rel_anchor ?? null,
    rel_offset_days: rule.rel_offset_days ?? null,
    image_url: image
  });

  return interaction.editReply({ content: `✅ Staff event added for <@${userId}> — ${title}` }).catch(() => {});
}

// ---- STAFF: EDIT (open modal from button) ----
if (interaction.isButton() && interaction.customId.startsWith('staffse_edit_open_')) {
  const id = Number(interaction.customId.split('_').pop());
  const row = client.acdb.getStaffEvById.get(interaction.guild.id, id); // (guild_id, id)
  if (!row) return respond(interaction, { content: 'ID not found.' });

  // Prefill rule_data based on rule_type
  const ruleDataPrefill = (() => {
    if (row.rule_type === 'fixed') {
      return String(row.month).padStart(2, '0') + '/' + String(row.day).padStart(2, '0');
    }
    if (row.rule_type === 'nth_weekday') {
      const nthStr = (row.nth === -1) ? 'last' : String(row.nth);
      const wd = ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][row.weekday] || 'Sat';
      const monName = DateTime.fromObject({month: row.month}).toFormat('LLLL');
      return `${nthStr} ${wd} ${monName}`;
    }
    if (row.rule_type === 'relative') return `easter ${row.rel_offset_days || 0}`;
    if (row.rule_type === 'weekday') {
      const names = ['','Mon','Tue','Wed','Thu','Fri','Saturday','Sunday'];
      return names[row.weekday] || 'Saturday';
    }
    return '';
  })();

  // Open Modal for Editing
  const modal = new ModalBuilder().setCustomId(`staffse_edit_modal_${id}`).setTitle(`Edit Staff Event #${id}`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user').setLabel('User (@mention or ID)').setStyle(TextInputStyle.Short).setValue(`<@${row.user_id}>`).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setValue(row.title).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rule_type').setLabel('Rule Type').setStyle(TextInputStyle.Short).setValue(row.rule_type).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rule_data').setLabel('Rule Data').setStyle(TextInputStyle.Short).setValue(ruleDataPrefill).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image URL').setStyle(TextInputStyle.Short).setValue(row.image_url || '').setRequired(false)),
  );
  await interaction.showModal(modal).catch(() => {});
  return;
}

// ---- STAFF: EDIT (guardar) ----
if (interaction.customId.startsWith('staffse_edit_modal_')) {
  const idStr = interaction.customId.split('_').pop();
  const id = parseInt(idStr, 10);
  if (!Number.isInteger(id)) return respond(interaction, { content: 'Invalid ID in modal.' });

  const userRaw = interaction.fields.getTextInputValue('user')?.trim();
  const title = interaction.fields.getTextInputValue('title')?.trim();
  const rule_type = interaction.fields.getTextInputValue('rule_type')?.trim();
  const rule_data = interaction.fields.getTextInputValue('rule_data')?.trim();
  const image = interaction.fields.getTextInputValue('image')?.trim() || null;

  const userId = parseUserId(userRaw);
  if (!userId) return respond(interaction, { content: 'Invalid user. Use @mention or numeric ID.' });
  if (!title) return respond(interaction, { content: 'Title is required.' });

  let rule;
  try { rule = parseRule(rule_type, rule_data); }
  catch (e) { return respond(interaction, { content: `Rule error: ${e.message}` }); }

  await safeDeferEphemeral(interaction);
  client.acdb.updateStaffEv.run({
    id,
    guild_id: interaction.guild.id,
    user_id: userId,
    title,
    rule_type: rule.rule_type,
    month: rule.month ?? null,
    day: rule.day ?? null,
    nth: rule.nth ?? null,
    weekday: rule.weekday ?? null,
    rel_anchor: rule.rel_anchor ?? null,
    rel_offset_days: rule.rel_offset_days ?? null,
    image_url: image
  });

  return interaction.editReply({ content: `✏️ Updated staff event **#${id}** — <@${userId}> • ${title}` }).catch(() => {});
}

// ---- STAFF: DELETE (seleccionar por ID) ----
if (interaction.customId === 'staffse_del_select') {
  const idRaw = (interaction.fields.getTextInputValue('id') || '').trim();
  if (!/^\d+$/.test(idRaw)) {
    return respond(interaction, { content: 'Invalid ID. Use a numeric ID.' });
  }
  const id = parseInt(idRaw, 10);

  const row = client.acdb.getStaffEvById.get(interaction.guild.id, id); // (guild_id, id)
  if (!row) return respond(interaction, { content: 'ID not found.' });

  await safeDeferEphemeral(interaction);
  client.acdb.deleteStaffEv.run(interaction.guild.id, id); // (guild_id, id)
  return interaction.editReply({ content: `🗑️ Deleted staff event **#${id}** — <@${row.user_id}> • ${row.title}` }).catch(() => {});
}

  }

  if (interaction.isButton()) {
    // Villager open editor
    if (interaction.customId.startsWith('v_edit_open_')) {
      const id = Number(interaction.customId.split('_').pop());
      const v = client.acdb.getVillagerById.get(id);
      if (!v) return respond(interaction, { content: 'ID not found.' });

      const modal = new ModalBuilder().setCustomId(`v_edit_modal_${id}`).setTitle(`Edit #${id}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setValue(v.name).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('month').setLabel('Month (1-12)').setStyle(TextInputStyle.Short).setValue(String(v.month)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('day').setLabel('Day (1-31)').setStyle(TextInputStyle.Short).setValue(String(v.day)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image (URL)').setStyle(TextInputStyle.Short).setValue(v.image_url || '').setRequired(false)),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    // SE open editor (rules/hemisphere + ping)
    if (interaction.customId.startsWith('se_edit_open_')) {
      const id = Number(interaction.customId.split('_').pop());
      const e = client.acdb.getSEv2ById.get(id);
      if (!e) return respond(interaction, { content: 'ID not found.' });

      const ruleDataPrefill = (() => {
        if (e.rule_type === 'fixed') {
          return String(e.month).padStart(2,'0') + '/' + String(e.day).padStart(2,'0');
        }
        if (e.rule_type === 'nth_weekday') {
          const nthStr = (e.nth === -1) ? 'last' : String(e.nth);
          const wd = ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][e.weekday] || 'Sat';
          const monName = DateTime.fromObject({month:e.month}).toFormat('LLLL');
          return `${nthStr} ${wd} ${monName}`;
        }
        if (e.rule_type === 'relative') {
          return `easter ${e.rel_offset_days || 0}`;
        }
        if (e.rule_type === 'weekday') {
          const names = ['','Mon','Tue','Wed','Thu','Fri','Saturday','Sunday'];
          return names[e.weekday] || 'Saturday';
        }
        return '';
      })();

      const modal = new ModalBuilder().setCustomId(`se_edit_modal_${id}`).setTitle(`Edit #${id}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setValue(e.title).setRequired(true)),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('rule_type').setLabel('Rule Type').setStyle(TextInputStyle.Short).setValue(e.rule_type).setRequired(true)
            .setPlaceholder('fixed | nth_weekday | relative | weekday')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('rule_data').setLabel('Rule Data').setStyle(TextInputStyle.Short).setValue(ruleDataPrefill).setRequired(true)
            .setPlaceholder('04/29 | 2 Saturday April | easter -48 | Saturday')
        ),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hemisphere').setLabel('Hemisphere (north/south/both)').setStyle(TextInputStyle.Short).setValue(e.hemisphere || 'both').setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ping').setLabel('Ping (yes/no)').setStyle(TextInputStyle.Short).setValue(e.ping_required ? 'yes' : 'no').setRequired(true))
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    if (interaction.customId.startsWith('se_edit_details_open_')) {
      const id = Number(interaction.customId.split('_').pop());
      const e = client.acdb.getSEv2ById.get(id);
      if (!e) return respond(interaction, { content: 'ID not found.' });

      const modal = new ModalBuilder().setCustomId(`se_edit_details_modal_${id}`).setTitle(`Edit details #${id}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Text (optional)').setStyle(TextInputStyle.Paragraph).setValue(e.text || '').setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image (URL, optional)').setStyle(TextInputStyle.Short).setValue(e.image_url || '').setRequired(false))
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }
  }

  /* ---------- Delegación a sistema de Applications ---------- */
  try {
    await handleApplyInteraction(client, interaction);
  } catch {
    // noop
  }
};
