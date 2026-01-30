const { app, dialog } = require('electron');
const { getLocalIps } = require('./scannerServer');
const fs = require('fs');
const { CARD_STATUSES } = require('../shared/constants');
const { fetchDeckFromUrl, fetchCardDetails, scoreNameMatch } = require('./scraper');
const OpenAI = require('openai');

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

  ipcMain.handle('cards:updateDetails', (_, payload) => {
    if (!payload?.id) return false;
    const numericFields = ['level_or_rank', 'link_rating', 'atk', 'def', 'pendulum_scale'];
    const normalized = { ...payload };
    numericFields.forEach((field) => {
      const value = normalized[field];
      if (value === '' || value === null || value === undefined) {
        normalized[field] = null;
      } else {
        const parsed = Number(value);
        normalized[field] = Number.isNaN(parsed) ? null : parsed;
      }
    });

    db.prepare(`
      UPDATE cards SET
        data_source = ?,
        cardcluster_url = ?,
        source_url = ?,
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
        updated_at = ?
      WHERE id = ?
    `).run(
      normalized.data_source || null,
      normalized.cardcluster_url || null,
      normalized.source_url || null,
      normalized.card_kind || null,
      normalized.card_subtypes || null,
      normalized.attribute || null,
      normalized.level_or_rank,
      normalized.link_rating,
      normalized.race || null,
      normalized.atk,
      normalized.def,
      normalized.pendulum_scale,
      normalized.spell_trap_property || null,
      normalized.effect_text_en || null,
      new Date().toISOString(),
      normalized.id
    );
    return true;
  });

  ipcMain.handle('scanner:scanImages', async () => {
    return { canceled: true, error: 'Scanner disabled' };
  });

  ipcMain.handle('scanner:transcribeAudio', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Upload audio (speech to text)',
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'webm', 'ogg'] }],
        properties: ['openFile']
      });
      if (result.canceled || !result.filePaths?.length) {
        return { canceled: true };
      }
      const settings = db.prepare('SELECT key, value FROM settings').all();
      const apiKey =
        process.env.OPENAI_API_KEY ||
        settings.find((row) => row.key === 'openai_api_key')?.value;
      if (!apiKey) {
        return { canceled: false, error: 'OPENAI_API_KEY is not set' };
      }
      const baseUrl = settings.find((row) => row.key === 'openai_base_url')?.value;
      const timeoutMs = Number(settings.find((row) => row.key === 'openai_timeout_ms')?.value || 30000);
      const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined, timeout: timeoutMs });
      const filePath = result.filePaths[0];
      const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'gpt-4o-mini-transcribe',
        language: 'de'
      });
      const text = transcription.text || '';
      const cardNames = extractSpokenCardNames(text);
      const userAgent = settings.find((row) => row.key === 'user_agent')?.value || 'YGO-Card-Manager/0.1';
      const maxCandidates = Number(settings.find((row) => row.key === 'max_candidates_passcode_match')?.value || 5);
      const { candidates, duplicates } = await processSpokenCards(cardNames, { userAgent, maxCandidates }, db, logger);
      return { canceled: false, transcript: text, candidates, duplicates };
    } catch (error) {
      const message = formatOpenAiError(error);
      logger.log(db, 'error', `Speech transcription failed: ${message}`);
      return { canceled: false, error: message };
    }
  });

  ipcMain.handle('scanner:addTranscribedCards', (_, payload) => {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    if (candidates.length === 0) {
      return { added: 0, merged: 0, duplicates: [] };
    }
    const now = new Date().toISOString();
    const insertBatch = db.prepare('INSERT INTO import_batches (source, created_at) VALUES (?, ?)');
    const insert = db.prepare(`
      INSERT INTO cards (
        de_name,
        passcode,
        en_name,
        status,
        created_at,
        updated_at,
        last_fetched_at,
        data_source,
        cardcluster_url,
        source_url,
        card_kind,
        card_subtypes,
        attribute,
        level_or_rank,
        link_rating,
        race,
        atk,
        def,
        pendulum_scale,
        spell_trap_property,
        effect_text_en,
        import_batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const duplicates = [];
    let added = 0;
    let merged = 0;
    const transaction = db.transaction(() => {
      const batch = insertBatch.run('speech', now);
      const batchId = batch.lastInsertRowid;
      candidates.forEach((incoming) => {
        const duplicateInfo = findDuplicateDetailed(db, {
          de_name: incoming.de_name || '',
          en_name: incoming.en_name || '',
          passcode: incoming.passcode || ''
        });
        if (duplicateInfo.match) {
          const mergedCard = mergeCards(duplicateInfo.match, incoming);
          updateMergedCard(db, mergedCard, duplicateInfo.match.id);
          merged += 1;
          duplicates.push({ incoming, existing: duplicateInfo.match, reasons: duplicateInfo.reasons });
          return;
        }
        insert.run(
          incoming.de_name || '',
          incoming.passcode || '',
          incoming.en_name || '',
          incoming.status || CARD_STATUSES.NEED_INPUT,
          now,
          now,
          incoming.last_fetched_at || null,
          incoming.data_source || null,
          incoming.cardcluster_url || null,
          incoming.source_url || null,
          incoming.card_kind || null,
          incoming.card_subtypes || null,
          incoming.attribute || null,
          incoming.level_or_rank ?? null,
          incoming.link_rating ?? null,
          incoming.race || null,
          incoming.atk ?? null,
          incoming.def ?? null,
          incoming.pendulum_scale ?? null,
          incoming.spell_trap_property || null,
          incoming.effect_text_en || null,
          batchId
        );
        added += 1;
      });
    });
    transaction();
    return { added, merged, duplicates };
  });

  ipcMain.handle('cards:deleteMany', (_, ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0 };
    const transaction = db.transaction(() => {
      const deleteStmt = db.prepare('DELETE FROM cards WHERE id = ?');
      ids.forEach((id) => deleteStmt.run(id));
      return ids.length;
    });
    return { deleted: transaction() };
  });

  ipcMain.handle('cards:importCsv', (_, payload) => {
    const { rows, source = 'csv' } = payload;
    const now = new Date().toISOString();
    const insertBatch = db.prepare('INSERT INTO import_batches (source, created_at) VALUES (?, ?)');
    const insertCard = db.prepare(`
      INSERT INTO cards (de_name, passcode, en_name, status, created_at, updated_at, import_batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const duplicates = [];
    let batchId = null;

    const transaction = db.transaction(() => {
      const batch = insertBatch.run(source, now);
      batchId = batch.lastInsertRowid;
      rows.forEach((row) => {
        const deName = row.de_name || '';
        const enName = row.en_name || '';
        const passcode = row.passcode ? String(row.passcode) : '';
        const duplicateInfo = findDuplicateDetailed(db, { de_name: deName, en_name: enName, passcode });
        if (duplicateInfo.match) {
          duplicates.push({ incoming: row, existing: duplicateInfo.match, reasons: duplicateInfo.reasons });
        } else {
          insertCard.run(deName, passcode, enName, CARD_STATUSES.NEED_INPUT, now, now, batchId);
        }
      });
    });

    transaction();
    return { duplicates, batchId };
  });

  ipcMain.handle('cards:previewImport', (_, payload) => {
    const { rows = [] } = payload || {};
    const duplicates = [];
    const previewRows = [];
    rows.forEach((row) => {
      const deName = row.de_name || '';
      const enName = row.en_name || '';
      const passcode = row.passcode ? String(row.passcode) : '';
      const duplicateInfo = findDuplicateDetailed(db, { de_name: deName, en_name: enName, passcode });
      if (duplicateInfo.match) {
        duplicates.push({
          incoming: { de_name: deName, en_name: enName, passcode },
          existing: duplicateInfo.match,
          reasons: duplicateInfo.reasons
        });
        previewRows.push({
          de_name: deName,
          en_name: enName,
          passcode,
          status: CARD_STATUSES.SKIP_DETAILS_PRESENT,
          exists: true,
          existing_id: duplicateInfo.match.id
        });
      } else {
        previewRows.push({
          de_name: deName,
          en_name: enName,
          passcode,
          status: CARD_STATUSES.NEED_INPUT,
          exists: false
        });
      }
    });
    return { rows: previewRows, duplicates };
  });

  ipcMain.handle('cards:fetchPreviewDetails', async (_, payload) => {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const userAgent = settings.find((row) => row.key === 'user_agent')?.value || 'YGO-Card-Manager/0.1';
    const maxCandidates = Number(settings.find((row) => row.key === 'max_candidates_passcode_match')?.value || 5);
    const updated = [];
    for (const row of rows) {
      const fetchResult = await fetchCardDetails({
        passcode: row.passcode || '',
        en_name: row.en_name || '',
        de_name: row.de_name || '',
        userAgent,
        maxCandidates
      }).catch((error) => ({ status: CARD_STATUSES.ERROR, error }));
      if (fetchResult.status === CARD_STATUSES.OK_DETAILS) {
        const detail = fetchResult.cardDetails || {};
        const fetchedName = detail.name || '';
        const nameInput = row.en_name || row.de_name || '';
        const nameScore = fetchedName && nameInput ? scoreNameMatch(fetchedName, nameInput) : 0;
        const nameMismatch = fetchedName && nameScore < 2;
        const passcodeMismatch = isPasscodeMismatch(detail.passcode, row.passcode);
        updated.push({
          ...row,
          passcode: row.passcode || detail.passcode || '',
          en_name: nameScore >= 2 ? fetchedName || row.en_name : row.en_name || fetchedName,
          status: nameMismatch || passcodeMismatch ? CARD_STATUSES.NEED_INPUT : CARD_STATUSES.OK_DETAILS,
          last_fetched_at: new Date().toISOString(),
          data_source: detail.data_source || null,
          source_url: detail.source_url || null,
          cardcluster_url: detail.cardcluster_url || null,
          card_kind: detail.card_kind || null,
          card_subtypes: detail.card_subtypes || null,
          attribute: detail.attribute || null,
          level_or_rank: detail.level_or_rank ?? null,
          link_rating: detail.link_rating ?? null,
          race: detail.race || null,
          atk: detail.atk ?? null,
          def: detail.def ?? null,
          pendulum_scale: detail.pendulum_scale ?? null,
          spell_trap_property: detail.spell_trap_property || null,
          effect_text_en: detail.effect_text_en || null,
          name_mismatch: Boolean(nameMismatch),
          passcode_mismatch: Boolean(passcodeMismatch),
          suggested_name: nameMismatch ? fetchedName : null,
          suggested_passcode: passcodeMismatch ? detail.passcode || '' : null
        });
      } else {
        updated.push({
          ...row,
          status: fetchResult.status || CARD_STATUSES.NOT_FOUND
        });
        if (fetchResult.error) {
          logger.log(db, 'error', `Preview fetch error for ${row.en_name || row.de_name || row.passcode}: ${fetchResult.error.message}`);
        }
      }
    }
    return { rows: updated };
  });

  ipcMain.handle('cards:addPreviewCards', (_, payload) => {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (rows.length === 0) return { added: 0, duplicates: [] };
    const now = new Date().toISOString();
    const insertBatch = db.prepare('INSERT INTO import_batches (source, created_at) VALUES (?, ?)');
    const insertCard = db.prepare(`
      INSERT INTO cards (
        de_name,
        passcode,
        en_name,
        status,
        created_at,
        updated_at,
        last_fetched_at,
        data_source,
        cardcluster_url,
        source_url,
        card_kind,
        card_subtypes,
        attribute,
        level_or_rank,
        link_rating,
        race,
        atk,
        def,
        pendulum_scale,
        spell_trap_property,
        effect_text_en,
        import_batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const duplicates = [];
    let added = 0;
    const transaction = db.transaction(() => {
      const batch = insertBatch.run('import-preview', now);
      const batchId = batch.lastInsertRowid;
      rows.forEach((row) => {
        const duplicateInfo = findDuplicateDetailed(db, {
          de_name: row.de_name || '',
          en_name: row.en_name || '',
          passcode: row.passcode || ''
        });
        if (duplicateInfo.match) {
          duplicates.push({ incoming: row, existing: duplicateInfo.match, reasons: duplicateInfo.reasons });
          return;
        }
        insertCard.run(
          row.de_name || '',
          row.passcode || '',
          row.en_name || '',
          row.status || CARD_STATUSES.NEED_INPUT,
          now,
          now,
          row.last_fetched_at || null,
          row.data_source || null,
          row.cardcluster_url || null,
          row.source_url || null,
          row.card_kind || null,
          row.card_subtypes || null,
          row.attribute || null,
          row.level_or_rank ?? null,
          row.link_rating ?? null,
          row.race || null,
          row.atk ?? null,
          row.def ?? null,
          row.pendulum_scale ?? null,
          row.spell_trap_property || null,
          row.effect_text_en || null,
          batchId
        );
        added += 1;
      });
    });
    transaction();
    return { added, duplicates };
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
    const insertBatch = db.prepare('INSERT INTO import_batches (source, created_at) VALUES (?, ?)');
    const insert = db.prepare(`
      INSERT INTO cards (de_name, passcode, en_name, status, created_at, updated_at, import_batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let batchId = null;
    const duplicates = [];
    const transaction = db.transaction(() => {
      const batch = insertBatch.run('paste', now);
      batchId = batch.lastInsertRowid;
      lines.forEach((line) => {
        const name = line.trim();
        if (!name) return;
        const duplicateInfo = findDuplicateDetailed(db, { de_name: name, en_name: '', passcode: '' });
        if (duplicateInfo.match) {
          duplicates.push({
            incoming: { de_name: name, en_name: '', passcode: '' },
            existing: duplicateInfo.match,
            reasons: duplicateInfo.reasons
          });
        } else {
          insert.run(name, '', '', CARD_STATUSES.NEED_INPUT, now, now, batchId);
        }
      });
    });

    transaction();
    return { batchId, duplicates };
  });

  ipcMain.handle('cards:exportCsv', () => {
    return db.prepare('SELECT * FROM cards ORDER BY id ASC').all();
  });

  ipcMain.handle('cards:validatePasscodes', async (_, payload) => {
    const ids = Array.isArray(payload?.ids) ? payload.ids : [];
    const cards = ids.length
      ? ids.map((id) => db.prepare('SELECT * FROM cards WHERE id = ?').get(id)).filter(Boolean)
      : db.prepare('SELECT * FROM cards ORDER BY id ASC').all();
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const userAgent = settings.find((row) => row.key === 'user_agent')?.value || 'YGO-Card-Manager/0.1';
    const maxCandidates = Number(settings.find((row) => row.key === 'max_candidates_passcode_match')?.value || 5);
    const results = [];
    for (const card of cards) {
      const nameInput = card.en_name || card.de_name || '';
      if (!nameInput) continue;
      const fetchResult = await fetchCardDetails({
        passcode: '',
        en_name: card.en_name || '',
        de_name: card.de_name || '',
        userAgent,
        maxCandidates
      }).catch((error) => ({ status: CARD_STATUSES.ERROR, error }));
      if (fetchResult.status !== CARD_STATUSES.OK_DETAILS || !fetchResult.cardDetails) {
        continue;
      }
      const detail = fetchResult.cardDetails;
      const passcodeMismatch = isPasscodeMismatch(detail.passcode, card.passcode);
      const fetchedName = detail.name || '';
      const nameScore = fetchedName ? scoreNameMatch(fetchedName, nameInput) : 0;
      const nameMismatch = fetchedName && nameScore < 2;
      if (passcodeMismatch || nameMismatch) {
        results.push({
          id: card.id,
          existing_passcode: card.passcode || '',
          fetched_passcode: detail.passcode || '',
          existing_name: nameInput,
          fetched_name: fetchedName,
          name_mismatch: Boolean(nameMismatch),
          passcode_mismatch: Boolean(passcodeMismatch)
        });
      }
      if (!nameMismatch && fetchedName && fetchedName !== card.en_name) {
        db.prepare('UPDATE cards SET en_name = ?, updated_at = ? WHERE id = ?').run(
          fetchedName,
          new Date().toISOString(),
          card.id
        );
      }
    }
    return { results };
  });

  ipcMain.handle('cards:getLastImportBatch', () => {
    const batch = db.prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT 1').get();
    if (!batch) return null;
    const count = db.prepare('SELECT COUNT(*) as count FROM cards WHERE import_batch_id = ?').get(batch.id);
    return { ...batch, count: count?.count || 0 };
  });

  ipcMain.handle('cards:listByImportBatch', (_, batchId) => {
    if (!batchId) return [];
    return db.prepare('SELECT id FROM cards WHERE import_batch_id = ? ORDER BY id ASC').all(batchId);
  });

  ipcMain.handle('cards:deleteImportBatch', (_, batchId) => {
    if (!batchId) return { deleted: 0 };
    const transaction = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) as count FROM cards WHERE import_batch_id = ?').get(batchId);
      db.prepare('DELETE FROM cards WHERE import_batch_id = ?').run(batchId);
      db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId);
      return count?.count || 0;
    });
    const deleted = transaction();
    return { deleted };
  });

  ipcMain.handle('cards:clearDetails', (_, id) => {
    db.prepare(`
      UPDATE cards SET
        status = ?,
        updated_at = ?,
        last_fetched_at = NULL,
        data_source = NULL,
        cardcluster_url = NULL,
        source_url = NULL,
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
    const cards = db.prepare('SELECT * FROM cards WHERE COALESCE(ignore_duplicates, 0) = 0').all();
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

  ipcMain.handle('duplicates:ignore', (_, cardId) => {
    if (!cardId) return false;
    db.prepare('UPDATE cards SET ignore_duplicates = 1 WHERE id = ?').run(cardId);
    return true;
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
        data_source = ?,
        cardcluster_url = ?,
        source_url = ?,
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
      merged.data_source,
      merged.cardcluster_url,
      merged.source_url,
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

  ipcMain.handle('jobs:startAll', () => {
    const cards = db.prepare('SELECT * FROM cards ORDER BY id ASC').all();
    const ids = cards.map((card) => card.id);
    const jobId = jobRunner.createJob('all', ids, { force: true });
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

  ipcMain.handle('openai:testConnection', async () => {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const apiKey =
      process.env.OPENAI_API_KEY ||
      settings.find((row) => row.key === 'openai_api_key')?.value;
    if (!apiKey) {
      return { ok: false, error: 'OPENAI_API_KEY is not set or invalid.' };
    }
    const baseUrl = settings.find((row) => row.key === 'openai_base_url')?.value;
    const timeoutMs = Number(settings.find((row) => row.key === 'openai_timeout_ms')?.value || 30000);
    const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined, timeout: timeoutMs });
    try {
      await client.models.list();
      return { ok: true };
    } catch (error) {
      const message = formatOpenAiError(error);
      logger.log(db, 'error', `OpenAI connection test failed: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('scanner:getServerInfo', () => {
    return {
      port: 8787,
      ips: getLocalIps()
    };
  });

  ipcMain.handle('diagnostics:collect', () => {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const settingsMap = settings.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    if (settingsMap.openai_api_key) {
      const key = settingsMap.openai_api_key;
      settingsMap.openai_api_key = `${key.slice(0, 3)}…${key.slice(-4)}`;
    }
    const logs = logger.list(db, 200);
    const diagnostics = [
      `timestamp: ${new Date().toISOString()}`,
      `app_version: ${app.getVersion()}`,
      `platform: ${process.platform}`,
      `arch: ${process.arch}`,
      `node: ${process.versions.node}`,
      `electron: ${process.versions.electron}`,
      `chrome: ${process.versions.chrome}`,
      `user_data_path: ${app.getPath('userData')}`,
      '',
      'settings:',
      JSON.stringify(settingsMap, null, 2),
      '',
      'logs:',
      ...logs.map((entry) => `[${entry.created_at}] ${entry.level}: ${entry.message}`)
    ];
    return diagnostics.join('\n');
  });
}

function extractSpokenCardNames(transcript) {
  return String(transcript || '')
    .split(/[,\n;]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function formatOpenAiError(error) {
  const rawMessage = String(error?.message || error || 'Connection error');
  if (rawMessage.toLowerCase().includes('api key')) {
    return 'OPENAI_API_KEY is not set or invalid.';
  }
  if (rawMessage.toLowerCase().includes('timeout')) {
    return 'OpenAI request timed out. Check your connection and try again.';
  }
  if (rawMessage.toLowerCase().includes('enotfound') || rawMessage.toLowerCase().includes('ecconnrefused')) {
    return 'OpenAI connection failed. Check your internet connection or proxy.';
  }
  if (rawMessage.toLowerCase().includes('connection error')) {
    return 'OpenAI connection error. Check your internet connection.';
  }
  return rawMessage;
}

async function processSpokenCards(cardNames, { userAgent, maxCandidates }, db, logger) {
  const now = new Date().toISOString();
  const candidates = [];
  const duplicates = [];

  for (const spokenName of cardNames) {
    const fetchResult = await fetchCardDetails({
      passcode: '',
      en_name: spokenName,
      de_name: spokenName,
      userAgent,
      maxCandidates
    }).catch((error) => ({ status: CARD_STATUSES.ERROR, error }));

    if (fetchResult.status === CARD_STATUSES.OK_DETAILS) {
      const detail = fetchResult.cardDetails;
      const enName = detail.name || spokenName;
      const incoming = {
        de_name: '',
        passcode: detail.passcode || '',
        en_name: enName,
        status: CARD_STATUSES.OK_DETAILS,
        updated_at: now,
        last_fetched_at: now,
        data_source: detail.data_source || null,
        cardcluster_url: detail.cardcluster_url || null,
        source_url: detail.source_url || null,
        card_kind: detail.card_kind || null,
        card_subtypes: detail.card_subtypes || null,
        attribute: detail.attribute || null,
        level_or_rank: detail.level_or_rank ?? null,
        link_rating: detail.link_rating ?? null,
        race: detail.race || null,
        atk: detail.atk ?? null,
        def: detail.def ?? null,
        pendulum_scale: detail.pendulum_scale ?? null,
        spell_trap_property: detail.spell_trap_property || null,
        effect_text_en: detail.effect_text_en || null,
        error_message: null,
        raw_url: null
      };
      const duplicateInfo = findDuplicateDetailed(db, {
        de_name: incoming.de_name,
        en_name: incoming.en_name,
        passcode: incoming.passcode
      });
      if (duplicateInfo.match) {
        duplicates.push({ incoming, existing: duplicateInfo.match, reasons: duplicateInfo.reasons });
      }
      candidates.push({
        spoken: spokenName,
        status: CARD_STATUSES.OK_DETAILS,
        incoming,
        duplicate: Boolean(duplicateInfo.match)
      });
    } else {
      const status = fetchResult.status || CARD_STATUSES.NOT_FOUND;
      const incoming = {
        de_name: '',
        passcode: '',
        en_name: spokenName,
        status,
        updated_at: now,
        last_fetched_at: null,
        data_source: null,
        cardcluster_url: null,
        source_url: null,
        card_kind: null,
        card_subtypes: null,
        attribute: null,
        level_or_rank: null,
        link_rating: null,
        race: null,
        atk: null,
        def: null,
        pendulum_scale: null,
        spell_trap_property: null,
        effect_text_en: null,
        error_message: null,
        raw_url: null
      };
      const duplicateInfo = findDuplicateDetailed(db, {
        de_name: incoming.de_name,
        en_name: incoming.en_name,
        passcode: incoming.passcode
      });
      if (duplicateInfo.match) {
        duplicates.push({ incoming, existing: duplicateInfo.match, reasons: duplicateInfo.reasons });
      }
      if (fetchResult.error) {
        logger.log(db, 'error', `Speech fetch error for ${spokenName}: ${fetchResult.error.message}`);
      }
      candidates.push({
        spoken: spokenName,
        status,
        incoming,
        duplicate: Boolean(duplicateInfo.match)
      });
    }
  }

  return { candidates, duplicates };
}

function updateMergedCard(db, merged, keepId) {
  db.prepare(`
    UPDATE cards SET
      de_name = ?,
      passcode = ?,
      en_name = ?,
      status = ?,
      updated_at = ?,
      last_fetched_at = ?,
      data_source = ?,
      cardcluster_url = ?,
      source_url = ?,
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
      merged.data_source,
      merged.cardcluster_url,
      merged.source_url,
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
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePasscode(value) {
  if (!value) return '';
  return String(value).trim().replace(/^0+/, '');
}

function isPasscodeMismatch(fetched, existing) {
  if (!fetched || !existing) return false;
  return normalizePasscode(fetched) !== normalizePasscode(existing);
}

function findDuplicateDetailed(db, card) {
  const passcode = normalizePasscode(card.passcode);
  const enName = normalizeKey(card.en_name);
  const deName = normalizeKey(card.de_name);

  const matches = db.prepare(`
    SELECT * FROM cards WHERE COALESCE(ignore_duplicates, 0) = 0
  `).all();

  const reasons = [];
  let match = null;
  matches.forEach((existing) => {
    const existingPasscode = normalizePasscode(existing.passcode);
    const existingEn = normalizeKey(existing.en_name);
    const existingDe = normalizeKey(existing.de_name);
    if (passcode && existingPasscode && passcode === existingPasscode) {
      reasons.push('passcode');
      if (!match) match = existing;
    }
    if (enName && existingEn && enName === existingEn) {
      reasons.push('en_name');
      if (!match) match = existing;
    }
    if (deName && existingDe && deName === existingDe) {
      reasons.push('de_name');
      if (!match) match = existing;
    }
  });

  return { match, reasons: Array.from(new Set(reasons)) };
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
    data_source: preferred.data_source || fallback.data_source,
    cardcluster_url: preferred.cardcluster_url || fallback.cardcluster_url,
    source_url: preferred.source_url || fallback.source_url,
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
