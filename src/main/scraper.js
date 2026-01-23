const cheerio = require('cheerio');

const SEARCH_BASE = 'https://cardcluster.com/cards?q=';
const YGOPRO_BASE = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const YGOPRO_SEARCH_BASE = 'https://ygoprodeck.com/card-database/';

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
    data_source: cardObj.data_source || null,
    source_url: cardObj.source_url || null,
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

async function fetchJson(url, userAgent) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function extractYgoProDeckCandidates(html) {
  const $ = cheerio.load(html);
  const candidates = [];
  $('[data-id], [data-card-id], [data-passcode]').each((_, el) => {
    const node = $(el);
    const id = node.attr('data-id') || node.attr('data-card-id') || node.attr('data-passcode');
    const name = node.attr('data-name') || node.find('.card-name, .name, h3, h4').first().text().trim();
    if (id || name) {
      candidates.push({ id: id ? String(id) : null, name: name || null });
    }
  });

  $('a[href*="/card/"]').each((_, el) => {
    const link = $(el);
    const name = link.text().trim();
    const idMatch = link.attr('href')?.match(/\/card\/(\d+)\//);
    if (idMatch || name) {
      candidates.push({ id: idMatch ? idMatch[1] : null, name: name || null });
    }
  });

  return candidates.filter((candidate) => candidate.id || candidate.name);
}

async function searchYgoProDeckHtml(query, userAgent) {
  const url = `${YGOPRO_SEARCH_BASE}?&fname=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, userAgent);
  return extractYgoProDeckCandidates(html);
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
  const cardclusterResult = await fetchFromCardcluster({
    passcode,
    en_name,
    de_name,
    userAgent,
    maxCandidates
  });

  if (cardclusterResult.status === 'OK_DETAILS') {
    return cardclusterResult;
  }

  const ygoproResult = await fetchFromYgoProDeck({
    passcode,
    en_name,
    de_name,
    userAgent
  });

  if (ygoproResult.status === 'OK_DETAILS') {
    return ygoproResult;
  }

  return {
    status: 'NOT_FOUND',
    cardUrl: null,
    cardDetails: null,
    searchVariant: cardclusterResult.searchVariant || ygoproResult.searchVariant || null,
    source: 'none'
  };
}

async function fetchFromCardcluster({ passcode, en_name, de_name, userAgent, maxCandidates }) {
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
    return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant, source: 'cardcluster' };
  }

  const detailHtml = await fetchHtml(cardUrl, userAgent);
  const nextData = parseNextData(detailHtml);
  const cardObj = findCardObject(nextData);
  if (!cardObj) {
    throw new Error('Card object not found in NEXT_DATA');
  }
  const mapped = mapCardDetails({ ...cardObj, url: cardUrl, data_source: 'cardcluster', source_url: cardUrl });
  return { status: 'OK_DETAILS', cardUrl, cardDetails: mapped, searchVariant, source: 'cardcluster' };
}

async function fetchFromYgoProDeck({ passcode, en_name, de_name, userAgent }) {
  const normalizedPasscode = normalizeString(passcode);
  const normalizedEn = normalizeString(en_name);
  const normalizedDe = normalizeString(de_name);

  let url = null;
  let searchVariant = null;

  const searchQuery = normalizedPasscode || normalizedEn || normalizedDe;
  if (searchQuery) {
    const candidates = await searchYgoProDeckHtml(searchQuery, userAgent);
    const bestCandidate = candidates.find((candidate) => candidate.id) || candidates[0];
    if (bestCandidate?.id) {
      searchVariant = 'passcode';
      url = `${YGOPRO_BASE}?id=${encodeURIComponent(bestCandidate.id)}`;
    } else if (bestCandidate?.name) {
      searchVariant = normalizedEn ? 'en_name' : 'de_name';
      url = `${YGOPRO_BASE}?name=${encodeURIComponent(bestCandidate.name)}`;
    }
  }

  if (!url) {
    if (normalizedPasscode) {
      searchVariant = 'passcode';
      url = `${YGOPRO_BASE}?id=${encodeURIComponent(normalizedPasscode)}`;
    } else if (normalizedEn) {
      searchVariant = 'en_name';
      url = `${YGOPRO_BASE}?name=${encodeURIComponent(normalizedEn)}`;
    } else if (normalizedDe) {
      searchVariant = 'de_name';
      url = `${YGOPRO_BASE}?name=${encodeURIComponent(normalizedDe)}`;
    }
  }

  if (!url) {
    return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant, source: 'ygoprodeck' };
  }

  try {
    const data = await fetchJson(url, userAgent);
    const card = data?.data?.[0];
    if (!card) {
      return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant, source: 'ygoprodeck' };
    }
    const mapped = mapYgoProCard(card);
    return { status: 'OK_DETAILS', cardUrl: mapped.source_url, cardDetails: mapped, searchVariant, source: 'ygoprodeck' };
  } catch (error) {
    if (String(error.message || '').includes('HTTP 400')) {
      return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant, source: 'ygoprodeck' };
    }
    throw error;
  }
}

function mapYgoProCard(cardObj) {
  const typeText = cardObj.type || '';
  const kind = typeText.includes('Spell') ? 'Spell' : typeText.includes('Trap') ? 'Trap' : 'Monster';
  const typeParts = typeText.split(' / ');
  const subtypes = typeParts.length > 1 ? typeParts.slice(1).join(', ') : typeText;
  const levelOrRank = cardObj.level || cardObj.rank || null;

  return {
    data_source: 'ygoprodeck',
    source_url: cardObj.card_images?.[0]?.image_url || null,
    cardcluster_url: null,
    card_kind: kind || null,
    card_subtypes: subtypes || null,
    attribute: cardObj.attribute || null,
    level_or_rank: levelOrRank ? Number(levelOrRank) : null,
    link_rating: cardObj.linkval ? Number(cardObj.linkval) : null,
    race: cardObj.race || null,
    atk: cardObj.atk !== null && cardObj.atk !== undefined ? Number(cardObj.atk) : null,
    def: cardObj.def !== null && cardObj.def !== undefined ? Number(cardObj.def) : null,
    pendulum_scale: cardObj.scale ? Number(cardObj.scale) : null,
    spell_trap_property: cardObj.race || null,
    effect_text_en: cardObj.desc || null,
    passcode: cardObj.id ? String(cardObj.id) : null
  };
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
  resolveCardUrlForPasscode,
  fetchFromCardcluster,
  fetchFromYgoProDeck,
  mapYgoProCard,
  searchYgoProDeckHtml,
  extractYgoProDeckCandidates
};
