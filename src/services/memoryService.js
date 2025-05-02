import { getDb } from '../database/index.js';
import { requestGeminiChat } from './aiService.js';
import chalk from 'chalk';
import crypto from 'crypto';

// Constants for the memory system
const MAX_FACTS_PER_USER = 100; // Maximum number of facts to store per user
const MIN_CONFIDENCE_THRESHOLD = 0.7; // Minimum confidence for storing a fact
const MAX_MESSAGE_HISTORY = 20; // Number of messages to include in the fact extraction prompt
const FACT_EXTRACTION_MODEL = 'gemini-2.0-flash'; // Model to use for fact extraction
const FACT_SIMILARITY_THRESHOLD = 0.7; // Threshold for considering facts similar

// Define semantic categories for facts
const FACT_CATEGORIES = {
  PERSONAL: 'personal',        // Name, age, gender, etc.
  PREFERENCE: 'preference',    // Likes, dislikes, favorites
  DEMOGRAPHIC: 'demographic',  // Location, occupation, education
  RELATIONSHIP: 'relationship', // Family, friends, connections
  TEMPORAL: 'temporal',        // Time-based facts that may change
  BEHAVIORAL: 'behavioral',     // Habits, patterns, routines
  INTEREST: 'interest',        // Hobbies, activities, topics of interest
  EXPERTISE: 'expertise',      // Skills, knowledge areas
  BELIEF: 'belief',            // Opinions, values, principles
  ASPIRATION: 'aspiration',    // Goals, plans, wishes
  HEALTH: 'health',            // Health status, conditions, habits
  IDENTITY: 'identity',        // Cultural, religious, social identity
  CONTEXT: 'context'           // Situational or conversational context
};

// Define fact types for better classification
const FACT_TYPES = {
  EXPLICIT: 'explicit',        // Explicitly stated by the user
  INFERRED: 'inferred',        // Inferred from conversation
  DERIVED: 'derived',          // Derived from other facts
  OBSERVED: 'observed',        // Observed from user behavior
  REPORTED: 'reported'         // Reported by others
};

// Console logging helper
const logger = {
  info: (message) => console.log(chalk.blue(`[MEMORY][${new Date().toISOString()}] ${message}`)),
  success: (message) => console.log(chalk.green(`[MEMORY][${new Date().toISOString()}] ${message}`)),
  warning: (message) => console.log(chalk.yellow(`[MEMORY][${new Date().toISOString()}] ${message}`)),
  error: (message, error) => {
    console.log(chalk.red(`[MEMORY ERROR][${new Date().toISOString()}] ${message}`));
    if (error) {
      console.log(chalk.red('Error details:'));
      if (error.response) {
        console.log(chalk.red(`Status: ${error.response.status}`));
        console.log(chalk.red('Response data:'), error.response.data);
      } else if (error.request) {
        console.log(chalk.red('No response received'));
      } else {
        console.log(chalk.red(`Message: ${error.message}`));
      }
      console.log(chalk.red('Stack trace:'));
      console.log(error.stack);
    }
  },
  debug: (message, data) => {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.magenta(`[MEMORY DEBUG][${new Date().toISOString()}] ${message}`));
      if (data) console.log(chalk.magenta('Debug data:'), data);
    }
  }
};

/**
 * Ensure the memory database structure exists
 * @param {Object} db - Database instance
 */
function ensureMemoryStructure(db) {
  // Ensure userFacts structure exists
  if (!db.data.userFacts) {
    db.data.userFacts = {};
  }
  
  // Ensure globalFacts structure exists
  if (!db.data.globalFacts) {
    db.data.globalFacts = {
      facts: {},
      factHistory: [],
      categories: {},
      relationships: {}
    };
  }
  
  // Ensure image embeddings structure exists
  if (!db.data.imageEmbeddings) {
    db.data.imageEmbeddings = {};
  }

  // Ensure fact relationships structure exists
  if (!db.data.factRelationships) {
    db.data.factRelationships = {};
  }
  
  // Ensure fact taxonomies structure exists
  if (!db.data.factTaxonomies) {
    db.data.factTaxonomies = {
      categories: { ...FACT_CATEGORIES },
      types: { ...FACT_TYPES },
      domains: {}
    };
  }
  
  // Ensure knowledge graphs structure exists
  if (!db.data.knowledgeGraphs) {
    db.data.knowledgeGraphs = {
      entities: {},
      relationships: {},
      global: {}
    };
  }
  
  // Ensure web search history structure exists
  if (!db.data.webSearchHistory) {
    db.data.webSearchHistory = {};
  }
  
  // Ensure web content structure exists
  if (!db.data.webContent) {
    db.data.webContent = {};
  }
  
  // Update existing userFacts with enhanced structure if needed
  Object.entries(db.data.userFacts).forEach(([userId, userData]) => {
    Object.entries(userData.facts || {}).forEach(([factKey, fact]) => {
      // Add factType if missing
      if (!fact.factType) {
        fact.factType = FACT_TYPES.EXPLICIT;
      }
      
      // Add source context if missing
      if (!fact.sourceContext) {
        fact.sourceContext = 'legacy';
      }
      
      // Add tags if missing
      if (!fact.tags) {
        fact.tags = [];
      }
      
      // Add relevance score if missing
      if (!fact.relevanceScore) {
        fact.relevanceScore = 0.5;
      }
      
      // Add sentiment if missing
      if (!fact.sentiment) {
        fact.sentiment = 'neutral';
      }
    });
  });
}

/**
 * Helper function to determine fact category
 * @param {string} key - Fact key
 * @param {string} value - Fact value
 * @returns {string} - Category name
 */
function determineFactCategory(key, value) {
  if (/name|age|gender|birthday|height|weight/.test(key)) return FACT_CATEGORIES.PERSONAL;
  if (/likes|loves|hates|favorite|prefers|enjoy/.test(key)) return FACT_CATEGORIES.PREFERENCE;
  if (/lives in|works at|studies|location|city|country|address/.test(key)) return FACT_CATEGORIES.DEMOGRAPHIC;
  if (/married|children|brother|sister|father|mother|friend|spouse|partner/.test(key)) return FACT_CATEGORIES.RELATIONSHIP;
  if (/today|yesterday|last week|planning|will|going to/.test(key)) return FACT_CATEGORIES.TEMPORAL;
  if (/usually|always|never|habit|routine|often|daily/.test(key)) return FACT_CATEGORIES.BEHAVIORAL;
  if (/hobby|interest|likes to|enjoys|passion|activity/.test(key)) return FACT_CATEGORIES.INTEREST;
  if (/skilled|expert|knows|ability|can|proficient/.test(key)) return FACT_CATEGORIES.EXPERTISE;
  if (/believes|thinks|opinion|values|feels that/.test(key)) return FACT_CATEGORIES.BELIEF;
  if (/wants to|dreams|goal|aspiration|plans to/.test(key)) return FACT_CATEGORIES.ASPIRATION;
  if (/health|medical|condition|allergic|diet/.test(key)) return FACT_CATEGORIES.HEALTH;
  if (/religion|culture|identity|nationality|ethnicity/.test(key)) return FACT_CATEGORIES.IDENTITY;
  if (/currently|this conversation|now/.test(key)) return FACT_CATEGORIES.CONTEXT;
  
  return 'uncategorized';
}

/**
 * Extract and process facts from the conversation
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID
 * @param {string} currentMessage - Current message from the user
 * @returns {Promise<Object>} - Relevant facts and processing results
 */
async function extractAndProcessFacts(userId, chatId, currentMessage) {
  try {
    const db = getDb();
    
    // Ensure memory structure exists
    ensureMemoryStructure(db);
    
    logger.info(`Extracting facts for user ${userId.split('@')[0]} in chat ${chatId.split('@')[0]}`);
    
    // Get user facts
    const userFacts = getUserFacts(userId);
    
    // Get global facts
    const globalFacts = getGlobalFacts();
    
    // Get facts for other participants in the chat (only for group chats)
    const otherParticipantsFacts = getOtherParticipantsFacts(db, chatId, userId);
    
    // Get chat history
    const chatHistory = getChatHistory(chatId, userId, MAX_MESSAGE_HISTORY);
    
    // Create prompt for Gemini
    const prompt = createFactExtractionPrompt(userFacts, globalFacts, otherParticipantsFacts, chatHistory, currentMessage);
    
    // Call Gemini API for fact extraction
    logger.debug('Calling Gemini API for fact extraction');
    const apiKey = db.data.config.geminiApiKey || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      logger.warning('No Gemini API key found for fact extraction');
      return { relevantFacts: [], success: false, error: 'No Gemini API key available' };
    }
    
    // Format messages for Gemini API
    const messages = [
      { role: 'user', content: prompt }
    ];
    
    // Call Gemini API
    const response = await requestGeminiChat(
      FACT_EXTRACTION_MODEL,
      apiKey,
      messages,
      {
        temperature: 0.2, // Low temperature for more deterministic fact extraction
        top_p: 0.9,
        max_tokens: 2048,
        stop: null,
        stream: false
      }
    );
    
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      logger.error('Invalid response from Gemini API for fact extraction');
      return { relevantFacts: [], success: false, error: 'Invalid Gemini API response' };
    }
    
    const content = response.choices[0].message.content;
    logger.debug(`Gemini response: ${content.substring(0, 200)}...`);
    
    // Parse the Gemini response to extract facts
    const extractionResult = parseFactExtractionResponse(content);
    
    if (!extractionResult.success) {
      logger.warning(`Failed to parse fact extraction response: ${extractionResult.error}`);
      return { relevantFacts: [], success: false, error: extractionResult.error };
    }
    
    // Process the extracted facts
    const processResult = await processExtractedFacts(userId, extractionResult);
    
    // Return the relevant facts for the current message
    return {
      relevantFacts: processResult.relevantFacts,
      newFacts: processResult.newFacts,
      updatedFacts: processResult.updatedFacts,
      otherParticipantsFacts: otherParticipantsFacts,
      success: true
    };
  } catch (error) {
    logger.error('Error in fact extraction process', error);
    return { relevantFacts: [], success: false, error: error.message };
  }
}

/**
 * Get current facts for a user
 * @param {string} userId - User ID
 * @returns {Object} - User facts
 */
function getUserFacts(userId) {
  const db = getDb();
  
  if (!db.data.userFacts[userId]) {
    db.data.userFacts[userId] = {
      facts: {},
      factHistory: []
    };
  }
  
  return db.data.userFacts[userId].facts;
}

/**
 * Get global facts
 * @returns {Object} - Global facts
 */
function getGlobalFacts() {
  const db = getDb();
  return db.data.globalFacts.facts;
}

/**
 * Get recent chat history for context
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 * @param {number} limit - Maximum number of messages to retrieve
 * @returns {Array} - Recent messages
 */
function getChatHistory(chatId, userId, limit = 20) {
  const db = getDb();
  
  if (!db.data.conversations[chatId]) {
    return [];
  }
  
  // Get messages for this chat, focusing on the user's messages
  return db.data.conversations[chatId].messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .slice(-limit)
    .map(msg => ({
      role: msg.role,
      name: msg.name,
      content: msg.content,
      timestamp: msg.timestamp
    }));
}

/**
 * Create prompt for fact extraction
 * @param {Object} userFacts - User facts
 * @param {Object} globalFacts - Global facts
 * @param {Object} otherParticipantsFacts - Facts about other participants in the chat
 * @param {Array} chatHistory - Chat history
 * @param {string} currentMessage - Current message
 * @returns {string} - Prompt for Gemini
 */
