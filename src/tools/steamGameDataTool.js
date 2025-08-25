/**
 * Tool: Steam Game Data
 * Description: Get detailed information about a specific game from Steam
 * Type: function
 * Category: gaming
 * Dependencies: SteamDB scraping, Puppeteer
 */

import { getSteamGameData } from '../utils/steamDBUtils.js';

/**
 * Get detailed information about a Steam game
 * @param {Object} args - Arguments object containing app_id
 * @returns {Promise<Object>} - Detailed game information
 */
async function steamGameDataTool(args) {
  const { app_id } = args;
  
  if (!app_id || typeof app_id !== 'string') {
    return {
      success: false,
      error: 'Invalid app_id parameter',
      message: 'Error: app_id parameter is required and must be a string.'
    };
  }

  try {
    const result = await getSteamGameData(app_id, { useAI: true });
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Error fetching Steam game data: ${error.message}`
    };
  }
}

// Tool definition for AI models
const toolDefinition = {
  type: "function",
  function: {
    name: "get_steam_game_data",
    description: "Get detailed information about a specific game from SteamDB including player count, price, metadata, and update history. Provides comprehensive game analytics and market data.",
    parameters: {
      type: "object",
      properties: {
        app_id: {
          type: "string",
          description: "The Steam App ID of the game to look up (a numeric identifier)"
        }
      },
      required: ["app_id"]
    }
  }
};

export { steamGameDataTool, toolDefinition };
