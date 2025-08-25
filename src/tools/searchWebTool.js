/**
 * Tool: Web Search
 * Description: Search the web for current information on any topic using Google Custom Search API
 * Type: function
 * Category: search
 * Dependencies: Google Search API, Gemini API for summarization
 */

import { searchWeb } from '../utils/searchWebUtils.js';
import { createToolError, createToolSuccess } from '../utils/toolUtils.js';

/**
 * Search the web for information
 * @param {Object} args - Arguments object containing the query
 * @returns {Promise<Object>} - Search results with AI summary
 */
async function searchWebTool(args) {
  const { query } = args;
  
  if (!query || typeof query !== 'string') {
    return createToolError('Query parameter is required and must be a string', 'INVALID_PARAMETER');
  }

  try {
    const result = await searchWeb(query);
    return result;
  } catch (error) {
    return createToolError(`Error performing web search: ${error.message}`, 'SEARCH_ERROR');
  }
}

// Tool definition for AI models
const toolDefinition = {
  type: "function",
  function: {
    name: "search_web",
    description: "Search the web for current information on any topic. Returns comprehensive results with AI-generated summaries from multiple sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up information about"
        }
      },
      required: ["query"]
    }
  }
};

export { searchWebTool, toolDefinition };
