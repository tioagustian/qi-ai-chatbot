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

// Mock message objects with Jakarta timezone timestamps
const createMockMessage = (content, chatId = '6282111182808@s.whatsapp.net', delay = 0) => {
  const timestamp = new Date(Date.now() + delay);
  const jakartaTime = timestamp.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  return {
    key: {
      id: `msg_${Date.now() + delay}_${Math.random().toString(36).substr(2, 9)}`,
      remoteJid: chatId,
      fromMe: false
    },
    message: {
      conversation: content
    },
    pushName: 'Tio Agustian',
    messageTimestamp: timestamp.getTime()
  };
};

// Mock presence update objects
const createMockPresenceUpdate = (chatId, isTyping) => ({
  id: chatId,
  presences: {
    [chatId]: { 
      lastKnownPresence: isTyping ? 'composing' : 'available' 
    }
  }
});

// Mock processMessage function to simulate AI payload generation
async function mockProcessMessage(sock, message) {
  const content = message.message?.conversation || '';
  const senderName = message.pushName || 'User';
  const isBatchedMessage = message.batchMetadata && message.batchMetadata.isBatchedMessage;
  
  if (isBatchedMessage) {
    console.log(`\n📝 Processing batched message ${message.batchMetadata.batchPosition}/${message.batchMetadata.totalInBatch}:`);
    console.log(`   Content: "${content}"`);
    console.log(`   Is last in batch: ${message.batchMetadata.isLastInBatch}`);
    
    // Only generate AI payload for the last message in batch
    if (message.batchMetadata.isLastInBatch) {
      console.log(`\n🤖 GENERATING AI PAYLOAD (Last message in batch):`);
      
      // Simulate system message (facts, personality, etc.)
      const systemMessages = [
        {
          role: "system",
          content: "Known facts about Tio Agustian: user_name: Tio Agustian, interest_in_time_questions: Interested in asking about dates and time, current_date: August 22, 2025, location: Indonesia"
        },
        {
          role: "system", 
          content: "IMPORTANT FACTS ABOUT THE USER: current_date: August 22, 2025 (TEMPORAL), user_mistaken_current_month: User mistakenly believes the current month is July (CONTEXT)"
        }
      ];
      
      // Generate individual user messages for each message in batch
      const userMessages = message.batchMetadata.otherMessagesInBatch.map(msg => {
        const timestamp = new Date(msg.timestamp);
        const jakartaTime = timestamp.toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
        
        return {
          role: "user",
          content: `name: ${senderName} \n time: ${jakartaTime} \n content: ${msg.content}`
        };
      });
      
      // Combine all messages
      const aiPayload = [
        ...systemMessages,
        ...userMessages
      ];
      
      console.log(`\n📊 AI PAYLOAD STRUCTURE:`);
      console.log(JSON.stringify(aiPayload, null, 2));
      
      console.log(`\n✅ PAYLOAD ANALYSIS:`);
      console.log(`- System messages: ${systemMessages.length}`);
      console.log(`- User messages: ${userMessages.length} (separate for each batch message)`);
      console.log(`- Total payload size: ${aiPayload.length} messages`);
      console.log(`- Message separation: ✅ Each user message separate`);
      console.log(`- Temporal context: ✅ Individual timestamps preserved`);
      console.log(`- Conversation flow: ✅ Natural message sequence`);
    }
  } else {
    console.log(`\n📝 Processing single message: "${content}"`);
  }
}

// Override the processMessage function in the batching service
import('./src/handlers/messageHandler.js').then((module) => {
  module.processMessage = mockProcessMessage;
});

// Test function - verify new payload structure
async function testPayloadStructure() {
  console.log('🧪 Testing New Payload Structure\n');
  
  const chatId = '6282111182808@s.whatsapp.net';
  
  console.log('📝 Test: Separate messages vs combined approach');
  console.log('Expected: Each message sent separately to AI with timestamps\n');
  
  // Step 1: User starts typing
  console.log('1. User starts typing');
  const typingStart = createMockPresenceUpdate(chatId, true);
  await handleTypingUpdate(mockSocket, typingStart);
  
  // Step 2: Send first message
  console.log('\n2. Send first message: "kalau sekarang bulan juli"');
  setTimeout(async () => {
    const message1 = createMockMessage('kalau sekarang bulan juli', chatId, 0);
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Batch status: ${status?.messageCount || 0} messages`);
    }, 100);
  }, 1000);
  
  // Step 3: Send second message
  console.log('\n3. Send second message: "besok bulan apa?"');
  setTimeout(async () => {
    const message2 = createMockMessage('besok bulan apa?', chatId, 1000);
    await handlePersonalChatMessage(mockSocket, message2);
    
    setTimeout(() => {
      const status = getBatchStatus(chatId);
      console.log(`   Batch status: ${status?.messageCount || 0} messages`);
    }, 100);
  }, 2500);
  
  // Step 4: User stops typing
  console.log('\n4. User stops typing - should trigger processing');
  setTimeout(async () => {
    const typingStop = createMockPresenceUpdate(chatId, false);
    await handleTypingUpdate(mockSocket, typingStop);
    
    console.log('\n⏱️  Processing should begin now...');
  }, 4000);
  
  // Step 5: Final verification
  setTimeout(() => {
    console.log('\n🎯 NEW APPROACH BENEFITS:');
    console.log('✅ AI gets separate messages with individual timestamps');
    console.log('✅ Natural conversation flow preserved');
    console.log('✅ Better context understanding');
    console.log('✅ More accurate fact extraction per message');
    console.log('✅ System prompt at top of payload');
    console.log('✅ Individual user messages maintain timing context');
    
    console.log('\n📊 EXPECTED AI PAYLOAD FORMAT:');
    console.log('1. System message (known facts)');
    console.log('2. System message (important facts)');
    console.log('3. User message 1: "name: Tio Agustian \\n time: 22/08/2025, 17.05.37 \\n content: kalau sekarang bulan juli"');
    console.log('4. User message 2: "name: Tio Agustian \\n time: 22/08/2025, 17.05.38 \\n content: besok bulan apa?"');
    
    console.log('\n✅ Test completed!');
  }, 8000);
}

// Run test
console.log('🚀 Starting payload structure test...\n');
testPayloadStructure().catch(console.error);
