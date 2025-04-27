// Response probability settings
const BASE_RESPONSE_PROBABILITY = 0.3; // 30% chance to respond to normal conversation
const INTERESTING_KEYWORD_PROBABILITY = 0.7; // 70% chance to respond if message contains interesting keywords
const DIRECT_QUESTION_PROBABILITY = 0.9; // 90% chance to respond to direct questions
const BOT_NAME_MENTION_PROBABILITY = 0.95; // 95% chance to respond if name is mentioned but not tagged
const INACTIVE_CHAT_PROBABILITY = 0.4; // 40% chance to respond in inactive chat to restart conversation
const PRIVATE_CHAT_BASE_PROBABILITY = 0.8; // 80% base chance to respond in private chats
const CONVERSATION_CONTINUATION_PROBABILITY = 0.75; // 75% chance to respond when conversation flows

// Interesting keywords that might trigger a response
const INTERESTING_KEYWORDS = [
  'ai', 'chatbot', 'teknologi', 'menarik', 'pinter', 'cerdas', 'keren', 'lucu', 'gimana', 'menurut', 'pendapat',
  'setuju', 'bisa', 'mau', 'seru', 'gila', 'anjir', 'wkwk', 'haha', 'lol', 'mantap', 'asik', 'waduh', 'hadeh'
];

// Question indicators
const QUESTION_INDICATORS = [
  '?', 'apa', 'siapa', 'kapan', 'dimana', 'gimana', 'bagaimana', 'kenapa', 'mengapa', 'boleh', 'bisa', 'apakah', 'tolong'
];

// Conversation continuation markers
const CONTINUATION_MARKERS = [
  'tapi', 'jadi', 'terus', 'lalu', 'soalnya', 'karena', 'kalau', 'misalnya', 'contohnya', 'iya', 'bener', 'padahal',
  'sebenarnya', 'sebenernya', 'emang', 'emangnya', 'harusnya', 'mestinya', 'kayaknya', 'sepertinya', 'keknya', 
  'menurutku', 'menurut gue', 'gue rasa', 'gw pikir', 'aku pikir'
];

// Emotion expressions that might trigger responses
const EMOTION_EXPRESSIONS = [
  'haha', 'wkwk', 'lol', '😂', '😁', '😄', '😅', '🤣', 
  'sedih', '😢', '😭', '😔', '😞', 
  'kesel', 'marah', '😠', '😡', '😤',
  'wow', 'gila', 'anjir', 'asik', '😮', '😲', '🔥', '⚡'
];

