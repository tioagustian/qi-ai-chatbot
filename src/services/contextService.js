// Maximum number of messages to keep in context memory per chat
const MAX_CONTEXT_MESSAGES = 50;

// Maximum number of relevant messages to return for AI prompt
const MAX_RELEVANT_MESSAGES = 15;

// Maximum number of cross-chat context messages to include
const MAX_CROSS_CHAT_MESSAGES = 5;

// Maximum number of participants to include in introductions
const MAX_PARTICIPANTS_INTRO = 10;

// Update context with new message
async function updateContext(db, chatId, sender, content, message) {
  try {
    // Get chat type (group or private)
    const isGroup = chatId.endsWith('@g.us');
    const chatType = isGroup ? 'group' : 'private';
    
    // Get better group name for group chats if available
    let chatName = isGroup ? 'Group Chat' : 'Private Chat';
    
    // Try to get the group name from the message if available
    if (isGroup && message.key && message.key.remoteJid) {
      if (message.pushName) {
        // This might be the group name in some versions of the API
        chatName = message.pushName;
      }
      
      // Try to get from message context info
      if (message.message && 
          message.message.extendedTextMessage && 
          message.message.extendedTextMessage.contextInfo &&
          message.message.extendedTextMessage.contextInfo.participant) {
        // Might contain group name or chat info
        if (message.message.extendedTextMessage.contextInfo.quotedMessage &&
            message.message.extendedTextMessage.contextInfo.quotedMessage.conversation) {
          // Sometimes group name is here
          chatName = message.message.extendedTextMessage.contextInfo.quotedMessage.conversation;
        }
      }
    }
    
    // Initialize conversations object for this chat if doesn't exist
    if (!db.data.conversations[chatId]) {
      db.data.conversations[chatId] = {
        messages: [],
        participants: {},
        lastActive: new Date().toISOString(),
        chatType: chatType,
        chatName: chatName,
        hasIntroduced: false,
        lastIntroduction: null
      };
    } else {
      // Update the chat name if needed
      if (isGroup && chatName !== 'Group Chat' && db.data.conversations[chatId].chatName === 'Group Chat') {
        db.data.conversations[chatId].chatName = chatName;
      }
    }
    
    // Get user name if available (from pushName)
    const userName = message.pushName || sender.split('@')[0];
    
    // Update participants info
    if (!db.data.conversations[chatId].participants[sender]) {
      db.data.conversations[chatId].participants[sender] = {
        id: sender,
        name: userName,
        messageCount: 0,
        firstSeen: new Date().toISOString(),
        lastMessage: content,
        lastActive: new Date().toISOString()
      };
    } else {
      // Update participant's activity
      db.data.conversations[chatId].participants[sender].lastActive = new Date().toISOString();
      db.data.conversations[chatId].participants[sender].lastMessage = content;
      
      // Update name if it has changed
      if (userName && userName !== db.data.conversations[chatId].participants[sender].name) {
        db.data.conversations[chatId].participants[sender].name = userName;
      }
    }
    
    // Increment message count for this participant
    db.data.conversations[chatId].participants[sender].messageCount++;
    
    // Add message to conversation history
    const contextMessage = {
      id: message.key.id,
      sender,
      name: userName,
      content,
      timestamp: new Date().toISOString(),
      role: sender === process.env.BOT_ID ? 'assistant' : 'user',
      chatType: chatType
    };
    
    db.data.conversations[chatId].messages.push(contextMessage);
    
    // Limit the size of the conversation history
    if (db.data.conversations[chatId].messages.length > MAX_CONTEXT_MESSAGES) {
      db.data.conversations[chatId].messages = db.data.conversations[chatId].messages.slice(-MAX_CONTEXT_MESSAGES);
    }
    
    // Update last active timestamp
    db.data.conversations[chatId].lastActive = new Date().toISOString();
    
    // Also add to global context memory for cross-chat references
    // This is useful for the bot to remember interactions across different chats
    const globalContextMessage = {
      ...contextMessage,
      chatId
    };
    
    db.data.contextMemory.push(globalContextMessage);
    
    // Limit the size of the global context memory (keep last 200 messages)
    if (db.data.contextMemory.length > 200) {
      db.data.contextMemory = db.data.contextMemory.slice(-200);
    }
    
    // Update global participants registry
    if (!db.data.participantsRegistry) {
      db.data.participantsRegistry = {};
    }
    
    if (!db.data.participantsRegistry[sender]) {
      db.data.participantsRegistry[sender] = {
        id: sender,
        name: userName,
        chats: [chatId],
        firstSeen: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        lastMessage: content,
        totalMessages: 1
      };
    } else {
      // Update participant info
      db.data.participantsRegistry[sender].lastActive = new Date().toISOString();
      db.data.participantsRegistry[sender].lastMessage = content;
      db.data.participantsRegistry[sender].totalMessages++;
      
      // Update name if changed
      if (userName && userName !== db.data.participantsRegistry[sender].name) {
        db.data.participantsRegistry[sender].name = userName;
      }
      
      // Add chat to participant's chats if not already included
      if (!db.data.participantsRegistry[sender].chats.includes(chatId)) {
        db.data.participantsRegistry[sender].chats.push(chatId);
      }
    }
    
    // Save changes
    await db.write();
  } catch (error) {
    console.error('Error updating context:', error);
  }
}

