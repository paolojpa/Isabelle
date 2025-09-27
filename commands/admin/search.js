// commands/admin/search.js
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

module.exports.run = async (client, message, args, level) => {
  if (!message.guild) return;
  const query = args.join(' ').trim();
  if (!query) return message.reply('Usage: `search <villager name>`');

  // Search up to 25 matches
  const stmt = client.acdb.db.prepare('SELECT * FROM villagers WHERE name LIKE ? ORDER BY month, day, name LIMIT 25');
  const rows = stmt.all('%' + query + '%');

  if (!rows.length) {
    return message.reply('No villagers found for `' + query + '`.');
  }

  function makeEmbed(selectedId) {
    const lines = rows.map(function (v) {
      const sel = (selectedId === v.id) ? '👉 ' : '';
      return sel + '`' + v.id + '` — **' + v.name + '** (' + v.month + '/' + v.day + ')' + (v.image_url ? ' 📷' : '');
    });
    return new EmbedBuilder()
      .setTitle('Search results: "' + query + '"')
      .setDescription(lines.join('\n'))
      .setColor(0x2b2d31);
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('v_search_select')
    .setPlaceholder('Select a villager')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(rows.map(function (v) {
      const label = v.name.length > 100 ? (v.name.slice(0, 97) + '...') : v.name;
      const desc = ('ID ' + v.id + ' — ' + v.month + '/' + v.day).slice(0, 100);
      return { label: label, description: desc, value: String(v.id) };
    }));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('v_search_edit').setLabel('Edit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('v_search_delete').setLabel('Delete').setStyle(ButtonStyle.Danger)
  );

  const rowSelect = new ActionRowBuilder().addComponents(select);
  const panel = await message.channel.send({ embeds: [makeEmbed()], components: [rowSelect, buttons] });

  let currentId = rows[0].id;

  const collector = panel.createMessageComponentCollector({
    time: 1000 * 60 * 5,
    filter: function (i) { return i.user.id === message.author.id; }
  });

  collector.on('collect', async function (i) {
    try {
      if (i.isStringSelectMenu() && i.customId === 'v_search_select') {
        currentId = Number(i.values[0]);
        await i.update({ embeds: [makeEmbed(currentId)], components: [rowSelect, buttons] });
        return;
      }

      if (i.isButton() && i.customId === 'v_search_edit') {
        const v = client.acdb.getVillagerById.get(currentId);
        if (!v) return i.reply({ content: 'Selected villager not found.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId('v_edit_modal_' + currentId).setTitle('Edit #' + currentId);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setValue(v.name).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('month').setLabel('Month (1-12)').setStyle(TextInputStyle.Short).setValue(String(v.month)).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('day').setLabel('Day (1-31)').setStyle(TextInputStyle.Short).setValue(String(v.day)).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image (URL)').setStyle(TextInputStyle.Short).setValue(v.image_url || '').setRequired(false))
        );
        await i.showModal(modal);
        return;
      }

      if (i.isButton() && i.customId === 'v_search_delete') {
        const v = client.acdb.getVillagerById.get(currentId);
        if (!v) return i.reply({ content: 'Selected villager not found.', ephemeral: true });

        const confirm = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('v_search_confirm_del').setLabel('Confirm delete').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('v_search_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        await i.update({ embeds: [makeEmbed(currentId)], components: [rowSelect, confirm] });

        const confirmCollector = panel.createMessageComponentCollector({
          time: 1000 * 60,
          filter: function (ii) { return ii.user.id === message.author.id; }
        });

        confirmCollector.on('collect', async function (ii) {
          if (!ii.isButton()) return;
          if (ii.customId === 'v_search_cancel') {
            await ii.update({ embeds: [makeEmbed(currentId)], components: [rowSelect, buttons] });
            confirmCollector.stop();
            return;
          }
          if (ii.customId === 'v_search_confirm_del') {
            client.acdb.deleteVillager.run(currentId);
            const idx = rows.findIndex(function (r) { return r.id === currentId; });
            if (idx !== -1) rows.splice(idx, 1);
            if (!rows.length) {
              await ii.update({ content: '✅ Deleted. No more results.', embeds: [], components: [] });
              confirmCollector.stop();
              collector.stop();
              return;
            }
            currentId = rows[0].id;
            const newSelect = new StringSelectMenuBuilder()
              .setCustomId('v_search_select')
              .setPlaceholder('Select a villager')
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(rows.map(function (v) {
                const label = v.name.length > 100 ? (v.name.slice(0, 97) + '...') : v.name;
                const desc = ('ID ' + v.id + ' — ' + v.month + '/' + v.day).slice(0, 100);
                return { label: label, description: desc, value: String(v.id) };
              }));
            const newRowSelect = new ActionRowBuilder().addComponents(newSelect);
            await ii.update({ embeds: [makeEmbed(currentId)], components: [newRowSelect, buttons] });
            confirmCollector.stop();
            return;
          }
        });

        return;
      }
    } catch (err) {
      try { await i.reply({ content: 'Something went wrong.', ephemeral: true }); } catch {}
    }
  });

  collector.on('end', async function () {
    try { await panel.edit({ components: [] }); } catch {}
  });
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['find'],
  permLevel: 'Moderator',
};

module.exports.help = {
  name: 'search',
  category: 'ac',
  description: 'Search villagers by name and quickly edit/delete them.',
  usage: 'search <villager name>',
};
