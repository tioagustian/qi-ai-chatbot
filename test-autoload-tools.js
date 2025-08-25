/**
 * Test file to verify the auto-loading functionality of the tools registry
 */

async function testAutoLoading() {
  try {
    console.log('Testing auto-loading tools registry...\n');
    
    // Test importing tools registry
    const { 
      getTools, 
      getToolCategories, 
      listAllTools, 
      handleToolCall,
      getRegistryStatus,
      reloadTools
    } = await import('./src/tools/toolsRegistry.js');
    
    console.log('✅ Tools registry imported successfully');
    
    // Test getting registry status
    const status = await getRegistryStatus();
    console.log('✅ Registry status:', status);
    
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
      console.log(`  - ${tool.name} (${tool.category}) from ${tool.file}: ${tool.description}`);
    });
    
    // Test tool call handling
    const testCall = {
      name: 'get_current_time',
      arguments: '{}'
    };
    
    const result = await handleToolCall(testCall);
    console.log('✅ Tool call test result:', result);
    
    // Test reloading tools
    console.log('\n🔄 Testing tool reload...');
    await reloadTools();
    const reloadedStatus = await getRegistryStatus();
    console.log('✅ Reloaded registry status:', reloadedStatus);
    
    console.log('\n🎉 All auto-loading tests passed!');
    
  } catch (error) {
    console.error('❌ Error testing auto-loading:', error);
    process.exit(1);
  }
}

// Run the test
testAutoLoading();
