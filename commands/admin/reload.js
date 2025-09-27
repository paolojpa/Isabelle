/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
const fs = require('fs');
const path = require('path');

function resolveCommandFile(baseHelp) {
  // Intenta por convención: commands/<category>/<name>.js
  const p = path.resolve(__dirname, '..', baseHelp.category, `${baseHelp.name}.js`);
  if (fs.existsSync(p)) return p;

  // Fallback: busca por filename dentro de /commands
  const commandsRoot = path.resolve(__dirname, '..');
  const targetLower = `${baseHelp.name}.js`.toLowerCase();
  const stack = [commandsRoot];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.toLowerCase() === targetLower) return full;
    }
  }
  return null;
}

module.exports.run = async (client, message, args, level) => {
  const nameArg = (args[0] || '').toLowerCase().trim();
  if (!nameArg) {
    return client.error(message.channel, 'Missing argument', 'Usage: `reload <command name or alias>`');
  }

  // Busca por nombre o alias en la cache actual
  const base =
    client.commands.get(nameArg) ||
    client.commands.get(client.aliases.get(nameArg));

  if (!base || !base.help || !base.help.name) {
    return client.error(message.channel, 'Invalid Command', 'That command name/alias was not found.');
  }

  // Resuelve ruta del archivo
  const filePath = resolveCommandFile(base.help);
  if (!filePath) {
    return client.error(
      message.channel,
      'Path error',
      `Could not resolve file for \`${base.help.category}/${base.help.name}.js\`. Check the file name and category.`
    );
  }

  const oldName = base.help.name.toLowerCase();
  const oldAliases = Array.isArray(base.conf?.aliases) ? [...base.conf.aliases] : [];

  try {
    // Limpia caché del módulo (y de su .js resuelto)
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];

    // Requiere nuevamente
    const fresh = require(resolved);

    // Validaciones mínimas
    if (!fresh || typeof fresh.run !== 'function' || !fresh.help || !fresh.help.name) {
      throw new Error('Reloaded module missing required exports: run/help.name');
    }

    // Quitar aliases viejos
    for (const a of oldAliases) client.aliases.delete(a.toLowerCase());

    // Re-registrar comando
    const newName = fresh.help.name.toLowerCase();
    client.commands.set(newName, fresh);

    // Registrar nuevos aliases
    const newAliases = Array.isArray(fresh.conf?.aliases) ? fresh.conf.aliases : [];
    for (const a of newAliases) client.aliases.set(a.toLowerCase(), newName);

    // Si cambió el nombre, elimina el anterior
    if (newName !== oldName) client.commands.delete(oldName);

    console.log(`[reload] ${oldName} -> reloaded as ${newName} from ${path.relative(process.cwd(), resolved)}`);
    return client.success(
      message.channel,
      'Success!',
      `Reloaded \`${newName}\`${newAliases.length ? ` (aliases: ${newAliases.join(', ')})` : ''}.`
    );
  } catch (err) {
    console.error('[reload] Failed:', err);
    return client.error(
      message.channel,
      'Reload failed',
      '```\n' + (err && err.message ? err.message : String(err)) + '\n```'
    );
  }
};

module.exports.conf = {
  guildOnly: true,
  aliases: [],
  permLevel: 'Bot Owner', // ajusta si quieres
  args: 1,
};

module.exports.help = {
  name: 'reload',
  category: 'system',
  description: 'Reloads the specified command file',
  usage: 'reload <command name or alias>',
};