function createFactExtractionPrompt(userFacts, globalFacts, otherParticipantsFacts, chatHistory, currentMessage) {
  // Format current facts
  const formattedUserFacts = Object.entries(userFacts).map(([key, fact]) => {
    // Include more detailed information in formatted facts
    const category = fact.category ? `, "category": "${fact.category}"` : '';
    const factType = fact.factType ? `, "factType": "${fact.factType}"` : '';
    const tags = fact.tags?.length > 0 ? `, "tags": ${JSON.stringify(fact.tags)}` : '';
    const sentiment = fact.sentiment ? `, "sentiment": "${fact.sentiment}"` : '';
    
    return `"${key}": { "value": "${fact.value}", "confidence": ${fact.confidence}${category}${factType}${tags}${sentiment} }`;
  }).join(',\n    ');
  
  const formattedGlobalFacts = Object.entries(globalFacts).map(([key, fact]) => {
    // Include more detailed information for global facts
    const category = fact.category ? `, "category": "${fact.category}"` : '';
    return `"${key}": { "value": "${fact.value}", "confidence": ${fact.confidence}${category}, "is_global": true }`;
  }).join(',\n    ');
  
  // Format other participants' facts if available
  let formattedOtherParticipantsFacts = '';
  if (Object.keys(otherParticipantsFacts).length > 0) {
    formattedOtherParticipantsFacts = Object.entries(otherParticipantsFacts)
      .map(([name, facts]) => {
        const factsList = Object.entries(facts)
          .map(([key, fact]) => `"${key}": { "value": "${fact.value}", "confidence": ${fact.confidence} }`)
          .join(',\n      ');
        
        return `"${name}": {\n      ${factsList}\n    }`;
      })
      .join(',\n    ');
  }
  
  // Format chat history
  const formattedChatHistory = chatHistory.map(msg => {
    return `{
      "role": "${msg.role}",
      "name": "${msg.name}",
      "content": "${msg.content.replace(/"/g, '\\"')}",
      "timestamp": "${msg.timestamp}"
    }`;
  }).join(',\n    ');
  
  // Create the enhanced prompt
  let prompt = `You are an advanced fact extraction and knowledge management system for an AI chatbot. Your task is to analyze conversations and maintain a detailed knowledge base about users and general facts.

TASK OVERVIEW:
1. Analyze conversation history and the latest message
2. Extract new facts about the user
3. Identify facts that need updating
4. Extract any general knowledge (global facts) mentioned
5. Determine which facts are most relevant to the current message context

FACT CATEGORIZATION SYSTEM:
Facts should be categorized using the following schema:

1. CATEGORIES:
   - PERSONAL: Basic identity information (name, age, gender)
   - PREFERENCE: Likes, dislikes, favorites
   - DEMOGRAPHIC: Location, occupation, education
   - RELATIONSHIP: Family, friends, connections
   - TEMPORAL: Time-based facts that may change
   - BEHAVIORAL: Habits, patterns, routines
   - INTEREST: Hobbies, activities, topics of interest
   - EXPERTISE: Skills, knowledge domains, abilities
   - BELIEF: Opinions, values, principles
   - ASPIRATION: Goals, plans, wishes
   - HEALTH: Health status, conditions, habits
   - IDENTITY: Cultural, religious, social identity
   - CONTEXT: Situational or conversational context

2. FACT TYPES:
   - EXPLICIT: Directly stated by the user ("I am a doctor")
   - INFERRED: Reasonably concluded from context ("I'm tired after my shift at the hospital" → likely works in healthcare)
   - DERIVED: Logically derived from other known facts
   - OBSERVED: Based on observed patterns in conversation
   - REPORTED: Mentioned by others or external sources

3. FACT STRUCTURE:
   - value: The actual fact content
   - confidence: Certainty level (0.0-1.0)
   - category: Semantic category from the list above
   - factType: How the fact was obtained
   - is_global: Whether it's general knowledge (true) or specific to this user (false)
   - tags: Optional keywords for better classification
   - sentiment: User's emotional association (positive/negative/neutral)

EXTRACTION GUIDELINES:
* Be precise and specific in fact formulation
* Maintain appropriate confidence levels:
  - Explicitly stated facts: 0.8-0.95
  - Strongly implied facts: 0.7-0.8
  - Reasonably inferred facts: 0.5-0.7
* Distinguish between permanent facts (name, birthplace) and temporal facts (current location, mood)
* For temporal facts, capture time-sensitivity in the key name (e.g., "current_job" vs "previous_job")
* Global facts should represent objective knowledge, not personal information
* Identify relationships between facts when possible
* Extract rich, detailed facts rather than simplistic ones
* DO NOT extract hypothetical scenarios, future possibilities, or temporary states
* DO NOT include facts about other people unless related to the user's relationship with them

GLOBAL FACTS VS USER FACTS:
* Global facts: General knowledge, locations, entities, concepts (e.g., "Jakarta is the capital of Indonesia")
* User facts: Personal information, preferences, or experiences of the specific user (e.g., "user lives in Jakarta")

USER FACTS should be included in "new_facts", "update_facts", and "relevant_facts".
GLOBAL FACTS should be added to "new_facts" and "update_facts" with the "is_global" property set to true.

CURRENT FACTS ABOUT THE USER:
{
  ${formattedUserFacts || '"no_facts": "No facts available yet"'}
}

GLOBAL FACTS (reference only - add new global facts with is_global=true):
{
  ${formattedGlobalFacts || '"no_facts": "No global facts available yet"'}
}`;

  // Add other participants' facts if available
  if (formattedOtherParticipantsFacts) {
    prompt += `\n\nFACTS ABOUT OTHER PARTICIPANTS IN THIS CONVERSATION (for reference only, don't modify these):
{
  ${formattedOtherParticipantsFacts}
}`;
  }

  // Add chat history and current message
  prompt += `\n\nCONVERSATION HISTORY:
[
  ${formattedChatHistory || '{"role": "system", "content": "No conversation history available"}'}
]

CURRENT MESSAGE:
"${currentMessage}"

RESPONSE FORMAT:
Respond with a structured JSON object containing:

{
  "new_facts": {
    "key_name": {
      "value": "fact_value",
      "confidence": 0.85,
      "category": "CATEGORY_NAME",
      "factType": "FACT_TYPE",
      "tags": ["tag1", "tag2"],
      "sentiment": "neutral",
      "is_global": false  // Set to true only for general knowledge facts
    },
    // More new facts...
  },
  "update_facts": {
    "existing_key": {
      "value": "new_value",
      "confidence": 0.9,
      "previous_value": "old_value",
      "category": "CATEGORY_NAME",
      "factType": "FACT_TYPE",
      "is_global": false  // Set to true only for general knowledge facts
    },
    // More updated facts...
  },
  "relevant_facts": {
    "fact_key": {
      "value": "fact_value",
      "confidence": 0.85,
      "relevance": 0.9,  // How relevant this fact is to the current message (0.0-1.0)
      "category": "CATEGORY_NAME",
      "reasoning": "Brief explanation of why this fact is relevant"
    },
    // More relevant facts...
  },
  "fact_relationships": [
    {
      "fact1": "key_of_first_fact",
      "fact2": "key_of_second_fact",
      "relationship_type": "related_to/contrasts_with/implies/etc",
      "strength": 0.8
    },
    // More relationships...
  ]
}

IMPORTANT NOTES:
* Only include facts with sufficient confidence (>0.7 for new facts, can be lower for relevance)
* For global facts, use clear, canonical key names (e.g., "capital_of_indonesia" not "what_is_jakarta")
* For updated facts, always include the previous value for reference
* Keep the JSON structure clean and valid
* If a section has no entries, return an empty object for that section
* DO extract global facts when general knowledge is mentioned
* Provide reasoning for why each relevant fact was selected

Analyze the current conversation thoroughly and extract knowledge that would help the AI provide personalized, contextually relevant responses.`;

  return prompt;
}

/**
 * Parse the response from Gemini for fact extraction
 * @param {string} response - Gemini API response
 * @returns {Object} - Parsed facts or error
 */
function parseFactExtractionResponse(response) {
  try {
    // Extract JSON from the response
    let jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    
    if (!jsonMatch) {
      // Try without the code block format
      jsonMatch = response.match(/\{[\s\S]*\}/);
    }
    
    if (!jsonMatch) {
      logger.warning('No JSON found in the response');
      return { success: false, error: 'No JSON found in the response' };
    }
    
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsedJson = JSON.parse(jsonStr);
    
    // Validate the expected structure
    if (!parsedJson.new_facts && !parsedJson.update_facts && !parsedJson.relevant_facts) {
      logger.warning('Invalid JSON structure in response');
      return { success: false, error: 'Invalid JSON structure in response' };
    }
    
    // Process the response, preserving the enhanced structure
    const newFacts = {};
    const updateFacts = {};
    const relevantFacts = {};
    const factRelationships = [];
    
    // Process new facts, preserving all properties
    if (parsedJson.new_facts) {
      Object.entries(parsedJson.new_facts).forEach(([key, fact]) => {
        newFacts[key] = {
          value: fact.value,
          confidence: fact.confidence,
          is_global: fact.is_global === true,
          category: fact.category || determineFactCategory(key, fact.value),
          factType: fact.factType || FACT_TYPES.EXPLICIT,
          tags: fact.tags || [],
          sentiment: fact.sentiment || 'neutral',
          sourceContext: fact.sourceContext || 'auto-extracted'
        };
      });
    }
    
    // Process updated facts, preserving all properties and previous value
    if (parsedJson.update_facts) {
      Object.entries(parsedJson.update_facts).forEach(([key, fact]) => {
        updateFacts[key] = {
          value: fact.value,
          confidence: fact.confidence,
          previous_value: fact.previous_value,
          is_global: fact.is_global === true,
          category: fact.category || determineFactCategory(key, fact.value),
          factType: fact.factType || FACT_TYPES.EXPLICIT,
          tags: fact.tags || [],
          sentiment: fact.sentiment || 'neutral',
          sourceContext: fact.sourceContext || 'auto-updated'
        };
      });
    }
    
    // Process relevant facts with enhanced relevance information
    if (parsedJson.relevant_facts) {
      Object.entries(parsedJson.relevant_facts).forEach(([key, fact]) => {
        relevantFacts[key] = {
          value: fact.value,
          confidence: fact.confidence,
          relevance: fact.relevance || 0.8,
          category: fact.category || determineFactCategory(key, fact.value),
          reasoning: fact.reasoning || 'Relevant to current context',
          factType: fact.factType || FACT_TYPES.EXPLICIT,
          tags: fact.tags || []
        };
      });
    }
    
    // Process fact relationships if available
    if (parsedJson.fact_relationships && Array.isArray(parsedJson.fact_relationships)) {
      parsedJson.fact_relationships.forEach(relationship => {
        if (relationship.fact1 && relationship.fact2) {
          factRelationships.push({
            fact1: relationship.fact1,
            fact2: relationship.fact2,
            relationshipType: relationship.relationship_type || 'related_to',
            strength: relationship.strength || 0.7
          });
        }
      });
    }
    
    return {
      success: true,
      newFacts,
      updateFacts,
      relevantFacts,
      factRelationships
    };
  } catch (error) {
    logger.error('Error parsing fact extraction response', error);
    return { success: false, error: 'Failed to parse fact extraction response' };
  }
}

/**
 * Apply decay factor for time-sensitive facts
 * @param {Object} facts - Facts object
 */
function applyFactDecay(facts) {
  const now = new Date();
  
  Object.entries(facts).forEach(([key, fact]) => {
    // Skip facts that aren't time-sensitive
    if (fact.category !== FACT_CATEGORIES.TEMPORAL) return;
    
    const daysSinceUpdate = (now - new Date(fact.lastUpdated)) / (1000 * 60 * 60 * 24);
    
    // Reduce confidence for older temporal facts
    if (daysSinceUpdate > 30) { // More than a month old
      const decayFactor = 0.9 ** Math.floor(daysSinceUpdate / 30);
      fact.confidence = Math.max(MIN_CONFIDENCE_THRESHOLD, fact.confidence * decayFactor);
    }
  });
}

/**
 * Updated confidence calculation when facts are repeated
 * @param {Object} existingFact - Existing fact
 * @param {number} newConfidence - New confidence value
 * @returns {number} - Updated confidence
 */
function updateFactConfidence(existingFact, newConfidence) {
  // Facts become more confident when repeatedly confirmed
  // But confidence increases more slowly as it gets higher
  if (existingFact.value === existingFact.value) {
    const confidenceGain = (1 - existingFact.confidence) * 0.3;
    return Math.min(0.99, existingFact.confidence + confidenceGain);
  }
  
  // If conflicting, use the higher confidence
  return Math.max(existingFact.confidence, newConfidence);
}

/**
 * Process extracted facts (add new, update existing)
 * @param {string} userId - User ID
 * @param {Object} extractionResult - Result from parseFactExtractionResponse
 * @returns {Promise<Object>} - Processing results
 */
