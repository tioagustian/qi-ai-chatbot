// Default configuration settings for the bot
const defaultConfig = {
  // Basic bot settings
  botName: 'Qi',
  sessionName: 'qi-ai-session',
  
  // AI configuration
  defaultProvider: 'openrouter', // 'openrouter', 'gemini', or 'together'
  model: 'anthropic/claude-3-haiku', // Default model
  
  // Mood and personality settings
  personality: 'friendly',
  moodChangeProbability: 0.15, // 15% chance of random mood change after inactivity
  aiMoodAnalysisEnabled: true, // Enable AI-based mood analysis
  
  // Context and memory settings
  maxContextMessages: 100, // Maximum number of messages to store in context
  maxRelevantMessages: 20, // Maximum number of relevant messages to include in API requests
  maxCrossChatMessages: 8, // Maximum number of messages to include from other chats
  maxImageAnalysisMessages: 3, // Maximum number of image analysis messages to include
  maxTopicSpecificMessages: 10, // Maximum number of topic-specific messages to include
  enhancedMemoryEnabled: true, // Enable enhanced memory features
  dynamicFactExtractionEnabled: true, // Enable fact extraction from messages
  
  // Response settings
  responseDelayFactor: 1.0, // Factor to adjust response delays (higher = longer)
  minResponseDelay: 800, // Minimum delay before responding (milliseconds)
  maxResponseDelay: 2500, // Maximum delay before responding (milliseconds)
  privateResponseMultiplier: 0.8, // Response speed multiplier for private chats
  
  // Group chat settings
  groupChatResponsiveness: 0.3, // Probability of responding to non-tagged messages in group chats
  groupIntroductionEnabled: true, // Enable introduction when added to new groups
  
  // System settings
  debugMode: false, // Enable detailed debug logging
  apiLogRetentionDays: 7, // Number of days to keep API logs
};

export default defaultConfig; 