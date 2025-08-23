// Extract the text content from a WhatsApp message
function extractMessageContent(message) {
  if (!message || !message.message) {
    return null;
  }

  const messageTypes = [
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'documentMessage',
    'audioMessage',
    'stickerMessage'
  ];

  let content = null;

  for (const type of messageTypes) {
    if (message.message[type]) {
      switch (type) {
        case 'conversation':
          content = message.message.conversation;
          break;

        case 'extendedTextMessage':
          content = message.message.extendedTextMessage.text;
          break;

        case 'imageMessage':
        case 'videoMessage':
        case 'documentMessage':
        case 'audioMessage':
        case 'stickerMessage':
          // Get caption if available
          content = message.message[type].caption || `[${type}]`;
          break;

        default:
          content = `[${type}]`;
      }

      break;
    }
  }

  return content;
}

/**
 * Check if message contains an image
 * @param {Object} message - The message object
 * @returns {Boolean} - Whether the message contains an image
 */
function hasImage(message) {
  if (!message || !message.message) {
    return false;
  }
  
  return !!message.message.imageMessage || 
         (message.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage);
}

/**
 * Extract image data from message
 * @param {Object} message - The message object
 * @returns {Object|null} - Image data object or null if no image
 */
function extractImageData(message) {
  if (!hasImage(message)) {
    return null;
  }
  
  try {
    // Check if the message directly contains an image
    if (message.message.imageMessage) {
      return {
        mimetype: message.message.imageMessage.mimetype,
        caption: message.message.imageMessage.caption || '',
        url: null, // Will be filled by the download function
        messageType: 'direct',
        messageData: message.message.imageMessage
      };
    }
    
    // Check if it's a quoted message containing an image
    if (message.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
      const quotedImage = message.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
      return {
        mimetype: quotedImage.mimetype,
        caption: quotedImage.caption || '',
        url: null, // Will be filled by the download function
        messageType: 'quoted',
        messageData: quotedImage
      };
    }
    
    return null;
  } catch (error) {
    console.error('[IMAGE EXTRACTION ERROR]', error);
    return null;
  }
}

// Check if message is from a group
function isGroupMessage(message) {
  if (!message || !message.key) {
    return false;
  }
  
  return message.key.remoteJid?.endsWith('@g.us') || false;
}

/**
 * Check if the bot is tagged or mentioned in a message
 * @param {Object} message - The message object
 * @param {String} botName - The bot's name
 * @returns {Boolean} - Whether the bot is tagged
 */
function isTaggedMessage(message, botName) {
  try {
    const botId = process.env.BOT_ID || '';
    const botNumber = botId.split('@')[0]; // This includes the session ID suffix like "6285155001880:31"
    const baseNumber = botNumber.split(':')[0]; // Extract just the phone number without session ID
    
    // Get the message content
    const content = extractMessageContent(message);
    if (!content) return false;
    
    // Check for direct mentions in the message object
    if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
      const mentions = message.message.extendedTextMessage.contextInfo.mentionedJid;
      console.log(`[TAG CHECK] Mentions found: ${JSON.stringify(mentions)}`);
      
      // Check if any of the mentions includes the base bot number
      const isMentioned = mentions.some(mention => mention.includes(baseNumber));
      console.log(`[TAG CHECK] Base number: ${baseNumber}, mention check result: ${isMentioned}`);
      console.log(`[TAG CHECK] Mention detection method: ${mentions.some(m => m.includes(baseNumber) ? `Found in: ${m}` : 'Not found')}`);
      
      if (isMentioned) {
        console.log('[TAG CHECK] Bot was directly mentioned in mentionedJid');
        return true;
      }
    }
    
    // Check for @mentions in text format (e.g. @62812345678)
    // Use the base number without session ID for matching
    const mentionPattern = new RegExp(`@${baseNumber}\\b`, 'i');
    if (mentionPattern.test(content)) {
      console.log('[TAG CHECK] Bot number was mentioned with @ pattern');
      return true;
    }
    
    // Check if the bot's name is mentioned in the content
    // Case insensitive search for the bot name
    if (botName && content.toLowerCase().includes(botName.toLowerCase())) {
      console.log(`[TAG CHECK] Bot name "${botName}" was mentioned in content`);
      return true;
    }
    
    // Additional check for unformatted number mentions (without @)
    // This helps catch cases where the user just types the number
    if (baseNumber && content.includes(baseNumber)) {
      console.log('[TAG CHECK] Bot number was mentioned without @ pattern');
      return true;
    }
    
    // If all checks fail, the bot is not tagged
    console.log('[TAG CHECK] Bot was not tagged in this message');
    return false;
  } catch (error) {
    console.error('[TAG CHECK ERROR]', error);
    // Default to false if there's an error in tag detection
    return false;
  }
}

