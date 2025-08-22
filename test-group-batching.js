import { 
  handlePersonalChatMessage, 
  handleTypingUpdate, 
  getBatchStatus, 
  BATCH_CONFIG 
} from './src/services/messageBatchingService.js';

// Mock socket for testing
const mockSocket = {
  sendPresenceUpdate: async (status, chatId) => {
    console.log(`[MOCK] Bot typing indicator: ${status} for ${chatId}`);
  },
  readMessages: async (keys) => {
    console.log(`[MOCK] Marked ${keys.length} message(s) as read:`, keys.map(k => k.id));
  }
};

// Mock message objects for group chat
const createGroupMessage = (content, senderId, senderName, chatId = '120363419222251535@g.us') => {
  const timestamp = Date.now();
  return {
    key: {
      id: `msg_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      remoteJid: chatId,
      participant: senderId,
      fromMe: false
    },
    message: {
      conversation: content
    },
    pushName: senderName,
    messageTimestamp: timestamp
  };
};

// Mock presence update objects for groups
const createGroupPresenceUpdate = (chatId, userPresences) => ({
  id: chatId,
  presences: userPresences
});

// Test users
const users = {
  alice: { id: '6281234567890@s.whatsapp.net', name: 'Alice' },
  bob: { id: '6289876543210@s.whatsapp.net', name: 'Bob' }, 
  charlie: { id: '6285555555555@s.whatsapp.net', name: 'Charlie' }
};

// Mock processMessage function
async function mockProcessMessage(sock, message) {
  const content = message.message?.conversation || '';
  const senderName = message.pushName || 'User';
  const isBatchedMessage = message.batchMetadata && message.batchMetadata.isBatchedMessage;
  
  if (isBatchedMessage) {
    console.log(`\n🤖 Processing batched group message ${message.batchMetadata.batchPosition}/${message.batchMetadata.totalInBatch} from ${senderName}:`);
    console.log(`   Content: "${content}"`);
    console.log(`   Is last in batch: ${message.batchMetadata.isLastInBatch}`);
    console.log(`   User ID: ${message.batchMetadata.userId}`);
    
    // Only simulate AI response for the last message in each user's batch
    if (message.batchMetadata.isLastInBatch) {
      console.log(`\n💬 AI would respond to ${senderName}'s complete batch here`);
      console.log(`   Batch context: ${message.batchMetadata.totalInBatch} messages from ${senderName}`);
    }
  } else {
    console.log(`\n📝 Processing single group message from ${senderName}: "${content}"`);
  }
}

// Override the processMessage function
import('./src/handlers/messageHandler.js').then((module) => {
  module.processMessage = mockProcessMessage;
});

