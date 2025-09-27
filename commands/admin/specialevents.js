// commands/admin/specialevents.js
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder
} = require('discord.js');
const { DateTime } = require('luxon');

module.exports.run = async (client, message, args, level) => {
  // Paginación
  const pageSize = 10;
  let page = 0;

  const total = client.acdb.countSEv2.get().c;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  // Helpers de formato
  const hemiLabel = (h) => {
    if (!h || h === 'both') return '';
    const v = (h + '').toLowerCase();
    if (v === 'north') return ' (Northern Hemisphere)';
    if (v === 'south') return ' (Southern Hemisphere)';
    return '';
  };
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

  // Construir embed de página
  const makeEmbed = () => {
    const rows = client.acdb.listSEv2Page.all(pageSize, page * pageSize);
    const desc = rows.length
      ? rows.map(e => {
          const ruleStr = fmtRule(e);
          const hemi = hemiLabel(e.hemisphere);
          const txt = e.text ? ` — ${e.text}` : '';
          const cam = e.image_url ? ' 📷' : '';
          const bell = e.ping_required ? ' 🔔' : ''; // indicador de ping
          return `\`${e.id}\` — **${e.title}** — ${ruleStr}${hemi}${txt}${cam}${bell}`;
        }).join('\n')
      : '_No special events yet._';

    return new EmbedBuilder()
      .setTitle('Special Events (rules v2)')
      .setDescription(desc)
      .setFooter({ text: `Page ${page + 1}/${maxPage + 1} • Total: ${total}` })
      .setColor(0xFEE75C);
  };

  // Fila de botones
  const makeButtons = () =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('se_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
      new ButtonBuilder().setCustomId('se_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage),
      new ButtonBuilder().setCustomId('se_add').setLabel('Add').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('se_edit').setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('se_del').setLabel('Delete').setStyle(ButtonStyle.Danger),
    );

  const panel = await message.channel.send({ embeds: [makeEmbed()], components: [makeButtons()] });

  // Collector para los botones (solo el autor del comando)
  const collector = panel.createMessageComponentCollector({
    time: 1000 * 60 * 5,
    filter: i => i.user.id === message.author.id
  });

  collector.on('collect', async (i) => {
    try {
      if (i.customId === 'se_prev') {
        page = Math.max(0, page - 1);
        await i.update({ embeds: [makeEmbed()], components: [makeButtons()] });
        return;
      }
      if (i.customId === 'se_next') {
        page = Math.min(maxPage, page + 1);
        await i.update({ embeds: [makeEmbed()], components: [makeButtons()] });
        return;
      }

      // --- ADD modal (5 inputs máx.) —> ahora con PING en vez de IMAGE
      if (i.customId === 'se_add') {
        const modal = new ModalBuilder().setCustomId('se_add_modal').setTitle('Add Special Event');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rule_type').setLabel('Rule Type').setStyle(TextInputStyle.Short).setRequired(true)
              .setPlaceholder('fixed | nth_weekday | relative | weekday')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rule_data').setLabel('Rule Data').setStyle(TextInputStyle.Short).setRequired(true)
              .setPlaceholder('04/29 | 2 Saturday April | easter -48 | Saturday')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('hemisphere').setLabel('Hemisphere (north/south/both)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('ping').setLabel('Ping (yes/no)').setStyle(TextInputStyle.Short).setRequired(true)
              .setPlaceholder('yes | no')
          )
        );
        await i.showModal(modal);
        return;
      }

      // --- EDIT: pedir ID (los modales detallados se abren en interactionCreate)
      if (i.customId === 'se_edit') {
        const modal = new ModalBuilder().setCustomId('se_edit_select').setTitle('Edit Special Event');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('id').setLabel('Event ID').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
        await i.showModal(modal);
        return;
      }

      // --- DELETE: pedir ID
      if (i.customId === 'se_del') {
        const modal = new ModalBuilder().setCustomId('se_del_select').setTitle('Delete Special Event');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('id').setLabel('Event ID').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
        await i.showModal(modal);
        return;
      }
    } catch (err) {
      try { await i.reply({ content: 'Something went wrong.', ephemeral: true }); } catch {}
    }
  });

  collector.on('end', async () => {
    panel.edit({ components: [] }).catch(() => {});
  });
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['se', 'specials'],
  permLevel: 'CalendarManager'
};

module.exports.help = {
  name: 'specialevents',
  category: 'ac',
  description: 'Panel to manage special events (paginated list + Add/Edit/Delete)',
  usage: 'specialevents'
};
