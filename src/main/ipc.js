const { dialog } = require('electron');
const fs = require('fs');
const { CARD_STATUSES } = require('../shared/constants');
const { fetchDeckFromUrl } = require('./scraper');

function registerIpcHandlers(ipcMain, db, jobRunner, logger) {
  ipcMain.handle('cards:list', (_, params = {}) => {
    const { search = '', status = '', missingDetails = false } = params;
    const query = `%${search.toLowerCase()}%`;
    const where = [];
    const values = [];

    if (search) {
      where.push('(LOWER(de_name) LIKE ? OR LOWER(en_name) LIKE ? OR passcode LIKE ?)');
      values.push(query, query, query);
    }

    if (status) {
      where.push('status = ?');
      values.push(status);
    }

    if (missingDetails) {
      where.push('cardcluster_url IS NULL');
    }

    const sql = `SELECT * FROM cards ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`;
    return db.prepare(sql).all(...values);
  });

  ipcMain.handle('cards:get', (_, id) => {
    return db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  });

  ipcMain.handle('cards:upsert', (_, card) => {
    const now = new Date().toISOString();
    if (card.id) {
      db.prepare(`
        UPDATE cards SET
          de_name = ?,
          passcode = ?,
          en_name = ?,
          updated_at = ?
        WHERE id = ?
      `).run(card.de_name, card.passcode, card.en_name, now, card.id);
      return card.id;
    }
    const result = db.prepare(`
      INSERT INTO cards (de_name, passcode, en_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(card.de_name, card.passcode, card.en_name, CARD_STATUSES.NEED_INPUT, now, now);
    return result.lastInsertRowid;
  });

  ipcMain.handle('cards:delete', (_, id) => {
    db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('cards:importCsv', (_, payload) => {
    const { rows } = payload;
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO cards (de_name, passcode, en_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const duplicates = [];
    rows.forEach((row) => {
      const deName = row.de_name || '';
      const enName = row.en_name || '';
      const passcode = row.passcode ? String(row.passcode) : '';
      const duplicate = findDuplicate(db, { de_name: deName, en_name: enName, passcode });
      if (duplicate) {
        duplicates.push({ incoming: row, existing: duplicate });
      } else {
        insert.run(deName, passcode, enName, CARD_STATUSES.NEED_INPUT, now, now);
      }
    });

    return { duplicates };
  });

  ipcMain.handle('cards:importCsvFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import CSV',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return { canceled: false, content };
  });

  ipcMain.handle('cards:paste', (_, payload) => {
    const { lines } = payload;
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO cards (de_name, passcode, en_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    lines.forEach((line) => {
      const name = line.trim();
      if (!name) return;
      const duplicate = findDuplicate(db, { de_name: name, en_name: '', passcode: '' });
      if (!duplicate) {
        insert.run(name, '', '', CARD_STATUSES.NEED_INPUT, now, now);
      }
    });

    return true;
  });

  ipcMain.handle('cards:exportCsv', () => {
    return db.prepare('SELECT * FROM cards ORDER BY id ASC').all();
  });

  ipcMain.handle('cards:clearDetails', (_, id) => {
    db.prepare(`
      UPDATE cards SET
        status = ?,
        updated_at = ?,
        last_fetched_at = NULL,
        cardcluster_url = NULL,
        card_kind = NULL,
        card_subtypes = NULL,
        attribute = NULL,
        level_or_rank = NULL,
        link_rating = NULL,
        race = NULL,
        atk = NULL,
        def = NULL,
        pendulum_scale = NULL,
        spell_trap_property = NULL,
        effect_text_en = NULL,
        error_message = NULL,
        raw_url = NULL
      WHERE id = ?
    `).run(CARD_STATUSES.NEED_INPUT, new Date().toISOString(), id);
    return true;
  });

  ipcMain.handle('decks:importFromUrl', async (_, payload) => {
    const { url } = payload;
    if (!url || !url.includes('cardcluster.com')) {
      throw new Error('Deck URL must be from cardcluster.com');
    }
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const userAgent = settings.find((row) => row.key === 'user_agent')?.value || 'YGO-Card-Manager/0.1';
    const deckData = await fetchDeckFromUrl(url, userAgent);
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT * FROM decks WHERE cardcluster_url = ?').get(url);
    let deckId;
    const transaction = db.transaction(() => {
      if (existing) {
        deckId = existing.id;
        db.prepare('UPDATE decks SET name = ?, updated_at = ? WHERE id = ?').run(deckData.deckName, now, deckId);
        db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId);
      } else {
        const result = db.prepare('INSERT INTO decks (name, cardcluster_url, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
          deckData.deckName,
          url,
          now,
          now
        );
        deckId = result.lastInsertRowid;
      }

      const insertCard = db.prepare('INSERT INTO deck_cards (deck_id, card_name, passcode, quantity) VALUES (?, ?, ?, ?)');
      deckData.cards.forEach((card) => {
        insertCard.run(deckId, card.name, card.passcode || '', card.quantity);
      });
    });

    transaction();
    return { deckId, deckName: deckData.deckName, cardCount: deckData.cards.length };
  });

  ipcMain.handle('decks:list', () => {
    const decks = db.prepare('SELECT * FROM decks ORDER BY updated_at DESC').all();
    const totals = db.prepare('SELECT deck_id, SUM(quantity) as total_cards FROM deck_cards GROUP BY deck_id').all();
    const totalMap = totals.reduce((acc, row) => {
      acc[row.deck_id] = row.total_cards;
      return acc;
    }, {});
    return decks.map((deck) => ({ ...deck, total_cards: totalMap[deck.id] || 0 }));
  });

  ipcMain.handle('decks:get', (_, deckId) => {
    const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId);
    if (!deck) return null;
    const entries = db.prepare('SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY card_name ASC').all(deckId);
    const detailed = entries.map((entry) => {
      const ownedCard = findOwnedCard(db, entry);
      return {
        ...entry,
        owned: Boolean(ownedCard),
        owned_card_id: ownedCard?.id || null
      };
    });
    return { deck, entries: detailed };
  });

  ipcMain.handle('decks:delete', (_, deckId) => {
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId);
      db.prepare('DELETE FROM decks WHERE id = ?').run(deckId);
    });
    transaction();
    return true;
  });

  ipcMain.handle('duplicates:list', () => {
    const cards = db.prepare('SELECT * FROM cards').all();
    const groups = new Map();
    cards.forEach((card) => {
      const keys = [];
      if (card.passcode) keys.push(`passcode:${card.passcode}`);
      if (card.en_name) keys.push(`en:${card.en_name.toLowerCase()}`);
      if (card.de_name) keys.push(`de:${card.de_name.toLowerCase()}`);
      keys.forEach((key) => {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(card);
      });
    });

    return Array.from(groups.values()).filter((group) => group.length > 1);
  });

  ipcMain.handle('duplicates:merge', (_, payload) => {
    const { keepId, mergeId } = payload;
    const keep = db.prepare('SELECT * FROM cards WHERE id = ?').get(keepId);
    const merge = db.prepare('SELECT * FROM cards WHERE id = ?').get(mergeId);
    if (!keep || !merge) return null;

    const merged = mergeCards(keep, merge);
    db.prepare(`
      UPDATE cards SET
        de_name = ?,
        passcode = ?,
        en_name = ?,
        status = ?,
        updated_at = ?,
        last_fetched_at = ?,
        cardcluster_url = ?,
        card_kind = ?,
        card_subtypes = ?,
        attribute = ?,
        level_or_rank = ?,
        link_rating = ?,
        race = ?,
        atk = ?,
        def = ?,
        pendulum_scale = ?,
        spell_trap_property = ?,
        effect_text_en = ?,
        error_message = ?,
        raw_url = ?
      WHERE id = ?
    `).run(
      merged.de_name,
      merged.passcode,
      merged.en_name,
      merged.status,
      merged.updated_at,
      merged.last_fetched_at,
      merged.cardcluster_url,
      merged.card_kind,
      merged.card_subtypes,
      merged.attribute,
      merged.level_or_rank,
      merged.link_rating,
      merged.race,
      merged.atk,
      merged.def,
      merged.pendulum_scale,
      merged.spell_trap_property,
      merged.effect_text_en,
      merged.error_message,
      merged.raw_url,
      keepId
    );
    db.prepare('DELETE FROM cards WHERE id = ?').run(mergeId);
    return merged;
  });

  ipcMain.handle('jobs:startMissing', () => {
    const cards = db.prepare(`
      SELECT * FROM cards
      WHERE cardcluster_url IS NULL OR status IN (?, ?, ?)
    `).all(CARD_STATUSES.NOT_FOUND, CARD_STATUSES.ERROR, CARD_STATUSES.NEED_INPUT);
    const ids = cards.map((card) => card.id);
    const jobId = jobRunner.createJob('missing', ids);
    return jobId;
  });

  ipcMain.handle('jobs:startSelected', (_, ids) => {
    const jobId = jobRunner.createJob('selected', ids, { force: true });
    return jobId;
  });

  ipcMain.handle('jobs:pause', (_, jobId) => {
    jobRunner.pauseJob(jobId);
    return true;
  });

  ipcMain.handle('jobs:resume', (_, jobId) => {
    jobRunner.resumeJob(jobId);
    return true;
  });

  ipcMain.handle('jobs:cancel', (_, jobId) => {
    jobRunner.cancelJob(jobId);
    return true;
  });

  ipcMain.handle('jobs:getStatus', (_, jobId) => {
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  });

  ipcMain.handle('jobs:list', () => {
    return db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
  });

  ipcMain.handle('settings:get', () => {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    return settings.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  });

  ipcMain.handle('settings:save', (_, settings) => {
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    Object.entries(settings).forEach(([key, value]) => {
      insert.run(key, String(value));
    });
    return true;
  });

  ipcMain.handle('logs:list', () => {
    return logger.list(db);
  });
}

function findDuplicate(db, card) {
  const match = db.prepare(`
    SELECT * FROM cards WHERE
      (passcode IS NOT NULL AND passcode != '' AND passcode = ?)
      OR (LOWER(en_name) = ? AND en_name IS NOT NULL AND en_name != '')
      OR (LOWER(de_name) = ? AND de_name IS NOT NULL AND de_name != '')
    LIMIT 1
  `).get(card.passcode, card.en_name.toLowerCase(), card.de_name.toLowerCase());
  return match;
}

function findOwnedCard(db, entry) {
  const passcode = entry.passcode || '';
  const name = entry.card_name || '';
  const match = db.prepare(`
    SELECT * FROM cards WHERE
      (passcode IS NOT NULL AND passcode != '' AND passcode = ?)
      OR (LOWER(en_name) = ? AND en_name IS NOT NULL AND en_name != '')
      OR (LOWER(de_name) = ? AND de_name IS NOT NULL AND de_name != '')
    LIMIT 1
  `).get(passcode, name.toLowerCase(), name.toLowerCase());
  return match;
}

function mergeCards(primary, secondary) {
  const now = new Date().toISOString();
  const preferred = pickPreferred(primary, secondary);
  const fallback = preferred.id === primary.id ? secondary : primary;

  return {
    de_name: preferred.de_name || fallback.de_name,
    passcode: preferred.passcode || fallback.passcode,
    en_name: preferred.en_name || fallback.en_name,
    status: preferred.status || fallback.status,
    updated_at: now,
    last_fetched_at: preferred.last_fetched_at || fallback.last_fetched_at,
    cardcluster_url: preferred.cardcluster_url || fallback.cardcluster_url,
    card_kind: preferred.card_kind || fallback.card_kind,
    card_subtypes: preferred.card_subtypes || fallback.card_subtypes,
    attribute: preferred.attribute || fallback.attribute,
    level_or_rank: preferred.level_or_rank || fallback.level_or_rank,
    link_rating: preferred.link_rating || fallback.link_rating,
    race: preferred.race || fallback.race,
    atk: preferred.atk ?? fallback.atk,
    def: preferred.def ?? fallback.def,
    pendulum_scale: preferred.pendulum_scale ?? fallback.pendulum_scale,
    spell_trap_property: preferred.spell_trap_property || fallback.spell_trap_property,
    effect_text_en: preferred.effect_text_en || fallback.effect_text_en,
    error_message: preferred.error_message || fallback.error_message,
    raw_url: preferred.raw_url || fallback.raw_url
  };
}

function pickPreferred(primary, secondary) {
  if (primary.passcode && !secondary.passcode) return primary;
  if (secondary.passcode && !primary.passcode) return secondary;

  if (primary.en_name && !secondary.en_name) return primary;
  if (secondary.en_name && !primary.en_name) return secondary;

  if (primary.de_name && !secondary.de_name) return primary;
  if (secondary.de_name && !primary.de_name) return secondary;

  const primaryDetails = countDetails(primary);
  const secondaryDetails = countDetails(secondary);
  if (primaryDetails !== secondaryDetails) {
    return primaryDetails > secondaryDetails ? primary : secondary;
  }

  const primaryUpdated = Date.parse(primary.updated_at || primary.created_at || '') || 0;
  const secondaryUpdated = Date.parse(secondary.updated_at || secondary.created_at || '') || 0;
  return primaryUpdated >= secondaryUpdated ? primary : secondary;
}

function countDetails(card) {
  const fields = [
    'cardcluster_url',
    'card_kind',
    'card_subtypes',
    'attribute',
    'level_or_rank',
    'link_rating',
    'race',
    'atk',
    'def',
    'pendulum_scale',
    'spell_trap_property',
    'effect_text_en'
  ];
  return fields.filter((key) => card[key] !== null && card[key] !== undefined && card[key] !== '').length;
}

module.exports = {
  registerIpcHandlers
};
