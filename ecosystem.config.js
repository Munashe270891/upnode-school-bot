module.exports = {
  apps: [
    {
      name: "upnode-bot",
      script: "src/app.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};
