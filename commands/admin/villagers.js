const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

module.exports.run = async (client, message, args, level) => {
  // ✅ Solo por level del index: Admin(4), Mod(3), CalendarManager(2)
  if (level < 2) {
    return message.reply('You do not have permission to manage villagers.');
  }

  const pageSize = 10;
  let page = 0;

  const total = client.acdb.countVillagers.get().c;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  const getPageEmbed = () => {
    const rows = client.acdb.listVillagersPage.all(pageSize, page * pageSize); // A→Z desde acdb.js
    const desc = rows.length
      ? rows.map(v => {
          const mm = String(v.month).padStart(2, '0');
          const dd = String(v.day).padStart(2, '0');
          return `**${v.name}** — ID: \`${v.id}\` (${mm}/${dd})${v.image_url ? ' 📷' : ''}`;
        }).join('\n')
      : '_No villagers yet._';

    return new EmbedBuilder()
      .setTitle(`Villagers — Total: ${total}`)
      .setDescription(desc)
      .setFooter({ text: `Page ${page + 1}/${maxPage + 1} • Total: ${total}` })
      .setColor(0x5865F2);
  };

  const buttons = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('v_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId('v_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage),
    new ButtonBuilder().setCustomId('v_add').setLabel('Add').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('v_edit').setLabel('Edit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('v_del').setLabel('Delete').setStyle(ButtonStyle.Danger),
  );

  const panel = await message.channel.send({ embeds: [getPageEmbed()], components: [buttons()] });

  const collector = panel.createMessageComponentCollector({
    time: 1000 * 60 * 5,
    filter: i => i.user.id === message.author.id
  });

  collector.on('collect', async (i) => {
    try {
      if (i.customId === 'v_prev') {
        page = Math.max(0, page - 1);
        await i.update({ embeds: [getPageEmbed()], components: [buttons()] });
      } else if (i.customId === 'v_next') {
        page = Math.min(maxPage, page + 1);
        await i.update({ embeds: [getPageEmbed()], components: [buttons()] });
      } else if (i.customId === 'v_add') {
        const modal = new ModalBuilder().setCustomId('v_add_modal').setTitle('Add Villager');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('month').setLabel('Month (1-12)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('day').setLabel('Day (1-31)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image (URL, optional)').setStyle(TextInputStyle.Short).setRequired(false)),
        );
        await i.showModal(modal);
      } else if (i.customId === 'v_edit') {
        const modal = new ModalBuilder().setCustomId('v_edit_select').setTitle('Edit Villager (by ID)');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Villager ID').setStyle(TextInputStyle.Short).setRequired(true))
        );
        await i.showModal(modal);
      } else if (i.customId === 'v_del') {
        const modal = new ModalBuilder().setCustomId('v_del_select').setTitle('Delete Villager (by ID)');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Villager ID').setStyle(TextInputStyle.Short).setRequired(true))
        );
        await i.showModal(modal);
      }
    } catch {
      // noop
    }
  });

  collector.on('end', async () => {
    panel.edit({ components: [] }).catch(() => {});
  });
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['villagers', 'vill'],
  permLevel: 'CalendarManager',
};

module.exports.help = {
  name: 'villagers',
  category: 'ac',
  description: 'Villager panel to list/add/edit/delete.',
  usage: 'villagers',
};
