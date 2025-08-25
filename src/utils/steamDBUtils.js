import axios from 'axios';
import { logger } from './logger.js';
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
    
    // Configure advanced browser settings to better mimic a real user
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled', // Hide automation
        '--disable-blink-features',
        '--window-size=1920,1080', // Use a common resolution
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', // More realistic UA
        '--lang=en-US,en' // Set language
      ]
    });
    
    const page = await browser.newPage();
    
    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/',
      'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    });
    
    // Modify the WebDriver flags to prevent detection
    await page.evaluateOnNewDocument(() => {
      // Overwrite the automation flags
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
      
      // Overwrite the plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // Overwrite the languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      
      // Remove the automation controller
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });
    
    // Randomize viewport dimensions slightly to avoid detection
    await page.setViewport({
      width: 1920 - Math.floor(Math.random() * 100),
      height: 1080 - Math.floor(Math.random() * 100),
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });
    
    try {
      // Navigate to SteamDB page with extended timeout
      await page.goto(steamDBUrl, { 
        waitUntil: ['networkidle2', 'domcontentloaded'],
        timeout: 40000 // Extend timeout for slower connections
      });
      
      // Handle potential security checks
      const passedSecurity = await handleSecurityChecks(page, steamDBUrl);
      if (!passedSecurity) {
        await browser.close();
        logger.warning('Access blocked by SteamDB security checks, falling back to Steam Store API');
        
        // Use Steam Store API as fallback
        const steamStoreData = await getSteamStoreData(steamAppId, options);
        if (steamStoreData.success) {
          return steamStoreData;
        }
        
        return {
          success: false,
          error: 'Access blocked by SteamDB security checks',
          message: 'The request was blocked by SteamDB security checks. Please try again later.'
        };
      }
      
      // Retry once with a different approach if needed
      let pageContent = await page.content();
      if (pageContent.includes('App not found') || pageContent.includes('404 Not Found') || !pageContent.includes('steamdb')) {
        logger.warning('Initial page load failed or incorrect page loaded, retrying with different approach');
        
        // Close current page and open a new one with different settings
        await page.close();
        const newPage = await browser.newPage();
        
        // Use a different user agent for the retry
        await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0');
        
        // Wait a moment before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Retry the navigation with different settings
        await newPage.goto(steamDBUrl, { 
          waitUntil: 'networkidle0', 
          timeout: 50000 
        });
        
        // Check if retry was successful
        const secondPassedSecurity = await handleSecurityChecks(newPage, steamDBUrl);
        if (!secondPassedSecurity) {
          await browser.close();
          logger.warning('Access blocked by SteamDB security checks on retry, falling back to Steam Store API');
          
          // Use Steam Store API as fallback
          const steamStoreData = await getSteamStoreData(steamAppId, options);
          if (steamStoreData.success) {
            return steamStoreData;
          }
          
          return {
            success: false,
            error: 'Access blocked by SteamDB security checks on retry',
            message: 'The request was blocked by SteamDB security checks. Please try again later.'
          };
        }
        
        // Update the page reference to use the new page
        page = newPage;
        pageContent = await page.content();
      }
      
      // Check if we hit any error (like a rate limit or missing page)
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
    
    // Configure advanced browser settings to better mimic a real user
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled', // Hide automation
        '--disable-blink-features',
        '--window-size=1920,1080', // Use a common resolution
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', // More realistic UA
        '--lang=en-US,en' // Set language
      ]
    });
    
    const page = await browser.newPage();
    
    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/',
      'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    });
    
    // Modify the WebDriver flags to prevent detection
    await page.evaluateOnNewDocument(() => {
      // Overwrite the automation flags
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
      
      // Overwrite the plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // Overwrite the languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      
      // Remove the automation controller
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });
    
    // Randomize viewport dimensions slightly to avoid detection
    await page.setViewport({
      width: 1920 - Math.floor(Math.random() * 100),
      height: 1080 - Math.floor(Math.random() * 100),
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });
    
    try {
      // Navigate to search page
      await page.goto(searchUrl, { 
        waitUntil: ['networkidle2', 'domcontentloaded'],
        timeout: 40000 // Extend timeout for slower connections
      });
      
      // Handle potential security checks
      const passedSecurity = await handleSecurityChecks(page, searchUrl);
      if (!passedSecurity) {
        await browser.close();
        logger.warning('Access blocked by SteamDB security checks, attempting to use Steam Store search');
        
        // Unfortunately, Steam Store doesn't provide a direct search API
        // We'll return a more helpful error message
        return {
          success: false,
          error: 'Access blocked by SteamDB security checks',
          message: 'SteamDB access is currently blocked by security measures. Try using the specific Steam App ID if you know it, or try searching on Steam Store directly at https://store.steampowered.com/'
        };
      }
      
      // Retry once with a different approach if needed
      let pageContent = await page.content();
      if (!pageContent.includes('steamdb') || pageContent.includes('error')) {
        logger.warning('Initial page load failed or incorrect page loaded, retrying with different approach');
        
        // Close current page and open a new one with different settings
        await page.close();
        const newPage = await browser.newPage();
        
        // Use a different user agent for the retry
        await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0');
        
        // Wait a moment before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Retry the navigation with different settings
        await newPage.goto(searchUrl, { 
          waitUntil: 'networkidle0', 
          timeout: 50000 
        });
        
        // Check if retry was successful
        const secondPassedSecurity = await handleSecurityChecks(newPage, searchUrl);
        if (!secondPassedSecurity) {
          await browser.close();
          logger.warning('Access blocked by SteamDB security checks on retry, no fallback available');
          return {
            success: false,
            error: 'Access blocked by SteamDB security checks on retry',
            message: 'SteamDB access is currently blocked by security measures. Try using the specific Steam App ID if you know it, or try searching on Steam Store directly at https://store.steampowered.com/'
          };
        }
        
        // Update the page reference to use the new page
        page = newPage;
        pageContent = await page.content();
      }
      
      // Check if we hit a rate limit
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
    
    // Configure advanced browser settings to better mimic a real user
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled', // Hide automation
        '--disable-blink-features',
        '--window-size=1920,1080', // Use a common resolution
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', // More realistic UA
        '--lang=en-US,en' // Set language
      ]
    });
    
    const page = await browser.newPage();
    
    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/',
      'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    });
    
    // Modify the WebDriver flags to prevent detection
    await page.evaluateOnNewDocument(() => {
      // Overwrite the automation flags
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
      
      // Overwrite the plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // Overwrite the languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      
      // Remove the automation controller
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });
    
    // Randomize viewport dimensions slightly to avoid detection
    await page.setViewport({
      width: 1920 - Math.floor(Math.random() * 100),
      height: 1080 - Math.floor(Math.random() * 100),
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });
    
    try {
      // Navigate to Steam store page
      await page.goto('https://store.steampowered.com/', { 
        waitUntil: ['networkidle2', 'domcontentloaded'],
        timeout: 40000 // Extend timeout for slower connections
      });
      
      // Handle potential security checks
      const passedSecurity = await handleSecurityChecks(page, 'https://store.steampowered.com/');
      if (!passedSecurity) {
        await browser.close();
        logger.warning('Access blocked by Steam security checks, trying alternative approach');
        
        // Try a simple API-based approach as fallback
        try {
          // Make a direct request to the Steam API for top sellers
          const response = await axios.get('https://store.steampowered.com/api/featuredcategories', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          
          if (response.data && response.data.specials && response.data.top_sellers) {
            // Format the API response to match our expected structure
            const formattedData = {
              topSellers: response.data.top_sellers.items.map(item => ({
                title: item.name,
                price: item.final_price ? `$${(item.final_price/100).toFixed(2)}` : 'N/A',
                discount: item.discount_percent ? `-${item.discount_percent}%` : null,
                originalPrice: item.original_price ? `$${(item.original_price/100).toFixed(2)}` : null,
                appId: item.id.toString(),
                url: `https://store.steampowered.com/app/${item.id}/`
              })),
              specials: response.data.specials.items.map(item => ({
                title: item.name,
                price: item.final_price ? `$${(item.final_price/100).toFixed(2)}` : 'N/A',
                discount: item.discount_percent ? `-${item.discount_percent}%` : null,
                originalPrice: item.original_price ? `$${(item.original_price/100).toFixed(2)}` : null,
                appId: item.id.toString(),
                url: `https://store.steampowered.com/app/${item.id}/`
              })),
              newReleases: response.data.new_releases ? response.data.new_releases.items.map(item => ({
                title: item.name,
                price: item.final_price ? `$${(item.final_price/100).toFixed(2)}` : 'N/A',
                discount: item.discount_percent ? `-${item.discount_percent}%` : null,
                originalPrice: item.original_price ? `$${(item.original_price/100).toFixed(2)}` : null,
                appId: item.id.toString(),
                url: `https://store.steampowered.com/app/${item.id}/`
              })) : []
            };
            
            // Format message and return
            const formattedMessage = options.useAI && process.env.GEMINI_API_KEY ? 
              await enhanceDealsWithAI(formattedData) : 
              formatSteamDealsMessage(formattedData);
              
            return {
              success: true,
              topSellers: formattedData.topSellers,
              specials: formattedData.specials,
              newReleases: formattedData.newReleases,
              message: formattedMessage
            };
          }
        } catch (apiError) {
          logger.error(`Error with Steam API fallback: ${apiError.message}`);
        }
        
        return {
          success: false,
          error: 'Access blocked by Steam security checks',
          message: 'Access to Steam Store was blocked by security checks. Please try again later or visit the Steam Store directly at https://store.steampowered.com/'
        };
      }
      
      // Retry once with a different approach if needed
      let pageContent = await page.content();
      if (!pageContent.includes('store.steampowered.com') || pageContent.includes('error')) {
        logger.warning('Initial page load failed or incorrect page loaded, retrying with different approach');
        
        // Close current page and open a new one with different settings
        await page.close();
        const newPage = await browser.newPage();
        
        // Use a different user agent for the retry
        await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0');
        
        // Wait a moment before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Retry the navigation with different settings
        await newPage.goto('https://store.steampowered.com/', { 
          waitUntil: 'networkidle0', 
          timeout: 50000 
        });
        
        // Check if retry was successful
        const secondPassedSecurity = await handleSecurityChecks(newPage, 'https://store.steampowered.com/');
        if (!secondPassedSecurity) {
          await browser.close();
          return {
            success: false,
            error: 'Access blocked by Steam security checks on retry',
            message: 'The request was blocked by Steam security checks. Please try again later.'
          };
        }
        
        // Update the page reference to use the new page
        page = newPage;
      }
      
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
 * Fetch game information from Steam Store API as fallback
 * @param {number|string} appId - The Steam App ID to look up
 * @param {Object} options - Additional options for the request
 * @returns {Promise<Object>} - Information about the game
 */
async function getSteamStoreData(appId, options = {}) {
  try {
    logger.info(`Falling back to Steam Store API for app ID: ${appId}`);
    
    // Steam Store API endpoint
    const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`;
    
    // Setup browser-like headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://store.steampowered.com/',
      'Cache-Control': 'no-cache'
    };
    
    // Make a direct API request
    const response = await axios.get(steamApiUrl, { headers });
    
    // Check if the API returned valid data
    if (!response.data || !response.data[appId] || !response.data[appId].success) {
      logger.error(`Steam Store API returned no data for app ID: ${appId}`);
      return {
        success: false,
        error: 'No data found',
        message: `No data found for app ID ${appId} on Steam Store.`
      };
    }
    
    // Extract game data from response
    const gameData = response.data[appId].data;
    
    // Format the data for our needs
    const formattedData = {
      title: gameData.name || '',
      price: gameData.price_overview ? 
        `${gameData.price_overview.final_formatted} ${gameData.price_overview.discount_percent > 0 ? 
          `(${gameData.price_overview.discount_percent}% off)` : ''}` : 
        (gameData.is_free ? 'Free to Play' : 'Not Available'),
      metadata: {
        'Developer': Array.isArray(gameData.developers) ? gameData.developers.join(', ') : (gameData.developers || 'Unknown'),
        'Publisher': Array.isArray(gameData.publishers) ? gameData.publishers.join(', ') : (gameData.publishers || 'Unknown'),
        'Release Date': gameData.release_date ? gameData.release_date.date : 'Unknown',
        'Type': gameData.type || 'Unknown',
        'Metacritic Score': gameData.metacritic ? gameData.metacritic.score : 'N/A'
      },
      tags: gameData.categories ? gameData.categories.map(cat => cat.description) : [],
      platforms: [],
      dlcData: [],
      currentPlayers: 'Data not available from Steam API',
      historicalPeakPlayers: 'Data not available from Steam API',
      updates: [] // Ensure this is defined as an empty array
    };
    
    // Add platform support information
    if (gameData.platforms) {
      if (gameData.platforms.windows) formattedData.platforms.push('Windows');
      if (gameData.platforms.mac) formattedData.platforms.push('macOS');
      if (gameData.platforms.linux) formattedData.platforms.push('Linux');
    }
    
    // Add genres as tags
    if (gameData.genres) {
      formattedData.tags = [...formattedData.tags, ...gameData.genres.map(genre => genre.description)];
    }
    
    // Get DLC info if available
    if (gameData.dlc && Array.isArray(gameData.dlc)) {
      // We can't get DLC prices directly from this API
      // Just add the DLC IDs we know exist
      formattedData.dlcData = gameData.dlc.map(dlcId => ({
        title: `DLC (ID: ${dlcId})`,
        price: 'Check Steam Store'
      }));
    }
    
    logger.success(`Successfully fetched Steam Store data for game: ${formattedData.title}`);
    
    // Check if AI enhancement is requested
    const useAI = options.useAI !== false && process.env.GEMINI_API_KEY;
    
    let formattedMessage;
    if (useAI) {
      formattedMessage = await enhanceWithAI(formattedData, appId, { fromSteamApi: true });
    } else {
      formattedMessage = formatSteamApiGameInfoMessage(formattedData, appId);
    }
    
    return {
      success: true,
      appId: appId,
      url: `https://store.steampowered.com/app/${appId}/`,
      gameInfo: formattedData,
      message: formattedMessage,
      fromSteamApi: true // Flag to indicate this came from Steam API not SteamDB
    };
  } catch (error) {
    logger.error(`Error fetching Steam Store data: ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      message: `Failed to get game data from Steam Store: ${error.message}`
    };
  }
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
    const sourceName = options.fromSteamApi ? "Steam Store API" : "SteamDB";
    logger.info(`Enhancing game data from ${sourceName} with AI for app ID: ${appId}`);
    
    if (!gameData || !gameData.title) {
      return options.fromSteamApi ? 
        formatSteamApiGameInfoMessage(gameData, appId) : 
        formatGameInfoMessage(gameData, appId);
    }
    
    // Prepare the raw data as structured JSON for the AI
    const gameDataJson = JSON.stringify(gameData, null, 2);
    
    // Prepare prompt for Gemini
    const prompt = `Anda adalah pakar game yang menyediakan informasi terperinci, terformat dengan baik, dan berwawasan luas tentang video game.
Saya akan menyediakan data mentah tentang game dalam format JSON, dan saya ingin Anda mengubahnya menjadi respons teks yang terstruktur dengan baik, informatif, dan menarik menggunakan bahasa Indonesia.

Ini adalah game data:
${gameDataJson}

Steam App ID: ${appId}
Data Source: ${sourceName}
${options.fromSteamApi ? 'URL: https://store.steampowered.com/app/' + appId + '/' : 'URL: https://steamdb.info/app/' + appId + '/'}

Harap buat respons teks komprehensif yang:
1. Memiliki struktur judul yang jelas dengan nama game dan ID aplikasi
2. Menyoroti informasi penting seperti harga, platform, dan info rilis
3. Mengatur metadata dalam format yang bersih dan mudah dibaca
4. Menyertakan tag dan informasi DLC jika tersedia
5. Menambahkan pengetahuan game ahli atau konteks tentang judul ini jika relevan
6. Diformat dengan baik secara baik dan jelas
7. Tandai ${sourceName} sebagai data source
${options.fromSteamApi ? '8. Catatan bahwa data ini berasal dari Steam Store API karena akses SteamDB diblokir oleh tindakan keamanan' : ''}

Jaga agar respons Anda tetap ringkas namun komprehensif.`;

    // Get API key from environment
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
      logger.warning('Gemini API key not found, falling back to standard formatting');
      return options.fromSteamApi ? 
        formatSteamApiGameInfoMessage(gameData, appId) : 
        formatGameInfoMessage(gameData, appId);
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
      
      // Make sure the end message mentions where the data came from
      if (options.fromSteamApi) {
        // Make sure both data source credits are present
        if (!enhancedContent.toLowerCase().includes('steam store')) {
          return enhancedContent + 
            `\n\nData from [Steam Store](https://store.steampowered.com/app/${appId}/)` +
            `\n\n*Note: This data was fetched from Steam Store API because SteamDB access was blocked by security measures.*`;
        }
        
        // Add the note about SteamDB access if not already present
        if (!enhancedContent.toLowerCase().includes('steamdb') && 
            !enhancedContent.toLowerCase().includes('security')) {
          return enhancedContent + 
            `\n\n*Note: This data was fetched from Steam Store API because SteamDB access was blocked by security measures.*`;
        }
      } else {
        // For SteamDB data
        if (!enhancedContent.includes('SteamDB')) {
          return enhancedContent + `\n\nData from [SteamDB](https://steamdb.info/app/${appId}/)`;
        }
      }
      
      return enhancedContent;
    } else {
      // Fall back to standard formatting
      logger.warning('AI enhancement failed, falling back to standard formatting');
      return options.fromSteamApi ? 
        formatSteamApiGameInfoMessage(gameData, appId) : 
        formatGameInfoMessage(gameData, appId);
    }
  } catch (error) {
    logger.error(`Error enhancing game data with AI: ${error.message}`);
    // Fall back to standard formatting
    return options.fromSteamApi ? 
      formatSteamApiGameInfoMessage(gameData, appId) : 
      formatGameInfoMessage(gameData, appId);
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
    const prompt = `Anda adalah pakar game yang menyediakan informasi yang diformat dengan baik dan berwawasan luas tentang video game.
Saya akan memberi Anda hasil pencarian mentah dari SteamDB dalam format JSON, dan saya ingin Anda mengubahnya menjadi respons teks yang terstruktur dengan baik dan informatif..

Search Query: "${query}"
Search Results:
${resultsJson}

Harap buat respons teks komprehensif yang:
1. Memiliki judul yang jelas yang menunjukkan bahwa ini adalah hasil pencarian untuk kueri
2. Mencantumkan game dalam format yang baik dengan ID Aplikasi, jenis, dan informasi pembaruannya
3. Mengelompokkan game yang serupa jika memungkinkan (misalnya game dasar dan DLC-nya)
4. Menyorot game yang sangat populer atau terkenal jika Anda dapat mengidentifikasinya
5. Diformat secara baik dan jelas
6. Menyertakan catatan bahwa pengguna dapat menggunakan fungsi \`get_steam_game_data\` dengan ID Aplikasi untuk detail lebih lanjut
7. Menyebutkan SteamDB sebagai sumber data

Buat respons Anda ringkas tetapi komprehensif, tampilkan maksimal 15 game dengan yang paling relevan terlebih dahulu.`;

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
    const prompt = `Anda adalah pakar game yang menyediakan informasi yang diformat dengan baik tentang penawaran dan tren video game terkini.
Saya akan menyediakan data mentah tentang penawaran Steam terkini dalam format JSON, dan saya ingin Anda mengubahnya menjadi respons teks yang terstruktur dengan baik dan informatif.

Data Toko Steam Terkini:
${dealsJson}

Harap buat respons teks komprehensif yang:
1. Memiliki judul yang jelas yang menunjukkan bahwa ini adalah data penawaran Steam terkini
2. Mengatur penawaran ke dalam beberapa bagian yang jelas (Promo, Produk Terlaris, Rilis Baru)
3. Menyoroti diskon yang sangat mengesankan atau judul yang terkenal
4. Memformat harga dan diskon game dengan jelas
5. Mengelompokkan game yang serupa jika relevan (misalnya, game dari waralaba atau pengembang yang sama)
6. Diformat dengan baik secara baik dan jelas (judul, cetak tebal, daftar, dll.)
7. Menyebutkan Steam Store sebagai sumber data

Buat respons Anda singkat tetapi komprehensif, dengan menampilkan penawaran yang paling menarik dan berharga terlebih dahulu.`;

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

/**
 * Detect and handle security checks or captchas on SteamDB
 * @param {Page} page - Puppeteer page object
 * @param {string} url - The URL being accessed
 * @returns {Promise<boolean>} - True if page was successfully navigated, false if blocked
 */
async function handleSecurityChecks(page, url) {
  try {
    logger.info('Checking for security challenges or captchas');
    
    // Check for various security indicators in the page content
    const content = await page.content();
    
    // List of possible security check indicators
    const securityIndicators = [
      'checking if the site connection is secure',
      'security check',
      'cloudflare',
      'ddos protection',
      'captcha',
      'please wait',
      'please prove you are human',
      'verify you are a human',
      'bot protection',
      'automated access',
      'challenge page'
    ];
    
    // Check if any security indicators are present
    const isSecurityCheck = securityIndicators.some(indicator => 
      content.toLowerCase().includes(indicator.toLowerCase())
    );
    
    if (isSecurityCheck) {
      logger.warning('Security check or captcha detected');
      
      // Try to take a screenshot for debugging if needed
      try {
        await page.screenshot({ path: 'security_check.png' });
        logger.info('Saved screenshot of security check page for debugging');
      } catch (screenshotError) {
        logger.error('Failed to save security check screenshot', screenshotError);
      }
      
      // Try to wait longer to see if the challenge resolves automatically
      logger.info('Waiting for security check to resolve...');
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Check page content again after waiting
      const newContent = await page.content();
      const stillBlocked = securityIndicators.some(indicator => 
        newContent.toLowerCase().includes(indicator.toLowerCase())
      );
      
      if (stillBlocked) {
        logger.error('Still blocked by security check after waiting');
        return false;
      } else {
        logger.success('Security check appears to be resolved');
        return true;
      }
    }
    
    // Check page title for security indications
    const pageTitle = await page.title();
    if (pageTitle.includes('Security Check') || 
        pageTitle.includes('Checking') || 
        pageTitle.includes('Captcha') ||
        pageTitle.includes('DDoS protection')) {
      logger.warning(`Security check detected in page title: "${pageTitle}"`);
      return false;
    }
    
    // If we get here, no security checks were detected
    return true;
  } catch (error) {
    logger.error('Error while checking for security challenges', error);
    return false;
  }
}

/**
 * Format game information from Steam API for display
 * @param {Object} gameData - Game information from Steam API
 * @param {number} appId - Steam App ID
 * @returns {string} - Formatted message
 */
function formatSteamApiGameInfoMessage(gameData, appId) {
  if (!gameData || !gameData.title) {
    return `No information found for Steam App ID: ${appId}`;
  }
  
  let message = `# ${gameData.title} (App ID: ${appId})\n\n`;
  
  // Add price information
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
    
    Object.entries(gameData.metadata).forEach(([key, value]) => {
      if (value) {
        message += `**${key}:** ${value}\n`;
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
  
  message += `\nData from [Steam Store](https://store.steampowered.com/app/${appId}/)\n`;
  message += `\n*Note: This data was fetched from Steam Store API because SteamDB access was blocked by security measures.*`;
  
  return message;
}

export {
  getSteamGameData,
  searchSteamGames,
  getSteamDeals,
  enhanceWithAI,
  enhanceSearchResultsWithAI,
  enhanceDealsWithAI,
  getSteamStoreData
}; 