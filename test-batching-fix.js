import { handlePersonalChatMessage, handleTypingUpdate, getBatchStatus, BATCH_CONFIG } from './src/services/messageBatchingService.js';

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

// Mock typing update
const createTypingUpdate = (chatId, isTyping) => ({
  id: chatId,
  participants: isTyping ? ['6282111182808@s.whatsapp.net'] : []
});

// Test function
async function testBatchingFix() {
  console.log('🧪 Testing Message Batching Fix\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  // Test scenario: User sends multiple messages with typing events
  console.log('📝 Test: Multiple messages with typing events');
  
  // Step 1: Send first message
  console.log('\n1. Sending first message: "Halo"');
  const message1 = createMockMessage('Halo');
  await handlePersonalChatMessage(mockSocket, message1);
  
  // Check status after first message
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Status after first message:', status);
  }, 1000);
  
  // Step 2: Simulate user typing
  console.log('\n2. Simulating user typing...');
  await handleTypingUpdate(mockSocket, createTypingUpdate(chatId, true));
  
  // Step 3: Send second message while typing
  console.log('\n3. Sending second message while typing: "Saya punya pertanyaan"');
  const message2 = createMockMessage('Saya punya pertanyaan');
  await handlePersonalChatMessage(mockSocket, message2);
  
  // Check status after second message
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Status after second message:', status);
  }, 1000);
  
  // Step 4: Simulate user stopping typing
  console.log('\n4. Simulating user stops typing...');
  await handleTypingUpdate(mockSocket, createTypingUpdate(chatId, false));
  
  // Check status after stopping typing
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Status after stopping typing:', status);
  }, 1000);
  
  // Step 5: Wait for batch processing
  console.log('\n⏳ Waiting for batch processing...');
  console.log(`Should process after ${BATCH_CONFIG.TYPING_TIMEOUT}ms of no typing`);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Final status:', status);
    console.log('\n✅ Test completed!');
  }, BATCH_CONFIG.TYPING_TIMEOUT + 2000);
}

// Run test
testBatchingFix().catch(console.error);
