/**
 * Test file to verify the new tool structure
 */

async function testToolsStructure() {
  try {
    console.log('Testing new tools structure...\n');
    
    // Test importing tools registry
    const { 
      getTools, 
      getToolCategories, 
      listAllTools, 
      handleToolCall,
      toolsRegistry 
    } = await import('./src/tools/toolsRegistry.js');
    
    console.log('✅ Tools registry imported successfully');
    
    // Test getting all tools
    const tools = await getTools();
    console.log(`✅ Found ${tools.length} tools`);
    
    // Test getting categories
    const categories = await getToolCategories();
    console.log(`✅ Found ${categories.length} categories:`, categories);
    
    // Test listing all tools
    const allTools = await listAllTools();
    console.log('✅ Tool list:');
    allTools.forEach(tool => {
      console.log(`  - ${tool.name} (${tool.category}): ${tool.description}`);
    });
    
    // Test getting tool info
    const registry = await toolsRegistry();
    const timeToolInfo = registry.get_current_time;
    if (timeToolInfo) {
      console.log('✅ Time tool info retrieved:', timeToolInfo.description);
    }
    
    // Test tool call handling
    const testCall = {
      name: 'get_current_time',
      arguments: '{}'
    };
    
    const result = await handleToolCall(testCall);
    console.log('✅ Tool call test result:', result);
    
    console.log('\n🎉 All tests passed! New tool structure is working correctly.');
    
  } catch (error) {
    console.error('❌ Error testing tools structure:', error);
    process.exit(1);
  }
}

// Run the test
testToolsStructure();
