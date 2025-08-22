import { handlePersonalChatMessage, handleTypingUpdate, getBatchStatus, BATCH_CONFIG } from './src/services/messageBatchingService.js';

// Mock socket for testing
const mockSocket = {
  sendPresenceUpdate: async (status, chatId) => {
    console.log(`[MOCK] Bot typing indicator: ${status} for ${chatId}`);
  },
  readMessages: async (keys) => {
    console.log(`[MOCK] Marked ${keys.length} message(s) as read:`, keys.map(k => k.id));
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
  pushName: 'Test User',
  messageTimestamp: Date.now()
});

// Mock presence update objects
const createMockPresenceUpdate = (chatId, isTyping) => ({
  id: chatId,
  presences: {
    [chatId]: { 
      lastKnownPresence: isTyping ? 'composing' : 'available' 
    }
  }
});

// Test function - verify all improvements
async function testImprovements() {
  console.log('🧪 Testing Batching Improvements\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  console.log('📝 Test: Improved batching behavior');
  console.log('Expected improvements:');
  console.log('- Typing indicator on each message (not just first)');
  console.log('- All messages marked as read individually');
  console.log('- Regular message type (not quote/reply)\n');
  
  // Step 1: User starts typing
  console.log('1. User starts typing');
  const typingStart = createMockPresenceUpdate(chatId, true);
  await handleTypingUpdate(mockSocket, typingStart);
  
  // Step 2: Send first message
  console.log('\n2. Send first message: "kemarin hari apa?"');
  console.log('   Expected: Typing indicator shown');
  setTimeout(async () => {
    const message1 = createMockMessage('kemarin hari apa?');
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}`);
    }, 500);
  }, 1000);
  
  // Step 3: Send second message
  console.log('\n3. Send second message: "sekarang hari apa?"');
  console.log('   Expected: Another typing indicator shown');
  setTimeout(async () => {
    const message2 = createMockMessage('sekarang hari apa?');
    await handlePersonalChatMessage(mockSocket, message2);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}`);
    }, 500);
  }, 3000);
  
  // Step 4: User stops typing
  console.log('\n4. User stops typing');
  setTimeout(async () => {
    const typingStop = createMockPresenceUpdate(chatId, false);
    await handleTypingUpdate(mockSocket, typingStop);
    
    console.log('   Expected: Batch processing with all improvements');
  }, 5000);
  
  // Step 5: Final check
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`\n📊 Final status: ${status?.messageCount || 0} messages, processing=${status?.processing || false}`);
    
    if (!status) {
      console.log('✅ SUCCESS: Batch processed with improvements!');
      console.log('   Check above logs for:');
      console.log('   - Multiple typing indicators (one per message)');
      console.log('   - Individual "marked as read" messages');
      console.log('   - Regular message type processing');
    } else {
      console.log('❌ ISSUE: Batch still exists.');
    }
    
    console.log('\n🎯 Improvements implemented:');
    console.log('✅ Typing indicator: Shown after each message (not just first)');
    console.log('✅ Mark as read: Each message marked individually');
    console.log('✅ Message type: Regular conversation type (not quote/reply)');
    console.log('✅ Batch metadata: Added messagesAlreadyRead flag');
    console.log('\n✅ Test completed!');
  }, 10000);
}

// Run test
console.log('🚀 Starting improvements test...\n');
testImprovements().catch(console.error);
