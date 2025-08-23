import { getDb } from '../database/index.js';
import { searchFacts } from './factSearchService.js';
import chalk from 'chalk';

// Console logging helper
const logger = {
  info: (message, data) => {
    console.log(chalk.blue(`[ADVANCED FACT SEARCH] ${message}`), data || '');
  },
  success: (message, data) => {
    console.log(chalk.green(`[ADVANCED FACT SEARCH] ${message}`), data || '');
  },
  warning: (message, data) => {
    console.log(chalk.yellow(`[ADVANCED FACT SEARCH] ${message}`), data || '');
  },
  error: (message, data) => {
    console.log(chalk.red(`[ADVANCED FACT SEARCH] ${message}`), data || '');
  },
  debug: (message, data) => {
    console.log(chalk.gray(`[ADVANCED FACT SEARCH] ${message}`), data || '');
  }
};

/**
 * Advanced fact search with relationship and taxonomy awareness
 * @param {string} userId - User ID
 * @param {string} message - User message
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Advanced search results
 */
async function advancedFactSearch(userId, message, options = {}) {
  try {
    const {
      includeRelationships = true,
      includeTaxonomies = true,
      includeUsageAnalytics = true,
      maxDepth = 2,
      categoryFilter = null,
      typeFilter = null,
      domainFilter = null,
      minUsageCount = 0,
      ...searchOptions
    } = options;

    logger.info(`Advanced fact search for user ${userId.split('@')[0]}`);

    // Get base search results
    const baseResults = await searchFacts(userId, message, searchOptions);
    
    if (!baseResults.topResults || baseResults.topResults.length === 0) {
      return {
        ...baseResults,
        relatedFacts: [],
        taxonomyInsights: {},
        relationshipGraph: {},
        advancedMetrics: {}
      };
    }

    const enhancedResults = {
      ...baseResults,
      relatedFacts: [],
      taxonomyInsights: {},
      relationshipGraph: {},
      advancedMetrics: {}
    };

    // Enhance with relationships if enabled
    if (includeRelationships) {
      enhancedResults.relatedFacts = await findRelatedFacts(baseResults.topResults, userId, maxDepth);
      enhancedResults.relationshipGraph = await buildRelationshipGraph(baseResults.topResults, enhancedResults.relatedFacts);
    }

    // Enhance with taxonomy insights if enabled
    if (includeTaxonomies) {
      enhancedResults.taxonomyInsights = await analyzeTaxonomyDistribution(baseResults.topResults, enhancedResults.relatedFacts);
    }

    // Enhance with usage analytics if enabled
    if (includeUsageAnalytics) {
      enhancedResults.advancedMetrics = await calculateAdvancedMetrics(baseResults.topResults, enhancedResults.relatedFacts, userId);
    }

    // Apply filters
    if (categoryFilter || typeFilter || domainFilter || minUsageCount > 0) {
      enhancedResults.topResults = filterResults(enhancedResults.topResults, {
        categoryFilter,
        typeFilter,
        domainFilter,
        minUsageCount
      });
    }

    logger.success(`Advanced search completed with ${enhancedResults.relatedFacts.length} related facts`);

    return enhancedResults;

  } catch (error) {
    logger.error('Error in advanced fact search:', error);
    return {
      topResults: [],
      relatedFacts: [],
      taxonomyInsights: {},
      relationshipGraph: {},
      advancedMetrics: {},
      error: error.message
    };
  }
}

/**
 * Find facts related to the search results through relationships
 * @param {Array} baseFacts - Base search results
 * @param {string} userId - User ID
 * @param {number} maxDepth - Maximum relationship depth
 * @returns {Promise<Array>} - Related facts
 */
async function findRelatedFacts(baseFacts, userId, maxDepth = 2) {
  try {
    const db = getDb();
    const relatedFacts = new Map();
    const processedFacts = new Set();

    // Process each base fact
    for (const fact of baseFacts) {
      await traverseFactRelationships(fact.key, userId, relatedFacts, processedFacts, 0, maxDepth, db);
    }

    return Array.from(relatedFacts.values());

  } catch (error) {
    logger.error('Error finding related facts:', error);
    return [];
  }
}

/**
 * Recursively traverse fact relationships
 * @param {string} factKey - Current fact key
 * @param {string} userId - User ID
 * @param {Map} relatedFacts - Map to store related facts
 * @param {Set} processedFacts - Set of processed fact keys
 * @param {number} currentDepth - Current traversal depth
 * @param {number} maxDepth - Maximum allowed depth
 * @param {Object} db - Database instance
 */
