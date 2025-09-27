// structures/applyHandlers.js
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  TextInputBuilder, TextInputStyle, ModalBuilder
} = require('discord.js');
const config = require('../config.json');

// Sesiones en memoria para formularios paginados
if (!global.__applySessions) global.__applySessions = new Map();

/* ---------- Helpers de nivel ---------- */
function levelFromMember(member) {
  const hasRole = (id) => id && id !== "0" && member?.roles?.cache?.has(id);
  const isAdmin = hasRole(config.roles?.admin_role_id);
  const isMod   = isAdmin || hasRole(config.roles?.mod_role_id);
  return isAdmin ? 4 : (isMod ? 3 : 0);
}
function secondsToDHm(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
const trunc = (s, n) => String(s || '').slice(0, n);

/* ---------- Parser de preguntas ---------- */
/**
 * Soporta:
 *  - Requerido con asterisco: "*Pregunta" o "Pregunta*"
 *  - Opciones con paréntesis: "Pregunta(op1|op2|op3)"
 * Devuelve objetos: { text, required, options?[] }
 */
function normalizeQuestions(raw) {
  let arr = [];
  try { arr = Array.isArray(raw) ? raw : JSON.parse(String(raw || '[]')); } catch { arr = []; }

  return arr
    .map((q) => {
      let text = String(q || '').trim();
      let required = false;

      if (text.startsWith('*') || text.endsWith('*')) {
        required = true;
        text = text.replace(/^\*\s*/, '').replace(/\s*\*$/, '').trim();
      }

      let options = null;
      const m = /(.*)\(([^()]+)\)\s*$/.exec(text);
      if (m) {
        text = m[1].trim();
        options = m[2].split('|').map(s => s.trim()).filter(Boolean);
      }

      const out = { text, required };
      if (options && options.length) out.options = options;
      return out;
    })
    .filter(q => q.text.length > 0)
    .slice(0, 10); // límite sano
}

/* ---------- Construcción de Modal ---------- */
function buildModal(typeKey, typeLabel, questions, page = 0) {
  const modal = new ModalBuilder()
    .setCustomId(`apply_modal_page:${typeKey}:${page}`)
    .setTitle(trunc(`${typeLabel} — Page ${page + 1}`, 45));

  const start = page * 5;
  const slice = questions.slice(start, start + 5);

  slice.forEach((q, idx) => {
    const ti = new TextInputBuilder()
      .setCustomId(`q_${idx}`)
      .setLabel(trunc(q.text + (q.required ? ' *' : ''), 45))
      .setRequired(Boolean(q.required));

    if (Array.isArray(q.options) && q.options.length) {
      // Campo corto con opciones sugeridas
      ti.setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setPlaceholder(`Choose: ${q.options.join(' | ')}`);
    } else {
      // Campo de párrafo con límite explícito
      ti.setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1024);
    }

    modal.addComponents(new ActionRowBuilder().addComponents(ti));
  });

  return modal;
}

/* ---------- Validación de respuestas vs opciones ---------- */
function validateAnswerAgainstOptions(answer, options) {
  if (!Array.isArray(options) || !options.length) return true;
  const norm = String(answer || '').trim().toLowerCase();
  return options.some(o => o.toLowerCase() === norm);
}
function optionsErrorText(options) {
  return `Please answer with one of: **${options.join(' | ')}**`;
}

/* ---------- Embed de envío (fields de usuario + preguntas) ---------- */
function buildSubmissionEmbed(guild, typeLabel, typeKey, user, answers, questions) {
  const createdUnix = user?.createdAt ? Math.floor(user.createdAt.getTime() / 1000) : null;
  const member = guild?.members?.cache?.get(user.id);
  const joinedUnix = member?.joinedAt ? Math.floor(member.joinedAt.getTime() / 1000) : null;

  const userFields = [
    {
      name: 'Applicant',
      value: `${user}`,
      inline: true
    },
    {
      name: 'User ID',
      value: `\`${user.id}\``,
      inline: true
    },
    {
      name: 'Account Created',
      value: createdUnix ? `<t:${createdUnix}:F>; <t:${createdUnix}:R>` : '—',
      inline: false
    },
    {
      name: `Joined ${guild?.name || 'this server'}`,
      value: joinedUnix ? `<t:${joinedUnix}:F>; <t:${joinedUnix}:R>` : '—',
      inline: false
    }
  ];

  const qFields = questions.map((q, i) => ({
    name: trunc(`${i + 1}. ${q.text}`, 256),
    value: trunc(answers[i] || '—', 1024) || '—',
    inline: false
  }));

  return new EmbedBuilder()
    .setTitle(`📝 New Application — ${typeLabel}`)
    .addFields([...userFields, ...qFields])
    .setFooter({ text: `ID: ${user.id}` })
    .setTimestamp(new Date())
    .setColor(0xFEE75C);
}

