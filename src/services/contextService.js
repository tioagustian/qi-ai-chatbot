// Maximum number of messages to keep in context memory per chat
const MAX_CONTEXT_MESSAGES = process.env.MAX_CONTEXT_MESSAGES || 100;

// Maximum number of relevant messages to return for AI prompt
const MAX_RELEVANT_MESSAGES = process.env.MAX_RELEVANT_MESSAGES || 20;

// Maximum number of cross-chat context messages to include
const MAX_CROSS_CHAT_MESSAGES = process.env.MAX_CROSS_CHAT_MESSAGES || 8;

// Maximum number of participants to include in introductions
const MAX_PARTICIPANTS_INTRO = process.env.MAX_PARTICIPANTS_INTRO || 10;

// Maximum number of image analysis messages to include in context
const MAX_IMAGE_ANALYSIS_MESSAGES = process.env.MAX_IMAGE_ANALYSIS_MESSAGES || 3;

// Maximum number of topic-specific messages to include
const MAX_TOPIC_SPECIFIC_MESSAGES = process.env.MAX_TOPIC_SPECIFIC_MESSAGES || 10;

// Import from memoryService
import { findImagesByDescription } from './memoryService.js';

// Update context with new message
async function updateContext(db, chatId, sender, content, message, sock) {
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
      if (isGroup) {
        const groupInfo = await sock.groupMetadata(chatId);
        db.data.conversations[chatId].chatName = groupInfo.subject;
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
async function getRelevantContext(db, chatId, message, sock) {
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
          // Try to find the most relevant image analysis using embeddings if available
          let relevantAnalysisMsg = imageAnalysisMessages[0];
          let relevantAnalysisId = relevantAnalysisMsg.imageAnalysisId || relevantAnalysisMsg.metadata?.fullAnalysisId;
          
          // Use embedding search if the message seems like a description-based query
          // Check for descriptive terms in the message
          const isDescriptiveQuery = typeof message === 'string' && (
            message.includes('gambar') || 
            message.includes('foto') || 
            message.includes('image') || 
            message.includes('picture') ||
            message.includes('yang ada') ||
            message.includes('yang menunjukkan') ||
            message.includes('yang berisi') ||
            message.includes('yang menampilkan')
          );
          
          if (isDescriptiveQuery && db.data.config.dynamicFactExtractionEnabled) {
            try {
              // Look for images similar to the description using embedding search
              // Use a 7-day timeframe for recency
              const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
              const similarImages = await findImagesByDescription(message, {
                chatId,
                timeframe: oneWeekMs,
                limit: 2, // Get the top 2 matches
                threshold: 0.65 // Higher threshold for more relevance
              });
              
              if (similarImages.length > 0) {
                console.log(`[CONTEXT] Found ${similarImages.length} similar images by description`);
                
                // Use the most similar image as context
                const mostSimilarImage = similarImages[0];
                relevantAnalysisId = mostSimilarImage.id;
                
                // Add both the similarity score and a note about the search method
                recentMessages.unshift({
                  role: 'system',
                  content: `User is asking about an image previously shared in this chat. Found a similar image with ${Math.round(mostSimilarImage.similarity * 100)}% match to their description.`,
                  name: 'image_search_info'
                });
              }
            } catch (embeddingError) {
              console.error('[CONTEXT] Error in image embedding search:', embeddingError);
            }
          }
          
          if (relevantAnalysisId && db.data.imageAnalysis[relevantAnalysisId]) {
            // We found a relevant image analysis
            const imageAnalysis = db.data.imageAnalysis[relevantAnalysisId];
            console.log(`[CONTEXT] Found relevant image analysis: ${imageAnalysis.id}`);
            
            // Include the image analysis in the context
            // recentMessages.unshift({
            //   role: 'system',
            //   content: `User juga pernah mengirim gambar. Berikut analisis gambar: ${imageAnalysis.analysis}`,
            //   name: 'image_context'
            // });
            
            // Get any follow-up messages about this image if available
            if (imageAnalysis.relatedMessages && imageAnalysis.relatedMessages.length > 0) {
              console.log(`[CONTEXT] Including ${imageAnalysis.relatedMessages.length} related messages for this image`);
              
              // Also include relevant previous messages about this image
              // These could be follow-up questions or clarifications
              const relatedMessageIds = new Set(imageAnalysis.relatedMessages);
              const relatedMessages = chatMessages
                .filter(msg => relatedMessageIds.has(msg.id))
                .slice(0, 5); // Limit to 5 related messages
                
              if (relatedMessages.length > 0) {
                recentMessages = recentMessages.concat(relatedMessages);
              }
            }
            
            // Mark that we've accessed this image analysis
            imageAnalysis.lastAccessTime = new Date().toISOString();
            await db.write();
          } else {
            console.log(`[CONTEXT] No specific relevant image analysis found, using most recent`);
            
            // No specific relevant images found, include the most recent one
            const recentAnalysisId = imageAnalysisMessages[0].imageAnalysisId || 
                                 imageAnalysisMessages[0].metadata?.fullAnalysisId;
                                    
            if (recentAnalysisId && db.data.imageAnalysis[recentAnalysisId]) {
              const imageAnalysis = db.data.imageAnalysis[recentAnalysisId];
              
              // recentMessages.unshift({
              //   role: 'system',
              //   content: `User juga pernah mengirim gambar. Berikut analisis gambar terbaru: ${imageAnalysis.analysis}`,
              //   name: 'image_context'
              // });
              
              // Mark that we've accessed this image analysis
              imageAnalysis.lastAccessTime = new Date().toISOString();
              await db.write();
            }
          }
        }
      }
    }
    
    // NEW: Check for cross-chat questions (about bot's mood or conversations in other chats)
    if (typeof message === 'string') {
      const botName = db.data.config.botName || 'AI';
      
      // Check if it's a question about cross-chat information
      const crossChatContext = getCrossChatContextForQuestion(db, chatId, message, botName);
      console.log(`[CONTEXT] Cross-chat context messages: ${crossChatContext.length}`);
      
      if (crossChatContext.length > 0) {
        // Add a system message to indicate cross-chat context is being provided
        const questionInfo = detectCrossChatQuestion(message, botName);
        let contextHeader = 'Here is relevant information from other conversations:';
        
        if (questionInfo.type === 'mood') {
          contextHeader = "The user is asking about your mood in other chats. Here's relevant information:";
        } else if (questionInfo.type === 'conversation' && questionInfo.targetName) {
          contextHeader = `The user is asking about conversations with ${questionInfo.targetName}. Here's relevant information:`;
        } else if (questionInfo.type === 'group_activity') {
          contextHeader = "The user is asking about what happened in another group. Here's relevant information:";
        }
        
        recentMessages.push({
          role: 'system',
          content: contextHeader,
          name: 'cross_chat_header',
          priority: 1
        });
        
        // Add cross-chat context
        recentMessages = recentMessages.concat(crossChatContext);
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
      const groupInfo = await getGroupInfo(db, chatId, sock);
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
        name: msg.name,
        timestamp: msg.timestamp
      }))
    ];
    
    console.log(`[CONTEXT] Final context size: ${finalContext.length} messages`);

    // Add relevant user facts if available
    if (db.data.config.dynamicFactExtractionEnabled && db.data.conversations[chatId]) {
      // Find the most active user in the conversation
      const participants = Object.values(db.data.conversations[chatId].participants)
        .filter(p => p.id !== process.env.BOT_ID)
        .sort((a, b) => b.messageCount - a.messageCount);
      
      if (participants.length > 0) {
        const mainUser = participants[0];
        
        // Check if we have facts for this user
        if (db.data.userFacts && db.data.userFacts[mainUser.id]) {
          const userFacts = db.data.userFacts[mainUser.id].facts;
          
          // If we have at least some facts, add them to context
          if (Object.keys(userFacts).length > 0) {
            // Format facts for inclusion in the context
            const factList = Object.entries(userFacts)
              .filter(([key, fact]) => {
                // Only include reasonably confident facts
                return fact.confidence >= 0.75;
              })
              .map(([key, fact]) => `${key}: ${fact.value}`)
              .join(', ');
            
            if (factList.length > 0) {
              console.log(`[CONTEXT] Adding ${Object.keys(userFacts).length} user facts to context`);
              
              // Add user facts as a system message with low priority
              finalContext.push({
                role: 'system',
                content: `Known facts about ${mainUser.name}: ${factList}`,
                name: 'user_facts',
                priority: 2  // Lower priority than core context
              });
            }
          }
        }
      }
    }
    
    // Sort final context by priority
    const relevantContext = finalContext.sort((a, b) => (b.priority || 5) - (a.priority || 5));
    
    return relevantContext;
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
              content: `source: private chat; sender: ${msg.name}; recipient name: ${chat.participants[participantId].name}; message: ${msg.content}; time: ${msg.timestamp}`,
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

