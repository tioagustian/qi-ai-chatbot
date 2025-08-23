import { getDb } from '../database/index.js';
import { requestGeminiChat } from './aiService.js';
import chalk from 'chalk';

// Constants for fact search
const SEARCH_MODEL = 'gemini-2.0-flash';
const MAX_SEARCH_RESULTS = 10;
const MIN_RELEVANCE_SCORE = 0.3;
const SEMANTIC_SEARCH_ENABLED = true;

// Console logging helper
const logger = {
  info: (message, data) => {
    console.log(chalk.blue(`[FACT SEARCH] ${message}`), data || '');
  },
  success: (message, data) => {
    console.log(chalk.green(`[FACT SEARCH] ${message}`), data || '');
  },
  warning: (message, data) => {
    console.log(chalk.yellow(`[FACT SEARCH] ${message}`), data || '');
  },
  error: (message, data) => {
    console.log(chalk.red(`[FACT SEARCH] ${message}`), data || '');
  },
  debug: (message, data) => {
    console.log(chalk.gray(`[FACT SEARCH] ${message}`), data || '');
  }
};

/**
 * Search for facts in the database based on user message
 * @param {string} userId - User ID
 * @param {string} message - User message to search for facts
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Search results with relevant facts
 */
async function searchFacts(userId, message, options = {}) {
  try {
    const db = getDb();
    const {
      includeGlobalFacts = true,
      includeUserFacts = true,
      includeOtherUsers = false,
      maxResults = MAX_SEARCH_RESULTS,
      minRelevance = MIN_RELEVANCE_SCORE,
      useSemanticSearch = SEMANTIC_SEARCH_ENABLED
    } = options;

    logger.info(`Searching facts for user ${userId.split('@')[0]} with message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

    const results = {
      userFacts: [],
      globalFacts: [],
      otherUserFacts: [],
      searchQuery: message,
      searchMethod: useSemanticSearch ? 'semantic' : 'keyword',
      timestamp: new Date().toISOString()
    };

    // Extract keywords from the message
    const keywords = extractKeywords(message);
    logger.debug('Extracted keywords:', keywords);

    // Search user facts
    if (includeUserFacts) {
      results.userFacts = await searchUserFacts(userId, message, keywords, {
        maxResults: Math.floor(maxResults * 0.6), // 60% of results for user facts
        minRelevance,
        useSemanticSearch
      });
    }

    // Search global facts
    if (includeGlobalFacts) {
      results.globalFacts = await searchGlobalFacts(message, keywords, {
        maxResults: Math.floor(maxResults * 0.3), // 30% of results for global facts
        minRelevance,
        useSemanticSearch
      });
    }

    // Search other users' facts (for group chats)
    if (includeOtherUsers) {
      results.otherUserFacts = await searchOtherUserFacts(userId, message, keywords, {
        maxResults: Math.floor(maxResults * 0.1), // 10% of results for other users
        minRelevance,
        useSemanticSearch
      });
    }

    // Calculate total relevance scores and sort
    const allResults = [
      ...results.userFacts.map(fact => ({ ...fact, source: 'user' })),
      ...results.globalFacts.map(fact => ({ ...fact, source: 'global' })),
      ...results.otherUserFacts.map(fact => ({ ...fact, source: 'other_user' }))
    ];

    // Sort by relevance score
    allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Take top results
    const topResults = allResults.slice(0, maxResults);

    // Update usage metrics for retrieved facts
    await updateFactUsageMetrics(topResults, userId);

    logger.success(`Found ${topResults.length} relevant facts (${results.userFacts.length} user, ${results.globalFacts.length} global, ${results.otherUserFacts.length} other users)`);

    return {
      ...results,
      topResults,
      totalResults: allResults.length,
      searchQuality: calculateSearchQuality(topResults, message)
    };

  } catch (error) {
    logger.error('Error searching facts:', error);
    return {
      userFacts: [],
      globalFacts: [],
      otherUserFacts: [],
      topResults: [],
      error: error.message,
      searchQuery: message
    };
  }
}

/**
 * Search user facts using both semantic and keyword matching
 * @param {string} userId - User ID
 * @param {string} message - Search message
 * @param {Array} keywords - Extracted keywords
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Relevant user facts
 */
async function searchUserFacts(userId, message, keywords, options = {}) {
  const db = getDb();
  const { maxResults, minRelevance, useSemanticSearch } = options;

  if (!db.data.userFacts || !db.data.userFacts[userId] || !db.data.userFacts[userId].facts) {
    return [];
  }

  const userFacts = db.data.userFacts[userId].facts;
  const results = [];

  // Keyword-based search
  const keywordResults = searchFactsByKeywords(userFacts, keywords, 'user');
  
  // Semantic search if enabled
  let semanticResults = [];
  if (useSemanticSearch && keywords.length > 0) {
    semanticResults = await searchFactsSemantically(userFacts, message, 'user');
  }

  // Combine and deduplicate results
  const combinedResults = combineSearchResults(keywordResults, semanticResults);
  
  // Filter by relevance and limit results
  return combinedResults
    .filter(fact => fact.relevanceScore >= minRelevance)
    .slice(0, maxResults);
}

/**
 * Search global facts
 * @param {string} message - Search message
 * @param {Array} keywords - Extracted keywords
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Relevant global facts
 */
async function searchGlobalFacts(message, keywords, options = {}) {
  const db = getDb();
  const { maxResults, minRelevance, useSemanticSearch } = options;

  if (!db.data.globalFacts || !db.data.globalFacts.facts) {
    return [];
  }

  const globalFacts = db.data.globalFacts.facts;
  const results = [];

  // Keyword-based search
  const keywordResults = searchFactsByKeywords(globalFacts, keywords, 'global');
  
  // Semantic search if enabled
  let semanticResults = [];
  if (useSemanticSearch && keywords.length > 0) {
    semanticResults = await searchFactsSemantically(globalFacts, message, 'global');
  }

  // Combine and deduplicate results
  const combinedResults = combineSearchResults(keywordResults, semanticResults);
  
  // Filter by relevance and limit results
  return combinedResults
    .filter(fact => fact.relevanceScore >= minRelevance)
    .slice(0, maxResults);
}

/**
 * Search other users' facts
 * @param {string} currentUserId - Current user ID
 * @param {string} message - Search message
 * @param {Array} keywords - Extracted keywords
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Relevant facts from other users
 */
async function searchOtherUserFacts(currentUserId, message, keywords, options = {}) {
  const db = getDb();
  const { maxResults, minRelevance, useSemanticSearch } = options;

  if (!db.data.userFacts) {
    return [];
  }

  const results = [];

  // Search through all other users' facts
  for (const [userId, userData] of Object.entries(db.data.userFacts)) {
    if (userId === currentUserId || !userData.facts) continue;

    const userFacts = userData.facts;
    
    // Keyword-based search
    const keywordResults = searchFactsByKeywords(userFacts, keywords, 'other_user', userId);
    
    // Semantic search if enabled
    let semanticResults = [];
    if (useSemanticSearch && keywords.length > 0) {
      semanticResults = await searchFactsSemantically(userFacts, message, 'other_user', userId);
    }

    // Combine results for this user
    const userResults = combineSearchResults(keywordResults, semanticResults);
    results.push(...userResults);
  }

  // Filter by relevance and limit results
  return results
    .filter(fact => fact.relevanceScore >= minRelevance)
    .slice(0, maxResults);
}

/**
 * Extract keywords from a message
 * @param {string} message - Input message
 * @returns {Array} - Extracted keywords
 */
function extractKeywords(message) {
  if (!message || typeof message !== 'string') {
    return [];
  }

  // Remove common words and punctuation
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
    'what', 'when', 'where', 'why', 'how', 'who', 'which', 'whom', 'whose'
  ]);

  // Extract words, filter out stop words and short words
  const words = message.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  // Remove duplicates and return
  return [...new Set(words)];
}

/**
 * Search facts using keyword matching
 * @param {Object} facts - Facts object to search
 * @param {Array} keywords - Keywords to search for
 * @param {string} factType - Type of facts ('user', 'global', 'other_user')
 * @param {string} userId - User ID (for other_user facts)
 * @returns {Array} - Matching facts with relevance scores
 */
function searchFactsByKeywords(facts, keywords, factType, userId = null) {
  const results = [];

  for (const [key, fact] of Object.entries(facts)) {
    let relevanceScore = 0;
    let matchCount = 0;

    // Check key matches
    const keyWords = key.toLowerCase().split(/[_\s]+/);
    for (const keyword of keywords) {
      if (keyWords.some(word => word.includes(keyword) || keyword.includes(word))) {
        relevanceScore += 0.4; // Key matches are important
        matchCount++;
      }
    }

    // Check value matches
    const valueWords = fact.value.toLowerCase().split(/\s+/);
    for (const keyword of keywords) {
      if (valueWords.some(word => word.includes(keyword) || keyword.includes(word))) {
        relevanceScore += 0.3; // Value matches are also important
        matchCount++;
      }
    }

    // Check category matches
    if (fact.category) {
      const categoryWords = fact.category.toLowerCase().split(/[_\s]+/);
      for (const keyword of keywords) {
        if (categoryWords.some(word => word.includes(keyword) || keyword.includes(word))) {
          relevanceScore += 0.2;
          matchCount++;
        }
      }
    }

    // Check tag matches
    if (fact.tags && Array.isArray(fact.tags)) {
      for (const tag of fact.tags) {
        const tagWords = tag.toLowerCase().split(/[_\s]+/);
        for (const keyword of keywords) {
          if (tagWords.some(word => word.includes(keyword) || keyword.includes(word))) {
            relevanceScore += 0.1;
            matchCount++;
          }
        }
      }
    }

    // Boost score based on confidence and recency
    if (fact.confidence) {
      relevanceScore += fact.confidence * 0.1;
    }

    if (fact.lastUpdated) {
      const daysSinceUpdate = (Date.now() - new Date(fact.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 7) {
        relevanceScore += 0.1; // Recent facts get a small boost
      }
    }

    // Normalize score based on number of keywords
    if (keywords.length > 0) {
      relevanceScore = relevanceScore / keywords.length;
    }

    // Only include facts with some relevance
    if (relevanceScore > 0) {
      results.push({
        key,
        value: fact.value,
        category: fact.category,
        confidence: fact.confidence,
        relevanceScore,
        matchCount,
        factType,
        userId,
        tags: fact.tags || [],
        lastUpdated: fact.lastUpdated,
        source: fact.source || 'unknown'
      });
    }
  }

  return results;
}

/**
 * Search facts using semantic similarity via AI
 * @param {Object} facts - Facts object to search
 * @param {string} message - Search message
 * @param {string} factType - Type of facts
 * @param {string} userId - User ID (for other_user facts)
 * @returns {Promise<Array>} - Semantically relevant facts
 */
async function searchFactsSemantically(facts, message, factType, userId = null) {
  try {
    const db = getDb();
    const apiKey = db.data.config.geminiApiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      logger.warning('No Gemini API key available for semantic search');
      return [];
    }

    // Prepare facts for semantic search
    const factsList = Object.entries(facts).map(([key, fact]) => ({
      key,
      value: fact.value,
      category: fact.category,
      tags: fact.tags || []
    }));

    if (factsList.length === 0) {
      return [];
    }

    // Create semantic search prompt
    const prompt = createSemanticSearchPrompt(message, factsList, factType);

    // Call Gemini API for semantic search
    const response = await requestGeminiChat(
      SEARCH_MODEL,
      apiKey,
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 1024
      }
    );

    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      return [];
    }

    const result = parseSemanticSearchResponse(response.choices[0].message.content, facts);
    
    // Add metadata
    return result.map(fact => ({
      ...fact,
      factType,
      userId,
      searchMethod: 'semantic'
    }));

  } catch (error) {
    logger.error('Error in semantic search:', error);
    return [];
  }
}

/**
 * Create prompt for semantic fact search
 * @param {string} message - Search message
 * @param {Array} factsList - List of facts to search
 * @param {string} factType - Type of facts
 * @returns {string} - Search prompt
 */
function createSemanticSearchPrompt(message, factsList, factType) {
  const factsJson = JSON.stringify(factsList, null, 2);
  
  return `You are a fact search assistant. Given a user message and a list of facts, find the most semantically relevant facts.

USER MESSAGE: "${message}"

AVAILABLE FACTS (${factType} facts):
${factsJson}

TASK: Analyze the user message and find facts that are semantically related to the message content, even if they don't contain exact keywords.

SEARCH CRITERIA:
1. Direct relevance: Facts that directly answer or relate to the user's question/topic
2. Contextual relevance: Facts that provide useful context for the user's message
3. Thematic relevance: Facts that share themes or concepts with the user's message
4. Implicit relevance: Facts that might be useful based on the conversation context

RESPONSE FORMAT:
Return a JSON array of relevant facts with relevance scores (0.0-1.0):

[
  {
    "key": "fact_key",
    "relevanceScore": 0.85,
    "reasoning": "Brief explanation of why this fact is relevant"
  }
]

IMPORTANT:
- Only include facts with relevance score >= 0.3
- Provide clear reasoning for each selected fact
- Focus on semantic similarity, not just keyword matching
- Consider the broader context and implications of the user's message
- Limit results to the 5-10 most relevant facts

Analyze the message carefully and select facts that would be most helpful for understanding or responding to the user's message.`;
}

/**
 * Parse semantic search response
 * @param {string} response - AI response
 * @param {Object} originalFacts - Original facts object
 * @returns {Array} - Parsed search results
 */
function parseSemanticSearchResponse(response, originalFacts) {
  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const results = JSON.parse(jsonMatch[0]);
    const parsedResults = [];

    for (const result of results) {
      if (originalFacts[result.key]) {
        const fact = originalFacts[result.key];
        parsedResults.push({
          key: result.key,
          value: fact.value,
          category: fact.category,
          confidence: fact.confidence,
          relevanceScore: result.relevanceScore || 0.5,
          reasoning: result.reasoning || 'Semantically relevant',
          tags: fact.tags || [],
          lastUpdated: fact.lastUpdated,
          source: fact.source || 'unknown'
        });
      }
    }

    return parsedResults;

  } catch (error) {
    logger.error('Error parsing semantic search response:', error);
    return [];
  }
}

/**
 * Combine and deduplicate search results
 * @param {Array} keywordResults - Keyword search results
 * @param {Array} semanticResults - Semantic search results
 * @returns {Array} - Combined and deduplicated results
 */
function combineSearchResults(keywordResults, semanticResults) {
  const combined = new Map();

  // Add keyword results
  for (const result of keywordResults) {
    combined.set(result.key, {
      ...result,
      searchMethods: ['keyword']
    });
  }

  // Add or merge semantic results
  for (const result of semanticResults) {
    if (combined.has(result.key)) {
      // Merge with existing result
      const existing = combined.get(result.key);
      combined.set(result.key, {
        ...existing,
        relevanceScore: Math.max(existing.relevanceScore, result.relevanceScore),
        searchMethods: [...existing.searchMethods, 'semantic'],
        reasoning: result.reasoning || existing.reasoning
      });
    } else {
      // Add new result
      combined.set(result.key, {
        ...result,
        searchMethods: ['semantic']
      });
    }
  }

  return Array.from(combined.values());
}

/**
 * Update usage metrics for retrieved facts
 * @param {Array} facts - Retrieved facts
 * @param {string} userId - User ID
 */
async function updateFactUsageMetrics(facts, userId) {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    for (const fact of facts) {
      if (fact.factType === 'user' && fact.userId === userId) {
        // Update user fact metrics
        if (db.data.userFacts[userId] && db.data.userFacts[userId].facts[fact.key]) {
          const userFact = db.data.userFacts[userId].facts[fact.key];
          userFact.lastAccessed = now;
          userFact.accessCount = (userFact.accessCount || 0) + 1;
        }
      } else if (fact.factType === 'global') {
        // Update global fact metrics
        if (db.data.globalFacts && db.data.globalFacts.facts[fact.key]) {
          const globalFact = db.data.globalFacts.facts[fact.key];
          globalFact.lastUsed = now;
          globalFact.usageCount = (globalFact.usageCount || 0) + 1;
        }
      }
    }

    await db.write();
  } catch (error) {
    logger.error('Error updating fact usage metrics:', error);
  }
}