async function processExtractedFacts(userId, extractionResult) {
  const db = getDb();
  const userFactsObj = db.data.userFacts[userId] || { facts: {}, factHistory: [] };
  
  const newFacts = [];
  const updatedFacts = [];
  const processedRelationships = [];
  const globalFacts = [];
  
  // Process new facts
  for (const [factKey, factData] of Object.entries(extractionResult.newFacts)) {
    // Skip facts with confidence below threshold
    if (factData.confidence < MIN_CONFIDENCE_THRESHOLD) {
      logger.debug(`Skipping new fact "${factKey}" due to low confidence: ${factData.confidence}`);
      continue;
    }
    
    // Check if this is a global fact (either by pattern or explicit flag)
    const isGlobalFactPattern = /^(capital of|population of|location of|president of|currency of|language of|timezone of)/i;
    const isGlobalFact = factData.is_global === true || isGlobalFactPattern.test(factKey);
    
    if (isGlobalFact) {
      // Add as global fact with enhanced properties
      await addGlobalFact(factKey, factData.value, {
        confidence: factData.confidence,
        category: factData.category,
        tags: factData.tags,
        factType: factData.factType
      });
      
      // Add to new facts list for returning to caller
      newFacts.push({
        key: factKey,
        value: factData.value,
        confidence: factData.confidence,
        category: factData.category,
        isGlobal: true,
        tags: factData.tags || []
      });
      
      // Add to global facts list
      globalFacts.push({
        key: factKey,
        value: factData.value,
        confidence: factData.confidence,
        category: factData.category
      });
      
      continue;
    }
    
    // Check if fact already exists with the same value
    if (userFactsObj.facts[factKey] && userFactsObj.facts[factKey].value === factData.value) {
      // Same fact repeated - increase confidence and update metadata
      const newConfidence = updateFactConfidence(userFactsObj.facts[factKey], factData.confidence);
      
      // Update existing fact with enhanced properties
      userFactsObj.facts[factKey] = {
        ...userFactsObj.facts[factKey],
        confidence: newConfidence,
        lastUpdated: new Date().toISOString(),
        // Preserve existing data but update with new metadata if available
        category: factData.category || userFactsObj.facts[factKey].category,
        factType: factData.factType || userFactsObj.facts[factKey].factType || FACT_TYPES.EXPLICIT,
        tags: [...new Set([...(userFactsObj.facts[factKey].tags || []), ...(factData.tags || [])])],
        sentiment: factData.sentiment || userFactsObj.facts[factKey].sentiment || 'neutral',
        occurrences: (userFactsObj.facts[factKey].occurrences || 1) + 1
      };
      
      updatedFacts.push({
        key: factKey,
        oldValue: factData.value, // Same value, just metadata updated
        newValue: factData.value,
        oldConfidence: userFactsObj.facts[factKey].confidence,
        newConfidence: newConfidence,
        category: factData.category,
        tags: factData.tags
      });
      
      logger.info(`Reinforced fact: "${factKey}" (confidence: ${userFactsObj.facts[factKey].confidence} -> ${newConfidence})`);
      continue;
    }
    
    // Add new fact with enhanced properties
    userFactsObj.facts[factKey] = {
      value: factData.value,
      confidence: factData.confidence,
      category: factData.category,
      factType: factData.factType || FACT_TYPES.EXPLICIT,
      tags: factData.tags || [],
      sentiment: factData.sentiment || 'neutral',
      relevanceScore: 0.5, // Default relevance score
      lastUpdated: new Date().toISOString(),
      source: factData.sourceContext || 'auto-extracted',
      createdAt: new Date().toISOString(),
      occurrences: 1
    };
    
    newFacts.push({
      key: factKey,
      value: factData.value,
      confidence: factData.confidence,
      category: factData.category,
      tags: factData.tags || []
    });
    
    logger.info(`Added new fact: "${factKey}" = "${factData.value}" (confidence: ${factData.confidence}, category: ${factData.category})`);
  }
  
  // Process fact updates
  for (const [factKey, factData] of Object.entries(extractionResult.updateFacts)) {
    // Skip facts with confidence below threshold
    if (factData.confidence < MIN_CONFIDENCE_THRESHOLD) {
      logger.debug(`Skipping fact update "${factKey}" due to low confidence: ${factData.confidence}`);
      continue;
    }
    
    // Check if this is a global fact (either by pattern or explicit flag)
    const isGlobalFactPattern = /^(capital of|population of|location of|president of|currency of|language of|timezone of)/i;
    const isGlobalFact = factData.is_global === true || isGlobalFactPattern.test(factKey);
    
    if (isGlobalFact) {
      // Update global fact with enhanced properties
      await addGlobalFact(factKey, factData.value, {
        confidence: factData.confidence,
        category: factData.category,
        tags: factData.tags,
        factType: factData.factType,
        previous_value: factData.previous_value
      });
      
      // Add to updated facts list for returning to caller
      updatedFacts.push({
        key: factKey,
        oldValue: factData.previous_value || "unknown",
        newValue: factData.value,
        confidence: factData.confidence,
        category: factData.category,
        isGlobal: true,
        tags: factData.tags || []
      });
      
      // Add to global facts list
      globalFacts.push({
        key: factKey,
        value: factData.value,
        confidence: factData.confidence,
        category: factData.category,
        previous_value: factData.previous_value
      });
      
      continue;
    }
    
    const oldValue = userFactsObj.facts[factKey]?.value;
    
    // If the fact doesn't exist yet, add it as new with enhanced properties
    if (!userFactsObj.facts[factKey]) {
      userFactsObj.facts[factKey] = {
        value: factData.value,
        confidence: factData.confidence,
        category: factData.category,
        factType: factData.factType || FACT_TYPES.EXPLICIT,
        tags: factData.tags || [],
        sentiment: factData.sentiment || 'neutral',
        lastUpdated: new Date().toISOString(),
        source: factData.sourceContext || 'auto-extracted',
        createdAt: new Date().toISOString(),
        occurrences: 1
      };
      
      newFacts.push({
        key: factKey,
        value: factData.value,
        confidence: factData.confidence,
        category: factData.category,
        tags: factData.tags || []
      });
      
      logger.info(`Added new fact (from update): "${factKey}" = "${factData.value}" (confidence: ${factData.confidence}, category: ${factData.category})`);
      continue;
    }
    
    // Check if fact value is same but needs metadata update
    if (factData.value === userFactsObj.facts[factKey].value) {
      // Same value, possibly update metadata
      const newConfidence = updateFactConfidence(userFactsObj.facts[factKey], factData.confidence);
      const category = factData.category || userFactsObj.facts[factKey].category;
      
      // Update existing fact with enhanced properties
      const updatedFact = {
        ...userFactsObj.facts[factKey],
        confidence: newConfidence,
        category: category,
        lastUpdated: new Date().toISOString(),
        // Merge tags
        tags: [...new Set([...(userFactsObj.facts[factKey].tags || []), ...(factData.tags || [])])],
        // Update other properties if provided
        factType: factData.factType || userFactsObj.facts[factKey].factType,
        sentiment: factData.sentiment || userFactsObj.facts[factKey].sentiment,
        occurrences: (userFactsObj.facts[factKey].occurrences || 1) + 1
      };
      
      // Only update if something changed
      if (JSON.stringify(updatedFact) !== JSON.stringify(userFactsObj.facts[factKey])) {
        userFactsObj.facts[factKey] = updatedFact;
        logger.info(`Updated fact metadata: "${factKey}" (confidence: ${newConfidence}, category: ${category})`);
      }
      
      continue;
    }
    
    // Value is different, update the fact with enhanced properties
    if (factData.confidence >= userFactsObj.facts[factKey].confidence || 
        factData.value !== userFactsObj.facts[factKey].value) {
      
      // Record the history with enhanced properties
      userFactsObj.factHistory.push({
        fact: factKey,
        oldValue: userFactsObj.facts[factKey].value,
        newValue: factData.value,
        oldConfidence: userFactsObj.facts[factKey].confidence,
        newConfidence: factData.confidence,
        category: factData.category,
        tags: factData.tags,
        timestamp: new Date().toISOString(),
        reason: 'value-changed'
      });
      
      // Update the fact with enhanced properties
      userFactsObj.facts[factKey] = {
        ...userFactsObj.facts[factKey], // Preserve other metadata
        value: factData.value,
        confidence: factData.confidence,
        category: factData.category,
        factType: factData.factType || userFactsObj.facts[factKey].factType || FACT_TYPES.EXPLICIT,
        tags: [...new Set([...(userFactsObj.facts[factKey].tags || []), ...(factData.tags || [])])],
        sentiment: factData.sentiment || userFactsObj.facts[factKey].sentiment || 'neutral',
        lastUpdated: new Date().toISOString(),
        source: factData.sourceContext || 'auto-updated',
        createdAt: userFactsObj.facts[factKey].createdAt,
        occurrences: (userFactsObj.facts[factKey].occurrences || 1) + 1
      };
      
      updatedFacts.push({
        key: factKey,
        oldValue,
        newValue: factData.value,
        confidence: factData.confidence,
        category: factData.category,
        tags: factData.tags || []
      });
      
      logger.info(`Updated fact: "${factKey}" from "${oldValue}" to "${factData.value}" (confidence: ${factData.confidence}, category: ${factData.category})`);
    }
  }
  
  // NEW: Process relevant facts to identify global knowledge
  await extractGlobalKnowledgeFromRelevantFacts(extractionResult.relevantFacts, globalFacts);
  
  // Process fact relationships if available
  if (extractionResult.factRelationships && extractionResult.factRelationships.length > 0) {
    for (const relationship of extractionResult.factRelationships) {
      const { fact1, fact2, relationshipType, strength } = relationship;
      
      // Only record relationships between facts that exist
      if (userFactsObj.facts[fact1] && userFactsObj.facts[fact2]) {
        await recordFactRelationship(userId, fact1, fact2, strength, relationshipType);
        processedRelationships.push({ fact1, fact2, relationshipType, strength });
      }
    }
    
    if (processedRelationships.length > 0) {
      logger.info(`Recorded ${processedRelationships.length} fact relationships for user ${userId}`);
    }
  }
  
  // Update relevance scores for relevant facts
  if (extractionResult.relevantFacts && Object.keys(extractionResult.relevantFacts).length > 0) {
    for (const [factKey, factData] of Object.entries(extractionResult.relevantFacts)) {
      if (userFactsObj.facts[factKey]) {
        // Update relevance score if provided
        if (factData.relevance) {
          userFactsObj.facts[factKey].relevanceScore = factData.relevance;
        }
        
        // Record the reasoning if provided
        if (factData.reasoning) {
          userFactsObj.facts[factKey].relevanceReasoning = factData.reasoning;
        }
        
        // Update lastAccessed timestamp
        userFactsObj.facts[factKey].lastAccessed = new Date().toISOString();
      }
    }
  }
  
  // Apply fact decay for temporal facts
  applyFactDecay(userFactsObj.facts);
  
  // Limit the number of facts per user
  const factKeys = Object.keys(userFactsObj.facts);
  if (factKeys.length > MAX_FACTS_PER_USER) {
    // Sort facts by a combination of relevance, confidence, and recency
    const sortedFactKeys = factKeys.sort((a, b) => {
      const factA = userFactsObj.facts[a];
      const factB = userFactsObj.facts[b];
      
      // Calculate a score based on multiple factors
      const scoreA = (factA.relevanceScore || 0.5) * 0.4 + 
                    (factA.confidence || 0.5) * 0.3 + 
                    (factA.occurrences || 1) / 10 * 0.2 +
                    (new Date(factA.lastAccessed || factA.lastUpdated).getTime() / Date.now()) * 0.1;
                    
      const scoreB = (factB.relevanceScore || 0.5) * 0.4 + 
                    (factB.confidence || 0.5) * 0.3 + 
                    (factB.occurrences || 1) / 10 * 0.2 +
                    (new Date(factB.lastAccessed || factB.lastUpdated).getTime() / Date.now()) * 0.1;
      
      return scoreA - scoreB; // Sort ascending, so lowest scores first (to be removed)
    });
    
    // Remove lowest-scoring facts
    const keysToRemove = sortedFactKeys.slice(0, factKeys.length - MAX_FACTS_PER_USER);
    keysToRemove.forEach(key => {
      logger.debug(`Removing fact "${key}" to maintain limit of ${MAX_FACTS_PER_USER} facts`);
      
      // Add to history before removing
      userFactsObj.factHistory.push({
        fact: key,
        oldValue: userFactsObj.facts[key].value,
        newValue: null,
        confidence: userFactsObj.facts[key].confidence,
        timestamp: new Date().toISOString(),
        reason: 'pruned'
      });
      
      delete userFactsObj.facts[key];
    });
  }
  
  // Limit the history to the most recent 100 entries (increased from 50)
  if (userFactsObj.factHistory.length > 100) {
    userFactsObj.factHistory = userFactsObj.factHistory.slice(-100);
  }
  
  // Ensure the user facts entry exists and is saved
  db.data.userFacts[userId] = userFactsObj;
  await db.write();
  
  // Return the processed facts
  return {
    relevantFacts: extractionResult.relevantFacts,
    newFacts,
    updatedFacts,
    relationships: processedRelationships,
    globalFacts,
    success: true
  };
}

/**
 * Extract and save global knowledge from relevant facts
 * @param {Object} relevantFacts - Relevant facts from extraction result
 * @param {Array} existingGlobalFacts - List of global facts already processed
 * @returns {Promise<void>}
 */
