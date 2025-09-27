// commands/util/level.js
const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

function computeLevel(member) {
  const hasRole = (id) => id && id !== '0' && member.roles.cache.has(id);

  const isAdmin    = hasRole(config.roles?.admin_role_id);
  const isMod      = isAdmin || hasRole(config.roles?.mod_role_id);
  const isApps     = isMod   || hasRole(config.roles?.apps_role_id);
  const isCalendar = isApps  || hasRole(config.roles?.calendar_role_id);

  let level = 0;
  if (isAdmin) level = 5;
  else if (isMod) level = 4;
  else if (isApps) level = 3;
  else if (isCalendar) level = 2;

  // nombre legible
  const name =
    level === 5 ? 'Admin' :
    level === 4 ? 'Mod' :
    level === 3 ? 'Apps Manager' :
    level === 2 ? 'Calendar Manager' :
    'User';

  return { level, name, flags: { isAdmin, isMod, isApps, isCalendar } };
}

module.exports.run = async (client, message, args /* levelFromIndexNoNeeded */) => {
  // Resolver objetivo: @mention | ID | autor
  let targetMember = message.member;

  if (args[0]) {
    const id = (args[0].match(/^<@!?(\d+)>$/)?.[1]) || args[0];
    try {
      const m = await message.guild.members.fetch(id);
      if (m) targetMember = m;
    } catch {
      return message.reply('Could not find that user. Use a mention or a valid ID.');
    }
  }

  const { level, name, flags } = computeLevel(targetMember);

  const rolesTxt = [
    `Admin: **${flags.isAdmin ? '✅' : '❌'}**`,
    `Mod: **${flags.isMod ? '✅' : '❌'}**`,
    `Apps Manager: **${flags.isApps ? '✅' : '❌'}**`,
    `Calendar Manager: **${flags.isCalendar ? '✅' : '❌'}**`,
  ].join(' • ');

  // Permisos prácticos por nivel
  const canApplyManage     = level >= 3; // !apply
  const canVillagersManage = level >= 2; // !villagers
  const canCalendarConfig  = level >= 5; // !setcalendar
  const canAdminOnly       = level >= 5; // reboot, owner stuff

  const permsTxt = [
    `Manage Applications (!apply): **${canApplyManage ? '✅' : '❌'}**`,
    `Manage Villagers (!villagers): **${canVillagersManage ? '✅' : '❌'}**`,
    `Calendar Config (!setcalendar): **${canCalendarConfig ? '✅' : '❌'}**`,
    `Admin-only: **${canAdminOnly ? '✅' : '❌'}**`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: `${targetMember.user.tag}`, iconURL: targetMember.user.displayAvatarURL() })
    .setTitle('Permission Level')
    .addFields(
      { name: 'Level', value: `**${level}** — ${name}`, inline: true },
      { name: 'Roles match', value: rolesTxt, inline: false },
      { name: 'Capabilities', value: permsTxt, inline: false },
    );

  return message.channel.send({ embeds: [embed] });
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['rank', 'permlevel'],
  permLevel: 'CalendarManager',
};

module.exports.help = {
  name: 'level',
  category: 'info',
  description: 'Shows your (or another user’s) permission level and capabilities.',
  usage: 'level [@user|id]',
};
