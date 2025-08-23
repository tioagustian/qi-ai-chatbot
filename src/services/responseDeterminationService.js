import { requestGeminiChat } from './aiService.js';
import { getDb } from '../database/index.js';
import chalk from 'chalk';

/**
 * Helper function to get sender name from database
 * @param {Object} db - Database object
 * @param {string} senderId - Sender ID (e.g., "6282111182808@s.whatsapp.net")
 * @param {string} chatId - Chat ID for context
 * @returns {string} - Sender name or fallback
 */
function getSenderNameFromDb(db, senderId, chatId = null) {
  try {
    // First, try to get from participants registry (global)
    if (db.data.participantsRegistry && db.data.participantsRegistry[senderId]) {
      const participant = db.data.participantsRegistry[senderId];
      if (participant.name && participant.name.trim()) {
        return participant.name.trim();
      }
    }
    
    // Second, try to get from specific chat participants
    if (chatId && db.data.conversations && db.data.conversations[chatId] && 
        db.data.conversations[chatId].participants && 
        db.data.conversations[chatId].participants[senderId]) {
      const participant = db.data.conversations[chatId].participants[senderId];
      if (participant.name && participant.name.trim()) {
        return participant.name.trim();
      }
    }
    
    // Third, try to get from user facts
    if (db.data.userFacts && db.data.userFacts[senderId] && db.data.userFacts[senderId].facts) {
      const userFacts = db.data.userFacts[senderId].facts;
      // Check for name-related facts in order of preference
      const nameFields = ['name', 'full_name', 'nickname', 'first_name', 'last_name', 'alias', 'called'];
      for (const field of nameFields) {
        if (userFacts[field] && userFacts[field].value && userFacts[field].value.trim()) {
          return userFacts[field].value.trim();
        }
      }
    }
    
    // Fallback: extract phone number from sender ID
    const phoneMatch = senderId.match(/^(\d+)@/);
    if (phoneMatch) {
      return phoneMatch[1];
    }
    
    // Final fallback
    return 'Unknown User';
  } catch (error) {
    logger.error('Error getting sender name from database', error);
    return 'Unknown User';
  }
}

// Console logging helper
const logger = {
  info: (message) => console.log(chalk.blue(`[RESPONSE-DET][${new Date().toISOString()}] ${message}`)),
  success: (message) => console.log(chalk.green(`[RESPONSE-DET][${new Date().toISOString()}] ${message}`)),
  warning: (message) => console.log(chalk.yellow(`[RESPONSE-DET][${new Date().toISOString()}] ${message}`)),
  error: (message, error) => {
    console.log(chalk.red(`[RESPONSE-DET-ERROR][${new Date().toISOString()}] ${message}`));
    if (error) {
      console.log(chalk.red('Error details:'), error);
      console.log(chalk.red('Stack trace:'), error.stack);
    }
  },
  debug: (message, data) => {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.magenta(`[RESPONSE-DET-DEBUG][${new Date().toISOString()}] ${message}`));
      if (data) console.log(chalk.magenta('Debug data:'), data);
    }
  }
};

/**
 * Enhanced response determination using Gemini API
 * @param {Object} message - Message object
 * @param {string} content - Message content
 * @param {boolean} isTagged - Whether the bot is tagged
 * @param {boolean} isGroup - Whether the message is in a group
 * @param {string} botName - Bot name
 * @param {Object} batchContext - Batch message context (optional)
 * @returns {Promise<Object>} - Response determination result
 */
