# Twitch chat ingest

> Part of [TwitchChatdle](../../README.md): see the root README for the
> project overview.

Persistent worker that logs a channel's chat to Postgres, skipping any usernames you don't want logged.

## Multi-streamer setup

One worker can log chat for several streamers into the same database:
set `TWITCH_CHANNELS=streamer1,streamer2` (comma-separated) instead of
`TWITCH_CHANNEL`. This joins all channels over a single IRC connection
via `tmi.js` and tags each message with its own `channel`, matching the
per-channel filtering already used by `apps/web` (see the root README's
multi-tenant section for the web-side setup). `TWITCH_CHANNEL` remains
the default for a single-streamer fork and needs no changes.

## Setup

```
npm install
cp .env.example .env   # fill in TWITCH_CHANNEL and DATABASE_URL
npm run migrate        # creates users, messages, excluded_users, game_rounds tables
npm start               # connects and starts logging
```

## Excluding usernames

Two ways, and they combine:

1. **Env var**, comma-separated in `.env`:
   ```
   EXCLUDED_USERNAMES=nightbot,streamelements,some_user
   ```
2. **Database table**, add rows to `excluded_users` any time, no restart needed (the worker re-reads it every 60 seconds):
   ```sql
   insert into excluded_users (username, reason) values ('some_user', 'asked to opt out');
   ```

Matching is case-insensitive. Excluded messages are simply never inserted, nothing is stored and then filtered later, so there's no trace of them in the database.

## Running tests

```
npm test
```

Runs the pure filtering logic in `filters.js` (username exclusion
matching, env/DB list merging, and the self-message/`!command` skip
checks) using Node's built-in test runner. No Twitch or Postgres
connection is needed.

## Deploying as an always-on process

This needs a host that keeps a process running (not serverless/Vercel). Fly.io or Railway's free/hobby tiers both work: deploy this folder, set the env vars in their dashboard, and run `npm start` as the start command.

### Running on a VPS without root (PM2)

[PM2](https://pm2.keymetrics.io/) restarts the process automatically on
a crash and can be resurrected after a reboot, and works fine without
root: `npm install -g pm2` needs write access to the global
`node_modules` (usually root-owned), so install it as a local
dev dependency instead and run it via `npx`/npm scripts:

```
npm install --save-dev pm2   # already in package.json, just npm install
npm run pm2:start            # runs: pm2 start ecosystem.config.cjs
npx pm2 save                 # persist the process list
```

- `npx pm2 status` / `npx pm2 logs ingest-<channel>` for status and logs.
- To survive a VPS reboot without root access to install a systemd
  service, add a line to your **user** crontab (`crontab -e`, no root
  needed):
  ```
  @reboot cd /path/to/apps/ingest && npm run pm2:resurrect
  ```

### Running multiple ingests on the same VPS (e.g. two channels)

PM2 runs one daemon per OS user and identifies apps by name, so if two
clones (or two checkouts with different `.env`s) both ran `pm2 start
ecosystem.config.cjs` with the same app name, the second `pm2 start`
would just restart the first app instead of starting an independent
process — it looks successful but nothing new actually runs.
`ecosystem.config.cjs` avoids this by naming the PM2 app
`ingest-<channel>`, derived from that clone's `TWITCH_CHANNEL`/
`TWITCH_CHANNELS`, so each clone's `.env` produces a distinct PM2 app
automatically. Run `npx pm2 status` after starting both to confirm you
see two separate entries.
