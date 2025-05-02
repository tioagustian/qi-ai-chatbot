import axios from 'axios';
import { logger } from '../utils/logger.js';
import * as cheerio from 'cheerio';
import { requestGeminiChat } from '../services/aiRequest.js';

/**
 * Fetch game information from SteamDB
 * @param {number|string} appId - The Steam App ID to look up
 * @param {Object} options - Additional options for the request
 * @returns {Promise<Object>} - Information about the game
 */
async function getSteamGameData(appId, options = {}) {
  try {
    logger.info(`Fetching SteamDB game data for app ID: ${appId}`);
    
    // Validate app ID
    const steamAppId = parseInt(appId);
    if (isNaN(steamAppId)) {
      return {
        success: false,
        error: 'Invalid Steam App ID',
        message: `Invalid Steam App ID: ${appId}. Please provide a valid numeric App ID.`
      };
    }
    
    // Setup browser-like headers to avoid being blocked
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://steamdb.info/',
      'Cache-Control': 'no-cache'
    };
    
    // SteamDB URL for the game
    const steamDBUrl = `https://steamdb.info/app/${steamAppId}/`;
    
    // Use puppeteer for a more reliable scraping approach (SteamDB has anti-scraping measures)
    const puppeteer = await import('puppeteer');
    
    logger.info('Launching headless browser to scrape SteamDB page');
    
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set extra headers
    await page.setExtraHTTPHeaders(headers);
    
    try {
      // Navigate to SteamDB page with extended timeout
      await page.goto(steamDBUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Check if we hit any error (like a rate limit or missing page)
      const pageContent = await page.content();
      if (pageContent.includes('Rate limited') || pageContent.includes('429 Too Many Requests')) {
        await browser.close();
        return {
          success: false,
          error: 'Rate limited by SteamDB',
          message: 'SteamDB rate limited the request. Please try again later.'
        };
      }
      
      if (pageContent.includes('App not found') || pageContent.includes('404 Not Found')) {
        await browser.close();
        return {
          success: false,
          error: 'App not found',
          message: `Steam App ID ${steamAppId} not found on SteamDB.`
        };
      }
      
      // Wait for main content to load
      await page.waitForSelector('.app-row, .app-tabs, .app-meta', { timeout: 10000 }).catch(() => {});
      
      // Extract game info
      const gameData = await page.evaluate(() => {
        function extractText(selector) {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : null;
        }
        
        // Basic game info
        const title = extractText('.app-title') || extractText('h1') || '';
        const currentPlayers = extractText('.app-stat .header-number');
        const historicalPeakPlayers = extractText('.app-stat:nth-child(2) .header-number');
        
        // Price info
        const price = extractText('.app-price') || extractText('.header-prices');
        
        // Collect all metadata from table
        const metadata = {};
        const rows = document.querySelectorAll('table.table-app tr');
        rows.forEach(row => {
          const key = row.querySelector('td:first-child')?.textContent.trim();
          const value = row.querySelector('td:nth-child(2)')?.textContent.trim();
          if (key && value) {
            metadata[key] = value;
          }
        });
        
        // Get app tags
        const tags = [];
        document.querySelectorAll('.app-tag').forEach(tag => {
          tags.push(tag.textContent.trim());
        });
        
        // Get app platforms
        const platforms = [];
        document.querySelectorAll('.app-os-support span').forEach(platform => {
          platforms.push(platform.getAttribute('title') || platform.textContent.trim());
        });
        
        // Get DLC information if any
        const dlcData = [];
        document.querySelectorAll('.apppage_dlc .app-row').forEach(dlc => {
          const dlcTitle = dlc.querySelector('.app-name')?.textContent.trim();
          const dlcPrice = dlc.querySelector('.app-price')?.textContent.trim();
          if (dlcTitle) {
            dlcData.push({
              title: dlcTitle,
              price: dlcPrice || 'Unknown'
            });
          }
        });
        
        // Get update history
        const updates = [];
        document.querySelectorAll('.app-history-day').forEach(day => {
          const date = day.querySelector('h2')?.textContent.trim();
          const events = [];
          
          day.querySelectorAll('.app-history-event').forEach(event => {
            const time = event.querySelector('.timeago')?.textContent.trim();
            const description = event.querySelector('.app-history-event-description')?.textContent.trim();
            
            if (time && description) {
              events.push({
                time,
                description
              });
            }
          });
          
          if (date && events.length > 0) {
            updates.push({
              date,
              events
            });
          }
        });
        
        return {
          title,
          currentPlayers,
          historicalPeakPlayers,
          price,
          metadata,
          tags,
          platforms,
          dlcData,
          updates: updates.slice(0, 5) // Limit to most recent 5 update days
        };
      });
      
      // Get a screenshot of the page
      // This could be useful for visual verification but we'll comment it out for now
      // await page.screenshot({ path: `steam_${steamAppId}.png` });
      
      // Close browser
      await browser.close();
      
      logger.success(`Successfully fetched SteamDB data for game: ${gameData.title}`);
      
      // Check if AI enhancement is requested (default to true unless explicitly disabled)
      const useAI = options.useAI !== false && process.env.GEMINI_API_KEY;
      
      let formattedMessage;
      if (useAI) {
        formattedMessage = await enhanceWithAI(gameData, steamAppId);
      } else {
        formattedMessage = formatGameInfoMessage(gameData, steamAppId);
      }
      
      return {
        success: true,
        appId: steamAppId,
        url: steamDBUrl,
        gameInfo: gameData,
        message: formattedMessage
      };
      
    } catch (pageError) {
      await browser.close();
      logger.error(`Error scraping SteamDB page: ${pageError.message}`);
      
      return {
        success: false,
        error: `Error scraping SteamDB page: ${pageError.message}`,
        message: `Failed to get game data from SteamDB: ${pageError.message}`
      };
    }
    
  } catch (error) {
    logger.error(`Error fetching SteamDB game data: ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      message: `Failed to get game data from SteamDB: ${error.message}`
    };
  }
}

/**
 * Search for games on SteamDB by name
 * @param {string} gameName - The name of the game to search for
 * @param {Object} options - Additional options for the request
 * @returns {Promise<Object>} - Search results
 */
async function searchSteamGames(gameName, options = {}) {
  try {
    logger.info(`Searching for games on SteamDB with query: ${gameName}`);
    
    if (!gameName || gameName.trim().length < 2) {
      return {
        success: false,
        error: 'Invalid search query',
        message: 'Search query must be at least 2 characters long.'
      };
    }
    
    // Setup browser-like headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://steamdb.info/',
      'Cache-Control': 'no-cache'
    };
    
    // SteamDB search URL
    const searchUrl = `https://steamdb.info/search/?a=app&q=${encodeURIComponent(gameName)}`;
    
    // Use puppeteer for a more reliable scraping approach
    const puppeteer = await import('puppeteer');
    
    logger.info('Launching headless browser to search SteamDB');
    
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set extra headers
    await page.setExtraHTTPHeaders(headers);
    
    try {
      // Navigate to search page
      await page.goto(searchUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Check if we hit a rate limit
      const pageContent = await page.content();
      if (pageContent.includes('Rate limited') || pageContent.includes('429 Too Many Requests')) {
        await browser.close();
        return {
          success: false,
          error: 'Rate limited by SteamDB',
          message: 'SteamDB rate limited the request. Please try again later.'
        };
      }
      
      // Wait for search results to load
      await page.waitForSelector('table.table-apps', { timeout: 10000 }).catch(() => {});
      
      // Extract search results
      const searchResults = await page.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('table.table-apps tbody tr');
        
        rows.forEach(row => {
          const appIdElement = row.querySelector('td:first-child');
          const nameElement = row.querySelector('td:nth-child(2) a');
          const typeElement = row.querySelector('td:nth-child(3)');
          const lastUpdateElement = row.querySelector('td:nth-child(4) span');
          
          if (appIdElement && nameElement) {
            const appId = appIdElement.textContent.trim();
            const name = nameElement.textContent.trim();
            const type = typeElement ? typeElement.textContent.trim() : 'Unknown';
            const lastUpdate = lastUpdateElement ? lastUpdateElement.getAttribute('title') || lastUpdateElement.textContent.trim() : 'Unknown';
            const url = nameElement.getAttribute('href') || '';
            
            results.push({
              appId,
              name,
              type,
              lastUpdate,
              url
            });
          }
        });
        
        return results;
      });
      
      // Close browser
      await browser.close();
      
      logger.success(`Found ${searchResults.length} search results for query: ${gameName}`);
      
      if (searchResults.length === 0) {
        return {
          success: true,
          results: [],
          message: `No games found matching "${gameName}" on SteamDB.`
        };
      }
      
      // Check if AI enhancement is requested (default to true unless explicitly disabled)
      const useAI = options.useAI !== false && process.env.GEMINI_API_KEY;
      
      let formattedMessage;
      if (useAI) {
        formattedMessage = await enhanceSearchResultsWithAI(searchResults, gameName);
      } else {
        formattedMessage = formatSearchResultsMessage(searchResults, gameName);
      }
      
      return {
        success: true,
        results: searchResults,
        url: searchUrl,
        message: formattedMessage
      };
      
    } catch (pageError) {
      await browser.close();
      logger.error(`Error searching SteamDB: ${pageError.message}`);
      
      return {
        success: false,
        error: `Error searching SteamDB: ${pageError.message}`,
        message: `Failed to search for games on SteamDB: ${pageError.message}`
      };
    }
    
  } catch (error) {
    logger.error(`Error searching Steam games: ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      message: `Failed to search for games on SteamDB: ${error.message}`
    };
  }
}

/**
 * Format game information for display
 * @param {Object} gameData - Game information from SteamDB
 * @param {number} appId - Steam App ID
 * @returns {string} - Formatted message
 */
function formatGameInfoMessage(gameData, appId) {
  if (!gameData || !gameData.title) {
    return `No information found for Steam App ID: ${appId}`;
  }
  
  let message = `# ${gameData.title} (App ID: ${appId})\n\n`;
  
  // Add basic information
  if (gameData.currentPlayers) {
    message += `**Current Players:** ${gameData.currentPlayers}\n`;
  }
  
  if (gameData.historicalPeakPlayers) {
    message += `**Historical Peak Players:** ${gameData.historicalPeakPlayers}\n`;
  }
  
  if (gameData.price) {
    message += `**Price:** ${gameData.price}\n`;
  }
  
  message += '\n';
  
  // Add platforms
  if (gameData.platforms && gameData.platforms.length > 0) {
    message += `**Platforms:** ${gameData.platforms.join(', ')}\n\n`;
  }
  
  // Add metadata with key information
  if (gameData.metadata) {
    message += '## Game Information\n\n';
    
    const importantKeys = [
      'Developer', 'Publisher', 'Release Date', 'Type', 
      'App State', 'Metacritic Score', 'User Score'
    ];
    
    importantKeys.forEach(key => {
      if (gameData.metadata[key]) {
        message += `**${key}:** ${gameData.metadata[key]}\n`;
      }
    });
    
    message += '\n';
  }
  
  // Add tags
  if (gameData.tags && gameData.tags.length > 0) {
    message += `**Tags:** ${gameData.tags.join(', ')}\n\n`;
  }
  
  // Add DLC information
  if (gameData.dlcData && gameData.dlcData.length > 0) {
    message += `## DLC (${gameData.dlcData.length})\n\n`;
    
    // Only show first 5 DLCs if there are too many
    const dlcToShow = gameData.dlcData.slice(0, 5);
    dlcToShow.forEach(dlc => {
      message += `- **${dlc.title}** ${dlc.price ? `- ${dlc.price}` : ''}\n`;
    });
    
    if (gameData.dlcData.length > 5) {
      message += `- *(and ${gameData.dlcData.length - 5} more...)*\n`;
    }
    
    message += '\n';
  }
  
  // Add recent updates
  if (gameData.updates && gameData.updates.length > 0) {
    message += '## Recent Updates\n\n';
    
    // Only show first 3 update days
    const updatesToShow = gameData.updates.slice(0, 3);
    updatesToShow.forEach(update => {
      message += `**${update.date}**\n`;
      
      // Show only first 3 events per day
      const eventsToShow = update.events.slice(0, 3);
      eventsToShow.forEach(event => {
        message += `- ${event.time}: ${event.description}\n`;
      });
      
      if (update.events.length > 3) {
        message += `- *(and ${update.events.length - 3} more events...)*\n`;
      }
      
      message += '\n';
    });
  }
  
  message += `\nData from [SteamDB](https://steamdb.info/app/${appId}/)`;
  
  return message;
}

/**
 * Format search results for display
 * @param {Array} results - Search results
 * @param {string} query - Original search query
 * @returns {string} - Formatted message
 */
function formatSearchResultsMessage(results, query) {
  if (!results || results.length === 0) {
    return `No games found matching "${query}" on SteamDB.`;
  }
  
  let message = `# Search Results for "${query}"\n\n`;
  
  // Display the search results in a nice format
  results.slice(0, 10).forEach((game, index) => {
    message += `${index + 1}. **[${game.name}](https://steamdb.info${game.url})** (App ID: ${game.appId})\n`;
    message += `   **Type:** ${game.type} | **Last Update:** ${game.lastUpdate}\n\n`;
  });
  
  if (results.length > 10) {
    message += `\n*...and ${results.length - 10} more results*\n`;
  }
  
  message += `\nUse the \`get_steam_game_data\` function with the App ID to get detailed information about a specific game.`;
  
  return message;
}

/**
 * Get latest gaming deals and top sellers from Steam
 * @returns {Promise<Object>} - Latest deals information
 */
async function getSteamDeals(options = {}) {
  try {
    logger.info('Fetching latest Steam deals and top sellers');
    
    // Setup browser-like headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    };
    
    // Use puppeteer to scrape Steam store page
    const puppeteer = await import('puppeteer');
    
    logger.info('Launching headless browser to fetch Steam deals');
    
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set extra headers
    await page.setExtraHTTPHeaders(headers);
    
    try {
      // Navigate to Steam store page
      await page.goto('https://store.steampowered.com/', { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Wait for content to load
      await page.waitForSelector('#tab_topsellers_content, #tab_specials_content', { timeout: 10000 }).catch(() => {});
      
      // Extract top sellers and specials
      const dealsData = await page.evaluate(() => {
        function extractItems(selector) {
          const items = [];
          const elements = document.querySelectorAll(selector);
          
          elements.forEach(element => {
            // Extract game info
            const title = element.querySelector('.tab_item_name')?.textContent.trim();
            const priceElement = element.querySelector('.discount_final_price');
            const price = priceElement ? priceElement.textContent.trim() : null;
            
            const discountElement = element.querySelector('.discount_pct');
            const discount = discountElement ? discountElement.textContent.trim() : null;
            
            const originalPriceElement = element.querySelector('.discount_original_price');
            const originalPrice = originalPriceElement ? originalPriceElement.textContent.trim() : null;
            
            const url = element.getAttribute('href');
            
            // Extract app ID from URL if possible
            let appId = null;
            if (url) {
              const appIdMatch = url.match(/\/app\/(\d+)/);
              if (appIdMatch && appIdMatch[1]) {
                appId = appIdMatch[1];
              }
            }
            
            if (title) {
              items.push({
                title,
                price,
                discount,
                originalPrice,
                appId,
                url
              });
            }
          });
          
          return items;
        }
        
        return {
          topSellers: extractItems('#tab_topsellers_content .tab_item'),
          specials: extractItems('#tab_specials_content .tab_item'),
          newReleases: extractItems('#tab_newreleases_content .tab_item')
        };
      });
      
      // Close browser
      await browser.close();
      
      logger.success(`Successfully fetched Steam deals: ${dealsData.topSellers.length} top sellers, ${dealsData.specials.length} specials`);
      
      // Check if AI enhancement is requested (default to true unless explicitly disabled)
      const useAI = options.useAI !== false && process.env.GEMINI_API_KEY;
      
      let formattedMessage;
      if (useAI) {
        formattedMessage = await enhanceDealsWithAI(dealsData);
      } else {
        formattedMessage = formatSteamDealsMessage(dealsData);
      }
      
      return {
        success: true,
        topSellers: dealsData.topSellers,
        specials: dealsData.specials,
        newReleases: dealsData.newReleases,
        message: formattedMessage
      };
      
    } catch (pageError) {
      await browser.close();
      logger.error(`Error scraping Steam store: ${pageError.message}`);
      
      return {
        success: false,
        error: `Error scraping Steam store: ${pageError.message}`,
        message: `Failed to get deals from Steam: ${pageError.message}`
      };
    }
    
  } catch (error) {
    logger.error(`Error fetching Steam deals: ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      message: `Failed to get deals from Steam: ${error.message}`
    };
  }
}

/**
 * Format Steam deals for display
 * @param {Object} dealsData - Deals data from Steam
 * @returns {string} - Formatted message
 */
function formatSteamDealsMessage(dealsData) {
  if (!dealsData) {
    return 'No deals information available from Steam.';
  }
  
  let message = '# Current Steam Deals and Top Sellers\n\n';
  
  // Add specials/sales
  if (dealsData.specials && dealsData.specials.length > 0) {
    message += '## Current Specials\n\n';
    
    dealsData.specials.slice(0, 8).forEach((game, index) => {
      message += `${index + 1}. **${game.title}**`;
      if (game.discount) {
        message += ` - **${game.discount}** off`;
      }
      if (game.price) {
        message += ` - Now ${game.price}`;
        if (game.originalPrice) {
          message += ` (was ${game.originalPrice})`;
        }
      }
      message += '\n';
    });
    
    if (dealsData.specials.length > 8) {
      message += `\n*...and ${dealsData.specials.length - 8} more specials*\n`;
    }
    
    message += '\n';
  }
  
  // Add top sellers
  if (dealsData.topSellers && dealsData.topSellers.length > 0) {
    message += '## Top Sellers\n\n';
    
    dealsData.topSellers.slice(0, 8).forEach((game, index) => {
      message += `${index + 1}. **${game.title}**`;
      if (game.price) {
        message += ` - ${game.price}`;
      }
      message += '\n';
    });
    
    if (dealsData.topSellers.length > 8) {
      message += `\n*...and ${dealsData.topSellers.length - 8} more top sellers*\n`;
    }
    
    message += '\n';
  }
  
  // Add new releases
  if (dealsData.newReleases && dealsData.newReleases.length > 0) {
    message += '## New Releases\n\n';
    
    dealsData.newReleases.slice(0, 8).forEach((game, index) => {
      message += `${index + 1}. **${game.title}**`;
      if (game.price) {
        message += ` - ${game.price}`;
      }
      message += '\n';
    });
    
    if (dealsData.newReleases.length > 8) {
      message += `\n*...and ${dealsData.newReleases.length - 8} more new releases*\n`;
    }
  }
  
  message += '\nData from [Steam Store](https://store.steampowered.com/)';
  
  return message;
}

/**
 * Enhance the SteamDB results with AI generated formatting and insights
 * @param {Object} gameData - Raw game data from SteamDB
 * @param {number} appId - Steam App ID
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - AI enhanced formatted message
 */
async function enhanceWithAI(gameData, appId, options = {}) {
  try {
    logger.info(`Enhancing game data with AI for app ID: ${appId}`);
    
    if (!gameData || !gameData.title) {
      return formatGameInfoMessage(gameData, appId);
    }
    
    // Prepare the raw data as structured JSON for the AI
    const gameDataJson = JSON.stringify(gameData, null, 2);
    
    // Prepare prompt for Gemini
    const prompt = `You are a gaming expert who provides detailed, well-formatted, and insightful information about video games.
I will provide you with raw data about a game from SteamDB in JSON format, and I want you to transform it into a well-structured, informative, and engaging markdown response.

Here's the game data:
${gameDataJson}

Steam App ID: ${appId}
SteamDB URL: https://steamdb.info/app/${appId}/

Please create a comprehensive markdown response that:
1. Has a clear title structure with the game name and app ID
2. Highlights key information like player count, price, platforms, and release info
3. Organizes metadata in a clean, readable format
4. Includes tags, DLC information, and recent updates when available
5. Adds your expert gaming knowledge or context about this title if relevant
6. Is visually well-formatted with appropriate markdown (headers, bold, lists, etc.)
7. Credits SteamDB as the data source

Keep your response concise but comprehensive.`;

    // Get API key from environment
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
      logger.warning('Gemini API key not found, falling back to standard formatting');
      return formatGameInfoMessage(gameData, appId);
    }
    
    // Request AI enhancement using Gemini
    const response = await requestGeminiChat(
      'gemini-2.0-flash',
      geminiApiKey,
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: 2000
      }
    );
    
    // Extract the AI generated content
    if (response && response.choices && response.choices[0] && 
        response.choices[0].message && response.choices[0].message.content) {
      
      const enhancedContent = response.choices[0].message.content;
      logger.success(`Successfully enhanced game data with AI for: ${gameData.title}`);
      
      // Make sure the SteamDB credit is present
      if (!enhancedContent.includes('SteamDB')) {
        return enhancedContent + `\n\nData from [SteamDB](https://steamdb.info/app/${appId}/)`;
      }
      
      return enhancedContent;
    } else {
      // Fall back to standard formatting
      logger.warning('AI enhancement failed, falling back to standard formatting');
      return formatGameInfoMessage(gameData, appId);
    }
  } catch (error) {
    logger.error(`Error enhancing game data with AI: ${error.message}`);
    // Fall back to standard formatting
    return formatGameInfoMessage(gameData, appId);
  }
}

/**
 * Similarly enhance search results with AI formatting
 * @param {Array} results - Search results
 * @param {string} query - Original search query
 * @returns {Promise<string>} - AI enhanced formatted message
 */
async function enhanceSearchResultsWithAI(results, query) {
  try {
    logger.info(`Enhancing search results with AI for query: ${query}`);
    
    if (!results || results.length === 0) {
      return `No games found matching "${query}" on SteamDB.`;
    }
    
    // Prepare the raw data as structured JSON for the AI
    const resultsJson = JSON.stringify(results.slice(0, 20), null, 2);
    
    // Prepare prompt for Gemini
    const prompt = `You are a gaming expert who provides well-formatted and insightful information about video games.
I will provide you with raw search results from SteamDB in JSON format, and I want you to transform it into a well-structured, informative markdown response.

Search Query: "${query}"
Search Results:
${resultsJson}

Please create a comprehensive markdown response that:
1. Has a clear title showing these are search results for the query
2. Lists the games in a well-formatted way with their App IDs, types, and update information
3. Groups similar games if possible (e.g. base game and its DLCs)
4. Highlights particularly popular or notable games if you can identify them
5. Is visually well-formatted with appropriate markdown (headers, bold, lists, etc.)
6. Includes a note that users can use the \`get_steam_game_data\` function with an App ID for more details
7. Credits SteamDB as the data source

Keep your response concise but comprehensive, showing at most 15 games with the most relevant ones first.`;

    // Get API key from environment
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
      logger.warning('Gemini API key not found, falling back to standard formatting');
      return formatSearchResultsMessage(results, query);
    }
    
    // Request AI enhancement using Gemini
    const response = await requestGeminiChat(
      'gemini-2.0-flash',
      geminiApiKey,
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: 2000
      }
    );
    
    // Extract the AI generated content
    if (response && response.choices && response.choices[0] && 
        response.choices[0].message && response.choices[0].message.content) {
      
      const enhancedContent = response.choices[0].message.content;
      logger.success(`Successfully enhanced search results with AI for query: ${query}`);
      
      // Make sure the function reference is included
      if (!enhancedContent.includes('get_steam_game_data')) {
        return enhancedContent + `\n\nUse the \`get_steam_game_data\` function with the App ID to get detailed information about a specific game.`;
      }
      
      return enhancedContent;
    } else {
      // Fall back to standard formatting
      logger.warning('AI enhancement failed, falling back to standard formatting');
      return formatSearchResultsMessage(results, query);
    }
  } catch (error) {
    logger.error(`Error enhancing search results with AI: ${error.message}`);
    // Fall back to standard formatting
    return formatSearchResultsMessage(results, query);
  }
}

/**
 * Enhance Steam deals with AI formatting
 * @param {Object} dealsData - Deals data from Steam
 * @returns {Promise<string>} - AI enhanced formatted message
 */
async function enhanceDealsWithAI(dealsData) {
  try {
    logger.info(`Enhancing Steam deals data with AI`);
    
    if (!dealsData) {
      return 'No deals information available from Steam.';
    }
    
    // Prepare a reduced version of the data (we don't need all deals)
    const trimmedData = {
      topSellers: dealsData.topSellers?.slice(0, 12) || [],
      specials: dealsData.specials?.slice(0, 12) || [],
      newReleases: dealsData.newReleases?.slice(0, 12) || []
    };
    
    // Prepare the raw data as structured JSON for the AI
    const dealsJson = JSON.stringify(trimmedData, null, 2);
    
    // Prepare prompt for Gemini
    const prompt = `You are a gaming expert who provides well-formatted information about current video game deals and trends.
I will provide you with raw data about current Steam deals in JSON format, and I want you to transform it into a well-structured, informative markdown response.

Current Steam Store Data:
${dealsJson}

Please create a comprehensive markdown response that:
1. Has a clear title showing this is current Steam deals data
2. Organizes the deals into clear sections (Specials, Top Sellers, New Releases)
3. Highlights particularly impressive discounts or notable titles
4. Formats game prices and discounts clearly
5. Groups similar games together when relevant (e.g., games from the same franchise or developer)
6. Is visually well-formatted with appropriate markdown (headers, bold, lists, etc.)
7. Credits the Steam Store as the data source

Keep your response concise but comprehensive, showing the most interesting and valuable deals first.`;

    // Get API key from environment
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
      logger.warning('Gemini API key not found, falling back to standard formatting');
      return formatSteamDealsMessage(dealsData);
    }
    
    // Request AI enhancement using Gemini
    const response = await requestGeminiChat(
      'gemini-2.0-flash',
      geminiApiKey,
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: 2000
      }
    );
    
    // Extract the AI generated content
    if (response && response.choices && response.choices[0] && 
        response.choices[0].message && response.choices[0].message.content) {
      
      const enhancedContent = response.choices[0].message.content;
      logger.success(`Successfully enhanced Steam deals data with AI`);
      
      // Make sure the Steam Store credit is present
      if (!enhancedContent.toLowerCase().includes('steam store')) {
        return enhancedContent + `\n\nData from [Steam Store](https://store.steampowered.com/)`;
      }
      
      return enhancedContent;
    } else {
      // Fall back to standard formatting
      logger.warning('AI enhancement failed, falling back to standard formatting');
      return formatSteamDealsMessage(dealsData);
    }
  } catch (error) {
    logger.error(`Error enhancing deals data with AI: ${error.message}`);
    // Fall back to standard formatting
    return formatSteamDealsMessage(dealsData);
  }
}

export {
  getSteamGameData,
  searchSteamGames,
  getSteamDeals,
  enhanceWithAI,
  enhanceSearchResultsWithAI,
  enhanceDealsWithAI
}; 