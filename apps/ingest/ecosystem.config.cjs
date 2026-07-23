// PM2 process config for running the ingest worker as an always-on,
// auto-restarting process on a VPS without needing root.
// Usage: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'ingest',
      script: 'index.js',
      cwd: __dirname,
      time: true,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
    },
  ],
};
