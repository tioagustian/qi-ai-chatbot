// Simple test to debug cache expiry
function testCacheSimple() {
  console.log('🧪 Simple Cache Test...\n');
  
  // Test data from the attached file
  const cachedQuery = "Harga game R.E.P.O.";
  const currentQuery = "harga emas terbaru hari ini";
  const cachedTimestamp = "2025-05-02T16:23:24.930Z";
  
  // Calculate age
  const searchTime = new Date(cachedTimestamp).getTime();
  const currentTime = Date.now();
  const ageInMinutes = Math.floor((currentTime - searchTime) / (1000 * 60));
  const ageInHours = ageInMinutes / 60;
  const ageInDays = ageInHours / 24;
  
  console.log(`📅 Cached timestamp: ${cachedTimestamp}`);
  console.log(`🕐 Current time: ${new Date().toISOString()}`);
  console.log(`⏰ Age: ${ageInMinutes} minutes (${ageInHours.toFixed(1)} hours, ${ageInDays.toFixed(1)} days)`);
  
  // Test cache expiry (2 hours)
  const maxAgeMinutes = 120;
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const oldestAllowed = currentTime - maxAgeMs;
  const isExpired = searchTime < oldestAllowed;
  
  console.log(`\n🔍 Cache expiry test (${maxAgeMinutes} minutes):`);
  console.log(`   Oldest allowed: ${new Date(oldestAllowed).toISOString()}`);
  console.log(`   Is expired: ${isExpired ? '❌ YES' : '✅ NO'}`);
  
  // Test similarity
  console.log(`\n🔍 Similarity test:`);
  console.log(`   Cached query: "${cachedQuery}"`);
  console.log(`   Current query: "${currentQuery}"`);
  
  const normalizedQuery = currentQuery.toLowerCase().trim();
  const cachedQueryNormalized = cachedQuery.toLowerCase().trim();
  
  // Exact match
  if (cachedQueryNormalized === normalizedQuery) {
    console.log(`   Exact match: ✅ YES`);
  } else {
    console.log(`   Exact match: ❌ NO`);
  }
  
  // Partial match
  if (cachedQueryNormalized.includes(normalizedQuery) || normalizedQuery.includes(cachedQueryNormalized)) {
    console.log(`   Partial match: ✅ YES`);
    const lengthRatio = Math.min(cachedQueryNormalized.length, normalizedQuery.length) / 
                       Math.max(cachedQueryNormalized.length, normalizedQuery.length);
    console.log(`   Length ratio: ${lengthRatio.toFixed(3)}`);
    console.log(`   Similarity score: ${(0.8 * lengthRatio).toFixed(3)}`);
  } else {
    console.log(`   Partial match: ❌ NO`);
  }
  
  // Word-based similarity
  const queryWords = new Set(normalizedQuery.split(/\s+/).filter(w => w.length > 2));
  const cachedWords = new Set(cachedQueryNormalized.split(/\s+/).filter(w => w.length > 2));
  
  console.log(`   Query words: [${Array.from(queryWords).join(', ')}]`);
  console.log(`   Cached words: [${Array.from(cachedWords).join(', ')}]`);
  
  const intersection = new Set([...queryWords].filter(x => cachedWords.has(x)));
  const union = new Set([...queryWords, ...cachedWords]);
  
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;
  console.log(`   Jaccard similarity: ${jaccardSimilarity.toFixed(3)}`);
  
  // Final threshold check
  const threshold = 0.7;
  const wouldUse = !isExpired && jaccardSimilarity >= threshold;
  console.log(`\n🎯 Final result: ${wouldUse ? '✅ Would use cache' : '❌ Would not use cache'}`);
  console.log(`   Reason: ${isExpired ? 'Cache expired' : 'Similarity below threshold'}`);
}

// Run the test
testCacheSimple();
