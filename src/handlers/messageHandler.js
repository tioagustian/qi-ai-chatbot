import { getDb } from '../database/index.js';
import { generateAIResponseLegacy } from '../services/aiService.js';
import { updateMoodAndPersonality } from '../services/personalityService.js';
import { detectCommand, executeCommand } from '../services/commandService.js';
import { shouldRespond, QUESTION_INDICATORS } from '../utils/decisionMaker.js';
import { extractMessageContent, isGroupMessage, isTaggedMessage } from '../utils/messageUtils.js';
import { updateContext, getRelevantContext, shouldIntroduceInGroup, generateGroupIntroduction } from '../services/contextService.js';
import chalk from 'chalk';

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
    
    // Skip empty or system messages
    if (!content || content.trim() === '') {
      logger.debug('Skipping empty message');
      return;
    }
    
    const chatType = isGroup ? 'group' : 'private';
    const senderName = message.pushName || sender.split('@')[0];
    
    logger.info(`Received message from ${senderName} in ${chatType}: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    logger.debug('Message details', { 
      sender, 
      chatId, 
      isGroup, 
      messageId: message.key.id 
    });
    
    // Check if the bot is mentioned in the message
    const isTagged = isTaggedMessage(message, db.data.config.botName);
    
    logger.debug('Tag detection result', { 
      isTagged,
      botId: process.env.BOT_ID,
      botName: db.data.config.botName,
      content: content.substring(0, 50),
      mentionPattern: `@${process.env.BOT_ID?.split('@')[0]?.split(':')[0] || 'not-set'}`
    });
    
    // Check if it's a command (starts with ! or /)
    const commandData = detectCommand(content);
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
      await updateContext(db, chatId, sender, content, message);
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
    
    // Decide whether to respond (always respond in private chats or if tagged)
    try {
      // Log tagging information to help with debugging
      logger.debug('Message response decision factors', { 
        isPrivateChat: !isGroup, 
        isTagged, 
        content: content.substring(0, 30)
      });
      
      // Improved response logic:
      // 1. Always respond in private chats
      // 2. Respond if explicitly tagged
      // 3. If the message contains the bot's number in any form, consider it a tag
      // 4. Otherwise check the custom shouldRespond logic
      const botPhoneNumber = process.env.BOT_ID?.split('@')[0]?.split(':')[0];
      const containsBotNumber = botPhoneNumber && content.includes(botPhoneNumber);
      
      const shouldBotRespond = !isGroup || 
                              isTagged || 
                              containsBotNumber ||
                              await shouldRespond(db, chatId, content);
      
      if (shouldBotRespond) {
        logger.info(`Bot will respond to message in ${chatType}${isTagged ? ' (tagged)' : ''}${containsBotNumber ? ' (number mentioned)' : ''}`);
        
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
        } catch (contextError) {
          logger.error('Error getting relevant context', contextError);
        }
        
        // Generate AI response
        logger.info('Sending typing indicator');
        try {
          await sock.sendPresenceUpdate('composing', chatId);
          
          logger.info('Generating AI response');
          const aiResponse = await generateAIResponseLegacy(content, context, db.data);
          
          logger.success(`AI response generated (${aiResponse.length} chars)`);
          logger.debug('AI response preview', { 
            preview: aiResponse 
          });
          
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