async function shouldRespondToMessageEnhanced(message, content, isTagged, isGroup, botName, batchContext = null) {
  try {
    console.log('Message shouldRespondToMessageEnhanced', JSON.stringify(message, null, 2));
    const db = getDb();
    
    // Fallback to basic logic if Gemini API is not available
    if (!db.data.config.geminiApiKey) {
      logger.warning('Gemini API key not available, falling back to basic response determination');
      return {
        shouldRespond: shouldRespondToMessageBasic(message, content, isTagged, isGroup, botName),
        confidence: 0.5,
        reason: 'fallback_to_basic_logic',
        aiAnalysis: null
      };
    }

                 // Prepare context for AI analysis
      const analysisContext = {
        message: {
          content: content || '',
          sender: getSenderNameFromDb(db, message.key.participant || message.key.remoteJid, message.key.remoteJid),
          timestamp: message.messageTimestamp || Date.now() / 1000,
          type: message.message ? Object.keys(message.message)[0] : 'unknown',
          hasImage: !!message.message?.imageMessage,
          hasVideo: !!message.message?.videoMessage,
          hasAudio: !!message.message?.audioMessage,
          hasDocument: !!message.message?.documentMessage
        },
      chat: {
        isGroup: isGroup,
        isTagged: isTagged,
        botName: botName,
        chatId: message.key.remoteJid
      },
      batch: batchContext ? {
        isBatchedMessage: true,
        batchPosition: batchContext.batchPosition,
        totalInBatch: batchContext.totalInBatch,
        isLastInBatch: batchContext.isLastInBatch,
        batchMessages: (batchContext.messages || []).map(msg => ({
          ...msg,
          sender: getSenderNameFromDb(db, msg.sender, msg.chatId || message.key.remoteJid)
        })),
        batchStartTime: batchContext.startTime
      } : {
        isBatchedMessage: false
      }
    };

    // Create prompt for Gemini API
    const prompt = createResponseDeterminationPrompt(analysisContext);
    
    logger.debug('Sending response determination request to Gemini API', {
      contentLength: content?.length || 0,
      isGroup,
      isTagged,
      hasBatchContext: !!batchContext
    });

    // Call Gemini API
    const response = await requestGeminiChat(
      'gemini-2.0-flash',
      db.data.config.geminiApiKey,
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.1,
        maxTokens: 500
      }
    );

    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message || !response.choices[0].message.content) {
      logger.warning('Invalid response from Gemini API, falling back to basic logic');
      return {
        shouldRespond: shouldRespondToMessageBasic(message, content, isTagged, isGroup, botName),
        confidence: 0.5,
        reason: 'gemini_api_error',
        aiAnalysis: null
      };
    }

    // Parse AI response
    const aiAnalysis = parseAIResponse(response.choices[0].message.content);
    
    logger.debug('AI analysis result', aiAnalysis);

    return {
      shouldRespond: aiAnalysis.shouldRespond,
      confidence: aiAnalysis.confidence,
      reason: aiAnalysis.reason,
      aiAnalysis: aiAnalysis
    };

  } catch (error) {
    logger.error('Error in enhanced response determination', error);
    
    // Fallback to basic logic
    return {
      shouldRespond: shouldRespondToMessageBasic(message, content, isTagged, isGroup, botName),
      confidence: 0.3,
      reason: 'error_fallback',
      aiAnalysis: null
    };
  }
}

/**
 * Create prompt for Gemini API analysis
 * @param {Object} context - Analysis context
 * @returns {string} - Formatted prompt
 */
function createResponseDeterminationPrompt(context) {
  const { message, chat, batch } = context;
  
  let prompt = `You are an AI assistant that determines whether a chatbot should respond to a message. Analyze the following context and provide a JSON response.

CONTEXT:
- Message content: "${message.content}"
- Message type: ${message.type}
- Has image: ${message.hasImage}
- Has video: ${message.hasVideo}
- Has audio: ${message.hasAudio}
- Has document: ${message.hasDocument}
- Chat type: ${chat.isGroup ? 'Group' : 'Private'}
- Bot is tagged: ${chat.isTagged}
- Bot name: "${chat.botName}"
- Chat ID: ${chat.chatId}

${batch.isBatchedMessage ? `
BATCH CONTEXT:
- This is message ${batch.batchPosition} of ${batch.totalInBatch} in a batch
- Is first message in batch: ${batch.isFirstInBatch}
- Is last message in batch: ${batch.isLastInBatch}
- Batch start time: ${batch.startTime ? (() => {
    try {
      const date = new Date(batch.startTime);
      return isNaN(date.getTime()) ? 'unknown' : date.toISOString();
    } catch (error) {
      return 'unknown';
    }
  })() : 'unknown'}
- Batch ID: ${batch.batchId}
- All messages in batch:
${(batch.messages || []).map((msg, idx) => `  ${msg.position || idx + 1}. "${(msg.content || '').substring(0, 100)}${(msg.content || '').length > 100 ? '...' : ''}" (Sender: ${msg.sender || 'Unknown'})`).join('\n')}
` : ''}

RESPONSE RULES:
1. Always respond in private chats (non-group)
2. Always respond if tagged (@botname)
3. Always respond if bot name is mentioned
4. For groups, respond if message contains questions, requests, or commands
5. For batched messages:
   - Only respond to the last message in the batch (unless explicitly addressed earlier)
   - Consider the entire conversation context from all messages in the batch
   - If the first message is a question/request, respond to it even if not the last
   - If multiple messages form a complete thought, respond to the last one
6. Consider context from previous messages in the batch
7. Respond to media messages if they have captions asking for analysis
8. Don't respond to status updates, system messages, or spam
9. Consider the user's intent across the entire batch, not just individual messages

RESPONSE FORMAT (JSON only):
{
  "shouldRespond": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "analysis": {
    "messageIntent": "question/request/statement/command/other",
    "requiresResponse": true/false,
    "batchConsideration": "explanation if applicable",
    "contextRelevance": "how relevant to bot's capabilities",
    "batchContext": {
      "isPartOfBatch": true/false,
      "batchIntent": "overall intent of the batch",
      "shouldRespondToThisMessage": "why this specific message should/shouldn't get a response",
      "batchFlow": "how messages in batch relate to each other"
    }
  }
}`;

  return prompt;
}

