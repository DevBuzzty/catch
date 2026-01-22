const { CARD_STATUSES, JOB_STATUSES } = require('../shared/constants');
const { fetchCardDetails } = require('./scraper');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class JobRunner {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger;
    this.activeJobs = new Map();
    this.resumePendingJobs();
  }

  resumePendingJobs() {
    const jobs = this.db.prepare('SELECT * FROM jobs WHERE status = ? OR status = ?').all(JOB_STATUSES.RUNNING, JOB_STATUSES.PAUSED);
    jobs.forEach((job) => {
      if (job.status === JOB_STATUSES.RUNNING) {
        this.runJob(job.id);
      }
    });
  }

  createJob(type, cardIds, options = {}) {
    const now = new Date().toISOString();
    const payload = JSON.stringify({ cardIds, ...options });
    const result = this.db.prepare(`
      INSERT INTO jobs (type, status, payload_json, cursor, total, done, errors, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(type, JOB_STATUSES.RUNNING, payload, 0, cardIds.length, 0, 0, now, now);
    this.runJob(result.lastInsertRowid);
    return result.lastInsertRowid;
  }

  updateJob(jobId, fields) {
    const keys = Object.keys(fields);
    const sets = keys.map((key) => `${key} = ?`).join(', ');
    const values = keys.map((key) => fields[key]);
    this.db.prepare(`UPDATE jobs SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, new Date().toISOString(), jobId);
  }

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return rows.reduce((acc, row) => {
      acc[row.key] = Number.isNaN(Number(row.value)) ? row.value : Number(row.value);
      return acc;
    }, {});
  }

  async processCard(card, settings, force) {
    const hasInputs = card.passcode || card.en_name || card.de_name;
    if (!hasInputs) {
      this.updateCardStatus(card.id, CARD_STATUSES.NEED_INPUT, null, null);
      return { status: CARD_STATUSES.NEED_INPUT };
    }

    const hasDetails = Boolean(
      card.cardcluster_url ||
        card.card_kind ||
        card.effect_text_en ||
        card.atk !== null ||
        card.def !== null
    );
    if (hasDetails && !force) {
      this.updateCardStatus(card.id, CARD_STATUSES.SKIP_DETAILS_PRESENT, null, null);
      return { status: CARD_STATUSES.SKIP_DETAILS_PRESENT };
    }

    const result = await fetchCardDetails({
      passcode: card.passcode,
      en_name: card.en_name,
      de_name: card.de_name,
      userAgent: settings.user_agent,
      maxCandidates: settings.max_candidates_passcode_match
    });

    if (result.status === CARD_STATUSES.NOT_FOUND) {
      this.updateCardStatus(card.id, CARD_STATUSES.NOT_FOUND, null, null);
      return result;
    }

    const now = new Date().toISOString();
    const detail = result.cardDetails;
    const passcodeMismatch = detail.passcode && card.passcode && detail.passcode !== card.passcode;
    const newPasscode = card.passcode || detail.passcode || null;

    const status = passcodeMismatch ? CARD_STATUSES.WARNING_PASSCODE_MISMATCH : CARD_STATUSES.OK_DETAILS;
    this.db.prepare(`
      UPDATE cards SET
        passcode = ?,
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
        error_message = NULL,
        raw_url = ?
      WHERE id = ?
    `).run(
      newPasscode,
      status,
      now,
      now,
      detail.cardcluster_url,
      detail.card_kind,
      detail.card_subtypes,
      detail.attribute,
      detail.level_or_rank,
      detail.link_rating,
      detail.race,
      detail.atk,
      detail.def,
      detail.pendulum_scale,
      detail.spell_trap_property,
      detail.effect_text_en,
      detail.cardcluster_url,
      card.id
    );

    if (passcodeMismatch) {
      this.logger.log(this.db, 'warn', `Passcode mismatch for card ${card.id}: existing=${card.passcode}, fetched=${detail.passcode}`);
    }

    return { status, cardUrl: detail.cardcluster_url };
  }

  updateCardStatus(cardId, status, errorMessage, rawUrl) {
    this.db.prepare(`
      UPDATE cards SET status = ?, updated_at = ?, error_message = ?, raw_url = ? WHERE id = ?
    `).run(status, new Date().toISOString(), errorMessage, rawUrl, cardId);
  }

  async runJob(jobId) {
    if (this.activeJobs.has(jobId)) return;

    const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job || job.status !== JOB_STATUSES.RUNNING) return;

    const settings = this.getSettings();
    const payload = JSON.parse(job.payload_json || '{"cardIds":[]}');
    const cardIds = payload.cardIds || [];
    const force = Boolean(payload.force);

    this.activeJobs.set(jobId, true);

    const concurrency = settings.concurrency || 3;
    const delay = settings.request_delay_ms || 300;

    let cursor = job.cursor;

    while (cursor < cardIds.length) {
      const currentJob = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (currentJob.status !== JOB_STATUSES.RUNNING) {
        break;
      }

      const batch = cardIds.slice(cursor, cursor + settings.batch_size);
      for (let index = 0; index < batch.length; index += concurrency) {
        const group = batch.slice(index, index + concurrency);
        const cards = group.map((id) => this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id));
        const results = await Promise.all(
          cards.map((card) =>
            this.processCard(card, settings, force).catch((error) => ({ error, status: CARD_STATUSES.ERROR }))
          )
        );

        results.forEach((result, idx) => {
          const cardId = group[idx];
          if (result.error) {
            this.updateCardStatus(cardId, CARD_STATUSES.ERROR, result.error.message, null);
            this.logger.log(this.db, 'error', `Error fetching card ${cardId}: ${result.error.message}`);
            const latest = this.db.prepare('SELECT errors FROM jobs WHERE id = ?').get(jobId);
            this.updateJob(jobId, {
              errors: (latest?.errors || 0) + 1,
              last_error: result.error.message
            });
          }
        });

        await sleep(delay);
      }

      cursor += batch.length;
      this.updateJob(jobId, {
        cursor,
        done: cursor,
        current_card_id: batch[batch.length - 1] || null
      });
    }

    const finalJob = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (finalJob.status === JOB_STATUSES.RUNNING && cursor >= cardIds.length) {
      this.updateJob(jobId, { status: JOB_STATUSES.COMPLETED });
    }

    this.activeJobs.delete(jobId);
  }

  pauseJob(jobId) {
    this.updateJob(jobId, { status: JOB_STATUSES.PAUSED });
  }

  resumeJob(jobId) {
    this.updateJob(jobId, { status: JOB_STATUSES.RUNNING });
    this.runJob(jobId);
  }

  cancelJob(jobId) {
    this.updateJob(jobId, { status: JOB_STATUSES.CANCELED });
  }
}

module.exports = {
  JobRunner
};
