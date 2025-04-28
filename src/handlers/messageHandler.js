import { getDb } from '../database/index.js';
import { generateAIResponseLegacy, analyzeImage, storeImageAnalysis } from '../services/aiService.js';
import { updateMoodAndPersonality } from '../services/personalityService.js';
import { detectCommand, executeCommand } from '../services/commandService.js';
import { shouldRespond, QUESTION_INDICATORS } from '../utils/decisionMaker.js';
import { extractMessageContent, isGroupMessage, isTaggedMessage, calculateResponseDelay, hasImage, extractImageData } from '../utils/messageUtils.js';
import { updateContext, getRelevantContext, shouldIntroduceInGroup, generateGroupIntroduction } from '../services/contextService.js';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { extractAndProcessFacts, formatRelevantFacts, getRelevantFactsForMessage } from '../services/memoryService.js';

// Get current directory for temporary file storage
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../../temp');

// Console logging helper
const logger = {
  info: (message) => console.log(chalk.blue(`[MSG][${new Date().toISOString()}] ${message}`)),
  success: (message) => console.log(chalk.green(`[MSG][${new Date().toISOString()}] ${message}`)),
  warning: (message) => console.log(chalk.yellow(`[MSG][${new Date().toISOString()}] ${message}`)),
  error: (message, error) => {
    console.log(chalk.red(`[MSG-ERROR][${new Date().toISOString()}] ${message}`));
    if (error) {
      console.log(chalk.red('Error details:'), error);
      console.log(chalk.red('Stack trace:'), error.stack);
    }
  },
  debug: (message, data) => {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.magenta(`[MSG-DEBUG][${new Date().toISOString()}] ${message}`));
      if (data) console.log(chalk.magenta('Debug data:'), data);
    }
  }
};

