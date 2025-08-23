import { integrateFactsIntelligently, analyzeMessageIntent, enhanceContextWithFacts } from './src/services/factIntegrationService.js';
import { getDb } from './src/database/index.js';

// Test intelligent fact integration functionality
async function testIntelligentFactIntegration() {
  try {
    console.log('🧠 Testing Intelligent Fact Integration...\n');
    
    // Initialize database
    const db = getDb();
    
    // Test user ID
    const testUserId = '6282111182808@s.whatsapp.net';
    
    // Test 1: Personal question intent
    console.log('📝 Test 1: Personal Question Intent');
    console.log('Message: "Siapa nama saya?"');
    
    const personalQuestionResult = await integrateFactsIntelligently(
      testUserId, 
      'Siapa nama saya?', 
      ['Halo, apa kabar?', 'Baik, terima kasih'],
      {
        maxFacts: 3,
        minRelevance: 0.4,
        useSemanticSearch: true
      }
    );
    
    console.log('Personal Question Analysis:', {
      intent: personalQuestionResult.messageAnalysis.intent,
      isPersonal: personalQuestionResult.messageAnalysis.isPersonal,
      isQuestion: personalQuestionResult.messageAnalysis.isQuestion,
      topics: personalQuestionResult.messageAnalysis.topics,
      shouldUseFacts: personalQuestionResult.shouldUseFacts,
      integratedFacts: personalQuestionResult.integratedFacts.length,
      contextEnhancement: personalQuestionResult.contextEnhancement
    });
    
    // Test 2: Factual question intent
    console.log('\n🔍 Test 2: Factual Question Intent');
    console.log('Message: "Apa itu Jakarta?"');
    
    const factualQuestionResult = await integrateFactsIntelligently(
      testUserId, 
      'Apa itu Jakarta?', 
      ['Kamu tahu tentang Indonesia?', 'Ya, saya tertarik'],
      {
        maxFacts: 3,
        minRelevance: 0.4,
        useSemanticSearch: true
      }
    );
    
    console.log('Factual Question Analysis:', {
      intent: factualQuestionResult.messageAnalysis.intent,
      isFactual: factualQuestionResult.messageAnalysis.isFactual,
      isQuestion: factualQuestionResult.messageAnalysis.isQuestion,
      topics: factualQuestionResult.messageAnalysis.topics,
      shouldUseFacts: factualQuestionResult.shouldUseFacts,
      integratedFacts: factualQuestionResult.integratedFacts.length,
      contextEnhancement: factualQuestionResult.contextEnhancement
    });
    
    // Test 3: Conversational intent
    console.log('\n💬 Test 3: Conversational Intent');
    console.log('Message: "Halo, apa kabar?"');
    
    const conversationalResult = await integrateFactsIntelligently(
      testUserId, 
      'Halo, apa kabar?', 
      ['Kemarin kita ngobrol tentang hobi', 'Ya, saya suka musik'],
      {
        maxFacts: 3,
        minRelevance: 0.4,
        useSemanticSearch: true
      }
    );
    
    console.log('Conversational Analysis:', {
      intent: conversationalResult.messageAnalysis.intent,
      isConversational: conversationalResult.messageAnalysis.isConversational,
      topics: conversationalResult.messageAnalysis.topics,
      shouldUseFacts: conversationalResult.shouldUseFacts,
      integratedFacts: conversationalResult.integratedFacts.length,
      contextEnhancement: conversationalResult.contextEnhancement
    });
    
    // Test 4: Personal statement intent
    console.log('\n👤 Test 4: Personal Statement Intent');
    console.log('Message: "Saya suka makan nasi goreng"');
    
    const personalStatementResult = await integrateFactsIntelligently(
      testUserId, 
      'Saya suka makan nasi goreng', 
      ['Kamu suka masakan apa?', 'Saya suka makanan Indonesia'],
      {
        maxFacts: 3,
        minRelevance: 0.4,
        useSemanticSearch: true
      }
    );
    
    console.log('Personal Statement Analysis:', {
      intent: personalStatementResult.messageAnalysis.intent,
      isPersonal: personalStatementResult.messageAnalysis.isPersonal,
      topics: personalStatementResult.messageAnalysis.topics,
      shouldUseFacts: personalStatementResult.shouldUseFacts,
      integratedFacts: personalStatementResult.integratedFacts.length,
      contextEnhancement: personalStatementResult.contextEnhancement
    });
    
    // Test 5: Context enhancement
    console.log('\n🎯 Test 5: Context Enhancement');
    console.log('Testing context enhancement with facts');
    
    const contextMessages = [
      { role: 'user', content: 'Halo' },
      { role: 'assistant', content: 'Hai! Apa kabar?' },
      { role: 'user', content: 'Siapa nama saya?' }
    ];
    
    const enhancedContext = await enhanceContextWithFacts(
      testUserId,
      'Siapa nama saya?',
      contextMessages,
      ['Halo', 'Hai! Apa kabar?']
    );
    
    console.log('Enhanced Context:', {
      originalLength: contextMessages.length,
      enhancedLength: enhancedContext.length,
      newContextMessages: enhancedContext.filter(msg => msg.name === 'intelligent_facts')
    });
    
    // Test 6: Message intent analysis
    console.log('\n🧠 Test 6: Message Intent Analysis');
    
    const testMessages = [
      'Apa nama saya?',
      'Saya tinggal di Jakarta',
      'Apa itu AI?',
      'Halo, gimana kabarnya?',
      'Saya suka musik jazz',
      'Berapa umur saya?'
    ];
    
    testMessages.forEach(message => {
      const analysis = analyzeMessageIntent(message, []);
      console.log(`"${message}" -> Intent: ${analysis.intent}, Personal: ${analysis.isPersonal}, Question: ${analysis.isQuestion}, Topics: [${analysis.topics.join(', ')}]`);
    });
    
    console.log('\n✅ All intelligent fact integration tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testIntelligentFactIntegration();