// Decide whether the bot should respond to a message
async function shouldRespond(db, chatId, message) {
  try {
    const lowerMessage = message.toLowerCase();
    const botName = db.data.config.botName.toLowerCase();
    
    // Check if this is a private chat (higher response probability)
    const isPrivateChat = !chatId.endsWith('@g.us');
    
    // Check if inactive chat (no messages in the last 30 minutes)
    const isInactiveChat = checkIfInactiveChat(db, chatId);
    
    // Check if message contains bot name (but isn't a direct tag/mention)
    const containsBotName = lowerMessage.includes(botName);
    
    // Check if message is a direct question
    const isQuestion = QUESTION_INDICATORS.some(indicator => 
      lowerMessage.includes(indicator)
    );
    
    // Check if message contains interesting keywords
    const containsInterestingKeyword = INTERESTING_KEYWORDS.some(keyword => 
      lowerMessage.includes(keyword)
    );
    
    // Check if message contains emotion expressions
    const containsEmotions = EMOTION_EXPRESSIONS.some(emotion =>
      lowerMessage.includes(emotion)
    );
    
    // Check if message appears to be continuing a conversation
    const isContinuingConversation = CONTINUATION_MARKERS.some(marker =>
      lowerMessage.includes(marker)
    );
    
    // Get the conversation and check conversation flow
    const conversation = db.data.conversations[chatId];
    if (!conversation) {
      // No previous conversation, fall back to standard probability
      return isPrivateChat ? PRIVATE_CHAT_BASE_PROBABILITY > Math.random() : BASE_RESPONSE_PROBABILITY > Math.random();
    }
    
    const messages = conversation.messages || [];
    const messageCount = messages.length;
    const isNewConversation = messageCount < 5;
    
    // Check if the bot recently responded (last 2-3 messages)
    let recentMessages = messages.slice(-3);
    const botRecentlyResponded = recentMessages.some(msg => 
      msg.sender === process.env.BOT_ID
    );
    
    // Get recent conversation participants (excluding the bot)
    const recentParticipants = new Set();
    recentMessages.forEach(msg => {
      if (msg.sender !== process.env.BOT_ID) {
        recentParticipants.add(msg.sender);
      }
    });
    
    // Check if this is an active multi-person conversation
    const isActiveGroupChat = recentParticipants.size >= 2;
    
    // Check if the bot was mentioned in recent conversation
    const botMentionedRecently = recentMessages.some(msg => 
      msg.content && msg.content.toLowerCase().includes(botName) && msg.sender !== process.env.BOT_ID
    );
    
    // Calculate base probability depending on chat type
    let responseProbability = isPrivateChat ? PRIVATE_CHAT_BASE_PROBABILITY : BASE_RESPONSE_PROBABILITY;
    
    // Adjust probability based on message content
    if (containsBotName) {
      responseProbability = BOT_NAME_MENTION_PROBABILITY;
    } else if (isQuestion) {
      responseProbability = DIRECT_QUESTION_PROBABILITY;
    } else if (containsInterestingKeyword) {
      responseProbability = INTERESTING_KEYWORD_PROBABILITY;
    } else if (isInactiveChat) {
      responseProbability = INACTIVE_CHAT_PROBABILITY;
    } else if (isContinuingConversation && botRecentlyResponded) {
      // If the conversation is continuing and bot recently replied
      responseProbability = CONVERSATION_CONTINUATION_PROBABILITY;
    } else if (containsEmotions && !botRecentlyResponded) {
      // If someone expressed emotion and bot hasn't responded recently
      responseProbability = 0.6;
    } else if (isActiveGroupChat && !botRecentlyResponded) {
      // If it's an active group chat and the bot hasn't recently responded
      responseProbability = 0.4; // Occasionally join in
    }
    
    // Boost probability for new conversations
    if (isNewConversation) {
      responseProbability += 0.2;
    }
    
    // Reduce probability if bot already responded recently and wasn't mentioned again
    if (botRecentlyResponded && !botMentionedRecently && !isQuestion) {
      responseProbability -= 0.3;
    }
    
    // Get sender information and check their interaction history
    const sender = messages.length > 0 ? messages[messages.length - 1].sender : null;
    
    if (sender && conversation.participants[sender]) {
      const participant = conversation.participants[sender];
      
      // Increase probability for participants with few messages (new users)
      if (participant.messageCount < 5) {
        responseProbability += 0.1;
      }
      
      // Increase probability for frequent participants (engaged users)
      if (participant.messageCount > 20) {
        responseProbability += 0.05;
      }
    }
    
    // Add some randomness based on bot's mood
    const { currentMood } = db.data.state;
    switch (currentMood) {
      case 'excited':
      case 'curious':
      case 'energetic':
        // More likely to respond when excited, curious, or energetic
        responseProbability += 0.15;
        break;
      case 'bored':
      case 'sleepy':
        // Less likely to respond when bored or sleepy
        responseProbability -= 0.15;
        break;
      case 'annoyed':
        // When annoyed, more likely to respond to emotions or questions
        if (containsEmotions || isQuestion) {
          responseProbability += 0.1;
        } else {
          responseProbability -= 0.1;
        }
        break;
    }
    
    // Ensure probability is between 0 and 1
    responseProbability = Math.max(0, Math.min(1, responseProbability));
    
    // Make the decision
    const shouldBotRespond = Math.random() < responseProbability;
    
    // Log decision factors for debugging
    if (process.env.DEBUG === 'true') {
      console.log(`[DECISION][${chatId}] Response probability: ${responseProbability.toFixed(2)}`);
      console.log(`[DECISION] Factors: isPrivate=${isPrivateChat}, isQuestion=${isQuestion}, containsName=${containsBotName}, isActive=${!isInactiveChat}, botRecentlyResponded=${botRecentlyResponded}`);
      console.log(`[DECISION] Result: ${shouldBotRespond ? 'Will respond' : 'Will not respond'}`);
    }
    
    return shouldBotRespond;
  } catch (error) {
    console.error('Error deciding whether to respond:', error);
    return false; // Default to not responding in case of error
  }
}

// Check if chat has been inactive for a while (30 minutes)
function checkIfInactiveChat(db, chatId) {
  try {
    const chat = db.data.conversations[chatId];
    if (!chat) {
      return false;
    }
    
    const lastActive = new Date(chat.lastActive);
    const currentTime = new Date();
    const timeDiff = (currentTime - lastActive) / (1000 * 60); // in minutes
    
    return timeDiff > 30;
  } catch (error) {
    console.error('Error checking chat activity:', error);
    return false;
  }
}

export {
  shouldRespond,
  QUESTION_INDICATORS
}; 