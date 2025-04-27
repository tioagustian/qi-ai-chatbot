// Maximum number of messages to keep in context memory per chat
const MAX_CONTEXT_MESSAGES = 100;

// Maximum number of relevant messages to return for AI prompt
const MAX_RELEVANT_MESSAGES = 20;

// Maximum number of cross-chat context messages to include
const MAX_CROSS_CHAT_MESSAGES = 8;

// Maximum number of participants to include in introductions
const MAX_PARTICIPANTS_INTRO = 10;

// Maximum number of image analysis messages to include in context
const MAX_IMAGE_ANALYSIS_MESSAGES = 3;

// Maximum number of topic-specific messages to include
const MAX_TOPIC_SPECIFIC_MESSAGES = 10;

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
      chatType: chatType,
      // Add metadata for better context tracking
      metadata: {
        hasImage: message.message?.imageMessage || message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ? true : false,
        isReply: message.message?.extendedTextMessage?.contextInfo?.quotedMessage ? true : false,
        quotedMessageId: message.message?.extendedTextMessage?.contextInfo?.stanzaId || null,
        topics: extractTopics(content)
      }
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
    
    // Get all messages from this chat
    const chatMessages = db.data.conversations[chatId].messages;
    console.log(`[CONTEXT] Total messages in conversation: ${chatMessages.length}`);
    
    // Extract topics from current message to find relevant past messages
    const messageTopics = message ? extractTopics(message) : [];
    console.log(`[CONTEXT] Current message topics: ${messageTopics.join(', ')}`);
    
    // Start with recent messages as base context
    let recentMessages = chatMessages.slice(-MAX_RELEVANT_MESSAGES);
    
    // If we have topics, find topic-specific messages to include
    let topicSpecificMessages = [];
    if (messageTopics.length > 0) {
      // For each topic, find relevant messages
      messageTopics.forEach(topic => {
        const topicMessages = findTopicSpecificMessages(chatMessages, topic, MAX_TOPIC_SPECIFIC_MESSAGES/2);
        topicSpecificMessages = [...topicSpecificMessages, ...topicMessages];
      });
      
      // Remove duplicates
      topicSpecificMessages = [...new Map(topicSpecificMessages.map(msg => [msg.id, msg])).values()];
      console.log(`[CONTEXT] Found ${topicSpecificMessages.length} topic-specific messages`);
    }
    
    // Check if this is a reply to a specific message
    let replyContext = [];
    if (message && typeof message === 'object' && message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quotedMsgId = message.message.extendedTextMessage.contextInfo.stanzaId;
      if (quotedMsgId) {
        // Find the quoted message and its context
        const quotedMsgIndex = chatMessages.findIndex(msg => msg.id === quotedMsgId);
        if (quotedMsgIndex !== -1) {
          // Get messages around the quoted message for context
          const contextStart = Math.max(0, quotedMsgIndex - 2);
          const contextEnd = Math.min(chatMessages.length, quotedMsgIndex + 3);
          replyContext = chatMessages.slice(contextStart, contextEnd);
          console.log(`[CONTEXT] Adding ${replyContext.length} messages as reply context`);
        }
      }
    }
    
    // Combine all context sources, prioritizing recent messages
    let combinedMessages = [...recentMessages];
    
    // Add topic-specific and reply context, avoiding duplicates
    const existingIds = new Set(combinedMessages.map(msg => msg.id));
    
    [...topicSpecificMessages, ...replyContext].forEach(msg => {
      if (!existingIds.has(msg.id)) {
        combinedMessages.push(msg);
        existingIds.add(msg.id);
      }
    });
    
    // Sort by timestamp to maintain conversation flow
    combinedMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Limit to maximum context size
    if (combinedMessages.length > MAX_RELEVANT_MESSAGES) {
      combinedMessages = combinedMessages.slice(-MAX_RELEVANT_MESSAGES);
    }
    
    console.log(`[CONTEXT] Taking ${combinedMessages.length} combined relevant messages`);

    // Enhanced image context handling with AI-based detection
    // First check if there are any image analyses in the conversation
    const hasImageAnalysisInHistory = chatMessages.some(msg => 
      msg.role === 'assistant' && 
      typeof msg.content === 'string' && 
      (msg.content.startsWith('[IMAGE ANALYSIS:') || msg.metadata?.hasImage || msg.metadata?.isImageAnalysis)
    );
    
    // Only proceed with image context analysis if there's at least one image in history
    let isImageFollowup = false;
    if (hasImageAnalysisInHistory && message && typeof message === 'string') {
      // Basic keyword check as a fallback
      const imageFollowupKeywords = [
        'gambar', 'foto', 'isi gambar', 'isi fotonya', 'apa ini', 'apa yang ada di gambar', 'apa yang ada di foto', 
        'analisa gambar', 'analisis gambar', 'jelaskan gambar', 'jelasin gambar', 'gambar apa', 'foto apa', 'apa isi', 
        'apa yang terlihat', 'apa yang terjadi di gambar', 'apa yang terjadi di foto', 'maksud', 'arti', 'artinya', 
        'maksudnya', 'jelaskan lagi', 'detail', 'lebih jelas', 'tadi', 'sebelumnya', 'yang tadi', 'yang sebelumnya', 
        'yang barusan', 'lihat', 'cek', 'check', 'image', 'picture'
      ];
      const lowerMsg = message.toLowerCase();
      
      // Check for direct keyword matches
      const hasKeyword = imageFollowupKeywords.some(k => lowerMsg.includes(k));
      
      // Check for temporal references that might indicate referring to something shared earlier
      const hasTemporalReference = [
        'tadi', 'sebelumnya', 'sebelum ini', 'yang tadi', 'yang sebelumnya', 'yang barusan',
        'earlier', 'before', 'previous', 'just now', 'just shared', 'just sent',
        'yang kamu kirim', 'yang dikirim', 'yang dishare', 'yang dibagikan'
      ].some(ref => lowerMsg.includes(ref));
      
      // Check for demonstrative pronouns that might indicate referring to something specific
      const hasDemonstrativeReference = [
        'ini', 'itu', 'tersebut', 'this', 'that', 'those', 'these'
      ].some(ref => lowerMsg.includes(ref));
      
      // Combine all signals to determine if this is likely an image followup
      isImageFollowup = hasKeyword || (hasTemporalReference && hasDemonstrativeReference);
      
      // If we still can't determine, use more advanced heuristics for ambiguous queries
      if (!isImageFollowup && message.length > 3) {
        // Check if the message is a question (ends with ? or contains question words)
        const isQuestion = message.endsWith('?') || 
          ['apa', 'siapa', 'kapan', 'dimana', 'gimana', 'bagaimana', 'kenapa', 'mengapa', 'tolong'].some(q => lowerMsg.includes(q));
        
        // If it's a question and contains demonstrative pronouns, it's likely referring to something shared before
        if (isQuestion && hasDemonstrativeReference) {
          isImageFollowup = true;
          console.log(`[CONTEXT] Detected likely image reference in question: "${message}"`);  
        }
      }
    }
    
    // Check if this is an image-related query
    if (isImageFollowup) {
      console.log(`[CONTEXT] Detected image-related query: "${message}"`);  
      
      // Get all image analysis messages, most recent first
      const imageAnalysisMessages = [...chatMessages]
        .reverse()
        .filter(msg => 
          msg.role === 'assistant' && 
          typeof msg.content === 'string' && 
          (msg.content.startsWith('[IMAGE ANALYSIS:') || msg.metadata?.hasImage || msg.metadata?.isImageAnalysis)
        )
        .slice(0, MAX_IMAGE_ANALYSIS_MESSAGES);
      
      console.log(`[CONTEXT] Found ${imageAnalysisMessages.length} image analysis messages in history`);  
      
      if (imageAnalysisMessages.length > 0) {
        // Check if we have any image analysis in the database
        if (db.data.imageAnalysis) {
          // Try to find the most relevant image analysis based on the query
          // Start with the most recent one as default
          let relevantAnalysisMsg = imageAnalysisMessages[0];
          let relevantAnalysisId = relevantAnalysisMsg.imageAnalysisId || relevantAnalysisMsg.metadata?.fullAnalysisId;
          
          // If the message contains temporal references like "tadi" (earlier), "sebelumnya" (previously),
          // we should try to find the image that best matches the query
          if (message && typeof message === 'string') {
            const lowerMsg = message.toLowerCase();
            const hasTemporalReference = [
              'tadi', 'sebelumnya', 'sebelum ini', 'yang tadi', 'yang sebelumnya', 'yang barusan',
              'earlier', 'before', 'previous', 'just now', 'just shared', 'just sent'
            ].some(ref => lowerMsg.includes(ref));
            
            if (hasTemporalReference && imageAnalysisMessages.length > 1) {
              console.log(`[CONTEXT] Message contains temporal reference, searching for most relevant image`);  
              
              // Look through all available image analyses to find the best match
              // For now, we'll use a simple approach - if the message mentions specific entities or topics
              // that are in an image analysis, prioritize that one
              for (const analysisMsg of imageAnalysisMessages) {
                const analysisId = analysisMsg.imageAnalysisId || analysisMsg.metadata?.fullAnalysisId;
                if (analysisId && db.data.imageAnalysis[analysisId]) {
                  const analysis = db.data.imageAnalysis[analysisId];
                  
                  // Check if any entities or topics from this image match the query
                  const matchesQuery = [...(analysis.entities || []), ...(analysis.topics || [])]
                    .some(item => lowerMsg.includes(item.toLowerCase()));
                  
                  if (matchesQuery) {
                    console.log(`[CONTEXT] Found better matching image analysis: ${analysisId}`);  
                    relevantAnalysisMsg = analysisMsg;
                    relevantAnalysisId = analysisId;
                    break;
                  }
                }
              }
            }
          }
          
          // Now use the most relevant analysis (either most recent or best match)
          if (relevantAnalysisId && db.data.imageAnalysis[relevantAnalysisId]) {
            // Get the full analysis from the database
            const fullAnalysis = db.data.imageAnalysis[relevantAnalysisId];
            
            // Update the last access time for this analysis
            fullAnalysis.lastAccessTime = new Date().toISOString();
            fullAnalysis.hasBeenShown = true; // Mark that this analysis has been shown to the user
            
            // Format the timestamp in a human-readable format
            const imageTimestamp = new Date(fullAnalysis.timestamp);
            const now = new Date();
            const timeDiffMinutes = Math.floor((now - imageTimestamp) / (1000 * 60));
            const timeDiffHours = Math.floor(timeDiffMinutes / 60);
            const timeDiffDays = Math.floor(timeDiffHours / 24);
            
            let timeDescription;
            if (timeDiffMinutes < 1) {
              timeDescription = 'baru saja';
            } else if (timeDiffMinutes < 60) {
              timeDescription = `${timeDiffMinutes} menit yang lalu`;
            } else if (timeDiffHours < 24) {
              timeDescription = `${timeDiffHours} jam yang lalu`;
            } else {
              timeDescription = `${timeDiffDays} hari yang lalu`;
            }
            
            // Add the full analysis to the context
            recentMessages.unshift({
              role: 'system',
              content: `Sebelumnya, user mengirim gambar dan aku sudah menganalisa: ${fullAnalysis.analysis}`,
              name: 'system'
            });
            
            // Add information about who sent the image and when
            const senderName = fullAnalysis.senderName || 
                              db.data.conversations[chatId]?.participants[fullAnalysis.sender]?.name || 
                              fullAnalysis.sender.split('@')[0];
            
            recentMessages.unshift({
              role: 'system',
              content: `Gambar tersebut dikirim oleh ${senderName} ${timeDescription} (${new Date(fullAnalysis.timestamp).toLocaleString('id-ID')}).`,
              name: 'system'
            });
            
            // If the image had a caption, include it
            if (fullAnalysis.caption && fullAnalysis.caption.trim() !== '') {
              recentMessages.unshift({
                role: 'system',
                content: `Caption gambar tersebut: "${fullAnalysis.caption}"`,
                name: 'system'
              });
            }
            
            // Track this as a related message
            if (message?.key?.id && !fullAnalysis.relatedMessages.includes(message.key.id)) {
              fullAnalysis.relatedMessages.push(message.key.id);
            }
          } else {
            // Fallback to the old method if we can't find the full analysis
            recentMessages.unshift({
              role: 'system',
              content: `Sebelumnya, user mengirim gambar dan aku sudah menganalisa: ${relevantAnalysisMsg.content.replace('[IMAGE ANALYSIS:', '').replace(']', '').trim()}`,
              name: 'system'
            });
          }
        } else {
          // Fallback to the old method if we don't have the imageAnalysis structure
          recentMessages.unshift({
            role: 'system',
            content: `Sebelumnya, user mengirim gambar dan aku sudah menganalisa: ${imageAnalysisMessages[0].content.replace('[IMAGE ANALYSIS:', '').replace(']', '').trim()}`,
            name: 'system'
          });
        }
        
        // Add additional context from older image analyses if available
        if (imageAnalysisMessages.length > 1) {
          recentMessages.unshift({
            role: 'system',
            content: `User juga pernah mengirim gambar lain sebelumnya: ${imageAnalysisMessages.slice(1).map(msg => msg.content.replace('[IMAGE ANALYSIS:', '').replace(']', '').trim()).join(' | ')}`,
            name: 'system'
          });
        }
        
        // Find any follow-up conversations about the images
        const imageFollowupMessages = findRelatedMessages(chatMessages, imageAnalysisMessages[0].id, 5);
        if (imageFollowupMessages.length > 0) {
          recentMessages.push({
            role: 'system',
            content: `Percakapan sebelumnya tentang gambar ini: ${formatConversationSnippet(imageFollowupMessages)}`,
            name: 'system'
          });
        }
        
        // Save the updated analysis data
        try {
          await db.write();
        } catch (dbError) {
          console.error('Error updating image analysis data:', dbError);
        }
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

// Extract potential topics from message content
function extractTopics(content) {
  // Simple topic extraction based on keywords
  const topics = [];
  
  // Check for image-related content
  if (content.match(/gambar|foto|image|picture/i)) {
    topics.push('image');
  }
  
  // Check for question patterns
  if (content.match(/\?|apa|siapa|kapan|dimana|mengapa|bagaimana|how|what|when|where|why|who/i)) {
    topics.push('question');
  }
  
  // Check for greeting patterns
  if (content.match(/halo|hai|hello|hi|selamat|pagi|siang|sore|malam/i)) {
    topics.push('greeting');
  }
  
  // Check for request patterns
  if (content.match(/tolong|bantu|help|assist|bisa|can you|could you/i)) {
    topics.push('request');
  }
  
  return topics;
}

// Find messages related to a specific message by ID
function findRelatedMessages(messages, messageId, limit = 5) {
  const messageIndex = messages.findIndex(msg => msg.id === messageId);
  if (messageIndex === -1) return [];
  
  // Get messages that came after the target message, limited by count
  return messages.slice(messageIndex + 1, messageIndex + 1 + limit);
}

// Format a conversation snippet for context
function formatConversationSnippet(messages) {
  return messages.map(msg => `${msg.role === 'user' ? 'User' : 'Bot'}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`).join(' | ');
}

// Find topic-specific messages in conversation history
function findTopicSpecificMessages(messages, topic, limit = 5) {
  return messages
    .filter(msg => msg.metadata?.topics?.includes(topic))
    .slice(-limit);
}

export {
  updateContext,
  getRelevantContext,
  clearContext,
  shouldIntroduceInGroup,
  generateGroupIntroduction,
  findRelatedMessages,
  findTopicSpecificMessages
};