import { getDb } from '../database/index.js';
import { processMessage } from '../handlers/messageHandler.js';
import { updateContext } from './contextService.js';
import chalk from 'chalk';

// Configuration for message batching
const BATCH_CONFIG = {
  // Time to wait after user stops typing before processing messages
  TYPING_TIMEOUT: process.env.BATCH_TYPING_TIMEOUT ? parseInt(process.env.BATCH_TYPING_TIMEOUT) : 3000, // 3 seconds
  // Maximum time to wait for more messages before processing
  MAX_WAIT_TIME: process.env.BATCH_MAX_WAIT_TIME ? parseInt(process.env.BATCH_MAX_WAIT_TIME) : 8000, // 8 seconds
  // Minimum time to wait before processing (even if typing stops)
  MIN_WAIT_TIME: process.env.BATCH_MIN_WAIT_TIME ? parseInt(process.env.BATCH_MIN_WAIT_TIME) : 1500, // 1.5 seconds
  // Time to wait after receiving first message before showing typing indicator
  INITIAL_DELAY: process.env.BATCH_INITIAL_DELAY ? parseInt(process.env.BATCH_INITIAL_DELAY) : 800, // 800ms
  // Fallback timeout when typing events don't arrive
  TYPING_FALLBACK: process.env.BATCH_TYPING_FALLBACK ? parseInt(process.env.BATCH_TYPING_FALLBACK) : 9000, // 9 seconds
};

// Store for tracking typing states and message batches per chat
// For personal chats: chatId -> state
// For groups: chatId -> { userId -> state }
const typingStates = new Map();
const messageBatches = new Map();

// Console logging helper
const logger = {
  info: (message) => console.log(chalk.blue(`[BATCH][${new Date().toISOString()}] ${message}`)),
  success: (message) => console.log(chalk.green(`[BATCH][${new Date().toISOString()}] ${message}`)),
  warning: (message) => console.log(chalk.yellow(`[BATCH][${new Date().toISOString()}] ${message}`)),
  error: (message, error) => {
    console.log(chalk.red(`[BATCH-ERROR][${new Date().toISOString()}] ${message}`));
    if (error) console.log(chalk.red('Error details:'), error);
  },
  debug: (message, data) => {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.magenta(`[BATCH-DEBUG][${new Date().toISOString()}] ${message}`));
      if (data) console.log(chalk.magenta('Debug data:'), data);
    }
  }
};

/**
 * Initialize typing state for a chat (personal) or user in group
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (optional, for groups)
 */
function initializeTypingState(chatId, userId = null) {
  const isGroup = chatId.endsWith('@g.us');
  
  if (isGroup && userId) {
    // Group chat - per-user state
    if (!typingStates.has(chatId)) {
      typingStates.set(chatId, new Map());
    }
    
    const groupStates = typingStates.get(chatId);
    if (!groupStates.has(userId)) {
      groupStates.set(userId, {
        isTyping: false,
        lastTypingTime: null,
        typingTimeout: null,
        processingTimeout: null,
        messageTimeout: null,
        messageCount: 0,
        firstMessageTime: null,
        userId: userId
      });
    }
  } else {
    // Personal chat - single state
    if (!typingStates.has(chatId)) {
      typingStates.set(chatId, {
        isTyping: false,
        lastTypingTime: null,
        typingTimeout: null,
        processingTimeout: null,
        messageTimeout: null,
        messageCount: 0,
        firstMessageTime: null
      });
    }
  }
}

/**
 * Get typing state for a chat/user
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (optional, for groups)
 * @returns {Object|null} - Typing state or null
 */
function getTypingState(chatId, userId = null) {
  const isGroup = chatId.endsWith('@g.us');
  
  if (isGroup && userId) {
    const groupStates = typingStates.get(chatId);
    return groupStates ? groupStates.get(userId) : null;
  } else {
    return typingStates.get(chatId);
  }
}

/**
 * Initialize message batch for a chat (personal) or user in group
 * @param {string} chatId - Chat ID  
 * @param {string} userId - User ID (optional, for groups)
 */
function initializeMessageBatch(chatId, userId = null) {
  const isGroup = chatId.endsWith('@g.us');
  
  if (isGroup && userId) {
    // Group chat - per-user batches
    if (!messageBatches.has(chatId)) {
      messageBatches.set(chatId, new Map());
    }
    
    const groupBatches = messageBatches.get(chatId);
    if (!groupBatches.has(userId)) {
      groupBatches.set(userId, {
        messages: [],
        startTime: Date.now(),
        processing: false,
        userId: userId
      });
    }
  } else {
    // Personal chat - single batch
    if (!messageBatches.has(chatId)) {
      messageBatches.set(chatId, {
        messages: [],
        startTime: Date.now(),
        processing: false
      });
    }
  }
}

