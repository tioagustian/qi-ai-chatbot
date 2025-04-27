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
    
    // Process image if present
    let imageAnalysis = null;
    let imageAnalysisId = null;
    
    if (containsImage) {
      try {
        logger.info('Message contains image, processing...');
        
        // Ensure temp directory exists
        try {
          await fs.mkdir(TEMP_DIR, { recursive: true });
        } catch (mkdirError) {
          logger.error('Error creating temp directory', mkdirError);
        }
        
        // Download image
        const buffer = await sock.downloadMediaMessage(message);
        const tempFilePath = path.join(TEMP_DIR, `image_${Date.now()}.jpg`);
        await fs.writeFile(tempFilePath, buffer);
        
        logger.info(`Image saved to ${tempFilePath}`);
        
        // Set prompt based on caption or default
        const analysisPrompt = imageData.caption ? 
          `Analisis gambar ini. Caption gambar: "${imageData.caption}"` : 
          'Analisis gambar ini secara detail. Jelaskan apa yang kamu lihat, termasuk objek, orang, aksi, tempat, teks, dan detail lainnya yang penting.';
        
        // Send typing indicator while processing image
        await sock.sendPresenceUpdate('composing', chatId);
        
        // Analyze image with Together.AI model
        imageAnalysis = await analyzeImage(tempFilePath, analysisPrompt);
        
        // Store analysis in database
        imageAnalysisId = await storeImageAnalysis(db, chatId, sender, imageData, imageAnalysis);
        
        logger.success(`Image analyzed and stored with ID: ${imageAnalysisId}`);
        
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
        const response = await executeCommand(sock, message, commandData, db);
        if (response) {
          logger.success(`Command ${commandData.command} executed successfully, sending response`);
          await sock.sendMessage(chatId, { text: response }, { quoted: message });
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
    
    // For groups, check if the bot should introduce itself
    // Only do this once per group or after extended inactivity
    if (isGroup) {
      try {
        const shouldIntroduce = await shouldIntroduceInGroup(db, chatId);
        if (shouldIntroduce) {
          logger.info('Bot should introduce itself in this group');
          const introMessage = await generateGroupIntroduction(db, chatId);
          
          try {
            // Send introduction and mark that we've introduced ourselves
            await sock.sendMessage(chatId, { text: introMessage });
            
            // Update the database to remember we've introduced ourselves
            // This prevents multiple introduction attempts
            if (!db.data.conversations[chatId].hasIntroduced) {
              db.data.conversations[chatId].hasIntroduced = true;
              db.data.conversations[chatId].lastIntroduction = new Date().toISOString();
              await db.write();
            }
            
            logger.success('Introduction message sent successfully');
          } catch (sendError) {
            logger.error('Error sending introduction message', sendError);
          }
        }
      } catch (introduceError) {
        logger.error('Error checking if bot should introduce itself', introduceError);
      }
    }
    
    // Decide whether to respond (always respond in private chats, if tagged, or if image is present)
    try {
      // Log tagging information to help with debugging
      logger.debug('Message response decision factors', { 
        isPrivateChat: !isGroup, 
        isTagged,
        containsImage,
        content: content?.substring(0, 30)
      });
      
      // Improved response logic:
      // 1. Always respond in private chats
      // 2. Respond if explicitly tagged
      // 3. If the message contains the bot's number in any form, consider it a tag
      // 4. Always respond to images
      // 5. Otherwise use the AI to decide if it should respond
      const botPhoneNumber = process.env.BOT_ID?.split('@')[0]?.split(':')[0];
      const containsBotNumber = botPhoneNumber && content && content.includes(botPhoneNumber);
      
      // Direct addressing conditions (always respond)
      const isDirectlyAddressed = !isGroup || isTagged || containsBotNumber || containsImage;
      
      let shouldBotRespond = isDirectlyAddressed;
      
      // If not directly addressed, use AI to decide
      if (!isDirectlyAddressed) {
        logger.info('Using AI to decide whether to respond to message...');
        shouldBotRespond = await shouldRespond(db, chatId, content);
      }
      
      if (shouldBotRespond) {
        if (isDirectlyAddressed) {
          logger.info(`Bot will respond to message in ${chatType}${isTagged ? ' (tagged)' : ''}${containsBotNumber ? ' (number mentioned)' : ''}${containsImage ? ' (contains image)' : ''}`);
        } else {
          logger.info(`Bot will respond to message in ${chatType} (AI decision)`);
        }
        
        // Update bot's mood and personality
        try {
          await updateMoodAndPersonality(db, content);
        } catch (moodError) {
          logger.error('Error updating mood and personality', moodError);
        }
        
        // Get relevant context
        let context = [];
        try {
          logger.debug('Retrieving context for response');
          context = await getRelevantContext(db, chatId, content);
          logger.debug(`Retrieved ${context.length} context messages`);
          
          // If we have image analysis, add it to the context
          if (imageAnalysis) {
            // Add image analysis as a system message in the context
            context.unshift({
              role: 'system',
              content: `The user has shared an image. Here is my analysis of it: ${imageAnalysis}`,
              name: 'system'
            });
          }
        } catch (contextError) {
          logger.error('Error getting relevant context', contextError);
        }
        
        // Generate AI response
        logger.info('Sending typing indicator');
        try {
          await sock.sendPresenceUpdate('composing', chatId);
          
          logger.info('Generating AI response');
          // Enhanced message content for AI to include image context
          const enhancedContent = containsImage ? 
            (content ? `${content} [Image: ${imageAnalysis.substring(0, 200)}...]` : `[Image: ${imageAnalysis.substring(0, 200)}...]`) : 
            content;
          
          const aiResponse = await generateAIResponseLegacy(enhancedContent, context, db.data);
          
          logger.success(`AI response generated (${aiResponse.length} chars)`);
          logger.debug('AI response preview', { 
            preview: aiResponse 
          });
          
          // Calculate a human-like response delay
          const delayOptions = {
            privateChat: !isGroup,
            minDelay: isGroup ? 1200 : 800,  // Longer minimum delay in groups
            maxDelay: isGroup ? 5000 : 3500, // Longer maximum delay in groups
            readingSpeed: 35, // Characters per second for reading
            typingSpeed: 12, // Characters per second for typing
            thinkingTime: isGroup ? 1.8 : 1.2, // More thinking time in groups
            wordCount: true // Use word count for more natural timing
          };
          
          // Reduce delay if the message contained an image (since we already spent time analyzing it)
          if (containsImage) {
            delayOptions.minDelay = Math.max(500, delayOptions.minDelay / 2);
            delayOptions.maxDelay = Math.max(1500, delayOptions.maxDelay / 2);
          }
          
          // Get delay time in milliseconds
          const delayTime = calculateResponseDelay(content || '', aiResponse, delayOptions);
          logger.info(`Waiting ${delayTime}ms before responding (simulating reading time)`);
          
          // Turn on typing indicator again after part of the delay has passed
          setTimeout(async () => {
            try {
              // Show typing indicator during the last part of the delay
              await sock.sendPresenceUpdate('composing', chatId);
            } catch (err) {
              logger.error('Error showing typing indicator during delay', err);
            }
          }, Math.floor(delayTime * 0.6)); // Show typing indicator for the last 40% of the delay
          
          // Wait for the calculated delay time
          await new Promise(resolve => setTimeout(resolve, delayTime));
          
          // Determine if we should use quoted reply format
          // Only use quoted reply in these cases:
          // 1. It's a direct reply to a specific question
          // 2. It's a tagged message 
          // 3. It's a direct command
          // 4. It's the only message in the chat in the last minute
          let shouldQuote = false;
          
          if (isTagged) {
            // Always quote if explicitly tagged
            shouldQuote = true;
            logger.debug('Using quote format: Message was tagged');
          } else if (QUESTION_INDICATORS.some(q => content.toLowerCase().includes(q))) {
            // Quote if it's a question
            shouldQuote = true;
            logger.debug('Using quote format: Message contains question indicator');
          } else if (db.data.conversations[chatId] && db.data.conversations[chatId].messages) {
            // Check if this is the only active message in the last minute
            const recentMessages = db.data.conversations[chatId].messages
              .filter(msg => {
                const msgTime = new Date(msg.timestamp);
                const now = new Date();
                const diffSeconds = (now - msgTime) / 1000;
                return diffSeconds < 60; // Within last minute
              });
            
            if (recentMessages.length <= 1) {
              shouldQuote = false;
              logger.debug('Using quote format: Only message in last minute');
            }
          }
          
          // Send the response with or without quoting
          if (shouldQuote) {
            await sock.sendMessage(chatId, { text: aiResponse }, { quoted: message });
            logger.debug('Sent response with quote format');
          } else {
            await sock.sendMessage(chatId, { text: aiResponse });
            logger.debug('Sent response without quote format');
          }
          
          await sock.sendPresenceUpdate('paused', chatId);
          logger.success('Response sent successfully');
          
          // Add the bot's response to the conversation history 
          try {
            await updateContext(
              db, 
              chatId, 
              process.env.BOT_ID, 
              aiResponse, 
              { 
                key: { 
                  id: Date.now().toString(), 
                  remoteJid: chatId,
                  fromMe: true 
                },
                message: { conversation: aiResponse },
                pushName: db.data.config.botName
              }
            );
            logger.debug('Added bot response to conversation history');
          } catch (contextError) {
            logger.error('Error adding bot response to context', contextError);
          }
          
          // Update message count
          db.data.state.messageCount++;
          db.data.state.lastInteraction = new Date().toISOString();
          
          // Track user interaction
          if (!db.data.state.userInteractions[sender]) {
            db.data.state.userInteractions[sender] = {
              messageCount: 0,
              lastInteraction: null
            };
          }
          
          db.data.state.userInteractions[sender].messageCount++;
          db.data.state.userInteractions[sender].lastInteraction = new Date().toISOString();
          
          // Save changes to db
          await db.write();
        } catch (responseError) {
          logger.error('Error during response generation or sending', responseError);
          
          // Try to send error message to user
          try {
            await sock.sendPresenceUpdate('paused', chatId);
            await sock.sendMessage(chatId, { 
              text: `Maaf, terjadi kesalahan saat memproses pesan. Detail error: ${responseError.message}` 
            }, { quoted: message });
          } catch (secondaryError) {
            logger.error('Failed to send error message to user', secondaryError);
          }
        }
      } else {
        logger.info('Bot decided not to respond to this message');
      }
    } catch (decisionError) {
      logger.error('Error in response decision process', decisionError);
    }
  } catch (error) {
    logger.error('Unhandled error in message processing', error);
  }
}

export { processMessage }; 