async function extractGlobalKnowledgeFromRelevantFacts(relevantFacts, existingGlobalFacts = []) {
  try {
    if (!relevantFacts || Object.keys(relevantFacts).length === 0) {
      return;
    }
    
    const db = getDb();
    let globalFactsAdded = 0;
    
    // Patterns that likely indicate global knowledge
    const globalFactPatterns = [
      /^(capital|population|area|president|prime minister|language|currency|timezone|location) of/i,
      /^(is|was|are|were) (a|an|the)/i,
      /^(founded|established|created|discovered|invented)/i,
      /^(height|depth|size|length|width) of/i,
      /^(largest|smallest|tallest|deepest|oldest|newest)/i,
      /^(distance|time) (between|from|to)/i,
      /^(headquarters|offices|branches) (of|in)/i,
      /^(ceo|founder|creator|inventor|author) of/i
    ];
    
    // Words that often indicate factual/global knowledge
    const factualIndicators = [
      'fact', 'officially', 'scientifically', 'technically', 'actually',
      'historically', 'typically', 'generally', 'universally', 'internationally',
      'approximately', 'estimated', 'recognized', 'defined', 'classified',
      'standard', 'common', 'established', 'known', 'verified'
    ];
    
    // Check each relevant fact for potential global knowledge
    for (const [factKey, factData] of Object.entries(relevantFacts)) {
      // Skip facts already identified as global facts
      if (existingGlobalFacts.some(f => f.key === factKey)) {
        continue;
      }
      
      let isGlobalFact = false;
      const normalizedKey = factKey.toLowerCase().trim();
      const normalizedValue = factData.value.toLowerCase().trim();
      
      // Check if key matches global fact patterns
      if (globalFactPatterns.some(pattern => pattern.test(normalizedKey))) {
        isGlobalFact = true;
      }
      
      // Check if value contains factual indicators
      if (!isGlobalFact && factualIndicators.some(indicator => 
          normalizedValue.includes(indicator))) {
        isGlobalFact = true;
      }
      
      // Check for date, numerical, or measurement patterns in the value (often indicate factual info)
      const hasNumbers = /\d+/.test(normalizedValue);
      const hasMeasurements = /\d+\s*(km|m|kg|lb|ft|mile|year|month|century|decade)/i.test(normalizedValue);
      const hasDate = /\b(in|since|from|until)\s+\d{4}\b/.test(normalizedValue) || 
                     /\b\d{4}\b-\b\d{4}\b/.test(normalizedValue);
      
      if (!isGlobalFact && (hasMeasurements || hasDate || 
          (hasNumbers && factData.confidence > 0.85))) {
        isGlobalFact = true;
      }
      
      // If identified as global fact, add it to the global facts database
      if (isGlobalFact) {
        // Format the key to be more canonical for global facts
        const formattedKey = normalizedKey
          .replace(/\s+/g, '_')
          .replace(/[^\w_]/g, '')
          .toLowerCase();
        
        // Determine appropriate category
        let category = factData.category;
        if (!category) {
          // Try to infer a better category for global facts
          if (hasDate) category = 'historical';
          else if (hasMeasurements) category = 'measurement';
          else if (/capital|city|country|region|continent/.test(normalizedKey)) category = 'geographic';
          else if (/person|people|born|died/.test(normalizedKey)) category = 'biographical';
          else if (/company|organization|corporation|business/.test(normalizedKey)) category = 'organizational';
          else if (/technology|software|programming|computer|game/.test(normalizedKey)) category = 'technological';
          else if (/hobby|interest|likes to|enjoys|passion|activity/.test(normalizedKey)) category = 'interest';
          else category = 'general_knowledge';
        }
        
        try {
        // Add to global facts
        await addGlobalFact(formattedKey, factData.value, {
          confidence: factData.confidence,
          category: category,
          tags: factData.tags || [],
          factType: factData.factType || FACT_TYPES.EXPLICIT,
          source: 'extracted_from_relevant_facts'
        });
        
        globalFactsAdded++;
        
        logger.info(`Added global fact from relevant facts: "${formattedKey}" = "${factData.value}"`);
        } catch (addError) {
          logger.warning(`Failed to add global fact "${formattedKey}": ${addError.message}`);
        }
      }
    }
    
    if (globalFactsAdded > 0) {
      logger.success(`Added ${globalFactsAdded} global facts extracted from relevant facts`);
    }
  } catch (error) {
    logger.error('Error extracting global knowledge from relevant facts', error);
  }
}

/**
 * Get relevant facts for a message from all participants in the conversation
 * @param {string} userId - Primary user ID
 * @param {string} chatId - Chat ID
 * @param {Object} relevantFactsObj - Relevant facts object from Gemini
 * @returns {Array} - Formatted relevant facts for context
 */
function getRelevantFactsForMessage(userId, chatId, relevantFactsObj) {
  const db = getDb();
  
  // Get relevant facts for the primary user
  const primaryUserFacts = formatRelevantFacts(userId, relevantFactsObj);
  
  // Get global facts that might be relevant
  const relevantGlobalFacts = getRelevantGlobalFacts(relevantFactsObj);
  
  // NEW: Get relevant web search results and content
  const relevantKeywords = extractKeywordsFromRelevantFacts(relevantFactsObj);
  const relevantWebResults = getRelevantWebResults(relevantKeywords);
  const relevantWebContent = getRelevantWebContent(relevantKeywords);
  
  // Update usage metrics for relevant facts
  updateRelevanceMetrics(userId, relevantFactsObj);
  
  // Find related facts based on the relevant facts
  let relatedFacts = [];
  Object.keys(relevantFactsObj).forEach(factKey => {
    const related = findRelatedFacts(userId, factKey);
    if (related.length > 0) {
      relatedFacts = [...relatedFacts, ...related.map(fact => {
        const reasoning = fact.reasoning ? ` (${fact.reasoning})` : ` (related to ${factKey})`;
        return `${fact.key}: ${fact.value}${reasoning}`;
      })];
    }
  });
  
  // Deduplicate related facts
  relatedFacts = [...new Set(relatedFacts)];
  
  // Apply AI-suggested enhancements to each fact if available
  const enhancedFacts = primaryUserFacts.map(factStr => {
    // Extract the key from the string
    const key = factStr.split(':')[0].trim();
    
    // Check if this fact has reasoning
    if (relevantFactsObj[key] && relevantFactsObj[key].reasoning) {
      return `${factStr} (Reasoning: ${relevantFactsObj[key].reasoning})`;
    }
    
    // Check if this fact has relevance score
    if (relevantFactsObj[key] && relevantFactsObj[key].relevance) {
      const relevanceInfo = relevantFactsObj[key].relevance > 0.8 ? 
        " (highly relevant)" : relevantFactsObj[key].relevance > 0.6 ? 
        " (moderately relevant)" : " (somewhat relevant)";
      return `${factStr}${relevanceInfo}`;
    }
    
    return factStr;
  });
  
  // For private chats, just return the primary user's facts, related facts, global facts, and web results
  if (!chatId.endsWith('@g.us')) {
    return [
      ...enhancedFacts, 
      ...relatedFacts, 
      ...relevantGlobalFacts,
      ...relevantWebResults,
      ...relevantWebContent
    ];
  }
  
  // For group chats, include relevant facts from other participants
  const otherParticipantsFacts = [];
  
  // Get all participants in this chat
  if (db.data.conversations[chatId] && db.data.conversations[chatId].participants) {
    const participants = Object.keys(db.data.conversations[chatId].participants)
      .filter(id => id !== userId && id !== process.env.BOT_ID);
    
    // Get recent speakers (last 5 messages)
    const recentSpeakers = new Set();
    if (db.data.conversations[chatId].messages) {
      db.data.conversations[chatId].messages
        .slice(-5)
        .forEach(msg => {
          if (msg.sender && msg.sender !== userId && msg.sender !== process.env.BOT_ID) {
            recentSpeakers.add(msg.sender);
          }
        });
    }
    
    // Prioritize recent speakers
    const prioritizedParticipants = [
      ...Array.from(recentSpeakers),
      ...participants.filter(id => !recentSpeakers.has(id))
    ];
    
    // Extract topic categories from relevant facts to find similar facts from others
    const relevantCategories = new Set(
      Object.values(relevantFactsObj)
        .map(fact => fact.category)
        .filter(Boolean)
    );
    
    // Extract relevant tags from the facts
    const relevantTags = new Set();
    Object.values(relevantFactsObj).forEach(fact => {
      if (fact.tags && Array.isArray(fact.tags)) {
        fact.tags.forEach(tag => relevantTags.add(tag));
      }
    });
    
    // Get relevant facts for each participant (limit to 3 participants)
    prioritizedParticipants.slice(0, 3).forEach(participantId => {
      if (db.data.userFacts[participantId]) {
        const participantName = db.data.conversations[chatId]?.participants[participantId]?.name || 
                             participantId.split('@')[0];
        
        // Get high-confidence facts with preference for same categories as current context
        const userFacts = db.data.userFacts[participantId].facts;
        
        const categorizedFacts = Object.entries(userFacts)
          .filter(([_, fact]) => fact.confidence >= 0.85)
          .sort((a, b) => {
            // Prioritize facts in relevant categories or with relevant tags
            const aInRelevantCategory = relevantCategories.has(a[1].category) ? 1 : 0;
            const bInRelevantCategory = relevantCategories.has(b[1].category) ? 1 : 0;
            
            // Check if the fact has any relevant tags
            const aHasRelevantTags = a[1].tags?.some(tag => relevantTags.has(tag)) ? 1 : 0;
            const bHasRelevantTags = b[1].tags?.some(tag => relevantTags.has(tag)) ? 1 : 0;
            
            // Score based on relevance to current context
            const aScore = aInRelevantCategory + aHasRelevantTags;
            const bScore = bInRelevantCategory + bHasRelevantTags;
            
            if (aScore !== bScore) {
              return bScore - aScore;
            }
            
            // If equally relevant, sort by confidence
            return b[1].confidence - a[1].confidence;
          })
          .slice(0, 5)
          .map(([key, fact]) => {
            const categoryLabel = fact.category ? ` (${fact.category})` : '';
            return `${participantName}: ${key} = ${fact.value}${categoryLabel}`;
          });
        
        otherParticipantsFacts.push(...categorizedFacts);
      }
    });
  }
  
  // Return combined facts from all sources, prioritizing facts from primary user
  return [
    ...enhancedFacts,
    ...relevantGlobalFacts,
    ...relatedFacts,
    ...otherParticipantsFacts,
    ...relevantWebResults,
    ...relevantWebContent
  ];
}

/**
 * Extract keywords from relevant facts for web search context retrieval
 * @param {Object} relevantFactsObj - Relevant facts object 
 * @returns {Array} - Array of keywords for searching
 */
function extractKeywordsFromRelevantFacts(relevantFactsObj) {
  const keywords = new Set();
  
  // Extract keywords from fact keys and values
  Object.entries(relevantFactsObj).forEach(([key, fact]) => {
    // Extract from key
    const keyWords = key.toLowerCase().split(/[_\s]+/).filter(word => word.length > 3);
    keyWords.forEach(word => keywords.add(word));
    
    // Extract from value
    if (fact.value) {
      const valueWords = fact.value.toLowerCase().split(/\s+/).filter(word => word.length > 3);
      valueWords.forEach(word => keywords.add(word));
    }
    
    // Add categories and tags if available
    if (fact.category) {
      keywords.add(fact.category);
    }
    
    if (fact.tags && Array.isArray(fact.tags)) {
      fact.tags.forEach(tag => keywords.add(tag));
    }
  });
  
  // Remove common stop words
  const stopWords = [
    'the', 'and', 'that', 'have', 'this', 'from', 'with', 'but', 'not', 'atau',
    'dan', 'yang', 'untuk', 'dari', 'pada', 'dengan', 'tetapi', 'tidak'
  ];
  
  return [...keywords].filter(word => !stopWords.includes(word));
}

/**
 * Get relevant web search results based on keywords
 * @param {Array} keywords - Keywords to match against stored search results
 * @param {Object} options - Additional options for retrieval
 * @returns {Array} - Formatted relevant web search results
 */
function getRelevantWebResults(keywords, options = {}) {
  try {
    const db = getDb();
    const {
      maxResults = 3,
      maxAgeDays = 7,
      includeAiSummary = false
    } = options;
    
    if (!db.data.webSearchHistory || Object.keys(db.data.webSearchHistory).length === 0) {
      return [];
    }
    
    // Convert keywords to array if needed
    const keywordArray = Array.isArray(keywords) ? keywords : [keywords];
    if (keywordArray.length === 0) return [];
    
    // Get timestamp for age filtering
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const oldestAllowed = Date.now() - maxAgeMs;
    
    // Create a simple scoring system
    const scoredResults = [];
    
    // Score each search result based on keyword matches
    Object.entries(db.data.webSearchHistory).forEach(([searchId, searchData]) => {
      // Skip old search results
      const searchTime = new Date(searchData.timestamp).getTime();
      if (searchTime < oldestAllowed) return;
      
      let score = 0;
      let matchCount = 0;
      
      // Score based on the search query
      const queryWords = searchData.query.toLowerCase().split(/\s+/);
      keywordArray.forEach(keyword => {
        if (queryWords.includes(keyword.toLowerCase())) {
          score += 3; // Higher score for matching the query directly
          matchCount++;
        }
      });
      
      // Score based on search results content
      if (searchData.results && Array.isArray(searchData.results)) {
        searchData.results.forEach((result, index) => {
          // First results are more relevant, so give higher score
          const positionMultiplier = 1 - (index * 0.1);
          
          keywordArray.forEach(keyword => {
            const lowerKeyword = keyword.toLowerCase();
            // Check title
            if (result.title && result.title.toLowerCase().includes(lowerKeyword)) {
              score += 2 * positionMultiplier;
              matchCount++;
            }
            
            // Check snippet
            if (result.snippet && result.snippet.toLowerCase().includes(lowerKeyword)) {
              score += 1 * positionMultiplier;
              matchCount++;
            }
          });
        });
      }
      
      // Score based on AI summary if available
      if (searchData.aiSummary && includeAiSummary) {
        const summaryText = searchData.aiSummary.toLowerCase();
        keywordArray.forEach(keyword => {
          const lowerKeyword = keyword.toLowerCase();
          if (summaryText.includes(lowerKeyword)) {
            // AI summaries are considered high-quality matches
            score += 4;
            matchCount++;
          }
        });
      }
      
      // Boost score for enhanced searches
      if (searchData.enhancedSearch) {
        score *= 1.2;
      }
      
      // Only include if there's at least one match
      if (matchCount > 0) {
        scoredResults.push({
          id: searchId,
          score,
          searchData,
          matchCount,
          recency: searchTime
        });
      }
    });
    
    // Sort by score (higher first) and recency (newer first)
    scoredResults.sort((a, b) => {
      // Score is primary factor
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // Recency is secondary factor
      return b.recency - a.recency;
    });
    
    // Get top results and format for context
    const topResults = scoredResults.slice(0, maxResults);
    
    // Format the results for inclusion in the context
    return topResults.map(result => {
      const searchData = result.searchData;
      const formattedDate = new Date(searchData.timestamp).toLocaleDateString();
      
      // Format the top 3 results
      const topSearchResults = (searchData.results || []).slice(0, 3).map((searchResult, index) => {
        return `  ${index+1}. ${searchResult.title}`;
      }).join('\n');
      
      // If AI summary is available and requested, include a snippet
      let aiSummarySnippet = '';
      if (includeAiSummary && searchData.aiSummary) {
        const summaryPreview = searchData.aiSummary.substring(0, 150);
        aiSummarySnippet = `\nAI Summary: ${summaryPreview}${searchData.aiSummary.length > 150 ? '...' : ''}`;
      }
      
      return `WEB SEARCH (${formattedDate}): "${searchData.query}" found:\n${topSearchResults}${aiSummarySnippet}`;
    });
  } catch (error) {
    logger.error('Error getting relevant web search results', error);
    return [];
  }
}

