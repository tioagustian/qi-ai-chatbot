/**
 * Tool: Steam Search Games
 * Description: Search for games on Steam by name or keywords
 * Type: function
 * Category: gaming
 * Dependencies: SteamDB scraping, Puppeteer
 */

import { searchSteamGames } from '../utils/steamDBUtils.js';

/**
 * Search for games on SteamDB by name
 * @param {Object} args - Arguments object containing query
 * @returns {Promise<Object>} - Search results with game information
 */
async function steamSearchGamesTool(args) {
  const { query } = args;
  
  if (!query || typeof query !== 'string') {
    return {
      success: false,
      error: 'Invalid query parameter',
      message: 'Error: query parameter is required and must be a string.'
    };
  }

  try {
    const result = await searchSteamGames(query, { useAI: true });
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Error searching Steam games: ${error.message}`
    };
  }
}

// Tool definition for AI models
const toolDefinition = {
  type: "function",
  function: {
    name: "search_steam_games",
    description: "Search for games on SteamDB by name. Returns a list of matching games with their Steam App IDs and basic information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The name or partial name of the game to search for"
        }
      },
      required: ["query"]
    }
  }
};

export { steamSearchGamesTool, toolDefinition };
