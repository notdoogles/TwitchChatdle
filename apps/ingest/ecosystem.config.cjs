// PM2 process config for running the ingest worker as an always-on,
// auto-restarting process on a VPS without needing root.
// Usage: pm2 start ecosystem.config.cjs
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// PM2 identifies apps by `name` within a single daemon (one per OS user),
// so running two clones for two channels both named 'ingest' makes the
// second `pm2 start` just restart the first app instead of starting a new
// one. Deriving the name from TWITCH_CHANNEL(S) keeps each clone's PM2
// entry unique automatically, no manual per-clone edits needed.
const channels = process.env.TWITCH_CHANNELS || process.env.TWITCH_CHANNEL || 'unknown';
const appName = `ingest-${channels.split(',')[0].trim()}`;

module.exports = {
  apps: [
    {
      name: appName,
      script: 'index.js',
      cwd: __dirname,
      time: true,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
    },
  ],
};