/**
 * Get relevant cross-chat context based on a specific question about mood or conversations
 * @param {Object} db - Database object
 * @param {string} currentChatId - Current chat ID
 * @param {string} content - The question content
 * @param {string} botName - The bot's name
 * @returns {Array} - Array of relevant context messages
 */
function getCrossChatContextForQuestion(db, currentChatId, content, botName) {
  try {
    console.log(`[CONTEXT] Getting cross-chat context for question: "${content}"`);
    
    // Detect what kind of cross-chat question this is
    const questionInfo = detectCrossChatQuestion(content, botName);
    
    if (!questionInfo.isCrossChatQuestion) {
      return [];
    }
    
    console.log(`[CONTEXT] Detected cross-chat question of type: ${questionInfo.type}`);
    const contextMessages = [];
    
    // Different handling based on question type
    if (questionInfo.type === 'mood') {
      // Looking for bot's mood in other chats/groups
      // Find recent messages where the bot was in specific moods
      const botMoodMessages = findBotMoodMessages(db, currentChatId, questionInfo);
      contextMessages.push(...botMoodMessages);
    }
    else if (questionInfo.type === 'conversation' && questionInfo.targetName) {
      // Looking for conversations with a specific person
      const targetName = questionInfo.targetName;
      console.log(`[CONTEXT] Finding conversations with user: ${targetName}`);
      
      // First, try to find matching users by name or nickname
      const matchingUsers = findUserIdsByName(db, targetName);
      
      if (matchingUsers.length > 0) {
        console.log(`[CONTEXT] Found ${matchingUsers.length} users matching "${targetName}"`);
        
        // Gather conversations for each matching user ID
        for (const match of matchingUsers) {
          const { userId, score } = match;
          
          // Get user's name from conversations or facts for better context
          let userName = '';
          
          // Try to find a name from conversations
          for (const [chatId, chat] of Object.entries(db.data.conversations)) {
            if (chat.participants && chat.participants[userId]) {
              userName = chat.participants[userId].name;
              break;
            }
          }
          
          // Or try from user facts
          if (!userName && db.data.userFacts && db.data.userFacts[userId]) {
            const userFacts = db.data.userFacts[userId].facts;
            userName = userFacts.name?.value || 
                      userFacts.full_name?.value || 
                      userFacts.nickname?.value || 
                      userId.split('@')[0];
          }
          
          console.log(`[CONTEXT] Looking for conversations with user "${userName}" (${userId}), match score: ${score}`);
          
          // Find conversations with this user across all chats
          let userConversations = [];
          
          for (const [chatId, chat] of Object.entries(db.data.conversations)) {
            // Skip current chat and ensure this user is a participant
            if (chatId === currentChatId || !chat.participants || !chat.participants[userId]) {
              continue;
            }
            
            // Find message exchanges with this user
            let conversationExchanges = [];
            let lastBotMessageIndex = -1;
            
            // Look for patterns of the bot and user talking to each other
            chat.messages.forEach((msg, index) => {
              if (msg.sender === process.env.BOT_ID) {
                lastBotMessageIndex = index;
              } else if (msg.sender === userId && lastBotMessageIndex !== -1 && index - lastBotMessageIndex <= 2) {
                // This is a user response to the bot's message
                conversationExchanges.push({
                  botMessage: chat.messages[lastBotMessageIndex],
                  userMessage: msg,
                  timestamp: msg.timestamp
                });
              }
            });
            
            // Format the conversation exchanges for this user
            conversationExchanges.forEach(exchange => {
              userConversations.push({
                content: exchange.botMessage.content,
                timestamp: exchange.botMessage.timestamp,
                name: db.data.config.botName,
                chatName: chat.chatName || 'a private chat',
                responseContent: exchange.userMessage.content
              });
              
              userConversations.push({
                content: exchange.userMessage.content,
                timestamp: exchange.userMessage.timestamp,
                name: userName || chat.participants[userId].name,
                chatName: chat.chatName || 'a private chat'
              });
            });
          }
          
          if (userConversations.length > 0) {
            console.log(`[CONTEXT] Found ${userConversations.length} messages with "${userName}"`);
            
            // Sort by recency and limit
            userConversations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            userConversations = userConversations.slice(0, 6); // Limit per user
            
            contextMessages.push(...userConversations);
          }
        }
      } else {
        // If no direct user ID matches were found, fall back to the original method
        console.log(`[CONTEXT] No user IDs found for "${targetName}", falling back to text matching`);
        const conversationMessages = findConversationsWithUser(db, currentChatId, targetName);
        contextMessages.push(...conversationMessages);
      }
    }
    else if (questionInfo.type === 'group_activity') {
      // Looking for what was happening in a group
      const targetChat = questionInfo.targetChat; // Might be null if not specified
      const groupActivityMessages = findGroupActivityMessages(db, currentChatId, targetChat);
      contextMessages.push(...groupActivityMessages);
    }
    
    // Format messages for context and ensure we don't have too many
    const formattedMessages = contextMessages
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10) // Limit total messages to avoid context overload
      .map(msg => ({
        role: 'system',
        content: `${msg.chatName ? `In ${msg.chatName}` : 'In another chat'}: ${msg.name || 'User'} said: "${msg.content}" ${msg.moodInfo ? `(Your mood was: ${msg.moodInfo})` : ''}`,
        name: 'cross_chat_context',
        timestamp: msg.timestamp,
        priority: 1 // Higher priority than regular context
      }));
    
    return formattedMessages;
  } catch (error) {
    console.error('Error getting cross-chat context for question:', error);
    return [];
  }
}

/**
 * Find messages where the bot expressed specific moods
 * @param {Object} db - Database object
 * @param {string} currentChatId - Current chat ID
 * @param {Object} questionInfo - Question detection info
 * @returns {Array} - Array of relevant mood messages
 */
