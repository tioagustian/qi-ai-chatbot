import { searchFacts } from './factSearchService.js';
import { getDb } from '../database/index.js';
import chalk from 'chalk';

// Console logging helper
const logger = {
  info: (message, data) => {
    console.log(chalk.blue(`[FACT INTEGRATION] ${message}`), data || '');
  },
  success: (message, data) => {
    console.log(chalk.green(`[FACT INTEGRATION] ${message}`), data || '');
  },
  warning: (message, data) => {
    console.log(chalk.yellow(`[FACT INTEGRATION] ${message}`), data || '');
  },
  error: (message, data) => {
    console.log(chalk.red(`[FACT INTEGRATION] ${message}`), data || '');
  },
  debug: (message, data) => {
    console.log(chalk.gray(`[FACT INTEGRATION] ${message}`), data || '');
  }
};

/**
 * Intelligently integrate facts into conversation context
 * @param {string} userId - User ID
 * @param {string} message - User message
 * @param {Array} conversationHistory - Recent conversation history
 * @param {Object} options - Integration options
 * @returns {Promise<Object>} - Integrated facts and context
 */
async function integrateFactsIntelligently(userId, message, conversationHistory = [], options = {}) {
  try {
    const {
      maxFacts = 5,
      minRelevance = 0.4,
      useSemanticSearch = true,
      includeGlobalFacts = true,
      includeUserFacts = true,
      contextAware = true
    } = options;

    logger.info(`Intelligently integrating facts for user ${userId.split('@')[0]}`);

    // Analyze message intent and context
    const messageAnalysis = analyzeMessageIntent(message, conversationHistory);
    logger.debug('Message analysis:', messageAnalysis);

    // Search for relevant facts
    const searchResult = await searchFacts(userId, message, {
      includeGlobalFacts,
      includeUserFacts,
      includeOtherUsers: false,
      maxResults: maxFacts * 2, // Get more results for filtering
      minRelevance: minRelevance * 0.8, // Lower threshold for initial search
      useSemanticSearch
    });

    if (!searchResult.topResults || searchResult.topResults.length === 0) {
      logger.debug('No relevant facts found');
      return {
        integratedFacts: [],
        contextEnhancement: '',
        shouldUseFacts: false
      };
    }

    // Filter and prioritize facts based on context
    const prioritizedFacts = prioritizeFactsByContext(
      searchResult.topResults,
      messageAnalysis,
      conversationHistory,
      maxFacts
    );

    // Create natural context enhancement
    const contextEnhancement = createNaturalContextEnhancement(
      prioritizedFacts,
      messageAnalysis,
      conversationHistory
    );

    // Determine if facts should be actively used
    const shouldUseFacts = determineFactUsage(messageAnalysis, prioritizedFacts);

    logger.success(`Integrated ${prioritizedFacts.length} facts intelligently`);

    return {
      integratedFacts: prioritizedFacts,
      contextEnhancement,
      shouldUseFacts,
      messageAnalysis,
      searchQuality: searchResult.searchQuality
    };

  } catch (error) {
    logger.error('Error in intelligent fact integration:', error);
    return {
      integratedFacts: [],
      contextEnhancement: '',
      shouldUseFacts: false,
      error: error.message
    };
  }
}

/**
 * Analyze message intent and context
 * @param {string} message - User message
 * @param {Array} conversationHistory - Conversation history
 * @returns {Object} - Message analysis
 */
function analyzeMessageIntent(message, conversationHistory) {
  const analysis = {
    isQuestion: false,
    isPersonal: false,
    isFactual: false,
    isConversational: false,
    topics: [],
    entities: [],
    intent: 'general'
  };

  const lowerMessage = message.toLowerCase();

  // Detect question intent
  const questionWords = ['apa', 'siapa', 'kapan', 'dimana', 'kenapa', 'bagaimana', 'berapa', 'what', 'who', 'when', 'where', 'why', 'how', 'how much'];
  analysis.isQuestion = questionWords.some(word => lowerMessage.includes(word)) || 
                       lowerMessage.includes('?') || 
                       lowerMessage.includes('?');

  // Detect personal intent
  const personalWords = ['saya', 'aku', 'gue', 'i', 'my', 'me', 'nama', 'name', 'umur', 'age', 'rumah', 'home', 'kerja', 'work', 'hobi', 'hobby'];
  analysis.isPersonal = personalWords.some(word => lowerMessage.includes(word));

  // Detect factual intent
  const factualWords = ['adalah', 'berarti', 'definisi', 'definition', 'apa itu', 'what is', 'jelaskan', 'explain', 'info', 'information'];
  analysis.isFactual = factualWords.some(word => lowerMessage.includes(word));

  // Detect conversational intent
  const conversationalWords = ['halo', 'hai', 'hello', 'hi', 'gimana', 'how are you', 'apa kabar', 'what\'s up'];
  analysis.isConversational = conversationalWords.some(word => lowerMessage.includes(word));

  // Extract topics
  const topicKeywords = extractTopics(lowerMessage);
  analysis.topics = topicKeywords;

  // Determine primary intent
  if (analysis.isQuestion && analysis.isPersonal) {
    analysis.intent = 'personal_question';
  } else if (analysis.isQuestion && analysis.isFactual) {
    analysis.intent = 'factual_question';
  } else if (analysis.isPersonal) {
    analysis.intent = 'personal_statement';
  } else if (analysis.isConversational) {
    analysis.intent = 'conversational';
  } else if (analysis.isQuestion) {
    analysis.intent = 'general_question';
  } else {
    analysis.intent = 'general_statement';
  }

  return analysis;
}