/**
 * Get a cached search result by exact query
 * @param {string} query - The search query
 * @param {Object} options - Additional options
 * @returns {Object|null} - The cached search data or null if not found
 */
function getCachedWebSearch(query, options = {}) {
  try {
    const db = getDb();
    const {
      maxAgeHours = 48, // Default to 48 hours cache validity
      exactMatchOnly = false
    } = options;
    
    if (!db.data.webSearchHistory || Object.keys(db.data.webSearchHistory).length === 0) {
      return null;
    }
    
    // Normalize the query
    const normalizedQuery = query.toLowerCase().trim();
    
    // Get timestamp for age filtering
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const oldestAllowed = Date.now() - maxAgeMs;
    
    let bestMatch = null;
    let highestSimilarity = 0;
    
    // Check all stored searches
    Object.entries(db.data.webSearchHistory).forEach(([searchId, searchData]) => {
      // Skip expired cache entries
      const searchTime = new Date(searchData.timestamp).getTime();
      if (searchTime < oldestAllowed) return;
      
      const cachedQuery = searchData.query.toLowerCase().trim();
      
      // If exact match only, check for exact match
      if (exactMatchOnly) {
        if (cachedQuery === normalizedQuery) {
          bestMatch = searchData;
          highestSimilarity = 1.0;
        }
        return;
      }
      
      // Calculate similarity
      let similarity = 0;
      
      // Exact match
      if (cachedQuery === normalizedQuery) {
        similarity = 1.0;
      } 
      // Partial match
      else if (cachedQuery.includes(normalizedQuery) || normalizedQuery.includes(cachedQuery)) {
        // Calculate a partial similarity score based on string length ratio
        const lengthRatio = Math.min(cachedQuery.length, normalizedQuery.length) / 
                           Math.max(cachedQuery.length, normalizedQuery.length);
        
        similarity = 0.8 * lengthRatio;
      }
      // Word-based similarity
      else {
        const queryWords = new Set(normalizedQuery.split(/\s+/).filter(w => w.length > 2));
        const cachedWords = new Set(cachedQuery.split(/\s+/).filter(w => w.length > 2));
        
        // Calculate Jaccard similarity
        const intersection = new Set([...queryWords].filter(x => cachedWords.has(x)));
        const union = new Set([...queryWords, ...cachedWords]);
        
        similarity = union.size > 0 ? intersection.size / union.size : 0;
      }
      
      // Prioritize enhanced searches with a small boost
      if (searchData.enhancedSearch) {
        similarity *= 1.1;
      }
      
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = searchData;
      }
    });
    
    // Return the best match if it's above the threshold
    const threshold = exactMatchOnly ? 1.0 : 0.7;
    return highestSimilarity >= threshold ? bestMatch : null;
  } catch (error) {
    logger.error('Error retrieving cached web search', error);
    return null;
  }
}

/**
 * Get relevant web content based on keywords
 * @param {Array} keywords - Keywords to match against stored web content
 * @param {Object} options - Additional options for retrieval
 * @returns {Array} - Formatted relevant web content
 */
function getRelevantWebContent(keywords, options = {}) {
  try {
    const db = getDb();
    const {
      maxResults = 2,
      maxAgeDays = 14
    } = options;
    
    if (!db.data.webContent || Object.keys(db.data.webContent).length === 0) {
      return [];
    }
    
    // Convert keywords to array if needed
    const keywordArray = Array.isArray(keywords) ? keywords : [keywords];
    if (keywordArray.length === 0) return [];
    
    // Get timestamp for age filtering
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const oldestAllowed = Date.now() - maxAgeMs;
    
    // Create a simple scoring system
    const scoredContent = [];
    
    // Score each web content based on keyword matches
    Object.entries(db.data.webContent).forEach(([contentId, contentData]) => {
      // Skip old content
      const contentTime = new Date(contentData.timestamp).getTime();
      if (contentTime < oldestAllowed) return;
      
      let score = 0;
      let matchCount = 0;
      
      // Score based on title
      keywordArray.forEach(keyword => {
        if (contentData.title && contentData.title.toLowerCase().includes(keyword.toLowerCase())) {
          score += 3; // Higher score for matching the title
          matchCount++;
        }
      });
      
      // Score based on content 
      if (contentData.truncatedContent) {
        const contentText = contentData.truncatedContent.toLowerCase();
        keywordArray.forEach(keyword => {
          // Count occurrences (more occurrences = higher score)
          const regex = new RegExp(keyword.toLowerCase(), 'g');
          const occurrences = (contentText.match(regex) || []).length;
          if (occurrences > 0) {
            // Score increases with more occurrences but with diminishing returns
            score += Math.min(occurrences, 5);
            matchCount++;
          }
        });
      }
      
      // Only include if there's at least one match
      if (matchCount > 0) {
        scoredContent.push({
          id: contentId,
          score,
          contentData,
          matchCount,
          recency: contentTime
        });
      }
    });
    
    // Sort by score (higher first) and recency (newer first)
    scoredContent.sort((a, b) => {
      // Score is primary factor
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // Recency is secondary factor
      return b.recency - a.recency;
    });
    
    // Get top results and format for context
    const topContent = scoredContent.slice(0, maxResults);
    
    // Format the results for inclusion in the context
    return topContent.map(result => {
      const contentData = result.contentData;
      const formattedDate = new Date(contentData.timestamp).toLocaleDateString();
      
      // Create a brief excerpt from the content (first 150 chars)
      const excerpt = contentData.truncatedContent?.substring(0, 150) + '...';
      
      return `WEB CONTENT (${formattedDate}): ${contentData.title}\nExcerpt: ${excerpt}\nSource: ${contentData.url}`;
    });
  } catch (error) {
    logger.error('Error getting relevant web content', error);
    return [];
  }
}

/**
 * Update the relevance metrics for facts that were found relevant
 * @param {string} userId - User ID
 * @param {Object} relevantFactsObj - Relevant facts object from Gemini
 * @returns {Promise<void>}
 */
async function updateRelevanceMetrics(userId, relevantFactsObj) {
  try {
    const db = getDb();
    let needsUpdate = false;
    
    // Skip if no relevant facts
    if (!relevantFactsObj || Object.keys(relevantFactsObj).length === 0) {
      return;
    }
    
    // Get current time
    const now = new Date().toISOString();
    
    // Process user facts
    if (db.data.userFacts[userId] && db.data.userFacts[userId].facts) {
      Object.entries(relevantFactsObj).forEach(([factKey, relevantFact]) => {
        if (db.data.userFacts[userId].facts[factKey]) {
          const fact = db.data.userFacts[userId].facts[factKey];
          
          // Update usage metrics
          fact.lastUsed = now;
          fact.usageCount = (fact.usageCount || 0) + 1;
          
          // Update relevance metrics
          fact.relevanceScore = Math.min(1.0, (fact.relevanceScore || 0.5) + 0.05);
          
          // Save reasoning if provided
          if (relevantFact.reasoning && relevantFact.reasoning !== 'Relevant to current context') {
            // Store recent reasonings with timestamps
            if (!fact.reasoningHistory) {
              fact.reasoningHistory = [];
            }
            
            // Add to reasoning history
            fact.reasoningHistory.push({
              reasoning: relevantFact.reasoning,
              timestamp: now
            });
            
            // Limit history size
            if (fact.reasoningHistory.length > 5) {
              fact.reasoningHistory = fact.reasoningHistory.slice(-5);
            }
            
            fact.lastReasoning = relevantFact.reasoning;
          }
          
          needsUpdate = true;
        }
      });
    }
    
    // Process global facts
    // Find relevant global facts from the ones retrieved for this conversation
    const globalFactsRetrieved = getRelevantGlobalFacts(relevantFactsObj);
    globalFactsRetrieved.forEach(globalFactStr => {
      // Extract the key from the formatted string
      // Format is "GLOBAL: key: value"
      const match = globalFactStr.match(/^GLOBAL:\s+([^:]+):/);
      if (match && match[1]) {
        const normalizedKey = match[1].trim().replace(/\s+/g, '_');
        
        if (db.data.globalFacts.facts[normalizedKey]) {
          const globalFact = db.data.globalFacts.facts[normalizedKey];
          
          // Update usage metrics
          globalFact.lastUsed = now;
          globalFact.usageCount = (globalFact.usageCount || 0) + 1;
          
          // Create relevance tracking if it doesn't exist
          if (!db.data.globalFacts.facts[normalizedKey].relevanceStats) {
            db.data.globalFacts.facts[normalizedKey].relevanceStats = {
              usageHistory: [],
              topContexts: []
            };
          }
          
          // Add to usage history
          db.data.globalFacts.facts[normalizedKey].relevanceStats.usageHistory.push({
            userId: userId,
            timestamp: now
          });
          
          // Limit history size
          if (db.data.globalFacts.facts[normalizedKey].relevanceStats.usageHistory.length > 10) {
            db.data.globalFacts.facts[normalizedKey].relevanceStats.usageHistory = 
              db.data.globalFacts.facts[normalizedKey].relevanceStats.usageHistory.slice(-10);
          }
          
          needsUpdate = true;
        }
      }
    });
    
    // Save if any changes were made
    if (needsUpdate) {
      await db.write();
      logger.debug(`Updated relevance metrics for ${Object.keys(relevantFactsObj).length} facts`);
    }
  } catch (error) {
    logger.error('Error updating relevance metrics', error);
  }
}

/**
 * Format relevant facts for a specific user
 * @param {string} userId - User ID
 * @param {Object} relevantFactsObj - Relevant facts object from Gemini
 * @returns {Array} - Formatted relevant facts for context
 */
function formatRelevantFacts(userId, relevantFactsObj) {
  // Convert the relevant facts object to an array of formatted strings
  const relevantFactsArray = Object.entries(relevantFactsObj).map(([key, fact]) => {
    const categoryLabel = fact.category ? ` (${fact.category})` : '';
    return `${key}: ${fact.value}${categoryLabel}`;
  });
  
  return relevantFactsArray;
}

/**
 * Add facts about image recognition
 * @param {string} userId - User ID
 * @param {Object} recognitionData - Data from image recognition
 */
async function addImageRecognitionFacts(userId, recognitionData) {
  try {
    const db = getDb();
    
    if (!db.data.userFacts[userId]) {
      db.data.userFacts[userId] = {
        facts: {},
        factHistory: []
      };
    }
    
    const userFactsObj = db.data.userFacts[userId];
    const timestamp = new Date().toISOString();
    
    // Add facts based on recognition data
    if (recognitionData.faces && recognitionData.faces.length > 0) {
      userFactsObj.facts['has_face_image'] = {
        value: 'true',
        confidence: 0.95,
        lastUpdated: timestamp,
        source: 'image-recognition',
        createdAt: userFactsObj.facts['has_face_image']?.createdAt || timestamp
      };
      
      // Record that we've seen the user's face
      userFactsObj.facts['face_last_seen'] = {
        value: timestamp,
        confidence: 0.95,
        lastUpdated: timestamp,
        source: 'image-recognition',
        createdAt: userFactsObj.facts['face_last_seen']?.createdAt || timestamp
      };
    }
    
    // Add information about the type of images the user shares
    if (recognitionData.imageType) {
      const key = `shares_${recognitionData.imageType}_images`;
      userFactsObj.facts[key] = {
        value: 'true',
        confidence: 0.9,
        lastUpdated: timestamp,
        source: 'image-recognition',
        createdAt: userFactsObj.facts[key]?.createdAt || timestamp
      };
    }
    
    // Track most recent image content
    if (recognitionData.description) {
      userFactsObj.facts['recent_image_content'] = {
        value: recognitionData.description,
        confidence: 0.85,
        lastUpdated: timestamp,
        source: 'image-recognition',
        createdAt: userFactsObj.facts['recent_image_content']?.createdAt || timestamp
      };
    }
    
    // Save changes
    await db.write();
    
    logger.info(`Added image recognition facts for user ${userId.split('@')[0]}`);
  } catch (error) {
    logger.error('Error adding image recognition facts', error);
  }
}

