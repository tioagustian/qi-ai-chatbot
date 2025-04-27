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
  'wow', 'gila', 'anjir', 'asik', '😮', '��', '🔥', '⚡'
];

// Imported for AI-based decision making
import { generateAIResponseLegacy } from '../services/aiService.js';
import chalk from 'chalk';

// Enhanced decision maker that uses AI to determine if the bot should respond
async function shouldRespond(db, chatId, message) {
  try {
    // Always respond in private chats
    const isPrivateChat = !chatId.endsWith('@g.us');
    if (isPrivateChat) {
      return true;
    }
    
    // Get conversation context for the AI to make a decision
    const conversation = db.data.conversations[chatId];
    if (!conversation) {
      // No context yet, fall back to basic checks
      return isDirectlyAddressed(db, message);
    }

    // Get the last few messages for context
    const recentMessages = conversation.messages.slice(-10).map(msg => ({
      role: msg.sender === process.env.BOT_ID ? 'assistant' : 'user',
      content: msg.content,
      name: msg.name
    }));

    // Check if bot is directly addressed (always respond in this case)
    if (isDirectlyAddressed(db, message)) {
      console.log(chalk.blue(`[DECISION] Bot is directly addressed or question asked. Will respond.`));
      return true;
    }
    
    // Create system message for decision making
    const botName = db.data.config.botName;
    const systemMessage = {
      role: 'system',
      content: `Kamu adalah ${botName}, AI dalam grup WhatsApp. Ini 10 pesan terakhir dari percakapan grup. 
Pesan terakhir adalah dari pengguna yang bukan kamu. TUGASMU: Tentukan apakah pesan terakhir:
1. Secara langsung ditujukan kepada kamu meskipun tidak menyebut namamu
2. Relevan untuk kamu tanggapi sebagai bagian dari percakapan
3. Merupakan konteks dimana pendapatmu atau informasi darimu akan berguna
4. Adalah topik umum yang tidak memerlukan responsmu

RESPONSLAH HANYA DENGAN:
"YES" - jika kamu merasa perlu merespon pesan terakhir ini
"NO" - jika kamu merasa pesan ini bukan untukmu atau tidak perlu responsmu

SANGAT PENTING: Jangan memberikan respon selain "YES" atau "NO". Jangan jelaskan alasanmu.`
    };

    // Add user's current message to make a decision about
    const decisionContext = [
      systemMessage,
      ...recentMessages,
      {
        role: 'user',
        content: `Pesan terakhir grup: "${message}"`
      }
    ];

    console.log(chalk.blue(`[DECISION] Asking AI if bot should respond to: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`));
    
    // Get AI's decision
    const decision = await generateAIResponseLegacy(
      "Haruskah aku merespon pesan ini?", 
      decisionContext, 
      db.data
    );

    const shouldBotRespond = decision.trim().toUpperCase().includes("YES");
    
    console.log(chalk.blue(`[DECISION] AI decision: ${decision.trim()}, Will respond: ${shouldBotRespond}`));
    
    return shouldBotRespond;
  } catch (error) {
    console.error(chalk.red('Error in AI-based decision making:'), error);
    // In case of errors, fall back to basic check
    return isDirectlyAddressed(db, message);
  }
}

// Check if the message is directly addressed to the bot
function isDirectlyAddressed(db, message) {
  try {
    if (!message) return false;
    
    const lowerMessage = message.toLowerCase();
    const botName = db.data.config.botName.toLowerCase();
    
    // Check for direct mentions of the bot's name
    if (lowerMessage.includes(botName)) {
      return true;
    }
    
    // Check if it's a direct question
    if (QUESTION_INDICATORS.some(indicator => lowerMessage.includes(indicator))) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking if directly addressed:', error);
    return false;
  }
}

// Check if chat has been inactive for a while (for backward compatibility)
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