import { getDb } from './src/database/index.js';

// Test cache expiry logic
function testCacheExpiry() {
  console.log('🧪 Testing Cache Expiry Logic...\n');
  
  try {
    const db = getDb();
    
    if (!db.data.webSearchHistory) {
      console.log('❌ No webSearchHistory found in database');
      return;
    }
    
    console.log(`📊 Found ${Object.keys(db.data.webSearchHistory).length} cached searches\n`);
    
    // Test the cache expiry logic
    const testQuery = 'harga emas terbaru hari ini';
    const maxAgeMinutes = 120; // 2 hours
    const maxAgeHours = maxAgeMinutes / 60;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const oldestAllowed = Date.now() - maxAgeMs;
    
    console.log(`🔍 Testing query: "${testQuery}"`);
    console.log(`⏰ Max age: ${maxAgeMinutes} minutes (${maxAgeHours} hours)`);
    console.log(`📅 Oldest allowed: ${new Date(oldestAllowed).toISOString()}`);
    console.log(`🕐 Current time: ${new Date().toISOString()}\n`);
    
    // Check each cached search
    Object.entries(db.data.webSearchHistory).forEach(([searchId, searchData]) => {
      const searchTime = new Date(searchData.timestamp).getTime();
      const isExpired = searchTime < oldestAllowed;
      const ageInMinutes = Math.floor((Date.now() - searchTime) / (1000 * 60));
      
      console.log(`🔍 Search ID: ${searchId}`);
      console.log(`   Query: "${searchData.query}"`);
      console.log(`   Timestamp: ${searchData.timestamp}`);
      console.log(`   Age: ${ageInMinutes} minutes`);
      console.log(`   Expired: ${isExpired ? '❌ YES' : '✅ NO'}`);
      
      // Check similarity
      const normalizedQuery = testQuery.toLowerCase().trim();
      const cachedQuery = searchData.query.toLowerCase().trim();
      
      if (cachedQuery === normalizedQuery) {
        console.log(`   Match: ✅ EXACT MATCH`);
        if (!isExpired) {
          console.log(`   Result: ✅ Would use this cache entry`);
        } else {
          console.log(`   Result: ❌ Would skip (expired)`);
        }
      } else {
        console.log(`   Match: ❌ No match`);
      }
      console.log('');
    });
    
    // Test the actual getCachedWebSearch function
    console.log('🔧 Testing getCachedWebSearch function...');
    
    // Import the function
    import('./src/services/memoryService.js').then(({ getCachedWebSearch }) => {
      const result = getCachedWebSearch(testQuery, {
        maxAgeHours: maxAgeHours,
        exactMatchOnly: false
      });
      
      if (result) {
        console.log('✅ getCachedWebSearch returned a result');
        console.log(`   Query: "${result.query}"`);
        console.log(`   Timestamp: ${result.timestamp}`);
        console.log(`   Has AI Summary: ${!!result.aiSummary}`);
        console.log(`   Enhanced Search: ${!!result.enhancedSearch}`);
      } else {
        console.log('❌ getCachedWebSearch returned null');
      }
    });
    
  } catch (error) {
    console.error('❌ Error testing cache:', error);
  }
}

// Run the test
testCacheExpiry();
