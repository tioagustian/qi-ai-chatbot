import { shouldRespondToMessageWithBatch } from './src/services/responseDeterminationService.js';
import { getDb, setupDatabase } from './src/database/index.js';

// Mock message objects for testing
const createMockMessage = (content, isGroup = false, isTagged = false, hasImage = false) => ({
  key: {
    remoteJid: isGroup ? '120363419222251535@g.us' : '6285155001880@s.whatsapp.net',
    participant: isGroup ? '6285155001880@s.whatsapp.net' : undefined,
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  message: {
    conversation: content,
    imageMessage: hasImage ? { caption: content } : undefined
  },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Test User'
});

const createMockBatchMetadata = (position, total, isLast = false, isFirst = false) => ({
  isBatchedMessage: true,
  batchPosition: position,
  totalInBatch: total,
  isFirstInBatch: isFirst,
  isLastInBatch: isLast,
  batchId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  processingTime: 5000
});

async function testEnhancedResponseDetermination() {
  console.log('🧪 Testing Enhanced Response Determination with Gemini API\n');

  // Initialize database
  try {
    await setupDatabase();
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.log('⚠️ Database initialization failed, will use fallback logic:', error.message);
  }

  const botName = 'Qi AI';
  
  // Test cases
  const testCases = [
    {
      name: 'Private chat message',
      message: createMockMessage('Hello, how are you?'),
      isGroup: false,
      isTagged: false,
      expected: true
    },
    {
      name: 'Group chat with bot name mention',
      message: createMockMessage('Hey Qi AI, can you help me?'),
      isGroup: true,
      isTagged: false,
      expected: true
    },
    {
      name: 'Group chat with question',
      message: createMockMessage('What is the weather today?'),
      isGroup: true,
      isTagged: false,
      expected: true
    },
    {
      name: 'Group chat with statement (should not respond)',
      message: createMockMessage('I had a great day today'),
      isGroup: true,
      isTagged: false,
      expected: false
    },
    {
      name: 'Batched message - first in batch with question',
      message: createMockMessage('Can you help me?'),
      isGroup: true,
      isTagged: false,
      batchMetadata: createMockBatchMetadata(1, 3, false, true),
      batchMessages: [
        { content: 'Can you help me?', position: 1, timestamp: Date.now() },
        { content: 'I need assistance', position: 2, timestamp: Date.now() + 1000 },
        { content: 'Please respond', position: 3, timestamp: Date.now() + 2000 }
      ],
      expected: true
    },
    {
      name: 'Batched message - middle message (should not respond)',
      message: createMockMessage('I need assistance'),
      isGroup: true,
      isTagged: false,
      batchMetadata: createMockBatchMetadata(2, 3, false, false),
      batchMessages: [
        { content: 'Can you help me?', position: 1, timestamp: Date.now() },
        { content: 'I need assistance', position: 2, timestamp: Date.now() + 1000 },
        { content: 'Please respond', position: 3, timestamp: Date.now() + 2000 }
      ],
      expected: false
    },
    {
      name: 'Batched message - last message with complete thought',
      message: createMockMessage('Please respond'),
      isGroup: true,
      isTagged: false,
      batchMetadata: createMockBatchMetadata(3, 3, true, false),
      batchMessages: [
        { content: 'Can you help me?', position: 1, timestamp: Date.now() },
        { content: 'I need assistance', position: 2, timestamp: Date.now() + 1000 },
        { content: 'Please respond', position: 3, timestamp: Date.now() + 2000 }
      ],
      expected: true
    },
    {
      name: 'Image with analysis request',
      message: createMockMessage('Please analyze this image', false, false, true),
      isGroup: false,
      isTagged: false,
      expected: true
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.name}`);
    console.log(`Message: "${testCase.message.message.conversation}"`);
    console.log(`Group: ${testCase.isGroup}, Tagged: ${testCase.isTagged}`);
    
    if (testCase.batchMetadata) {
      console.log(`Batch: ${testCase.batchMetadata.batchPosition}/${testCase.batchMetadata.totalInBatch} (Last: ${testCase.batchMetadata.isLastInBatch})`);
    }

    try {
      const result = await shouldRespondToMessageWithBatch(
        testCase.message,
        testCase.message.message.conversation,
        testCase.isTagged,
        testCase.isGroup,
        botName,
        testCase.batchMetadata,
        testCase.batchMessages || []
      );

      console.log(`✅ Result: ${result.shouldRespond} (Expected: ${testCase.expected})`);
      console.log(`   Confidence: ${result.confidence}`);
      console.log(`   Reason: ${result.reason}`);
      
      if (result.aiAnalysis) {
        console.log(`   AI Analysis:`, {
          messageIntent: result.aiAnalysis.analysis?.messageIntent,
          requiresResponse: result.aiAnalysis.analysis?.requiresResponse,
          batchConsideration: result.aiAnalysis.analysis?.batchConsideration
        });
      }

      // Check if result matches expectation
      if (result.shouldRespond === testCase.expected) {
        console.log(`   ✅ PASS`);
      } else {
        console.log(`   ❌ FAIL - Expected ${testCase.expected} but got ${result.shouldRespond}`);
      }

    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
    }
  }

  console.log('\n🎉 Enhanced Response Determination Test Completed!');
}

// Run the test
testEnhancedResponseDetermination().catch(console.error);
