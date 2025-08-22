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

// Mock presence update objects
const createMockPresenceUpdate = (chatId, isTyping) => ({
  id: chatId,
  participants: {
    [chatId]: { lastKnownPresence: isTyping ? 'composing' : 'available' }
  }
});

// Test function - simulates exact scenario from logs with typing events
async function testPresenceIntegration() {
  console.log('🧪 Testing Presence Integration - Exact Scenario\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  console.log('📝 Test: Messages with typing events (like real logs)');
  console.log('Expected: Typing events should prevent early processing\n');
  
  // Step 1: User starts typing (like 09:42:05 in logs)
  console.log('1. 09:42:05 - User starts typing');
  const typingStart = createMockPresenceUpdate(chatId, true);
  await handleTypingUpdate(mockSocket, typingStart);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`   Status after typing start: typing=${status?.isTyping || false}, batch exists=${!!status}`);
  }, 100);
  
  // Step 2: First message received (like 09:42:07 in logs)
  console.log('2. 09:42:07 - First message received: "oi"');
  setTimeout(async () => {
    const message1 = createMockMessage('oi');
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after first message: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 2000);
  
  // Step 3: Second message received (like 09:42:13 in logs)
  console.log('3. 09:42:13 - Second message received: "gue punya pertanyaan nih"');
  setTimeout(async () => {
    const message2 = createMockMessage('gue punya pertanyaan nih');
    await handlePersonalChatMessage(mockSocket, message2);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after second message: ${status?.messageCount || 0} messages, processing=${status?.processing || false}`);
    }, 500);
  }, 8000);
  
  // Step 4: User still typing (like 09:42:17 in logs)
  console.log('4. 09:42:17 - User still typing');
  setTimeout(async () => {
    const typingContinues = createMockPresenceUpdate(chatId, true);
    await handleTypingUpdate(mockSocket, typingContinues);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after typing continues: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}`);
    }, 500);
  }, 12000);
  
  // Step 5: Third message received (like 09:42:21 in logs)
  console.log('5. 09:42:21 - Third message received: "tentang rokok"');
  setTimeout(async () => {
    const message3 = createMockMessage('tentang rokok');
    await handlePersonalChatMessage(mockSocket, message3);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after third message: ${status?.messageCount || 0} messages, processing=${status?.processing || false}`);
    }, 500);
  }, 16000);
  
  // Step 6: User stops typing
  console.log('6. User stops typing - should trigger processing');
  setTimeout(async () => {
    const typingStop = createMockPresenceUpdate(chatId, false);
    await handleTypingUpdate(mockSocket, typingStop);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after typing stops: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}`);
    }, 500);
  }, 20000);
  
  // Step 7: Final check
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`\n📊 Final status: ${status?.messageCount || 0} messages, processing=${status?.processing || false}`);
    
    if (!status) {
      console.log('✅ SUCCESS: Batch was processed and cleaned up!');
      console.log('✅ All 3 messages should have been combined into a single response.');
    } else {
      console.log('❌ ISSUE: Batch still exists, may not have processed correctly.');
    }
    
    console.log('\n🎯 Expected behavior:');
    console.log('- User typing prevents timeout from being set');
    console.log('- Messages accumulate while user is typing');
    console.log('- Only when user stops typing, timeout is set');
    console.log('- All messages processed together after timeout');
    console.log('\n✅ Test completed!');
  }, 25000);
}

// Run test
console.log('🚀 Starting presence integration test...\n');
testPresenceIntegration().catch(console.error);
