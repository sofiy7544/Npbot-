/**
 * PM2 config — local / VPS daemon deployment.
 *
 * Why TWO apps?
 *   - tg-ttn-bot:    long-polling Telegram process (reads group → preview → callback)
 *   - tg-ttn-worker: BullMQ background worker (TTN creation, sync, sweeper)
 *
 * For "just run the bot" path (no DB/Redis), only tg-ttn-bot is needed — worker
 * is auto-disabled when REDIS_URL is empty. For full prod with PG+Redis use both.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                          # persist across reboots
 *   pm2-startup install               # Windows auto-start (run as Admin)
 *   pm2 status                        # health
 *   pm2 logs                          # live tail
 *   pm2 restart all                   # rolling restart
 */
module.exports = {
  apps: [
    {
      name: "tg-ttn-bot",
      cwd: __dirname,
      script: "src/index.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 4000,
      max_memory_restart: "300M",
      out_file: "logs/pm2.bot.out.log",
      error_file: "logs/pm2.bot.err.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tg-ttn-worker",
      cwd: __dirname,
      script: "src/jobs/worker.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 4000,
      max_memory_restart: "500M",
      out_file: "logs/pm2.worker.out.log",
      error_file: "logs/pm2.worker.err.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
      },
      // Only auto-start worker if Redis configured.
      // PM2 doesn't have native conditional start — user can `pm2 delete tg-ttn-worker`
      // if they don't need the queue layer (in-process flow still works).
    },
  ],
};
