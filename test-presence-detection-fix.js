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

// Mock presence update objects (using correct format from logs)
const createMockPresenceUpdate = (chatId, isTyping) => ({
  id: chatId,
  participants: {
    [chatId]: { 
      lastKnownPresence: isTyping ? 'composing' : 'available' 
    }
  }
});

// Test function - simulates exact presence format from logs
async function testPresenceDetectionFix() {
  console.log('🧪 Testing Presence Detection Fix\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  console.log('📝 Test: Correct presence detection with real format');
  console.log('Expected: composing = typing, available = stopped typing\n');
  
  // Step 1: User starts typing (composing)
  console.log('1. User starts typing (composing)');
  const typingStart = createMockPresenceUpdate(chatId, true);
  console.log('   Sending presence:', JSON.stringify(typingStart, null, 2));
  await handleTypingUpdate(mockSocket, typingStart);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`   Status: typing=${status?.isTyping || false}, batch exists=${!!status}`);
  }, 100);
  
  // Step 2: User stops typing (available)
  console.log('\n2. User stops typing (available)');
  setTimeout(async () => {
    const typingStop = createMockPresenceUpdate(chatId, false);
    console.log('   Sending presence:', JSON.stringify(typingStop, null, 2));
    await handleTypingUpdate(mockSocket, typingStop);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: typing=${status?.isTyping || false}, batch exists=${!!status}`);
    }, 100);
  }, 1000);
  
  // Step 3: User starts typing again (composing)
  console.log('\n3. User starts typing again (composing)');
  setTimeout(async () => {
    const typingAgain = createMockPresenceUpdate(chatId, true);
    console.log('   Sending presence:', JSON.stringify(typingAgain, null, 2));
    await handleTypingUpdate(mockSocket, typingAgain);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: typing=${status?.isTyping || false}, batch exists=${!!status}`);
    }, 100);
  }, 2000);
  
  // Step 4: Send message while typing
  console.log('\n4. Send message while user is typing');
  setTimeout(async () => {
    const message1 = createMockMessage('gue punya pertanyaan nih buat lu');
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after message: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 3000);
  
  // Step 5: User continues typing (should prevent timeout)
  console.log('\n5. User continues typing (should prevent timeout)');
  setTimeout(async () => {
    const stillTyping = createMockPresenceUpdate(chatId, true);
    console.log('   Sending presence:', JSON.stringify(stillTyping, null, 2));
    await handleTypingUpdate(mockSocket, stillTyping);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 4000);
  
  // Step 6: Send second message
  console.log('\n6. Send second message while still typing');
  setTimeout(async () => {
    const message2 = createMockMessage('tentang rokok');
    await handlePersonalChatMessage(mockSocket, message2);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after second message: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 5000);
  
  // Step 7: User stops typing (should trigger processing)
  console.log('\n7. User stops typing (should trigger processing)');
  setTimeout(async () => {
    const typingStops = createMockPresenceUpdate(chatId, false);
    console.log('   Sending presence:', JSON.stringify(typingStops, null, 2));
    await handleTypingUpdate(mockSocket, typingStops);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after stopping: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 6000);
  
  // Step 8: Final check
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`\n📊 Final status: ${status?.messageCount || 0} messages, processing=${status?.processing || false}`);
    
    if (!status) {
      console.log('✅ SUCCESS: Batch was processed and cleaned up!');
      console.log('✅ Both messages should have been combined into a single response.');
    } else {
      console.log('❌ ISSUE: Batch still exists, may not have processed correctly.');
    }
    
    console.log('\n🎯 Expected behavior:');
    console.log('- composing = user is typing (prevents timeout)');
    console.log('- available = user stopped typing (triggers timeout)');
    console.log('- Messages accumulate while typing');
    console.log('- All messages processed together when typing stops');
    console.log('\n✅ Test completed!');
  }, 10000);
}

// Run test
console.log('🚀 Starting presence detection fix test...\n');
testPresenceDetectionFix().catch(console.error);
