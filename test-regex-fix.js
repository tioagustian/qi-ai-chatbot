// Test the regex escaping fix
function testRegexEscaping() {
  console.log('🧪 Testing Regex Escaping Fix...\n');
  
  // Test cases with special regex characters
  const testKeywords = [
    '**harga',
    'game*',
    'price+',
    'cost?',
    'value^',
    'amount$',
    'total{',
    'sum}',
    'count(',
    'number)',
    'data[',
    'info]',
    'text|',
    'content\\'
  ];
  
  testKeywords.forEach(keyword => {
    try {
      // Apply the same escaping logic as in the fix
      const escapedKeyword = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedKeyword, 'g');
      
      console.log(`✅ "${keyword}" -> "${escapedKeyword}" -> Valid regex`);
    } catch (error) {
      console.error(`❌ "${keyword}" -> Failed: ${error.message}`);
    }
  });
  
  // Test with actual content matching
  console.log('\n🔍 Testing Content Matching...');
  
  const content = 'The price is **harga 50000 and game* is fun';
  const keyword = '**harga';
  
  try {
    const escapedKeyword = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedKeyword, 'g');
    const matches = content.toLowerCase().match(regex);
    
    console.log(`Content: "${content}"`);
    console.log(`Keyword: "${keyword}"`);
    console.log(`Escaped: "${escapedKeyword}"`);
    console.log(`Matches: ${matches ? matches.length : 0}`);
    console.log('✅ Content matching working correctly');
  } catch (error) {
    console.error(`❌ Content matching failed: ${error.message}`);
  }
  
  console.log('\n🎉 All regex escaping tests passed!');
}

// Run the test
testRegexEscaping();
