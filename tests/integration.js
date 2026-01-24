const { fetchCardDetails } = require('../src/main/scraper');

async function run() {
  const result = await fetchCardDetails({
    en_name: 'Dark Magician',
    passcode: '',
    de_name: '',
    userAgent: 'YGO-Card-Manager/0.1',
    maxCandidates: 5
  });

  if (!result.cardDetails) {
    throw new Error(`Integration test failed: ${result.status}`);
  }

  console.log('Integration test OK:', result.cardDetails.cardcluster_url);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
