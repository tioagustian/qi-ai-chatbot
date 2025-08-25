/**
 * Tool: Steam Deals
 * Description: Get the latest deals, top sellers, and new releases from the Steam store
 * Type: function
 * Category: gaming
 * Dependencies: SteamDB scraping, Puppeteer
 */

import { getSteamDeals } from '../utils/steamDBUtils.js';

/**
 * Get the latest Steam deals and top sellers
 * @param {Object} args - Arguments object (empty for this tool)
 * @returns {Promise<Object>} - Current deals and top sellers information
 */
async function steamDealsTool(args = {}) {
  try {
    const result = await getSteamDeals({ useAI: true });
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Error fetching Steam deals: ${error.message}`
    };
  }
}

// Tool definition for AI models
const toolDefinition = {
  type: "function",
  function: {
    name: "get_steam_deals",
    description: "Get the latest deals, top sellers, and new releases from the Steam store. Provides current pricing and promotional information.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
};

export { steamDealsTool, toolDefinition };
