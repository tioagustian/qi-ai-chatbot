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
      factHistory: []
    };
  }
  
  // Ensure image embeddings structure exists
  if (!db.data.imageEmbeddings) {
    db.data.imageEmbeddings = {};
  }
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
    return `"${key}": { "value": "${fact.value}", "confidence": ${fact.confidence} }`;
  }).join(',\n    ');
  
  const formattedGlobalFacts = Object.entries(globalFacts).map(([key, fact]) => {
    return `"${key}": { "value": "${fact.value}", "confidence": ${fact.confidence} }`;
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
  
  // Create the prompt
  let prompt = `You are a fact extraction system for an AI chatbot. Your task is to:
1. Analyze conversation history and the latest message
2. Extract new facts about the user
3. Identify facts that need updating
4. Determine which facts are relevant to the current message

IMPORTANT GUIDELINES FOR FACT EXTRACTION:
* Facts are about the specific user's personal information, preferences, or experiences.
* DO NOT include hypothetical scenarios, future intentions, or temporary states.
* DO NOT include facts about other people the user mentions unless it relates to their relationship with the user.
* DO NOT include system information or meta-conversation facts.

GLOBAL FACTS VS USER FACTS:
* Global facts - Facts that represent general knowledge, locations, populations, etc.
* User facts - Facts that are specific to this user's personal information or preferences.

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

Respond with a JSON object containing these sections:
1. "new_facts": Facts to add that weren't known before (user or global)
2. "update_facts": Facts to modify where the information has changed
3. "relevant_facts": Facts relevant to the current message (only user facts)

Example response format:
{
  "new_facts": {
    "favorite_color": { "value": "blue", "confidence": 0.92 },
    "capital of Indonesia": { "value": "Jakarta", "confidence": 0.98, "is_global": true }
  },
  "update_facts": {
    "location": { "value": "Jakarta", "confidence": 0.85, "previous_value": "Bandung" },
    "population of Jakarta": { "value": "10.5 million", "confidence": 0.95, "is_global": true }
  },
  "relevant_facts": {
    "favorite_color": { "value": "blue", "confidence": 0.92 },
    "location": { "value": "Jakarta", "confidence": 0.85 }
  }
}

IMPORTANT: Only include facts that are explicitly stated or can be very strongly inferred with high confidence (>0.7).
For facts that need updating, include the previous value in "previous_value".
Global facts should be marked with "is_global": true.
If there are no new facts, updates, or relevant facts, return empty objects for those categories.`;

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
    
    // Process the response, preserving the is_global flag for global facts
    const newFacts = {};
    const updateFacts = {};
    const relevantFacts = {};
    
    // Process new facts, preserving the is_global flag
    if (parsedJson.new_facts) {
      Object.entries(parsedJson.new_facts).forEach(([key, fact]) => {
        newFacts[key] = {
          value: fact.value,
          confidence: fact.confidence,
          is_global: fact.is_global === true
        };
      });
    }
    
    // Process updated facts, preserving the is_global flag and previous_value
    if (parsedJson.update_facts) {
      Object.entries(parsedJson.update_facts).forEach(([key, fact]) => {
        updateFacts[key] = {
          value: fact.value,
          confidence: fact.confidence,
          previous_value: fact.previous_value,
          is_global: fact.is_global === true
        };
      });
    }
    
    // Process relevant facts
    if (parsedJson.relevant_facts) {
      Object.entries(parsedJson.relevant_facts).forEach(([key, fact]) => {
        relevantFacts[key] = {
          value: fact.value,
          confidence: fact.confidence
        };
      });
    }
    
    return {
      success: true,
      newFacts,
      updateFacts,
      relevantFacts
    };
  } catch (error) {
    logger.error('Error parsing fact extraction response', error);
    return { success: false, error: 'Failed to parse fact extraction response' };
  }
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
      // Add as global fact
      await addGlobalFact(factKey, factData.value, factData.confidence);
      
      // Add to new facts list for returning to caller
      newFacts.push({
        key: factKey,
        value: factData.value,
        confidence: factData.confidence,
        isGlobal: true
      });
      
      continue;
    }
    
    // Add new fact
    userFactsObj.facts[factKey] = {
      value: factData.value,
      confidence: factData.confidence,
      lastUpdated: new Date().toISOString(),
      source: 'auto-extracted',
      createdAt: new Date().toISOString()
    };
    
    newFacts.push({
      key: factKey,
      value: factData.value,
      confidence: factData.confidence
    });
    
    logger.info(`Added new fact: "${factKey}" = "${factData.value}" (confidence: ${factData.confidence})`);
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
      // Update global fact
      await addGlobalFact(factKey, factData.value, factData.confidence);
      
      // Add to updated facts list for returning to caller
      updatedFacts.push({
        key: factKey,
        oldValue: factData.previous_value || "unknown",
        newValue: factData.value,
        confidence: factData.confidence,
        isGlobal: true
      });
      
      continue;
    }
    
    const oldValue = userFactsObj.facts[factKey]?.value;
    
    // If the fact doesn't exist yet, add it as new
    if (!userFactsObj.facts[factKey]) {
      userFactsObj.facts[factKey] = {
        value: factData.value,
        confidence: factData.confidence,
        lastUpdated: new Date().toISOString(),
        source: 'auto-extracted',
        createdAt: new Date().toISOString()
      };
      
      newFacts.push({
        key: factKey,
        value: factData.value,
        confidence: factData.confidence
      });
      
      logger.info(`Added new fact (from update): "${factKey}" = "${factData.value}" (confidence: ${factData.confidence})`);
      continue;
    }
    
    // Only update if the confidence is higher or the value is different
    if (factData.confidence >= userFactsObj.facts[factKey].confidence || 
        factData.value !== userFactsObj.facts[factKey].value) {
      
      // Record the history
      userFactsObj.factHistory.push({
        fact: factKey,
        oldValue: userFactsObj.facts[factKey].value,
        newValue: factData.value,
        oldConfidence: userFactsObj.facts[factKey].confidence,
        newConfidence: factData.confidence,
        timestamp: new Date().toISOString()
      });
      
      // Update the fact
      userFactsObj.facts[factKey] = {
        value: factData.value,
        confidence: factData.confidence,
        lastUpdated: new Date().toISOString(),
        source: 'auto-extracted',
        createdAt: userFactsObj.facts[factKey].createdAt
      };
      
      updatedFacts.push({
        key: factKey,
        oldValue,
        newValue: factData.value,
        confidence: factData.confidence
      });
      
      logger.info(`Updated fact: "${factKey}" from "${oldValue}" to "${factData.value}" (confidence: ${factData.confidence})`);
    }
  }
  
  // Limit the number of facts per user
  const factKeys = Object.keys(userFactsObj.facts);
  if (factKeys.length > MAX_FACTS_PER_USER) {
    // Sort facts by last updated time (oldest first)
    const sortedFactKeys = factKeys.sort((a, b) => {
      return new Date(userFactsObj.facts[a].lastUpdated) - new Date(userFactsObj.facts[b].lastUpdated);
    });
    
    // Remove oldest facts
    const keysToRemove = sortedFactKeys.slice(0, factKeys.length - MAX_FACTS_PER_USER);
    keysToRemove.forEach(key => {
      logger.debug(`Removing oldest fact "${key}" to maintain limit of ${MAX_FACTS_PER_USER} facts`);
      delete userFactsObj.facts[key];
    });
  }
  
  // Limit the history to the most recent 50 entries
  if (userFactsObj.factHistory.length > 50) {
    userFactsObj.factHistory = userFactsObj.factHistory.slice(-50);
  }
  
  // Ensure the user facts entry exists and is saved
  db.data.userFacts[userId] = userFactsObj;
  await db.write();
  
  // Return the relevant facts for the current message
  return {
    relevantFacts: extractionResult.relevantFacts,
    newFacts,
    updatedFacts,
    success: true
  };
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
  
  // For private chats, just return the primary user's facts
  if (!chatId.endsWith('@g.us')) {
    return primaryUserFacts;
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
    
    // Get relevant facts for each participant (limit to 3 participants)
    prioritizedParticipants.slice(0, 3).forEach(participantId => {
      if (db.data.userFacts[participantId]) {
        const participantName = db.data.conversations[chatId]?.participants[participantId]?.name || 
                             participantId.split('@')[0];
        
        // Get high-confidence facts only (limit to 5 facts per participant)
        const userFacts = db.data.userFacts[participantId].facts;
        const highConfidenceFacts = Object.entries(userFacts)
          .filter(([_, fact]) => fact.confidence >= 0.85)
          .sort((a, b) => b[1].confidence - a[1].confidence)
          .slice(0, 5)
          .map(([key, fact]) => `${participantName}: ${key} = ${fact.value}`);
        
        otherParticipantsFacts.push(...highConfidenceFacts);
      }
    });
  }
  
  return [...primaryUserFacts, ...otherParticipantsFacts];
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
    return `${key}: ${fact.value}`;
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
        value: recognitionData.description.substring(0, 100),
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
 * @param {number} confidence - Confidence score (0-1)
 * @returns {Promise<boolean>} - Success status
 */