// Process incoming messages
async function processMessage(sock, message) {
  try {
    const db = getDb();
    
    // Extract message data
    const content = extractMessageContent(message);
    const sender = message.key.participant || message.key.remoteJid;
    const isGroup = isGroupMessage(message);
    const chatId = message.key.remoteJid;
    
    // Check if the message contains an image
    const imageData = extractImageData(message);
    // Add additional metadata to imageData if it exists
    if (imageData) {
      imageData.messageId = message.key.id;
      imageData.senderName = message.pushName || sender.split('@')[0];
    }
    const containsImage = !!imageData;
    
    // Skip empty messages that don't have images
    if ((!content || content.trim() === '') && !containsImage) {
      logger.debug('Skipping empty message without image');
      return;
    }
    
    const chatType = isGroup ? 'group' : 'private';
    const senderName = message.pushName || sender.split('@')[0];
    
    logger.info(`Received message from ${senderName} in ${chatType}: "${content?.substring(0, 50)}${content?.length > 50 ? '...' : ''}"${containsImage ? ' (contains image)' : ''}`);
    logger.debug('Message details', { 
      sender, 
      chatId, 
      isGroup, 
      messageId: message.key.id,
      containsImage
    });
    
    // Add a small natural delay before marking as read (simulating human reading time)
    const messageLength = content?.length || 0;
    const readingDelay = Math.min(Math.max(300, messageLength * 10), 1500); // 300ms to 1500ms based on length
    
    logger.debug(`Waiting ${readingDelay}ms before marking as read (simulating reading)`);
    await new Promise(resolve => setTimeout(resolve, readingDelay));
    
    // Mark message as read before processing
    try {
      await sock.readMessages([message.key]);
      logger.debug('Message marked as read');
    } catch (readError) {
      logger.error('Error marking message as read', readError);
    }
    
    // Process image if present - always analyze and store, but don't automatically respond
    let imageAnalysis = null;
    let imageAnalysisId = null;
    
    if (containsImage) {
      try {
        logger.info('Message contains image, processing silently...');
        
        // Ensure temp directory exists
        try {
          await fs.mkdir(TEMP_DIR, { recursive: true });
        } catch (mkdirError) {
          logger.error('Error creating temp directory', mkdirError);
        }
        
        // Download image
        const buffer = await downloadMediaMessage(message, 'buffer');
        const tempFilePath = path.join(TEMP_DIR, `image_${Date.now()}.jpg`);
        await fs.writeFile(tempFilePath, buffer);
        
        logger.info(`Image saved to ${tempFilePath}`);
        
        // Set prompt based on caption or default
        const analysisPrompt = imageData.caption ? 
          `Analisis gambar ini. Ekstrak semua informasi yang terdapat pada gambar. Caption gambar: "${imageData.caption}"` : 
          'Analisis gambar ini secara detail. Jelaskan apa yang kamu lihat, termasuk objek, orang, aksi, tempat, teks, dan detail lainnya yang penting. Ekstrak semua informasi yang terdapat pada gambar.';
        
        // Only show typing indicator if we're going to respond (in private chat or explicit request)
        const isExplicitImageAnalysisRequest = imageData.caption && [
          'analisis', 'analyze', 'jelaskan', 'explain', 'apa ini', 'what is this', 'tolong lihat', 'cek'
        ].some(keyword => imageData.caption.toLowerCase().includes(keyword));
        
        const shouldShowTypingForImage = !isGroup || isExplicitImageAnalysisRequest;
        
        if (shouldShowTypingForImage) {
          await sock.sendPresenceUpdate('composing', chatId);
        }
        
        // Analyze image with Together.AI model with embedding extraction enabled
        imageAnalysis = await analyzeImage(tempFilePath, analysisPrompt, {
          extractEmbeddings: true, // Enable embedding extraction
          enhancedPrompt: true // Use enhanced prompt for better detail extraction
        });
        
        // Store analysis in database - this will be silent unless explicitly requested
        imageAnalysisId = await storeImageAnalysis(db, chatId, sender, imageData, imageAnalysis);
        
        logger.success(`Image analyzed and stored with ID: ${imageAnalysisId} (silent mode)`);
        
        // Add image information to facts
        if (db.data.config.dynamicFactExtractionEnabled && imageAnalysis.detectedFaces) {
          try {
            const { addImageRecognitionFacts } = await import('../services/memoryService.js');
            await addImageRecognitionFacts(sender, {
              faces: imageAnalysis.faceEmbeddings || [],
              imageType: imageAnalysis.imageType,
              description: imageAnalysis.analysis.substring(0, 100)
            });
            logger.info('Added image recognition facts for user');
          } catch (factError) {
            logger.error('Error adding image recognition facts', factError);
          }
        }
        
        // Clean up temporary file
        try {
          await fs.unlink(tempFilePath);
        } catch (unlinkError) {
          logger.error('Error deleting temp image file', unlinkError);
        }
      } catch (imageError) {
        logger.error('Error processing image', imageError);
      }
    }
    
    // Check if the bot is mentioned in the message
    const isTagged = isTaggedMessage(message, db.data.config.botName);
    
    logger.debug('Tag detection result', { 
      isTagged,
      botId: process.env.BOT_ID,
      botName: db.data.config.botName,
      content: content?.substring(0, 50),
      mentionPattern: `@${process.env.BOT_ID?.split('@')[0]?.split(':')[0] || 'not-set'}`
    });
    
    // Check if it's a command (starts with ! or /)
    const commandData = content ? detectCommand(content) : null;
    if (commandData) {
      logger.info(`Command detected: ${commandData.command} with ${commandData.args.length} argument(s)`);
      try {
        // Add natural thinking delay before processing command
        const commandThinkingDelay = Math.floor(Math.random() * 300) + 300; // 300-600ms
        await new Promise(resolve => setTimeout(resolve, commandThinkingDelay));
        
        // Show typing indicator for command processing
        await sock.sendPresenceUpdate('composing', chatId);
        
        const response = await executeCommand(sock, message, commandData, db);
        if (response) {
          logger.success(`Command ${commandData.command} executed successfully, sending response`);
          
          // Calculate dynamic response delay for command response
          const commandResponseDelay = calculateResponseDelay(
            content, 
            response, 
            { minDelay: 500, maxDelay: 2000, privateChat: !isGroup }
          );
          
          // Wait a moment before sending command response
          logger.info(`Waiting ${commandResponseDelay}ms before sending command response`);
          await new Promise(resolve => setTimeout(resolve, commandResponseDelay));
          
          await sock.sendMessage(chatId, { text: response }, { quoted: message });
          
          // Pause typing after sending response
          await sock.sendPresenceUpdate('paused', chatId);
        } else {
          logger.warning(`Command ${commandData.command} executed but returned no response`);
        }
      } catch (commandError) {
        logger.error(`Error executing command ${commandData.command}`, commandError);
      }
      return;
    }
    
    // Update conversation context
    try {
      logger.debug('Updating conversation context');
      await updateContext(db, chatId, sender, content || (containsImage ? `[Image with analysis: ${imageAnalysisId}]` : "[Empty message]"), message);
    } catch (contextError) {
      logger.error('Error updating context', contextError);
    }
    
    // NEW: Extract and process facts after message is stored
    let relevantFacts = [];
    try {
      // Only run fact extraction if enabled in config and this is an actual text message
      if (db.data.config.dynamicFactExtractionEnabled && content && content.trim().length > 0) {
        logger.info('Extracting facts from message');
        
        // Get the actual user ID correctly - important for groups
        const actualUserId = sender;
        const userName = senderName || sender.split('@')[0];
        
        logger.debug(`Extracting facts for user: ${userName} (${actualUserId})`);
        
        // Extract facts using Gemini
        const factExtractionResult = await extractAndProcessFacts(actualUserId, chatId, content);
        
        if (factExtractionResult.success) {
          // Use the new function to get relevant facts from all participants
          relevantFacts = getRelevantFactsForMessage(actualUserId, chatId, factExtractionResult.relevantFacts);
          
          logger.success(`Extracted ${Object.keys(factExtractionResult.relevantFacts).length} relevant facts for ${userName}`);
          logger.debug('Relevant facts', { 
            userId: actualUserId,
            userName,
            chatType: isGroup ? 'group' : 'private',
            facts: relevantFacts,
            totalParticipantFacts: factExtractionResult.otherParticipantsFacts ? 
              Object.keys(factExtractionResult.otherParticipantsFacts).length : 0
          });
          
          // Log new and updated facts
          if (factExtractionResult.newFacts && factExtractionResult.newFacts.length > 0) {
            logger.info(`Added ${factExtractionResult.newFacts.length} new facts for ${userName}`);
          }
          
          if (factExtractionResult.updatedFacts && factExtractionResult.updatedFacts.length > 0) {
            logger.info(`Updated ${factExtractionResult.updatedFacts.length} facts for ${userName}`);
          }
        } else {
          logger.warning(`Fact extraction failed for ${userName}: ${factExtractionResult.error}`);
        }
      }
    } catch (factError) {
      logger.error('Error extracting facts from message', factError);
    }
    
    // Check if we need to respond to the message
    const shouldRespond = shouldRespondToMessage(message, content, isTagged, isGroup, db.data.config.botName);
    
    // Check if this is a query about a previous image
      let isPreviousImageQuery = false;
      
      if (content && !containsImage) {
        const lowerContent = content.toLowerCase();
        
        // Check for temporal references combined with demonstrative pronouns
        const hasTemporalReference = [
          'tadi', 'sebelumnya', 'sebelum ini', 'yang tadi', 'yang sebelumnya', 'yang barusan',
          'earlier', 'before', 'previous', 'just now', 'just sent'
        ].some(ref => lowerContent.includes(ref));
        
        const hasDemonstrativeReference = [
          'ini', 'itu', 'tersebut', 'this', 'that', 'those', 'these'
        ].some(ref => lowerContent.includes(ref));
        
        // Check for image-related terms
        const hasImageTerms = [
          'gambar', 'foto', 'image', 'picture', 'photo', 'lihat', 'cek', 'check', 'analisis', 'analyze',
          'jelaskan', 'explain', 'apa ini', 'what is this', 'tolong lihat'
        ].some(term => lowerContent.includes(term));
        
        // If the message has temporal references and demonstrative pronouns, or explicitly mentions images
        // it's likely referring to a previously shared image
        isPreviousImageQuery = (hasTemporalReference && hasDemonstrativeReference) || hasImageTerms;
        
        // Additional check: if it's a question and has demonstrative pronouns, it might be about a previous image
        const isQuestion = content.endsWith('?') || 
          ['apa', 'siapa', 'kapan', 'dimana', 'gimana', 'bagaimana', 'kenapa', 'mengapa', 'tolong'].some(q => lowerContent.includes(q));
          
        if (isQuestion && hasDemonstrativeReference) {
          isPreviousImageQuery = true;
        }
        
        logger.debug('Image query detection', { 
          isPreviousImageQuery, 
          hasTemporalReference, 
          hasDemonstrativeReference,
          hasImageTerms,
          isQuestion
        });
      }
      
      // Check if the current image has a caption that explicitly asks for analysis
      const imageAnalysisKeywords = ['analisis', 'analyze', 'jelaskan', 'explain', 'apa ini', 'what is this', 'tolong lihat', 'cek'];
    const isExplicitImageAnalysisRequest = containsImage && 
      imageData.caption && 
      imageAnalysisKeywords.some(keyword => imageData.caption.toLowerCase().includes(keyword));
      
    // If we have an explicit image analysis request, we should respond with the analysis
    if (isExplicitImageAnalysisRequest) {
      shouldRespond = true;
    }
    
    logger.debug('Response determination', { 
      shouldRespond, 
      isTagged, 
      isPreviousImageQuery,
      isExplicitImageAnalysisRequest,
      isGroup,
      userMessage: content?.substring(0, 50)
    });
      
    // If we should respond, generate and send a response
    if (shouldRespond) {
      try {
        // Add a small thinking delay before showing typing indicator
        const thinkingDelay = Math.floor(Math.random() * 800) + 500; // Random delay between 500-1300ms
        logger.debug(`Waiting ${thinkingDelay}ms before showing typing indicator (simulating thinking)`);
        await new Promise(resolve => setTimeout(resolve, thinkingDelay));
        
        // Show typing indicator
        await sock.sendPresenceUpdate('composing', chatId);
        
        // Get relevant context
        let contextMessages = await getRelevantContext(db, chatId, content || "[Image without text]");
        
        // Add the image analysis to the context if this is an image-related query
        if (isPreviousImageQuery || (containsImage && isExplicitImageAnalysisRequest)) {
          logger.info('Adding image context to message');
          
          // If we've just analyzed an image, make sure to include the analysis
          if (containsImage && imageAnalysisId) {
            const imageAnalysisObj = db.data.imageAnalysis[imageAnalysisId];
            if (imageAnalysisObj) {
              contextMessages.push({
              role: 'system',
                content: `User baru saja mengirim gambar. Berikut analisis gambar: ${imageAnalysisObj.analysis}`,
                name: 'image_context'
            });
          }
          }
        }
        
        // NEW: Add relevant facts to context if available
        if (relevantFacts.length > 0) {
          logger.info(`Adding ${relevantFacts.length} relevant facts to context`);
          
          const factsString = relevantFacts.join(', ');
          contextMessages.push({
            role: 'system',
            content: `IMPORTANT FACTS ABOUT THE USER: ${factsString}`,
            name: 'user_facts'
          });
        }
        
        // Generate AI response
          logger.info('Generating AI response');
        
        // Create a function to keep the typing indicator active during API calls
        let stopTypingInterval = false;
        const keepTypingActive = async () => {
          while (!stopTypingInterval) {
            await sock.sendPresenceUpdate('composing', chatId);
            await new Promise(resolve => setTimeout(resolve, 3000)); // Refresh typing indicator every 3 seconds
            
            // Occasionally pause typing to make it more natural
            if (Math.random() > 0.7) {
              await sock.sendPresenceUpdate('paused', chatId);
              await new Promise(resolve => setTimeout(resolve, 1500)); // Pause for 1.5 seconds
              await sock.sendPresenceUpdate('composing', chatId);
            }
          }
        };
        
        // Start keeping typing indicator active
        const typingPromise = keepTypingActive();
        
        // Generate response
        const aiResponse = await generateAIResponseLegacy(content || (containsImage ? `[User sent an image: ${imageData.caption || 'no caption'}]` : "[Empty message]"), contextMessages, db.data);
        
        // Stop typing indicator interval
        stopTypingInterval = true;
        
        // Debug the AI response
        logger.debug('AI response generated', { 
          responseLength: aiResponse.length,
          responsePreview: aiResponse.substring(0, 50) + (aiResponse.length > 50 ? '...' : '')
        });

        // Calculate dynamic response delay based on message length and complexity
        const isPrivateChat = !isGroup;
        const responseDelay = calculateResponseDelay(
          content || (containsImage ? `[Image: ${imageData.caption || 'no caption'}]` : "[Empty message]"), 
          aiResponse, 
          { privateChat: isPrivateChat }
        );
        
        // For longer responses, simulate natural typing with pauses
        if (aiResponse.length > 100) {
          // Calculate realistic typing duration based on response length
          const typingDuration = Math.min(
            500 + (aiResponse.length / 10), // Base typing time (10 chars per second)
            8000 // Cap at 8 seconds max
          );
          
          logger.info(`Simulating natural typing for ${Math.round(typingDuration)}ms before sending`);
          
          // Show active typing
              await sock.sendPresenceUpdate('composing', chatId);
          
          // For very long responses, pause typing briefly in the middle to seem more natural
          if (aiResponse.length > 250) {
            const halfwayPoint = Math.floor(typingDuration * 0.4); // Pause after 40% of typing time
            
            // Type for a while
            await new Promise(resolve => setTimeout(resolve, halfwayPoint));
          
            // Brief pause in typing (thinking about what to say next)
            await sock.sendPresenceUpdate('paused', chatId);
            await new Promise(resolve => setTimeout(resolve, Math.random() * 800 + 700)); // 700-1500ms pause
            
            // Resume typing to finish the message
            await sock.sendPresenceUpdate('composing', chatId);
            await new Promise(resolve => setTimeout(resolve, typingDuration - halfwayPoint));
          } else {
            // For medium-length messages, just type continuously
            await new Promise(resolve => setTimeout(resolve, typingDuration));
          }
        } else {
          // Continue showing typing indicator during the delay for short messages
          logger.info(`Waiting ${responseDelay}ms before sending response`);
          await new Promise(resolve => setTimeout(resolve, responseDelay));
        }
        
        // Send the response
        await sock.sendMessage(chatId, { text: aiResponse }, { quoted: message });
        
        // If this was a response to an image, mark the image analysis as shown
        if ((containsImage && isExplicitImageAnalysisRequest) || isPreviousImageQuery) {
          try {
            const analysisId = imageAnalysisId || getLastImageAnalysisId(db, chatId);
            if (analysisId && db.data.imageAnalysis[analysisId]) {
              db.data.imageAnalysis[analysisId].hasBeenShown = true;
              db.data.imageAnalysis[analysisId].lastAccessTime = new Date().toISOString();
              await db.write();
            }
          } catch (markError) {
            logger.error('Error marking image analysis as shown', markError);
          }
        }
        
        // Update context with AI's response
          try {
          await updateContext(db, chatId, process.env.BOT_ID, aiResponse, {
                key: { 
              id: `ai_${Date.now()}`,
              remoteJid: chatId
                },
                pushName: db.data.config.botName
          });
        } catch (updateError) {
          logger.error('Error updating context with AI response', updateError);
          }
        } catch (responseError) {
        logger.error('Error generating or sending response', responseError);
        try {
          // Calculate a short delay for error messages
          const errorMessageDelay = calculateResponseDelay("", 
            `Maaf, terjadi kesalahan saat memproses pesan: ${responseError.message}. Coba lagi nanti ya~`, 
            { minDelay: 500, maxDelay: 1500, privateChat: !isGroup }
          );

          // Wait a moment before sending error message
          logger.info(`Waiting ${errorMessageDelay}ms before sending error message`);
          await new Promise(resolve => setTimeout(resolve, errorMessageDelay));
          
            await sock.sendMessage(chatId, { 
            text: `Maaf, terjadi kesalahan saat memproses pesan: ${responseError.message}. Coba lagi nanti ya~` 
            }, { quoted: message });
        } catch (sendError) {
          logger.error('Error sending error message', sendError);
        }
      }
    } else {
      logger.info('Not responding to this message based on response criteria');
    }
  } catch (error) {
    logger.error('Error processing message', error);
  }
}