function findBotMoodMessages(db, currentChatId, questionInfo) {
  const relevantMoods = ['angry', 'annoyed', 'excited', 'sad']; // Most expressive moods
  const resultMessages = [];
  const MAX_MOOD_MESSAGES = 3;
  
  // Look for messages where the bot was in the relevant mood
  Object.entries(db.data.conversations).forEach(([chatId, chat]) => {
    // Skip current chat
    if (chatId === currentChatId) return;
    
    // If targeting a specific chat/group name, check if this matches
    if (questionInfo.targetChat) {
      // Skip if this isn't the target chat
      if (!chat.chatName || !chat.chatName.toLowerCase().includes(questionInfo.targetChat.toLowerCase())) {
        return;
      }
    }
    
    // Get the bot's messages
    const botMessages = chat.messages
      .filter(msg => msg.sender === process.env.BOT_ID && msg.content && msg.content.length > 0)
      .reverse() // Most recent first
      .slice(0, 10); // Look at the 10 most recent messages
    
    // Check for emotion indicators in content
    botMessages.forEach(msg => {
      const lowerContent = msg.content.toLowerCase();
      let detectedMood = null;
      
      // Simple mood detection from content
      if (lowerContent.includes('anjing') || lowerContent.includes('bangsat') || 
          lowerContent.includes('goblok') || lowerContent.includes('kampret') ||
          lowerContent.includes('brengsek') || lowerContent.includes('jancok') ||
          lowerContent.includes('sialan') || msg.content.includes('😡') || 
          msg.content.includes('🤬')) {
        detectedMood = 'angry';
      } else if (lowerContent.includes('sedih') || lowerContent.includes('kecewa') ||
                lowerContent.includes('😢') || lowerContent.includes('😭')) {
        detectedMood = 'sad';
      } else if (lowerContent.includes('senang') || lowerContent.includes('gembira') ||
                lowerContent.includes('seru') || lowerContent.includes('asik') ||
                lowerContent.includes('keren') || lowerContent.includes('mantap') ||
                msg.content.includes('😄') || msg.content.includes('🎉')) {
        detectedMood = 'excited';
      } else if (lowerContent.includes('kesal') || lowerContent.includes('sebel') ||
                lowerContent.includes('ganggu') || lowerContent.includes('bete')) {
        detectedMood = 'annoyed';
      }
      
      if (detectedMood && relevantMoods.includes(detectedMood)) {
        resultMessages.push({
          ...msg,
          chatId,
          chatName: chat.chatName || 'Another chat',
          moodInfo: detectedMood
        });
      }
    });
  });
  
  // Find previous state changes
  if (db.data.moodHistory) {
    const recentMoodChanges = db.data.moodHistory
      .filter(entry => relevantMoods.includes(entry.mood))
      .slice(-3);
      
    recentMoodChanges.forEach(entry => {
      resultMessages.push({
        content: `I changed my mood to ${entry.mood} ${entry.reason ? `because ${entry.reason}` : ''}`,
        timestamp: entry.timestamp,
        name: db.data.config.botName,
        chatName: entry.chatName || 'a chat',
        moodInfo: entry.mood
      });
    });
  }
  
  // Sort by recency and limit the results
  return resultMessages
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, MAX_MOOD_MESSAGES);
}

/**
 * Find conversations between the bot and a specific user
 * @param {Object} db - Database object
 * @param {string} currentChatId - Current chat ID
 * @param {string} targetName - Name of target user
 * @returns {Array} - Array of relevant conversation messages
 */
