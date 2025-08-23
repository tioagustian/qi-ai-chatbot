import { shouldRespondToBatch } from './src/services/responseDeterminationService.js';

// Test the batch response determination fix
async function testBatchResponseDetermination() {
  console.log('🧪 Testing Batch Response Determination Fix\n');

  // Mock batch messages similar to the real scenario
  const mockBatchMessages = [
    {
      content: 'qi apakah paus mamalia?',
      sender: '275363422859280@s.whatsapp.net',
      timestamp: Date.now() / 1000,
      isTagged: true,
      hasImage: false
    },
    {
      content: 'terus kalau sapi?',
      sender: '275363422859280@s.whatsapp.net',
      timestamp: Date.now() / 1000 + 7,
      isTagged: false,
      hasImage: false
    }
  ];

  const mockBatchMetadata = {
    isBatchedMessage: true,
    totalInBatch: 2,
    batchId: 'test_batch_123',
    startTime: Date.now() - 10000
  };

  try {
    console.log('Testing batch response determination...');
    console.log('Batch messages:');
    mockBatchMessages.forEach((msg, idx) => {
      console.log(`  ${idx + 1}. "${msg.content}" (Tagged: ${msg.isTagged})`);
    });
    
    const result = await shouldRespondToBatch(
      mockBatchMessages,
      true, // isGroup
      'Qi AI',
      mockBatchMetadata
    );

    console.log('\n✅ Batch analysis result:');
    console.log(`   Should respond: ${result.shouldRespond}`);
    console.log(`   Confidence: ${result.confidence}`);
    console.log(`   Reason: ${result.reason}`);
    console.log(`   Response to message: ${result.responseToMessage}`);
    
    if (result.aiAnalysis) {
      console.log(`   AI Analysis:`, {
        overallIntent: result.aiAnalysis.analysis?.overallIntent,
        requiresResponse: result.aiAnalysis.analysis?.requiresResponse,
        batchFlow: result.aiAnalysis.analysis?.batchFlow,
        responseStrategy: result.aiAnalysis.analysis?.responseStrategy
      });
    }

    // Test individual message analysis
    console.log('\n📝 Testing individual message analysis...');
    
    const { shouldRespondToMessageWithBatch } = await import('./src/services/responseDeterminationService.js');
    
    // Test first message (should be tagged)
    const mockMessage1 = {
      key: {
        remoteJid: '120363400571723485@g.us',
        participant: '275363422859280@s.whatsapp.net',
        id: 'msg_1'
      },
      message: {
        conversation: 'qi apakah paus mamalia?'
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: 'Tio Agustian',
      batchMetadata: {
        isBatchedMessage: true,
        batchPosition: 1,
        totalInBatch: 2,
        isFirstInBatch: true,
        isLastInBatch: false,
        batchId: 'test_batch_123',
        processingTime: 10000,
        otherMessagesInBatch: [
          { content: 'terus kalau sapi?', position: 2, timestamp: Date.now() / 1000 + 7 }
        ]
      }
    };

    const result1 = await shouldRespondToMessageWithBatch(
      mockMessage1,
      'qi apakah paus mamalia?',
      true, // isTagged
      true, // isGroup
      'Qi AI',
      mockMessage1.batchMetadata,
      mockMessage1.batchMetadata.otherMessagesInBatch
    );

    console.log(`   Message 1 (tagged): shouldRespond = ${result1.shouldRespond}, confidence = ${result1.confidence}`);

    // Test second message (not tagged)
    const mockMessage2 = {
      key: {
        remoteJid: '120363400571723485@g.us',
        participant: '275363422859280@s.whatsapp.net',
        id: 'msg_2'
      },
      message: {
        conversation: 'terus kalau sapi?'
      },
      messageTimestamp: Math.floor(Date.now() / 1000) + 7,
      pushName: 'Tio Agustian',
      batchMetadata: {
        isBatchedMessage: true,
        batchPosition: 2,
        totalInBatch: 2,
        isFirstInBatch: false,
        isLastInBatch: true,
        batchId: 'test_batch_123',
        processingTime: 10000,
        otherMessagesInBatch: [
          { content: 'qi apakah paus mamalia?', position: 1, timestamp: Date.now() / 1000 }
        ]
      }
    };

    const result2 = await shouldRespondToMessageWithBatch(
      mockMessage2,
      'terus kalau sapi?',
      false, // isTagged
      true, // isGroup
      'Qi AI',
      mockMessage2.batchMetadata,
      mockMessage2.batchMetadata.otherMessagesInBatch
    );

    console.log(`   Message 2 (not tagged): shouldRespond = ${result2.shouldRespond}, confidence = ${result2.confidence}`);

  } catch (error) {
    console.log('❌ Test failed:', error.message);
    console.log('Stack trace:', error.stack);
  }

  console.log('\n🎉 Batch Response Determination Test Completed!');
}

// Run the test
testBatchResponseDetermination().catch(console.error);
