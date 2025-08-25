import { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, isJidBroadcast } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import { getDb } from './database/index.js';
import { processMessage } from './handlers/messageHandler.js';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { generateGroupIntroduction } from './services/contextService.js';
import { calculateResponseDelay } from './utils/messageUtils.js';
// Import API logging service
import { cleanupOldLogs } from './services/apiLogService.js';
// Import message batching service
import { handlePersonalChatMessage, handleGroupChatMessage, handleGroupPresenceUpdate, handleTypingUpdate } from './services/messageBatchingService.js';
import { makeWASocket } from '@whiskeysockets/baileys';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Session path
const SESSION_DIR = path.join(__dirname, '../session');
const SESSION_NAME = process.env.SESSION_NAME || 'qi-ai-session';

// Global connection object
let sock = null;
// Reconnection attempts counter
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const startBot = async () => {
  try {
    // Reset reconnect attempts on successful connect
    reconnectAttempts = 0;
    

    
    // Make sure the session directory exists
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    // Auth state
    const { state, saveCreds } = await useMultiFileAuthState(
      path.join(SESSION_DIR, SESSION_NAME)
    );

    // Fetch latest version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    // Create WhatsApp connection
    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      auth: state,
      browser: ['Qi AI ChatBot', 'Chrome', '1.0.0'],
      getMessage: async key => {
        return { conversation: 'Hello' };
      },
      // Add retries for the connection
      retryRequestDelayMs: 1000,
      connectTimeoutMs: 30000,
      // Recommended settings for better stability
      markOnlineOnConnect: true, // Mark as online when connected
      syncFullHistory: false, // Don't sync full history on connect (performance)
      fireInitQueries: true, // Fire initial queries for better connection
      shouldIgnoreJid: jid => isJidBroadcast(jid), // Ignore broadcast messages
      patchMessageBeforeSending: (msg) => {
        // Ensure messages have proper structure
        const requiresPatch = !!(
          msg.buttonsMessage 
          || msg.templateMessage
          || msg.listMessage
        );
        if (requiresPatch) {
          msg = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...msg,
              },
            },
          };
        }
        return msg;
      },
      // Better connection settings
      keepAliveIntervalMs: 30000, // Send keep-alive every 30 seconds
      maxRetries: 5, // Maximum retry attempts
      defaultQueryTimeoutMs: 60000, // 60 second timeout for queries
    });



    // Automatically save session
    sock.ev.on('creds.update', saveCreds);
    
    // Handle connection state changes for better stability
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Generate QR code in terminal
        qrcode.generate(qr, { small: true });
        console.log('Scan the QR code above to connect to WhatsApp');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`Connection closed with status code: ${statusCode}`);
        
        // Handle different disconnect scenarios
        let shouldReconnect = false;
        
        if (lastDisconnect?.error instanceof Boom) {
          switch (statusCode) {
            case DisconnectReason.loggedOut:
              console.log('Logged out, recreating session...');
              // Attempt to clear the session files
              if (fs.existsSync(path.join(SESSION_DIR, SESSION_NAME))) {
                try {
                  fs.rmSync(path.join(SESSION_DIR, SESSION_NAME), { recursive: true, force: true });
                  console.log('Session files cleared, will recreate on next connection');
                  shouldReconnect = true;
                } catch (err) {
                  console.error('Failed to clear session files:', err);
                }
              }
              break;
              
            case DisconnectReason.connectionClosed:
              console.log('Connection closed, reconnecting...');
              shouldReconnect = true;
              break;
              
            case DisconnectReason.connectionLost:
              console.log('Connection lost, reconnecting...');
              shouldReconnect = true;
              break;
              
            case DisconnectReason.connectionReplaced:
              console.log('Connection replaced, another client connected');
              shouldReconnect = false;
              break;
              
            case DisconnectReason.restartRequired:
              console.log('Restart required, reconnecting...');
              shouldReconnect = true;
              break;
              
            case DisconnectReason.timedOut:
              console.log('Connection timed out, reconnecting...');
              shouldReconnect = true;
              break;
              
            case 401:
              console.log('Unauthorized, session may be invalid or expired');
              if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                console.log(`Attempting to recreate session (attempt ${reconnectAttempts + 1} of ${MAX_RECONNECT_ATTEMPTS})`);
                // Clear session and try again
                if (fs.existsSync(path.join(SESSION_DIR, SESSION_NAME))) {
                  try {
                    fs.rmSync(path.join(SESSION_DIR, SESSION_NAME), { recursive: true, force: true });
                    console.log('Session files cleared, will recreate on next connection');
                    shouldReconnect = true;
                  } catch (err) {
                    console.error('Failed to clear session files:', err);
                  }
                }
              } else {
                console.log('Maximum reconnection attempts reached, please check your credentials');
              }
              break;
              
            default:
              console.log(`Unknown disconnect reason with code ${statusCode}, attempting to reconnect...`);
              shouldReconnect = true;
          }
        } else {
          shouldReconnect = true;
        }

        console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting:', shouldReconnect);

        if (shouldReconnect) {
          reconnectAttempts++;
          if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            const delay = reconnectAttempts * 3000; // Increase delay with each attempt
            console.log(`Attempting to reconnect in ${delay/1000} seconds...`);
            
            setTimeout(() => {
              startBot();
            }, delay);
          } else {
            console.log('Maximum reconnection attempts reached. Please restart the app manually.');
          }
        } else {
          console.log('Connection closed permanently. Please restart the app.');
        }
      }

      if (connection === 'open') {
        console.log('Connected to WhatsApp');
        // Reset reconnect counter on successful connection
        reconnectAttempts = 0;
        
        // Schedule cleanup of old API logs daily
        console.log('Setting up scheduled tasks...');
        // Run immediately to clean up existing logs
        cleanupOldLogs().then(count => {
          if (count > 0) {
            console.log(`Initial cleanup: removed ${count} old API log files`);
          }
        });
        
        // Then schedule to run daily
        setInterval(async () => {
          const count = await cleanupOldLogs();
          if (count > 0) {
            console.log(`Daily cleanup: removed ${count} old API log files`);
          }
        }, 24 * 60 * 60 * 1000); // 24 hours
        
        // Store the bot's ID in environment variable for use in other parts of the app
        try {
          // Get the bot's JID from the connection
          const botJid = sock.user.id;
          console.log(`Bot ID: ${botJid}`);
          
          // Set it to the environment variable
          process.env.BOT_ID = botJid;
          
          // Also update database if needed
          try {
            const db = getDb();
            db.data.config.botId = botJid;
            await db.write();
          } catch (dbError) {
            console.error('Error updating bot ID in database:', dbError);
          }
          
          console.log('Bot ID set successfully');
        } catch (idError) {
          console.error('Error setting bot ID:', idError);
        }
      }
    });



    // Handle incoming messages with proper routing
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const message of messages) {
          if (!message.key.fromMe && message.message) {
            // Note: status@broadcast messages are filtered out in messageHandler.js
            // TODO: Add dedicated handler for status@broadcast if status interaction is needed
            
            // Determine chat type and route accordingly
            const chatId = message.key.remoteJid;
            const isGroup = chatId.endsWith('@g.us');
            
            if (isGroup) {
              console.log(`[ROUTING] Group message detected in ${chatId}, using group handler`);
              await handleGroupChatMessage(sock, message);
            } else {
              console.log(`[ROUTING] Personal chat message detected in ${chatId}, using batching system`);
              await handlePersonalChatMessage(sock, message);
            }
          }
        }
      }
    });

    // Handle typing indicators for message batching and group presence monitoring
    sock.ev.on('presence.update', async (update) => {
      
      // Check if this is a group presence update
      if (update.id && update.id.endsWith('@g.us')) {
        // Handle group presence updates
        await handleGroupPresenceUpdate(sock, update);
      } else {
        // Handle personal chat typing updates for batching
        await handleTypingUpdate(sock, update);
      }
    });

    // Handle group participants update events (added, removed, promoted, demoted)
    sock.ev.on('group-participants.update', async (update) => {
      console.log(chalk.yellow(`[GROUP UPDATE][${new Date().toISOString()}] ${update.action} participants in ${update.id}`));
      console.log(chalk.yellow(`[GROUP UPDATE][${new Date().toISOString()}] Participants: ${JSON.stringify(update.participants)}`));
      
      // Check if the bot was added to a group
      if (update.action === 'add' && update.participants.includes(sock.user.id)) {
        let addedBy = 'unknown';
        
        // Try to determine who added the bot
        if (update.actor) {
          // Someone added the bot
          addedBy = update.actor;
          console.log(chalk.green(`[GROUP UPDATE][${new Date().toISOString()}] Bot was added to group ${update.id} by ${addedBy}`));
        } else {
          // Likely joined via invite link
          console.log(chalk.green(`[GROUP UPDATE][${new Date().toISOString()}] Bot joined group ${update.id} via invite link`));
        }
        
        try {
          // Get database
          const db = getDb();
          const groupInfo = await sock.groupMetadata(update.id);
          // Create or update group information in the database
          if (!db.data.conversations[update.id]) {
            db.data.conversations[update.id] = {
              messages: [],
              participants: {},
              lastActive: new Date().toISOString(),
              chatType: 'group',
              chatName: groupInfo.subject,
              hasIntroduced: false,
              lastIntroduction: null,
              addedBy: addedBy,
              joinedAt: new Date().toISOString()
            };
          } else {
            // Update existing entry
            db.data.conversations[update.id].chatName = groupInfo.subject;
            db.data.conversations[update.id].addedBy = addedBy;
            db.data.conversations[update.id].joinedAt = new Date().toISOString();
            db.data.conversations[update.id].hasIntroduced = false; // Reset introduction state
          }
          await db.write();
          
          // Fetch group metadata to get the proper name
          try {
            const groupMetadata = await sock.groupMetadata(update.id);
            if (groupMetadata && groupMetadata.subject) {
              db.data.conversations[update.id].chatName = groupMetadata.subject;
              await db.write();
              console.log(chalk.blue(`[GROUP UPDATE][${new Date().toISOString()}] Updated group name to: ${groupMetadata.subject}`));
            }
          } catch (metadataError) {
            console.error(chalk.red(`[GROUP UPDATE][${new Date().toISOString()}] Error fetching group metadata:`), metadataError);
          }
          
          // Wait a moment before sending introduction to ensure metadata is loaded
          setTimeout(async () => {
            try {
              // Generate and send introduction message
              const introMessage = await generateGroupIntroduction(db, update.id);
              
              // Calculate a delay for the introduction
              const introDelay = calculateResponseDelay(
                "Hello", 
                introMessage, 
                { minDelay: 800, maxDelay: 2500 }
              );
              
              // Show typing indicator
              await sock.sendPresenceUpdate('composing', update.id);
              
              // Wait a moment to make the introduction feel more natural
              console.log(chalk.yellow(`[GROUP UPDATE] Waiting ${introDelay}ms before sending introduction`));
              await new Promise(resolve => setTimeout(resolve, introDelay));
              
              // Send introduction message
              await sock.sendMessage(update.id, { text: introMessage });
              
              // Update the database to mark that we've introduced ourselves
              db.data.conversations[update.id].hasIntroduced = true;
              db.data.conversations[update.id].lastIntroduction = new Date().toISOString();
              await db.write();
              
              console.log(chalk.green(`[GROUP UPDATE][${new Date().toISOString()}] Bot introduced itself in group ${update.id}`));
            } catch (introError) {
              console.error(chalk.red(`[GROUP UPDATE][${new Date().toISOString()}] Error sending introduction:`), introError);
            }
          }, 3000); // Wait 3 seconds before sending intro
        } catch (error) {
          console.error(chalk.red(`[GROUP UPDATE][${new Date().toISOString()}] Error handling bot added to group:`), error);
        }
      }
    });

    return sock;
  } catch (error) {
    console.error("Error in startBot:", error);
    // Handle initialization errors
    reconnectAttempts++;
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      const delay = reconnectAttempts * 3000;
      console.log(`Error encountered, attempting to restart in ${delay/1000} seconds... (attempt ${reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS})`);
      
      setTimeout(() => {
        startBot();
      }, delay);
    } else {
      console.log('Maximum initialization attempts reached. Please check the error and restart manually.');
    }
    throw error;
  }
};

// Function to get current socket
const getSocket = () => {
  if (!sock) {
    throw new Error('WhatsApp connection not established');
  }
  return sock;
};

export { startBot, getSocket }; 