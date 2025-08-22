import { getDb } from '../database/index.js';
import { formatEnhancedConversationHistory, getEnhancedRelevantContext } from './contextService.js';

/**
 * Enhanced Conversation History Service
 * 
 * This service provides advanced conversation history formatting
 * that's optimized for AI understanding and processing.
 */

// Configuration for conversation history formatting
const CONVERSATION_HISTORY_CONFIG = {
  // Maximum messages to include in history
  MAX_MESSAGES: 50,
  
  // Maximum tokens for conversation history
  MAX_TOKENS: 4000,
  
  // Include metadata in history
  INCLUDE_METADATA: true,
  
  // Include conversation analysis
  INCLUDE_ANALYSIS: true,
  
  // Include participant information
  INCLUDE_PARTICIPANTS: true,
  
  // Include temporal context
  INCLUDE_TEMPORAL: true,
  
  // Include emotional context
  INCLUDE_EMOTIONAL: true,
  
  // Include topic tracking
  INCLUDE_TOPICS: true,
  
  // Include conversation flow
  INCLUDE_FLOW: true
};

/**
 * Format conversation history for AI consumption
 * @param {string} chatId - Chat ID
 * @param {Object} message - Current message
 * @param {Object} sock - WhatsApp socket
 * @returns {Object} Formatted conversation history
 */
async function formatConversationHistoryForAI(chatId, message, sock) {
  try {
    const db = getDb();
    
    // Get enhanced context
    const enhancedContext = await getEnhancedRelevantContext(db, chatId, message, sock);
    
    // Format for AI consumption
    const aiFormattedHistory = formatForAIConsumption(enhancedContext, message);
    
    return aiFormattedHistory;
  } catch (error) {
    console.error('[CONVERSATION_HISTORY] Error formatting conversation history for AI:', error);
    return {
      conversationSummary: "Error retrieving conversation history",
      messages: [],
      context: {},
      metadata: {}
    };
  }
}

/**
 * Format conversation data for AI consumption
 * @param {Object} enhancedContext - Enhanced conversation context
 * @param {Object} currentMessage - Current message being processed
 * @returns {Object} AI-formatted conversation history
 */
function formatForAIConsumption(enhancedContext, currentMessage) {
  const { summary, messages, context, analysis } = enhancedContext;
  
  // Create conversation summary for AI
  const conversationSummary = createAIConversationSummary(summary, context);
  
  // Format messages for AI
  const aiMessages = formatMessagesForAI(messages, currentMessage);
  
  // Create context metadata for AI
  const aiContext = createAIContext(context, analysis);
  
  // Create metadata for AI
  const aiMetadata = createAIMetadata(enhancedContext, currentMessage);
  
  return {
    conversationSummary,
    messages: aiMessages,
    context: aiContext,
    metadata: aiMetadata
  };
}

/**
 * Create conversation summary optimized for AI
 * @param {Object} summary - Conversation summary
 * @param {Object} context - Conversation context
 * @returns {string} AI-optimized conversation summary
 */
function createAIConversationSummary(summary, context) {
  const parts = [];
  
  // Add overview
  if (summary.overview) {
    parts.push(summary.overview);
  }
  
  // Add topics if available
  if (summary.topics && summary.topics !== 'No specific topics identified') {
    parts.push(summary.topics);
  }
  
  // Add emotional context
  if (summary.emotions && summary.emotions !== 'Neutral emotional tone') {
    parts.push(summary.emotions);
  }
  
  // Add engagement level
  if (summary.engagement) {
    parts.push(summary.engagement);
  }
  
  // Add current context
  if (context.currentPhase && context.currentPhase !== 'conversation') {
    parts.push(`Current conversation phase: ${context.currentPhase}`);
  }
  
  if (context.requiresResponse) {
    parts.push('This message requires a response');
  }
  
  return parts.join('. ') + '.';
}

/**
 * Format messages for AI consumption
 * @param {Array} messages - Enhanced messages
 * @param {Object} currentMessage - Current message
 * @returns {Array} AI-formatted messages
 */
function formatMessagesForAI(messages, currentMessage) {
  return messages.map((msg, index) => {
    const aiMessage = {
      // Core message data
      role: msg.role,
      name: msg.name,
      content: msg.content,
      timestamp: msg.timestamp,
      
      // Message position
      position: {
        index: index + 1,
        total: messages.length,
        isRecent: index >= messages.length - 3
      },
      
      // Semantic context
      semantic: {
        topics: msg.topics || [],
        emotion: msg.emotion || 'neutral',
        intent: msg.intent || 'statement',
        engagement: msg.engagement || 'medium'
      },
      
      // Conversation flow
      flow: {
        phase: msg.conversationPhase || 'conversation',
        isDirectAddress: msg.isDirectAddress || false,
        mentionsOthers: msg.mentionsOthers || [],
        referencesPrevious: msg.referencesPrevious || []
      },
      
      // Temporal context
      temporal: {
        timeOfDay: msg.timeOfDay || 'unknown',
        dayOfWeek: msg.dayOfWeek || 'unknown',
        isRecent: index >= messages.length - 5
      },
      
      // Message characteristics
      characteristics: {
        complexity: msg.complexity || 'medium',
        length: msg.messageLength || 0,
        hasImage: msg.hasImage || false,
        isReply: msg.isReply || false
      }
    };
    
    // Add relevance score if this is the current message
    if (currentMessage && msg.content === currentMessage.content) {
      aiMessage.relevance = 'current';
    }
    
    return aiMessage;
  });
}

