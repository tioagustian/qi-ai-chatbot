import { shouldRespondToMessageWithBatch } from './src/services/responseDeterminationService.js';

// Test the timestamp fix
async function testTimestampFix() {
  console.log('🧪 Testing Timestamp Fix for Enhanced Response Determination\n');

  // Mock message with invalid timestamp
  const mockMessage = {
    key: {
      remoteJid: '6285155001880@s.whatsapp.net',
      id: 'test_msg_123'
    },
    message: {
      conversation: 'Hello, can you help me?'
    },
    messageTimestamp: undefined // Invalid timestamp
  };

  // Mock batch metadata with potentially problematic timestamps
  const mockBatchMetadata = {
    isBatchedMessage: true,
    batchPosition: 1,
    totalInBatch: 3,
    isFirstInBatch: true,
    isLastInBatch: false,
    batchId: 'test_batch_123',
    processingTime: -1000 // Invalid negative time
  };

  const mockBatchMessages = [
    { content: 'Hello', position: 1, timestamp: Date.now() },
    { content: 'Can you help?', position: 2, timestamp: Date.now() + 1000 },
    { content: 'Please respond', position: 3, timestamp: Date.now() + 2000 }
  ];

  try {
    console.log('Testing with invalid timestamps...');
    
    const result = await shouldRespondToMessageWithBatch(
      mockMessage,
      'Hello, can you help me?',
      false, // isTagged
      false, // isGroup
      'Qi AI',
      mockBatchMetadata,
      mockBatchMessages
    );

    console.log('✅ Test passed! Result:', {
      shouldRespond: result.shouldRespond,
      confidence: result.confidence,
      reason: result.reason
    });

  } catch (error) {
    console.log('❌ Test failed:', error.message);
    console.log('Stack trace:', error.stack);
  }

  console.log('\n🎉 Timestamp Fix Test Completed!');
}

// Run the test
testTimestampFix().catch(console.error);