// Get sender information from message
function getSenderInfo(message) {
  const sender = message.key.participant || message.key.remoteJid;
  const pushName = message.pushName || sender.split('@')[0];
  console.log(message);
  return {
    jid: sender,
    name: pushName
  };
}

// Get chat information from message
function getChatInfo(message) {
  const chatId = message.key.remoteJid;
  const isGroup = isGroupMessage(message);
  
  return {
    id: chatId,
    isGroup
  };
}

/**
 * Calculate a human-like response delay based on message length and complexity
 * @param {string} message - The message content
 * @param {string} response - The AI-generated response
 * @param {Object} options - Configuration options
 * @returns {number} - Delay in milliseconds
 */
function calculateResponseDelay(message, response, options = {}) {
  try {
    // Default options
    const config = {
      minDelay: options.minDelay || 1000, // Minimum delay in ms (1 second)
      maxDelay: options.maxDelay || 5000, // Maximum delay in ms (5 seconds)
      readingSpeed: options.readingSpeed || 30, // Characters per second for reading
      typingSpeed: options.typingSpeed || 15, // Characters per second for typing
      thinkingTime: options.thinkingTime || 1.5, // Multiplier for thinking time
      privateChat: options.privateChat || false, // Whether this is a private chat
      wordCount: options.wordCount || false, // Calculate based on words instead of chars
      humanVariability: options.humanVariability !== undefined ? options.humanVariability : true // Add human variability
    };
    
    // Calculate reading time (how long it would take a human to read the message)
    const messageLength = message?.length || 0;
    const messageParts = message?.split(/\s+/) || [];
    const wordCount = messageParts.length;
    
    // Reading time calculation (using either character or word count)
    let readingTime;
    if (config.wordCount) {
      // Average person reads about 200-250 words per minute (3-4 words per second)
      readingTime = (wordCount / 3.5) * 1000; // Convert to milliseconds
    } else {
      // Character-based calculation
      readingTime = (messageLength / config.readingSpeed) * 1000; // Convert to milliseconds
    }
    
    // Cap reading time at a reasonable value
    readingTime = Math.min(readingTime, 3000); // Cap at 3 seconds
    
    // Calculate typing time (how long it would take to type the response)
    const responseLength = response?.length || 0;
    const responseWords = response?.split(/\s+/)?.length || 0;
    
    // Human-like typing speed varies based on response type/complexity
    let typingSpeed = config.typingSpeed;
    
    // Adjust typing speed based on content
    if (responseLength < 50) {
      // Short responses are typed faster
      typingSpeed = config.typingSpeed * 1.3;
    } else if (responseLength > 200) {
      // Long responses are typed slower (fatigue)
      typingSpeed = config.typingSpeed * 0.9;
    }
    
    // Calculate typing time with adjusted speed
    const typingTime = (responseLength / typingSpeed) * 1000; // Convert to milliseconds
    
    // Cap typing time at a more realistic value based on message length
    const typingCap = Math.min(5000 + (responseWords * 20), 12000); // Cap longer for longer responses
    const cappedTypingTime = Math.min(typingTime, typingCap);
    
    // Add thinking time - simulates human thinking before responding
    // More complex/longer messages need more thinking time
    const complexityFactor = Math.min(
      wordCount > 0 ? wordCount / 10 : messageLength / 50, 
      2.0
    ); 
    
    // Add "understanding complexity" - longer/complex responses need more thinking time
    const responseComplexity = Math.min(responseWords / 15, 1.5);
    
    // Combined thinking time includes both message and response complexity
    const thinkingTime = config.thinkingTime * 1000 * (complexityFactor + responseComplexity) / 2;
    
    // Combine all times - we only consider part of typing time since typing indicator will be shown
    let totalDelay = readingTime + thinkingTime + (cappedTypingTime / 3.5); 
    
    // Reduce delay for private chats to be more responsive
    if (config.privateChat) {
      totalDelay = totalDelay * 0.7;
    }
    
    // Add human-like inconsistency
    if (config.humanVariability) {
      // Humans aren't machines - timing varies based on attention, mood, etc.
      // Sometimes we reply quickly, sometimes we take longer even for simple messages
      // Add a weighted random factor that tends more toward being slower than faster
      const variabilityFactor = Math.random() * Math.random(); // Weighted toward smaller values
      const isQuicker = Math.random() > 0.7; // 30% chance of being quicker
      
      if (isQuicker) {
        // Occasionally we reply more quickly than expected
        totalDelay = totalDelay * (1 - variabilityFactor * 0.3); // Up to 30% faster
      } else {
        // More often we're a bit slower than expected
        totalDelay = totalDelay * (1 + variabilityFactor * 0.5); // Up to 50% slower
      }
    } else {
      // Still add a small random factor even without full human variability
      const randomFactor = Math.random() * 0.2 + 0.9; // 0.9 to 1.1
      totalDelay = totalDelay * randomFactor;
    }
    
    // Add logging to help debug
    console.log(`[DELAY] Message length: ${messageLength} chars, ${wordCount} words`);
    console.log(`[DELAY] Response length: ${responseLength} chars, ${responseWords} words`);
    console.log(`[DELAY] Reading time: ${Math.round(readingTime)}ms, Thinking time: ${Math.round(thinkingTime)}ms, Typing time (partial): ${Math.round(cappedTypingTime/3.5)}ms`);
    console.log(`[DELAY] Total delay (before min/max): ${Math.round(totalDelay)}ms`);
    
    // Ensure delay is within min and max bounds
    const finalDelay = Math.max(config.minDelay, Math.min(config.maxDelay, Math.round(totalDelay)));
    console.log(`[DELAY] Final delay: ${finalDelay}ms`);
    
    return finalDelay;
  } catch (error) {
    console.error('Error calculating response delay:', error);
    return 2000; // Default to 2 seconds in case of error
  }
}