function findConversationsWithUser(db, currentChatId, targetName) {
  const resultMessages = [];
  const MAX_CONVERSATION_MESSAGES = 5;
  const lowerTargetName = targetName.toLowerCase();
  
  // Track if we found the user in any chat
  let foundUser = false;
  
  // Build a mapping of all users across all chats for better matching
  const userDirectory = {};
  const userAliases = {};
  const phoneNumberMap = {};
  
  // First, compile a directory of all users across all chats
  Object.entries(db.data.conversations).forEach(([chatId, chat]) => {
    Object.entries(chat.participants).forEach(([participantId, participantData]) => {
      if (participantId === process.env.BOT_ID) return;
      
      const participantName = participantData.name || '';
      if (!participantName) return;
      
      // Add to main directory
      if (!userDirectory[participantId]) {
        userDirectory[participantId] = participantData;
      }
      
      // Track all names this user has been called (might have different names in different chats)
      if (!userAliases[participantId]) {
        userAliases[participantId] = new Set();
      }
      userAliases[participantId].add(participantName.toLowerCase());
      
      // Extract phone number from ID and create a mapping
      const phoneMatch = participantId.match(/^(\d+)@/);
      if (phoneMatch) {
        const phoneNumber = phoneMatch[1];
        phoneNumberMap[phoneNumber] = participantId;
      }
    });
  });
  
  // Add names from user facts if available
  if (db.data.userFacts) {
    Object.entries(db.data.userFacts).forEach(([userId, userData]) => {
      if (userData.facts) {
        // Check for name-related facts
        const nameRelatedFacts = ['name', 'full_name', 'nickname', 'first_name', 'last_name', 'alias', 'called'];
        nameRelatedFacts.forEach(factType => {
          if (userData.facts[factType] && userData.facts[factType].value) {
            // Add this name as an alias for this user
            if (!userAliases[userId]) {
              userAliases[userId] = new Set();
            }
            userAliases[userId].add(userData.facts[factType].value.toLowerCase());
          }
        });
        
        // NEW: Check for relationship-based nickname facts with pattern user_relationship_*_nickname
        Object.entries(userData.facts).forEach(([factKey, factData]) => {
          if (factKey.includes('_nickname') && factData.value) {
            // Add relationship-based nickname
            if (!userAliases[userId]) {
              userAliases[userId] = new Set();
            }
            userAliases[userId].add(factData.value.toLowerCase());
            
            // Also add parts of the nickname for partial matching
            const nicknameParts = factData.value.toLowerCase().split(/\s+/);
            if (nicknameParts.length > 1) {
              nicknameParts.forEach(part => {
                if (part.length > 2) { // Only add meaningful parts (longer than 2 chars)
                  userAliases[userId].add(part);
                }
              });
            }
          }
        });
        
        // NEW: Handle name extraction from relationship facts
        // e.g., user_relationship_aditya_ramadhan_nickname
        Object.entries(userData.facts).forEach(([factKey, factData]) => {
          if (factKey.startsWith('user_relationship_') && factData.value) {
            // Try to extract a name from the factKey pattern
            const relationshipMatch = factKey.match(/user_relationship_([a-z_]+)_/i);
            if (relationshipMatch && relationshipMatch[1]) {
              // Convert snake_case to space-separated name (e.g., aditya_ramadhan -> aditya ramadhan)
              const extractedName = relationshipMatch[1].replace(/_/g, ' ');
              
              // Add the extracted name as an alias
              if (!userAliases[userId]) {
                userAliases[userId] = new Set();
              }
              userAliases[userId].add(extractedName);
              
              // Also add individual name components
              const nameParts = extractedName.split(' ');
              nameParts.forEach(part => {
                if (part.length > 2) { // Only add meaningful parts
                  userAliases[userId].add(part);
                }
              });
            }
          }
        });
      }
    });
  }
  
  // Generate alias lookup map for efficient search
  const aliasToId = {};
  Object.entries(userAliases).forEach(([userId, aliases]) => {
    aliases.forEach(alias => {
      if (!aliasToId[alias]) {
        aliasToId[alias] = [];
      }
      aliasToId[alias].push(userId);
    });
  });
  
  // Find potential target users using a scoring approach
  const userScores = {};
  
  // Method 1: Direct matching with names/aliases
  Object.entries(userAliases).forEach(([userId, aliases]) => {
    aliases.forEach(alias => {
      // Exact match gets highest score
      if (alias === lowerTargetName) {
        userScores[userId] = (userScores[userId] || 0) + 10;
      }
      // Contains the full target name
      else if (alias.includes(lowerTargetName)) {
        userScores[userId] = (userScores[userId] || 0) + 5;
      }
      // Target name contains this alias (might be a shorthand)
      else if (lowerTargetName.includes(alias) && alias.length > 2) {
        userScores[userId] = (userScores[userId] || 0) + 3;
      }
      // First name or nickname match
      else if (alias.split(/\s+/)[0] === lowerTargetName || 
              alias.includes(`"${lowerTargetName}"`) ||
              alias.includes(`'${lowerTargetName}'`)) {
        userScores[userId] = (userScores[userId] || 0) + 5;
      }
    });
  });
  
  // Method 2: Check for phone number matches
  const phoneMatch = lowerTargetName.match(/\b(\d{10,})\b/);
  if (phoneMatch && phoneNumberMap[phoneMatch[1]]) {
    const matchedUserId = phoneNumberMap[phoneMatch[1]];
    userScores[matchedUserId] = (userScores[matchedUserId] || 0) + 15; // High score for phone match
  }
  
  // Method 3: Handle nicknames and shorthand references like "si ipe" or "pak adi"
  const nicknamePattern = /\b(si|pak|bu|mas|mbak|bang|kak)\s+(\w+)\b/i;
  const nicknameMatch = lowerTargetName.match(nicknamePattern);
  
  if (nicknameMatch) {
    const extractedName = nicknameMatch[2]; // The name part after si/pak/bu/etc
    
    Object.entries(userAliases).forEach(([userId, aliases]) => {
      aliases.forEach(alias => {
        if (alias.includes(extractedName)) {
          userScores[userId] = (userScores[userId] || 0) + 4;
        }
      });
    });
  }
  
  // NEW: Method 4: Handle abbreviated nicknames like "dan" for "Aditya Ramadhan"
  // This is especially important for Indonesian names where the last name/part is often used as nickname
  if (lowerTargetName.length >= 2 && !nicknameMatch) {
    Object.entries(userAliases).forEach(([userId, aliases]) => {
      aliases.forEach(alias => {
        // Check if any name part ends with the target name
        const aliasParts = alias.split(/\s+/);
        aliasParts.forEach(part => {
          if (part.length > 2 && part.endsWith(lowerTargetName)) {
            userScores[userId] = (userScores[userId] || 0) + 3;
          }
          // Or if any part starts with the target name
          if (part.length > 2 && part.startsWith(lowerTargetName)) {
            userScores[userId] = (userScores[userId] || 0) + 2;
          }
        });
        
        // Check for the last part of multi-word names (common Indonesian nickname pattern)
        if (aliasParts.length > 1) {
          const lastPart = aliasParts[aliasParts.length - 1];
          if (lastPart === lowerTargetName) {
            userScores[userId] = (userScores[userId] || 0) + 5; // Significant boost for exact last name match
          }
        }
      });
    });
  }
  
  // Get the top matched users
  const matchedUserIds = Object.entries(userScores)
    .filter(([_, score]) => score >= 2) // Lower the minimum match score to be more inclusive
    .sort((a, b) => b[1] - a[1])  // Sort by score descending
    .map(([userId, _]) => userId);
  
  console.log(`[CONTEXT] Found ${matchedUserIds.length} possible users matching "${targetName}" based on name`);
  
  // If we have matches, find conversations with these users
  if (matchedUserIds.length > 0) {
    matchedUserIds.forEach(targetUserId => {
      // Look through all chats for conversations with this user
      Object.entries(db.data.conversations).forEach(([chatId, chat]) => {
        // Skip current chat and ensure this user is a participant
        if (chatId === currentChatId || !chat.participants[targetUserId]) {
          return;
        }
        
        foundUser = true;
        
        // Find message exchanges between bot and this user
        let conversationExchanges = [];
        let lastBotMessageIndex = -1;
        
        // Look for patterns of the bot and user talking to each other
        chat.messages.forEach((msg, index) => {
          if (msg.sender === process.env.BOT_ID) {
            lastBotMessageIndex = index;
          } else if (msg.sender === targetUserId && lastBotMessageIndex !== -1 && index - lastBotMessageIndex <= 2) {
            // This is a user response to the bot's message
            // Add both the bot's message and the user's response
            conversationExchanges.push({
              botMessage: chat.messages[lastBotMessageIndex],
              userMessage: msg,
              timestamp: msg.timestamp
            });
          }
        });
        
        // Add to result messages
        conversationExchanges.forEach(exchange => {
          resultMessages.push({
            content: exchange.botMessage.content,
            timestamp: exchange.botMessage.timestamp,
            name: db.data.config.botName,
            chatName: chat.chatName || 'a private chat',
            responseContent: exchange.userMessage.content
          });
          
          resultMessages.push({
            content: exchange.userMessage.content,
            timestamp: exchange.userMessage.timestamp,
            name: chat.participants[targetUserId].name,
            chatName: chat.chatName || 'a private chat'
          });
        });
      });
    });
  }
  
  // If we didn't find the user but the search term seems like a person reference, add a message indicating that
  if (!foundUser && (
    lowerTargetName.length > 2 || 
    nicknameMatch || 
    /\b(dia|dia|mereka|teman|friend|user|pengguna|orang|person|manusia|human)\b/i.test(lowerTargetName)
  )) {
    resultMessages.push({
      content: `I don't recall talking to anyone named ${targetName}`,
      timestamp: new Date().toISOString(),
      name: db.data.config.botName,
      chatName: 'system'
    });
  }
  
  // Sort by recency and limit the results
  return resultMessages
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, MAX_CONVERSATION_MESSAGES);
}

/**
 * Find recent group activity messages
 * @param {Object} db - Database object
 * @param {string} currentChatId - Current chat ID
 * @param {string} targetChat - Target chat name (optional)
 * @returns {Array} - Array of relevant group activity messages
 */