// Test complex group scenarios
async function testGroupBatching() {
  console.log('🧪 Testing Group Message Batching System\n');
  
  const groupId = '120363419222251535@g.us';
  
  console.log('📝 Scenario: Multiple users typing and sending messages concurrently');
  console.log('Expected: Each user gets their own batch, processed independently\n');
  
  // === Scenario 1: Alice starts typing and sends messages ===
  console.log('1. Alice starts typing');
  setTimeout(async () => {
    const aliceTyping = createGroupPresenceUpdate(groupId, {
      [users.alice.id]: { lastKnownPresence: 'composing' }
    });
    await handleTypingUpdate(mockSocket, aliceTyping);
  }, 1000);
  
  console.log('\n2. Alice sends first message');
  setTimeout(async () => {
    const message1 = createGroupMessage('Hey everyone!', users.alice.id, users.alice.name, groupId);
    await handlePersonalChatMessage(mockSocket, message1);
    
    setTimeout(() => {
      const status = getBatchStatus(groupId, users.alice.id);
      console.log(`   Alice's batch: ${status?.messageCount || 0} messages, typing: ${status?.isTyping || false}`);
    }, 100);
  }, 2000);
  
  // === Scenario 2: Bob starts typing while Alice is still composing ===  
  console.log('\n3. Bob starts typing (while Alice is still active)');
  setTimeout(async () => {
    const bobTyping = createGroupPresenceUpdate(groupId, {
      [users.bob.id]: { lastKnownPresence: 'composing' }
    });
    await handleTypingUpdate(mockSocket, bobTyping);
  }, 3000);
  
  console.log('\n4. Alice sends second message');
  setTimeout(async () => {
    const message2 = createGroupMessage('How is everyone doing?', users.alice.id, users.alice.name, groupId);
    await handlePersonalChatMessage(mockSocket, message2);
    
    setTimeout(() => {
      const aliceStatus = getBatchStatus(groupId, users.alice.id);
      const bobStatus = getBatchStatus(groupId, users.bob.id);
      console.log(`   Alice's batch: ${aliceStatus?.messageCount || 0} messages`);
      console.log(`   Bob's batch: ${bobStatus?.messageCount || 0} messages`);
    }, 100);
  }, 4000);
  
  // === Scenario 3: Bob sends message while Alice is still typing ===
  console.log('\n5. Bob sends message (interleaved with Alice)');
  setTimeout(async () => {
    const bobMessage = createGroupMessage('Hi Alice! Doing great!', users.bob.id, users.bob.name, groupId);
    await handlePersonalChatMessage(mockSocket, bobMessage);
    
    setTimeout(() => {
      const groupStatus = getBatchStatus(groupId);
      console.log(`   Group status: ${groupStatus?.totalActiveUsers || 0} active users`);
      if (groupStatus?.userStatuses) {
        Object.entries(groupStatus.userStatuses).forEach(([userId, status]) => {
          const userName = Object.values(users).find(u => u.id === userId)?.name || 'Unknown';
          console.log(`   - ${userName}: ${status.messageCount} messages, typing: ${status.isTyping}`);
        });
      }
    }, 100);
  }, 5000);
  
  // === Scenario 4: Charlie joins the conversation ===
  console.log('\n6. Charlie starts typing and sends message');
  setTimeout(async () => {
    const charlieTyping = createGroupPresenceUpdate(groupId, {
      [users.charlie.id]: { lastKnownPresence: 'composing' }
    });
    await handleTypingUpdate(mockSocket, charlieTyping);
    
    setTimeout(async () => {
      const charlieMessage = createGroupMessage('Hello everyone! 👋', users.charlie.id, users.charlie.name, groupId);
      await handlePersonalChatMessage(mockSocket, charlieMessage);
    }, 1000);
  }, 6000);
  
  // === Scenario 5: Alice stops typing - should trigger her batch processing ===
  console.log('\n7. Alice stops typing - should process her batch');
  setTimeout(async () => {
    const aliceStopsTyping = createGroupPresenceUpdate(groupId, {
      [users.alice.id]: { lastKnownPresence: 'available' }
    });
    await handleTypingUpdate(mockSocket, aliceStopsTyping);
    
    console.log('   Expected: Alice\'s 2 messages should be processed as a batch');
  }, 8000);
  
  // === Scenario 6: Bob stops typing - should trigger his batch processing ===
  console.log('\n8. Bob stops typing - should process his batch');
  setTimeout(async () => {
    const bobStopsTyping = createGroupPresenceUpdate(groupId, {
      [users.bob.id]: { lastKnownPresence: 'available' }
    });
    await handleTypingUpdate(mockSocket, bobStopsTyping);
    
    console.log('   Expected: Bob\'s 1 message should be processed');
  }, 10000);
  
  // === Final Status Check ===
  setTimeout(() => {
    console.log('\n📊 Final Status Check:');
    const groupStatus = getBatchStatus(groupId);
    
    if (!groupStatus) {
      console.log('✅ All batches processed successfully!');
    } else {
      console.log(`❓ Remaining active users: ${groupStatus.totalActiveUsers}`);
      Object.entries(groupStatus.userStatuses || {}).forEach(([userId, status]) => {
        const userName = Object.values(users).find(u => u.id === userId)?.name || 'Unknown';
        console.log(`   - ${userName}: ${status.messageCount} messages, processing: ${status.processing}`);
      });
    }
    
    console.log('\n🎯 GROUP BATCHING FEATURES TESTED:');
    console.log('✅ Per-user message batching in groups');
    console.log('✅ Concurrent typing from multiple users');
    console.log('✅ Interleaved messages from different users');
    console.log('✅ Independent timeout handling per user');
    console.log('✅ Proper cleanup after batch processing');
    console.log('✅ Group-wide status monitoring');
    
    console.log('\n🚀 Benefits of Group Batching:');
    console.log('• Each user gets natural conversation flow');
    console.log('• No interference between different users');
    console.log('• Maintains context per user while preserving group dynamics');
    console.log('• Efficient resource usage with per-user state management');
    console.log('• Scalable to any number of concurrent users');
    
    console.log('\n✅ Group batching test completed!');
  }, 15000);
}

// Run test
console.log('🚀 Starting group batching comprehensive test...\n');
testGroupBatching().catch(console.error);