/**
 * Calculate search quality score
 * @param {Array} results - Search results
 * @param {string} query - Search query
 * @returns {number} - Quality score (0-1)
 */
function calculateSearchQuality(results, query) {
  if (results.length === 0) return 0;

  const avgRelevance = results.reduce((sum, fact) => sum + fact.relevanceScore, 0) / results.length;
  const highRelevanceCount = results.filter(fact => fact.relevanceScore > 0.7).length;
  const queryLength = query.split(/\s+/).length;

  // Quality factors
  const relevanceScore = avgRelevance * 0.5;
  const coverageScore = Math.min(results.length / 5, 1) * 0.3; // Good coverage if 5+ results
  const precisionScore = (highRelevanceCount / results.length) * 0.2;

  return Math.min(relevanceScore + coverageScore + precisionScore, 1);
}

/**
 * Get fact suggestions based on partial input
 * @param {string} userId - User ID
 * @param {string} partialInput - Partial user input
 * @returns {Promise<Array>} - Fact suggestions
 */
async function getFactSuggestions(userId, partialInput) {
  try {
    const db = getDb();
    const suggestions = [];

    if (!partialInput || partialInput.length < 2) {
      return suggestions;
    }

    const inputLower = partialInput.toLowerCase();

    // Search user facts
    if (db.data.userFacts && db.data.userFacts[userId] && db.data.userFacts[userId].facts) {
      const userFacts = db.data.userFacts[userId].facts;
      
      for (const [key, fact] of Object.entries(userFacts)) {
        if (key.toLowerCase().includes(inputLower) || 
            fact.value.toLowerCase().includes(inputLower)) {
          suggestions.push({
            type: 'user_fact',
            key,
            value: fact.value,
            category: fact.category,
            confidence: fact.confidence
          });
        }
      }
    }

    // Search global facts
    if (db.data.globalFacts && db.data.globalFacts.facts) {
      const globalFacts = db.data.globalFacts.facts;
      
      for (const [key, fact] of Object.entries(globalFacts)) {
        if (key.toLowerCase().includes(inputLower) || 
            fact.value.toLowerCase().includes(inputLower)) {
          suggestions.push({
            type: 'global_fact',
            key,
            value: fact.value,
            category: fact.category,
            confidence: fact.confidence
          });
        }
      }
    }

    // Sort by relevance and limit results
    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

  } catch (error) {
    logger.error('Error getting fact suggestions:', error);
    return [];
  }
}

