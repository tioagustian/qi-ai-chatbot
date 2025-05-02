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
    
    // Test URLs to fetch content from
    const testUrls = [
      'https://www.bbc.com/news/world',
      'https://en.wikipedia.org/wiki/Artificial_intelligence',
      'https://medium.com/topics/artificial-intelligence'
    ];
    
    for (const url of testUrls) {
      console.log(`\nFetching content from: ${url}`);
      
      // Test fetchUrlContent function
      const result = await fetchUrlContent(url);
      
      if (result.success) {
        console.log(`✓ Successfully fetched content from: ${url}`);
        console.log(`Title: ${result.title}`);
        
        // Log information about the results
        console.log(`Text content length: ${result.content.length} characters`);
        console.log(`Markdown content length: ${result.markdown.length} characters`);
        
        if (result.aiSummary) {
          console.log('\nAI Summary:');
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
        console.error(`✗ Failed to fetch content from: ${url}`);
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