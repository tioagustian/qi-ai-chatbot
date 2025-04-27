import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.join(__dirname, '../../data');
const dbFile = path.join(dbDir, 'db.json');

// Initial database structure
const defaultData = {
  config: {
    botName: process.env.BOT_NAME || 'Qi',
    botId: process.env.BOT_ID || '',
    language: process.env.LANGUAGE || 'id',
    model: process.env.DEFAULT_MODEL || 'anthropic/claude-3-opus-20240229',
    moodChangeProbability: parseFloat(process.env.MOOD_CHANGE_PROBABILITY || 0.15),
    personality: process.env.DEFAULT_PERSONALITY || 'friendly',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    // Enhanced context settings
    maxContextMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || 100),
    maxRelevantMessages: parseInt(process.env.MAX_RELEVANT_MESSAGES || 20),
    enhancedMemoryEnabled: process.env.ENHANCED_MEMORY_ENABLED !== 'false'
  },
  state: {
    currentMood: process.env.DEFAULT_MOOD || 'happy',
    lastInteraction: new Date().toISOString(),
    messageCount: 0,
    userInteractions: {}
  },
  conversations: {},
  contextMemory: [],
  participantsRegistry: {},
  imageAnalysis: {},
  topicMemory: {}
};

// Initialize database
let db;

async function setupDatabase() {
  try {
    // Make sure the data directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Create database file if it doesn't exist
    if (!fs.existsSync(dbFile)) {
      fs.writeFileSync(dbFile, JSON.stringify(defaultData, null, 2));
    }

    // Import lowdb dynamically (ESM module)
    const lowdb = await import('lowdb');
    const { Low } = lowdb;
    const { JSONFile } = await import('lowdb/node');

    // Initialize LowDB with adapter
    const adapter = new JSONFile(dbFile);
    
    // In newer versions of lowdb, we need to pass the defaultData directly
    db = new Low(adapter, defaultData);

    // Read data from JSON file
    await db.read();

    // Make sure all required fields exist
    ensureDataStructure();

    // Save any changes
    await db.write();

    return db;
  } catch (error) {
    console.error('Error setting up database:', error);
    throw error;
  }
}

function ensureDataStructure() {
  // Ensure all required fields exist in the database
  if (!db.data.config) db.data.config = defaultData.config;
  if (!db.data.state) db.data.state = defaultData.state;
  if (!db.data.conversations) db.data.conversations = {};
  if (!db.data.contextMemory) db.data.contextMemory = [];
  if (!db.data.participantsRegistry) db.data.participantsRegistry = {};
  if (!db.data.imageAnalysis) db.data.imageAnalysis = {};
  if (!db.data.topicMemory) db.data.topicMemory = {};
  
  // Ensure config fields are present
  if (db.data.config.geminiApiKey === undefined) {
    db.data.config.geminiApiKey = process.env.GEMINI_API_KEY || '';
  }
  
  // Ensure enhanced context settings are present
  if (db.data.config.maxContextMessages === undefined) {
    db.data.config.maxContextMessages = parseInt(process.env.MAX_CONTEXT_MESSAGES || 100);
  }
  
  if (db.data.config.maxRelevantMessages === undefined) {
    db.data.config.maxRelevantMessages = parseInt(process.env.MAX_RELEVANT_MESSAGES || 20);
  }
  
  if (db.data.config.enhancedMemoryEnabled === undefined) {
    db.data.config.enhancedMemoryEnabled = process.env.ENHANCED_MEMORY_ENABLED !== 'false';
  }
  
  // Ensure existing conversations have the updated structure
  Object.entries(db.data.conversations).forEach(([chatId, chat]) => {
    // Add chatType if missing
    if (!chat.chatType) {
      chat.chatType = chatId.endsWith('@g.us') ? 'group' : 'private';
    }
    
    // Add chatName if missing
    if (!chat.chatName) {
      chat.chatName = chatId.endsWith('@g.us') ? 'Group Chat' : 'Private Chat';
    }
    
    // Add introduction tracking fields for groups
    if (chatId.endsWith('@g.us')) {
      if (chat.hasIntroduced === undefined) {
        chat.hasIntroduced = false;
      }
      if (!chat.lastIntroduction) {
        chat.lastIntroduction = null;
      }
    }
    
    // Update participants structure if needed
    Object.entries(chat.participants).forEach(([participantId, participant]) => {
      if (!participant.lastActive) {
        participant.lastActive = participant.firstSeen || new Date().toISOString();
      }
      
      if (!participant.lastMessage) {
        participant.lastMessage = '';
      }
    });
  });
}

// Get the database instance
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call setupDatabase() first.');
  }
  return db;
}

export { setupDatabase, getDb };