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
async function testMessageTiming() {
  console.log('🧪 Testing Message Timing-Based Batching\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  // Test scenario: User sends multiple messages with timing
  console.log('📝 Test: Multiple messages with timing-based batching');
  
  // Step 1: Send first message
  console.log('\n1. Sending first message: "Halo qi"');
  const message1 = createMockMessage('Halo qi');
  await handlePersonalChatMessage(mockSocket, message1);
  
  // Check status after first message
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Status after first message:', status);
  }, 1000);
  
  // Step 2: Send second message quickly (simulating rapid typing)
  console.log('\n2. Sending second message quickly: "Saya punya pertanyaan"');
  setTimeout(async () => {
    const message2 = createMockMessage('Saya punya pertanyaan');
    await handlePersonalChatMessage(mockSocket, message2);
    
    // Check status after second message
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log('Status after second message:', status);
    }, 1000);
  }, 2000); // Send second message after 2 seconds
  
  // Step 3: Wait for batch processing
  console.log('\n⏳ Waiting for batch processing...');
  console.log(`Should process after ${BATCH_CONFIG.TYPING_TIMEOUT}ms of no new messages`);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Final status:', status);
    console.log('\n✅ Test completed!');
  }, BATCH_CONFIG.TYPING_TIMEOUT + 5000);
}

// Run test
testMessageTiming().catch(console.error);
