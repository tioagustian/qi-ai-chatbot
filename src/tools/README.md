# Tools System

This directory contains the organized tool system for the AI chatbot. Tools are now separated into individual files with proper descriptions and organized through a central registry that **auto-loads** all tool files.

## Structure

### Individual Tool Files

Each tool is now in its own file with the following structure:

```
src/tools/
├── getCurrentTime.js          # Get current time and date
├── searchWebTool.js           # Web search functionality
├── fetchUrlContentTool.js     # URL content extraction
├── steamGameDataTool.js       # Steam game data retrieval
├── steamSearchGamesTool.js    # Steam game search
├── steamDealsTool.js          # Steam deals and top sellers
├── toolsRegistry.js           # Central tool registry
└── README.md                  # This documentation
```

### Legacy Files (Kept for Backward Compatibility)

```
src/tools/
├── searchWeb.js               # Original web search implementation
├── fetchUrlContent.js         # Original URL content extraction
└── steamDBTools.js            # Original Steam tools implementation
```

## Tool File Structure

Each tool file follows this pattern:

```javascript
/**
 * Tool: [Tool Name]
 * Description: [Tool description]
 * Type: function
 * Category: [category]
 * Dependencies: [dependencies]
 */

import { [original function] } from './[original file].js';
import { createToolError, createToolSuccess } from '../utils/toolUtils.js';

/**
 * [Function description]
 * @param {Object} args - Arguments object
 * @returns {Promise<Object>} - Tool result
 */
async function [toolName]Tool(args) {
  // Parameter validation
  // Tool execution
  // Error handling
}

// Tool definition for AI models
const toolDefinition = {
  type: "function",
  function: {
    name: "[tool_name]",
    description: "[detailed description]",
    parameters: {
      type: "object",
      properties: {
        // Parameter definitions
      },
      required: ["required_params"]
    }
  }
};

export { [toolName]Tool, toolDefinition };
```

## Tools Registry

The `toolsRegistry.js` file provides a centralized way to manage all tools with **automatic loading**:

### Auto-Loading Features

- **Automatic Discovery**: Scans the tools directory for files ending with `Tool.js`
- **Dynamic Loading**: Loads tools at runtime without manual imports
- **Category Detection**: Automatically categorizes tools based on filename patterns
- **Error Handling**: Gracefully handles missing or malformed tool files
- **Hot Reload**: Supports reloading tools during development

### Functions

- `getTools()` - Returns all tool definitions for AI models (async)
- `getToolsByCategory(category)` - Returns tools filtered by category (async)
- `getToolCategories()` - Returns available categories (async)
- `handleToolCall(functionCall)` - Executes tool calls (async)
- `getToolInfo(toolName)` - Gets information about a specific tool (async)
- `listAllTools()` - Lists all tools with descriptions (async)
- `reloadTools()` - Reloads all tools (useful for development)
- `getRegistryStatus()` - Gets registry status information (async)
- `getToolsRegistry()` - Gets the raw tools registry object (async)

### Categories

- **utility**: Basic utility functions (get_current_time)
- **search**: Search-related tools (search_web)
- **content-extraction**: Content extraction tools (fetch_url_content)
- **gaming**: Gaming-related tools (Steam tools)

## Adding New Tools

To add a new tool:

1. Create a new file in `src/tools/` following the naming convention `[toolName]Tool.js`
2. Implement the tool function with proper error handling
3. Define the tool definition object
4. **That's it!** The tool will be automatically loaded by the registry

The registry automatically:
- Discovers files ending with `Tool.js`
- Loads the tool function and definition
- Categorizes the tool based on filename patterns
- Makes it available for use

### Example

```javascript
// src/tools/exampleTool.js
import { createToolError } from '../utils/toolUtils.js';

async function exampleTool(args) {
  const { parameter } = args;
  
  if (!parameter) {
    return createToolError('Parameter is required', 'INVALID_PARAMETER');
  }
  
  try {
    // Tool logic here
    return { success: true, data: result };
  } catch (error) {
    return createToolError(`Error: ${error.message}`, 'TOOL_ERROR');
  }
}

const toolDefinition = {
  type: "function",
  function: {
    name: "example_tool",
    description: "Example tool description",
    parameters: {
      type: "object",
      properties: {
        parameter: {
          type: "string",
          description: "Example parameter"
        }
      },
      required: ["parameter"]
    }
  }
};

export { exampleTool, toolDefinition };
```

**No manual registry updates needed!** The tool will be automatically loaded and categorized based on its filename.

## Utility Functions

The `src/utils/toolUtils.js` file provides common utility functions:

- `validateToolParameters(args, schema)` - Validate tool parameters
- `formatToolResult(result)` - Format tool results consistently
- `createToolError(message, code)` - Create standardized error responses
- `createToolSuccess(data, message)` - Create standardized success responses
- `sanitizeUrl(url)` - Sanitize URLs for security
- `truncateText(text, maxLength)` - Truncate text to maximum length
- `generateToolCallId()` - Generate unique tool call identifiers

## Usage in AI Service

The AI service now uses the tools registry:

```javascript
import { getTools as getToolsFromRegistry, handleToolCall as handleToolCallFromRegistry } from '../tools/toolsRegistry.js';

async function getTools() {
  return await getToolsFromRegistry();
}

async function handleToolCall(functionCall) {
  // Handle legacy tools first
  switch (functionCall.name) {
    case 'legacy_tool':
      // Handle legacy tool
      break;
    default:
      // Use registry for all other tools
      return await handleToolCallFromRegistry(functionCall);
  }
}
```

## Benefits

1. **Modularity**: Each tool is in its own file
2. **Maintainability**: Easy to find and modify specific tools
3. **Extensibility**: Simple to add new tools (just create a file!)
4. **Auto-Loading**: No manual imports or registry updates needed
5. **Consistency**: Standardized error handling and responses
6. **Documentation**: Each tool has clear documentation
7. **Security**: Built-in URL sanitization and parameter validation
8. **Organization**: Tools are categorized and managed centrally
9. **Hot Reload**: Support for reloading tools during development
10. **Error Resilience**: Graceful handling of missing or malformed tools
