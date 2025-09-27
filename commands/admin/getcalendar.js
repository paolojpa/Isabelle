const config = require('../../config.json');

module.exports.run = async (client, message, args, level) => {
  const cfg = client.acdb.getGuildCfg.get(message.guild.id);

  if (!cfg) {
    return message.reply('⚠️ This server does not have a calendar configured. Use `!setcalendar` first.');
  }

  const channel = message.guild.channels.cache.get(cfg.channel_id) || `ID: ${cfg.channel_id}`;
  const channelDisplay = channel?.toString() || 'Unknown';

  return message.channel.send(
    `📅 **Calendar settings for this server**\n` +
    `• Channel: ${channelDisplay}\n` +
    `• Post Hour: ${cfg.post_hour}:00\n` +
    `• Timezone: ${cfg.timezone}`
  );
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['calendarinfo', 'getcal'],
  permLevel: 'Admin',
};

module.exports.help = {
  name: 'getcalendar',
  category: 'ac',
  description: 'Displays the current calendar settings for this server',
  usage: 'getcalendar',
};
