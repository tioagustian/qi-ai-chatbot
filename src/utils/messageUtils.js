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
    
    // For debug purposes, log the mentions and content
    console.log(`[TAG CHECK] Content: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    console.log(`[TAG CHECK] Bot ID: ${botId}, Bot Number: ${botNumber}, Base Number: ${baseNumber}, Bot Name: ${botName}`);
    
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

export {
  extractMessageContent,
  isGroupMessage,
  isTaggedMessage,
  getSenderInfo,
  getChatInfo
}; 