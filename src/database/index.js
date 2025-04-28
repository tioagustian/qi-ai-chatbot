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
    togetherApiKey: process.env.TOGETHER_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    characterKnowledge: '',
    // Enhanced context settings
    maxContextMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || 100),
    maxRelevantMessages: parseInt(process.env.MAX_RELEVANT_MESSAGES || 20),
    enhancedMemoryEnabled: process.env.ENHANCED_MEMORY_ENABLED !== 'false',
    dynamicFactExtractionEnabled: process.env.DYNAMIC_FACT_EXTRACTION_ENABLED !== 'false',
    apiLoggingEnabled: process.env.API_LOGGING_ENABLED !== 'false',
    apiLogRetentionDays: parseInt(process.env.API_LOG_RETENTION_DAYS || 7)
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
  imageEmbeddings: {},
  topicMemory: {},
  userFacts: {},
  globalFacts: {
    facts: {},
    factHistory: []
  },
  apiLogs: []
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
  if (!db.data.imageEmbeddings) db.data.imageEmbeddings = {};
  
  // Ensure new memory structures exist
  if (!db.data.userFacts) db.data.userFacts = {};
  if (!db.data.globalFacts) {
    db.data.globalFacts = {
      facts: {},
      factHistory: []
    };
  }
  
  // Ensure API logs structure exists
  if (!db.data.apiLogs) {
    db.data.apiLogs = [];
  }
  
  // Manual memory structure verification
  // Verify userFacts structure
  Object.entries(db.data.userFacts || {}).forEach(([userId, userFact]) => {
    if (!userFact.facts) userFact.facts = {};
    if (!userFact.factHistory) userFact.factHistory = [];
  });
  
  // Verify imageEmbeddings structure
  if (!db.data.imageEmbeddings) {
    db.data.imageEmbeddings = {};
  }
  
  // Ensure config fields are present
  if (db.data.config.geminiApiKey === undefined) {
    db.data.config.geminiApiKey = process.env.GEMINI_API_KEY || '';
  }
  
  if (db.data.config.togetherApiKey === undefined) {
    db.data.config.togetherApiKey = process.env.TOGETHER_API_KEY || '';
  }
  
  if (db.data.config.openrouterApiKey === undefined) {
    db.data.config.openrouterApiKey = process.env.OPENROUTER_API_KEY || '';
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
  
  // Add new dynamic fact extraction setting
  if (db.data.config.dynamicFactExtractionEnabled === undefined) {
    db.data.config.dynamicFactExtractionEnabled = process.env.DYNAMIC_FACT_EXTRACTION_ENABLED !== 'false';
  }
  
  // Add API logging settings
  if (db.data.config.apiLoggingEnabled === undefined) {
    db.data.config.apiLoggingEnabled = process.env.API_LOGGING_ENABLED !== 'false';
  }
  
  if (db.data.config.apiLogRetentionDays === undefined) {
    db.data.config.apiLogRetentionDays = parseInt(process.env.API_LOG_RETENTION_DAYS || 7);
  }
  
  // Clean up old API logs based on retention policy
  if (db.data.apiLogs && db.data.apiLogs.length > 0) {
    const retentionDays = db.data.config.apiLogRetentionDays || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    db.data.apiLogs = db.data.apiLogs.filter(log => 
      new Date(log.timestamp) > cutoffDate
    );
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
    if (chat.participants) {
      Object.entries(chat.participants).forEach(([participantId, participant]) => {
        if (!participant.lastActive) {
          participant.lastActive = participant.firstSeen || new Date().toISOString();
        }
        
        if (!participant.lastMessage) {
          participant.lastMessage = '';
        }
      });
    }
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