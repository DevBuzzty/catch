const cheerio = require('cheerio');

const SEARCH_BASE = 'https://cardcluster.com/cards?q=';

function normalizeString(value) {
  if (!value) return '';
  return String(value).trim();
}

function extractCardLinksFromSearch(html) {
  const $ = cheerio.load(html);
  const links = new Set();
  $('a[href^="/card/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      links.add(`https://cardcluster.com${href}`);
    }
  });
  return Array.from(links);
}

function extractPasscodeFromText(text) {
  const match = text.match(/\b\d{4,12}\b/);
  return match ? match[0] : null;
}

function findCandidateWithPasscode(html, passcode, candidates) {
  const $ = cheerio.load(html);
  for (const link of candidates) {
    const anchor = $(`a[href="${link.replace('https://cardcluster.com', '')}"]`);
    if (anchor.length) {
      const text = anchor.closest('tr, li, div').text();
      const found = extractPasscodeFromText(text);
      if (found && found === passcode) {
        return link;
      }
    }
  }
  return null;
}

function parseNextData(html) {
  const $ = cheerio.load(html);
  const script = $('#__NEXT_DATA__').text();
  if (!script) {
    throw new Error('Missing __NEXT_DATA__');
  }
  return JSON.parse(script);
}

function findCardObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findCardObject(item);
      if (found) return found;
    }
    return null;
  }

  const keys = Object.keys(obj);
  const hasName = 'name' in obj && obj.name;
  const hasSignals = keys.some((key) =>
    ['atk', 'def', 'attribute', 'race', 'level', 'rank', 'scale', 'desc', 'type', 'types', 'cardType', 'passcode', 'id'].includes(key)
  );
  if (hasName && hasSignals) {
    return obj;
  }

  for (const value of Object.values(obj)) {
    const found = findCardObject(value);
    if (found) return found;
  }

  return null;
}

function findDeckObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeckObject(item);
      if (found) return found;
    }
    return null;
  }

  const hasName = obj.name || obj.title || obj.deckName;
  const hasCards = Array.isArray(obj.cards) || Array.isArray(obj.mainDeck) || Array.isArray(obj.extraDeck) || Array.isArray(obj.sideDeck);

  if (hasName && hasCards) {
    return obj;
  }

  for (const value of Object.values(obj)) {
    const found = findDeckObject(value);
    if (found) return found;
  }

  return null;
}

function mapCardDetails(cardObj) {
  const typeText = cardObj.type || cardObj.cardType || '';
  const types = Array.isArray(cardObj.types) ? cardObj.types : null;
  const kind = typeText.includes('Spell') ? 'Spell' : typeText.includes('Trap') ? 'Trap' : 'Monster';
  const subtypes = types ? types.join(', ') : typeText.split(' / ').slice(1).join(', ');
  const levelOrRank = cardObj.level || cardObj.rank || null;

  return {
    cardcluster_url: cardObj.url || null,
    card_kind: kind || null,
    card_subtypes: subtypes || null,
    attribute: cardObj.attribute || null,
    level_or_rank: levelOrRank ? Number(levelOrRank) : null,
    link_rating: cardObj.link ? Number(cardObj.link) : null,
    race: cardObj.race || null,
    atk: cardObj.atk ? Number(cardObj.atk) : null,
    def: cardObj.def ? Number(cardObj.def) : null,
    pendulum_scale: cardObj.scale ? Number(cardObj.scale) : null,
    spell_trap_property: cardObj.property || null,
    effect_text_en: cardObj.desc || null,
    passcode: cardObj.passcode ? String(cardObj.passcode) : null
  };
}

