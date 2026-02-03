const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_SETTINGS = {
  batch_size: 25,
  concurrency: 3,
  request_delay_ms: 300,
  user_agent: 'YGO-Card-Manager/0.1 (+https://cardcluster.com)',
  max_candidates_passcode_match: 5
};

function ensureDatabase(basePath) {
  const dbPath = path.join(basePath, 'cards.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      de_name TEXT,
      passcode TEXT,
      en_name TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      last_fetched_at TEXT,
      data_source TEXT,
      cardcluster_url TEXT,
      source_url TEXT,
      card_kind TEXT,
      card_subtypes TEXT,
      attribute TEXT,
      level_or_rank INTEGER,
      link_rating INTEGER,
      race TEXT,
      atk INTEGER,
      def INTEGER,
      pendulum_scale INTEGER,
      spell_trap_property TEXT,
      effect_text_en TEXT,
      error_message TEXT,
      raw_url TEXT
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      status TEXT,
      payload_json TEXT,
      cursor INTEGER,
      total INTEGER,
      done INTEGER,
      errors INTEGER,
      current_card_id INTEGER,
      current_action TEXT,
      last_error TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT,
      message TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      cardcluster_url TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS deck_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER,
      card_name TEXT,
      passcode TEXT,
      quantity INTEGER,
      FOREIGN KEY (deck_id) REFERENCES decks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id ON deck_cards(deck_id);
  `);

  ensureColumn(db, 'cards', 'import_batch_id', 'INTEGER');
  ensureColumn(db, 'cards', 'data_source', 'TEXT');
  ensureColumn(db, 'cards', 'source_url', 'TEXT');
  ensureColumn(db, 'cards', 'ignore_duplicates', 'INTEGER');
  ensureColumn(db, 'cards', 'price_value', 'REAL');
  ensureColumn(db, 'cards', 'price_currency', 'TEXT');
  ensureColumn(db, 'cards', 'price_source', 'TEXT');
  ensureColumn(db, 'cards', 'price_updated_at', 'TEXT');
  ensureColumn(db, 'jobs', 'current_action', 'TEXT');

  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!existing) {
      insertSetting.run(key, String(value));
    }
  });

  return db;
}

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((col) => col.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

module.exports = {
  ensureDatabase,
  DEFAULT_SETTINGS
};