/**
 * Get the ID of the most recent image analysis in a chat
 * @param {Object} db - Database object
 * @param {string} chatId - Chat ID
 * @returns {string|null} - Image analysis ID or null if not found
 */
function getLastImageAnalysisId(db, chatId) {
  try {
    // Check if we have conversation data for this chat
    if (!db.data.conversations[chatId] || !db.data.conversations[chatId].messages) {
      return null;
    }
    
    // Find the most recent image analysis message
    const imageMessages = db.data.conversations[chatId].messages
      .filter(msg => 
        (msg.role === 'assistant' && 
         msg.content && 
         typeof msg.content === 'string' && 
         msg.content.startsWith('[IMAGE ANALYSIS:')) ||
        (msg.metadata && msg.metadata.hasImage) ||
        (msg.imageAnalysisId)
      )
      .reverse(); // Most recent first
    
    if (imageMessages.length === 0) {
      return null;
    }
    
    // Get the analysis ID
    const latestImageMessage = imageMessages[0];
    return latestImageMessage.imageAnalysisId || 
           latestImageMessage.metadata?.fullAnalysisId;
  } catch (error) {
    logger.error('Error getting last image analysis ID', error);
    return null;
  }
}

/**
 * Determine if the bot should respond to a message
 * @param {Object} message - Message object
 * @param {string} content - Message content
 * @param {boolean} isTagged - Whether the bot is tagged in the message
 * @param {boolean} isGroup - Whether the message is in a group
 * @param {string} botName - Bot name
 * @returns {boolean} - Whether the bot should respond
 */
function shouldRespondToMessage(message, content, isTagged, isGroup, botName) {
  // Always respond in private chats
  if (!isGroup) {
    return true;
  }
  
  // In groups, always respond if tagged
  if (isTagged) {
    return true;
  }
  
  // Check if message contains bot name
  if (content && botName && content.toLowerCase().includes(botName.toLowerCase())) {
    return true;
  }
  
  // Check if message contains common triggers
  const commonTriggers = [
    'siapa', 'who', 'gimana', 'bagaimana', 'how', 'kenapa', 'mengapa', 'why',
    'apa', 'what', 'kapan', 'when', 'dimana', 'where', 'tolong', 'help',
    'bisa', 'can', 'minta', 'request', 'coba', 'try'
  ];
  
  if (content && commonTriggers.some(trigger => {
    // Look for whole word matches, not just substrings
    const regex = new RegExp(`\\b${trigger}\\b`, 'i');
    return regex.test(content);
  })) {
    return true;
  }
  
  // For groups, default to false unless explicitly addressed
  return false;
}

export { processMessage, shouldRespondToMessage, getLastImageAnalysisId };