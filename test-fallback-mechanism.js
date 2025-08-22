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
  presences: {
    [chatId]: { 
      lastKnownPresence: isTyping ? 'composing' : 'available' 
    }
  }
});

// Test function - simulates missing "stopped typing" event
async function testFallbackMechanism() {
  console.log('🧪 Testing Fallback Mechanism\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  console.log('📝 Test: Missing "stopped typing" event (real-world scenario)');
  console.log('Expected: Fallback timeout should trigger processing\n');
  
  // Step 1: User starts typing
  console.log('1. User starts typing (composing)');
  const typingStart = createMockPresenceUpdate(chatId, true);
  await handleTypingUpdate(mockSocket, typingStart);
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`   Status: typing=${status?.isTyping || false}, batch exists=${!!status}`);
  }, 100);
  
  // Step 2: Send first message while typing
  console.log('\n2. Send first message while typing');
  setTimeout(async () => {
    const message1 = createMockMessage('kemarin hari apa?');
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 1000);
  
  // Step 3: Send second message while typing
  console.log('\n3. Send second message while typing');
  setTimeout(async () => {
    const message2 = createMockMessage('terus hari minggu tanggal berapa?');
    await handlePersonalChatMessage(mockSocket, message2);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 3000);
  
  // Step 4: DON'T send "stopped typing" event (simulate missing event)
  console.log('\n4. NOT sending "stopped typing" event (simulate real-world issue)');
  console.log('   WhatsApp didn\'t send the presence update...');
  
  // Step 5: Wait for fallback timeout
  console.log(`\n5. Waiting for fallback timeout (${BATCH_CONFIG.TYPING_FALLBACK}ms)...`);
  console.log('   This should trigger processing even without "stopped typing" event');
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`   Status during wait: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
  }, 5000);
  
  // Step 6: Final check after fallback timeout
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`\n📊 Final status: ${status?.messageCount || 0} messages, processing=${status?.processing || false}`);
    
    if (!status) {
      console.log('✅ SUCCESS: Fallback mechanism worked!');
      console.log('✅ Both messages should have been processed together.');
    } else {
      console.log('❌ ISSUE: Batch still exists, fallback may not have worked.');
    }
    
    console.log('\n🎯 Expected behavior:');
    console.log('- User starts typing → Bot waits');
    console.log('- Messages accumulate while typing');
    console.log('- No "stopped typing" event received');
    console.log('- Fallback timeout triggers processing');
    console.log('- All messages processed together');
    console.log('\n✅ Test completed!');
  }, BATCH_CONFIG.TYPING_FALLBACK + 2000);
}

// Test function - simulates stale typing detection
async function testStaleTypingDetection() {
  console.log('\n🧪 Testing Stale Typing Detection\n');
  
  const chatId = '6282111182809@s.whatsapp.net'; // Different chat
  
  console.log('📝 Test: Stale typing state detection');
  console.log('Expected: Old typing state should be invalidated\n');
  
  // Step 1: User starts typing
  console.log('1. User starts typing (old timestamp)');
  const typingStart = createMockPresenceUpdate(chatId, true);
  await handleTypingUpdate(mockSocket, typingStart);
  
  // Step 2: Wait longer than max typing age
  console.log('\n2. Waiting longer than max typing age (6 seconds)...');
  setTimeout(async () => {
    console.log('3. Send message after typing state should be stale');
    const message1 = createMockMessage('this should trigger normal timeout');
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Status: ${status?.messageCount || 0} messages, typing=${status?.isTyping || false}, processing=${status?.processing || false}`);
    }, 500);
  }, 7000); // 7 seconds > 6 seconds max age
  
  setTimeout(() => {
    const status = getBatchStatus(chatId);
    console.log(`\n📊 Final status for stale test: ${status?.messageCount || 0} messages, processing=${status?.processing || false}`);
    
    if (!status) {
      console.log('✅ SUCCESS: Stale typing detection worked!');
    } else {
      console.log('❌ ISSUE: Stale typing may not have been detected.');
    }
  }, 12000);
}

// Run tests
console.log('🚀 Starting fallback mechanism tests...\n');
testFallbackMechanism().catch(console.error);

// Run stale typing test after main test
setTimeout(() => {
  testStaleTypingDetection().catch(console.error);
}, BATCH_CONFIG.TYPING_FALLBACK + 3000);
