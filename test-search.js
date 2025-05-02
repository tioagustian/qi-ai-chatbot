// Simple test script for web search functionality
import dotenv from 'dotenv';
import { searchWeb, fetchUrlContent } from './src/services/aiService.js';

// Load environment variables
dotenv.config();

async function runTests() {
  console.log('Testing web search functionality...');
  
  // Test searchWeb
  try {
    console.log('1. Testing web search with a simple query');
    const searchResult = await searchWeb('current date and time');
    console.log('Search result success:', searchResult.success);
    console.log('Search results count:', searchResult.results?.length || 0);
    console.log('Search result message:\n', searchResult.message);
  } catch (error) {
    console.error('Search test failed:', error.message);
  }
  
  // Test fetchUrlContent
  try {
    console.log('\n2. Testing URL content fetching');
    const urlResult = await fetchUrlContent('https://en.wikipedia.org/wiki/WhatsApp');
    console.log('URL fetch success:', urlResult.success);
    console.log('URL title:', urlResult.title);
    console.log('Content length:', urlResult.content?.length || 0);
    // Show a sample of the content
    console.log('Content sample:\n', urlResult.content?.substring(0, 200) + '...');
  } catch (error) {
    console.error('URL fetch test failed:', error.message);
  }
  
  console.log('\nTests completed!');
}

runTests().catch(console.error); 