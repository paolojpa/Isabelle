const { DateTime } = require('luxon');
const config = require('../../config.json');

module.exports.run = async (client, message, args, level) => {
  let channel = message.channel;
  let postHour = Number(config.defaults?.post_hour ?? 9);
  let timezone = config.defaults?.timezone ?? 'America/New_York';

  if (args[0] && message.mentions.channels.first()) {
    channel = message.mentions.channels.first();
    args.shift(); 
  }

  // Hora
  if (args[0]) {
    const hour = Number(args[0]);
    if (!isNaN(hour) && hour >= 0 && hour <= 23) {
      postHour = hour;
      args.shift();
    } else {
      return message.reply('⚠️ Invalid hour. Use 0–23.');
    }
  }

  // Timezone: lo que quede junto
  if (args.length > 0) {
    timezone = args.join(' ').trim();
    const dt = DateTime.now().setZone(timezone);
    if (!dt.isValid) {
      return message.reply('⚠️ Invalid timezone. Example: `America/New_York`');
    }
  }

  client.acdb.upsertGuildCfg.run({
    guild_id: message.guild.id,
    channel_id: channel.id,
    post_hour: postHour,
    timezone: timezone
  });

  return message.channel.send(
    `✅ Calendar configured!\n` +
    `• Channel: ${channel}\n` +
    `• Post Hour: ${postHour}:00\n` +
    `• Timezone: ${timezone}`
  );
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['setcal'],
  permLevel: 'Admin',
};

module.exports.help = {
  name: 'setcalendar',
  category: 'ac',
  description: 'Configure the calendar channel, hour, and timezone for this server',
  usage: 'setcalendar [#channel] [hour] [timezone]',
};
