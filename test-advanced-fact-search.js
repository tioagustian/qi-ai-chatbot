import { advancedFactSearch, searchByTaxonomy, getFactInsights } from './src/services/advancedFactSearchService.js';
import { getDb } from './src/database/index.js';

// Test advanced fact search functionality
async function testAdvancedFactSearch() {
  try {
    console.log('🚀 Testing Advanced Fact Search Features...\n');
    
    // Initialize database
    const db = getDb();
    
    // Test user ID
    const testUserId = '6282111182808@s.whatsapp.net';
    
    // Test 1: Advanced fact search with relationships
    console.log('🔍 Test 1: Advanced Fact Search with Relationships');
    console.log('Searching for "game horror" with relationship analysis');
    
    const advancedResult = await advancedFactSearch(testUserId, 'game horror', {
      includeRelationships: true,
      includeTaxonomies: true,
      includeUsageAnalytics: true,
      maxDepth: 2,
      maxResults: 5
    });
    
    console.log('Advanced Search Results:', {
      totalResults: advancedResult.topResults.length,
      relatedFacts: advancedResult.relatedFacts.length,
      hasRelationshipGraph: !!advancedResult.relationshipGraph,
      hasTaxonomyInsights: !!advancedResult.taxonomyInsights,
      hasAdvancedMetrics: !!advancedResult.advancedMetrics,
      metrics: advancedResult.advancedMetrics || {}
    });
    
    if (advancedResult.relationshipGraph) {
      console.log('Relationship Graph:', {
        nodes: advancedResult.relationshipGraph.nodes.length,
        edges: advancedResult.relationshipGraph.edges.length,
        clusters: Object.keys(advancedResult.relationshipGraph.clusters).length
      });
    }
    
    if (advancedResult.taxonomyInsights) {
      console.log('Taxonomy Insights:', {
        categories: Object.keys(advancedResult.taxonomyInsights.categories).length,
        types: Object.keys(advancedResult.taxonomyInsights.types).length,
        domains: Object.keys(advancedResult.taxonomyInsights.domains).length
      });
    }
    
    // Test 2: Taxonomy-based search
    console.log('\n📂 Test 2: Taxonomy-Based Search');
    console.log('Searching for facts in "web_search" category');
    
    const taxonomyResults = await searchByTaxonomy(testUserId, {
      category: 'web_search',
      minConfidence: 0.5,
      maxAge: 30 // Last 30 days
    });
    
    console.log('Taxonomy Search Results:', {
      totalResults: taxonomyResults.length,
      results: taxonomyResults.slice(0, 3).map(fact => ({
        key: fact.key,
        category: fact.category,
        confidence: fact.confidence,
        factType: fact.factType
      }))
    });
    
    // Test 3: Fact insights and analytics
    console.log('\n📊 Test 3: Fact Insights and Analytics');
    
    const insights = await getFactInsights(testUserId);
    
    console.log('Fact Insights:', {
      totalFacts: insights.totalFacts,
      userFacts: insights.userFacts,
      globalFacts: insights.globalFacts,
      hasRelationshipStats: !!insights.relationshipStats,
      hasCategories: !!insights.categories,
      hasUsageStats: !!insights.usageStats
    });
    
    if (insights.relationshipStats) {
      console.log('Relationship Statistics:', {
        totalRelationships: insights.relationshipStats.totalRelationships,
        userRelationships: insights.relationshipStats.userRelationships,
        relationshipTypes: insights.relationshipStats.relationshipTypes
      });
    }
    
    if (insights.categories) {
      console.log('Category Distribution:', Object.entries(insights.categories)
        .slice(0, 5)
        .map(([category, counts]) => `${category}: ${counts.user + counts.global} facts`)
      );
    }
    
    // Test 4: Advanced search with filters
    console.log('\n🎯 Test 4: Advanced Search with Filters');
    console.log('Searching for high-confidence facts with usage count > 5');
    
    const filteredResult = await advancedFactSearch(testUserId, 'game', {
      includeRelationships: true,
      includeTaxonomies: true,
      includeUsageAnalytics: true,
      minUsageCount: 5,
      categoryFilter: 'web_search',
      maxResults: 3
    });
    
    console.log('Filtered Search Results:', {
      totalResults: filteredResult.topResults.length,
      relatedFacts: filteredResult.relatedFacts.length,
      metrics: filteredResult.advancedMetrics || {}
    });
    
    // Test 5: Relationship analysis
    console.log('\n🔗 Test 5: Relationship Analysis');
    
    if (advancedResult.relatedFacts && advancedResult.relatedFacts.length > 0) {
      console.log('Related Facts Analysis:');
      advancedResult.relatedFacts.slice(0, 3).forEach((fact, index) => {
        console.log(`${index + 1}. ${fact.key}:`);
        console.log(`   - Relationship Type: ${fact.relationshipType}`);
        console.log(`   - Relationship Strength: ${(fact.relationshipStrength * 100).toFixed(1)}%`);
        console.log(`   - Relationship Depth: ${fact.relationshipDepth}`);
        console.log(`   - Source Fact: ${fact.sourceFact}`);
      });
    }
    
    // Test 6: Taxonomy distribution analysis
    console.log('\n📈 Test 6: Taxonomy Distribution Analysis');
    
    if (advancedResult.taxonomyInsights) {
      const insights = advancedResult.taxonomyInsights;
      
      console.log('Category Distribution:', insights.categories);
      console.log('Type Distribution:', insights.types);
      console.log('Confidence Distribution:', insights.confidenceDistribution);
      
      if (insights.temporalDistribution) {
        console.log('Temporal Distribution (last 3 months):', 
          Object.entries(insights.temporalDistribution)
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 3)
        );
      }
    }
    
    console.log('\n✅ All advanced fact search tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testAdvancedFactSearch();