// Get relevant context for a given message
async function getRelevantContext(db, chatId, message) {
  try {
    console.log(`[CONTEXT] Getting context for chat: ${chatId}, BOT_ID: ${process.env.BOT_ID || 'Not set'}`);
    
    if (!db.data.conversations[chatId]) {
      console.log(`[CONTEXT] No conversation found for chat: ${chatId}`);
      return [];
    }
    
    // Get chat type (group or private)
    const isGroup = chatId.endsWith('@g.us');
    const chatType = isGroup ? 'group' : 'private';
    console.log(`[CONTEXT] Chat type: ${chatType}`);
    
    // Get recent messages from this chat
    const chatMessages = db.data.conversations[chatId].messages;
    console.log(`[CONTEXT] Total messages in conversation: ${chatMessages.length}`);
    
    // Get recent messages from this chat
    let recentMessages = chatMessages.slice(-MAX_RELEVANT_MESSAGES);
    console.log(`[CONTEXT] Taking ${recentMessages.length} recent messages`);

    // If the current message is a follow-up about an image, add the last image analysis as a system message
    const imageFollowupKeywords = [
      'gambar', 'foto', 'isi gambar', 'isi fotonya', 'apa ini', 'apa yang ada di gambar', 'apa yang ada di foto', 'analisa gambar', 'analisis gambar', 'jelaskan gambar', 'jelasin gambar', 'gambar apa', 'foto apa', 'apa isi', 'apa yang terlihat', 'apa yang terjadi di gambar', 'apa yang terjadi di foto'
    ];
    const lowerMsg = (message || '').toLowerCase();
    const isImageFollowup = imageFollowupKeywords.some(k => lowerMsg.includes(k));
    if (isImageFollowup) {
      // Find the last image analysis message in the chat
      const lastImageAnalysis = [...chatMessages].reverse().find(msg =>
        msg.role === 'assistant' &&
        typeof msg.content === 'string' &&
        msg.content.startsWith('[IMAGE ANALYSIS:')
      );
      if (lastImageAnalysis) {
        // Prepend a system message with the last image analysis
        recentMessages.unshift({
          role: 'system',
          content: `Sebelumnya, user mengirim gambar dan aku sudah menganalisa: ${lastImageAnalysis.content.replace('[IMAGE ANALYSIS:', '').replace(']', '').trim()}`,
          name: 'system'
        });
      }
    }
    
    // Check if we should include cross-chat context from private chats in group chat
    if (isGroup && message) {
      // Find mentions or references to other participants in the current message
      const chatParticipants = Object.keys(db.data.conversations[chatId].participants);
      console.log(`[CONTEXT] Participants in chat: ${chatParticipants.length}`);
      
      // Get cross-chat context that might be relevant
      const crossChatContext = getCrossContextFromPrivateChats(db, message, chatId, chatParticipants);
      console.log(`[CONTEXT] Cross-chat context messages: ${crossChatContext.length}`);
      
      if (crossChatContext.length > 0) {
        // Add marker for cross-chat context
        recentMessages.push({
          role: 'system',
          content: 'Berikut beberapa informasi dari percakapan pribadi yang relevan:',
          name: 'system'
        });
        
        // Add cross-chat context
        recentMessages = recentMessages.concat(crossChatContext);
      }
    }
    
    // Add information about the current chat
    let contextPrefix = [];
    
    if (isGroup) {
      const groupInfo = getGroupInfo(db, chatId);
      console.log(`[CONTEXT] Group info: ${groupInfo.name}, Members: ${groupInfo.memberCount}`);
      
      contextPrefix.push({
        role: 'system',
        content: `Ini adalah chat grup bernama "${groupInfo.name}". Terdapat ${groupInfo.memberCount} anggota dalam grup ini, diantaranya: ${groupInfo.recentActiveMembers}.`,
        name: 'system'
      });
    } else {
      // It's a private chat
      const participant = Object.values(db.data.conversations[chatId].participants)
        .find(p => p.id !== process.env.BOT_ID);
      
      if (participant) {
        console.log(`[CONTEXT] Private chat with: ${participant.name}, Messages: ${participant.messageCount}`);
        
        contextPrefix.push({
          role: 'system',
          content: `Ini adalah chat pribadi dengan ${participant.name}. Mereka telah mengirim ${participant.messageCount} pesan dalam percakapan ini.`,
          name: 'system'
        });
        
        // Check if this person is also in groups with the bot
        if (db.data.participantsRegistry && db.data.participantsRegistry[participant.id]) {
          const participantGroups = db.data.participantsRegistry[participant.id].chats
            .filter(id => id !== chatId && id.endsWith('@g.us'))
            .map(id => db.data.conversations[id]?.chatName || 'Grup')
            .slice(0, 3);
          
          if (participantGroups.length > 0) {
            console.log(`[CONTEXT] Participant is also in groups: ${participantGroups.join(', ')}`);
            
            contextPrefix.push({
              role: 'system',
              content: `${participant.name} juga anggota grup: ${participantGroups.join(', ')}`,
              name: 'system'
            });
          }
        }
      }
    }
    
    // Convert to format expected by AI service (prepend with context prefix)
    const finalContext = [
      ...contextPrefix,
      ...recentMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
        name: msg.name
      }))
    ];
    
    console.log(`[CONTEXT] Final context size: ${finalContext.length} messages`);
    return finalContext;
  } catch (error) {
    console.error('Error getting relevant context:', error);
    return [];
  }
}