/**
 * User identity mapping to link group participant IDs with personal chat IDs
 * Format: { phoneNumber: { personalId, groupId, lastSeen, displayName } }
 */
const userIdentityMap = new Map();

/**
 * Extract phone number from WhatsApp ID (works for both formats)
 * @param {string} whatsappId - WhatsApp ID in any format
 * @returns {string|null} - Extracted phone number or null
 */
function extractPhoneNumber(whatsappId) {
  if (!whatsappId) return null;
  
  // For personal chat format: "6282111182808@s.whatsapp.net"
  const personalMatch = whatsappId.match(/^(\d+)@s\.whatsapp\.net$/);
  if (personalMatch) {
    return personalMatch[1];
  }
  
  // For group participant format: "275363422859280@lid"
  const groupMatch = whatsappId.match(/^(\d+)@lid$/);
  if (groupMatch) {
    return groupMatch[1];
  }
  
  // For other formats, try to extract any number sequence
  const generalMatch = whatsappId.match(/^(\d+)@/);
  if (generalMatch) {
    return generalMatch[1];
  }
  
  return null;
}

/**
 * Get unified user ID based on phone number
 * @param {string} whatsappId - WhatsApp ID in any format
 * @returns {string|null} - Unified user ID (phone number) or null
 */
function getUnifiedUserId(whatsappId) {
  return extractPhoneNumber(whatsappId);
}

/**
 * Register user identity from message
 * @param {Object} message - Message object
 * @param {Object} options - Additional options
 */