function findGroupActivityMessages(db, currentChatId, targetChat) {
  const resultMessages = [];
  const MAX_GROUP_MESSAGES = 10;
  
  // Build a mapping of group chats for better matching
  const groupChats = {};
  const groupAliases = {};
  const recentlyActiveGroups = [];
  
  // Compile a directory of all group chats
  Object.entries(db.data.conversations).forEach(([chatId, chat]) => {
    // Only consider group chats
    if (!chatId.endsWith('@g.us')) {
      return;
    }
    
    const chatName = chat.chatName || '';
    if (chatName) {
      groupChats[chatId] = chat;
      
      // Track all possible names/aliases for this group
      if (!groupAliases[chatId]) {
        groupAliases[chatId] = new Set();
      }
      
      // Add the full name
      groupAliases[chatId].add(chatName.toLowerCase());
      
      // Add common shorthand variants
      const words = chatName.split(/\s+/);
      if (words.length > 1) {
        // First word might be used as shorthand
        groupAliases[chatId].add(words[0].toLowerCase());
        
        // First letter of each word (like "WA" for "WhatsApp Group")
        const acronym = words.map(w => w[0]).join('').toLowerCase();
        if (acronym.length > 1) {
          groupAliases[chatId].add(acronym);
        }
      }
      
      // Check last activity time to prioritize recently active groups
      const lastMessageTime = chat.messages && chat.messages.length > 0 
        ? new Date(chat.messages[chat.messages.length - 1].timestamp)
        : new Date(0);
        
      const hoursSinceLastActivity = (new Date() - lastMessageTime) / (1000 * 60 * 60);
      
      // Consider groups active in the last 24 hours as "recently active"
      if (hoursSinceLastActivity < 24) {
        recentlyActiveGroups.push({
          chatId,
          chatName,
          hoursSinceLastActivity,
          messageCount: chat.messages.length
        });
      }
    }
  });
  
  // Generate alias lookup map for efficient group search
  const aliasToGroupId = {};
  Object.entries(groupAliases).forEach(([chatId, aliases]) => {
    aliases.forEach(alias => {
      if (!aliasToGroupId[alias]) {
        aliasToGroupId[alias] = [];
      }
      aliasToGroupId[alias].push(chatId);
    });
  });
  
  // Find matching groups using a scoring approach
  const groupScores = {};
  
  // Skip group matching if no target chat specified and just use most active group
  if (!targetChat || targetChat.trim().length === 0) {
    // Most active groups get a base score
    recentlyActiveGroups.forEach(group => {
      // Higher score for more recently active groups with more messages
      const activityScore = Math.max(0, 10 - group.hoursSinceLastActivity/2) + 
                           Math.min(5, group.messageCount / 50);
      groupScores[group.chatId] = activityScore;
    });
  } 
  // Otherwise try to match the requested group name
  else {
    const lowerTargetChat = targetChat.toLowerCase();
    
    // Method 1: Direct matching with names/aliases
    Object.entries(groupAliases).forEach(([chatId, aliases]) => {
      aliases.forEach(alias => {
        // Exact match gets highest score
        if (alias === lowerTargetChat) {
          groupScores[chatId] = (groupScores[chatId] || 0) + 10;
        }
        // Contains the full target name
        else if (alias.includes(lowerTargetChat)) {
          groupScores[chatId] = (groupScores[chatId] || 0) + 5;
        }
        // Target name contains this alias (might be a shorthand)
        else if (lowerTargetChat.includes(alias) && alias.length > 2) {
          groupScores[chatId] = (groupScores[chatId] || 0) + 3;
        }
      });
    });
    
    // Method 2: Handle "si" or "grup/group" prefix patterns like "grup wa" or "group keluarga"
    const groupPrefixPattern = /\b(grup|group|gc|grp)\s+(\w+)\b/i;
    const groupPrefixMatch = lowerTargetChat.match(groupPrefixPattern);
    
    if (groupPrefixMatch) {
      const extractedName = groupPrefixMatch[2]; // The name part after grup/group
      
      Object.entries(groupAliases).forEach(([chatId, aliases]) => {
        aliases.forEach(alias => {
          if (alias.includes(extractedName)) {
            groupScores[chatId] = (groupScores[chatId] || 0) + 4;
          }
        });
      });
    }
  }
  
  // Add activity-based boosting to the scores
  recentlyActiveGroups.forEach(group => {
    // Boost score for recently active groups
    if (groupScores[group.chatId] !== undefined) {
      const activityBoost = Math.max(0, 5 - group.hoursSinceLastActivity/4);
      groupScores[group.chatId] += activityBoost;
    }
  });
  
  // Get the top matched groups or most active if no specific match
  const matchedGroupIds = Object.entries(groupScores)
    .sort((a, b) => b[1] - a[1])  // Sort by score descending
    .slice(0, 2)  // Get top 2 matches
    .filter(([_, score]) => score >= 1) // Ensure some minimum relevance
    .map(([chatId, _]) => chatId);
  
  // If no groups matched or were active, use all groups
  if (matchedGroupIds.length === 0) {
    // Use all groups, sorting by recency
    matchedGroupIds.push(
      ...Object.keys(groupChats)
        .filter(id => id !== currentChatId)
        .sort((a, b) => {
          const aLastMsg = groupChats[a].messages.length > 0 ? 
            new Date(groupChats[a].messages[groupChats[a].messages.length - 1].timestamp) : 
            new Date(0);
          const bLastMsg = groupChats[b].messages.length > 0 ? 
            new Date(groupChats[b].messages[groupChats[b].messages.length - 1].timestamp) : 
            new Date(0);
          return bLastMsg - aLastMsg;
        })
        .slice(0, 2) // Limit to 2 groups
    );
  }
  
  // For each matched group, get relevant messages
  matchedGroupIds.forEach(groupId => {
    const chat = groupChats[groupId];
    
    // Skip if no chat data (should never happen)
    if (!chat) return;
    
    // Get recent messages from this group
    const recentMessages = chat.messages
      .slice(-15) // Get the 15 most recent messages
      .filter(msg => msg.content && msg.content.trim().length > 0); // Only messages with content
    
    // Find the most active participants
    const participantCounts = {};
    recentMessages.forEach(msg => {
      if (!participantCounts[msg.sender]) {
        participantCounts[msg.sender] = 0;
      }
      participantCounts[msg.sender]++;
    });
    
    // Get the most active participants (excluding the bot)
    const mostActiveParticipants = Object.entries(participantCounts)
      .filter(([id, _]) => id !== process.env.BOT_ID)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, _]) => id);
      
    // Identify conversation threads (consecutive messages on a topic)
    const conversationThreads = [];
    let currentThread = [];
    let lastSender = null;
    
    recentMessages.forEach((msg, idx) => {
      // Start a new thread if:
      // - This is a different sender from the last message
      // - OR this message starts with a question or seems to change topic
      const isNewTopic = msg.content.includes('?') ||
                         /^(btw|ngomong|bicara|ngomongin|bahas|tentang|btw|anyway)\b/i.test(msg.content);
      
      if (lastSender !== msg.sender || isNewTopic || currentThread.length >= 5) {
        if (currentThread.length > 0) {
          conversationThreads.push([...currentThread]);
        }
        currentThread = [msg];
      } else {
        currentThread.push(msg);
      }
      
      lastSender = msg.sender;
      
      // Also end the thread at the end of the messages
      if (idx === recentMessages.length - 1 && currentThread.length > 0) {
        conversationThreads.push([...currentThread]);
      }
    });
    
    // Score threads by interestingness
    const scoredThreads = conversationThreads.map(thread => {
      let score = 0;
      
      // Threads with more messages are more interesting
      score += Math.min(5, thread.length);
      
      // Threads with questions are more interesting
      if (thread.some(msg => msg.content.includes('?'))) {
        score += 3;
      }
      
      // Threads with the bot participating are more interesting
      if (thread.some(msg => msg.sender === process.env.BOT_ID)) {
        score += 4;
      }
      
      // Threads with active participants are more interesting
      if (thread.some(msg => mostActiveParticipants.includes(msg.sender))) {
        score += 2;
      }
      
      // Threads with emotional content are more interesting
      if (thread.some(msg => 
        msg.content.includes('!') || 
        /😂|😊|😢|😠|😡|❤️|👍|👎/.test(msg.content)
      )) {
        score += 2;
      }
      
      return { thread, score };
    });
    
    // Select the most interesting threads
    const selectedThreads = scoredThreads
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(item => item.thread);
    
    // Add an introduction message for this group
    resultMessages.push({
      content: `Here's what was discussed recently in ${chat.chatName || 'the group'}:`,
      timestamp: new Date().toISOString(),
      name: 'system',
      chatName: chat.chatName || 'a group chat',
      isHeader: true
    });
    
    // Add selected thread messages
    selectedThreads.forEach(thread => {
      thread.forEach(msg => {
        const senderName = chat.participants[msg.sender]?.name || msg.name || 'Unknown';
        resultMessages.push({
          ...msg,
          name: senderName,
          chatName: chat.chatName || 'a group chat'
        });
      });
      
      // Add a separator between threads
      if (selectedThreads.length > 1 && thread !== selectedThreads[selectedThreads.length - 1]) {
        resultMessages.push({
          content: "---",
          timestamp: new Date().toISOString(),
          name: 'system',
          chatName: chat.chatName || 'a group chat',
          isSeparator: true
        });
      }
    });
    
    // If the bot has recently responded in this group, include that too
    const botMessages = recentMessages
      .filter(msg => msg.sender === process.env.BOT_ID)
      .slice(-1); // Just the most recent bot message
      
    if (botMessages.length > 0 && !selectedThreads.some(thread => 
      thread.some(msg => msg.sender === process.env.BOT_ID)
    )) {
      resultMessages.push({
        content: "My last message in this group was:",
        timestamp: new Date().toISOString(),
        name: 'system',
        chatName: chat.chatName || 'a group chat',
        isHeader: true
      });
      
      botMessages.forEach(msg => {
        resultMessages.push({
          ...msg,
          name: db.data.config.botName,
          chatName: chat.chatName || 'a group chat'
        });
      });
    }
  });
  
  // If no relevant group messages found, provide an informative response
  if (resultMessages.length === 0) {
    if (targetChat) {
      resultMessages.push({
        content: `I don't have any recent conversations from a group called "${targetChat}"`,
        timestamp: new Date().toISOString(),
        name: 'system',
        chatName: 'system'
      });
    } else {
      resultMessages.push({
        content: "I don't have any recent group conversations to share",
        timestamp: new Date().toISOString(),
        name: 'system',
        chatName: 'system'
      });
    }
  }
  
  // Sort by timestamp within each group, but keep groups separated
  const resultsByGroup = {};
  resultMessages.forEach(msg => {
    if (!resultsByGroup[msg.chatName]) {
      resultsByGroup[msg.chatName] = [];
    }
    resultsByGroup[msg.chatName].push(msg);
  });
  
  // Sort each group's messages by timestamp
  Object.values(resultsByGroup).forEach(groupMsgs => {
    groupMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  });
  
  // Reassemble, keeping headers at the top of each group
  const finalResults = [];
  Object.values(resultsByGroup).forEach(groupMsgs => {
    // Move headers to the front
    const headers = groupMsgs.filter(msg => msg.isHeader);
    const nonHeaders = groupMsgs.filter(msg => !msg.isHeader);
    finalResults.push(...headers, ...nonHeaders);
  });
  
  // Limit to maximum messages while trying to keep complete threads
  return finalResults.slice(0, MAX_GROUP_MESSAGES);
}