/**
 * Store image embedding in the database
 * @param {string} imageId - Image ID (analysis ID)
 * @param {Array} embedding - Embedding vector
 * @param {Array} faceEmbeddings - Face embedding vectors
 * @param {Object} metadata - Additional metadata
 */
async function storeImageEmbedding(imageId, embedding, faceEmbeddings = [], metadata = {}) {
  try {
    const db = getDb();
    
    if (!db.data.imageEmbeddings) {
      db.data.imageEmbeddings = {};
    }
    
    db.data.imageEmbeddings[imageId] = {
      id: imageId,
      embedding,
      faceEmbeddings,
      timestamp: new Date().toISOString(),
      metadata
    };
    
    await db.write();
    
    logger.success(`Stored image embedding for image ${imageId}`);
  } catch (error) {
    logger.error('Error storing image embedding', error);
  }
}

/**
 * Calculate similarity between two vectors (cosine similarity)
 * @param {Array} vec1 - First vector
 * @param {Array} vec2 - Second vector
 * @returns {number} - Similarity score (0-1)
 */
function calculateSimilarity(vec1, vec2) {
  // Skip if any vector is empty
  if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
    return 0;
  }
  
  // Both vectors must have the same length
  if (vec1.length !== vec2.length) {
    return 0;
  }
  
  // Calculate cosine similarity
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
  }
  
  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);
  
  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }
  
  return dotProduct / (mag1 * mag2);
}

/**
 * Find similar images based on embeddings
 * @param {Array} queryEmbedding - Query embedding vector
 * @param {Object} options - Search options
 * @returns {Array} - Similar images sorted by similarity
 */
function findSimilarImages(queryEmbedding, options = {}) {
  try {
    const db = getDb();
    
    if (!db.data.imageEmbeddings) {
      return [];
    }
    
    const {
      threshold = FACT_SIMILARITY_THRESHOLD,
      limit = 5,
      chatId = null,
      userId = null,
      timeframe = null // in milliseconds
    } = options;
    
    // Calculate similarity scores for all images
    const similarities = Object.entries(db.data.imageEmbeddings).map(([id, data]) => {
      // Skip if no embedding
      if (!data.embedding || data.embedding.length === 0) {
        return null;
      }
      
      // Filter by chat ID if specified
      if (chatId && data.metadata.chatId && data.metadata.chatId !== chatId) {
        return null;
      }
      
      // Filter by user ID if specified
      if (userId && data.metadata.sender && data.metadata.sender !== userId) {
        return null;
      }
      
      // Filter by timeframe if specified
      if (timeframe) {
        const imageTimestamp = new Date(data.timestamp).getTime();
        const now = Date.now();
        if (now - imageTimestamp > timeframe) {
          return null;
        }
      }
      
      // Calculate similarity score
      const similarity = calculateSimilarity(queryEmbedding, data.embedding);
      
      return {
        id: id,
        similarity,
        metadata: data.metadata,
        timestamp: data.timestamp
      };
    }).filter(item => item !== null && item.similarity >= threshold);
    
    // Sort by similarity (highest first) and limit results
    return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  } catch (error) {
    logger.error('Error finding similar images', error);
    return [];
  }
}

/**
 * Find faces that match the given face embedding
 * @param {Array} faceEmbedding - Face embedding vector
 * @param {Object} options - Search options
 * @returns {Array} - Matching faces sorted by similarity
 */
function findMatchingFaces(faceEmbedding, options = {}) {
  try {
    const db = getDb();
    
    if (!db.data.imageEmbeddings) {
      return [];
    }
    
    const {
      threshold = 0.8, // Higher threshold for face matching
      limit = 5
    } = options;
    
    const matches = [];
    
    // Search through all images with face embeddings
    Object.entries(db.data.imageEmbeddings).forEach(([imageId, imageData]) => {
      if (!imageData.faceEmbeddings || imageData.faceEmbeddings.length === 0) {
        return;
      }
      
      // Check each face in the image
      imageData.faceEmbeddings.forEach((storedFace, faceIndex) => {
        const similarity = calculateSimilarity(faceEmbedding, storedFace);
        
        if (similarity >= threshold) {
          matches.push({
            imageId,
            faceIndex,
            similarity,
            metadata: imageData.metadata,
            timestamp: imageData.timestamp
          });
        }
      });
    });
    
    // Sort by similarity (highest first) and limit results
    return matches.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  } catch (error) {
    logger.error('Error finding matching faces', error);
    return [];
  }
}

/**
 * Generate a simple text embedding using hashing (placeholder for more sophisticated methods)
 * @param {string} text - Text to generate embedding for
 * @param {number} dimensions - Embedding dimensions
 * @returns {Array} - Embedding vector
 */
function generateTextEmbedding(text, dimensions = 512) {
  try {
    // This is a very simple placeholder implementation
    // In a real system, you would use a proper embedding model
    
    // Create a hash of the text
    const hash = crypto.createHash('sha512').update(text).digest('hex');
    
    // Convert hash to an array of numbers
    const embedding = [];
    for (let i = 0; i < dimensions; i++) {
      // Use modulo to ensure we don't exceed the hash length
      const hashIndex = i % (hash.length - 1);
      // Convert hex pair to number and normalize to range [-1, 1]
      const value = (parseInt(hash.substring(hashIndex, hashIndex + 2), 16) / 255) * 2 - 1;
      embedding.push(value);
    }
    
    // Normalize the embedding vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) {
      return embedding; // Return zero vector
    }
    
    return embedding.map(val => val / magnitude);
  } catch (error) {
    logger.error('Error generating text embedding', error);
    return Array(dimensions).fill(0); // Return zero vector on error
  }
}

/**
 * Find images similar to a text description
 * @param {string} description - Text description to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Similar images sorted by similarity
 */
async function findImagesByDescription(description, options = {}) {
  try {
    const {
      threshold = 0.6,
      limit = 5,
      chatId = null,
      userId = null,
      timeframe = null // in milliseconds, e.g., 7 * 24 * 60 * 60 * 1000 for 7 days
    } = options;
    
    logger.debug(`Searching for images matching description: "${description}"`);
    
    // Generate embedding for the description
    const queryEmbedding = generateTextEmbedding(description);
    
    // Find similar images
    const similarImages = findSimilarImages(queryEmbedding, {
      threshold,
      limit,
      chatId,
      userId,
      timeframe
    });
    
    // Get the full analysis for each image
    const db = getDb();
    const results = [];
    
    for (const match of similarImages) {
      if (match.id && db.data.imageAnalysis && db.data.imageAnalysis[match.id]) {
        const analysis = db.data.imageAnalysis[match.id];
        
        results.push({
          id: match.id,
          similarity: match.similarity,
          analysis: analysis.analysis,
          summary: analysis.summary,
          sender: analysis.sender,
          senderName: analysis.senderName,
          timestamp: analysis.timestamp,
          topics: analysis.topics || [],
          entities: analysis.entities || []
        });
      }
    }
    
    logger.info(`Found ${results.length} images matching description`);
    return results;
  } catch (error) {
    logger.error('Error finding images by description', error);
    return [];
  }
}

/**
 * Add or update a global fact
 * 
 * Global facts differ from user facts in that they represent general knowledge,
 * factual information, or information about places/entities rather than personal
 * user information. They are stored separately from user facts and are available
 * to all conversations.
 * 
 * Global facts can be used for:
 * - Geographic information (capitals, populations, locations)
 * - General knowledge (presidents, currencies, languages)
 * - Factual information relevant to all users
 * 
 * @param {string} factKey - The key for the fact
 * @param {string} factValue - The value of the fact
 * @param {Object|number} options - Options object or confidence value
 * @returns {Promise<boolean>} - Success status
 */
async function addGlobalFact(factKey, factValue, options = {}) {
  try {
    const db = getDb();
    
    // Ensure memory structure exists
    ensureMemoryStructure(db);
    
    const timestamp = new Date().toISOString();
    
    // Handle backward compatibility - if options is a number, it's the confidence
    let confidence = 0.95;
    let category = null;
    let tags = [];
    let factType = FACT_TYPES.EXPLICIT;
    let previous_value = null;
    
    if (typeof options === 'number') {
      confidence = options;
    } else if (typeof options === 'object') {
      confidence = options.confidence || 0.95;
      category = options.category || determineFactCategory(factKey, factValue);
      tags = options.tags || [];
      factType = options.factType || FACT_TYPES.EXPLICIT;
      previous_value = options.previous_value || null;
    }
    
    // Normalize the fact key and domain
    const normalizedKey = factKey.toLowerCase().trim().replace(/\s+/g, '_');
    
    // Extract domain from the fact key (e.g., 'capital_of_indonesia' -> 'indonesia')
    let domain = null;
    const domainMatch = normalizedKey.match(/(?:of|in|at|for)_([a-z_]+)$/);
    if (domainMatch && domainMatch[1]) {
      domain = domainMatch[1];
      
      // Add to domains registry for better categorization
      if (!db.data.factTaxonomies.domains[domain]) {
        db.data.factTaxonomies.domains[domain] = {
          name: domain.replace(/_/g, ' '),
          facts: []
        };
      }
      
      if (!db.data.factTaxonomies.domains[domain].facts.includes(normalizedKey)) {
        db.data.factTaxonomies.domains[domain].facts.push(normalizedKey);
      }
    }
    
    // Add to category registry
    if (category) {
      // Ensure categories object exists
      if (!db.data.globalFacts.categories) {
        db.data.globalFacts.categories = {};
      }
      
      // Create category array if it doesn't exist
      if (!db.data.globalFacts.categories[category]) {
        db.data.globalFacts.categories[category] = [];
      }
      
      if (!db.data.globalFacts.categories[category].includes(normalizedKey)) {
        db.data.globalFacts.categories[category].push(normalizedKey);
      }
    }
    
    // Get current value if exists
    const currentFact = db.data.globalFacts.facts[normalizedKey];
    
    // If fact exists and has higher confidence, don't update unless explicitly provided previous_value
    if (currentFact && currentFact.confidence > confidence && !previous_value) {
      logger.debug(`Not updating global fact "${normalizedKey}" as existing confidence is higher`);
      return false;
    }
    
    // If fact exists, add to history
    if (currentFact) {
      db.data.globalFacts.factHistory.push({
        fact: normalizedKey,
        oldValue: currentFact.value,
        newValue: factValue,
        oldConfidence: currentFact.confidence,
        newConfidence: confidence,
        previousTags: currentFact.tags || [],
        newTags: tags,
        category: category,
        timestamp
      });
    }
    
    // Update or add the fact with enhanced properties
    db.data.globalFacts.facts[normalizedKey] = {
      value: factValue,
      confidence,
      category: category,
      domain: domain,
      tags: tags,
      factType: factType,
      lastUpdated: timestamp,
      source: 'system',
      createdAt: currentFact?.createdAt || timestamp
    };
    
    // Add to knowledge graph for entity relationships
    if (domain) {
      // Ensure the entity exists in the knowledge graph
      if (!db.data.knowledgeGraphs.global[domain]) {
        db.data.knowledgeGraphs.global[domain] = {
          type: 'entity',
          properties: {},
          relationships: []
        };
      }
      
      // Extract property type from the fact key
      const propertyType = normalizedKey.replace(`_of_${domain}`, '').replace(`_in_${domain}`, '');
      
      // Add the property to the entity
      db.data.knowledgeGraphs.global[domain].properties[propertyType] = factValue;
    }
    
    // Save to database
    await db.write();
    
    logger.success(`Added/updated global fact: ${normalizedKey} = ${factValue}`);
    return true;
  } catch (error) {
    logger.error('Error adding global fact', error);
    return false;
  }
}

/**
 * Store web search results in the memory system
 * This makes search results available for future queries
 * 
 * @param {string} query - The search query
 * @param {Array} results - The search results
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} - Success status
 */
