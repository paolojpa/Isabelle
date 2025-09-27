// index.js
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const path = require('path');
const fs = require('fs');
const config = require('./config.json');
const { initACDB } = require('./structures/acdb');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
client.aliases = new Collection();

// Basic helpers
client.success = (ch, title, msg) => ch.send(`✅ **${title}** — ${msg}`);
client.error   = (ch, title, msg) => ch.send(`❌ **${title}** — ${msg}`);

// DB
initACDB(client);

// Events
const eventsPath = path.join(__dirname, 'events');
fs.readdirSync(eventsPath).forEach(file => {
  if (!file.endsWith('.js')) return;
  const evt = require(path.join(eventsPath, file));
  const rawName = file.split('.')[0];

  // Compat: mapear "ready" → "clientReady" para v15
  const eventName = rawName === 'ready' ? 'clientReady' : rawName;
  const handler = evt.bind(null, client);

  if (eventName === 'clientReady') {
    client.once(eventName, handler);
    // opcional: también escuchar "ready" (v14)
    client.once('ready', handler);
  } else {
    client.on(eventName, handler);
  }
});

// Commands loader (recursivo)
function loadCmdDir(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return loadCmdDir(p);
    if (!entry.name.endsWith('.js')) return;
    const cmd = require(p);
    const help = cmd.help || {};
    const conf = cmd.conf || {};
    const name = (help.name || '').toLowerCase();
    client.commands.set(name, cmd);
    if (conf.aliases) conf.aliases.forEach(a => client.aliases.set(a.toLowerCase(), name));
  });
}
loadCmdDir(path.join(__dirname, 'commands'));

// Prefix router
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const prefix = config.prefix || '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmdName = (args.shift() || '').toLowerCase();

  const cmd =
    client.commands.get(cmdName) ||
    client.commands.get(client.aliases.get(cmdName));

  if (!cmd) return;

  // ------- Niveles de rol (nueva jerarquía) -------
  // Admin (5) > Mod (4) > AppsManager (3) > CalendarManager (2) > User (0)
  const hasRole = (id) => id && id !== "0" && message.member.roles.cache.has(id);

  const isAdmin    = hasRole(config.roles?.admin_role_id);
  const isMod      = isAdmin || hasRole(config.roles?.mod_role_id);
  const isApps     = isMod   || hasRole(config.roles?.apps_role_id);      // nuevo rol
  const isCalendar = isApps  || hasRole(config.roles?.calendar_role_id);

  let level = 0;
  if (isAdmin) level = 5;
  else if (isMod) level = 4;
  else if (isApps) level = 3;
  else if (isCalendar) level = 2;

  try {
    await cmd.run(client, message, args, level);
  } catch (e) {
    console.error(e);
    client.error(message.channel, 'Error', 'There was an error running that command.');
  }
});

client.login(config.token);
