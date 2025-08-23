import { getDb } from './src/database/index.js';
import { cleanupWebSearchCache } from './src/services/memoryService.js';

// Test cache cleanup functionality
async function testCacheCleanup() {
  console.log('🧪 Testing Cache Cleanup...\n');
  
  try {
    const db = getDb();
    
    if (!db.data.webSearchHistory) {
      console.log('❌ No webSearchHistory found in database');
      return;
    }
    
    const beforeCount = Object.keys(db.data.webSearchHistory).length;
    console.log(`📊 Cache entries before cleanup: ${beforeCount}`);
    
    // Show some sample entries
    const sampleEntries = Object.entries(db.data.webSearchHistory).slice(0, 3);
    sampleEntries.forEach(([id, data]) => {
      const ageInHours = Math.floor((Date.now() - new Date(data.timestamp).getTime()) / (1000 * 60 * 60));
      console.log(`   ${id}: "${data.query}" (age: ${ageInHours} hours)`);
    });
    
    // Run cleanup
    console.log('\n🧹 Running cache cleanup...');
    await cleanupWebSearchCache(48); // Clean entries older than 48 hours
    
    const afterCount = Object.keys(db.data.webSearchHistory).length;
    console.log(`📊 Cache entries after cleanup: ${afterCount}`);
    console.log(`🗑️  Removed ${beforeCount - afterCount} old entries`);
    
    if (afterCount > 0) {
      console.log('\n📋 Remaining entries:');
      Object.entries(db.data.webSearchHistory).forEach(([id, data]) => {
        const ageInHours = Math.floor((Date.now() - new Date(data.timestamp).getTime()) / (1000 * 60 * 60));
        console.log(`   ${id}: "${data.query}" (age: ${ageInHours} hours)`);
      });
    }
    
    console.log('\n✅ Cache cleanup test completed!');
    
  } catch (error) {
    console.error('❌ Error testing cache cleanup:', error);
  }
}

// Run the test
testCacheCleanup();
