import axios from 'axios';
import { logger } from '../utils/logger.js';
import fetchUrlContent from './fetchUrlContent.js';
import { requestGeminiChat } from '../services/aiRequest.js';

/**
 * Check if a cached search result exists and is still valid
 * @param {string} query - The search query
 * @param {Object} options - Options for cache control
 * @returns {Object|null} - The cached results or null if not found/valid
 */
async function getCachedSearchResults(query, options = {}) {
  try {
    const { 
      maxAgeMinutes = 60,  // Default cache expiry of 60 minutes
      similarityThreshold = 0.8  // How similar queries need to be to use cache
    } = options;
    
    // Import the getCachedWebSearch function from memoryService
    const { getCachedWebSearch } = await import('../services/memoryService.js');
    
    // Use the dedicated function to get cached search results
    const cachedResult = getCachedWebSearch(query, {
      maxAgeHours: maxAgeMinutes / 60,
      exactMatchOnly: similarityThreshold >= 0.99 // Only use exact match if threshold is very high
    });
    
    return cachedResult;
  } catch (error) {
    logger.error(`Error checking cache: ${error.message}`);
    return null;
  }
}

// New web search function
async function searchWeb(query) {
  try {
    logger.info(`Performing web search for: "${query}"`);
    
    // First, check for cached results
    const cachedResults = await getCachedSearchResults(query, {
      maxAgeMinutes: 120  // 2 hours cache validity
    });
    
    if (cachedResults) {
      logger.success(`Found cached search results for: "${query}"`);
      
      // If we have a cached AI summary, return it directly
      if (cachedResults.aiSummary) {
        const finalMessage = `# Hasil pencarian untuk: ${query}\n\n${cachedResults.aiSummary}\n\n(Hasil dari cache)`;
        
        return {
          success: true,
          results: cachedResults.results,
          contentResults: cachedResults.contentResults || [],
          aiSummary: cachedResults.aiSummary,
          formattedText: cachedResults.formattedText,
          message: finalMessage,
          fromCache: true
        };
      }
      
      // If we have content results but no AI summary, generate a new summary
      if (cachedResults.contentResults && cachedResults.contentResults.length > 0) {
        // Will continue with AI summarization using cached content
        const results = cachedResults.results;
        const contentResults = cachedResults.contentResults;
        const formattedText = cachedResults.formattedText || formatSearchResults(results);
        
        logger.info('Using cached content with new AI summary');
        
        // Continue to AI summarization with cached content
        return await generateAISummary(query, results, contentResults, formattedText, { fromCache: true });
      }
    }
    
    // Use Google Search API with Programmable Search Engine
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    
    if (!apiKey || !searchEngineId) {
      logger.error('Google Search API key or Search Engine ID not configured');
      return {
        success: false,
        error: 'Search API not configured',
        message: 'Maaf, Search API belum dikonfigurasi. Gunakan perintah !setsearchkey dan !setsearchengineid untuk mengatur API key.'
      };
    }
    
    // Google Custom Search API endpoint
    const endpoint = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;
    
    logger.debug('Calling Google Search API');
    
    const response = await axios.get(endpoint);
    
    if (!response.data || !response.data.items) {
      logger.info('No search results found');
      return {
        success: true,
        results: [],
        message: 'Tidak ada hasil pencarian yang ditemukan.'
      };
    }
    
    // Extract search results
    const results = response.data.items.map(item => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet || '',
      displayLink: item.displayLink || '',
      pagemap: item.pagemap || {}
    }));
    
    logger.success(`Found ${results.length} search results`);

    // Format results for readable output (plain text)
    const formattedText = formatSearchResults(results);
    
    // Limit to top 5 results to avoid excessive processing
    const topResults = results.slice(0, 5);
    
    // Visit each URL to get more comprehensive content
    logger.info(`Fetching content from top ${topResults.length} search results`);
    
    // Import puppeteer here instead of in each fetchUrlContent call
    const puppeteer = await import('puppeteer');
    
    // Launch a single browser instance for all content fetching
    logger.info('Launching shared browser instance for content fetching');
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-javascript',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage', // Helps with memory issues in Docker
        '--disable-accelerated-2d-canvas', // Reduces CPU usage
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    try {
      // Create a modified version of fetchUrlContent that uses the shared browser
      const fetchContentWithSharedBrowser = async (url, options = {}) => {
        try {
          // Create a customized version of fetchUrlContent that uses our shared browser
          const { default: fetchUrlContentOriginal } = await import('./fetchUrlContent.js');
          
          // Get browser from our parent scope
          const sharedBrowser = browser;
          
          // Start by creating a new page in our shared browser
          const page = await sharedBrowser.newPage();
          
          // Set a more modern user agent
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          
          // Enable JavaScript
          await page.setJavaScriptEnabled(true);
          
          // Set viewport for better rendering (larger to capture more content)
          await page.setViewport({
            width: 1920,
            height: 1080
          });
          
          // Intercept network requests to reduce unnecessary resources
          await page.setRequestInterception(true);
          page.on('request', (req) => {
            // Block unnecessary resources to speed up loading
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
              req.abort();
            } else {
              req.continue();
            }
          });
          
          // Import turndown for markdown conversion
          const turndown = await import('turndown');
          const TurndownService = turndown.default;
          
          try {
            // Navigate to the URL with improved waiting strategy
            logger.info(`Navigating to URL: ${url}`);
            await page.goto(url, { 
              waitUntil: ['networkidle2', 'domcontentloaded', 'load'],
              timeout: 30000
            });
            
            // Wait for common dynamic content selectors to appear
            logger.info('Waiting for content selectors to appear');
            await Promise.race([
              page.waitForSelector('article', { timeout: 3000 }).catch(() => {}),
              page.waitForSelector('main', { timeout: 3000 }).catch(() => {}),
              page.waitForSelector('#content', { timeout: 3000 }).catch(() => {}),
              page.waitForSelector('.content', { timeout: 3000 }).catch(() => {})
            ]).catch(() => {
              // This is fine if none of these selectors exist
            });
            
            // Additional wait for dynamic frameworks to render content
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Get page title
            const title = await page.title();
            logger.info(`Page title: "${title}"`);
            
            // Extract main content with improved selectors
            let mainContent = '';
            
            // Try extracting from main content selectors with more comprehensive list
            const mainSelectors = [
              'article', 'main', '[role="main"]', '.main-content', '#main-content',
              '.post-content', '.article-content', '.content', '#content',
              '.entry-content', '.post-body', '.article-body', '.story-body',
              '.news-content', '.blog-content', '.page-content', '.single-content',
              '.story-content', '#article-content', '[itemprop="articleBody"]',
              '.body-content', '.entry', '.post', '.article'
            ];
            
            // First attempt to find a main content container
            logger.info('Extracting main content from selectors');
            for (const selector of mainSelectors) {
              const element = await page.$(selector);
              if (element) {
                mainContent = await page.evaluate(el => el.innerText, element);
                if (mainContent && mainContent.length > 100) {
                  logger.info(`Found content in selector: ${selector}`);
                  break;
                }
              }
            }
            
            // If no main content found or it's too short, try a more advanced extraction method
            if (!mainContent || mainContent.length < 100) {
              logger.info('Using advanced content extraction method');
              mainContent = await page.evaluate(() => {
                // Get all text nodes in the document
                const textNodes = [];
                const walker = document.createTreeWalker(
                  document.body,
                  NodeFilter.SHOW_TEXT,
                  null,
                  false
                );
                
                // Skip common non-content elements
                const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE'];
                const skipClasses = ['nav', 'menu', 'sidebar', 'footer', 'header', 'comment', 'widget'];
                
                let node;
                while (node = walker.nextNode()) {
                  const parent = node.parentElement;
                  
                  // Skip if parent is in skipTags
                  if (skipTags.includes(parent.tagName)) continue;
                  
                  // Skip if parent has any of the skipClasses
                  if (Array.from(parent.classList).some(cls => 
                    skipClasses.some(skipCls => cls.toLowerCase().includes(skipCls))
                  )) continue;
                  
                  // Skip if hidden
                  if (parent.offsetParent === null) continue;
                  
                  // Check if node has meaningful text
                  const text = node.textContent.trim();
                  if (text.length > 20) {
                    textNodes.push({
                      text,
                      parent: parent.tagName,
                      depth: getNodeDepth(parent)
                    });
                  }
                }
                
                // Get depth of an element in the DOM
                function getNodeDepth(element) {
                  let depth = 0;
                  let current = element;
                  while (current) {
                    depth++;
                    current = current.parentElement;
                  }
                  return depth;
                }
                
                // Group text by parent depth (nodes at similar depths likely belong to the same content)
                const depthGroups = {};
                textNodes.forEach(node => {
                  if (!depthGroups[node.depth]) {
                    depthGroups[node.depth] = [];
                  }
                  depthGroups[node.depth].push(node.text);
                });
                
                // Find the depth with the most text content
                let maxTextLength = 0;
                let bestDepth = 0;
                
                Object.entries(depthGroups).forEach(([depth, texts]) => {
                  const totalLength = texts.join('').length;
                  if (totalLength > maxTextLength) {
                    maxTextLength = totalLength;
                    bestDepth = parseInt(depth);
                  }
                });
                
                // Get content from the best depth and adjacent depths
                const contentNodes = textNodes.filter(node => 
                  Math.abs(node.depth - bestDepth) <= 1
                );
                
                return contentNodes.map(node => node.text).join('\n\n');
              });
            }
            
            // Get full HTML content
            const fullHtml = await page.content();
            
            // Convert HTML to Markdown with improved settings
            logger.info('Converting HTML to Markdown');
            const turndownService = new TurndownService({
              headingStyle: 'atx',
              codeBlockStyle: 'fenced',
              bulletListMarker: '-',
              hr: '---',
              strongDelimiter: '**'
            });
            
            const markdown = turndownService.turndown(fullHtml);
            
            // Clean up content
            mainContent = mainContent
              .replace(/\s+/g, ' ')      // Replace multiple whitespace with single space
              .replace(/\n\s+/g, '\n')   // Remove leading spaces after newlines
              .trim();                   // Trim leading/trailing whitespace
            
            // Truncate if too long
            const maxLength = 4000;
            let truncatedContent = mainContent;
            if (mainContent.length > maxLength) {
              truncatedContent = mainContent.substring(0, maxLength) + '... (content truncated)';
              logger.info(`Content truncated from ${mainContent.length} to ${maxLength} chars`);
            }
            
            // Close the tab (page) but keep browser open
            await page.close();
            
            logger.success(`Successfully extracted content from URL (${url})`);
            
            // Prepare for AI summary later (we'll do this in batch)
            return {
              success: true,
              title: title,
              url: url,
              content: truncatedContent,
              markdown: markdown.substring(0, 8000), // Limit markdown size
              fullContent: mainContent,
              message: `# ${title}\n\n${truncatedContent}\n\nSumber: ${url}`
            };
          } catch (error) {
            // If there's an error, close the page and return error info
            await page.close();
            logger.error(`Error fetching content from URL: ${error.message}`);
            return {
              success: false,
              error: error.message,
              title: url,
              link: url,
              content: `Failed to fetch content: ${error.message}`,
              message: `Failed to fetch content from ${url}: ${error.message}`
            };
          }
        } catch (outerError) {
          logger.error(`Outer error in fetchContentWithSharedBrowser: ${outerError.message}`);
          return {
            success: false,
            error: outerError.message,
            title: url,
            link: url,
            content: `Failed to process: ${outerError.message}`,
            message: `Failed to process ${url}: ${outerError.message}`
          };
        }
      };
      
      // Use Promise.all but with a small delay between each to avoid overwhelming resources
      const contentPromises = [];
      
      for (let i = 0; i < topResults.length; i++) {
        const result = topResults[i];
        // Add a small delay between each request
        await new Promise(resolve => setTimeout(resolve, 500));
        contentPromises.push(fetchContentWithSharedBrowser(result.link, {
          userQuery: query,
          timeoutMs: 15000
        }));
      }
      
      // Wait for all content fetching to complete
      const contentResults = await Promise.all(contentPromises);
      
      // Close the shared browser instance when done with all fetching
      await browser.close();
      
      // Generate the summary with the fetched content
      return await generateAISummary(query, results, contentResults, formattedText);
    } catch (error) {
      // Make sure to close the browser if there's an error
      await browser.close();
      throw error;
    }
  } catch (error) {
    logger.error(`Error searching web: ${error.message}`);
    return {
      success: false,
      error: error.message,
      message: `Maaf, terjadi kesalahan saat melakukan pencarian: ${error.message}`
    };
  }
}

