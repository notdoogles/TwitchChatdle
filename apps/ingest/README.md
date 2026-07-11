# Twitch chat ingest

> Part of [TwitchChatdle](../../README.md): see the root README for the
> project overview.

Persistent worker that logs a channel's chat to Postgres, skipping any usernames you don't want logged.

## Setup

```
npm install
cp .env.example .env   # fill in TWITCH_CHANNEL and DATABASE_URL
npm run migrate        # creates users, messages, excluded_users tables
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
