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

// Mock presence update objects (using EXACT format from logs)
const createMockPresenceUpdate = (chatId, isTyping) => ({
  id: chatId,
  presences: {  // Using 'presences' not 'participants'
    [chatId]: { 
      lastKnownPresence: isTyping ? 'composing' : 'available' 
    }
  }
});

// Test function - simulates exact presence format from logs
async function testPresencePropertyFix() {
  console.log('🧪 Testing Presence Property Fix\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  console.log('📝 Test: Correct presence property detection');
  console.log('Expected: presences.composing = typing, presences.available = stopped\n');
  
  // Step 1: User starts typing (using exact format from logs)
  console.log('1. User starts typing (composing) - exact format');
  const typingStart = createMockPresenceUpdate(chatId, true);
  console.log('   Sending presence:', JSON.stringify(typingStart, null, 2));
  await handleTypingUpdate(mockSocket, typingStart);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`   Status: typing=${status?.isTyping || false}, batch exists=${!!status}`);
  }, 100);
  
  // Step 2: Send message while typing
  console.log('\n2. Send message while user is typing');
  setTimeout(async () => {
    const message1 = createMockMessage('gue punya pertanyaan nih buat lu');
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after message: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 1000);
  
  // Step 3: User continues typing (should prevent timeout)
  console.log('\n3. User continues typing (should prevent timeout)');
  setTimeout(async () => {
    const stillTyping = createMockPresenceUpdate(chatId, true);
    console.log('   Sending presence:', JSON.stringify(stillTyping, null, 2));
    await handleTypingUpdate(mockSocket, stillTyping);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 2000);
  
  // Step 4: Send second message while still typing
  console.log('\n4. Send second message while still typing');
  setTimeout(async () => {
    const message2 = createMockMessage('apa persamaan kuda dengan kambing?');
    await handlePersonalChatMessage(mockSocket, message2);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after second message: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 4000);
  
  // Step 5: User stops typing (available) - should trigger processing
  console.log('\n5. User stops typing (available) - should trigger processing');
  setTimeout(async () => {
    const typingStops = createMockPresenceUpdate(chatId, false);
    console.log('   Sending presence:', JSON.stringify(typingStops, null, 2));
    await handleTypingUpdate(mockSocket, typingStops);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status after stopping: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 6000);
  
  // Step 6: Final check
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
    console.log('- presences.composing = user is typing (prevents timeout)');
    console.log('- presences.available = user stopped typing (triggers timeout)');
    console.log('- Messages accumulate while typing');
    console.log('- All messages processed together when typing stops');
    console.log('\n✅ Test completed!');
  }, 10000);
}

// Run test
console.log('🚀 Starting presence property fix test...\n');
testPresencePropertyFix().catch(console.error);