function reviewButtons(typeKey, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`apply_review:approve:${typeKey}:${userId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`apply_review:reject:${typeKey}:${userId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
  );
}

/* ============== Handler principal ============== */
async function handleApplyInteraction(client, interaction) {
  // ====== INICIAR APLICACIÓN ======
  if (interaction.isButton() && interaction.customId.startsWith('apply_start:')) {
    const typeKey = interaction.customId.split(':')[1];
    const t = client.acdb.getAppType.get(interaction.guild.id, typeKey);
    if (!t || !t.active) {
      return interaction.reply({ content: 'This application type is not available.', flags: 64 });
    }

    // Cargar y normalizar preguntas
    let rawQs;
    try { rawQs = JSON.parse(t.questions_json || '[]'); } catch { rawQs = []; }
    const questions = normalizeQuestions(rawQs);
    if (!questions.length) {
      return interaction.reply({ content: 'This application type is misconfigured (no questions).', flags: 64 });
    }

    // Cooldown por tipo (fallback a global)
    const settings = client.acdb.getAppSettings.get(interaction.guild.id);
    const globalCD = settings?.cooldown_days ?? 7;
    const cooldownDays = (t.cooldown_days == null) ? globalCD : t.cooldown_days;

    if (cooldownDays > 0) {
      const last = client.acdb.getLastSubmission.get(interaction.guild.id, interaction.user.id, typeKey);
      if (last?.submitted_at) {
        const now = Math.floor(Date.now() / 1000);
        const delta = now - Number(last.submitted_at);
        const need = cooldownDays * 86400;
        if (delta < need) {
          return interaction.reply({
            content: `⏳ You can apply for **${t.type_label}** again in **${secondsToDHm(need - delta)}**.`,
            flags: 64
          });
        }
      }
    }

    // Paginado de 5 preguntas por modal
    const pages = [];
    for (let i = 0; i < questions.length; i += 5) pages.push(questions.slice(i, i + 5));

    const key = `${interaction.guild.id}:${interaction.user.id}:${typeKey}`;
    global.__applySessions.set(key, { typeKey, questions, pages, pageIndex: 0, answers: [] });

    return interaction.showModal(buildModal(typeKey, t.type_label, questions, 0));
  }

  // ====== MODALES (páginas) ======
  if (interaction.isModalSubmit() && interaction.customId.startsWith('apply_modal_page:')) {
    const [, typeKey, pageStr] = interaction.customId.split(':');
    const pageIndex = Number(pageStr) || 0;

    const t = client.acdb.getAppType.get(interaction.guild.id, typeKey);
    if (!t) return interaction.reply({ content: 'Type not found.', flags: 64 });

    const key = `${interaction.guild.id}:${interaction.user.id}:${typeKey}`;
    const sess = global.__applySessions.get(key);
    if (!sess) return interaction.reply({ content: 'Session expired. Click the button again.', flags: 64 });

    const { questions } = sess;
    const group = questions.slice(pageIndex * 5, pageIndex * 5 + 5);

    // Leer respuestas y validar (required + options)
    for (let i = 0; i < group.length; i++) {
      const q = group[i];
      const val = (interaction.fields.getTextInputValue(`q_${i}`) || '').trim();

      if (q.required && !val) {
        return interaction.reply({ content: `Question **"${q.text}"** is required.`, flags: 64 });
      }
      if (Array.isArray(q.options) && q.options.length && val && !validateAnswerAgainstOptions(val, q.options)) {
        return interaction.reply({ content: `**${q.text}**: ${optionsErrorText(q.options)}`, flags: 64 });
      }

      // Seguridad adicional: cap según tipo de campo
      const safeVal = (Array.isArray(q.options) && q.options.length) ? val.slice(0, 100) : val.slice(0, 1024);
      sess.answers.push(safeVal);
    }

    // Siguiente página
    const totalPages = Math.ceil(questions.length / 5);
    if (pageIndex + 1 < totalPages) {
      sess.pageIndex = pageIndex + 1;
      global.__applySessions.set(key, sess);
      await interaction.reply({ content: `Page ${pageIndex + 1} saved. Opening next page...`, flags: 64 }).catch(()=>{});
      return interaction.showModal(buildModal(typeKey, t.type_label, questions, sess.pageIndex));
    }

    // Última página → Publicar en canal de revisión
    const dest = await interaction.guild.channels.fetch(t.destination_channel_id).catch(() => null);
    if (!dest) {
      global.__applySessions.delete(key);
      return interaction.reply({ content: 'Destination channel not found.', flags: 64 });
    }

    const embed = buildSubmissionEmbed(interaction.guild, t.type_label, typeKey, interaction.user, sess.answers, questions);
    const row = reviewButtons(typeKey, interaction.user.id);

    // Publica la aplicación
    const appMsg = await dest.send({ embeds: [embed], components: [row] }).catch(()=>null);

    // Reacciones de voto del staff
    if (appMsg) {
      try { await appMsg.react('✅'); } catch {}
      try { await appMsg.react('❌'); } catch {}
    }

    // Crea un thread de discusión para el staff (topic = ID del usuario)
    if (appMsg?.startThread) {
      try {
        const threadName = trunc(`${t.type_label} — ${interaction.user.username} (${interaction.user.id})`, 100);
        await appMsg.startThread({
          name: threadName,
          autoArchiveDuration: 4320, // 3 días
          reason: `Discussion for ${t.type_label} application from ${interaction.user.tag}`
        });
        // Establecer topic con el puro ID (si la API del canal lo soporta)
        if (appMsg.thread?.setAppliedTags || appMsg.thread?.setAutoArchiveDuration || appMsg.thread?.setLocked) {
          // Algunas guilds no permiten setTopic en thread; intentamos vía edit si está disponible
        }
        // Intento seguro de setear el topic si la lib lo expone:
        try { if (appMsg.thread?.setTopic) await appMsg.thread.setTopic(String(interaction.user.id)); } catch {}
        try { if (appMsg.thread?.edit) await appMsg.thread.edit({ topic: String(interaction.user.id) }).catch(()=>{}); } catch {}
      } catch { /* noop */ }
    }

    // Registrar envío para cooldown
    const nowEpoch = Math.floor(Date.now() / 1000);
    client.acdb.upsertSubmissionNow.run(interaction.guild.id, interaction.user.id, typeKey, nowEpoch);

    global.__applySessions.delete(key);
    return interaction.reply({ content: '✅ Your application was submitted. Thank you!', flags: 64 });
  }

  // ====== APROBAR / RECHAZAR ======
  if (interaction.isButton() && interaction.customId.startsWith('apply_review:')) {
    const lvl = levelFromMember(interaction.member);
    if (lvl < 3) return interaction.reply({ content: 'You do not have permission to review applications.', flags: 64 });

    const [, action, typeKey, userId] = interaction.customId.split(':');

    // actualizar embed y remover botones
    const edited = EmbedBuilder.from(interaction.message.embeds[0] || {});
    edited.setFooter({ text: `${action === 'approve' ? '✅ Approved' : '❌ Rejected'} by ${interaction.user.tag}` });
    await interaction.update({ embeds: [edited], components: [] }).catch(()=>{});

    // 🔒 Cerrar thread si existe
    try {
      const msg = interaction.message;
      if (msg?.hasThread && msg.thread) {
        await msg.thread.send(`${action === 'approve' ? '✅ **Accepted**' : '❌ **Rejected**'} by ${interaction.user}.`).catch(()=>{});
        await msg.thread.setLocked(true).catch(()=>{});
        await msg.thread.setArchived(true, action === 'approve' ? 'Application accepted' : 'Application rejected').catch(()=>{});
      }
    } catch { /* noop */ }

    // log (si está configurado)
    const s = client.acdb.getAppSettings.get(interaction.guild.id);
    if (s?.review_log_channel_id) {
      const logCh = await interaction.guild.channels.fetch(s.review_log_channel_id).catch(()=>null);
      if (logCh) {
        await logCh.send(
          `${action === 'approve' ? '✅ **APPROVED**' : '❌ **REJECTED**'} — \`${typeKey}\`\n` +
          `Applicant: <@${userId}> (\`${userId}\`)\n` +
          `By: ${interaction.user} (\`${interaction.user.id}\`) — in ${interaction.channel}`
        ).catch(()=>{});
      }
    }
  }
}

module.exports = { handleApplyInteraction };
