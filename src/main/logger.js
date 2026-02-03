const fs = require('fs');
const path = require('path');

function initLogger(basePath) {
  const logPath = path.join(basePath, 'app.log');
  return {
    log(db, level, message) {
      const createdAt = new Date().toISOString();
      db.prepare('INSERT INTO logs (level, message, created_at) VALUES (?, ?, ?)').run(level, message, createdAt);
      const line = `[${createdAt}] [${level}] ${message}\n`;
      fs.appendFileSync(logPath, line);
    },
    list(db, limit = 200) {
      return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit).reverse();
    }
  };
}

module.exports = {
  initLogger
};
