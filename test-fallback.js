// Test script for fallback mechanism with a large context
import dotenv from 'dotenv';
import { generateAIResponseLegacy, generateAIResponse2, reduceContextSize } from './src/services/aiService.js';
import { getDb } from './src/database/index.js';

// Load environment variables
dotenv.config();

// Create a very large context that would exceed token limits
function createLargeContext(size = 50) {
  const messages = [];
  
  // Add system message
  messages.push({
    role: 'system',
    content: 'Kamu adalah Qi, sebuah AI yang berinteraksi di WhatsApp. Kepribadianmu friendly dan helpfull. Suasana hatimu saat ini: happy - senang dan bersemangat. Selalu jawab dalam Bahasa Indonesia kecuali diminta menggunakan bahasa lain. Hindari penyebutan "sebagai AI" atau "sebagai asisten AI". Pada percakapan grup, kamu hanya merespon ketika disebutkan namamu (Qi).'
  });
  
  // Generate conversation with repeating pattern
  for (let i = 0; i < size; i++) {
    // Add user message
    messages.push({
      role: 'user',
      content: `Pesan ${i+1}: Ini adalah percakapan test dengan konten yang sangat panjang untuk menguji kemampuan fallback mechanism. Pesan ini dibuat berulang-ulang untuk membuat context yang sangat besar yang akan melebihi batas token. Nomor pesan ini adalah ${i+1} dari total ${size} pesan.`
    });
    
    // Add assistant message
    messages.push({
      role: 'assistant',
      content: `Baik, saya mengerti ini adalah pesan test nomor ${i+1}. Saya akan terus merespon untuk membangun context yang besar untuk pengujian. Semoga pengujian fallback mechanism berjalan dengan baik!`
    });
  }
  
  // Add final user message
  messages.push({
    role: 'user',
    content: 'Tolong ringkas jumlah total pesan dalam percakapan ini dan berikan tanggal hari ini.'
  });
  
  return messages;
}

async function runTests() {
  console.log('Testing fallback mechanism with a large context...');
  
  // Get DB for config
  const db = getDb();
  
  // Create large context
  const largeContext = createLargeContext(30);
  console.log(`Created context with ${largeContext.length} messages`);
  
  // Test context reduction
  console.log('\n1. Testing context reduction');
  const reducedContext = reduceContextSize(largeContext, {
    maxMessages: 10,
    alwaysKeepSystemMessages: true,
    alwaysKeepLastUserMessage: true
  });
  console.log(`Reduced context from ${largeContext.length} to ${reducedContext.length} messages`);
  
  // Test legacy function with large context
  console.log('\n2. Testing generateAIResponseLegacy with large context');
  try {
    console.time('legacy-response-time');
    const legacyResponse = await generateAIResponseLegacy(
      'Ringkas jumlah pesan dalam percakapan ini',
      largeContext,
      db.data
    );
    console.timeEnd('legacy-response-time');
    console.log('Legacy response:', legacyResponse.substring(0, 100) + '...');
  } catch (error) {
    console.error('Legacy test failed:', error.message);
  }
  
  // Test new function with large context
  console.log('\n3. Testing generateAIResponse2 with large context');
  try {
    console.time('new-response-time');
    const newResponse = await generateAIResponse2(
      db.data.config,
      largeContext
    );
    console.timeEnd('new-response-time');
    console.log('New response:', newResponse.substring(0, 100) + '...');
  } catch (error) {
    console.error('New test failed:', error.message);
  }
  
  console.log('\nTests completed!');
}

runTests().catch(console.error); 