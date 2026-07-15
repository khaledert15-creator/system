module.exports = {
  apps: [
    {
      name: "dotcom-main-app",
      script: "server-node.js",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "512M",
      kill_timeout: 15000,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 8765
      },
      out_file: "./logs/pm2-main-out.log",
      error_file: "./logs/pm2-main-error.log"
    },
    {
      name: "dotcom-omnichannel-api",
      script: "src/server.js",
      cwd: `${__dirname}/services/omnichannel`,
      autorestart: true,
      max_memory_restart: "512M",
      kill_timeout: 15000,
      time: true,
      env: {
        NODE_ENV: "production",
        OMNI_START_RETRY_WORKER: "false"
      },
      out_file: "./logs/pm2-omni-api-out.log",
      error_file: "./logs/pm2-omni-api-error.log"
    },
    {
      name: "dotcom-omnichannel-worker",
      script: "src/worker.js",
      cwd: `${__dirname}/services/omnichannel`,
      autorestart: true,
      max_memory_restart: "256M",
      kill_timeout: 15000,
      time: true,
      env: {
        NODE_ENV: "production"
      },
      out_file: "./logs/pm2-omni-worker-out.log",
      error_file: "./logs/pm2-omni-worker-error.log"
    }
  ]
};