/**
 * Get message batch for a chat/user
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (optional, for groups)
 * @returns {Object|null} - Message batch or null
 */
function getMessageBatch(chatId, userId = null) {
  const isGroup = chatId.endsWith('@g.us');
  
  if (isGroup && userId) {
    const groupBatches = messageBatches.get(chatId);
    return groupBatches ? groupBatches.get(userId) : null;
  } else {
    return messageBatches.get(chatId);
  }
}

/**
 * Handle incoming message with batching (supports both personal and group chats)
 * @param {Object} sock - Socket instance
 * @param {Object} message - Message object
 */
async function handlePersonalChatMessage(sock, message) {
  const chatId = message.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  const sender = message.key.participant || message.key.remoteJid;
  const userId = isGroup ? sender : null;
  
  logger.debug(`Processing message for chat ${chatId}, isGroup: ${isGroup}, sender: ${sender}`);
  
  // Apply batching to both personal chats and groups
  if (isGroup) {
    logger.debug(`Group chat detected, using per-user batching system`);
    await handleGroupChatMessage(sock, message);
    return;
  }
  
  logger.debug(`Personal chat detected, using batching system`);
  
  initializeTypingState(chatId);
  const typingState = typingStates.get(chatId);
  
  // Extract message content for logging
  const content = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || 
                 message.message?.imageMessage?.caption || 
                 '[Media message]';
  
  logger.info(`Received message in personal chat: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
  
  // Initialize message batch if this is the first message
  if (!messageBatches.has(chatId)) {
    messageBatches.set(chatId, {
      messages: [],
      startTime: Date.now(),
      processing: false
    });
  }
  
  const messageBatch = messageBatches.get(chatId);
  
  // Add message to batch
  messageBatch.messages.push(message);
  typingState.messageCount++;
  
  // Set first message time if this is the first message
  if (typingState.messageCount === 1) {
    typingState.firstMessageTime = Date.now();
    logger.debug(`First message received, starting batch timer`);
  }
  
  // Clear existing timeouts
  if (typingState.typingTimeout) {
    clearTimeout(typingState.typingTimeout);
    logger.debug(`Cleared typing timeout`);
  }
  if (typingState.processingTimeout) {
    clearTimeout(typingState.processingTimeout);
    logger.debug(`Cleared processing timeout`);
  }
  if (typingState.messageTimeout) {
    clearTimeout(typingState.messageTimeout);
    typingState.messageTimeout = null;
    logger.debug(`Cleared message timeout`);
  }
  
  // Check if typing state is stale (no typing updates for too long)
  if (typingState.isTyping && typingState.lastTypingTime) {
    const timeSinceLastTyping = Date.now() - typingState.lastTypingTime;
    const maxTypingAge = BATCH_CONFIG.TYPING_TIMEOUT * 2; // 6 seconds max
    
    if (timeSinceLastTyping > maxTypingAge) {
      logger.warning(`Typing state is stale (${timeSinceLastTyping}ms old), assuming user stopped typing`);
      typingState.isTyping = false;
    }
  }
  
  // Set a message-based timeout that resets with each new message
  // This is more reliable than typing events
  // Only set timeout if we're not already in the final processing phase
  if (!messageBatch.processing) {
    // Check if user is currently typing - if so, don't set timeout yet but set a fallback
    if (typingState.isTyping) {
      logger.debug(`User is currently typing, not setting timeout yet (message ${typingState.messageCount})`);
      
      // Set a longer fallback timeout in case we don't get "stopped typing" event
      const fallbackDelay = BATCH_CONFIG.TYPING_FALLBACK;
      typingState.messageTimeout = setTimeout(async () => {
        const currentBatch = messageBatches.get(chatId);
        if (currentBatch && !currentBatch.processing) {
          logger.warning(`Fallback timeout reached (no typing update received), processing batch`);
          await processMessageBatch(sock, chatId);
        }
      }, fallbackDelay);
      
      logger.debug(`Set fallback timeout for ${fallbackDelay}ms in case typing updates stop coming`);
    } else {
      // Add a minimum delay to prevent immediate processing
      const minDelay = Math.max(BATCH_CONFIG.TYPING_TIMEOUT, 1000); // At least 1 second
      
      typingState.messageTimeout = setTimeout(async () => {
        const currentBatch = messageBatches.get(chatId);
        if (currentBatch && !currentBatch.processing) {
          logger.debug(`Message timeout reached (no new messages), processing batch`);
          await processMessageBatch(sock, chatId);
        }
      }, minDelay);
      
      logger.debug(`Set message timeout for ${minDelay}ms (message ${typingState.messageCount})`);
    }
  } else {
    logger.debug(`Batch is in final processing phase - message added but no new timeout set`);
  }
  
  // Show typing indicator after receiving any message (improved: show on each message)
  setTimeout(async () => {
    const currentBatch = messageBatches.get(chatId);
    if (currentBatch && !currentBatch.processing) {
      logger.debug(`Showing typing indicator after message ${typingState.messageCount}`);
      await sock.sendPresenceUpdate('composing', chatId);
    }
  }, BATCH_CONFIG.INITIAL_DELAY);
  
  // Set maximum wait timeout as backup (only for first message)
  if (typingState.messageCount === 1) {
    const timeSinceFirstMessage = Date.now() - typingState.firstMessageTime;
    const remainingWaitTime = Math.max(0, BATCH_CONFIG.MAX_WAIT_TIME - timeSinceFirstMessage);
    
    typingState.processingTimeout = setTimeout(async () => {
      logger.warning(`Maximum wait time reached, processing batch`);
      await processMessageBatch(sock, chatId);
    }, remainingWaitTime);
  }
  
  logger.debug(`Message added to batch. Total messages: ${messageBatch.messages.length}, processing: ${messageBatch.processing}`);
}

/**
 * Handle incoming message for group chat batching
 * @param {Object} sock - Socket instance
 * @param {Object} message - Message object
 */
async function handleGroupChatMessage(sock, message) {
  const chatId = message.key.remoteJid;
  const sender = message.key.participant || message.key.remoteJid;
  const userId = sender;
  
  // Extract message content for logging
  const content = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || 
                 message.message?.imageMessage?.caption || 
                 '[Media message]';
  
  const senderName = message.pushName || sender.split('@')[0];
  logger.info(`Received group message from ${senderName} (${userId}): "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
  
  // Initialize state for this user
  initializeTypingState(chatId, userId);
  initializeMessageBatch(chatId, userId);
  
  const typingState = getTypingState(chatId, userId);
  const messageBatch = getMessageBatch(chatId, userId);
  
  // Add message to user's batch
  messageBatch.messages.push(message);
  typingState.messageCount++;
  
  // Set first message time if this is the first message for this user
  if (typingState.messageCount === 1) {
    typingState.firstMessageTime = Date.now();
    logger.debug(`First message from ${senderName}, starting batch timer`);
  }
  
  // Clear existing timeouts for this user
  if (typingState.typingTimeout) {
    clearTimeout(typingState.typingTimeout);
    logger.debug(`Cleared typing timeout for ${senderName}`);
  }
  if (typingState.processingTimeout) {
    clearTimeout(typingState.processingTimeout);
    logger.debug(`Cleared processing timeout for ${senderName}`);
  }
  if (typingState.messageTimeout) {
    clearTimeout(typingState.messageTimeout);
    typingState.messageTimeout = null;
    logger.debug(`Cleared message timeout for ${senderName}`);
  }
  
  // Check if typing state is stale for this user
  if (typingState.isTyping && typingState.lastTypingTime) {
    const timeSinceLastTyping = Date.now() - typingState.lastTypingTime;
    const maxTypingAge = BATCH_CONFIG.TYPING_TIMEOUT * 2; // 6 seconds max
    
    if (timeSinceLastTyping > maxTypingAge) {
      logger.warning(`Typing state is stale for ${senderName} (${timeSinceLastTyping}ms old), assuming user stopped typing`);
      typingState.isTyping = false;
    }
  }
  
  // Set message-based timeout for this user
  if (!messageBatch.processing) {
    if (typingState.isTyping) {
      logger.debug(`${senderName} is currently typing, not setting timeout yet (message ${typingState.messageCount})`);
      
      // Set fallback timeout for this user
      const fallbackDelay = BATCH_CONFIG.TYPING_FALLBACK;
      typingState.messageTimeout = setTimeout(async () => {
        const currentBatch = getMessageBatch(chatId, userId);
        if (currentBatch && !currentBatch.processing) {
          logger.warning(`Fallback timeout reached for ${senderName}, processing batch`);
          await processUserMessageBatch(sock, chatId, userId);
        }
      }, fallbackDelay);
      
      logger.debug(`Set fallback timeout for ${senderName} (${fallbackDelay}ms)`);
    } else {
      // Normal timeout for this user
      const minDelay = Math.max(BATCH_CONFIG.TYPING_TIMEOUT, 1000);
      
      typingState.messageTimeout = setTimeout(async () => {
        const currentBatch = getMessageBatch(chatId, userId);
        if (currentBatch && !currentBatch.processing) {
          logger.debug(`Message timeout reached for ${senderName}, processing batch`);
          await processUserMessageBatch(sock, chatId, userId);
        }
      }, minDelay);
      
      logger.debug(`Set message timeout for ${senderName} (${minDelay}ms, message ${typingState.messageCount})`);
    }
  } else {
    logger.debug(`Batch is processing for ${senderName} - message added but no new timeout set`);
  }
  
  // Show typing indicator after receiving message (groups get immediate typing feedback)
  setTimeout(async () => {
    const currentBatch = getMessageBatch(chatId, userId);
    if (currentBatch && !currentBatch.processing) {
      logger.debug(`Showing typing indicator for group message from ${senderName}`);
      await sock.sendPresenceUpdate('composing', chatId);
    }
  }, BATCH_CONFIG.INITIAL_DELAY);
  
  // Set maximum wait timeout as backup (only for first message from this user)
  if (typingState.messageCount === 1) {
    const timeSinceFirstMessage = Date.now() - typingState.firstMessageTime;
    const remainingWaitTime = Math.max(0, BATCH_CONFIG.MAX_WAIT_TIME - timeSinceFirstMessage);
    
    typingState.processingTimeout = setTimeout(async () => {
      logger.warning(`Maximum wait time reached for ${senderName}, processing batch`);
      await processUserMessageBatch(sock, chatId, userId);
    }, remainingWaitTime);
  }
  
  logger.debug(`Message added to ${senderName}'s batch. Total messages: ${messageBatch.messages.length}, processing: ${messageBatch.processing}`);
}

/**
 * Process a batch of messages
 * @param {Object} sock - Socket instance
 * @param {string} chatId - Chat ID
 */
async function processMessageBatch(sock, chatId) {
  const messageBatch = messageBatches.get(chatId);
  const typingState = typingStates.get(chatId);
  
  if (!messageBatch || messageBatch.processing || messageBatch.messages.length === 0) {
    return;
  }
  
  // Clear timeouts first, but don't mark as processing yet
  // This allows new messages to still be added during the processing delay
  
  // Clear timeouts
  if (typingState.typingTimeout) {
    clearTimeout(typingState.typingTimeout);
    typingState.typingTimeout = null;
  }
  if (typingState.processingTimeout) {
    clearTimeout(typingState.processingTimeout);
    typingState.processingTimeout = null;
  }
  if (typingState.messageTimeout) {
    clearTimeout(typingState.messageTimeout);
    typingState.messageTimeout = null;
  }
  
  logger.info(`Starting batch processing for ${messageBatch.messages.length} messages for chat ${chatId}`);
  
  try {
    // Calculate minimum wait time
    const timeSinceFirstMessage = Date.now() - typingState.firstMessageTime;
    const minWaitRemaining = Math.max(0, BATCH_CONFIG.MIN_WAIT_TIME - timeSinceFirstMessage);
    
    if (minWaitRemaining > 0) {
      logger.debug(`Waiting additional ${minWaitRemaining}ms for minimum wait time`);
      await new Promise(resolve => setTimeout(resolve, minWaitRemaining));
    }
    
    // NOW mark as processing to prevent new timeouts, but continue collecting messages
    // for a brief additional period to catch any rapid-fire messages
    messageBatch.processing = true;
    
    // Allow a brief additional collection period for rapid messages
    const additionalCollectionTime = 500; // 500ms to catch rapid messages
    logger.debug(`Brief additional collection period of ${additionalCollectionTime}ms for rapid messages`);
    await new Promise(resolve => setTimeout(resolve, additionalCollectionTime));
    
    // Get final message count after additional collection period
    const messages = [...messageBatch.messages];
    const messageCount = messages.length;
    
    logger.info(`Processing batch of ${messageCount} messages for chat ${chatId}`);
    
    if (messageCount === 0) {
      logger.debug(`No messages to process after collection period`);
      return;
    }
    
    // Combine all messages into a single context
    const db = getDb();
    let combinedContent = '';
    let hasImage = false;
    let imageData = null;
    
    // Process each message to extract content, update context, and mark as read
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const content = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || 
                     message.message?.imageMessage?.caption || 
                     '';
      
      // Check for images
      if (message.message?.imageMessage || 
          message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
        hasImage = true;
        imageData = {
          messageId: message.key.id,
          senderName: message.pushName || message.key.participant?.split('@')[0] || 'User'
        };
      }
      
      // Add to combined content
      if (content.trim()) {
        combinedContent += (combinedContent ? '\n' : '') + content;
      }
      
      // Update context for each message (but don't process yet)
      const sender = message.key.participant || message.key.remoteJid;
      await updateContext(db, chatId, sender, content || "[Empty message]", message, sock);
      
      // Mark each message as read individually
      try {
        await sock.readMessages([message.key]);
        logger.debug(`Marked message ${i + 1}/${messages.length} as read: "${content.substring(0, 30)}${content.length > 30 ? '...' : ''}"`);
      } catch (readError) {
        logger.error(`Error marking message ${i + 1} as read`, readError);
      }
    }
    
    // NEW APPROACH: Process each message separately with batch context
    // This allows AI to understand the conversation flow better
    logger.success(`Processing ${messageCount} messages separately with batch context`);
    
    // Process each message individually but with batch metadata
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const content = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || 
                     message.message?.imageMessage?.caption || 
                     '';
      
      // Add batch metadata to each message
      message.batchMetadata = {
        isBatchedMessage: true,
        batchPosition: i + 1,
        totalInBatch: messageCount,
        isFirstInBatch: i === 0,
        isLastInBatch: i === messageCount - 1,
        batchId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        processingTime: Date.now() - typingState.firstMessageTime,
        messagesAlreadyRead: true,
        // Include other messages in batch for context
        otherMessagesInBatch: messages.map((m, idx) => ({
          position: idx + 1,
          content: m.message?.conversation || m.message?.extendedTextMessage?.text || '',
          timestamp: m.messageTimestamp,
          isThis: idx === i
        }))
      };
      
      logger.info(`Processing message ${i + 1}/${messageCount} in batch: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
      
      // Process each message individually
      await processMessage(sock, message);
      
      // Small delay between processing messages to seem more natural
      if (i < messages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
  } catch (error) {
    logger.error('Error processing message batch', error);
    
    // Fallback: process messages individually if batch processing fails
    logger.warning('Falling back to individual message processing');
    for (const message of messages) {
      try {
        await processMessage(sock, message);
      } catch (individualError) {
        logger.error('Error processing individual message', individualError);
      }
    }
  } finally {
    // Clean up
    messageBatches.delete(chatId);
    typingStates.delete(chatId);
    logger.debug(`Batch processing completed for chat ${chatId}`);
  }
}

/**
 * Process a batch of messages for a specific user in a group
 * @param {Object} sock - Socket instance
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 */
async function processUserMessageBatch(sock, chatId, userId) {
  const messageBatch = getMessageBatch(chatId, userId);
  const typingState = getTypingState(chatId, userId);
  
  if (!messageBatch || messageBatch.processing || messageBatch.messages.length === 0) {
    return;
  }
  
  // Clear timeouts for this user
  if (typingState.typingTimeout) {
    clearTimeout(typingState.typingTimeout);
    typingState.typingTimeout = null;
  }
  if (typingState.processingTimeout) {
    clearTimeout(typingState.processingTimeout);
    typingState.processingTimeout = null;
  }
  if (typingState.messageTimeout) {
    clearTimeout(typingState.messageTimeout);
    typingState.messageTimeout = null;
  }
  
  const senderName = messageBatch.messages[0]?.pushName || userId.split('@')[0];
  logger.info(`Starting batch processing for ${messageBatch.messages.length} messages from ${senderName} in group ${chatId}`);
  
  try {
    // Calculate minimum wait time
    const timeSinceFirstMessage = Date.now() - typingState.firstMessageTime;
    const minWaitRemaining = Math.max(0, BATCH_CONFIG.MIN_WAIT_TIME - timeSinceFirstMessage);
    
    if (minWaitRemaining > 0) {
      logger.debug(`Waiting additional ${minWaitRemaining}ms for minimum wait time (${senderName})`);
      await new Promise(resolve => setTimeout(resolve, minWaitRemaining));
    }
    
    // Mark as processing for this user
    messageBatch.processing = true;
    
    // Allow brief additional collection period
    const additionalCollectionTime = 500;
    logger.debug(`Brief additional collection period of ${additionalCollectionTime}ms for rapid messages from ${senderName}`);
    await new Promise(resolve => setTimeout(resolve, additionalCollectionTime));
    
    // Get final messages for this user
    const messages = [...messageBatch.messages];
    const messageCount = messages.length;
    
    logger.info(`Processing batch of ${messageCount} messages from ${senderName} in group ${chatId}`);
    
    if (messageCount === 0) {
      logger.debug(`No messages to process for ${senderName} after collection period`);
      return;
    }
    
    // Combine all messages into a single context
    const db = getDb();
    let combinedContent = '';
    let hasImage = false;
    let imageData = null;
    
    // Process each message, update context, and mark as read
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const content = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || 
                     message.message?.imageMessage?.caption || 
                     '';
      
      // Check for images
      if (message.message?.imageMessage || 
          message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
        hasImage = true;
        imageData = {
          messageId: message.key.id,
          senderName: message.pushName || userId.split('@')[0]
        };
      }
      
      // Add to combined content
      if (content.trim()) {
        combinedContent += (combinedContent ? '\n' : '') + content;
      }
      
      // Update context for each message
      const sender = message.key.participant || message.key.remoteJid;
      await updateContext(db, chatId, sender, content || "[Empty message]", message, sock);
      
      // Mark each message as read individually
      try {
        await sock.readMessages([message.key]);
        logger.debug(`Marked message ${i + 1}/${messages.length} as read from ${senderName}: "${content.substring(0, 30)}${content.length > 30 ? '...' : ''}"`);
      } catch (readError) {
        logger.error(`Error marking message ${i + 1} as read from ${senderName}`, readError);
      }
    }
    
    // Process each message individually but with batch metadata
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const content = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || 
                     message.message?.imageMessage?.caption || 
                     '';
      
      // Add batch metadata to each message
      message.batchMetadata = {
        isBatchedMessage: true,
        batchPosition: i + 1,
        totalInBatch: messageCount,
        isFirstInBatch: i === 0,
        isLastInBatch: i === messageCount - 1,
        batchId: `group_batch_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        processingTime: Date.now() - typingState.firstMessageTime,
        messagesAlreadyRead: true,
        isGroupBatch: true,
        userId: userId,
        // Include other messages in batch for context
        otherMessagesInBatch: messages.map((m, idx) => ({
          position: idx + 1,
          content: m.message?.conversation || m.message?.extendedTextMessage?.text || '',
          timestamp: m.messageTimestamp,
          isThis: idx === i
        }))
      };
      
      logger.info(`Processing group message ${i + 1}/${messageCount} from ${senderName} in batch: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
      
      // Process each message individually
      await processMessage(sock, message);
      
      // Small delay between processing messages
      if (i < messages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
  } catch (error) {
    logger.error(`Error processing message batch for ${senderName}`, error);
    
    // Fallback: process messages individually
    logger.warning(`Falling back to individual message processing for ${senderName}`);
    for (const message of messageBatch.messages) {
      try {
        await processMessage(sock, message);
      } catch (individualError) {
        logger.error(`Error processing individual message from ${senderName}`, individualError);
      }
    }
  } finally {
    // Clean up for this specific user
    const groupBatches = messageBatches.get(chatId);
    const groupStates = typingStates.get(chatId);
    
    if (groupBatches) {
      groupBatches.delete(userId);
      // If no more user batches in this group, clean up the group entry
      if (groupBatches.size === 0) {
        messageBatches.delete(chatId);
      }
    }
    
    if (groupStates) {
      groupStates.delete(userId);
      // If no more user states in this group, clean up the group entry
      if (groupStates.size === 0) {
        typingStates.delete(chatId);
      }
    }
    
    logger.debug(`Batch processing completed for ${senderName} in group ${chatId}`);
  }
}

/**
 * Handle typing indicators from users (supports both personal and group chats)
 * @param {Object} sock - Socket instance
 * @param {Object} update - Typing update object
 */
async function handleTypingUpdate(sock, update) {
  const chatId = update.id;
  const isGroup = chatId.endsWith('@g.us');
  
  logger.debug(`Received presence update for chat ${chatId} (isGroup: ${isGroup}):`, update);
  logger.debug(`Update structure: participants=${!!update.participants}, presences=${!!update.presences}`);
  
  if (isGroup) {
    // Handle group typing updates
    await handleGroupTypingUpdate(sock, update);
    return;
  }
  
  logger.debug(`Received presence update for chat ${chatId}:`, update);
  logger.debug(`Update structure: participants=${!!update.participants}, presences=${!!update.presences}`);
  
  initializeTypingState(chatId);
  const typingState = typingStates.get(chatId);
  const messageBatch = messageBatches.get(chatId);
  
  // Only process if we have an active batch that's not in final processing
  if (!messageBatch) {
    // No batch yet, but track typing state for when a batch is created
    logger.debug(`No active batch for presence update in chat ${chatId}`);
    
    // Check if any participant is typing
    const isTyping = update.presences && 
                     Object.values(update.presences).some(presence => 
                       presence.lastKnownPresence === 'composing' || 
                       presence.lastKnownPresence === 'recording'
                     );
    
    if (isTyping) {
      typingState.isTyping = true;
      typingState.lastTypingTime = Date.now();
      logger.debug(`User typing detected (no batch yet) in chat ${chatId}`);
    } else {
      typingState.isTyping = false;
      logger.debug(`User stopped typing (no batch yet) in chat ${chatId}`);
    }
    
    // Debug: Show what we detected
    const presenceValues = update.presences ? Object.values(update.presences).map(p => p.lastKnownPresence) : [];
    logger.debug(`Presence detection: isTyping=${isTyping}, presences=[${presenceValues.join(', ')}]`);
    
    return;
  }
  
  // Skip if batch is in final processing phase
  if (messageBatch.processing) {
    logger.debug(`Batch is processing, ignoring presence update`);
    return;
  }
  
  // Check if any participant is typing
  const isTyping = update.presences && 
                   Object.values(update.presences).some(presence => 
                     presence.lastKnownPresence === 'composing' || 
                     presence.lastKnownPresence === 'recording'
                   );
  
  // Debug: Show what we detected
  const presenceValues = update.presences ? Object.values(update.presences).map(p => p.lastKnownPresence) : [];
  logger.debug(`Presence detection (with batch): isTyping=${isTyping}, presences=[${presenceValues.join(', ')}]`);
  
  if (isTyping) {
    // User is typing - clear message timeout to give them more time
    typingState.isTyping = true;
    typingState.lastTypingTime = Date.now();
    
    // Clear message timeout to give user more time to type
    if (typingState.messageTimeout) {
      clearTimeout(typingState.messageTimeout);
      typingState.messageTimeout = null;
      logger.debug(`Cleared message timeout - user is actively typing`);
    }
    
    logger.debug(`User typing detected in chat ${chatId} (${messageBatch.messages.length} messages in batch)`);
    
  } else {
    // User stopped typing - set message timeout
    typingState.isTyping = false;
    
    // Set timeout to process messages after user stops typing
    if (messageBatch.messages.length > 0 && !messageBatch.processing) {
      // Clear any existing message timeout
      if (typingState.messageTimeout) {
        clearTimeout(typingState.messageTimeout);
      }
      
      typingState.messageTimeout = setTimeout(async () => {
        logger.debug(`Typing timeout reached, processing batch`);
        await processMessageBatch(sock, chatId);
      }, BATCH_CONFIG.TYPING_TIMEOUT);
      
      logger.debug(`User stopped typing, will process batch in ${BATCH_CONFIG.TYPING_TIMEOUT}ms`);
    }
  }
}

/**
 * Handle typing indicators for group chats
 * @param {Object} sock - Socket instance
 * @param {Object} update - Typing update object
 */
async function handleGroupTypingUpdate(sock, update) {
  const chatId = update.id;
  
  // In groups, presence updates contain info about specific users
  if (!update.presences) {
    logger.debug(`No presences in group typing update for ${chatId}`);
    return;
  }
  
  // Process typing updates for each user in the group
  for (const [userId, presence] of Object.entries(update.presences)) {
    if (userId === process.env.BOT_ID) {
      // Skip bot's own presence updates
      continue;
    }
    
    const isTyping = presence.lastKnownPresence === 'composing' || presence.lastKnownPresence === 'recording';
    
    // Initialize typing state for this user if needed
    initializeTypingState(chatId, userId);
    const typingState = getTypingState(chatId, userId);
    const messageBatch = getMessageBatch(chatId, userId);
    
    logger.debug(`Group typing update: ${userId} in ${chatId} - ${presence.lastKnownPresence} (isTyping: ${isTyping})`);
    
    if (isTyping) {
      // User started typing
      typingState.isTyping = true;
      typingState.lastTypingTime = Date.now();
      
      // Clear message timeout if they have a pending batch
      if (messageBatch && typingState.messageTimeout) {
        clearTimeout(typingState.messageTimeout);
        typingState.messageTimeout = null;
        logger.debug(`Cleared message timeout for ${userId} in group - user is actively typing`);
      }
      
      logger.debug(`User ${userId} typing in group ${chatId} (${messageBatch?.messages.length || 0} messages in batch)`);
    } else {
      // User stopped typing
      typingState.isTyping = false;
      
      // Set timeout to process messages if they have a pending batch
      if (messageBatch && messageBatch.messages.length > 0 && !messageBatch.processing) {
        if (typingState.messageTimeout) {
          clearTimeout(typingState.messageTimeout);
        }
        
        typingState.messageTimeout = setTimeout(async () => {
          logger.debug(`Group typing timeout reached for ${userId}, processing batch`);
          await processUserMessageBatch(sock, chatId, userId);
        }, BATCH_CONFIG.TYPING_TIMEOUT);
        
        logger.debug(`User ${userId} stopped typing in group, will process batch in ${BATCH_CONFIG.TYPING_TIMEOUT}ms`);
      }
    }
  }
}

/**
 * Get current batch status for a chat
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (optional, for groups)
 * @returns {Object|null} - Batch status or null if no batch
 */
function getBatchStatus(chatId, userId = null) {
  const isGroup = chatId.endsWith('@g.us');
  
  if (isGroup && userId) {
    // Group chat - get status for specific user
    const messageBatch = getMessageBatch(chatId, userId);
    const typingState = getTypingState(chatId, userId);
    
    if (!messageBatch) {
      return null;
    }
    
    return {
      messageCount: messageBatch.messages.length,
      startTime: messageBatch.startTime,
      processing: messageBatch.processing,
      isTyping: typingState?.isTyping || false,
      lastTypingTime: typingState?.lastTypingTime || null,
      userId: userId,
      isGroup: true
    };
  } else if (isGroup) {
    // Group chat - get status for all users
    const groupBatches = messageBatches.get(chatId);
    const groupStates = typingStates.get(chatId);
    
    if (!groupBatches || groupBatches.size === 0) {
      return null;
    }
    
    const userStatuses = {};
    for (const [userId, batch] of groupBatches.entries()) {
      const state = groupStates?.get(userId);
      userStatuses[userId] = {
        messageCount: batch.messages.length,
        startTime: batch.startTime,
        processing: batch.processing,
        isTyping: state?.isTyping || false,
        lastTypingTime: state?.lastTypingTime || null
      };
    }
    
    return {
      isGroup: true,
      userStatuses: userStatuses,
      totalActiveUsers: Object.keys(userStatuses).length
    };
  } else {
    // Personal chat - original behavior
    const messageBatch = messageBatches.get(chatId);
    const typingState = typingStates.get(chatId);
    
    if (!messageBatch) {
      return null;
    }
    
    return {
      messageCount: messageBatch.messages.length,
      startTime: messageBatch.startTime,
      processing: messageBatch.processing,
      isTyping: typingState?.isTyping || false,
      lastTypingTime: typingState?.lastTypingTime || null,
      isGroup: false
    };
  }
}

/**
 * Force process a batch (for testing or emergency)
 * @param {Object} sock - Socket instance
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (optional, for groups)
 */
async function forceProcessBatch(sock, chatId, userId = null) {
  const isGroup = chatId.endsWith('@g.us');
  
  if (isGroup && userId) {
    // Force process for specific user in group
    const messageBatch = getMessageBatch(chatId, userId);
    if (messageBatch && !messageBatch.processing) {
      logger.warning(`Force processing batch for user ${userId} in group ${chatId}`);
      await processUserMessageBatch(sock, chatId, userId);
    }
  } else if (isGroup) {
    // Force process for all users in group
    const groupBatches = messageBatches.get(chatId);
    if (groupBatches) {
      logger.warning(`Force processing batches for all users in group ${chatId}`);
      for (const [userId, batch] of groupBatches.entries()) {
        if (!batch.processing) {
          await processUserMessageBatch(sock, chatId, userId);
        }
      }
    }
  } else {
    // Personal chat - original behavior
    const messageBatch = messageBatches.get(chatId);
    if (messageBatch && !messageBatch.processing) {
      logger.warning(`Force processing batch for chat ${chatId}`);
      await processMessageBatch(sock, chatId);
    }
  }
}

export {
  handlePersonalChatMessage,
  handleGroupChatMessage,
  handleTypingUpdate,
  handleGroupTypingUpdate,
  getBatchStatus,
  forceProcessBatch,
  processUserMessageBatch,
  getTypingState,
  getMessageBatch,
  BATCH_CONFIG
};
