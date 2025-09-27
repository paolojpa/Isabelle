const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder
} = require('discord.js');
const { DateTime } = require('luxon');

function parseUserId(raw) {
  if (!raw) return null;
  const m = /<@!?(\d+)>/.exec(raw);
  if (m) return m[1];
  if (/^\d{17,20}$/.test(raw)) return raw;
  return null;
}

// Re-usa helper para mostrar reglas
const nthSuffix = (n) => {
  if (n === -1) return 'last';
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
function fmtRule(e) {
  if (e.rule_type === 'fixed') {
    return `Fixed: ${String(e.month).padStart(2,'0')}/${String(e.day).padStart(2,'0')}`;
  }
  if (e.rule_type === 'nth_weekday') {
    const nth = e.nth === -1 ? 'Last' : nthSuffix(e.nth);
    const weekday = ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][e.weekday] || 'Saturday';
    const monthName = DateTime.fromObject({ month: e.month }).toFormat('LLLL');
    return `${nth} ${weekday} of ${monthName}`;
  }
  if (e.rule_type === 'relative') {
    const off = Number(e.rel_offset_days || 0);
    return `Easter ${off >= 0 ? '+' + off : off}d`;
  }
  if (e.rule_type === 'weekday') {
    const weekday = ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][e.weekday] || 'Saturday';
    return `Every ${weekday}`;
  }
  return e.rule_type || '';
}

// Parse de rule_type + rule_data (igual que usas en interactionCreate)
function parseRule(rule_type, rule_data) {
  const t = (rule_type||'').trim().toLowerCase();
  const d = (rule_data||'').trim();

  if (t === 'fixed') {
    const m = /^(\d{1,2})[\/\-](\d{1,2})$/.exec(d);
    if (!m) throw new Error('Use MM/DD for fixed rule.');
    return { rule_type:'fixed', month:Number(m[1]), day:Number(m[2]) };
  }

  if (t === 'nth_weekday') {
    const parts = d.split(/\s+/);
    if (parts.length < 3) throw new Error('Use: N WEEKDAY MONTH (e.g., "2 Saturday April" or "last Sun Aug").');
    let nthRaw = parts[0].toLowerCase();
    let nth = (nthRaw === 'last') ? -1 : Number(nthRaw);
    if (isNaN(nth) && nth !== -1) throw new Error('N must be 1..5 or "last".');

    const WEEKDAYS = { mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6,sun:7,sunday:7 };
    const wd = WEEKDAYS[(parts[1]||'').toLowerCase()];
    if (!wd) throw new Error('Unknown weekday. Use Mon..Sun.');

    const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
    const mName = (parts[2]||'').toLowerCase();
    const month = MONTHS[mName] || Number(parts[2]);
    if (!month || month < 1 || month > 12) throw new Error('Unknown month.');

    return { rule_type:'nth_weekday', nth, weekday:wd, month };
  }

  if (t === 'weekday') {
    const WEEKDAYS = { mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6,sun:7,sunday:7 };
    const wd = WEEKDAYS[d.toLowerCase()];
    if (!wd) throw new Error('Use a weekday like Monday, Tue, Saturday, etc.');
    return { rule_type:'weekday', weekday: wd };
  }

  if (t === 'relative') {
    const m = /^easter\s+(-?\d+)$/.exec(d.toLowerCase());
    if (!m) throw new Error('Use: easter <offsetDays> (e.g., "easter -48").');
    return { rule_type:'relative', rel_anchor:'easter', rel_offset_days:Number(m[1]) };
  }

  throw new Error('rule_type must be fixed | nth_weekday | relative | weekday');
}