// Get info about a group
async function getGroupInfo(db, groupId, sock) {
  try {
    const groupInfo = await sock.groupMetadata(groupId);
    let conversation = db.data.conversations[groupId];
    if (!db.data.conversations[groupId]) {
      db.data.conversations[groupId] = {
        messages: [],
        participants: {},
        lastActive: new Date().toISOString(),
        chatType: 'group',
        chatName: groupInfo.subject,
        hasIntroduced: false,
        lastIntroduction: null,
        joinedAt: new Date().toISOString()
      };
    } else {
      // Update existing entry
      db.data.conversations[groupId].chatName = groupInfo.subject;
      db.data.conversations[groupId].joinedAt = new Date().toISOString();
      db.data.conversations[groupId].hasIntroduced = false; // Reset introduction state
    }
    await db.write();
    conversation = db.data.conversations[groupId];
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
    const groupInfo = await getGroupInfo(db, groupId, sock);
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

/**
 * Detect if a message is asking about the bot's behavior or conversations in other chats
 * @param {string} content - Message content to analyze
 * @param {string} botName - The bot's name for detection
 * @returns {Object} Detection result with type and targets
 */
function detectCrossChatQuestion(content, botName) {
  if (!content || typeof content !== 'string') {
    return { isCrossChatQuestion: false };
  }
  
  const lowerContent = content.toLowerCase();
  const botNameLower = botName.toLowerCase();
  
  // Normalize content for easier pattern matching
  const normalizedContent = lowerContent
    .replace(/\?/g, ' ?')
    .replace(/\s\s+/g, ' ')
    .trim();
  
  // Different types of cross-chat questions to detect
  const result = {
    isCrossChatQuestion: false,
    type: null,
    targetName: null,
    targetChat: null,
    isAboutBot: false,
    isAboutMood: false
  };
  
  // Check if the question is asking about the bot's mood or behavior
  const botBehaviorPatterns = [
    new RegExp(`kenapa.*(${botNameLower}|kamu|lu|kau|lo).*(marah|kesal|emosi|bete)`, 'i'),
    new RegExp(`(${botNameLower}|kamu|lu|kau|lo).*(kenapa).*(marah|kesal|emosi|bete)`, 'i'),
    new RegExp(`(ada apa|kenapa).*(di grup|dalam grup|di group|digrup)`, 'i'),
    new RegExp(`(${botNameLower}|kamu|lu|kau|lo).*(lagi).*(marah|kesal|emosi|bete)`, 'i'),
    new RegExp(`(${botNameLower}|kamu|lu|kau|lo).*(mood).*(apa|gimana|bagaimana)`, 'i'),
    new RegExp(`(mood).*(${botNameLower}|kamu|lu|kau|lo).*(apa|gimana|bagaimana)`, 'i'),
    new RegExp(`(knp|kenapa).*(${botNameLower}|kamu|lu|kau|lo).*(kesal|marah)`, 'i')
  ];
  
  // Check if the question is asking about conversations with specific people
  const conversationPatterns = [
    new RegExp(`(ada|pernah).*(obrolan|pembicaraan|ngobrol).*(tentang|dengan|sama).*(\\w+)`, 'i'),
    new RegExp(`(\\w+).*(ngobrol|chat|bicara).*(apa|tentang apa).*(sama|dengan).*(${botNameLower}|kamu|lu|kau|lo)`, 'i'),
    new RegExp(`(${botNameLower}|kamu|lu|kau|lo).*(ngobrol|chat|bicara).*(apa|tentang apa).*(sama|dengan).*(\\w+)`, 'i'),
    new RegExp(`(${botNameLower}|kamu|lu|kau|lo).*(suka|sering).*(ngobrol|chat|bicara).*(sama|dengan).*(\\w+)`, 'i'),
    new RegExp(`(\\w+).*(suka|sering).*(ngobrol|chat|bicara).*(sama|dengan).*(${botNameLower}|kamu|lu|kau|lo)`, 'i'),
    // Enhanced patterns for more indirect references
    new RegExp(`(\\w+).*(ngomong|ngomongin|bilang).*(apa).*(ke|sama|pada|kepada).*(${botNameLower}|kamu|lu|kau|lo)`, 'i'),
    new RegExp(`(\\w+).*(ngomong|ngomongin|bilang|ngobrol).*(apa).*(aja|saja|di|dalam)`, 'i'),
    new RegExp(`(apa).*(kata|ucapan|omongan).*(\\w+)`, 'i'),
    new RegExp(`(gimana|bagaimana).*(si|pak|bu|bang|mbak|mas|kak).*(\\w+)`, 'i'),
    // New patterns for nickname-style questions
    new RegExp(`(si|pak|bu|bang|mbak|mas|kak)\\s+(\\w+)\\s+(ngomong|bilang|ngomongin|ngobrol)\\s+(apa)`, 'i'),
    new RegExp(`(\\w+)\\s+(ngomong|bilang|ngomongin|ngobrol)\\s+(apa)\\s+(di grup|dalam grup|di group|digrup)`, 'i')
  ];
  
  // Enhanced patterns for group activity questions
  const groupActivityPatterns = [
    new RegExp(`(ada apa|kenapa|apa kabar|gimana|bagaimana).*(di grup|dalam grup|di group|digrup)`, 'i'),
    new RegExp(`(di grup|dalam grup|di group|digrup).*(\\w+).*(ada apa|kenapa|apa kabar|gimana|bagaimana)`, 'i'),
    new RegExp(`(di grup|dalam grup|di group|digrup).*(\\w+).*(lagi|sedang).*(ngomongin|bahas|obrolan|ngobrol|ngobrolin)`, 'i'),
    new RegExp(`(apa).*(yang|sedang|lagi).*(diobrolin|dibahas|dibicarakan).*(di grup|dalam grup|di group|digrup)`, 'i'),
    new RegExp(`(grup|group).*(\\w+).*(lagi|pada).*(ngomongin|ngobrolin|bahas)`, 'i')
  ];
  
  // Check for bot behavior/mood questions
  for (const pattern of botBehaviorPatterns) {
    const match = normalizedContent.match(pattern);
    if (match) {
      result.isCrossChatQuestion = true;
      result.type = 'mood';
      result.isAboutBot = true;
      result.isAboutMood = true;
      
      // Try to extract which group they're asking about
      const groupMatch = normalizedContent.match(/(di|dalam)\s+(grup|group)\s+(\w+)/i);
      if (groupMatch && groupMatch[3]) {
        result.targetChat = groupMatch[3];
      }
      
      return result;
    }
  }
  
  // Check for group activity patterns first (more specific)
  for (const pattern of groupActivityPatterns) {
    const match = normalizedContent.match(pattern);
    if (match) {
      result.isCrossChatQuestion = true;
      result.type = 'group_activity';
      
      // Try to extract which group they're asking about
      let groupNameMatch = null;
      
      // Different patterns for group name extraction
      const groupPatterns = [
        /(di|dalam)\s+(grup|group)\s+(\w+)/i,   // "di grup xyz"
        /(grup|group)\s+(\w+)/i,                // "grup xyz"
        /gc\s+(\w+)/i                           // "gc xyz"
      ];
      
      for (const gPattern of groupPatterns) {
        const gMatch = normalizedContent.match(gPattern);
        if (gMatch) {
          // The group name will be in different capture groups depending on pattern
          const groupNameIndex = gPattern.toString().includes('(di|dalam)') ? 3 : 2;
          if (gMatch[groupNameIndex]) {
            groupNameMatch = gMatch[groupNameIndex];
            break;
          }
        }
      }
      
      if (groupNameMatch) {
        result.targetChat = groupNameMatch;
      }
      
      return result;
    }
  }
  
  // Check for conversation questions
  for (const pattern of conversationPatterns) {
    const match = normalizedContent.match(pattern);
    if (match) {
      result.isCrossChatQuestion = true;
      result.type = 'conversation';
      
      // Try to extract the name of the person they're asking about
      // This requires checking different pattern positions based on the regex
      let targetNameIndex = 4; // Default position in most patterns
      
      if (pattern.toString().includes("(\\w+).*ngomong") || 
          pattern.toString().includes("(\\w+).*ngobrol") ||
          pattern.toString().includes("(\\w+).*bilang") ||
          pattern.toString().includes("(apa).*(kata|ucapan)") ||
          pattern.toString().includes("(gimana|bagaimana).*(si|pak)")) {
        targetNameIndex = 1;
      }
      
      // Special handling for "apa kata X" pattern
      if (pattern.toString().includes("(apa).*(kata|ucapan)")) {
        targetNameIndex = 3;
      }
      
      // Special handling for "gimana si X" pattern
      if (pattern.toString().includes("(gimana|bagaimana).*(si|pak)")) {
        targetNameIndex = 3;
      }
      
      // Special handling for "si X ngomong apa" pattern
      if (pattern.toString().includes("(si|pak|bu|bang|mbak|mas|kak)\\s+(\\w+)\\s+(ngomong|bilang)")) {
        targetNameIndex = 2;
      }
      
      if (match[targetNameIndex] && !['tentang', 'dengan', 'sama', 'apa', botNameLower, 'kamu', 'lo', 'lu', 'kau', 'di', 'dalam', 'group', 'grup'].includes(match[targetNameIndex].toLowerCase())) {
        result.targetName = match[targetNameIndex];
      }
      
      // Check if the question is about the bot or someone else
      result.isAboutBot = normalizedContent.includes(botNameLower) || 
                        normalizedContent.includes('kamu') || 
                        normalizedContent.includes('lu') || 
                        normalizedContent.includes('lo') || 
                        normalizedContent.includes('kau');
      
      return result;
    }
  }
  
  // Additional checks for group activity questions
  if (normalizedContent.includes('ada apa di grup') || 
      normalizedContent.includes('ada apa dalam grup') ||
      normalizedContent.includes('ada apa di group') ||
      normalizedContent.includes('ada obrolan apa') ||
      normalizedContent.includes('lagi ngomongin apa') ||
      normalizedContent.includes('pada ngobrol apa') ||
      normalizedContent.includes('ngomong apa aja') ||
      normalizedContent.includes('ngomongin apa aja') ||
      normalizedContent.includes('ngobrolin apa aja')) {
    
    result.isCrossChatQuestion = true;
    result.type = 'group_activity';
    
    // Try to extract which group they're asking about
    const groupMatch = normalizedContent.match(/(di|dalam)\s+(grup|group)\s+(\w+)/i);
    if (groupMatch && groupMatch[3]) {
      result.targetChat = groupMatch[3];
    }
    
    return result;
  }
  
  // Check for name-first patterns (often in Indonesian, name comes first)
  // For example: "Si Ipe ngomong apa aja?" or "Pak Budi bilang apa ke kamu?"
  const nameFirstPatterns = [
    /^(si|pak|bu|mas|mbak|bang|kak)?\s*(\w+)\s+(ngomong|bilang|ngobrol|bicara|ngomongin|bahas)\s+(apa|gimana|bagaimana)/i,
    /^(\w+)\s+(ngomong|bilang|ngobrol|bicara|ngomongin|bahas)\s+(apa|gimana|bagaimana)/i,
    /^(apa yang|gimana)\s+(\w+)\s+(ngomong|bilang|ngobrol|bicara|ngomongin|bahas)/i
  ];
  
  for (const namePattern of nameFirstPatterns) {
    const nameMatch = normalizedContent.match(namePattern);
    if (nameMatch) {
      result.isCrossChatQuestion = true;
      result.type = 'conversation';
      
      // The name is either in group 2 (with prefix) or group 1 (without prefix)
      const nameIndex = namePattern.toString().includes('(si|pak|bu|mas|mbak|bang|kak)') ? 2 : 1;
      if (namePattern.toString().includes('(apa yang|gimana)')) {
        result.targetName = nameMatch[2]; // In this pattern, name is in group 2
      } else {
        result.targetName = nameMatch[nameIndex];
      }
      
      return result;
    }
  }
  
  // NEW: Look for abbreviated or nickname patterns like "Si Adan ngomong apa di grup?"
  // where "Adan" might be a nickname for "Aditya Ramadhan"
  const nicknamePattern = /(si|pak|bu|mas|mbak|bang|kak)?\s*(\w+)\s+/i;
  const nicknameMatch = normalizedContent.match(nicknamePattern);
  
  if (nicknameMatch && 
      (normalizedContent.includes('ngomong') || 
       normalizedContent.includes('bilang') || 
       normalizedContent.includes('ngomongin') || 
       normalizedContent.includes('ngobrol'))) {
    
    result.isCrossChatQuestion = true;
    result.type = 'conversation';
    
    // Extract the potential nickname - it will be in group 2 if there was a prefix (si, pak, etc.)
    // or group 1 if there was no prefix
    const nameIndex = nicknameMatch[1] ? 2 : 1;
    if (nicknameMatch[nameIndex] && 
        !['apa', 'grup', 'group', 'kamu', 'lu', 'lo', 'kau', botNameLower].includes(nicknameMatch[nameIndex].toLowerCase())) {
      result.targetName = nicknameMatch[nameIndex];
      
      console.log(`[CONTEXT] Extracted potential nickname: ${result.targetName}`);
    }
    
    return result;
  }
  
  return result;
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

/**
 * Helper function to find user IDs based on name or nickname
 * @param {Object} db - Database object
 * @param {string} nameOrNickname - Name or nickname to search for
 * @returns {Array} - Array of matching user IDs with their match score
 */
function findUserIdsByName(db, nameOrNickname) {
  if (!nameOrNickname || typeof nameOrNickname !== 'string' || nameOrNickname.trim().length < 2) {
    return [];
  }
  
  const lowerName = nameOrNickname.toLowerCase().trim();
  console.log(`[CONTEXT] Finding user IDs for name/nickname: "${lowerName}"`);
  
  // Store user ID matches with their scores
  const userScores = {};
  
  // 1. Build a directory of all user names and aliases
  const userAliases = {};
  const namePartsIndex = {}; // Index to find users by parts of their names
  
  // From conversations participants
  Object.entries(db.data.conversations || {}).forEach(([chatId, chat]) => {
    Object.entries(chat.participants || {}).forEach(([userId, participant]) => {
      if (userId === process.env.BOT_ID) return;
      
      const participantName = participant.name || '';
      if (!participantName) return;
      
      if (!userAliases[userId]) {
        userAliases[userId] = new Set();
      }
      
      const lowerParticipantName = participantName.toLowerCase();
      userAliases[userId].add(lowerParticipantName);
      
      // Index name parts for partial matching
      const nameParts = lowerParticipantName.split(/\s+/);
      nameParts.forEach(part => {
        if (part.length > 2) {
          if (!namePartsIndex[part]) {
            namePartsIndex[part] = new Set();
          }
          namePartsIndex[part].add(userId);
        }
      });
    });
  });
  
  // From user facts
  Object.entries(db.data.userFacts || {}).forEach(([userId, userData]) => {
    if (userData.facts) {
      // Direct name-related facts
      const nameRelatedFacts = ['name', 'full_name', 'nickname', 'first_name', 'last_name', 'alias', 'called'];
      nameRelatedFacts.forEach(factType => {
        if (userData.facts[factType] && userData.facts[factType].value) {
          if (!userAliases[userId]) {
            userAliases[userId] = new Set();
          }
          
          const lowerValue = userData.facts[factType].value.toLowerCase();
          userAliases[userId].add(lowerValue);
          
          // Index name parts
          const nameParts = lowerValue.split(/\s+/);
          nameParts.forEach(part => {
            if (part.length > 2) {
              if (!namePartsIndex[part]) {
                namePartsIndex[part] = new Set();
              }
              namePartsIndex[part].add(userId);
            }
          });
        }
      });
      
      // Relationship-based nickname facts
      Object.entries(userData.facts).forEach(([factKey, factData]) => {
        // Handle nickname facts
        if (factKey.includes('_nickname') && factData.value) {
          if (!userAliases[userId]) {
            userAliases[userId] = new Set();
          }
          
          const lowerValue = factData.value.toLowerCase();
          userAliases[userId].add(lowerValue);
          
          // Index nickname parts
          const nameParts = lowerValue.split(/\s+/);
          nameParts.forEach(part => {
            if (part.length > 2) {
              if (!namePartsIndex[part]) {
                namePartsIndex[part] = new Set();
              }
              namePartsIndex[part].add(userId);
            }
          });
        }
        
        // Extract names from relationship fact keys
        if (factKey.startsWith('user_relationship_')) {
          // Try to extract a name from the key pattern
          const relationshipMatch = factKey.match(/user_relationship_([a-z_]+)_/i);
          if (relationshipMatch && relationshipMatch[1]) {
            const extractedName = relationshipMatch[1].replace(/_/g, ' ');
            
            if (!userAliases[userId]) {
              userAliases[userId] = new Set();
            }
            
            userAliases[userId].add(extractedName);
            
            // Index the name parts
            const nameParts = extractedName.split(/\s+/);
            nameParts.forEach(part => {
              if (part.length > 2) {
                if (!namePartsIndex[part]) {
                  namePartsIndex[part] = new Set();
                }
                namePartsIndex[part].add(userId);
              }
            });
          }
        }
      });
    }
  });
  
  // 2. Matching strategies
  
  // Direct alias matching
  Object.entries(userAliases).forEach(([userId, aliases]) => {
    aliases.forEach(alias => {
      // Exact match
      if (alias === lowerName) {
        userScores[userId] = (userScores[userId] || 0) + 10;
      }
      // Contains the target name
      else if (alias.includes(lowerName)) {
        userScores[userId] = (userScores[userId] || 0) + 5;
      }
      // Target name contains this alias
      else if (lowerName.includes(alias) && alias.length > 2) {
        userScores[userId] = (userScores[userId] || 0) + 3;
      }
    });
  });
  
  // Name parts matching (for nicknames and abbreviated names)
  const targetNameParts = lowerName.split(/\s+/);
  targetNameParts.forEach(part => {
    if (part.length > 2 && namePartsIndex[part]) {
      namePartsIndex[part].forEach(userId => {
        userScores[userId] = (userScores[userId] || 0) + 3;
      });
    }
  });
  
  // Handle nicknames with prefixes (si, pak, etc.)
  const nicknamePattern = /\b(si|pak|bu|mas|mbak|bang|kak)\s+(\w+)\b/i;
  const nicknameMatch = lowerName.match(nicknamePattern);
  
  if (nicknameMatch) {
    const extractedName = nicknameMatch[2]; // The name part after si/pak/bu/etc
    
    if (namePartsIndex[extractedName]) {
      namePartsIndex[extractedName].forEach(userId => {
        userScores[userId] = (userScores[userId] || 0) + 4;
      });
    }
  }
  
  // 3. Return scored results
  const results = Object.entries(userScores)
    .filter(([_, score]) => score >= 2) // Minimum threshold for matches
    .sort((a, b) => b[1] - a[1]) // Sort by score descending
    .map(([userId, score]) => ({ userId, score }));
  
  console.log(`[CONTEXT] Found ${results.length} potential user matches for "${lowerName}"`);
  return results;
}

export { 
  updateContext,
  getRelevantContext, 
  detectCrossChatQuestion,
  getCrossChatContextForQuestion,
  findUserIdsByName,
  clearContext,
  shouldIntroduceInGroup,
  generateGroupIntroduction,
  findRelatedMessages,
  findTopicSpecificMessages
};