async function storeWebSearchResults(query, results, options = {}) {
  try {
    const db = getDb();
    
    // Ensure memory structure exists
    ensureMemoryStructure(db);
    
    // Create an ID for the search based on the query
    const searchId = `search_${Date.now()}`;
    const timestamp = new Date().toISOString();
    
    // Ensure web search structure exists
    if (!db.data.webSearchHistory) {
      db.data.webSearchHistory = {};
    }
    
    // Store the full search results with additional data for caching
    db.data.webSearchHistory[searchId] = {
      query,
      results,
      timestamp,
      formattedText: options.formattedText || null,
      // Store additional data for enhanced caching
      aiSummary: options.aiSummary || null,
      contentResults: options.contentResults || null,
      enhancedSearch: options.enhancedSearch || false
    };
    
    logger.info(`Stored web search results for query: "${query}" with ID: ${searchId}`);
    
    // Extract key facts from search results
    if (Array.isArray(results) && results.length > 0) {
      // Process each result into facts
      for (let i = 0; i < Math.min(results.length, 5); i++) {
        const result = results[i];
        
        // Create a normalized key from the query
        const normalizedQuery = query.toLowerCase().trim().replace(/\s+/g, '_');
        
        // Add main fact about the search result
        const factKey = `search_result_${i+1}_for_${normalizedQuery}`;
        const factValue = `${result.title}: ${result.snippet}`;
        
        // Calculate confidence based on result position (first results have higher confidence)
        const confidence = 0.95 - (i * 0.05);
        
        // Extract keywords for tags
        const keywords = extractKeywordsFromQuery(query);
        
        // Add the fact
        await addGlobalFact(factKey, factValue, {
          confidence,
          category: 'web_search',
          tags: [...keywords, 'web_search', 'search_result'],
          factType: 'EXPLICIT',
          source: 'web_search',
          metadata: {
            searchId,
            resultIndex: i,
            originalQuery: query,
            url: result.link,
            timestamp
          }
        });
        
        // Also store the URL as a separate fact for possible retrieval
        const urlFactKey = `url_for_${normalizedQuery}_result_${i+1}`;
        await addGlobalFact(urlFactKey, result.link, {
          confidence,
          category: 'web_search',
          tags: [...keywords, 'web_search', 'url'],
          factType: 'EXPLICIT'
        });
      }
      
      // If we have an AI summary, store it as a fact too
      if (options.aiSummary) {
        const summaryFactKey = `ai_summary_for_${query.toLowerCase().trim().replace(/\s+/g, '_')}`;
        
        await addGlobalFact(summaryFactKey, options.aiSummary.substring(0, 1000), {
          confidence: 0.98,
          category: 'web_search',
          tags: ['web_search', 'ai_summary', ...extractKeywordsFromQuery(query)],
          factType: 'EXPLICIT',
          metadata: {
            searchId,
            originalQuery: query,
            timestamp,
            isComplete: options.aiSummary.length <= 1000
          }
        });
        
        logger.info(`Stored AI summary for query: "${query}"`);
      }
      
      // Add a summary fact with a timestamp
      const summaryFactKey = `search_summary_for_${query.toLowerCase().trim().replace(/\s+/g, '_')}`;
      const summaryValue = `Search for "${query}" (${new Date().toLocaleString()}) found ${results.length} results: ${results.slice(0, 3).map(r => r.title).join(', ')}${results.length > 3 ? '...' : ''}`;
      
      await addGlobalFact(summaryFactKey, summaryValue, {
        confidence: 0.98,
        category: 'web_search',
        tags: ['web_search', 'summary', ...extractKeywordsFromQuery(query)],
        factType: 'EXPLICIT'
      });
      
      logger.success(`Extracted ${Math.min(results.length, 5)} facts from search results for "${query}"`);
    }
    
    // Save database
    await db.write();
    return true;
  } catch (error) {
    logger.error('Error storing web search results:', error);
    return false;
  }
}

/**
 * Store web content from a URL in the memory system
 * This makes the content available for future queries
 * 
 * @param {string} url - The URL of the content
 * @param {string} title - The page title
 * @param {string} content - The page content
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} - Success status
 */
async function storeWebContent(url, title, content, options = {}) {
  try {
    const db = getDb();
    
    // Ensure memory structure exists
    ensureMemoryStructure(db);
    
    // Create ID for the content
    const contentId = `content_${Date.now()}`;
    const timestamp = new Date().toISOString();
    
    // Ensure web content structure exists
    if (!db.data.webContent) {
      db.data.webContent = {};
    }
    
    // Store the full content
    db.data.webContent[contentId] = {
      url,
      title,
      content: content,
      timestamp,
      truncatedContent: content.length > 2000 ? content.substring(0, 2000) + '...' : content
    };
    
    logger.info(`Stored web content from URL: "${url}" with ID: ${contentId}`);
    
    // Extract domain for categorization
    let domain = '';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname.replace('www.', '');
    } catch (error) {
      logger.warning(`Could not parse domain from URL: ${url}`);
      domain = 'unknown_domain';
    }
    
    // Create a normalized key from the URL
    const normalizedUrl = url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[^\w]/g, '_')
      .substring(0, 50); // Limit length
    
    // Add main fact about the content
    const factKey = `web_content_from_${normalizedUrl}`;
    
    // Create a summary of the content
    const contentSummary = `${title}: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`;
    
    // Extract topics and entities from the content
    const topics = extractTopicsFromContent(content);
    const entities = extractEntitiesFromContent(content);
    
    // Add the content as a fact
    await addGlobalFact(factKey, contentSummary, {
      confidence: 0.9,
      category: 'web_content',
      tags: ['web_content', domain, ...topics],
      factType: 'EXPLICIT',
      source: 'web_content',
      metadata: {
        contentId,
        url,
        title,
        timestamp,
        topics,
        entities
      }
    });
    
    // Add title as a separate fact
    const titleFactKey = `title_of_${normalizedUrl}`;
    await addGlobalFact(titleFactKey, title, {
      confidence: 0.95,
      category: 'web_content',
      tags: ['web_content', 'title', domain],
      factType: 'EXPLICIT'
    });
    
    // For each main topic/entity, add a specific fact relating it to this content
    const importantTerms = [...new Set([...topics, ...entities])].slice(0, 5);
    for (const term of importantTerms) {
      const termFactKey = `${term}_mentioned_in_${normalizedUrl}`;
      await addGlobalFact(termFactKey, `${term} is discussed in "${title}" (${url})`, {
        confidence: 0.85,
        category: 'web_content',
        tags: ['web_content', term, domain],
        factType: 'EXPLICIT'
      });
    }
    
    // Save database
    await db.write();
    logger.success(`Extracted ${importantTerms.length + 2} facts from web content at "${url}"`);
    return true;
  } catch (error) {
    logger.error('Error storing web content:', error);
    return false;
  }
}

/**
 * Extract keywords from a search query for improved retrieval
 * @param {string} query - The search query
 * @returns {Array} - Array of keywords
 */
function extractKeywordsFromQuery(query) {
  // Remove common stop words and punctuation
  const stopWords = [
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 
    'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'of', 'from',
    'yang', 'adalah', 'dan', 'atau', 'tetapi', 'di', 'ke', 'dari', 'pada',
    'untuk', 'dengan', 'tentang'
  ];
  
  // Clean and tokenize the query
  const cleanQuery = query.toLowerCase().replace(/[^\w\s]/g, ' ');
  const words = cleanQuery.split(/\s+/).filter(word => word.length > 1);
  
  // Filter out stop words
  const keywords = words.filter(word => !stopWords.includes(word));
  
  // Return unique keywords
  return [...new Set(keywords)];
}

/**
 * Extract topics from web content for improved retrieval
 * @param {string} content - The web content
 * @returns {Array} - Array of topics
 */
function extractTopicsFromContent(content) {
  // Similar to extractTopicsFromAnalysis in aiService.js
  const topics = [];
  
  // Common topic categories to extract
  const topicPatterns = {
    'technology': /\b(?:teknologi|technology|software|programming|komputer|computer|aplikasi|application|digital|internet|online)\b/gi,
    'business': /\b(?:bisnis|business|ekonomi|economy|perusahaan|company|keuangan|finance|investasi|investment|pasar|market)\b/gi,
    'science': /\b(?:sains|science|penelitian|research|ilmiah|scientific|eksperimen|experiment|pengetahuan|knowledge)\b/gi,
    'health': /\b(?:kesehatan|health|medis|medical|dokter|doctor|penyakit|disease|obat|medicine|vaksin|vaccine)\b/gi,
    'education': /\b(?:pendidikan|education|sekolah|school|universitas|university|belajar|learning|mengajar|teaching|siswa|student)\b/gi,
    'politics': /\b(?:politik|politics|pemerintah|government|negara|country|presiden|president|menteri|minister|kebijakan|policy)\b/gi,
    'entertainment': /\b(?:hiburan|entertainment|film|movie|musik|music|seni|art|konser|concert|bioskop|cinema)\b/gi,
    'sports': /\b(?:olahraga|sports|sepak bola|football|basket|basketball|tenis|tennis|pertandingan|match|pemain|player)\b/gi,
    'travel': /\b(?:perjalanan|travel|wisata|tourism|liburan|vacation|hotel|penginapan|accommodation|pesawat|flight)\b/gi,
    'food': /\b(?:makanan|food|minuman|drink|resep|recipe|restoran|restaurant|masakan|cuisine|kuliner|culinary)\b/gi
  };
  
  // Extract topics based on patterns
  Object.entries(topicPatterns).forEach(([topic, pattern]) => {
    if (pattern.test(content)) {
      topics.push(topic);
    }
  });
  
  // Add additional topics based on clues in the content
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(content) || /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(content)) {
    topics.push('date');
  }
  
  if (/\$\d+|\d+ dollars|Rp\d+|\d+ rupiah/i.test(content)) {
    topics.push('money');
  }
  
  if (/\b\d{1,2}:\d{2}\b/.test(content)) {
    topics.push('time');
  }
  
  // Finally add a general 'web_content' topic
  topics.push('web_content');
  
  // Return unique topics
  return [...new Set(topics)];
}

/**
 * Extract entities from web content for improved retrieval
 * @param {string} content - The web content
 * @returns {Array} - Array of entities
 */
function extractEntitiesFromContent(content) {
  // Similar to extractEntitiesFromAnalysis in aiService.js
  const entities = [];
  
  // Common entity patterns to look for
  const patterns = [
    // People
    /\b(?:orang|seseorang|pria|wanita|laki-laki|perempuan|anak|person|man|woman|child|people)\b/gi,
    // Organizations
    /\b(?:perusahaan|organisasi|lembaga|institusi|yayasan|company|organization|institution|foundation)\b/gi,
    // Places
    /\b(?:tempat|lokasi|kota|desa|negara|provinsi|jalan|place|location|city|village|country|province|street)\b/gi,
    // Products
    /\b(?:produk|barang|layanan|jasa|product|service|item)\b/gi,
    // Events
    /\b(?:acara|kegiatan|festival|konferensi|seminar|event|activity|conference|meeting)\b/gi
  ];
  
  // Extract entities using patterns
  patterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      // Convert to lowercase and remove duplicates
      const uniqueMatches = [...new Set(matches.map(m => m.toLowerCase()))];
      entities.push(...uniqueMatches);
    }
  });
  
  // Check for proper nouns (simplified)
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const properNounPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  
  for (const sentence of sentences) {
    const matches = sentence.match(properNounPattern);
    if (matches) {
      // Filter out common capitalized words that aren't proper nouns
      const properNouns = matches.filter(word => 
        !['I', 'A', 'The', 'It', 'This', 'That', 'These', 'Those'].includes(word)
      );
      entities.push(...properNouns);
    }
  }
  
  // Return unique entities (limited to prevent excessive data)
  return [...new Set(entities)].slice(0, 15);
}

/**
 * Get facts for other participants in the same chat
 * @param {Object} db - Database instance
 * @param {string} chatId - Chat ID
 * @param {string} currentUserId - Current user ID (to exclude)
 * @returns {Object} - Facts for other participants
 */
function getOtherParticipantsFacts(db, chatId, currentUserId) {
  // Check if this is a group chat
  const isGroup = chatId.endsWith('@g.us');
  if (!isGroup) {
    return {}; // No other participants in private chats
  }
  
  // Get all participants in this chat
  if (!db.data.conversations[chatId] || !db.data.conversations[chatId].participants) {
    return {};
  }
  
  const participants = Object.keys(db.data.conversations[chatId].participants)
    .filter(id => id !== currentUserId && id !== process.env.BOT_ID);
  
  // Collect facts for each participant
  const participantsFacts = {};
  
  participants.forEach(participantId => {
    // Skip if no facts for this participant
    if (!db.data.userFacts[participantId]) {
      return;
    }
    
    // Get participant name
    const participantName = db.data.conversations[chatId]?.participants[participantId]?.name || 
                         participantId.split('@')[0];
    
    // Get high-confidence facts only
    const userFacts = db.data.userFacts[participantId].facts;
    const highConfidenceFacts = {};
    
    Object.entries(userFacts).forEach(([key, fact]) => {
      if (fact.confidence >= 0.8) { // Only include high confidence facts
        highConfidenceFacts[key] = fact;
      }
    });
    
    if (Object.keys(highConfidenceFacts).length > 0) {
      participantsFacts[participantName] = highConfidenceFacts;
    }
  });
  
  return participantsFacts;
}

/**
 * Record relationship between two facts
 * @param {string} userId - User ID
 * @param {string} factKey1 - First fact key
 * @param {string} factKey2 - Second fact key
 * @param {number} relationStrength - Relationship strength (0-1)
 * @param {string} relationshipType - Type of relationship
 */