module.exports.run = async (client, message, args, level) => {
  if (level < 3) return message.reply('You do not have permission. (CalendarManager / Mods / Admins)');

  const sub = (args.shift() || '').toLowerCase();

  console.log("Comando ejecutado: staffevents, subcomando:", sub);  // Log de depuración

  // ---------- setchannels ----------
  if (sub === 'setchannels') {
    console.log("Ejecutando subcomando setchannels...");  // Log de depuración
    const [a,b,c] = args;
    const ch1 = message.mentions.channels.first()?.id || (a || '').replace(/[<#>]/g, '');
    const ch2 = (message.mentions.channels.at(1)?.id) || (b || '').replace(/[<#>]/g, '') || null;
    const ch3 = (message.mentions.channels.at(2)?.id) || (c || '').replace(/[<#>]/g, '') || null;

    if (!ch1) return message.reply('Usage: `!staffevents setchannels #channel1 [#channel2] [#channel3]`');

    console.log(`Canales seleccionados: ${ch1}, ${ch2}, ${ch3}`);  // Log de depuración

    client.acdb.upsertStaffEvChannels.run({
      guild_id: message.guild.id,
      ch1, ch2, ch3
    });

    return message.channel.send(`✅ Staff events announcement channels set: ${['<#'+ch1+'>', ch2?'<#'+ch2+'>':'—', ch3?'<#'+ch3+'>':'—'].join(' | ')}`);
  }

  // ---------- Panel paginado ----------
  const pageSize = 10;
  let page = Math.max(0, parseInt(args[0] || '1', 10) - 1) || 0;

  const total = client.acdb.countStaffEv.get(message.guild.id)?.c || 0;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  console.log(`Total de eventos de staff: ${total}, página actual: ${page + 1}`);  // Log de depuración

  const makeEmbed = () => {
    const rows = client.acdb.listStaffEvPage.all(message.guild.id, pageSize, page * pageSize);
    const desc = rows.length
      ? rows.map(e => {
          const ruleStr = fmtRule(e);
          const cam = e.image_url ? ' 📷' : '';
          return `\`${e.id}\` — <@${e.user_id}> — **${e.title}** — ${ruleStr}${cam}`;
        }).join('\n')
      : '_No staff events yet._';

    return new EmbedBuilder()
      .setTitle('Staff Events')
      .setDescription(desc)
      .setFooter({ text: `Page ${page + 1}/${maxPage + 1} • Total: ${total}` })
      .setColor(0x00AE86);
  };

  // Generate per-event edit/delete buttons
  const makeEventButtons = () => {
    const rows = client.acdb.listStaffEvPage.all(message.guild.id, pageSize, page * pageSize);
    return rows.map(e => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`staffse_edit_open_${e.id}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`staffse_del_open_${e.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
    ));
  };

  const makePanelButtons = () =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('se_staff_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
      new ButtonBuilder().setCustomId('se_staff_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage),
      new ButtonBuilder().setCustomId('se_staff_add').setLabel('Add').setStyle(ButtonStyle.Success)
    );

  const panel = await message.channel.send({
    embeds: [makeEmbed()],
    components: [makePanelButtons(), ...makeEventButtons()]
  });

  console.log("Panel de eventos de staff enviado.");  // Log de depuración

  const collector = panel.createMessageComponentCollector({
    time: 1000 * 60 * 5,
    filter: i => i.user.id === message.author.id
  });

  collector.on('collect', async (i) => {
    console.log(`Interacción recibida: ${i.customId}`);  // Log de depuración
    try {
      if (i.customId === 'se_staff_prev') {
        page = Math.max(0, page - 1);
        await i.update({ embeds: [makeEmbed()], components: [makePanelButtons(), ...makeEventButtons()] });
        console.log("Página anterior seleccionada.");  // Log de depuración
        return;
      }
      if (i.customId === 'se_staff_next') {
        page = Math.min(maxPage, page + 1);
        await i.update({ embeds: [makeEmbed()], components: [makePanelButtons(), ...makeEventButtons()] });
        console.log("Página siguiente seleccionada.");  // Log de depuración
        return;
      }

      // ADD
      if (i.customId === 'se_staff_add') {
        console.log("Botón 'Add' presionado");  // Log de depuración
        const modal = new ModalBuilder().setCustomId('staffse_add_modal').setTitle('Add Staff Event');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user').setLabel('User (@mention or ID)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title (e.g., Birthday)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rule_type').setLabel('Rule Type').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('fixed | nth_weekday | relative | weekday')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rule_data').setLabel('Rule Data').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('04/29 | 2 Saturday April | easter -48 | Saturday')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image (URL, optional)').setStyle(TextInputStyle.Short).setRequired(false)),
        );
        await i.showModal(modal);
        console.log("Modal mostrado para agregar evento de staff");  // Log de depuración
        return;
      }

      // EDIT
      if (i.customId.startsWith('staffse_edit_open_')) {
        const eventId = i.customId.split('_').pop();
        console.log(`Botón 'Edit' presionado para el evento ${eventId}`);  // Log de depuración
        const event = client.acdb.getStaffEvById.get(message.guild.id, Number(eventId));
        if (!event) return i.reply({ content: 'Event not found.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId('staffse_edit_modal').setTitle('Edit Staff Event');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user').setLabel('User (@mention or ID)').setStyle(TextInputStyle.Short).setRequired(true).setValue(event.user_id != null ? `<@${String(event.user_id)}>` : '')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title (e.g., Birthday)').setStyle(TextInputStyle.Short).setRequired(true).setValue(event.title != null ? String(event.title) : '')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rule_type').setLabel('Rule Type').setStyle(TextInputStyle.Short).setRequired(true).setValue(event.rule_type != null ? String(event.rule_type) : '').setPlaceholder('fixed | nth_weekday | relative | weekday')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rule_data').setLabel('Rule Data').setStyle(TextInputStyle.Short).setRequired(true).setValue(event.rule_data != null ? String(event.rule_data) : '').setPlaceholder('04/29 | 2 Saturday April | easter -48 | Saturday')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image (URL, optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(event.image_url != null ? String(event.image_url) : '')),
        );
        await i.showModal(modal);
        console.log("Modal mostrado para editar evento de staff");  // Log de depuración
        return;
      }

      // DELETE
      if (i.customId.startsWith('staffse_del_open_')) {
        const eventId = i.customId.split('_').pop();
        console.log(`Botón 'Delete' presionado para el evento ${eventId}`);  // Log de depuración
        const event = client.acdb.getStaffEvById.get(message.guild.id, Number(eventId));
        if (!event) return i.reply({ content: 'Event not found.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId('staffse_del_modal').setTitle('Delete Staff Event');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Event ID').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(event.id))),
        );
        await i.showModal(modal);
        console.log("Modal mostrado para eliminar evento de staff");  // Log de depuración
        return;
      }
    } catch (err) {
      console.error("Error al manejar la interacción: ", err);  // Log de error
      try { await i.reply({ content: 'Something went wrong.', ephemeral: true }); } catch {}
    }
  });

  collector.on('end', async () => {
    panel.edit({ components: [] }).catch(() => {});
    console.log("Colección de interacciones terminada, panel actualizado.");  // Log de depuración
  });
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['staffse', 'se-staff'],
  permLevel: 'CalendarManager'
};

module.exports.help = {
  name: 'staffevents',
  category: 'ac',
  description: 'Panel to manage staff events (birthdays, anniversaries). Also: setchannels.',
  usage: 'staffevents [page] | staffevents setchannels #a [#b] [#c]'
};
