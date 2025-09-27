const { EmbedBuilder } = require('discord.js');

module.exports.run = async (client, message) => {
  const embed = new EmbedBuilder()
    .setTitle('📅 Special Events — Rule Help')
    .setColor(0x00AE86)
    .setDescription(
`You can create **Special Events** with these rule types:

**1️⃣ Fixed date**
\`rule_type: fixed\`
\`rule_data: 04/29\`
➡ Fires every year on **April 29**.

**2️⃣ Nth weekday of a month**
\`rule_type: nth_weekday\`
\`rule_data: 2 Saturday April\`
➡ Fires on the **2nd Saturday of April** each year.

Examples:
- \`1 Monday September\` → 1st Monday of September
- \`last Sunday August\` → Last Sunday of August

**3️⃣ Relative to Easter**
\`rule_type: relative\`
\`rule_data: easter -48\`
➡ Fires **48 days before Easter** (day before Mardi Gras).

**4️⃣ Every specific weekday (weekly)**
\`rule_type: weekday\`
\`rule_data: Saturday\`
➡ Fires **every Saturday**, all year.

---

**Extra fields (optional unless stated):**
- **Hemisphere** *(required)*: \`north\`, \`south\`, or \`both\`
  - Displayed as **(Northern Hemisphere)** or **(Southern Hemisphere)** in posts.
- **Image** *(optional)*: direct image URL
- **Text** *(optional)*: short description shown after the title

**Posting behavior:**
- If there is **at least one** Special Event on a given day and the role is configured,
  the bot mentions **@Event news** **only on the last Special Event line**.
- Villager birthdays and global notes are listed above events; images (villagers/events)
  are attached to the post.

**Tips:**
- Modals accept up to **5 fields**; you can **Edit details** later to add/change *Text* or *Image*.
- Examples of \`rule_type\` values: \`fixed | nth_weekday | relative | weekday\`.
- Examples of \`rule_data\`:
  - \`04/29\`
  - \`2 Saturday April\`
  - \`last Sunday August\`
  - \`easter -48\`
  - \`Saturday\`
`
    );

  await message.channel.send({ embeds: [embed] });
};

module.exports.conf = {
  guildOnly: true,
  aliases: ['seguide'],
  permLevel: 'CalendarManager',
};

module.exports.help = {
  name: 'sehelp',
  category: 'ac',
  description: 'Shows help for Special Events rule types and syntax.',
  usage: 'sehelp',
};
