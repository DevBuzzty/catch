const { describe, it, expect } = require('vitest');
const { extractCardLinksFromSearch, parseNextData, findCardObject, mapCardDetails } = require('../src/main/scraper');

const SEARCH_HTML = `
  <html>
    <body>
      <a href="/card/dark-magician">Dark Magician</a>
      <a href="/card/blue-eyes">Blue-Eyes</a>
    </body>
  </html>
`;

const NEXT_DATA_HTML = `
  <html>
    <body>
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"card":{"name":"Dark Magician","passcode":"46986414","atk":2500,"def":2100,"attribute":"DARK","race":"Spellcaster","type":"Monster / Normal","desc":"Legendary magician"}}}}
      </script>
    </body>
  </html>
`;

describe('scraper utilities', () => {
  it('extracts card links from search html', () => {
    const links = extractCardLinksFromSearch(SEARCH_HTML);
    expect(links).toEqual([
      'https://cardcluster.com/card/dark-magician',
      'https://cardcluster.com/card/blue-eyes'
    ]);
  });

  it('parses NEXT_DATA and maps details', () => {
    const nextData = parseNextData(NEXT_DATA_HTML);
    const cardObj = findCardObject(nextData);
    const mapped = mapCardDetails(cardObj);

    expect(mapped.card_kind).toBe('Monster');
    expect(mapped.atk).toBe(2500);
    expect(mapped.def).toBe(2100);
    expect(mapped.attribute).toBe('DARK');
  });
});
