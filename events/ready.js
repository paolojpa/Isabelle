const { startScheduler } = require('../structures/acScheduler');

module.exports = async (client) => {
  console.log(`Logged in as ${client.user.tag}`);
  startScheduler(client);
};