async function traverseFactRelationships(factKey, userId, relatedFacts, processedFacts, currentDepth, maxDepth, db) {
  if (currentDepth >= maxDepth || processedFacts.has(factKey)) {
    return;
  }

  processedFacts.add(factKey);

  // Find relationships for this fact
  const relationships = findFactRelationships(factKey, userId, db);
  
  for (const relationship of relationships) {
    const relatedFactKey = relationship.fact1 === factKey ? relationship.fact2 : relationship.fact1;
    
    // Get the related fact
    const relatedFact = await getFactByKey(relatedFactKey, db);
    
    if (relatedFact) {
      const enhancedFact = {
        ...relatedFact,
        relationshipStrength: relationship.strength,
        relationshipType: relationship.relationshipType,
        relationshipDepth: currentDepth + 1,
        sourceFact: factKey
      };

      relatedFacts.set(relatedFactKey, enhancedFact);

      // Recursively traverse if not at max depth
      if (currentDepth + 1 < maxDepth) {
        await traverseFactRelationships(relatedFactKey, userId, relatedFacts, processedFacts, currentDepth + 1, maxDepth, db);
      }
    }
  }
}

/**
 * Find relationships for a specific fact
 * @param {string} factKey - Fact key
 * @param {string} userId - User ID
 * @returns {Array} - Relationships
 */
function findFactRelationships(factKey, userId, db) {
  const relationships = [];
  
  if (!db.data.factRelationships) {
    return relationships;
  }

  // Search for relationships involving this fact
  for (const [relationshipKey, relationship] of Object.entries(db.data.factRelationships)) {
    if ((relationship.fact1 === factKey || relationship.fact2 === factKey) && 
        relationship.userId === userId) {
      relationships.push(relationship);
    }
  }

  return relationships;
}

/**
 * Get fact by key from database
 * @param {string} factKey - Fact key
 * @param {Object} db - Database instance
 * @returns {Object|null} - Fact object or null
 */
async function getFactByKey(factKey, db) {
  // Search in user facts
  if (db.data.userFacts) {
    for (const [userId, userData] of Object.entries(db.data.userFacts)) {
      if (userData.facts && userData.facts[factKey]) {
        return {
          ...userData.facts[factKey],
          key: factKey,
          factType: 'user',
          userId
        };
      }
    }
  }

  // Search in global facts
  if (db.data.globalFacts && db.data.globalFacts.facts && db.data.globalFacts.facts[factKey]) {
    return {
      ...db.data.globalFacts.facts[factKey],
      key: factKey,
      factType: 'global'
    };
  }

  return null;
}

/**
 * Build relationship graph from facts
 * @param {Array} baseFacts - Base facts
 * @param {Array} relatedFacts - Related facts
 * @returns {Object} - Relationship graph
 */
async function buildRelationshipGraph(baseFacts, relatedFacts) {
  const graph = {
    nodes: [],
    edges: [],
    clusters: {}
  };

  // Add base facts as nodes
  baseFacts.forEach((fact, index) => {
    graph.nodes.push({
      id: fact.key,
      label: fact.key,
      type: 'base',
      category: fact.category,
      confidence: fact.confidence,
      relevanceScore: fact.relevanceScore
    });
  });

  // Add related facts as nodes
  relatedFacts.forEach(fact => {
    graph.nodes.push({
      id: fact.key,
      label: fact.key,
      type: 'related',
      category: fact.category,
      confidence: fact.confidence,
      relationshipStrength: fact.relationshipStrength,
      relationshipType: fact.relationshipType,
      relationshipDepth: fact.relationshipDepth
    });

    // Add edge from source fact
    if (fact.sourceFact) {
      graph.edges.push({
        from: fact.sourceFact,
        to: fact.key,
        strength: fact.relationshipStrength,
        type: fact.relationshipType
      });
    }
  });

  // Group by categories
  graph.nodes.forEach(node => {
    if (!graph.clusters[node.category]) {
      graph.clusters[node.category] = [];
    }
    graph.clusters[node.category].push(node.id);
  });

  return graph;
}

/**
 * Analyze taxonomy distribution of facts
 * @param {Array} baseFacts - Base facts
 * @param {Array} relatedFacts - Related facts
 * @returns {Object} - Taxonomy insights
 */
