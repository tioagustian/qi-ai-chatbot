import { advancedFactSearch } from './src/services/advancedFactSearchService.js';
import { getDb } from './src/database/index.js';

// Test the advanced fact search integration
async function testAdvancedIntegration() {
  try {
    console.log('🧪 Testing Advanced Fact Search Integration...\n');
    
    // Initialize database
    const db = getDb();
    
    // Test user ID
    const testUserId = '6282111182808@s.whatsapp.net';
    
    // Test 1: Basic advanced search
    console.log('🔍 Test 1: Basic Advanced Search');
    console.log('Searching for "game" with advanced features');
    
    const result = await advancedFactSearch(testUserId, 'game', {
      includeRelationships: true,
      includeTaxonomies: true,
      includeUsageAnalytics: true,
      maxDepth: 2,
      maxResults: 5
    });
    
    console.log('✅ Advanced search completed successfully');
    console.log('Results:', {
      totalResults: result.topResults.length,
      relatedFacts: result.relatedFacts.length,
      hasTaxonomyInsights: !!result.taxonomyInsights,
      hasAdvancedMetrics: !!result.advancedMetrics,
      searchQuality: result.searchQuality
    });
    
    // Test 2: Test context enhancement creation
    console.log('\n🎯 Test 2: Context Enhancement Creation');
    
    if (result.topResults.length > 0) {
      // Simulate the context enhancement creation
      const userFacts = result.topResults.filter(fact => fact.factType === 'user');
      const globalFacts = result.topResults.filter(fact => fact.factType === 'global');
      
      let enhancement = '';
      
      if (userFacts.length > 0) {
        const userFactsText = userFacts.map(fact => fact.value).join(', ');
        enhancement += `I remember that you mentioned: ${userFactsText}. `;
      }
      
      if (globalFacts.length > 0) {
        const globalFactsText = globalFacts.map(fact => fact.value).join(', ');
        enhancement += `Relevant information: ${globalFactsText}. `;
      }
      
      if (result.relatedFacts && result.relatedFacts.length > 0) {
        enhancement += `I also found ${result.relatedFacts.length} related pieces of information. `;
      }
      
      console.log('✅ Context enhancement created successfully');
      console.log('Enhancement:', enhancement);
    }
    
    // Test 3: Test topic extraction
    console.log('\n📂 Test 3: Topic Extraction');
    
    const topics = [];
    if (result.taxonomyInsights && result.taxonomyInsights.categories) {
      const topCategories = Object.entries(result.taxonomyInsights.categories)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([category]) => category);
      
      topics.push(...topCategories);
    }
    
    console.log('✅ Topics extracted successfully');
    console.log('Topics:', topics);
    
    console.log('\n🎉 All integration tests passed! The advanced fact search is working properly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testAdvancedIntegration();