function registerUserIdentity(message, options = {}) {
  try {
    const isGroup = isGroupMessage(message);
    const displayName = message.pushName || options.displayName || 'Unknown';
    
    let whatsappId, chatContext;
    
    if (isGroup) {
      // Group message
      whatsappId = message.key.participant || message.key.remoteJid;
      chatContext = 'group';
    } else {
      // Personal chat
      whatsappId = message.key.remoteJid;
      chatContext = 'personal';
    }
    
    const phoneNumber = extractPhoneNumber(whatsappId);
    if (!phoneNumber) {
      console.log(`[USER-ID] Could not extract phone number from: ${whatsappId}`);
      return;
    }
    
    // Get or create user identity record
    let userIdentity = userIdentityMap.get(phoneNumber);
    if (!userIdentity) {
      userIdentity = {
        phoneNumber,
        personalId: null,
        groupId: null,
        lastSeen: Date.now(),
        displayName,
        firstSeenContext: chatContext,
        lastSeenContext: chatContext
      };
      userIdentityMap.set(phoneNumber, userIdentity);
      console.log(`[USER-ID] Registered new user identity for phone ${phoneNumber} (${displayName})`);
    }
    
    // Update the appropriate ID field
    if (isGroup) {
      if (!userIdentity.groupId) {
        userIdentity.groupId = whatsappId;
        console.log(`[USER-ID] Linked group ID ${whatsappId} to phone ${phoneNumber}`);
      }
    } else {
      if (!userIdentity.personalId) {
        userIdentity.personalId = whatsappId;
        console.log(`[USER-ID] Linked personal ID ${whatsappId} to phone ${phoneNumber}`);
      }
    }
    
    // Update common fields
    userIdentity.lastSeen = Date.now();
    userIdentity.lastSeenContext = chatContext;
    userIdentity.displayName = displayName; // Update display name in case it changed
    
    // Log the mapping if both IDs are now available
    if (userIdentity.personalId && userIdentity.groupId) {
      console.log(`[USER-ID] ✅ Complete identity mapping for ${displayName} (${phoneNumber}):`);
      console.log(`[USER-ID]   Personal: ${userIdentity.personalId}`);
      console.log(`[USER-ID]   Group: ${userIdentity.groupId}`);
    }
    
  } catch (error) {
    console.error('[USER-ID] Error registering user identity:', error);
  }
}

/**
 * Get complete user identity by any WhatsApp ID
 * @param {string} whatsappId - WhatsApp ID in any format
 * @returns {Object|null} - Complete user identity or null
 */
function getUserIdentity(whatsappId) {
  const phoneNumber = extractPhoneNumber(whatsappId);
  if (!phoneNumber) return null;
  
  return userIdentityMap.get(phoneNumber) || null;
}

/**
 * Get all known IDs for a user
 * @param {string} whatsappId - WhatsApp ID in any format
 * @returns {Object} - Object with personalId and groupId
 */
function getAllUserIds(whatsappId) {
  const identity = getUserIdentity(whatsappId);
  return {
    phoneNumber: identity?.phoneNumber || null,
    personalId: identity?.personalId || null,
    groupId: identity?.groupId || null,
    displayName: identity?.displayName || null,
    isComplete: !!(identity?.personalId && identity?.groupId)
  };
}

/**
 * Check if two WhatsApp IDs belong to the same user
 * @param {string} id1 - First WhatsApp ID
 * @param {string} id2 - Second WhatsApp ID
 * @returns {boolean} - True if same user
 */
function isSameUser(id1, id2) {
  if (!id1 || !id2) return false;
  if (id1 === id2) return true; // Exact match
  
  const phone1 = extractPhoneNumber(id1);
  const phone2 = extractPhoneNumber(id2);
  
  return phone1 && phone2 && phone1 === phone2;
}

/**
 * Get user statistics for debugging
 * @returns {Object} - Statistics about mapped users
 */
function getUserMappingStats() {
  const stats = {
    totalUsers: userIdentityMap.size,
    usersWithBothIds: 0,
    usersWithPersonalOnly: 0,
    usersWithGroupOnly: 0,
    recentlyActive: 0
  };
  
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  userIdentityMap.forEach(identity => {
    if (identity.personalId && identity.groupId) {
      stats.usersWithBothIds++;
    } else if (identity.personalId) {
      stats.usersWithPersonalOnly++;
    } else if (identity.groupId) {
      stats.usersWithGroupOnly++;
    }
    
    if (identity.lastSeen > oneHourAgo) {
      stats.recentlyActive++;
    }
  });
  
  return stats;
}

export {
  extractMessageContent,
  isGroupMessage,
  isTaggedMessage,
  getSenderInfo,
  getChatInfo,
  calculateResponseDelay,
  hasImage,
  extractImageData,
  extractPhoneNumber,
  getUnifiedUserId,
  registerUserIdentity,
  getUserIdentity,
  getAllUserIds,
  isSameUser,
  getUserMappingStats
}; 