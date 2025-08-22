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
async function testFixedBatching() {
  console.log('🧪 Testing Fixed Message Batching\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  // Test scenario: User sends multiple messages with delays (like in the real logs)
  console.log('📝 Test: Multiple messages with realistic timing');
  
  // Step 1: Send first message
  console.log('\n1. Sending first message: "halo"');
  const message1 = createMockMessage('halo');
  await handlePersonalChatMessage(mockSocket, message1);
  
  // Check status after first message
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Status after first message:', status);
  }, 1000);
  
  // Step 2: Send second message after 7 seconds (like in real logs)
  console.log('\n2. Sending second message after 7 seconds: "saya punya pertanyaan"');
  setTimeout(async () => {
    const message2 = createMockMessage('saya punya pertanyaan');
    await handlePersonalChatMessage(mockSocket, message2);
    
    // Check status after second message
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log('Status after second message:', status);
    }, 1000);
  }, 7000); // Send second message after 7 seconds
  
  // Step 3: Send third message after 6 more seconds (like in real logs)
  console.log('\n3. Sending third message after 6 more seconds: "mengenai rokok"');
  setTimeout(async () => {
    const message3 = createMockMessage('mengenai rokok');
    await handlePersonalChatMessage(mockSocket, message3);
    
    // Check status after third message
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log('Status after third message:', status);
    }, 1000);
  }, 13000); // Send third message after 13 seconds total
  
  // Step 4: Wait for batch processing
  console.log('\n⏳ Waiting for batch processing...');
  console.log(`Should process after ${BATCH_CONFIG.TYPING_TIMEOUT}ms of no new messages`);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Final status:', status);
    console.log('\n✅ Test completed!');
  }, BATCH_CONFIG.TYPING_TIMEOUT + 15000);
}

// Run test
testFixedBatching().catch(console.error);
