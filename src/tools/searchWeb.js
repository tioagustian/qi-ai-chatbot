import axios from 'axios';
import { logger } from '../utils/logger.js';
import fetchUrlContent from './fetchUrlContent.js';
import { requestGeminiChat } from '../services/aiRequest.js';


// New web search function
async function searchWeb(query) {
  try {
    logger.info(`Performing web search for: "${query}"`);
    
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
    
    const contentPromises = topResults.map(async (result, index) => {
      try {
        // Add a small delay to avoid rate limiting issues
        await new Promise(resolve => setTimeout(resolve, index * 500));
        
        logger.debug(`Fetching content from ${result.link}`);
        
        // Use the fetchUrlContent function we already enhanced
        const contentResult = await fetchUrlContent(result.link, {
          userQuery: query,
          timeoutMs: 10000  // Lower timeout for multiple requests
        });
        
        if (contentResult.success) {
          logger.debug(`Successfully fetched content from ${result.link}`);
          
          return {
            title: result.title,
            link: result.link,
            content: contentResult.aiSummary || contentResult.content || result.snippet,
            success: true
          };
        } else {
          logger.warning(`Failed to fetch content from ${result.link}: ${contentResult.error}`);
          
          // Return just the search snippet if content fetching fails
          return {
            title: result.title,
            link: result.link,
            content: result.snippet,
            success: false,
            error: contentResult.error
          };
        }
      } catch (urlError) {
        logger.error(`Error fetching URL ${result.link}: ${urlError.message}`);
        
        return {
          title: result.title,
          link: result.link,
          content: result.snippet,
          success: false,
          error: urlError.message
        };
      }
    });
    
    // Wait for all content fetching to complete
    const contentResults = await Promise.all(contentPromises);
    
    // Generate a comprehensive AI summary of all the results
    logger.info('Generating comprehensive AI summary of search results');
    
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
      logger.warning('Gemini API key not found, returning raw search results without AI summary');
      
      // NEW: Save search results to memory
      try {
        // Import the memory service function
        const { storeWebSearchResults } = await import('./memoryService.js');
        
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
        message: formattedText
      };
    }
    
    // Prepare the content for the AI summary
    let summaryContent = '';
    
    contentResults.forEach((result, index) => {
      summaryContent += `Sumber #${index + 1}: ${result.title} (${result.link})\n`;
      summaryContent += `Ringkasan: ${result.content.substring(0, 1000)}${result.content.length > 1000 ? '...' : ''}\n\n`;
    });
    
    // Format messages for Gemini
    const promptContent = `Kamu adalah AI asisten yang ahli dalam meringkas hasil pencarian web.
    
Berikut adalah hasil pencarian untuk query: "${query}"

${summaryContent}

Berdasarkan hasil pencarian di atas, berikan ringkasan yang komprehensif. Ringkasan harus:

1. Menjawab query pengguna "${query}" dengan informasi faktual
2. Menggabungkan informasi dari berbagai sumber yang diberikan
3. Mengutip sumber informasi dengan menuliskan nomor sumber dalam tanda kurung, misalnya (Sumber #1)
4. Mengidentifikasi area di mana sumber-sumber tidak sepakat (jika ada)
5. Menyoroti data terbaru atau paling relevan

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
    const finalMessage = `# Hasil pencarian untuk: ${query}\n\n${aiSummary}`;
    
    // NEW: Save search results with enhanced AI summary to memory
    try {
      // Import the memory service function
      const { storeWebSearchResults } = await import('./memoryService.js');
      
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
      message: finalMessage
    };
  } catch (error) {
    logger.error(`Error searching web: ${error.message}`);
    return {
      success: false,
      error: error.message,
      message: `Maaf, terjadi kesalahan saat melakukan pencarian: ${error.message}`
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

export {searchWeb, formatSearchResults}