function mapDeckCards(deckObj) {
  const groups = [
    ...(Array.isArray(deckObj.cards) ? [{ label: 'main', list: deckObj.cards }] : []),
    ...(Array.isArray(deckObj.mainDeck) ? [{ label: 'main', list: deckObj.mainDeck }] : []),
    ...(Array.isArray(deckObj.extraDeck) ? [{ label: 'extra', list: deckObj.extraDeck }] : []),
    ...(Array.isArray(deckObj.sideDeck) ? [{ label: 'side', list: deckObj.sideDeck }] : [])
  ];

  const cards = [];
  groups.forEach(({ list }) => {
    list.forEach((entry) => {
      const card = entry.card || entry;
      const name = card.name || entry.name || '';
      const passcode = card.passcode || entry.passcode || card.id || null;
      const quantity = Number(entry.quantity || entry.count || entry.qty || 1);
      if (name) {
        cards.push({
          name,
          passcode: passcode ? String(passcode) : null,
          quantity: Number.isNaN(quantity) ? 1 : quantity
        });
      }
    });
  });
  return cards;
}

async function fetchHtml(url, userAgent) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function searchCardUrl(query, userAgent) {
  const url = `${SEARCH_BASE}${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, userAgent);
  const candidates = extractCardLinksFromSearch(html);
  return { html, candidates };
}

async function resolveCardUrlForPasscode(passcode, userAgent, maxCandidates) {
  const { html, candidates } = await searchCardUrl(passcode, userAgent);
  if (candidates.length === 0) return null;
  const found = findCandidateWithPasscode(html, passcode, candidates);
  if (found) return found;
  const limited = candidates.slice(0, maxCandidates);
  for (const candidate of limited) {
    const detailHtml = await fetchHtml(candidate, userAgent);
    const nextData = parseNextData(detailHtml);
    const cardObj = findCardObject(nextData);
    if (cardObj && String(cardObj.passcode || cardObj.id || '') === String(passcode)) {
      return candidate;
    }
  }
  return null;
}

async function fetchCardDetails({ passcode, en_name, de_name, userAgent, maxCandidates }) {
  const normalizedPasscode = normalizeString(passcode);
  const normalizedEn = normalizeString(en_name);
  const normalizedDe = normalizeString(de_name);

  let cardUrl = null;
  let searchVariant = null;

  if (normalizedPasscode) {
    searchVariant = 'passcode';
    cardUrl = await resolveCardUrlForPasscode(normalizedPasscode, userAgent, maxCandidates);
  }

  if (!cardUrl && normalizedEn) {
    searchVariant = 'en_name';
    const result = await searchCardUrl(normalizedEn, userAgent);
    cardUrl = result.candidates[0] || null;
  }

  if (!cardUrl && normalizedDe) {
    searchVariant = 'de_name';
    const result = await searchCardUrl(normalizedDe, userAgent);
    cardUrl = result.candidates[0] || null;
  }

  if (!cardUrl) {
    return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant };
  }

  const detailHtml = await fetchHtml(cardUrl, userAgent);
  const nextData = parseNextData(detailHtml);
  const cardObj = findCardObject(nextData);
  if (!cardObj) {
    throw new Error('Card object not found in NEXT_DATA');
  }
  const mapped = mapCardDetails({ ...cardObj, url: cardUrl });
  return { status: 'OK_DETAILS', cardUrl, cardDetails: mapped, searchVariant };
}

async function fetchDeckFromUrl(url, userAgent) {
  const html = await fetchHtml(url, userAgent);
  const nextData = parseNextData(html);
  const deckObj = findDeckObject(nextData);
  if (!deckObj) {
    throw new Error('Deck object not found in NEXT_DATA');
  }
  const deckName = deckObj.name || deckObj.title || deckObj.deckName || 'Cardcluster Deck';
  const cards = mapDeckCards(deckObj);
  if (cards.length === 0) {
    throw new Error('No cards found in deck data');
  }
  return { deckName, cards };
}

module.exports = {
  extractCardLinksFromSearch,
  parseNextData,
  findCardObject,
  findDeckObject,
  mapCardDetails,
  mapDeckCards,
  fetchCardDetails,
  fetchDeckFromUrl,
  resolveCardUrlForPasscode
};
