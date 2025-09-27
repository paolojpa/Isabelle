# AC Calendar Bot (English, Plain Text Posts)

Discord bot that automatically posts a **daily Animal Crossing calendar** with:
- Villager birthdays (SQLite DB)
- Sample events (K.K. Slider, Bug-Off)
- Scheduled daily post per guild at a chosen hour & timezone
- **Admin UI** to **list/add/edit/delete** villagers (buttons + modals)
- Command to configure channel/hour/timezone/hemisphere and a command to force today's post
- **Calendar posts are plain text** (no embeds). Images are attached as files or URLs so Discord previews them.

## Requirements
- Node 18+
- Create and fill `config.json` (use `config.example.json` as a template)
- `npm install`

## Run
```bash
npm i
cp config.example.json config.json
# Edit config.json with your token, prefix and role IDs
npm start
```

## Commands
- `!setcalendar #channel 9 America/New_York north` — sets channel, hour (0-23), timezone (IANA), hemisphere.
- `!villagers` — opens the admin panel to list/add/edit/delete villagers.
- `!today` — forces today's post (for testing).

## Notes
- For role mention in daily posts, set `roles.event_news_role_id` in `config.json`.
- Uses `discord.js v14`, `better-sqlite3`, `luxon`, `node-cron`.

## Special Events UI
- `!specialevents` — opens the special events panel (list/add/edit/delete).
  - Each event has: **title**, optional **text**, **month/day**, **hemisphere** (north/south/both), and optional **image URL**.
  - Daily posts automatically include matching events for the configured hemisphere. Images are attached as files/links.