/**
 * Parse AI response from Gemini API
 * @param {string} response - Raw AI response
 * @returns {Object} - Parsed analysis
 */
function parseAIResponse(response) {
  try {
    // Log the raw response for debugging
    logger.debug('Parsing AI response', {
      responseLength: response.length,
      responsePreview: response.substring(0, 200) + '...'
    });
    
    // Extract JSON from response - handle both plain JSON and markdown-wrapped JSON
    let jsonText = response;
    
    // Remove markdown code blocks if present
    if (response.includes('```json')) {
      const codeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
        logger.debug('Extracted JSON from markdown block', {
          extractedLength: jsonText.length,
          extractedPreview: jsonText.substring(0, 200) + '...'
        });
      }
    }
    
    // Extract JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const jsonString = jsonMatch[0];
    logger.debug('Extracted JSON string', {
      jsonLength: jsonString.length,
      jsonPreview: jsonString.substring(0, 200) + '...'
    });
    
    const parsed = JSON.parse(jsonString);
    
    // Validate required fields
    if (typeof parsed.shouldRespond !== 'boolean') {
      throw new Error('Invalid shouldRespond field');
    }
    
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      throw new Error('Invalid confidence field');
    }
    
    // Handle batch-specific fields
    const result = {
      shouldRespond: parsed.shouldRespond,
      confidence: parsed.confidence,
      reason: parsed.reason || 'ai_analysis',
      analysis: parsed.analysis || {}
    };
    
    // Add responseToMessage if present (for batch responses)
    if (typeof parsed.responseToMessage === 'number') {
      result.responseToMessage = parsed.responseToMessage;
    }
    
    return result;
    
  } catch (error) {
    logger.error('Error parsing AI response', error);
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
}

/**
 * Basic response determination logic (fallback)
 * @param {Object} message - Message object
 * @param {string} content - Message content
 * @param {boolean} isTagged - Whether the bot is tagged
 * @param {boolean} isGroup - Whether the message is in a group
 * @param {string} botName - Bot name
 * @returns {boolean} - Whether the bot should respond
 */
function shouldRespondToMessageBasic(message, content, isTagged, isGroup, botName) {
  // Always respond in private chats
  if (!isGroup) {
    return true;
  }
  
  // In groups, always respond if tagged
  if (isTagged) {
    return true;
  }
  
  // Check if message contains bot name
  if (content && botName && content.toLowerCase().includes(botName.toLowerCase())) {
    return true;
  }
  
  // Check if message contains common triggers
  const commonTriggers = [
    'siapa', 'who', 'gimana', 'bagaimana', 'how', 'kenapa', 'mengapa', 'why',
    'apa', 'what', 'kapan', 'when', 'dimana', 'where', 'tolong', 'help',
    'bisa', 'can', 'minta', 'request', 'coba', 'try'
  ];
  
  if (content && commonTriggers.some(trigger => {
    // Look for whole word matches, not just substrings
    const regex = new RegExp(`\\b${trigger}\\b`, 'i');
    return regex.test(content);
  })) {
    return true;
  }
  
  // For groups, default to false unless explicitly addressed
  return false;
}