/**
 * Create AI context metadata
 * @param {Object} context - Conversation context
 * @param {Object} analysis - Conversation analysis
 * @returns {Object} AI context
 */
function createAIContext(context, analysis) {
  return {
    // Chat information
    chat: {
      type: context.chatType,
      participantCount: context.participantCount,
      duration: context.duration
    },
    
    // Current state
    current: {
      phase: context.currentPhase,
      emotion: context.currentEmotion,
      engagement: context.currentEngagement,
      topics: context.activeTopics || [],
      emotions: context.recentEmotions || [],
      thread: context.conversationThread
    },
    
    // Response requirements
    response: {
      required: context.requiresResponse,
      type: determineResponseType(context),
      urgency: determineResponseUrgency(context),
      tone: determineResponseTone(context)
    },
    
    // Conversation patterns
    patterns: {
      topicContinuity: context.conversationThread ? true : false,
      emotionalConsistency: checkEmotionalConsistency(context.recentEmotions),
      engagementTrend: determineEngagementTrend(analysis)
    }
  };
}

/**
 * Create AI metadata
 * @param {Object} enhancedContext - Enhanced conversation context
 * @param {Object} currentMessage - Current message
 * @returns {Object} AI metadata
 */
function createAIMetadata(enhancedContext, currentMessage) {
  const { analysis } = enhancedContext;
  
  return {
    // Processing information
    processing: {
      timestamp: new Date().toISOString(),
      messageCount: analysis.totalMessages || 0,
      participantCount: Object.keys(analysis.participants || {}).length,
      topicCount: Object.keys(analysis.topics || {}).length
    },
    
    // Conversation insights
    insights: {
      dominantTopics: getTopItems(analysis.topics, 3),
      dominantEmotions: getTopItems(analysis.emotions, 3),
      participantActivity: getParticipantActivity(analysis.participants),
      conversationPhases: analysis.conversationPhases || {}
    },
    
    // Response guidance
    guidance: {
      shouldEngage: shouldEngageInConversation(enhancedContext),
      responseStyle: determineResponseStyle(enhancedContext),
      topicContinuation: shouldContinueTopic(enhancedContext),
      emotionalMirroring: shouldMirrorEmotion(enhancedContext)
    }
  };
}

/**
 * Determine response type based on context
 * @param {Object} context - Conversation context
 * @returns {string} Response type
 */
function determineResponseType(context) {
  if (context.requiresResponse) {
    if (context.currentPhase === 'question') return 'answer';
    if (context.currentPhase === 'greeting') return 'greeting';
    if (context.currentPhase === 'farewell') return 'farewell';
    if (context.currentPhase === 'gratitude') return 'acknowledgment';
    return 'conversational';
  }
  return 'none';
}

/**
 * Determine response urgency
 * @param {Object} context - Conversation context
 * @returns {string} Urgency level
 */
function determineResponseUrgency(context) {
  if (context.requiresResponse) {
    if (context.currentEngagement === 'high') return 'high';
    if (context.currentPhase === 'question') return 'medium';
    return 'normal';
  }
  return 'low';
}

/**
 * Determine response tone
 * @param {Object} context - Conversation context
 * @returns {string} Response tone
 */
function determineResponseTone(context) {
  if (context.currentEmotion === 'happy') return 'cheerful';
  if (context.currentEmotion === 'sad') return 'empathetic';
  if (context.currentEmotion === 'angry') return 'calm';
  if (context.currentEmotion === 'excited') return 'enthusiastic';
  if (context.currentEmotion === 'curious') return 'helpful';
  return 'friendly';
}

/**
 * Check emotional consistency
 * @param {Array} recentEmotions - Recent emotions
 * @returns {boolean} Emotional consistency
 */
function checkEmotionalConsistency(recentEmotions) {
  if (!recentEmotions || recentEmotions.length < 2) return true;
  
  const uniqueEmotions = [...new Set(recentEmotions)];
  return uniqueEmotions.length <= 2; // Allow for some variation
}

/**
 * Determine engagement trend
 * @param {Object} analysis - Conversation analysis
 * @returns {string} Engagement trend
 */
function determineEngagementTrend(analysis) {
  if (!analysis.conversationFlow || analysis.conversationFlow.length < 3) {
    return 'stable';
  }
  
  const recentFlow = analysis.conversationFlow.slice(-3);
  const engagementLevels = recentFlow.map(item => item.engagement);
  
  const highCount = engagementLevels.filter(level => level === 'high').length;
  const lowCount = engagementLevels.filter(level => level === 'low').length;
  
  if (highCount > lowCount) return 'increasing';
  if (lowCount > highCount) return 'decreasing';
  return 'stable';
}

