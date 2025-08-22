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

// Test function - simulates the exact scenario from the logs
async function testBatchFixFinal() {
  console.log('🧪 Testing Final Batch Fix - Exact Scenario\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  // Test scenario: Send messages with exact timing from logs
  console.log('📝 Test: Messages sent with exact timing from real logs');
  console.log('Expected: All 3 messages should be processed together\n');
  
  // Step 1: Send first message "qi"
  console.log('1. 09:36:52 - Sending first message: "qi"');
  const message1 = createMockMessage('qi');
  await handlePersonalChatMessage(mockSocket, message1);
  
  // Check status after first message
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`   Status after first message: ${status?.messageCount || 0} messages, processing: ${status?.processing || false}`);
  }, 500);
  
  // Step 2: Send second message after ~7 seconds (like in logs: 09:36:52 -> 09:36:59)
  console.log('2. 09:36:59 - Sending second message: "gue punya pertanyaan"');
  setTimeout(async () => {
    const message2 = createMockMessage('gue punya pertanyaan');
    await handlePersonalChatMessage(mockSocket, message2);
    
    // Check status after second message
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after second message: ${status?.messageCount || 0} messages, processing: ${status?.processing || false}`);
    }, 500);
  }, 7000); // 7 seconds after first message
  
  // Step 3: Send third message after ~3.5 seconds (like in logs: 09:36:59 -> 09:37:02)
  console.log('3. 09:37:02 - Sending third message: "tentang rokok"');
  setTimeout(async () => {
    const message3 = createMockMessage('tentang rokok');
    await handlePersonalChatMessage(mockSocket, message3);
    
    // Check status after third message
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after third message: ${status?.messageCount || 0} messages, processing: ${status?.processing || false}`);
    }, 500);
  }, 10500); // 10.5 seconds after first message (3.5s after second)
  
  // Step 4: Wait for final processing
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`\n📊 Final status: ${status?.messageCount || 0} messages, processing: ${status?.processing || false}`);
    
    if (!status) {
      console.log('✅ SUCCESS: Batch was processed and cleaned up!');
      console.log('✅ All messages should have been combined into a single response.');
    } else {
      console.log('❌ ISSUE: Batch still exists, may not have processed correctly.');
    }
    
    console.log('\n🎯 Expected behavior:');
    console.log('- First message creates batch, sets 3-second timeout');
    console.log('- Second message added to batch, timeout resets');
    console.log('- Third message added to batch, timeout resets');
    console.log('- After 3 seconds of no new messages, all 3 processed together');
    console.log('\n✅ Test completed!');
  }, 15000); // 15 seconds total
}

// Run test
console.log('🚀 Starting batch fix test...\n');
testBatchFixFinal().catch(console.error);