/**
 * Enhanced response determination with batch context
 * @param {Object} message - Message object
 * @param {string} content - Message content
 * @param {boolean} isTagged - Whether the bot is tagged
 * @param {boolean} isGroup - Whether the message is in a group
 * @param {string} botName - Bot name
 * @param {Object} batchMetadata - Batch metadata from message
 * @param {Array} batchMessages - Array of messages in the batch
 * @returns {Promise<Object>} - Response determination result
 */
async function shouldRespondToMessageWithBatch(message, content, isTagged, isGroup, botName, batchMetadata = null, batchMessages = []) {
  let batchContext = null;
  
  if (batchMetadata && batchMetadata.isBatchedMessage) {
    // Calculate approximate start time based on batch processing time
    let startTime = Date.now();
    if (batchMetadata.processingTime && batchMetadata.processingTime > 0) {
      startTime = Date.now() - batchMetadata.processingTime;
    } else if (batchMessages.length > 0) {
      startTime = Date.now() - (batchMessages.length * 1000);
    }
    
    // Ensure startTime is a valid timestamp
    if (isNaN(startTime) || startTime <= 0) {
      startTime = Date.now();
    }
    
    batchContext = {
      batchPosition: batchMetadata.batchPosition || 1,
      totalInBatch: batchMetadata.totalInBatch || 1,
      isLastInBatch: !!batchMetadata.isLastInBatch,
      isFirstInBatch: !!batchMetadata.isFirstInBatch,
      messages: Array.isArray(batchMessages) ? batchMessages : [],
      startTime: startTime,
      batchId: batchMetadata.batchId || `batch_${Date.now()}`
    };
    
    try {
      logger.debug('Batch context created', {
        batchPosition: batchContext.batchPosition,
        totalInBatch: batchContext.totalInBatch,
        isLastInBatch: batchContext.isLastInBatch,
        messageCount: batchMessages.length,
        startTime: new Date(batchContext.startTime).toISOString()
      });
    } catch (debugError) {
      logger.debug('Batch context created (timestamp logging failed)', {
        batchPosition: batchContext.batchPosition,
        totalInBatch: batchContext.totalInBatch,
        isLastInBatch: batchContext.isLastInBatch,
        messageCount: batchMessages.length,
        startTime: batchContext.startTime
      });
    }
  }
  
  return await shouldRespondToMessageEnhanced(message, content, isTagged, isGroup, botName, batchContext);
}

/**
 * Enhanced response determination for entire batch
 * @param {Array} messages - Array of all messages in the batch
 * @param {boolean} isGroup - Whether the messages are in a group
 * @param {string} botName - Bot name
 * @param {Object} batchMetadata - Batch metadata
 * @returns {Promise<Object>} - Response determination result for the entire batch
 */
