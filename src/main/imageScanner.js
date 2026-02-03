const { createWorker } = require('tesseract.js');

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-' "
      });
      return worker;
    })();
  }
  return workerPromise;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractPasscode(text) {
  const match = text.match(/\b\d{8}\b/);
  return match ? match[0] : null;
}

function buildBounds(lines) {
  const bounds = lines.reduce(
    (acc, line) => {
      const { x0, y0, x1, y1 } = line.bbox || {};
      if (typeof x0 !== 'number' || typeof y0 !== 'number' || typeof x1 !== 'number' || typeof y1 !== 'number') {
        return acc;
      }
      acc.maxX = Math.max(acc.maxX, x1);
      acc.maxY = Math.max(acc.maxY, y1);
      return acc;
    },
    { maxX: 0, maxY: 0 }
  );
  return bounds;
}

function pickPasscode(lines, width, height) {
  const candidates = [];
  lines.forEach((line) => {
    const text = normalizeText(line.text);
    const passcode = extractPasscode(text);
    if (!passcode) return;
    const bbox = line.bbox || {};
    const inLowerBand = typeof bbox.y0 === 'number' && bbox.y0 > height * 0.6;
    const inLeftBand = typeof bbox.x0 === 'number' && bbox.x0 < width * 0.6;
    candidates.push({
      passcode,
      score: (inLowerBand ? 2 : 0) + (inLeftBand ? 1 : 0) + text.length / 100
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.passcode || null;
}

function pickName(lines, width, height) {
  const candidates = [];
  lines.forEach((line) => {
    const text = normalizeText(line.text);
    if (text.length < 4 || /\d/.test(text)) return;
    if (!/[A-Za-z]/.test(text)) return;
    const bbox = line.bbox || {};
    const inTopBand = typeof bbox.y1 === 'number' && bbox.y1 < height * 0.3;
    const score = (inTopBand ? 2 : 0) + Math.min(text.length / 20, 1);
    candidates.push({ text, score });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.text || null;
}

async function analyzeCardImage(imageBuffer) {
  const worker = await getWorker();
  let result = await worker.recognize(imageBuffer);
  let data = result?.data || {};
  let lines = Array.isArray(data.lines) ? data.lines : [];
  const bounds = buildBounds(lines);
  const width = data.imageSize?.width || bounds.maxX || 1;
  const height = data.imageSize?.height || bounds.maxY || 1;

  let passcode = pickPasscode(lines, width, height) || extractPasscode(data.text || '');
  let name = pickName(lines, width, height);
  let rawText = normalizeText(data.text || '');

  if (!passcode) {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
    result = await worker.recognize(imageBuffer);
    data = result?.data || {};
    passcode = extractPasscode(data.text || '') || passcode;
    rawText = rawText || normalizeText(data.text || '');
  }

  if (!name) {
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-' " });
    result = await worker.recognize(imageBuffer);
    data = result?.data || {};
    lines = Array.isArray(data.lines) ? data.lines : [];
    name = pickName(lines, width, height) || name;
    rawText = rawText || normalizeText(data.text || '');
  }

  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-' "
  });

  return {
    passcode: passcode || null,
    name: name || null,
    rawText
  };
}

module.exports = {
  analyzeCardImage
};