async function analyzeTaxonomyDistribution(baseFacts, relatedFacts) {
  const allFacts = [...baseFacts, ...relatedFacts];
  const insights = {
    categories: {},
    types: {},
    domains: {},
    confidenceDistribution: {},
    temporalDistribution: {}
  };

  allFacts.forEach(fact => {
    // Category distribution
    if (fact.category) {
      insights.categories[fact.category] = (insights.categories[fact.category] || 0) + 1;
    }

    // Type distribution
    if (fact.factType) {
      insights.types[fact.factType] = (insights.types[fact.factType] || 0) + 1;
    }

    // Domain distribution
    if (fact.domain) {
      insights.domains[fact.domain] = (insights.domains[fact.domain] || 0) + 1;
    }

    // Confidence distribution
    if (fact.confidence) {
      const confidenceRange = Math.floor(fact.confidence * 10) / 10;
      insights.confidenceDistribution[confidenceRange] = (insights.confidenceDistribution[confidenceRange] || 0) + 1;
    }

    // Temporal distribution
    if (fact.lastUpdated) {
      const date = new Date(fact.lastUpdated);
      const month = date.toISOString().substring(0, 7); // YYYY-MM
      insights.temporalDistribution[month] = (insights.temporalDistribution[month] || 0) + 1;
    }
  });

  return insights;
}

/**
 * Calculate advanced metrics for facts
 * @param {Array} baseFacts - Base facts
 * @param {Array} relatedFacts - Related facts
 * @param {string} userId - User ID
 * @returns {Object} - Advanced metrics
 */
