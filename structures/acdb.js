// structures/acdb.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function initACDB(client) {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'ac_events.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  // ---------- Esquema base ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id   TEXT PRIMARY KEY,
      channel_id TEXT,
      post_hour  INTEGER DEFAULT 9,
      timezone   TEXT DEFAULT 'America/New_York'
    );

    CREATE TABLE IF NOT EXISTS villagers (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      month     INTEGER NOT NULL,
      day       INTEGER NOT NULL,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS special_events_v2 (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      title            TEXT NOT NULL,
      text             TEXT,
      rule_type        TEXT NOT NULL,
      month            INTEGER,
      day              INTEGER,
      nth              INTEGER,
      weekday          INTEGER,
      rel_anchor       TEXT,
      rel_offset_days  INTEGER,
      hemisphere       TEXT DEFAULT 'both',
      image_url        TEXT,
      ping_required    INTEGER DEFAULT 0
    );

    -- Idempotencia de posts diarios
    CREATE TABLE IF NOT EXISTS daily_post_log (
      guild_id TEXT NOT NULL,
      iso_date TEXT NOT NULL, -- YYYY-MM-DD
      PRIMARY KEY (guild_id, iso_date)
    );
  `);

  // ---------- APLICACIONES ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications_panel (
      guild_id TEXT PRIMARY KEY,
      panel_channel_id TEXT,
      panel_message_id TEXT
    );

    CREATE TABLE IF NOT EXISTS application_types (
      guild_id TEXT NOT NULL,
      type_key TEXT NOT NULL,
      type_label TEXT NOT NULL,
      destination_channel_id TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      cooldown_days INTEGER,
      PRIMARY KEY (guild_id, type_key)
    );

    CREATE TABLE IF NOT EXISTS applications_settings (
      guild_id TEXT PRIMARY KEY,
      review_log_channel_id TEXT,
      cooldown_days INTEGER DEFAULT 7
    );

    CREATE TABLE IF NOT EXISTS applications_submissions (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      type_key TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, type_key)
    );
  `);

  // ---------- STAFF EVENTS ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id         TEXT NOT NULL,
      user_id          TEXT NOT NULL,
      title            TEXT NOT NULL,
      rule_type        TEXT NOT NULL,     -- fixed | nth_weekday | relative | weekday
      month            INTEGER,
      day              INTEGER,
      nth              INTEGER,
      weekday          INTEGER,
      rel_anchor       TEXT,
      rel_offset_days  INTEGER,
      image_url        TEXT
    );

    CREATE TABLE IF NOT EXISTS staff_events_channels (
      guild_id TEXT PRIMARY KEY,
      ch1 TEXT,
      ch2 TEXT,
      ch3 TEXT
    );
  `);

  // ---------- Migraciones idempotentes ----------
  try { db.exec('ALTER TABLE applications_settings ADD COLUMN cooldown_days INTEGER DEFAULT 7'); } catch {}
  try { db.exec('ALTER TABLE application_types ADD COLUMN cooldown_days INTEGER'); } catch {}
  try { db.exec('ALTER TABLE special_events_v2 ADD COLUMN ping_required INTEGER DEFAULT 0'); } catch {}

  // (Migración desde tabla vieja si existiera)
  try {
    const hasOld = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'special_events\'').get();
    const v2count = db.prepare('SELECT COUNT(*) AS c FROM special_events_v2').get().c;
    if (hasOld && Number(v2count) === 0) {
      const oldRows = db.prepare('SELECT * FROM special_events').all();
      const insertNew = db.prepare(`
        INSERT INTO special_events_v2
          (title, text, rule_type, month, day, hemisphere, image_url, ping_required)
        VALUES
          (@title, @text, 'fixed', @month, @day, COALESCE(@hemisphere,'both'), @image_url, 0)
      `);
      const tx = db.transaction((rows) => {
        for (const r of rows) insertNew.run(r);
      });
      tx(oldRows);
    }
  } catch {}

  // Dedupe simple para v2 (opcional)
  try {
    db.exec(`
      DELETE FROM special_events_v2
      WHERE id NOT IN (
        SELECT MIN(id) FROM special_events_v2
        GROUP BY
          title, rule_type,
          COALESCE(month, -1), COALESCE(day, -1),
          COALESCE(nth, -1), COALESCE(weekday, -1),
          COALESCE(rel_anchor, ''), COALESCE(rel_offset_days, 0),
          COALESCE(hemisphere, 'both'),
          COALESCE(image_url, ''),
          COALESCE(ping_required, 0)
      );
    `);
  } catch {}

  // ---------- Statements ----------
  const stmts = {
    // guild config
    upsertGuildCfg: db.prepare(`
      INSERT INTO guild_config(guild_id, channel_id, post_hour, timezone)
      VALUES(@guild_id, @channel_id, @post_hour, @timezone)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id=excluded.channel_id,
        post_hour=excluded.post_hour,
        timezone=excluded.timezone
    `),
    getGuildCfg: db.prepare('SELECT * FROM guild_config WHERE guild_id=?'),

    // villagers
    addVillager: db.prepare('INSERT INTO villagers(name, month, day, image_url) VALUES(?,?,?,?)'),
    updateVillager: db.prepare('UPDATE villagers SET name=?, month=?, day=?, image_url=? WHERE id=?'),
    deleteVillager: db.prepare('DELETE FROM villagers WHERE id=?'),
    getVillagersByDate: db.prepare('SELECT * FROM villagers WHERE month=? AND day=? ORDER BY name ASC'),
    getVillagerById: db.prepare('SELECT * FROM villagers WHERE id=?'),
    listVillagersPage: db.prepare('SELECT * FROM villagers ORDER BY LOWER(name) ASC LIMIT ? OFFSET ?'),
    countVillagers: db.prepare('SELECT COUNT(*) AS c FROM villagers'),

    // special events v2
    addSEv2: db.prepare(`
      INSERT INTO special_events_v2
        (title, text, rule_type, month, day, nth, weekday, rel_anchor, rel_offset_days, hemisphere, image_url, ping_required)
      VALUES
        (@title, @text, @rule_type, @month, @day, @nth, @weekday, @rel_anchor, @rel_offset_days, @hemisphere, @image_url, COALESCE(@ping_required, 0))
    `),
    updateSEv2: db.prepare(`
      UPDATE special_events_v2 SET
        title=@title,
        text=@text,
        rule_type=@rule_type,
        month=@month,
        day=@day,
        nth=@nth,
        weekday=@weekday,
        rel_anchor=@rel_anchor,
        rel_offset_days=@rel_offset_days,
        hemisphere=@hemisphere,
        image_url=@image_url,
        ping_required=COALESCE(@ping_required, ping_required)
      WHERE id=@id
    `),
    deleteSEv2: db.prepare('DELETE FROM special_events_v2 WHERE id=?'),
    getSEv2ById: db.prepare('SELECT * FROM special_events_v2 WHERE id=?'),
    listSEv2Page: db.prepare('SELECT * FROM special_events_v2 ORDER BY rule_type, month, day, title LIMIT ? OFFSET ?'),
    countSEv2: db.prepare('SELECT COUNT(*) AS c FROM special_events_v2'),
    allSEv2: db.prepare('SELECT * FROM special_events_v2'),

    // idempotencia post diario
    markDailyPosted: db.prepare('INSERT OR IGNORE INTO daily_post_log(guild_id, iso_date) VALUES(?, ?)'),

    // Applications panel/types/settings
    upsertApplyPanel: db.prepare(`
      INSERT INTO applications_panel(guild_id, panel_channel_id, panel_message_id)
      VALUES(@guild_id, @panel_channel_id, @panel_message_id)
      ON CONFLICT(guild_id) DO UPDATE SET
        panel_channel_id=excluded.panel_channel_id,
        panel_message_id=excluded.panel_message_id
    `),
    getApplyPanel: db.prepare('SELECT * FROM applications_panel WHERE guild_id=?'),

    upsertAppType: db.prepare(`
      INSERT INTO application_types
        (guild_id, type_key, type_label, destination_channel_id, questions_json, active, cooldown_days)
      VALUES (@guild_id, @type_key, @type_label, @destination_channel_id, @questions_json, @active, @cooldown_days)
      ON CONFLICT(guild_id, type_key) DO UPDATE SET
        type_label=excluded.type_label,
        destination_channel_id=excluded.destination_channel_id,
        questions_json=excluded.questions_json,
        active=excluded.active,
        cooldown_days=excluded.cooldown_days
    `),
    getAppType: db.prepare('SELECT * FROM application_types WHERE guild_id=? AND type_key=?'),
    listAppTypes: db.prepare('SELECT * FROM application_types WHERE guild_id=? ORDER BY type_key ASC'),
    deleteAppType: db.prepare('DELETE FROM application_types WHERE guild_id=? AND type_key=?'),

    upsertAppSettings: db.prepare(`
      INSERT INTO applications_settings(guild_id, review_log_channel_id, cooldown_days)
      VALUES(@guild_id, @review_log_channel_id, @cooldown_days)
      ON CONFLICT(guild_id) DO UPDATE SET
        review_log_channel_id=COALESCE(excluded.review_log_channel_id, applications_settings.review_log_channel_id),
        cooldown_days=COALESCE(excluded.cooldown_days, applications_settings.cooldown_days)
    `),
    getAppSettings: db.prepare('SELECT * FROM applications_settings WHERE guild_id=?'),

    getLastSubmission: db.prepare(`
      SELECT submitted_at FROM applications_submissions
      WHERE guild_id=? AND user_id=? AND type_key=?
    `),
    upsertSubmissionNow: db.prepare(`
      INSERT INTO applications_submissions(guild_id, user_id, type_key, submitted_at)
      VALUES(?,?,?,?)
      ON CONFLICT(guild_id, user_id, type_key) DO UPDATE SET
        submitted_at=excluded.submitted_at
    `),

    deleteSubmission: db.prepare(`
      DELETE FROM applications_submissions
      WHERE guild_id=? AND user_id=? AND type_key=?
    `),
    deleteAllSubmissionsForUser: db.prepare(`
      DELETE FROM applications_submissions
      WHERE guild_id=? AND user_id=?
    `),
  };

  // ---------- Statements Staff Events ----------
  const stmtsStaff = {
    addStaffEv: db.prepare(`
      INSERT INTO staff_events
        (guild_id, user_id, title, rule_type, month, day, nth, weekday, rel_anchor, rel_offset_days, image_url)
      VALUES
        (@guild_id, @user_id, @title, @rule_type, @month, @day, @nth, @weekday, @rel_anchor, @rel_offset_days, @image_url)
    `),
    updateStaffEv: db.prepare(`
      UPDATE staff_events SET
        user_id=@user_id,
        title=@title,
        rule_type=@rule_type,
        month=@month,
        day=@day,
        nth=@nth,
        weekday=@weekday,
        rel_anchor=@rel_anchor,
        rel_offset_days=@rel_offset_days,
        image_url=@image_url
      WHERE id=@id AND guild_id=@guild_id
    `),
    deleteStaffEv:  db.prepare('DELETE FROM staff_events WHERE guild_id=? AND id=?'),
    getStaffEvById: db.prepare('SELECT * FROM staff_events WHERE guild_id=? AND id=?'),
    listStaffEvPage: db.prepare('SELECT * FROM staff_events WHERE guild_id=? ORDER BY rule_type, month, day, title LIMIT ? OFFSET ?'),
    countStaffEv: db.prepare('SELECT COUNT(*) AS c FROM staff_events WHERE guild_id=?'),
    allStaffEv: db.prepare('SELECT * FROM staff_events WHERE guild_id=?'),

    upsertStaffEvChannels: db.prepare(`
      INSERT INTO staff_events_channels(guild_id, ch1, ch2, ch3)
      VALUES(@guild_id, @ch1, @ch2, @ch3)
      ON CONFLICT(guild_id) DO UPDATE SET
        ch1=excluded.ch1, ch2=excluded.ch2, ch3=excluded.ch3
    `),
    getStaffEvChannels: db.prepare('SELECT * FROM staff_events_channels WHERE guild_id=?'),
  };

  client.acdb = {
    db,
    // guild cfg
    upsertGuildCfg: stmts.upsertGuildCfg,
    getGuildCfg: stmts.getGuildCfg,
    // villagers
    addVillager: stmts.addVillager,
    updateVillager: stmts.updateVillager,
    deleteVillager: stmts.deleteVillager,
    getVillagersByDate: stmts.getVillagersByDate,
    getVillagerById: stmts.getVillagerById,
    listVillagersPage: stmts.listVillagersPage,
    countVillagers: stmts.countVillagers,
    // special events v2
    addSEv2: stmts.addSEv2,
    updateSEv2: stmts.updateSEv2,
    deleteSEv2: stmts.deleteSEv2,
    getSEv2ById: stmts.getSEv2ById,
    listSEv2Page: stmts.listSEv2Page,
    countSEv2: stmts.countSEv2,
    allSEv2: stmts.allSEv2,
    // daily post log
    markDailyPosted: stmts.markDailyPosted,
    // applications
    upsertApplyPanel: stmts.upsertApplyPanel,
    getApplyPanel: stmts.getApplyPanel,
    upsertAppType: stmts.upsertAppType,
    getAppType: stmts.getAppType,
    listAppTypes: stmts.listAppTypes,
    deleteAppType: stmts.deleteAppType,
    upsertAppSettings: stmts.upsertAppSettings,
    getAppSettings: stmts.getAppSettings,
    getLastSubmission: stmts.getLastSubmission,
    upsertSubmissionNow: stmts.upsertSubmissionNow,
    deleteSubmission: stmts.deleteSubmission,
    deleteAllSubmissionsForUser: stmts.deleteAllSubmissionsForUser,

    // Staff Events
    addStaffEv: stmtsStaff.addStaffEv,
    updateStaffEv: stmtsStaff.updateStaffEv,
    deleteStaffEv: stmtsStaff.deleteStaffEv,
    getStaffEvById: stmtsStaff.getStaffEvById,
    listStaffEvPage: stmtsStaff.listStaffEvPage,
    countStaffEv: stmtsStaff.countStaffEv,
    allStaffEv: stmtsStaff.allStaffEv,
    upsertStaffEvChannels: stmtsStaff.upsertStaffEvChannels,
    getStaffEvChannels: stmtsStaff.getStaffEvChannels,
  };

  console.log(`[acdb] Ready at ${dbPath}`);
}

module.exports = { initACDB };