/**
 * Get top items from an object
 * @param {Object} items - Items object
 * @param {number} count - Number of top items
 * @returns {Array} Top items
 */
function getTopItems(items, count) {
  if (!items) return [];
  
  return Object.entries(items)
    .sort(([,a], [,b]) => b - a)
    .slice(0, count)
    .map(([key, value]) => ({ key, value }));
}

/**
 * Get participant activity
 * @param {Object} participants - Participants object
 * @returns {Array} Participant activity
 */
function getParticipantActivity(participants) {
  if (!participants) return [];
  
  return Object.entries(participants)
    .map(([name, data]) => ({
      name,
      messageCount: data.messageCount || 0,
      emotions: data.emotions || [],
      topics: data.topics || []
    }))
    .sort((a, b) => b.messageCount - a.messageCount);
}

/**
 * Determine if should engage in conversation
 * @param {Object} enhancedContext - Enhanced context
 * @returns {boolean} Should engage
 */
function shouldEngageInConversation(enhancedContext) {
  const { context } = enhancedContext;
  
  if (context.requiresResponse) return true;
  if (context.currentEngagement === 'high') return true;
  if (context.currentPhase === 'greeting') return true;
  
  return false;
}

/**
 * Determine response style
 * @param {Object} enhancedContext - Enhanced context
 * @returns {string} Response style
 */
function determineResponseStyle(enhancedContext) {
  const { context } = enhancedContext;
  
  if (context.currentEngagement === 'high') return 'detailed';
  if (context.currentPhase === 'question') return 'informative';
  if (context.currentEmotion === 'curious') return 'explanatory';
  
  return 'conversational';
}

/**
 * Determine if should continue topic
 * @param {Object} enhancedContext - Enhanced context
 * @returns {boolean} Should continue topic
 */
function shouldContinueTopic(enhancedContext) {
  const { context } = enhancedContext;
  
  return context.conversationThread && context.activeTopics.length > 0;
}

/**
 * Determine if should mirror emotion
 * @param {Object} enhancedContext - Enhanced context
 * @returns {boolean} Should mirror emotion
 */
function shouldMirrorEmotion(enhancedContext) {
  const { context } = enhancedContext;
  
  const emotions = context.recentEmotions || [];
  if (emotions.length === 0) return false;
  
  const lastEmotion = emotions[emotions.length - 1];
  return lastEmotion !== 'neutral';
}

/**
 * Create a compact conversation history for AI
 * @param {string} chatId - Chat ID
 * @param {Object} message - Current message
 * @param {Object} sock - WhatsApp socket
 * @returns {string} Compact conversation history
 */
async function createCompactConversationHistory(chatId, message, sock) {
  try {
    const formattedHistory = await formatConversationHistoryForAI(chatId, message, sock);
    
    // Create a compact text representation
    const compactHistory = [];
    
    // Add conversation summary
    if (formattedHistory.conversationSummary) {
      compactHistory.push(`CONVERSATION SUMMARY: ${formattedHistory.conversationSummary}`);
    }
    
    // Add recent messages
    const recentMessages = formattedHistory.messages.slice(-10); // Last 10 messages
    if (recentMessages.length > 0) {
      compactHistory.push('\nRECENT MESSAGES:');
      recentMessages.forEach(msg => {
        const timestamp = new Date(msg.timestamp).toLocaleTimeString();
        const emotion = msg.semantic.emotion !== 'neutral' ? ` [${msg.semantic.emotion}]` : '';
        const intent = msg.semantic.intent !== 'statement' ? ` (${msg.semantic.intent})` : '';
        
        compactHistory.push(`${timestamp} ${msg.name}: ${msg.content}${emotion}${intent}`);
      });
    }
    
    // Add current context
    if (formattedHistory.context.current) {
      const current = formattedHistory.context.current;
      compactHistory.push(`\nCURRENT CONTEXT:`);
      compactHistory.push(`- Phase: ${current.phase}`);
      compactHistory.push(`- Emotion: ${current.emotion}`);
      compactHistory.push(`- Engagement: ${current.engagement}`);
      if (current.topics.length > 0) {
        compactHistory.push(`- Active topics: ${current.topics.join(', ')}`);
      }
      if (current.thread) {
        compactHistory.push(`- Conversation thread: ${current.thread}`);
      }
    }
    
    // Add response guidance
    if (formattedHistory.context.response) {
      const response = formattedHistory.context.response;
      if (response.required) {
        compactHistory.push(`\nRESPONSE GUIDANCE:`);
        compactHistory.push(`- Type: ${response.type}`);
        compactHistory.push(`- Tone: ${response.tone}`);
        compactHistory.push(`- Urgency: ${response.urgency}`);
      }
    }
    
    return compactHistory.join('\n');
  } catch (error) {
    console.error('[CONVERSATION_HISTORY] Error creating compact history:', error);
    return 'Error retrieving conversation history';
  }
}

export {
  formatConversationHistoryForAI,
  createCompactConversationHistory,
  CONVERSATION_HISTORY_CONFIG
};
