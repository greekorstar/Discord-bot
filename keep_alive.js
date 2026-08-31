// keep_alive.js — A tiny web server whose only job is to respond to pings.
// UptimeRobot will hit this URL every few minutes so Replit's free tier
// doesn't consider the project "inactive" and put it to sleep.

const express = require('express');
const server = express();

server.all('/', (req, res) => {
  res.send('Bot is alive!');
});

function keepAlive() {
  server.listen(3000, () => {
    console.log('Keep-alive server is running on port 3000');
  });
}

keepAlive();
