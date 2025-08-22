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
async function testMessageBatching() {
  console.log('🧪 Testing Message Batching System\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  // Test 1: Single message
  console.log('📝 Test 1: Single message');
  const message1 = createMockMessage('Hello bot!');
  await handlePersonalChatMessage(mockSocket, message1);
  
  // Check status
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Status after single message:', status);
  }, 1000);
  
  // Test 2: Multiple rapid messages
  console.log('\n📝 Test 2: Multiple rapid messages');
  
  const messages = [
    'Hi there!',
    'How are you doing?',
    'I have a question',
    'Can you help me?'
  ];
  
  for (let i = 0; i < messages.length; i++) {
    const message = createMockMessage(messages[i]);
    console.log(`Sending message ${i + 1}: "${messages[i]}"`);
    await handlePersonalChatMessage(mockSocket, message);
    
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Check status after multiple messages
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Status after multiple messages:', status);
  }, 2000);
  
  // Test 3: Wait for processing
  console.log('\n⏳ Test 3: Waiting for batch processing...');
  console.log(`Will process after ${BATCH_CONFIG.TYPING_TIMEOUT}ms of no typing`);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log('Final status:', status);
    console.log('\n✅ Test completed!');
  }, BATCH_CONFIG.TYPING_TIMEOUT + 1000);
}

// Run test
testMessageBatching().catch(console.error);