async function recordFactRelationship(userId, factKey1, factKey2, relationStrength = 0.5, relationshipType = 'related_to') {
  try {
    const db = getDb();
    
    // Ensure structure exists
    if (!db.data.factRelationships) {
      db.data.factRelationships = {};
    }
    
    // Create a unique ID for this relationship
    const sortedKeys = [factKey1, factKey2].sort();
    const relationshipId = `${userId}:${sortedKeys[0]}:${sortedKeys[1]}`;
    
    // Check if relationship already exists
    if (db.data.factRelationships[relationshipId]) {
      // Update strength (strengthen existing connections)
      const currentStrength = db.data.factRelationships[relationshipId].strength;
      db.data.factRelationships[relationshipId].strength = Math.min(1.0, currentStrength + (relationStrength * 0.1));
      db.data.factRelationships[relationshipId].updatedAt = new Date().toISOString();
      
      // Add new relationship type if it's different
      if (relationshipType && 
          relationshipType !== 'related_to' && 
          db.data.factRelationships[relationshipId].relationshipType === 'related_to') {
        db.data.factRelationships[relationshipId].relationshipType = relationshipType;
      }
    } else {
      // Create new relationship
      db.data.factRelationships[relationshipId] = {
        userId,
        fact1: sortedKeys[0],
        fact2: sortedKeys[1],
        strength: relationStrength,
        relationshipType: relationshipType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    
    await db.write();
    return true;
  } catch (error) {
    logger.error('Error recording fact relationship', error);
    return false;
  }
}

/**
 * Find facts related to a given fact
 * @param {string} userId - User ID
 * @param {string} factKey - Fact key to find relations for
 * @param {number} minStrength - Minimum relationship strength
 * @param {number} limit - Maximum number of related facts to return
 * @returns {Array} - Related facts sorted by relationship strength
 */
function findRelatedFacts(userId, factKey, minStrength = 0.3, limit = 5) {
  try {
    const db = getDb();
    
    if (!db.data.factRelationships) {
      return [];
    }
    
    const relatedFacts = [];
    
    // Find all relationships involving this fact
    Object.values(db.data.factRelationships).forEach(relation => {
      if (relation.userId !== userId) return;
      
      let relatedFactKey = null;
      
      if (relation.fact1 === factKey) {
        relatedFactKey = relation.fact2;
      } else if (relation.fact2 === factKey) {
        relatedFactKey = relation.fact1;
      }
      
      if (relatedFactKey && relation.strength >= minStrength) {
        // Check if the fact still exists
        if (db.data.userFacts[userId]?.facts[relatedFactKey]) {
          relatedFacts.push({
            key: relatedFactKey,
            strength: relation.strength,
            ...db.data.userFacts[userId].facts[relatedFactKey]
          });
        }
      }
    });
    
    // Sort by relationship strength (strongest first) and limit results
    return relatedFacts
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  } catch (error) {
    logger.error('Error finding related facts', error);
    return [];
  }
}

/**
 * Analyze a conversation to find potential fact relationships
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID
 */
async function analyzeFactRelationships(userId, chatId) {
  try {
    const db = getDb();
    
    if (!db.data.conversations[chatId] || !db.data.userFacts[userId]) {
      return false;
    }
    
    // Get recent user messages
    const recentMessages = db.data.conversations[chatId].messages
      .filter(msg => msg.sender === userId)
      .slice(-20);
    
    // Get all user facts
    const userFacts = Object.keys(db.data.userFacts[userId].facts);
    
    // For each message, check which facts are mentioned together
    for (const message of recentMessages) {
      const mentionedFacts = [];
      
      // Check which facts might be mentioned in this message
      for (const factKey of userFacts) {
        // Simple check: does the message contain the fact value?
        const factValue = db.data.userFacts[userId].facts[factKey].value.toLowerCase();
        if (message.content.toLowerCase().includes(factValue)) {
          mentionedFacts.push(factKey);
        }
      }
      
      // If multiple facts are mentioned in one message, they may be related
      if (mentionedFacts.length >= 2) {
        // Record relationships between all pairs of facts
        for (let i = 0; i < mentionedFacts.length; i++) {
          for (let j = i+1; j < mentionedFacts.length; j++) {
            await recordFactRelationship(userId, mentionedFacts[i], mentionedFacts[j], 0.6);
          }
        }
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Error analyzing fact relationships', error);
    return false;
  }
}

/**
 * Manually add or update a fact for a user (admin/user-controlled)
 * @param {string} userId - User ID
 * @param {string} factKey - Fact key
 * @param {string} factValue - Fact value
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} - Success status
 */
async function manuallyAddFact(userId, factKey, factValue, options = {}) {
  try {
    const db = getDb();
    if (!db.data.userFacts[userId]) {
      db.data.userFacts[userId] = {
        facts: {},
        factHistory: []
      };
    }
    
    const userFactsObj = db.data.userFacts[userId];
    const oldFact = userFactsObj.facts[factKey];
    
    // Default options
    const {
      confidence = 0.95,
      category = determineFactCategory(factKey, factValue),
      source = 'manual',
      overrideExisting = true
    } = options;
    
    // Check if we should override existing fact
    if (oldFact && !overrideExisting) {
      return false;
    }
    
    // If fact exists, add to history
    if (oldFact) {
      userFactsObj.factHistory.push({
        fact: factKey,
        oldValue: oldFact.value,
        newValue: factValue,
        oldConfidence: oldFact.confidence,
        newConfidence: confidence,
        timestamp: new Date().toISOString(),
        source: 'manual-override'
      });
    }
    
    // Add or update fact
    userFactsObj.facts[factKey] = {
      value: factValue,
      confidence,
      category,
      lastUpdated: new Date().toISOString(),
      source,
      createdAt: oldFact?.createdAt || new Date().toISOString(),
      manuallyVerified: true
    };
    
    await db.write();
    logger.success(`Manually added/updated fact: ${factKey} = ${factValue} for user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error manually adding fact', error);
    return false;
  }
}

/**
 * Delete a fact for a user
 * @param {string} userId - User ID
 * @param {string} factKey - Fact key
 * @returns {Promise<boolean>} - Success status
 */
async function deleteFact(userId, factKey) {
  try {
    const db = getDb();
    if (!db.data.userFacts[userId]?.facts?.[factKey]) {
      return false;
    }
    
    // Record deletion in history
    db.data.userFacts[userId].factHistory.push({
      fact: factKey,
      oldValue: db.data.userFacts[userId].facts[factKey].value,
      newValue: null,
      oldConfidence: db.data.userFacts[userId].facts[factKey].confidence,
      newConfidence: 0,
      timestamp: new Date().toISOString(),
      action: 'deleted'
    });
    
    // Delete fact
    delete db.data.userFacts[userId].facts[factKey];
    
    await db.write();
    logger.success(`Deleted fact: ${factKey} for user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting fact', error);
    return false;
  }
}

/**
 * Consolidate user facts to remove redundancies and contradictions
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - Success status
 */
async function consolidateUserFacts(userId) {
  try {
    const db = getDb();
    const userFactsObj = db.data.userFacts[userId];
    
    if (!userFactsObj || !userFactsObj.facts) return false;
    
    // Find potentially contradictory or redundant facts
    const factGroups = groupRelatedFacts(userFactsObj.facts);
    
    // Resolve contradictions and merge related facts
    for (const [factGroup, relatedFacts] of Object.entries(factGroups)) {
      if (relatedFacts.length <= 1) continue;
      
      // Sort by confidence, highest first
      const sortedFacts = relatedFacts.sort((a, b) => b.confidence - a.confidence);
      
      // Keep the highest confidence fact, mark others for removal
      const primaryFact = sortedFacts[0];
      const factsToRemove = sortedFacts.slice(1).map(f => f.key);
      
      // Remove redundant facts
      factsToRemove.forEach(key => {
        // Record the consolidation in history
        userFactsObj.factHistory.push({
          fact: key,
          oldValue: userFactsObj.facts[key].value,
          newValue: "[CONSOLIDATED]",
          oldConfidence: userFactsObj.facts[key].confidence,
          newConfidence: 0,
          timestamp: new Date().toISOString(),
          action: "consolidated",
          consolidatedInto: primaryFact.key
        });
        
        // Remove the fact
        delete userFactsObj.facts[key];
        
        logger.info(`Consolidated redundant fact "${key}" into "${primaryFact.key}"`);
      });
    }
    
    await db.write();
    return true;
  } catch (error) {
    logger.error('Error consolidating user facts', error);
    return false;
  }
}

/**
 * Group facts that are likely related or contradictory
 * @param {Object} facts - User facts object
 * @returns {Object} - Grouped facts by similarity
 */
function groupRelatedFacts(facts) {
  const groups = {};
  
  // Define potential synonym patterns for fact keys
  const synonymPatterns = [
    [/name/, /called|full.?name/],
    [/lives|location|city/, /home|address|lives.in/],
    [/job|profession|work/, /career|occupation|employed/],
    [/likes|loves/, /favorite|enjoys/]
  ];
  
  // Group facts by category first
  const factsByCategory = {};
  
  Object.entries(facts).forEach(([key, fact]) => {
    const category = fact.category || 'uncategorized';
    if (!factsByCategory[category]) factsByCategory[category] = [];
    factsByCategory[category].push({ key, ...fact });
  });
  
  // For each category, find potentially related facts
  Object.entries(factsByCategory).forEach(([category, categoryFacts]) => {
    // Group facts by similarity in keys
    categoryFacts.forEach(fact => {
      let assigned = false;
      
      // Check for synonym patterns
      for (const [pattern1, pattern2] of synonymPatterns) {
        if ((pattern1.test(fact.key) || pattern2.test(fact.key)) && !assigned) {
          const groupKey = `${category}_${pattern1.toString()}`;
          if (!groups[groupKey]) groups[groupKey] = [];
          groups[groupKey].push(fact);
          assigned = true;
        }
      }
      
      // Default grouping if no match
      if (!assigned) {
        const groupKey = `${category}_${fact.key}`;
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(fact);
      }
    });
  });
  
  return groups;
}

/**
 * Get relevant global facts that might be applicable to the current context
 * @param {Object} relevantFactsObj - Relevant facts object for the user
 * @returns {Array} - Formatted global facts that are relevant
 */
function getRelevantGlobalFacts(relevantFactsObj) {
  const db = getDb();
  
  if (!db.data.globalFacts || !db.data.globalFacts.facts) {
    return [];
  }
  
  // Extract potentially relevant domains from the user's relevant facts
  const relevantDomains = new Set();
  const relevantCategories = new Set();
  const relevantKeywords = new Set();
  
  // Extract important information from the relevant facts
  Object.entries(relevantFactsObj).forEach(([key, fact]) => {
    if (fact.category) {
      relevantCategories.add(fact.category);
    }
    
    // Extract potential domain keywords from the fact value
    const words = fact.value.toLowerCase().split(/\s+/);
    words.forEach(word => {
      if (word.length > 3) {
        relevantKeywords.add(word);
      }
    });
    
    // Extract potential domains from fact key
    const keyParts = key.toLowerCase().split(/[_\s]+/);
    keyParts.forEach(part => {
      if (part.length > 3) {
        relevantKeywords.add(part);
      }
    });
  });
  
  // Find global facts that match the relevant domains or categories
  const globalFactsArray = Object.entries(db.data.globalFacts.facts)
    .filter(([key, fact]) => {
      // Only include high-confidence facts
      if (fact.confidence < 0.8) return false;
      
      // Check for domain match
      if (fact.domain && relevantKeywords.has(fact.domain)) {
        return true;
      }
      
      // Check for category match
      if (fact.category && relevantCategories.has(fact.category)) {
        return true;
      }
      
      // Check for keyword match in the key
      const keyParts = key.toLowerCase().split(/[_\s]+/);
      if (keyParts.some(part => relevantKeywords.has(part))) {
        return true;
      }
      
      // Check for keyword match in the value
      const valueWords = fact.value.toLowerCase().split(/\s+/);
      if (valueWords.some(word => relevantKeywords.has(word))) {
        return true;
      }
      
      return false;
    })
    .map(([key, fact]) => {
      // Format as a useful fact string
      const categoryLabel = fact.category ? ` (${fact.category})` : '';
      return `GLOBAL: ${key.replace(/_/g, ' ')}: ${fact.value}${categoryLabel}`;
    });
  
  // Limit to the top 5 most relevant global facts
  return globalFactsArray.slice(0, 5);
}

// Export all memory service functions
export {
  extractAndProcessFacts,
  ensureMemoryStructure,
  getUserFacts,
  getGlobalFacts,
  getChatHistory,
  getRelevantFactsForMessage,
  extractKeywordsFromRelevantFacts,
  storeWebSearchResults,
  storeWebContent,
  getRelevantWebResults,
  getCachedWebSearch,
  getRelevantWebContent,
  updateRelevanceMetrics,
  formatRelevantFacts,
  generateTextEmbedding,
  findImagesByDescription,
  addImageRecognitionFacts,
  storeImageEmbedding,
  findSimilarImages,
  findMatchingFaces,
  addGlobalFact,
  manuallyAddFact,
  deleteFact,
  consolidateUserFacts,
  groupRelatedFacts,
  getRelevantGlobalFacts
}; 