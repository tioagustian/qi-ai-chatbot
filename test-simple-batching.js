import { handlePersonalChatMessage, getBatchStatus, BATCH_CONFIG } from './src/services/messageBatchingService.js';

// Mock socket for testing
const mockSocket = {
  sendPresenceUpdate: async (status, chatId) => {
    console.log(`[MOCK] Presence update: ${status} for ${chatId}`);
  }
};

// Mock message objects
const createMockMessage = (content, chatId = '6282111182808@s.whatsapp.net') => ({
  key: {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    remoteJid: chatId,
    fromMe: false
  },
  message: {
    conversation: content
  },
  pushName: 'Test User'
});

// Test function
async function testSimpleBatching() {
  console.log('🧪 Testing Simple Message Batching\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  // Test scenario: Send first message and check if it's batched
  console.log('📝 Test: Single message batching');
  
  // Step 1: Send first message
  console.log('\n1. Sending first message: "oi"');
  const message1 = createMockMessage('oi');
  await handlePersonalChatMessage(mockSocket, message1);
  
  // Check status immediately
  const status1 = getBatchStatus(chatId);
  console.log('Status immediately after first message:', status1);
  
  // Check status after 1 second
  setTimeout(() => {
    const status2 = getBatchStatus(chatId);
    console.log('Status after 1 second:', status2);
  }, 1000);
  
  // Check status after 2 seconds
  setTimeout(() => {
    const status3 = getBatchStatus(chatId);
    console.log('Status after 2 seconds:', status3);
  }, 2000);
  
  // Check status after timeout
  setTimeout(() => {
    const status4 = getBatchStatus(chatId);
    console.log('Status after timeout:', status4);
    console.log('\n✅ Test completed!');
  }, BATCH_CONFIG.TYPING_TIMEOUT + 1000);
}

// Run test
testSimpleBatching().catch(console.error);
