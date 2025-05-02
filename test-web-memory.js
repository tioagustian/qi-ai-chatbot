// Test script for web search and content memory features
import dotenv from 'dotenv';
import { searchWeb, fetchUrlContent } from './src/services/aiService.js';
import { 
  storeWebSearchResults, 
  storeWebContent, 
  getRelevantWebResults, 
  getRelevantWebContent,
  extractKeywordsFromRelevantFacts
} from './src/services/memoryService.js';
import { getDb } from './src/database/index.js';

// Load environment variables
dotenv.config();

async function testWebMemory() {
  console.log('=== Testing Web Search Memory Functions ===');
  
  try {
    // 1. First test: Perform a web search and store results
    console.log('\n1. Testing web search and storage:');
    const searchTerm = 'Qatar Investment blockchain technology';
    console.log(`Searching for: "${searchTerm}"`);
    
    // Perform search
    const searchResults = await searchWeb(searchTerm);
    
    if (searchResults.success) {
      console.log(`Found ${searchResults.results.length} results`);
      console.log(`First result: ${searchResults.results[0].title}`);
      
      // The searchWeb function should automatically store results via import
      console.log('Search results should be automatically stored in memory');
    } else {
      console.error('Search failed:', searchResults.error);
    }
    
    // 2. Second test: Fetch content from a URL and store it
    console.log('\n2. Testing URL content fetch and storage:');
    if (searchResults.success && searchResults.results.length > 0) {
      const url = searchResults.results[0].link;
      console.log(`Fetching content from: ${url}`);
      
      // Fetch URL content
      const contentResult = await fetchUrlContent(url);
      
      if (contentResult.success) {
        console.log(`Successfully fetched content: "${contentResult.title}"`);
        console.log(`Content excerpt: ${contentResult.content.substring(0, 100)}...`);
        
        // The fetchUrlContent function should automatically store content via import
        console.log('URL content should be automatically stored in memory');
      } else {
        console.error('Content fetch failed:', contentResult.error);
      }
    }
    
    // 3. Third test: Retrieve stored search results based on keywords
    console.log('\n3. Testing retrieval of web search results:');
    // Keywords related to the search query
    const testKeywords = ['blockchain', 'qatar', 'investment'];
    
    console.log(`Retrieving search results for keywords: ${testKeywords.join(', ')}`);
    const relevantSearchResults = getRelevantWebResults(testKeywords);
    
    if (relevantSearchResults.length > 0) {
      console.log(`Found ${relevantSearchResults.length} relevant search results:`);
      relevantSearchResults.forEach((result, i) => {
        console.log(`  ${i+1}. ${result}`);
      });
    } else {
      console.log('No relevant search results found');
    }
    
    // 4. Fourth test: Retrieve stored web content based on keywords
    console.log('\n4. Testing retrieval of web content:');
    console.log(`Retrieving web content for keywords: ${testKeywords.join(', ')}`);
    const relevantWebContent = getRelevantWebContent(testKeywords);
    
    if (relevantWebContent.length > 0) {
      console.log(`Found ${relevantWebContent.length} relevant web content items:`);
      relevantWebContent.forEach((content, i) => {
        console.log(`  ${i+1}. ${content}`);
      });
    } else {
      console.log('No relevant web content found');
    }
    
    // 5. Fifth test: Extract keywords from relevant facts
    console.log('\n5. Testing extraction of keywords from relevant facts:');
    const testFacts = {
      'interest_in_blockchain': {
        value: 'User is interested in blockchain technology',
        category: 'interests',
        tags: ['technology', 'crypto']
      },
      'lives_in_qatar': {
        value: 'User lives in Doha, Qatar',
        category: 'location',
        tags: ['middle_east']
      }
    };
    
    const extractedKeywords = extractKeywordsFromRelevantFacts(testFacts);
    console.log(`Extracted keywords: ${extractedKeywords.join(', ')}`);
    
    // 6. Display some raw data from the database for verification
    console.log('\n6. Raw database checks:');
    const db = getDb();
    
    const searchHistoryCount = Object.keys(db.data.webSearchHistory || {}).length;
    console.log(`Web search history entries: ${searchHistoryCount}`);
    
    const webContentCount = Object.keys(db.data.webContent || {}).length;
    console.log(`Web content entries: ${webContentCount}`);
    
    // Test complete
    console.log('\n=== Web Memory Test Complete ===');
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Run the test
testWebMemory().catch(console.error); 