// Get cross-chat context from private conversations that might be relevant
function getCrossContextFromPrivateChats(db, message, currentChatId, participants) {
  try {
    if (!message || !participants || participants.length === 0) {
      return [];
    }
    
    const crossChatMessages = [];
    
    // Look for recent private chat messages from participants in this group
    participants.forEach(participantId => {
      // Skip the bot itself
      if (participantId === process.env.BOT_ID) {
        return;
      }
      
      // Look through all chats to find private chats with this participant
      Object.entries(db.data.conversations).forEach(([chatId, chat]) => {
        // Skip the current chat and group chats
        if (chatId === currentChatId || chatId.endsWith('@g.us')) {
          return;
        }
        
        // Check if this is a private chat with this participant
        if (Object.keys(chat.participants).includes(participantId)) {
          // Get the 2 most recent messages from this private chat
          const recentPrivateMessages = chat.messages
            .slice(-3)
            .map(msg => ({
              role: msg.role,
              content: `[Dari chat pribadi dengan ${chat.participants[participantId].name}] ${msg.content}`,
              name: msg.name,
              timestamp: msg.timestamp
            }));
          
          crossChatMessages.push(...recentPrivateMessages);
        }
      });
    });
    
    // Sort by timestamp and take most recent ones
    return crossChatMessages
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, MAX_CROSS_CHAT_MESSAGES);
  } catch (error) {
    console.error('Error getting cross-chat context:', error);
    return [];
  }
}

