/**
 * PM2 ecosystem configuration for production deployment.
 * Start with: pm2 start ecosystem.config.cjs
 * @see https://pm2.keymetrics.io/docs/usage/application-declaration/
 */
module.exports = {
  apps: [
    {
      name: "katsumi",
      script: "src/app.js",
      node_args: "--env-file=.env",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
