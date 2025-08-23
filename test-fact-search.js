import { searchFacts, getFactStatistics, getFactSuggestions } from './src/services/factSearchService.js';
import { getDb } from './src/database/index.js';

// Test fact search functionality
async function testFactSearch() {
  try {
    console.log('🧪 Testing Fact Search Functionality...\n');
    
    // Initialize database
    const db = getDb();
    
    // Test user ID
    const testUserId = '6282111182808@s.whatsapp.net';
    
    // Test 1: Basic fact search
    console.log('📝 Test 1: Basic Fact Search');
    console.log('Searching for facts related to "nama"');
    
    const searchResult = await searchFacts(testUserId, 'nama', {
      includeGlobalFacts: true,
      includeUserFacts: true,
      includeOtherUsers: false,
      maxResults: 5,
      minRelevance: 0.2,
      useSemanticSearch: true
    });
    
    console.log('Search Results:', {
      totalResults: searchResult.totalResults,
      searchQuality: searchResult.searchQuality,
      userFacts: searchResult.userFacts.length,
      globalFacts: searchResult.globalFacts.length,
      topResults: searchResult.topResults.map(f => ({
        key: f.key,
        value: f.value.substring(0, 50) + '...',
        relevanceScore: f.relevanceScore,
        source: f.source
      }))
    });
    
    // Test 2: Fact statistics
    console.log('\n📊 Test 2: Fact Statistics');
    const stats = getFactStatistics(testUserId);
    console.log('Fact Statistics:', stats);
    
    // Test 3: Fact suggestions
    console.log('\n💡 Test 3: Fact Suggestions');
    console.log('Getting suggestions for "nam"');
    const suggestions = await getFactSuggestions(testUserId, 'nam');
    console.log('Suggestions:', suggestions.map(s => ({
      type: s.type,
      key: s.key,
      value: s.value.substring(0, 50) + '...',
      confidence: s.confidence
    })));
    
    // Test 4: Semantic search with complex query
    console.log('\n🔍 Test 4: Semantic Search with Complex Query');
    console.log('Searching for facts related to "saya suka makan"');
    
    const semanticResult = await searchFacts(testUserId, 'saya suka makan', {
      includeGlobalFacts: true,
      includeUserFacts: true,
      includeOtherUsers: false,
      maxResults: 3,
      minRelevance: 0.3,
      useSemanticSearch: true
    });
    
    console.log('Semantic Search Results:', {
      totalResults: semanticResult.totalResults,
      searchQuality: semanticResult.searchQuality,
      topResults: semanticResult.topResults.map(f => ({
        key: f.key,
        value: f.value.substring(0, 50) + '...',
        relevanceScore: f.relevanceScore,
        reasoning: f.reasoning || 'No reasoning provided'
      }))
    });
    
    // Test 5: Global facts search
    console.log('\n🌍 Test 5: Global Facts Search');
    console.log('Searching for global facts related to "indonesia"');
    
    const globalResult = await searchFacts(testUserId, 'indonesia', {
      includeGlobalFacts: true,
      includeUserFacts: false,
      includeOtherUsers: false,
      maxResults: 3,
      minRelevance: 0.2,
      useSemanticSearch: true
    });
    
    console.log('Global Facts Search Results:', {
      totalResults: globalResult.totalResults,
      globalFacts: globalResult.globalFacts.length,
      topResults: globalResult.topResults.map(f => ({
        key: f.key,
        value: f.value.substring(0, 50) + '...',
        relevanceScore: f.relevanceScore,
        source: f.source
      }))
    });
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testFactSearch();
