/**
 * Tool: Fetch URL Content
 * Description: Fetch and extract the main content from a URL using headless browser
 * Type: function
 * Category: content-extraction
 * Dependencies: Puppeteer, Turndown (HTML to Markdown)
 */

import fetchUrlContent from '../utils/fetchUrlContentUtils.js';
import { createToolError, sanitizeUrl } from '../utils/toolUtils.js';

/**
 * Fetch and extract content from a URL
 * @param {Object} args - Arguments object containing url and user_query
 * @returns {Promise<Object>} - Extracted content with AI summary
 */
async function fetchUrlContentTool(args) {
  const { url, user_query } = args;
  
  if (!url || typeof url !== 'string') {
    return createToolError('URL parameter is required and must be a string', 'INVALID_PARAMETER');
  }

  // Sanitize the URL for security
  const sanitizedUrl = sanitizeUrl(url);
  if (!sanitizedUrl) {
    return createToolError('Invalid or unsafe URL provided', 'INVALID_URL');
  }

  try {
    const result = await fetchUrlContent(sanitizedUrl, { userQuery: user_query });
    return result;
  } catch (error) {
    return createToolError(`Error fetching URL content: ${error.message}`, 'FETCH_ERROR');
  }
}

// Tool definition for AI models
const toolDefinition = {
  type: "function",
  function: {
    name: "fetch_url_content",
    description: "Fetch and extract the main content from a URL. Uses headless browser to render JavaScript-heavy pages and provides AI-generated summaries.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch content from (must be a valid HTTP or HTTPS URL)"
        },
        user_query: {
          type: "string",
          description: "The user's original question or request that led to fetching this URL (optional, helps make the summary more relevant)"
        }
      },
      required: ["url"]
    }
  }
};

export { fetchUrlContentTool, toolDefinition };