/**
 * Extract topics from message
 * @param {string} message - Lowercase message
 * @returns {Array} - Extracted topics
 */
function extractTopics(message) {
  const topics = [];
  
  // Common topic patterns
  const topicPatterns = [
    { pattern: /(nama|name)/, topic: 'identity' },
    { pattern: /(umur|age|tua)/, topic: 'age' },
    { pattern: /(rumah|home|tinggal|live)/, topic: 'location' },
    { pattern: /(kerja|work|job|profesi)/, topic: 'work' },
    { pattern: /(hobi|hobby|suka|like)/, topic: 'interests' },
    { pattern: /(makan|food|restoran|restaurant)/, topic: 'food' },
    { pattern: /(musik|music|lagu|song)/, topic: 'music' },
    { pattern: /(film|movie|nonton|watch)/, topic: 'entertainment' },
    { pattern: /(olahraga|sport|main|play)/, topic: 'sports' },
    { pattern: /(kuliah|study|sekolah|school)/, topic: 'education' }
  ];

  topicPatterns.forEach(({ pattern, topic }) => {
    if (pattern.test(message)) {
      topics.push(topic);
    }
  });

  return [...new Set(topics)];
}

/**
 * Prioritize facts based on context and conversation history
 * @param {Array} facts - Search results
 * @param {Object} messageAnalysis - Message analysis
 * @param {Array} conversationHistory - Conversation history
 * @param {number} maxFacts - Maximum facts to return
 * @returns {Array} - Prioritized facts
 */
function prioritizeFactsByContext(facts, messageAnalysis, conversationHistory, maxFacts) {
  // Score facts based on context relevance
  const scoredFacts = facts.map(fact => {
    let contextScore = fact.relevanceScore;

    // Boost score for personal questions if fact is personal
    if (messageAnalysis.isPersonal && fact.factType === 'user') {
      contextScore += 0.2;
    }

    // Boost score for factual questions if fact is global
    if (messageAnalysis.isFactual && fact.factType === 'global') {
      contextScore += 0.2;
    }

    // Boost score for topic relevance
    if (messageAnalysis.topics.length > 0) {
      const factText = `${fact.key} ${fact.value}`.toLowerCase();
      const topicRelevance = messageAnalysis.topics.some(topic => {
        const topicKeywords = getTopicKeywords(topic);
        return topicKeywords.some(keyword => factText.includes(keyword));
      });
      
      if (topicRelevance) {
        contextScore += 0.3;
      }
    }

    // Boost score for recent conversation relevance
    if (conversationHistory.length > 0) {
      const recentContext = conversationHistory.slice(-3).join(' ').toLowerCase();
      const factText = `${fact.key} ${fact.value}`.toLowerCase();
      
      // Check if fact is mentioned in recent conversation
      const mentionedInContext = factText.split(' ').some(word => 
        word.length > 3 && recentContext.includes(word)
      );
      
      if (mentionedInContext) {
        contextScore += 0.2;
      }
    }

    return {
      ...fact,
      contextScore: Math.min(contextScore, 1.0)
    };
  });

  // Sort by context score and return top facts
  return scoredFacts
    .sort((a, b) => b.contextScore - a.contextScore)
    .slice(0, maxFacts);
}

/**
 * Get keywords for a topic
 * @param {string} topic - Topic name
 * @returns {Array} - Topic keywords
 */
function getTopicKeywords(topic) {
  const topicKeywords = {
    identity: ['nama', 'name', 'panggil', 'call'],
    age: ['umur', 'age', 'tua', 'young', 'birthday'],
    location: ['rumah', 'home', 'tinggal', 'live', 'kota', 'city'],
    work: ['kerja', 'work', 'job', 'profesi', 'office'],
    interests: ['hobi', 'hobby', 'suka', 'like', 'gemar'],
    food: ['makan', 'food', 'restoran', 'restaurant', 'masak'],
    music: ['musik', 'music', 'lagu', 'song', 'dengar'],
    entertainment: ['film', 'movie', 'nonton', 'watch', 'tv'],
    sports: ['olahraga', 'sport', 'main', 'play', 'game'],
    education: ['kuliah', 'study', 'sekolah', 'school', 'belajar']
  };

  return topicKeywords[topic] || [];
}

