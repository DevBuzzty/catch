const cheerio = require('cheerio');

const SEARCH_BASE = 'https://cardcluster.com/cards?q=';
const YGOPRO_BASE = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const YGOPRO_SEARCH_BASE = 'https://ygoprodeck.com/card-database/';
const FANDOM_BASE = 'https://yugioh.fandom.com';
const FANDOM_DE_BASE = 'https://de.yugioh.fandom.com';

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

function extractCardclusterCandidates(html) {
  const $ = cheerio.load(html);
  const candidates = [];
  $('a[href^="/card/"]').each((_, el) => {
    const link = $(el);
    const href = link.attr('href');
    if (!href) return;
    const name = link.text().trim();
    const rowText = link.closest('tr, li, div').text();
    const passcode = extractPasscodeFromText(rowText);
    candidates.push({
      url: `https://cardcluster.com${href}`,
      name: name || null,
      passcode: passcode || null
    });
  });
  return candidates;
}

function extractPasscodeFromText(text) {
  const match = text.match(/\b\d{4,12}\b/);
  return match ? match[0] : null;
}

function toNumber(value) {
  const normalized = String(value || '').replace(/[^0-9-]+/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreNameMatch(candidateName, query) {
  const normalizedCandidate = normalizeForMatch(candidateName);
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedCandidate || !normalizedQuery) return 0;
  if (normalizedCandidate === normalizedQuery) return 3;
  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) return 2;
  const queryParts = normalizedQuery.split(' ').filter(Boolean);
  const matchCount = queryParts.filter((part) => normalizedCandidate.includes(part)).length;
  return matchCount > 0 ? 1 : 0;
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

function findBestCardclusterCandidate(candidates, query, expectedPasscode) {
  let best = null;
  let bestScore = 0;
  candidates.forEach((candidate) => {
    if (expectedPasscode && candidate.passcode === expectedPasscode) {
      best = candidate;
      bestScore = 99;
      return;
    }
    const score = scoreNameMatch(candidate.name, query);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return bestScore > 0 ? best : null;
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
    name: cardObj.name || null,
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

async function searchCardclusterCandidates(query, userAgent) {
  const url = `${SEARCH_BASE}${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, userAgent);
  const candidates = extractCardclusterCandidates(html);
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

async function resolveCardclusterUrlForName(query, userAgent, maxCandidates) {
  const { html, candidates } = await searchCardclusterCandidates(query, userAgent);
  if (candidates.length === 0) return null;
  const best = findBestCardclusterCandidate(candidates, query, null);
  if (best?.url) return best.url;
  const limited = candidates.slice(0, maxCandidates);
  for (const candidate of limited) {
    const detailHtml = await fetchHtml(candidate.url, userAgent);
    const nextData = parseNextData(detailHtml);
    const cardObj = findCardObject(nextData);
    const cardName = cardObj?.name || '';
    if (scoreNameMatch(cardName, query) >= 2) {
      return candidate.url;
    }
  }
  return null;
}

async function fetchCardDetails({ passcode, en_name, de_name, userAgent, maxCandidates }) {
  const useGermanSources = Boolean(de_name && !en_name && !passcode);
  const fandomSource = useGermanSources
    ? { baseUrl: FANDOM_DE_BASE, sourceKey: 'fandom_de' }
    : { baseUrl: FANDOM_BASE, sourceKey: 'fandom' };

  const fetchers = [
    { key: 'cardcluster', run: () => fetchFromCardcluster({ passcode, en_name, de_name, userAgent, maxCandidates }) },
    {
      key: fandomSource.sourceKey,
      run: () =>
        fetchFromMediaWiki({
          passcode,
          en_name,
          de_name,
          userAgent,
          maxCandidates,
          baseUrl: fandomSource.baseUrl,
          sourceKey: fandomSource.sourceKey
        })
    },
    { key: 'ygoprodeck', run: () => fetchFromYgoProDeck({ passcode, en_name, de_name, userAgent, maxCandidates }) }
  ];

  const results = [];
  let lastIncomplete = null;
  for (let index = 0; index < fetchers.length; index += 1) {
    const fetcher = fetchers[index];
    const result = await fetcher.run();
    results.push(result);
    if (result.status === 'OK_DETAILS') {
      if (!hasRequiredDetails(result.cardDetails)) {
        lastIncomplete = result;
        continue;
      }
      const verified = await verifyDetails(result.cardDetails, fetchers);
      if (verified) {
        return result;
      }
      lastIncomplete = result;
    }
  }

  if (lastIncomplete?.cardDetails) {
    return { ...lastIncomplete, status: 'PARTIAL_DETAILS' };
  }

  return {
    status: 'NOT_FOUND',
    cardUrl: null,
    cardDetails: null,
    searchVariant: results.find((result) => result.searchVariant)?.searchVariant || null,
    source: 'none'
  };
}

function hasRequiredDetails(detail) {
  if (!detail) return false;
  const name = detail.name || detail.en_name || '';
  const passcode = detail.passcode || '';
  const kind = detail.card_kind || '';
  const effect = detail.effect_text_en || '';
  const normalizedKind = String(kind).toLowerCase();
  const isSpellOrTrap = normalizedKind.includes('spell') || normalizedKind.includes('trap');
  const hasStats = detail.atk !== null || detail.def !== null || detail.level_or_rank !== null || detail.link_rating !== null;
  if (isSpellOrTrap) {
    return Boolean(name && passcode && kind && effect);
  }
  return Boolean(name && passcode && kind && effect && hasStats);
}

function isSameCard(primary, secondary) {
  if (!secondary) return false;
  if (primary.passcode && secondary.passcode && String(primary.passcode) === String(secondary.passcode)) {
    return true;
  }
  const name = primary.name || primary.en_name || '';
  const compareName = secondary.name || secondary.en_name || '';
  return scoreNameMatch(name, compareName) >= 2;
}

async function verifyDetails(primaryDetail, fetchers) {
  for (const fetcher of fetchers) {
    const result = await fetcher.run();
    if (result.status !== 'OK_DETAILS') {
      continue;
    }
    if (!hasRequiredDetails(result.cardDetails)) {
      continue;
    }
    if (isSameCard(primaryDetail, result.cardDetails)) {
      return true;
    }
  }
  return false;
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
    cardUrl = await resolveCardclusterUrlForName(normalizedEn, userAgent, maxCandidates);
  }

  if (!cardUrl && normalizedDe) {
    searchVariant = 'de_name';
    cardUrl = await resolveCardclusterUrlForName(normalizedDe, userAgent, maxCandidates);
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

async function fetchFromYgoProDeck({ passcode, en_name, de_name, userAgent, maxCandidates }) {
  const normalizedPasscode = normalizeString(passcode);
  const normalizedEn = normalizeString(en_name);
  const normalizedDe = normalizeString(de_name);

  let url = null;
  let searchVariant = null;
  const expectedPasscode = normalizedPasscode || null;

  const searchQuery = normalizedPasscode || normalizedEn || normalizedDe;
  if (searchQuery) {
    const candidates = await searchYgoProDeckHtml(searchQuery, userAgent);
    const limited = candidates.slice(0, maxCandidates || 5);
    const bestCandidate = limited.find((candidate) => candidate.id === expectedPasscode)
      || limited.find((candidate) => candidate.id)
      || limited.find((candidate) => scoreNameMatch(candidate.name, searchQuery) >= 2)
      || limited[0];
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

async function fetchFromMediaWiki({ passcode, en_name, de_name, userAgent, maxCandidates, baseUrl, sourceKey }) {
  const normalizedPasscode = normalizeString(passcode);
  const normalizedEn = normalizeString(en_name);
  const normalizedDe = normalizeString(de_name);

  const searchQuery = normalizedPasscode || normalizedEn || normalizedDe;
  if (!searchQuery) {
    return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant: null, source: sourceKey };
  }

  const candidates = await searchMediaWiki(searchQuery, userAgent, baseUrl);
  if (candidates.length === 0) {
    return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant: null, source: sourceKey };
  }

  const limited = candidates.slice(0, maxCandidates || 5);
  const best = findBestWikiCandidate(limited, searchQuery);
  const target = best || limited[0];
  if (!target?.title) {
    return { status: 'NOT_FOUND', cardUrl: null, cardDetails: null, searchVariant: null, source: sourceKey };
  }

  const cardUrl = `${baseUrl}/wiki/${encodeURIComponent(target.title.replace(/ /g, '_'))}`;
  const html = await fetchMediaWikiPageHtml(target.title, userAgent, baseUrl);
  const parsed = parseMediaWikiCard(html, cardUrl, sourceKey, target.title);
  if (!parsed?.name) {
    return { status: 'NOT_FOUND', cardUrl, cardDetails: null, searchVariant: null, source: sourceKey };
  }

  if (normalizedPasscode && parsed.passcode && String(parsed.passcode) !== String(normalizedPasscode)) {
    return { status: 'NOT_FOUND', cardUrl, cardDetails: null, searchVariant: null, source: sourceKey };
  }

  const mapped = mapMediaWikiCard(parsed, cardUrl, sourceKey);
  return { status: 'OK_DETAILS', cardUrl, cardDetails: mapped, searchVariant: normalizedPasscode ? 'passcode' : normalizedEn ? 'en_name' : 'de_name', source: sourceKey };
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
    name: cardObj.name || null,
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

async function searchMediaWiki(query, userAgent, baseUrl) {
  const url = `${baseUrl}/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&namespace=0&format=json`;
  const data = await fetchJson(url, userAgent);
  const titles = Array.isArray(data?.[1]) ? data[1] : [];
  return titles.map((title) => ({ title }));
}

function findBestWikiCandidate(candidates, query) {
  let best = null;
  let bestScore = 0;
  candidates.forEach((candidate) => {
    const score = scoreNameMatch(candidate.title, query);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });
  return bestScore > 0 ? best : null;
}

async function fetchMediaWikiPageHtml(title, userAgent, baseUrl) {
  const url = `${baseUrl}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json`;
  const data = await fetchJson(url, userAgent);
  const html = data?.parse?.text?.['*'] || '';
  return html;
}

function parseMediaWikiCard(html, pageUrl, sourceKey, fallbackTitle) {
  const $ = cheerio.load(html);
  const cardName = $('h1#firstHeading').text().trim() || $('h1').first().text().trim() || fallbackTitle || '';
  const infobox = $('.cardtable, .cardtable-main, .infobox, table.wikitable').first();
  const details = {
    name: cardName || null,
    passcode: null,
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
    effect_text_en: null
  };

  if (infobox.length) {
    infobox.find('tr').each((_, row) => {
      const label = $(row).find('th').first().text().trim().toLowerCase();
      const value = $(row).find('td').first().text().trim();
      if (!label || !value) return;
      if (label.includes('passcode') || label.includes('password')) {
        details.passcode = extractPasscodeFromText(value) || details.passcode;
      }
      if (label.includes('attribute')) details.attribute = value;
      if (label.includes('level') || label.includes('rank')) details.level_or_rank = toNumber(value);
      if (label.includes('atk')) {
        const [atk, def] = value.split('/').map((part) => part.trim());
        details.atk = toNumber(atk);
        if (def) details.def = toNumber(def);
      }
      if (label.includes('def') && !details.def) {
        details.def = toNumber(value);
      }
      if (label.includes('type')) {
        details.card_subtypes = value;
        if (value.includes('Spell')) details.card_kind = 'Spell';
        else if (value.includes('Trap')) details.card_kind = 'Trap';
        else details.card_kind = 'Monster';
      }
      if (label.includes('property')) details.spell_trap_property = value;
      if (label.includes('race') || label.includes('type')) {
        details.race = details.race || value;
      }
      if (label.includes('scale')) details.pendulum_scale = toNumber(value);
      if (label.includes('link rating')) details.link_rating = toNumber(value);
      if (label.includes('card text') || label.includes('effect')) details.effect_text_en = value;
    });
  }

  if (!details.passcode) {
    const text = $.text();
    details.passcode = extractPasscodeFromText(text);
  }

  return { ...details, url: pageUrl, data_source: sourceKey };
}

function mapMediaWikiCard(cardObj, cardUrl, sourceKey) {
  return {
    data_source: sourceKey,
    source_url: cardUrl,
    name: cardObj.name || null,
    cardcluster_url: null,
    card_kind: cardObj.card_kind || null,
    card_subtypes: cardObj.card_subtypes || null,
    attribute: cardObj.attribute || null,
    level_or_rank: toNumber(cardObj.level_or_rank),
    link_rating: toNumber(cardObj.link_rating),
    race: cardObj.race || null,
    atk: toNumber(cardObj.atk),
    def: toNumber(cardObj.def),
    pendulum_scale: toNumber(cardObj.pendulum_scale),
    spell_trap_property: cardObj.spell_trap_property || null,
    effect_text_en: cardObj.effect_text_en || null,
    passcode: cardObj.passcode ? String(cardObj.passcode) : null
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
  extractCardclusterCandidates,
  parseNextData,
  findCardObject,
  findDeckObject,
  mapCardDetails,
  mapDeckCards,
  fetchCardDetails,
  fetchDeckFromUrl,
  resolveCardUrlForPasscode,
  resolveCardclusterUrlForName,
  fetchFromCardcluster,
  fetchFromMediaWiki,
  fetchFromYgoProDeck,
  mapYgoProCard,
  searchYgoProDeckHtml,
  extractYgoProDeckCandidates,
  scoreNameMatch
};
