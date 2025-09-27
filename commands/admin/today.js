const config = require('../../config.json');

module.exports.run = async (client, message, args, level) => {
  const adminRole = config.roles.admin_role_id;
  const modRole = config.roles.mod_role_id;
  const isAdmin = adminRole !== "0" && message.member.roles.cache.has(adminRole);
  const isMod = isAdmin || (modRole !== "0" && message.member.roles.cache.has(modRole));
  if (!isMod) return message.reply('You do not have permission.');

  await client.acCalendar.postDaily(message.guild).catch(() => {});
  return message.react('✅').catch(() => {});
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['posttoday', 'actoday'],
  permLevel: 'Moderator',
};

module.exports.help = {
  name: 'today',
  category: 'ac',
  description: 'Posts today\'s calendar manually (for testing).',
  usage: 'today',
};