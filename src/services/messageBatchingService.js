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
 * Initialize typing state for a chat
 * @param {string} chatId - Chat ID
 */
function initializeTypingState(chatId) {
  if (!typingStates.has(chatId)) {
    typingStates.set(chatId, {
      isTyping: false,
      lastTypingTime: null,
      typingTimeout: null,
      processingTimeout: null,
      messageTimeout: null, // New timeout for message-based batching
      messageCount: 0,
      firstMessageTime: null
    });
  }
}

/**
 * Handle incoming message for personal chat batching
 * NOTE: This function should ONLY be called for personal chats (non-group messages)
 * Group detection is now handled in bot.js before calling this function
 * @param {Object} sock - Socket instance
 * @param {Object} message - Message object (must be from personal chat)
 */
async function handlePersonalChatMessage(sock, message) {
  const chatId = message.key.remoteJid;
  
  // Register user identity to map group and personal chat IDs
  const { registerUserIdentity, getAllUserIds } = await import('../utils/messageUtils.js');
  registerUserIdentity(message);
  
  // Get unified user information
  const userIds = getAllUserIds(chatId);
  logger.debug(`Processing personal chat message for ${chatId}`);
  logger.debug(`User identity: Phone ${userIds.phoneNumber}, Complete mapping: ${userIds.isComplete}`);
  
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
 * Handle typing indicators from users
 * @param {Object} sock - Socket instance
 * @param {Object} update - Typing update object
 */
async function handleTypingUpdate(sock, update) {
  const chatId = update.id;
  const isGroup = chatId.endsWith('@g.us');
  
  // Only handle typing updates for personal chats
  if (isGroup) {
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
 * Get current batch status for a chat
 * @param {string} chatId - Chat ID
 * @returns {Object|null} - Batch status or null if no batch
 */
function getBatchStatus(chatId) {
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
    lastTypingTime: typingState?.lastTypingTime || null
  };
}

/**
 * Force process a batch (for testing or emergency)
 * @param {Object} sock - Socket instance
 * @param {string} chatId - Chat ID
 */
async function forceProcessBatch(sock, chatId) {
  const messageBatch = messageBatches.get(chatId);
  
  if (messageBatch && !messageBatch.processing) {
    logger.warning(`Force processing batch for chat ${chatId}`);
    await processMessageBatch(sock, chatId);
  }
}

// Store group presence states for monitoring
const groupPresenceStates = new Map();

// Store group message batches for advanced batching
const groupMessageBatches = new Map();

// Group batching configuration
const GROUP_BATCH_CONFIG = {
  minWaitTime: 2000,      // Minimum wait time after last message (2 seconds)
  maxWaitTime: 15000,     // Maximum wait time for batch (15 seconds)
  typingTimeout: 5000,    // How long to wait after typing stops (5 seconds)
  maxBatchSize: 10,       // Maximum messages per batch
  processingDelay: 1000   // Initial delay before starting batch timer (1 second)
};

/**
 * Initialize group presence tracking for a specific group
 * @param {string} groupId - Group chat ID
 */
function initializeGroupPresence(groupId) {
  if (!groupPresenceStates.has(groupId)) {
    groupPresenceStates.set(groupId, {
      activeMembers: new Map(), // memberId -> { lastSeen, status, lastActivity }
      lastPresenceUpdate: null,
      messageCount: 0,
      createdAt: Date.now()
    });
    logger.debug(`Initialized presence tracking for group ${groupId}`);
  }
}

/**
 * Initialize group message batching for a specific group
 * @param {string} groupId - Group chat ID
 */
function initializeGroupBatch(groupId) {
  if (!groupMessageBatches.has(groupId)) {
    groupMessageBatches.set(groupId, {
      messages: [],
      senderStates: new Map(), // senderId -> { isTyping, lastTypingTime, messageCount }
      startTime: Date.now(),
      lastMessageTime: null,
      processing: false,
      processingTimeout: null,
      typingTimeouts: new Map(), // senderId -> timeout
      batchTimeout: null
    });
    logger.debug(`Initialized group batch for ${groupId}`);
  }
}

/**
 * Handle presence updates in group chats with batch integration
 * @param {Object} sock - Socket instance
 * @param {Object} update - Presence update object
 */
async function handleGroupPresenceUpdate(sock, update) {
  const groupId = update.id;
  
  // Only handle group presence updates
  if (!groupId.endsWith('@g.us')) {
    return;
  }
  
  console.log(`[GROUP-PRESENCE][${new Date().toISOString()}] Received presence update for group ${groupId}`);
  console.log(`[GROUP-PRESENCE] Update details:`, JSON.stringify(update, null, 2));
  
  // Initialize presence tracking and batching if not exists
  initializeGroupPresence(groupId);
  initializeGroupBatch(groupId);
  
  const groupState = groupPresenceStates.get(groupId);
  const groupBatch = groupMessageBatches.get(groupId);
  
  // Update last presence update time
  groupState.lastPresenceUpdate = Date.now();
  
  // Process presence data if available
  if (update.presences) {
    console.log(`[GROUP-PRESENCE] Processing ${Object.keys(update.presences).length} presence updates`);
    
    Object.entries(update.presences).forEach(([memberId, presence]) => {
      const memberInfo = {
        lastSeen: Date.now(),
        status: presence.lastKnownPresence || 'unknown',
        lastActivity: presence.lastKnownPresence,
        timestamp: new Date().toISOString()
      };
      
      // Store/update member presence
      groupState.activeMembers.set(memberId, memberInfo);
      
      console.log(`[GROUP-PRESENCE] Member ${memberId}: ${presence.lastKnownPresence || 'unknown'}`);
      
      // Update batch sender states for typing detection
      const currentTime = Date.now();
      const isTyping = ['composing', 'recording'].includes(presence.lastKnownPresence);
      const isAvailable = presence.lastKnownPresence === 'available';
      
      // Get or create sender state
      let senderState = groupBatch.senderStates.get(memberId);
      if (!senderState) {
        senderState = {
          isTyping: false,
          lastTypingTime: null,
          messageCount: 0,
          lastActivity: currentTime
        };
        groupBatch.senderStates.set(memberId, senderState);
      }
      
      // Clear existing typing timeout for this sender
      if (groupBatch.typingTimeouts.has(memberId)) {
        clearTimeout(groupBatch.typingTimeouts.get(memberId));
        groupBatch.typingTimeouts.delete(memberId);
      }
      
      if (isTyping) {
        senderState.isTyping = true;
        senderState.lastTypingTime = currentTime;
        senderState.lastActivity = currentTime;
        console.log(`[GROUP-BATCH] ${memberId} started typing, extending batch wait`);
        
        // Extend batch timeout while someone is typing
        updateGroupBatchTimeout(sock, groupId);
        
      } else if (isAvailable) {
        senderState.isTyping = false;
        senderState.lastActivity = currentTime;
        console.log(`[GROUP-BATCH] ${memberId} stopped typing, setting typing timeout`);
        
        // Set a timeout to process batch if this was the last person typing
        const typingTimeout = setTimeout(() => {
          checkAndProcessGroupBatch(sock, groupId);
        }, GROUP_BATCH_CONFIG.typingTimeout);
        
        groupBatch.typingTimeouts.set(memberId, typingTimeout);
      }
      
      // Log specific presence types
      switch (presence.lastKnownPresence) {
        case 'composing':
          console.log(`[GROUP-PRESENCE] 📝 ${memberId} is typing in group ${groupId}`);
          break;
        case 'recording':
          console.log(`[GROUP-PRESENCE] 🎤 ${memberId} is recording voice message in group ${groupId}`);
          break;
        case 'paused':
          console.log(`[GROUP-PRESENCE] ⏸️ ${memberId} paused typing in group ${groupId}`);
          break;
        case 'available':
          console.log(`[GROUP-PRESENCE] ✅ ${memberId} is online in group ${groupId}`);
          break;
        case 'unavailable':
          console.log(`[GROUP-PRESENCE] ❌ ${memberId} went offline in group ${groupId}`);
          break;
        default:
          console.log(`[GROUP-PRESENCE] ❓ ${memberId} presence: ${presence.lastKnownPresence || 'unknown'} in group ${groupId}`);
      }
    });
    
    // Log group activity summary
    const activeCount = Array.from(groupState.activeMembers.values())
      .filter(member => ['composing', 'recording', 'available'].includes(member.status)).length;
    
    console.log(`[GROUP-PRESENCE] Group ${groupId} activity summary: ${activeCount} active members out of ${groupState.activeMembers.size} tracked`);
  }
  
  // Log participants info if available
  if (update.participants) {
    console.log(`[GROUP-PRESENCE] Participants data available for ${update.participants.length} members`);
    update.participants.forEach(participant => {
      console.log(`[GROUP-PRESENCE] Participant: ${participant}`);
    });
  }
}

/**
 * Get group presence statistics
 * @param {string} groupId - Group chat ID
 * @returns {Object} - Presence statistics
 */
function getGroupPresenceStats(groupId) {
  const groupState = groupPresenceStates.get(groupId);
  if (!groupState) {
    return null;
  }
  
  const now = Date.now();
  const recentActiveMembers = Array.from(groupState.activeMembers.entries())
    .filter(([_, member]) => (now - member.lastSeen) < 300000) // Active in last 5 minutes
    .map(([memberId, _]) => memberId);
  
  return {
    groupId,
    totalTrackedMembers: groupState.activeMembers.size,
    recentActiveMembers: recentActiveMembers.length,
    lastPresenceUpdate: groupState.lastPresenceUpdate,
    messageCount: groupState.messageCount,
    trackingDuration: now - groupState.createdAt
  };
}

/**
 * Update group batch timeout based on current activity
 * @param {Object} sock - Socket instance
 * @param {string} groupId - Group chat ID
 */
function updateGroupBatchTimeout(sock, groupId) {
  const groupBatch = groupMessageBatches.get(groupId);
  if (!groupBatch || groupBatch.processing) {
    return;
  }
  
  // Clear existing timeout
  if (groupBatch.batchTimeout) {
    clearTimeout(groupBatch.batchTimeout);
  }
  
  // Check if anyone is currently typing
  const someoneTyping = Array.from(groupBatch.senderStates.values())
    .some(state => state.isTyping);
  
  if (someoneTyping) {
    // Extend timeout while someone is typing
    const extendedTimeout = setTimeout(() => {
      processGroupMessageBatch(sock, groupId);
    }, GROUP_BATCH_CONFIG.maxWaitTime);
    
    groupBatch.batchTimeout = extendedTimeout;
    console.log(`[GROUP-BATCH] Extended batch timeout for ${groupId} (someone typing)`);
  } else {
    // No one typing, use minimum wait time
    const minTimeout = setTimeout(() => {
      processGroupMessageBatch(sock, groupId);
    }, GROUP_BATCH_CONFIG.minWaitTime);
    
    groupBatch.batchTimeout = minTimeout;
    console.log(`[GROUP-BATCH] Set minimum batch timeout for ${groupId} (no one typing)`);
  }
}

/**
 * Check if group batch should be processed
 * @param {Object} sock - Socket instance
 * @param {string} groupId - Group chat ID
 */
function checkAndProcessGroupBatch(sock, groupId) {
  const groupBatch = groupMessageBatches.get(groupId);
  if (!groupBatch || groupBatch.processing || groupBatch.messages.length === 0) {
    return;
  }
  
  // Check if anyone is still typing
  const someoneStillTyping = Array.from(groupBatch.senderStates.values())
    .some(state => state.isTyping && (Date.now() - state.lastTypingTime) < GROUP_BATCH_CONFIG.typingTimeout);
  
  if (someoneStillTyping) {
    console.log(`[GROUP-BATCH] Delaying batch processing for ${groupId} - someone still typing`);
    updateGroupBatchTimeout(sock, groupId);
    return;
  }
  
  console.log(`[GROUP-BATCH] All typing stopped, processing batch for ${groupId}`);
  processGroupMessageBatch(sock, groupId);
}

/**
 * Process group message batch with unified user identity and advanced context
 * @param {Object} sock - Socket instance
 * @param {string} groupId - Group chat ID
 */
async function processGroupMessageBatch(sock, groupId) {
  const groupBatch = groupMessageBatches.get(groupId);
  if (!groupBatch || groupBatch.processing || groupBatch.messages.length === 0) {
    return;
  }
  
  console.log(`[GROUP-BATCH] Starting batch processing for ${groupId} with ${groupBatch.messages.length} messages`);
  
  // Mark as processing
  groupBatch.processing = true;
  
  // Clear all timeouts
  if (groupBatch.batchTimeout) {
    clearTimeout(groupBatch.batchTimeout);
    groupBatch.batchTimeout = null;
  }
  
  groupBatch.typingTimeouts.forEach(timeout => clearTimeout(timeout));
  groupBatch.typingTimeouts.clear();
  
  try {
    const { registerUserIdentity, getAllUserIds, getUnifiedUserId } = await import('../utils/messageUtils.js');
    const { processMessage } = await import('../handlers/messageHandler.js');
    
    console.log(`[GROUP-BATCH] Processing ${groupBatch.messages.length} messages in batch`);
    
    // Process each message with enhanced context
    for (let i = 0; i < groupBatch.messages.length; i++) {
      const message = groupBatch.messages[i];
      const isLastMessage = i === groupBatch.messages.length - 1;
      
      // Register user identity for unified tracking
      registerUserIdentity(message);
      
      // Add batch metadata to the message
      message.batchMetadata = {
        isBatchedMessage: true,
        batchPosition: i + 1,
        totalInBatch: groupBatch.messages.length,
        isLastInBatch: isLastMessage,
        batchStartTime: groupBatch.startTime,
        batchType: 'group',
        groupId: groupId
      };
      
      // Get unified user info
      const sender = message.key.participant || message.key.remoteJid;
      const userIds = getAllUserIds(sender);
      const unifiedUserId = getUnifiedUserId(sender);
      
      console.log(`[GROUP-BATCH] Processing message ${i + 1}/${groupBatch.messages.length} from ${userIds.displayName || 'Unknown'} (${unifiedUserId})`);
      
      // Add other messages in batch as context
      if (groupBatch.messages.length > 1) {
        const otherMessages = groupBatch.messages
          .filter((_, index) => index !== i)
          .map((msg, index) => {
            const msgSender = msg.key.participant || msg.key.remoteJid;
            const msgUserIds = getAllUserIds(msgSender);
            const content = msg.message?.conversation || 
                           msg.message?.extendedTextMessage?.text || 
                           msg.message?.imageMessage?.caption || 
                           '[Media message]';
            
            return {
              position: index < i ? index + 1 : index + 2, // Adjust position relative to current
              content: content,
              sender: msgUserIds.displayName || msgSender.split('@')[0],
              unifiedUserId: getUnifiedUserId(msgSender),
              timestamp: msg.messageTimestamp
            };
          });
        
        message.batchMetadata.otherMessagesInBatch = otherMessages;
      } else {
        // Single message in batch - set empty array to avoid undefined errors
        message.batchMetadata.otherMessagesInBatch = [];
      }
      
      // Process the message
      await processMessage(sock, message);
      
      // Small delay between processing messages in batch
      if (!isLastMessage) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    console.log(`[GROUP-BATCH] Completed batch processing for ${groupId}`);
    
  } catch (error) {
    console.error(`[GROUP-BATCH] Error processing batch for ${groupId}:`, error);
  } finally {
    // Reset batch
    groupBatch.messages = [];
    groupBatch.senderStates.clear();
    groupBatch.startTime = Date.now();
    groupBatch.lastMessageTime = null;
    groupBatch.processing = false;
  }
}

/**
 * Group message handler with advanced presence monitoring and batching
 * This function handles group messages with group-specific optimizations
 * @param {Object} sock - Socket instance
 * @param {Object} message - Message object (must be from group chat)
 */
async function handleGroupChatMessage(sock, message) {
  const chatId = message.key.remoteJid;
  const sender = message.key.participant || message.key.remoteJid;
  
  // Initialize presence tracking and batching for this group
  initializeGroupPresence(chatId);
  initializeGroupBatch(chatId);
  
  const groupState = groupPresenceStates.get(chatId);
  const groupBatch = groupMessageBatches.get(chatId);
  
  // Increment message count
  groupState.messageCount++;
  
  // Register user identity to map group and personal chat IDs
  const { registerUserIdentity, getAllUserIds, getUnifiedUserId } = await import('../utils/messageUtils.js');
  registerUserIdentity(message);
  
  // Get unified user information
  const userIds = getAllUserIds(sender);
  const unifiedUserId = getUnifiedUserId(sender);
  
  // Log group message with presence context
  const presenceStats = getGroupPresenceStats(chatId);
  console.log(`[GROUP-MSG][${new Date().toISOString()}] Message from ${userIds.displayName || 'Unknown'} (${unifiedUserId}) in group ${chatId}`);
  console.log(`[GROUP-MSG] Group stats: ${presenceStats.recentActiveMembers} active, ${presenceStats.totalTrackedMembers} tracked members`);
  console.log(`[GROUP-MSG] User identity: Phone ${userIds.phoneNumber}, Complete mapping: ${userIds.isComplete}`);
  
  // Update sender's presence info (they're obviously active if sending a message)
  if (groupState.activeMembers.has(sender)) {
    const senderInfo = groupState.activeMembers.get(sender);
    senderInfo.lastSeen = Date.now();
    senderInfo.lastActivity = 'messaging';
    senderInfo.status = 'available';
  } else {
    groupState.activeMembers.set(sender, {
      lastSeen: Date.now(),
      status: 'available',
      lastActivity: 'messaging',
      timestamp: new Date().toISOString()
    });
  }
  
  // Update sender state in batch
  let senderState = groupBatch.senderStates.get(sender);
  if (!senderState) {
    senderState = {
      isTyping: false,
      lastTypingTime: null,
      messageCount: 0,
      lastActivity: Date.now()
    };
    groupBatch.senderStates.set(sender, senderState);
  }
  
  // Increment message count for this sender
  senderState.messageCount++;
  senderState.lastActivity = Date.now();
  senderState.isTyping = false; // They just sent a message, so they're not typing anymore
  
  // Add message to batch
  groupBatch.messages.push(message);
  groupBatch.lastMessageTime = Date.now();
  
  // If this is the first message in the batch, set start time
  if (groupBatch.messages.length === 1) {
    groupBatch.startTime = Date.now();
    console.log(`[GROUP-BATCH] Started new batch for group ${chatId}`);
  }
  
  console.log(`[GROUP-BATCH] Added message to batch (${groupBatch.messages.length}/${GROUP_BATCH_CONFIG.maxBatchSize}) from ${userIds.displayName || 'Unknown'}`);
  
  // Clear existing timeouts for this sender (they just sent a message)
  if (groupBatch.typingTimeouts.has(sender)) {
    clearTimeout(groupBatch.typingTimeouts.get(sender));
    groupBatch.typingTimeouts.delete(sender);
  }
  
  // Check if we should process immediately due to batch size limit
  if (groupBatch.messages.length >= GROUP_BATCH_CONFIG.maxBatchSize) {
    console.log(`[GROUP-BATCH] Batch size limit reached for ${chatId}, processing immediately`);
    await processGroupMessageBatch(sock, chatId);
    return;
  }
  
  // Set timeout to process batch
  updateGroupBatchTimeout(sock, chatId);
  
  // Log message content for debugging (shortened)
  const content = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || 
                 message.message?.imageMessage?.caption || 
                 '[Media message]';
  
  console.log(`[GROUP-BATCH] Message content: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
}

export {
  handlePersonalChatMessage,
  handleGroupChatMessage,
  handleGroupPresenceUpdate,
  handleTypingUpdate,
  getBatchStatus,
  forceProcessBatch,
  getGroupPresenceStats,
  processGroupMessageBatch,
  BATCH_CONFIG,
  GROUP_BATCH_CONFIG
};
