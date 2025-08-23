import { shouldRespondToBatch } from './src/services/responseDeterminationService.js';

// Test the batch response determination fix
async function testBatchFixVerification() {
  console.log('🧪 Testing Batch Processing Fix Verification\n');

  // Mock batch messages similar to the real scenario
  const mockBatchMessages = [
    {
      content: 'qi apakah sabun cair lebih baik',
      sender: '275363422859280@s.whatsapp.net',
      timestamp: Date.now() / 1000,
      isTagged: true,
      hasImage: false
    },
    {
      content: 'dari sabun batang?',
      sender: '275363422859280@s.whatsapp.net',
      timestamp: Date.now() / 1000 + 4,
      isTagged: false,
      hasImage: false
    }
  ];

  const mockBatchMetadata = {
    isBatchedMessage: true,
    totalInBatch: 2,
    batchId: 'batch_1755926585723',
    startTime: Date.now() - 10000
  };

  try {
    console.log('Testing enhanced batch response determination...');
    console.log('Batch messages:');
    mockBatchMessages.forEach((msg, idx) => {
      const timestamp = new Date(msg.timestamp * 1000).toISOString();
      const senderName = msg.sender.split('@')[0];
      console.log(`  ${idx + 1}. "${msg.content}" (Sender: ${senderName}, Time: ${timestamp}, Tagged: ${msg.isTagged})`);
    });
    
    const result = await shouldRespondToBatch(
      mockBatchMessages,
      true, // isGroup
      'Qi',
      mockBatchMetadata
    );

    console.log('\n✅ Enhanced batch analysis result:');
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

    // Test the logic for individual messages
    console.log('\n📝 Testing individual message logic...');
    
    // Message 1 (should be tagged, position 1)
    const shouldRespond1 = result.shouldRespond && result.responseToMessage === 1;
    console.log(`   Message 1 (tagged): shouldRespond = ${shouldRespond1}`);
    
    // Message 2 (not tagged, position 2)
    const shouldRespond2 = result.shouldRespond && result.responseToMessage === 2;
    console.log(`   Message 2 (not tagged): shouldRespond = ${shouldRespond2}`);

    console.log('\n🎯 Expected behavior:');
    console.log('   - Batch analysis should happen only once');
    console.log('   - Response should be to the appropriate message based on context');
    console.log('   - No double processing of the same batch');

  } catch (error) {
    console.log('❌ Test failed:', error.message);
    console.log('Stack trace:', error.stack);
  }

  console.log('\n🎉 Batch Fix Verification Test Completed!');
}

// Run the test
testBatchFixVerification().catch(console.error);