/**
 * Get fact statistics
 * @param {string} userId - User ID (optional)
 * @returns {Object} - Fact statistics
 */
function getFactStatistics(userId = null) {
  try {
    const db = getDb();
    const stats = {
      totalUserFacts: 0,
      totalGlobalFacts: 0,
      userFactsByCategory: {},
      globalFactsByCategory: {},
      recentFacts: 0,
      highConfidenceFacts: 0
    };

    // Count user facts
    if (userId && db.data.userFacts && db.data.userFacts[userId]) {
      const userFacts = db.data.userFacts[userId].facts;
      stats.totalUserFacts = Object.keys(userFacts).length;
      
      for (const fact of Object.values(userFacts)) {
        if (fact.category) {
          stats.userFactsByCategory[fact.category] = (stats.userFactsByCategory[fact.category] || 0) + 1;
        }
        if (fact.confidence && fact.confidence > 0.8) {
          stats.highConfidenceFacts++;
        }
        if (fact.lastUpdated) {
          const daysSinceUpdate = (Date.now() - new Date(fact.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceUpdate < 7) {
            stats.recentFacts++;
          }
        }
      }
    }

    // Count global facts
    if (db.data.globalFacts && db.data.globalFacts.facts) {
      const globalFacts = db.data.globalFacts.facts;
      stats.totalGlobalFacts = Object.keys(globalFacts).length;
      
      for (const fact of Object.values(globalFacts)) {
        if (fact.category) {
          stats.globalFactsByCategory[fact.category] = (stats.globalFactsByCategory[fact.category] || 0) + 1;
        }
      }
    }

    return stats;

  } catch (error) {
    logger.error('Error getting fact statistics:', error);
    return {
      totalUserFacts: 0,
      totalGlobalFacts: 0,
      userFactsByCategory: {},
      globalFactsByCategory: {},
      recentFacts: 0,
      highConfidenceFacts: 0
    };
  }
}

// Export all functions
export {
  searchFacts,
  searchUserFacts,
  searchGlobalFacts,
  searchOtherUserFacts,
  extractKeywords,
  searchFactsByKeywords,
  searchFactsSemantically,
  getFactSuggestions,
  getFactStatistics,
  createSemanticSearchPrompt,
  parseSemanticSearchResponse,
  combineSearchResults,
  updateFactUsageMetrics,
  calculateSearchQuality
};