/**
 * Create natural context enhancement
 * @param {Array} facts - Prioritized facts
 * @param {Object} messageAnalysis - Message analysis
 * @param {Array} conversationHistory - Conversation history
 * @returns {string} - Natural context enhancement
 */
function createNaturalContextEnhancement(facts, messageAnalysis, conversationHistory) {
  if (facts.length === 0) {
    return '';
  }

  const userFacts = facts.filter(fact => fact.factType === 'user');
  const globalFacts = facts.filter(fact => fact.factType === 'global');

  let enhancement = '';

  // Add user facts in a conversational way
  if (userFacts.length > 0) {
    const userFactsText = userFacts
      .map(fact => fact.value)
      .join(', ');
    
    if (messageAnalysis.isPersonal) {
      enhancement += `I remember that you mentioned: ${userFactsText}. `;
    } else {
      enhancement += `Based on what I know about you: ${userFactsText}. `;
    }
  }

  // Add global facts as relevant information
  if (globalFacts.length > 0) {
    const globalFactsText = globalFacts
      .map(fact => fact.value)
      .join(', ');
    
    if (messageAnalysis.isFactual) {
      enhancement += `Relevant information: ${globalFactsText}. `;
    } else {
      enhancement += `For context: ${globalFactsText}. `;
    }
  }

  return enhancement.trim();
}

/**
 * Determine if facts should be actively used in response
 * @param {Object} messageAnalysis - Message analysis
 * @param {Array} facts - Prioritized facts
 * @returns {boolean} - Whether to actively use facts
 */
function determineFactUsage(messageAnalysis, facts) {
  // Always use facts for personal questions
  if (messageAnalysis.intent === 'personal_question') {
    return true;
  }

  // Use facts for factual questions if we have relevant global facts
  if (messageAnalysis.intent === 'factual_question') {
    return facts.some(fact => fact.factType === 'global');
  }

  // Use facts for personal statements if we have user facts
  if (messageAnalysis.intent === 'personal_statement') {
    return facts.some(fact => fact.factType === 'user');
  }

  // Use facts for conversational responses if we have high-relevance facts
  if (messageAnalysis.intent === 'conversational') {
    return facts.some(fact => fact.contextScore > 0.7);
  }

  // Use facts for general questions if we have relevant facts
  if (messageAnalysis.intent === 'general_question') {
    return facts.some(fact => fact.contextScore > 0.6);
  }

  return false;
}

/**
 * Create fact-based response suggestions
 * @param {Array} facts - Integrated facts
 * @param {Object} messageAnalysis - Message analysis
 * @returns {Array} - Response suggestions
 */
function createFactBasedResponseSuggestions(facts, messageAnalysis) {
  const suggestions = [];

  if (facts.length === 0) {
    return suggestions;
  }

  // Create personalized response suggestions
  facts.forEach(fact => {
    if (fact.factType === 'user') {
      switch (messageAnalysis.intent) {
        case 'personal_question':
          suggestions.push(`You can reference that ${fact.key}: ${fact.value}`);
          break;
        case 'conversational':
          suggestions.push(`You can casually mention ${fact.key}: ${fact.value}`);
          break;
        default:
          suggestions.push(`Consider incorporating ${fact.key}: ${fact.value}`);
      }
    } else if (fact.factType === 'global') {
      if (messageAnalysis.isFactual) {
        suggestions.push(`Provide information about ${fact.key}: ${fact.value}`);
      } else {
        suggestions.push(`Use as background knowledge: ${fact.value}`);
      }
    }
  });

  return suggestions;
}

/**
 * Enhance conversation context with intelligent fact integration
 * @param {string} userId - User ID
 * @param {string} message - User message
 * @param {Array} contextMessages - Current context messages
 * @param {Array} conversationHistory - Conversation history
 * @returns {Promise<Array>} - Enhanced context messages
 */
async function enhanceContextWithFacts(userId, message, contextMessages, conversationHistory = []) {
  try {
    const integrationResult = await integrateFactsIntelligently(
      userId, 
      message, 
      conversationHistory,
      {
        maxFacts: 3,
        minRelevance: 0.4,
        useSemanticSearch: true,
        includeGlobalFacts: true,
        includeUserFacts: true,
        contextAware: true
      }
    );

    if (integrationResult.contextEnhancement) {
      contextMessages.push({
        role: 'system',
        content: integrationResult.contextEnhancement,
        name: 'intelligent_facts'
      });

      logger.success(`Enhanced context with ${integrationResult.integratedFacts.length} intelligent facts`);
    }

    return contextMessages;

  } catch (error) {
    logger.error('Error enhancing context with facts:', error);
    return contextMessages;
  }
}

// Export all functions
export {
  integrateFactsIntelligently,
  analyzeMessageIntent,
  prioritizeFactsByContext,
  createNaturalContextEnhancement,
  determineFactUsage,
  createFactBasedResponseSuggestions,
  enhanceContextWithFacts
};