async function shouldRespondToBatch(messages, isGroup, botName, batchMetadata = null) {
  try {
    console.log('shouldRespondToBatch', JSON.stringify(messages, null, 2));
    const db = getDb();
    
    // Fallback to basic logic if Gemini API is not available
    if (!db.data.config.geminiApiKey) {
      logger.warning('Gemini API key not available, falling back to basic batch response determination');
      return {
        shouldRespond: true, // Default to responding to batches
        confidence: 0.5,
        reason: 'fallback_to_basic_logic',
        aiAnalysis: null,
        responseToMessage: messages.length > 0 ? messages.length : 1 // Respond to last message
      };
    }

    // Prepare context for AI analysis of entire batch
    const analysisContext = {
      messages: messages.map((msg, idx) => ({
        content: msg.content || '',
        sender: getSenderNameFromDb(db, msg.sender, msg.chatId || null),
        timestamp: msg.timestamp || Date.now(),
        position: idx + 1,
        isTagged: msg.isTagged || false,
        hasImage: msg.hasImage || false
      })),
      chat: {
        isGroup: isGroup,
        botName: botName,
        totalMessages: messages.length
      },
      batch: batchMetadata ? {
        isBatchedMessage: true,
        totalInBatch: batchMetadata.totalInBatch || messages.length,
        batchId: batchMetadata.batchId || `batch_${Date.now()}`,
        startTime: batchMetadata.startTime || Date.now()
      } : {
        isBatchedMessage: false
      }
    };

    // Create prompt for Gemini API
    const prompt = createBatchResponseDeterminationPrompt(analysisContext);
    
    logger.debug('Sending batch response determination request to Gemini API', {
      messageCount: messages.length,
      isGroup,
      hasBatchMetadata: !!batchMetadata
    });

    // Call Gemini API
    const response = await requestGeminiChat(
      'gemini-2.0-flash-lite',
      db.data.config.geminiApiKey,
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.1,
        maxTokens: 800
      }
    );

    console.log('Response from Gemini API', JSON.stringify(response, null, 2));
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message || !response.choices[0].message.content) {
      logger.warning('Invalid response from Gemini API, falling back to basic logic');
      return {
        shouldRespond: true,
        confidence: 0.5,
        reason: 'gemini_api_error',
        aiAnalysis: null,
        responseToMessage: messages.length
      };
    }

    // Log the raw response for debugging
    logger.debug('Raw Gemini API response', {
      contentLength: response.choices[0].message.content.length,
      contentPreview: response.choices[0].message.content.substring(0, 200) + '...'
    });

    // Parse AI response
    const aiAnalysis = parseAIResponse(response.choices[0].message.content);
    
    logger.debug('Batch AI analysis result', aiAnalysis);

    return {
      shouldRespond: aiAnalysis.shouldRespond,
      confidence: aiAnalysis.confidence,
      reason: aiAnalysis.reason,
      aiAnalysis: aiAnalysis,
      responseToMessage: aiAnalysis.responseToMessage || messages.length
    };

  } catch (error) {
    logger.error('Error in enhanced batch response determination', error);
    
    // Fallback to basic logic
    return {
      shouldRespond: true,
      confidence: 0.3,
      reason: 'error_fallback',
      aiAnalysis: null,
      responseToMessage: messages.length
    };
  }
}

/**
 * Create prompt for batch response determination
 * @param {Object} context - Analysis context
 * @returns {string} - Formatted prompt
 */
function createBatchResponseDeterminationPrompt(context) {
  const { messages, chat, batch } = context;
  
  let prompt = `You are an AI assistant that determines whether a chatbot should respond to a batch of messages. Analyze the following context and provide a JSON response.

CONTEXT:
- Total messages in batch: ${messages.length}
- Chat type: ${chat.isGroup ? 'Group' : 'Private'}
- Bot name: "${chat.botName}"
- Chat context: ${chat.isGroup ? 'Group chat with multiple participants' : 'Private conversation'}

${batch.isBatchedMessage ? `
BATCH CONTEXT:
- Total messages in batch: ${batch.totalInBatch}
- Batch ID: ${batch.batchId}
- Batch start time: ${batch.startTime ? (() => {
    try {
      const date = new Date(batch.startTime);
      return isNaN(date.getTime()) ? 'unknown' : date.toISOString();
    } catch (error) {
      return 'unknown';
    }
  })() : 'unknown'}
` : ''}

ALL MESSAGES IN BATCH:
${messages.map((msg, idx) => {
  const timestamp = new Date(msg.timestamp * 1000).toISOString();
  const senderName = msg.sender; // Already processed by getSenderNameFromDb
  return `  ${msg.position}. "${msg.content}" (Sender: ${senderName}, Time: ${timestamp}, Tagged: ${msg.isTagged}, Has Image: ${msg.hasImage})`;
}).join('\n')}

RESPONSE RULES:
1. Always respond in private chats (non-group)
2. Always respond if any message in the batch tags the bot (@botname)
3. Always respond if bot name is mentioned in any message
4. For groups, respond if any message contains questions, requests, or commands
5. Consider the entire conversation flow across all messages
6. Determine which message(s) should receive a response
7. Respond to media messages if they have captions asking for analysis
8. Don't respond to status updates, system messages, or spam
9. Consider the user's intent across the entire batch, not just individual messages

RESPONSE FORMAT (JSON only):
{
  "shouldRespond": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "responseToMessage": number (which message number to respond to, or 0 for no response),
  "analysis": {
    "overallIntent": "question/request/statement/command/other",
    "requiresResponse": true/false,
    "batchFlow": "how messages relate to each other",
    "contextRelevance": "how relevant to bot's capabilities",
    "responseStrategy": "explanation of response strategy"
  }
}`;

  return prompt;
}

export {
  shouldRespondToMessageEnhanced,
  shouldRespondToMessageWithBatch,
  shouldRespondToBatch,
  shouldRespondToMessageBasic
};