/**
 * Generate AI summary for search results
 * @param {string} query - The search query
 * @param {Array} results - The search results
 * @param {Array} contentResults - The detailed content of search results
 * @param {string} formattedText - Formatted results as text
 * @param {Object} options - Additional options
 * @returns {Object} - Search results with AI summary
 */
async function generateAISummary(query, results, contentResults, formattedText, options = {}) {
  try {
    // Generate a comprehensive AI summary of all the results
    logger.info('Generating comprehensive AI summary of search results');
    
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
      logger.warning('Gemini API key not found, returning raw search results without AI summary');
      
      // Save search results to memory
      try {
        // Import the memory service function
        const { storeWebSearchResults } = await import('../services/memoryService.js');
        
        // Store the search results
        await storeWebSearchResults(query, results, { formattedText });
        logger.info(`Saved search results for "${query}" to memory`);
      } catch (memoryError) {
        logger.warning(`Failed to save search results to memory: ${memoryError.message}`);
      }
      
      return {
        success: true,
        results: results,
        contentResults: contentResults,
        formattedText: formattedText,
        message: formattedText,
        fromCache: options.fromCache || false
      };
    }
    
    // Prepare the content for the AI summary with enhanced formatting
    let summaryContent = '';
    
    contentResults.forEach((result, index) => {
      summaryContent += `Sumber #${index + 1}: ${result.title} (${result.link})\n`;
      summaryContent += `Ringkasan: ${result.content.substring(0, 1000)}${result.content.length > 1000 ? '...' : ''}\n\n`;
    });
    
    // Enhanced prompt for better summarization
    const promptContent = `Kamu adalah AI asisten yang ahli dalam meringkas hasil pencarian web.
    
Berikut adalah hasil pencarian untuk query: "${query}"

${summaryContent}

Berdasarkan hasil pencarian di atas, berikan ringkasan yang komprehensif. Ringkasan harus:

1. Menjawab query pengguna "${query}" dengan informasi faktual
2. Menggabungkan informasi dari berbagai sumber yang diberikan
3. Mengutip sumber informasi dengan menuliskan nomor sumber dalam tanda kurung, misalnya (Sumber #1)
4. Mengidentifikasi area di mana sumber-sumber tidak sepakat (jika ada)
5. Menyoroti data terbaru atau paling relevan
6. Mengorganisir ringkasan menggunakan poin-poin atau paragraf terstruktur sesuai topik
7. Sertakan kesimpulan atau rekomendasi jika sesuai dengan query

Berikan informasi dalam format yang jelas dan terstruktur. Jangan terlalu panjang - maksimal 500-600 kata.`;

    const messages = [
      { 
        role: 'user', 
        content: promptContent
      }
    ];

    // Request AI summary from Gemini
    const aiSummaryResponse = await requestGeminiChat(
      'gemini-2.0-flash',
      geminiApiKey,
      messages,
      {
        temperature: 0.3,
        top_p: 0.85,
        max_tokens: 1500
      }
    );
    
    // Extract summary from response
    let aiSummary = '';
    if (aiSummaryResponse?.choices?.[0]?.message?.content) {
      aiSummary = aiSummaryResponse.choices[0].message.content;
    } else {
      // Fallback if there's an issue with AI summary
      logger.warning('Couldn\'t get AI summary, falling back to raw content');
      aiSummary = formattedText;
    }
    
    // Create the final message with AI summary and source
    const cacheNotice = options.fromCache ? '\n\n(Hasil dari cache)' : '';
    const finalMessage = `${aiSummary}${cacheNotice}`;
    
    // Save search results with enhanced AI summary to memory
    try {
      // Import the memory service function
      const { storeWebSearchResults } = await import('../services/memoryService.js');
      
      // Store the search results with AI summary
      await storeWebSearchResults(query, results, { 
        formattedText,
        contentResults,
        aiSummary,
        enhancedSearch: true
      });
      logger.info(`Saved enhanced search results for "${query}" to memory`);
    } catch (memoryError) {
      logger.warning(`Failed to save search results to memory: ${memoryError.message}`);
    }
    
    return {
      success: true,
      results: results,
      contentResults: contentResults,
      aiSummary: aiSummary,
      formattedText: formattedText,
      message: finalMessage,
      fromCache: options.fromCache || false
    };
  } catch (error) {
    logger.error(`Error generating AI summary: ${error.message}`);
    
    // Fallback to formatted text
    return {
      success: true,
      results: results,
      contentResults: contentResults,
      formattedText: formattedText,
      message: formattedText,
      error: `Error generating summary: ${error.message}`,
      fromCache: options.fromCache || false
    };
  }
}

// Format search results to be more readable
function formatSearchResults(results) {
  if (!results || results.length === 0) {
    return 'Tidak ada hasil pencarian ditemukan.';
  }
  
  // Limit to top 5 results to avoid overly long responses
  const topResults = results.slice(0, 5);
  
  let formattedText = '';
  
  topResults.forEach((result, index) => {
    formattedText += `${index + 1}. ${result.title}\n`;
    formattedText += `   ${result.link}\n`;
    formattedText += `   ${result.snippet}\n\n`;
  });
  
  return formattedText;
}

export {searchWeb, formatSearchResults};