async function addGlobalFact(factKey, factValue, confidence = 0.95) {
  try {
    const db = getDb();
    
    // Ensure structure exists
    ensureMemoryStructure(db);
    
    const timestamp = new Date().toISOString();
    
    // Get current value if exists
    const currentFact = db.data.globalFacts.facts[factKey];
    
    // If fact exists and has higher confidence, don't update
    if (currentFact && currentFact.confidence > confidence) {
      logger.debug(`Not updating global fact "${factKey}" as existing confidence is higher`);
      return false;
    }
    
    // If fact exists, add to history
    if (currentFact) {
      db.data.globalFacts.factHistory.push({
        fact: factKey,
        oldValue: currentFact.value,
        newValue: factValue,
        oldConfidence: currentFact.confidence,
        newConfidence: confidence,
        timestamp
      });
    }
    
    // Update or add the fact
    db.data.globalFacts.facts[factKey] = {
      value: factValue,
      confidence,
      lastUpdated: timestamp,
      source: 'system',
      createdAt: currentFact?.createdAt || timestamp
    };
    
    // Save to database
    await db.write();
    
    logger.success(`Added/updated global fact: ${factKey} = ${factValue}`);
    return true;
  } catch (error) {
    logger.error('Error adding global fact', error);
    return false;
  }
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

// Export functions
export {
  extractAndProcessFacts,
  formatRelevantFacts,
  getRelevantFactsForMessage,
  addImageRecognitionFacts,
  storeImageEmbedding,
  findSimilarImages,
  findMatchingFaces,
  generateTextEmbedding,
  ensureMemoryStructure,
  findImagesByDescription,
  addGlobalFact
}; 