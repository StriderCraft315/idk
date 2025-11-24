export default {
  apps: [
    {
      name: 'zycron-bot',
      script: 'node -r dotenv/config bot.js',
      instances: 1
    },
    {
      name: 'zycron-panel',
      script: 'node -r dotenv/config panel.js', 
      instances: 1
    }
  ]
};