// Get info about a group
function getGroupInfo(db, groupId) {
  try {
    const conversation = db.data.conversations[groupId];
    if (!conversation) {
      return {
        name: 'Unknown Group',
        memberCount: 0,
        recentActiveMembers: 'No active members'
      };
    }
    
    const participants = Object.values(conversation.participants);
    
    // Get info about active members (excluding the bot)
    const activeMembers = participants
      .filter(p => p.id !== process.env.BOT_ID)
      .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
      .slice(0, MAX_PARTICIPANTS_INTRO)
      .map(p => p.name);
    
    return {
      name: conversation.chatName || 'Group Chat',
      memberCount: participants.length,
      recentActiveMembers: activeMembers.length > 0 ? activeMembers.join(', ') : 'No active members'
    };
  } catch (error) {
    console.error('Error getting group info:', error);
    return {
      name: 'Unknown Group',
      memberCount: 0,
      recentActiveMembers: 'Error getting member info'
    };
  }
}

// Check if bot should introduce itself (for new groups or after long inactivity)
async function shouldIntroduceInGroup(db, groupId) {
  try {
    const conversation = db.data.conversations[groupId];
    if (!conversation) {
      return true; // New group, should introduce
    }
    
    // If we've already introduced ourselves, check if enough time has passed
    if (conversation.hasIntroduced) {
      // If we've introduced in the last hour, don't introduce again
      if (conversation.lastIntroduction) {
        const lastIntroTime = new Date(conversation.lastIntroduction);
        const currentTime = new Date();
        const hoursDifference = (currentTime - lastIntroTime) / (1000 * 60 * 60);
        
        // Only introduce again if it's been more than 24 hours
        if (hoursDifference < 24) {
          return false;
        }
      }
    }
    
    // Check if this is a very new conversation (less than 3 messages)
    if (conversation.messages.length < 3) {
      return true;
    }
    
    // Check if bot has been inactive in this group for more than 24 hours
    const botMessages = conversation.messages.filter(msg => msg.sender === process.env.BOT_ID);
    if (botMessages.length === 0) {
      return true; // Bot hasn't spoken yet
    }
    
    const lastBotMessage = botMessages[botMessages.length - 1];
    const lastActiveTime = new Date(lastBotMessage.timestamp);
    const currentTime = new Date();
    
    // Calculate time difference in hours
    const hoursDifference = (currentTime - lastActiveTime) / (1000 * 60 * 60);
    
    // Introduce if inactive for more than 24 hours
    return hoursDifference > 24;
  } catch (error) {
    console.error('Error checking if should introduce:', error);
    return false;
  }
}

// Generate introduction message for a group
async function generateGroupIntroduction(db, groupId) {
  try {
    const groupInfo = getGroupInfo(db, groupId);
    const botName = db.data.config.botName;
    
    return `Halo semuanya! Aku ${botName}, AI asisten yang bisa bantu kalian dalam percakapan ini. 
Salam kenal untuk ${groupInfo.recentActiveMembers}! 💫

Aku bisa diajak ngobrol santai, bantu jawab pertanyaan, atau sekedar meramaikan grup.
Kalian bisa panggil aku dengan mention @${botName} atau ketik namaku di awal pesan.
Ketik !help untuk melihat perintah yang tersedia.`;
  } catch (error) {
    console.error('Error generating group introduction:', error);
    return `Halo semuanya! Aku ${db.data.config.botName}, AI asisten yang siap membantu kalian. Ketik !help untuk melihat daftar perintah yang tersedia.`;
  }
}

// Clear context for a specific chat
async function clearContext(db, chatId) {
  try {
    if (db.data.conversations[chatId]) {
      // Keep participant info but clear messages
      db.data.conversations[chatId].messages = [];
      await db.write();
      return { success: true, message: 'Konteks percakapan berhasil dihapus' };
    }
    return { success: false, message: 'Tidak ada percakapan yang ditemukan' };
  } catch (error) {
    console.error('Error clearing context:', error);
    return { success: false, message: 'Terjadi kesalahan saat menghapus konteks percakapan' };
  }
}

export {
  updateContext,
  getRelevantContext,
  clearContext,
  shouldIntroduceInGroup,
  generateGroupIntroduction
}; 