async function calculateAdvancedMetrics(baseFacts, relatedFacts, userId) {
  const allFacts = [...baseFacts, ...relatedFacts];
  const metrics = {
    averageConfidence: 0,
    averageUsageCount: 0,
    totalUsageCount: 0,
    userSpecificFacts: 0,
    globalFacts: 0,
    recentFacts: 0,
    highConfidenceFacts: 0,
    popularFacts: 0,
    relationshipDensity: 0
  };

  if (allFacts.length === 0) {
    return metrics;
  }

  // Calculate averages and counts
  const confidences = allFacts.map(f => f.confidence || 0).filter(c => c > 0);
  const usageCounts = allFacts.map(f => f.usageCount || 0).filter(u => u > 0);

  metrics.averageConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  metrics.averageUsageCount = usageCounts.length > 0 ? usageCounts.reduce((a, b) => a + b, 0) / usageCounts.length : 0;
  metrics.totalUsageCount = usageCounts.reduce((a, b) => a + b, 0);

  // Count fact types
  allFacts.forEach(fact => {
    if (fact.factType === 'user') {
      metrics.userSpecificFacts++;
    } else if (fact.factType === 'global') {
      metrics.globalFacts++;
    }

    if (fact.confidence && fact.confidence > 0.8) {
      metrics.highConfidenceFacts++;
    }

    if (fact.usageCount && fact.usageCount > 5) {
      metrics.popularFacts++;
    }

    if (fact.lastUpdated) {
      const daysSinceUpdate = (Date.now() - new Date(fact.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 7) {
        metrics.recentFacts++;
      }
    }
  });

  // Calculate relationship density
  const factsWithRelationships = allFacts.filter(f => f.relationshipStrength || f.relationshipType);
  metrics.relationshipDensity = allFacts.length > 0 ? factsWithRelationships.length / allFacts.length : 0;

  return metrics;
}

/**
 * Filter results based on criteria
 * @param {Array} facts - Facts to filter
 * @param {Object} filters - Filter criteria
 * @returns {Array} - Filtered facts
 */
function filterResults(facts, filters) {
  const { categoryFilter, typeFilter, domainFilter, minUsageCount } = filters;

  return facts.filter(fact => {
    // Category filter
    if (categoryFilter && fact.category !== categoryFilter) {
      return false;
    }

    // Type filter
    if (typeFilter && fact.factType !== typeFilter) {
      return false;
    }

    // Domain filter
    if (domainFilter && fact.domain !== domainFilter) {
      return false;
    }

    // Usage count filter
    if (minUsageCount > 0 && (!fact.usageCount || fact.usageCount < minUsageCount)) {
      return false;
    }

    return true;
  });
}

/**
 * Search facts by taxonomy
 * @param {string} userId - User ID
 * @param {Object} taxonomyCriteria - Taxonomy search criteria
 * @returns {Promise<Array>} - Facts matching taxonomy criteria
 */
async function searchByTaxonomy(userId, taxonomyCriteria) {
  try {
    const db = getDb();
    const results = [];

    const { category, factType, domain, minConfidence, maxAge } = taxonomyCriteria;

    // Search user facts
    if (db.data.userFacts && db.data.userFacts[userId] && db.data.userFacts[userId].facts) {
      for (const [key, fact] of Object.entries(db.data.userFacts[userId].facts)) {
        if (matchesTaxonomyCriteria(fact, taxonomyCriteria)) {
          results.push({
            ...fact,
            key,
            factType: 'user',
            userId
          });
        }
      }
    }

    // Search global facts
    if (db.data.globalFacts && db.data.globalFacts.facts) {
      for (const [key, fact] of Object.entries(db.data.globalFacts.facts)) {
        if (matchesTaxonomyCriteria(fact, taxonomyCriteria)) {
          results.push({
            ...fact,
            key,
            factType: 'global'
          });
        }
      }
    }

    return results;

  } catch (error) {
    logger.error('Error in taxonomy search:', error);
    return [];
  }
}

/**
 * Check if fact matches taxonomy criteria
 * @param {Object} fact - Fact object
 * @param {Object} criteria - Taxonomy criteria
 * @returns {boolean} - Whether fact matches criteria
 */
function matchesTaxonomyCriteria(fact, criteria) {
  const { category, factType, domain, minConfidence, maxAge } = criteria;

  if (category && fact.category !== category) {
    return false;
  }

  if (factType && fact.factType !== factType) {
    return false;
  }

  if (domain && fact.domain !== domain) {
    return false;
  }

  if (minConfidence && (!fact.confidence || fact.confidence < minConfidence)) {
    return false;
  }

  if (maxAge && fact.lastUpdated) {
    const ageInDays = (Date.now() - new Date(fact.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays > maxAge) {
      return false;
    }
  }

  return true;
}

/**
 * Get fact insights and analytics
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Fact insights
 */
async function getFactInsights(userId) {
  try {
    const db = getDb();
    const insights = {
      totalFacts: 0,
      userFacts: 0,
      globalFacts: 0,
      categories: {},
      types: {},
      domains: {},
      usageStats: {},
      relationshipStats: {},
      recentActivity: {}
    };

    // Count user facts
    if (db.data.userFacts && db.data.userFacts[userId] && db.data.userFacts[userId].facts) {
      const userFacts = db.data.userFacts[userId].facts;
      insights.userFacts = Object.keys(userFacts).length;
      
      Object.values(userFacts).forEach(fact => {
        updateInsightsFromFact(fact, insights, 'user');
      });
    }

    // Count global facts
    if (db.data.globalFacts && db.data.globalFacts.facts) {
      const globalFacts = db.data.globalFacts.facts;
      insights.globalFacts = Object.keys(globalFacts).length;
      
      Object.values(globalFacts).forEach(fact => {
        updateInsightsFromFact(fact, insights, 'global');
      });
    }

    insights.totalFacts = insights.userFacts + insights.globalFacts;

    // Add relationship statistics
    if (db.data.factRelationships) {
      insights.relationshipStats = {
        totalRelationships: Object.keys(db.data.factRelationships).length,
        userRelationships: Object.values(db.data.factRelationships).filter(r => r.userId === userId).length,
        relationshipTypes: {}
      };

      Object.values(db.data.factRelationships).forEach(relationship => {
        if (relationship.userId === userId) {
          insights.relationshipStats.relationshipTypes[relationship.relationshipType] = 
            (insights.relationshipStats.relationshipTypes[relationship.relationshipType] || 0) + 1;
        }
      });
    }

    return insights;

  } catch (error) {
    logger.error('Error getting fact insights:', error);
    return {
      totalFacts: 0,
      userFacts: 0,
      globalFacts: 0,
      error: error.message
    };
  }
}

/**
 * Update insights from a fact
 * @param {Object} fact - Fact object
 * @param {Object} insights - Insights object to update
 * @param {string} source - Source type ('user' or 'global')
 */
function updateInsightsFromFact(fact, insights, source) {
  // Category distribution
  if (fact.category) {
    if (!insights.categories[fact.category]) {
      insights.categories[fact.category] = { user: 0, global: 0 };
    }
    insights.categories[fact.category][source]++;
  }

  // Type distribution
  if (fact.factType) {
    if (!insights.types[fact.factType]) {
      insights.types[fact.factType] = { user: 0, global: 0 };
    }
    insights.types[fact.factType][source]++;
  }

  // Domain distribution
  if (fact.domain) {
    if (!insights.domains[fact.domain]) {
      insights.domains[fact.domain] = { user: 0, global: 0 };
    }
    insights.domains[fact.domain][source]++;
  }

  // Usage statistics
  if (fact.usageCount) {
    if (!insights.usageStats[source]) {
      insights.usageStats[source] = { total: 0, average: 0, count: 0 };
    }
    insights.usageStats[source].total += fact.usageCount;
    insights.usageStats[source].count++;
  }

  // Recent activity
  if (fact.lastUpdated) {
    const date = new Date(fact.lastUpdated);
    const month = date.toISOString().substring(0, 7);
    if (!insights.recentActivity[month]) {
      insights.recentActivity[month] = { user: 0, global: 0 };
    }
    insights.recentActivity[month][source]++;
  }
}

// Export all functions
export {
  advancedFactSearch,
  findRelatedFacts,
  buildRelationshipGraph,
  analyzeTaxonomyDistribution,
  calculateAdvancedMetrics,
  searchByTaxonomy,
  getFactInsights
};
