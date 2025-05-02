// Test script for enhanced fetchUrlContent function
import dotenv from 'dotenv';
import { fetchUrlContent } from './src/services/aiService.js';
import { setupDatabase } from './src/database/index.js';

// Load environment variables
dotenv.config();

async function testFetchUrlContent() {
  console.log('=== Testing Enhanced fetchUrlContent Function ===');
  
  try {
    // Initialize database first
    console.log('Initializing database...');
    await setupDatabase();
    console.log('Database initialized successfully.');
    
    // Test URLs with user queries
    const testCases = [
      {
        url: 'https://www.bbc.com/news/world',
        userQuery: 'What are the major world events happening right now?'
      },
      {
        url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
        userQuery: 'What are the current applications of AI in healthcare?'
      },
      {
        url: 'https://medium.com/topics/artificial-intelligence',
        userQuery: 'What are the latest trends in AI development?'
      }
    ];
    
    for (const testCase of testCases) {
      console.log(`\nFetching content from: ${testCase.url}`);
      console.log(`User query: "${testCase.userQuery}"`);
      
      // Test fetchUrlContent function with user query
      const result = await fetchUrlContent(testCase.url, { userQuery: testCase.userQuery });
      
      if (result.success) {
        console.log(`✓ Successfully fetched content from: ${testCase.url}`);
        console.log(`Title: ${result.title}`);
        
        // Log information about the results
        console.log(`Text content length: ${result.content.length} characters`);
        console.log(`Markdown content length: ${result.markdown.length} characters`);
        
        if (result.aiSummary) {
          console.log('\nAI Summary (targeting user query):');
          console.log('-'.repeat(50));
          console.log(result.aiSummary);
          console.log('-'.repeat(50));
        } else {
          console.log('\nNo AI summary generated');
        }
        
        // Print a snippet of the markdown
        console.log('\nMarkdown snippet (first 500 chars):');
        console.log('-'.repeat(50));
        console.log(result.markdown.substring(0, 500) + '...');
        console.log('-'.repeat(50));
      } else {
        console.error(`✗ Failed to fetch content from: ${testCase.url}`);
        console.error(`Error: ${result.error}`);
      }
    }
    
    console.log('\n=== Fetch URL Content Test Complete ===');
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Run the test
testFetchUrlContent().catch(console.error); 