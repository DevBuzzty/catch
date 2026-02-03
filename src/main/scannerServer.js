const os = require('os');
const WebSocket = require('ws');

function getLocalIps() {
  const nets = os.networkInterfaces();
  const results = [];
  Object.values(nets).forEach((entries) => {
    entries
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .forEach((entry) => results.push(entry.address));
  });
  return results;
}

function startScannerServer({ port, onScan, onSync, onResolve, onImage, onConnect, onDisconnect }) {
  const server = new WebSocket.Server({ port });
  server.on('connection', (socket) => {
    onConnect?.(socket);
    socket.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (payload?.type === 'scan' && payload?.card) {
          onScan(payload.card, socket);
        }
        if (payload?.type === 'scanImage' && payload?.image) {
          onImage?.(payload, socket);
        }
        if (payload?.type === 'sync') {
          onSync?.(socket);
        }
        if (payload?.type === 'resolve' && payload?.card) {
          onResolve?.(payload.card, socket);
        }
      } catch (error) {
        // ignore malformed payloads
      }
    });
    socket.on('close', () => {
      onDisconnect?.(socket);
    });
  });
  return server;
}

module.exports = {
  getLocalIps,
  startScannerServer
};
