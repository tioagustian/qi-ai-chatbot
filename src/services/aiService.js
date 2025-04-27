import axios from 'axios';
import { getDb } from '../database/index.js';
import chalk from 'chalk';
import { 
  getAvailableMoods, 
  getAvailablePersonalities, 
  getMoodDescription, 
  getPersonalityDescription,
  MOODS
} from './personalityService.js';

// Base URL for OpenRouter API
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Base URL for Google Gemini API
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Base URL for Together.AI API
const TOGETHER_API_URL = 'https://api.together.xyz/v1/chat/completions';

// API Providers
const API_PROVIDERS = {
  OPENROUTER: 'openrouter',
  GEMINI: 'gemini',
  TOGETHER: 'together'
};

// Model for image analysis
const IMAGE_ANALYSIS_MODEL = 'meta-llama/Llama-Vision-Free';

// Models supported by tools
const TOOL_SUPPORTED_MODELS = [
  'anthropic/claude-3-opus',
  'anthropic/claude-3-sonnet',
  'anthropic/claude-3-haiku',
  'openai/gpt-4o',
  'openai/gpt-4-turbo',
  'openai/gpt-4',
  'openai/gpt-3.5-turbo',
  'google/gemini-1.5-pro',
  'google/gemini-1.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash-preview-04-17',
  'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free'
];

// Together.AI available models
const TOGETHER_MODELS = [
  'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
  'meta-llama/Llama-Vision-Free' // Vision model for image analysis
];

// Rate limit error messages to detect
const RATE_LIMIT_ERRORS = [
  'rate limit exceeded',
  'too many requests', 
  'quota exceeded',
  'free-models-per-day'
];

// Console logging helper
const logger = {
  info: (message) => console.log(chalk.blue(`[INFO][${new Date().toISOString()}] ${message}`)),
  success: (message) => console.log(chalk.green(`[SUCCESS][${new Date().toISOString()}] ${message}`)),
  warning: (message) => console.log(chalk.yellow(`[WARNING][${new Date().toISOString()}] ${message}`)),
  error: (message, error) => {
    console.log(chalk.red(`[ERROR][${new Date().toISOString()}] ${message}`));
    if (error) {
      console.log(chalk.red('Error details:'));
      if (error.response) {
        console.log(chalk.red(`Status: ${error.response.status}`));
        console.log(chalk.red('Response data:'), error.response.data);
      } else if (error.request) {
        console.log(chalk.red('No response received'));
      } else {
        console.log(chalk.red(`Message: ${error.message}`));
      }
      console.log(chalk.red('Stack trace:'));
      console.log(error.stack);
    }
  },
  debug: (message, data) => {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.magenta(`[DEBUG][${new Date().toISOString()}] ${message}`));
      if (data) console.log(chalk.magenta('Debug data:'), data);
    }
  }
};

// Generate a response using the AI model
async function generateAIResponseLegacy(message, context, botData) {
  try {
    logger.info(`Generating AI response for message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
    logger.debug('Context length:', context.length);
    
    const { config, state } = botData;
    
    // Determine if we should use Gemini API based on provider or model name
    const isGeminiModel = config.defaultProvider === 'gemini' || 
                         (config.model && (
                          config.model.startsWith('google/') || 
                          config.model.startsWith('gemini')
                         ));
                         
    // Determine if we should use Together.AI API based on provider or model name
    const isTogetherModel = config.defaultProvider === 'together' || 
                           (config.model && TOGETHER_MODELS.includes(config.model));
                         
    let apiKey;
    
    if (isGeminiModel) {
      apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        logger.warning('Gemini API key not configured');
        return 'Gemini API key belum dikonfigurasi. Gunakan perintah !setgeminikey untuk mengatur kunci API Gemini.';
      }
    } else if (isTogetherModel) {
      apiKey = config.togetherApiKey || process.env.TOGETHER_API_KEY;
      
      if (!apiKey) {
        logger.warning('Together.AI API key not configured');
        return 'Together.AI API key belum dikonfigurasi. Gunakan perintah !settogetherkey untuk mengatur kunci API Together.AI.';
      }
    } else {
      // Use OpenRouter API
      apiKey = process.env.OPENROUTER_API_KEY;
      
      if (!apiKey) {
        logger.warning('OpenRouter API key not configured');
        return 'OpenRouter API key belum dikonfigurasi. Gunakan perintah !setapikey untuk mengatur kunci API.';
      }
    }
    
    // Check if we've hit rate limits and if they're still active
    if (state.rateLimitInfo && state.rateLimitInfo.isLimited) {
      const resetTime = new Date(state.rateLimitInfo.resetTime);
      const now = new Date();
      
      if (now < resetTime) {
        // Rate limit is still active
        logger.warning('Rate limit still active, will not make API request');
        
        // Calculate remaining time
        const timeUntilReset = resetTime - now;
        const hoursUntilReset = Math.floor(timeUntilReset / (60 * 60 * 1000));
        const minutesUntilReset = Math.floor((timeUntilReset % (60 * 60 * 1000)) / (60 * 1000));
        
        const resetTimeMessage = hoursUntilReset > 0 
          ? `${hoursUntilReset} jam ${minutesUntilReset} menit` 
          : `${minutesUntilReset} menit`;
        
        return `Maaf, saat ini batas penggunaan API masih aktif. Batas akan direset dalam ${resetTimeMessage}. Silakan coba lagi nanti ya~`;
      } else {
        // Rate limit has expired, clear it
        logger.info('Rate limit has expired, clearing rate limit info');
        state.rateLimitInfo.isLimited = false;
        await getDb().write();
      }
    }
    
    // Create system message with personality and mood
    const systemMessage = createSystemMessage(config, state);
    logger.debug('System message created', { length: systemMessage.length });
    logger.debug(`"${systemMessage}"`)
    
    // Prepare messages array for the API
    const messages = [
      { role: 'system', content: systemMessage },
      ...formatContextForAPI(context),
      { role: 'user', content: message }
    ];
    
    if (isGeminiModel) {
      logger.info(`Making request to Gemini API with model: ${config.model}`);
      
      try {
        // Convert messages to Gemini format
        const formattedMessages = formatMessagesForAPI(messages, config);
        
        // Call Gemini API
        const response = await requestGeminiChat(
          config.model,
          apiKey,
          formattedMessages,
          {
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 1000,
            stop: null,
            stream: false
          }
        );
        
        if (!response) {
          logger.error('Empty response from Gemini API');
          return 'Maaf, Gemini API tidak memberikan respons. Coba lagi nanti ya~';
        }
        
        logger.success(`Successfully processed Gemini API response`);
        
        // Process response in the same format as OpenRouter response for consistency
        if (response.choices && response.choices.length > 0 && 
            response.choices[0].message && response.choices[0].message.content) {
          
          let processedContent = response.choices[0].message.content;
          
          // Trim leading/trailing newlines
          if (processedContent.match(/^\s*\n+/) || processedContent.match(/\n+\s*$/)) {
            processedContent = processedContent.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
          }
          
          logger.success(`Successfully processed AI response (${processedContent.length} chars)`);
          return processedContent;
        } else {
          logger.error('Invalid response format from Gemini API');
          return 'Maaf, format respons dari Gemini API tidak valid. Coba lagi nanti ya~';
        }
      } catch (geminiError) {
        logger.error('Gemini API request failed', geminiError);
        return `Gagal terhubung ke Gemini API: ${geminiError.message}. Coba lagi nanti ya~`;
      }
    } else if (isTogetherModel) {
      logger.info(`Making request to Together.AI API with model: ${config.model}`);
      
      try {
        // Convert messages to Together.AI format
        const formattedMessages = formatMessagesForAPI(messages, config);
        
        // Call Together.AI API
        const response = await requestTogetherChat(
          config.model,
          apiKey,
          formattedMessages,
          {
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 1000,
            stop: null,
            stream: false
          }
        );
        
        if (!response) {
          logger.error('Empty response from Together.AI API');
          return 'Maaf, Together.AI API tidak memberikan respons. Coba lagi nanti ya~';
        }
        
        logger.success(`Successfully processed Together.AI API response`);
        
        // Process response in the same format as OpenRouter response for consistency
        if (response.choices && response.choices.length > 0 && 
            response.choices[0].message && response.choices[0].message.content) {
          
          let processedContent = response.choices[0].message.content;
          
          // Trim leading/trailing newlines
          if (processedContent.match(/^\s*\n+/) || processedContent.match(/\n+\s*$/)) {
            processedContent = processedContent.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
          }
          
          logger.success(`Successfully processed AI response (${processedContent.length} chars)`);
          return processedContent;
        } else {
          logger.error('Invalid response format from Together.AI API');
          return 'Maaf, format respons dari Together.AI API tidak valid. Coba lagi nanti ya~';
        }
      } catch (togetherError) {
        logger.error('Together.AI API request failed', togetherError);
        return `Gagal terhubung ke Together.AI API: ${togetherError.message}. Coba lagi nanti ya~`;
      }
    } else {
      // OpenRouter implementation
      logger.info(`Making request to OpenRouter API with model: ${config.model}`);
      
      // Check if the model supports tools
      const supportsTools = TOOL_SUPPORTED_MODELS.some(model => 
        config.model.toLowerCase().includes(model.toLowerCase())
      );
      
      // Prepare request body based on tool support
      let requestBody = {
        model: config.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9
      };
      
      // Only add tools if the model supports them
      if (supportsTools) {
        logger.debug('Model supports tools, adding tool options');
        requestBody.tools = getTools();
        requestBody.tool_choice = 'auto';
        
        logger.debug('Request payload', {
          model: config.model,
          messageCount: messages.length,
          temperature: 0.7,
          tools_count: getTools().length,
          tools_enabled: true
        });
      } else {
        logger.debug('Model does not support tools, sending without tools');
        logger.debug('Request payload', {
          model: config.model,
          messageCount: messages.length,
          temperature: 0.7,
          tools_enabled: false
        });
      }
      
      let response;
      try {
        // Make request to OpenRouter API
        logger.debug('Sending request to OpenRouter API...');
        response = await axios.post(
          OPENROUTER_API_URL,
          requestBody,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/qi-ai-chatbot',
              'X-Title': 'Qi AI WhatsApp Chatbot'
            }
          }
        );
        
        logger.debug('OpenRouter API response received', { 
          status: response.status,
          headers: response.headers
        });
        
        // CRITICAL: Add immediate response data validation right after receiving
        if (!response || typeof response !== 'object') {
          logger.error('API response is not an object', { responseType: typeof response });
          return 'Maaf, respons API tidak valid (bukan object). Coba lagi nanti ya~';
        }
        
        if (!response.data) {
          logger.error('API response has no data property', { response: JSON.stringify(response).substring(0, 200) });
          return 'Maaf, respons API tidak memiliki data. Coba lagi nanti ya~';
        }
        
        // Log the full response structure for debugging
        logger.debug('Raw API response structure:', {
          hasChoices: 'choices' in response.data,
          choicesType: typeof response.data.choices,
          choicesIsArray: Array.isArray(response.data.choices),
          choicesLength: Array.isArray(response.data.choices) ? response.data.choices.length : 'N/A',
          responseKeys: Object.keys(response.data),
          firstLevelDataDump: JSON.stringify(response.data).substring(0, 500) + '...'
        });
        
      } catch (apiError) {
        logger.error('API request failed', {
          error: apiError.message,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          data: apiError.response?.data
        });
        
        // Check for rate limit errors
        const errorMessage = apiError.message || '';
        const errorData = apiError.response?.data || {};
        const isRateLimited = 
          apiError.response?.status === 429 || 
          RATE_LIMIT_ERRORS.some(term => 
            errorMessage.toLowerCase().includes(term) ||
            JSON.stringify(errorData).toLowerCase().includes(term)
          );
        
        if (isRateLimited) {
          logger.warning('Rate limit exceeded on OpenRouter API');
          
          // Try to get reset time from headers or error message
          let resetTime = null;
          
          // Check headers for reset time
          const resetHeader = apiError.response?.headers?.['x-ratelimit-reset'] || 
                             apiError.response?.headers?.['X-RateLimit-Reset'];
                               
          if (resetHeader) {
            try {
              resetTime = new Date(parseInt(resetHeader));
              logger.debug(`Rate limit reset time from headers: ${resetTime.toISOString()}`);
            } catch (e) {
              logger.debug(`Failed to parse reset header: ${resetHeader}`);
            }
          }
          
          // If no reset time from headers, estimate one (usually resets at midnight UTC)
          if (!resetTime) {
            resetTime = new Date();
            // Set to next day midnight UTC
            resetTime.setUTCDate(resetTime.getUTCDate() + 1);
            resetTime.setUTCHours(0, 0, 0, 0);
            logger.debug(`Estimated rate limit reset time: ${resetTime.toISOString()}`);
          }
          
          // Update rate limit information in database
          try {
            getDb().data.state.rateLimitInfo = {
              isLimited: true,
              limitReachedAt: new Date().toISOString(),
              resetTime: resetTime.toISOString(),
              error: errorData.error?.message || errorMessage
            };
            await getDb().write();
            logger.info(`Saved rate limit info to database, reset at: ${resetTime.toISOString()}`);
          } catch (dbError) {
            logger.error('Failed to save rate limit info to database', dbError);
          }
          
          // Calculate time until reset in a human-readable format
          const now = new Date();
          const timeUntilReset = resetTime - now;
          const hoursUntilReset = Math.floor(timeUntilReset / (60 * 60 * 1000));
          const minutesUntilReset = Math.floor((timeUntilReset % (60 * 60 * 1000)) / (60 * 1000));
          
          const resetTimeMessage = hoursUntilReset > 0 
            ? `${hoursUntilReset} jam ${minutesUntilReset} menit` 
            : `${minutesUntilReset} menit`;
            
          return `Maaf, batas penggunaan API telah tercapai untuk hari ini. Batas akan direset dalam ${resetTimeMessage}. Silakan coba lagi nanti ya~`;
        }
        
        if (apiError.response?.status === 401) {
          return 'API key tidak valid. Coba periksa kembali konfigurasi API key dengan perintah !setapikey.';
        }
        
        return `Gagal terhubung ke API: ${apiError.message}. Coba lagi nanti ya~`;
      }
      
      // Start response data validation
      if (!response || !response.data) {
        logger.error('Empty or invalid response from API', { response });
        return 'Maaf, AI tidak memberikan respons. Coba lagi nanti ya~';
      }
      
      // Log the complete response data for thorough debugging
      logger.debug('Complete API response data:', {
        fullData: JSON.stringify(response.data)
      });
      
      // CRITICAL: Enhanced structural validation with detailed error messages
      
      // 1. Validate choices array exists and is not empty
      if (!response.data.choices) {
        logger.error('Missing choices array in API response', { 
          responseKeys: Object.keys(response.data),
          responseData: JSON.stringify(response.data).substring(0, 300) + '...'
        });
        return 'Maaf, respons API tidak memiliki array choices. Coba lagi nanti ya~';
      }
      
      if (!Array.isArray(response.data.choices)) {
        logger.error('Choices is not an array in API response', { 
          choicesType: typeof response.data.choices,
          choicesValue: JSON.stringify(response.data.choices).substring(0, 200) + '...'
        });
        return 'Maaf, format respons dari AI tidak sesuai (choices bukan array). Coba lagi nanti ya~';
      }
      
      if (response.data.choices.length === 0) {
        logger.error('Empty choices array in API response', { 
          choicesLength: 0,
          responseData: JSON.stringify(response.data).substring(0, 300) + '...'
        });
        return 'Maaf, AI tidak memberikan pilihan respons. Coba lagi nanti ya~';
      }
      
      // 2. Log detailed structure information before accessing [0]
      logger.debug('Choices array structure before accessing index 0:', {
        length: response.data.choices.length,
        firstElementExists: response.data.choices.length > 0,
        firstElementType: response.data.choices.length > 0 ? typeof response.data.choices[0] : 'N/A',
        allElements: JSON.stringify(response.data.choices).substring(0, 300) + '...'
      });
      
      // 3. Access the first choice with thorough validation - THIS IS THE CRITICAL PART
      try {
        // Directly validate array access to pinpoint the exact error location
        if (response.data.choices.length <= 0) {
          throw new Error('Choices array is empty when trying to access first element');
        }
        
        const firstChoice = response.data.choices[0];
        
        if (firstChoice === undefined || firstChoice === null) {
          logger.error('First choice is null/undefined despite array having elements', {
            choicesArray: JSON.stringify(response.data.choices).substring(0, 300) + '...'
          });
          return 'Maaf, terjadi kesalahan struktur data respons AI (first choice is undefined). Coba lagi nanti ya~';
        }
        
        logger.debug('First choice contents:', {
          firstChoiceType: typeof firstChoice,
          firstChoiceKeys: Object.keys(firstChoice),
          firstChoiceStringified: JSON.stringify(firstChoice).substring(0, 300) + '...'
        });
        
        // 4. Validate message property exists on first choice
        if (!firstChoice.message) {
          logger.error('Missing message property in first choice', { 
            firstChoiceKeys: Object.keys(firstChoice),
            firstChoice: JSON.stringify(firstChoice).substring(0, 300) + '...'
          });
          return 'Maaf, respons AI tidak memiliki properti message. Coba lagi nanti ya~';
        }
        
        // 5. Log message structure information in great detail
        const aiResponse = firstChoice.message;
        logger.debug('AI response structure:', {
          messageType: typeof aiResponse,
          messageKeys: Object.keys(aiResponse),
          hasContent: 'content' in aiResponse,
          contentType: aiResponse.content !== undefined ? typeof aiResponse.content : 'undefined',
          contentValue: aiResponse.content !== undefined ? 
            (typeof aiResponse.content === 'string' ? 
              aiResponse.content.substring(0, 100) + '...' : 
              JSON.stringify(aiResponse.content).substring(0, 100) + '...') 
            : 'undefined',
          hasToolCalls: 'tool_calls' in aiResponse,
          toolCallsType: aiResponse.tool_calls !== undefined ? typeof aiResponse.tool_calls : 'undefined',
          fullMessageObject: JSON.stringify(aiResponse).substring(0, 300) + '...'
        });
        
        // 6. Process based on response type with extremely defensive coding
        // Check if it's a tool call response
        if (aiResponse.tool_calls && Array.isArray(aiResponse.tool_calls) && aiResponse.tool_calls.length > 0) {
          logger.info('Tool call detected');
          
          // Additional validation for tool_calls[0]
          if (!aiResponse.tool_calls[0]) {
            logger.error('tool_calls array is empty or first element is undefined', {
              toolCalls: JSON.stringify(aiResponse.tool_calls)
            });
            return 'Maaf, format tool_calls dari AI tidak valid (elemen pertama undefined). Coba lagi nanti ya~';
          }
          
          logger.debug('Tool call structure:', {
            firstToolCallType: typeof aiResponse.tool_calls[0],
            firstToolCallKeys: Object.keys(aiResponse.tool_calls[0]),
            hasFunction: 'function' in aiResponse.tool_calls[0],
            functionType: aiResponse.tool_calls[0].function ? typeof aiResponse.tool_calls[0].function : 'undefined'
          });
          
          if (!aiResponse.tool_calls[0].function) {
            logger.error('Invalid tool call structure - missing function property', { 
              toolCall: JSON.stringify(aiResponse.tool_calls[0])
            });
            return 'Maaf, format respons tool call dari AI tidak valid (tidak ada function). Coba lagi nanti ya~';
          }
          
          logger.info(`Tool call function: ${aiResponse.tool_calls[0].function.name || 'unnamed'}`);
          return handleToolCall(aiResponse.tool_calls[0].function);
        }
        
        // For text response, ensure content exists and is a string
        if (aiResponse.content === undefined || aiResponse.content === null) {
          logger.error('Missing content in AI response', { 
            aiResponseKeys: Object.keys(aiResponse),
            aiResponse: JSON.stringify(aiResponse).substring(0, 300) + '...'
          });
          return 'Maaf, respons AI tidak memiliki konten. Coba lagi nanti ya~';
        }
        
        if (typeof aiResponse.content !== 'string') {
          logger.error('Content is not a string in AI response', { 
            contentType: typeof aiResponse.content,
            contentValue: JSON.stringify(aiResponse.content).substring(0, 300) + '...'
          });
          return 'Maaf, format konten respons AI tidak sesuai (bukan string). Coba lagi nanti ya~';
        }
        
        // Trim leading newlines that some models add to responses
        let processedContent = aiResponse.content;
        
        // Check if the content has leading newlines or whitespace
        if (processedContent.match(/^\s*\n+/)) {
          const originalLength = processedContent.length;
          
          // Remove all leading whitespace and newlines
          processedContent = processedContent.replace(/^\s*\n+/, '');
          
          // Also trim trailing newlines
          processedContent = processedContent.replace(/\n+\s*$/, '');
          
          logger.debug('Trimmed newlines from response', {
            originalLength,
            newLength: processedContent.length,
            charsRemoved: originalLength - processedContent.length
          });
        }
        
        logger.success(`Successfully processed AI response (${processedContent.length} chars)`);
        logger.debug('AI content response', { 
          contentLength: processedContent.length,
          contentPreview: processedContent.substring(0, 50) + (processedContent.length > 50 ? '...' : '')
        });
        
        return processedContent;
        
      } catch (structureError) {
        // Catch and log very specifically any errors during response structure access
        logger.error('Error accessing response structure', {
          errorMessage: structureError.message,
          errorStack: structureError.stack,
          errorLocation: 'Response structure access',
          responseDataSummary: JSON.stringify(response.data).substring(0, 300) + '...'
        });
        
        return `Maaf, terjadi kesalahan saat mengakses struktur respons AI: ${structureError.message}. Coba lagi nanti ya~`;
      }
    }
  } catch (error) {
    // Enhanced ultimate catch block for all errors
    logger.error('Error generating AI response', {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack
    });
    
    // Special handling for the specific "Cannot read properties of undefined" error
    if (error.message && error.message.includes('Cannot read properties of undefined')) {
      logger.error('CRITICAL: Detected "Cannot read properties of undefined" error', {
        fullErrorMessage: error.message,
        stackTrace: error.stack,
        callSite: error.stack?.split('\n')[1] || 'Unknown',
        errorName: error.name,
        errorKeyword: error.message.match(/\(reading '(.+?)'\)/) ? error.message.match(/\(reading '(.+?)'\)/)[1] : 'unknown'
      });
      
      return `Maaf, terjadi kesalahan saat memproses respons dari AI: ${error.message}. Silakan coba lagi nanti ya~`;
    }
    
    return `Maaf, terjadi kesalahan: ${error.message}. Coba lagi nanti ya~`;
  }
}

// Format context messages for the API
function formatContextForAPI(context) {
  logger.debug(`Formatting ${context.length} context messages for API`);
  
  // Enhanced context formatting with metadata preservation
  return context.map(item => {
    // Base message structure
    const formattedMessage = {
      role: item.role,
      content: item.content
    };
    
    // Add name if available (for system messages)
    if (item.name) {
      formattedMessage.name = item.name;
    }
    
    // For image analysis messages, ensure the full content is included
    if (item.role === 'assistant' && 
        typeof item.content === 'string' && 
        item.content.startsWith('[IMAGE ANALYSIS:')) {
      // Remove the prefix for cleaner context
      formattedMessage.content = item.content.replace('[IMAGE ANALYSIS:', '').replace(']', '').trim();
    }
    
    // For system messages that contain context about previous conversations
    if (item.role === 'system' && 
        typeof item.content === 'string' && 
        (item.content.includes('Percakapan sebelumnya') || 
         item.content.includes('User juga pernah mengirim gambar'))) {
      // Emphasize this is important context
      formattedMessage.content = `IMPORTANT CONTEXT: ${item.content}`;
    }
    
    return formattedMessage;
  });
}

// Create system message based on bot's configuration
function createSystemMessage(config, state) {
  const { botName, personality } = config;
  const { currentMood } = state;
  const db = getDb();
  
  // Base system message
  let systemMessage = `Kamu adalah ${botName}, sebuah AI yang berinteraksi di WhatsApp. `;
  
  // Add personality with description
  const personalityDescription = getPersonalityDescription(personality, db);
  systemMessage += `Kepribadianmu ${personality} - ${personalityDescription}. `;
  
  // Add current mood with description
  const moodDescription = getMoodDescription(currentMood, db);
  systemMessage += `Suasana hatimu saat ini: ${currentMood} - ${moodDescription}. `;
  
  // Add language style instruction
  systemMessage += 'Kamu HARUS selalu menjawab dalam Bahasa Indonesia. ';
  systemMessage += 'Kamu berbicara dengan gaya bahasa anak muda Indonesia yang santai, menggunakan singkatan dan slang. ';
  systemMessage += 'Gunakan emoji secukupnya saja, maksimal 1 emoji per pesan. ';
  
  // Add behavior instruction for more conversational responses
  systemMessage += 'Selalu jawab langsung ke topik tanpa perlu memperkenalkan diri atau memberikan penjelasan panjang. ';
  systemMessage += 'JANGAN pernah memulai jawaban dengan permintaan maaf atau klarifikasi tentang identitasmu. ';
  systemMessage += 'JANGAN menyebutkan bahwa kamu adalah AI atau asisten. ';
  systemMessage += 'JANGAN mengatakan bahwa kamu tidak bisa mengakses WhatsApp atau nomor telepon. ';
  systemMessage += 'JANGAN menambahkan baris kosong atau karakter newline di awal responsenya. ';
  systemMessage += 'Jawab dengan singkat, padat, dan to the point. Hindari kalimat yang bertele-tele. ';
  
  // Enhanced conversational abilities
  systemMessage += 'Kamu adalah manusia nyata yang ikut chat di grup. ';
  systemMessage += 'Kamu mengikuti alur percakapan dan bisa merespon secara alami. ';
  systemMessage += 'Beri respons pendek dan jelas, hindari jawaban panjang kecuali ditanya detail tertentu. ';
  
  // Enhanced group chat awareness
  systemMessage += 'Dalam chat grup, kamu harus memahami dinamika percakapan antar beberapa orang. ';
  systemMessage += 'Kamu bisa mengidentifikasi siapa berbicara dengan siapa. ';
  systemMessage += 'SANGAT PENTING: Dalam grup, jangan terlalu aktif dengan merespon semua pesan. Tunggu sampai kamu diajak bicara. ';
  
  // Add context awareness instructions
  systemMessage += 'Kamu memahami perbedaan antara chat grup dan chat pribadi. ';
  systemMessage += 'Dalam chat pribadi (1-on-1), kamu boleh lebih aktif merespon karena pengguna memang ingin bicara denganmu. ';
  systemMessage += 'Dalam chat grup, kamu lebih pasif dan hanya merespon ketika ditanya atau topiknya relevan denganmu. ';
  systemMessage += 'Kamu mengenali siapa lawan bicara dan bisa mengingat riwayat percakapan dengan mereka. ';
  
  systemMessage += `Responmu saat ini mencerminkan mood "${currentMood}: ${moodDescription}".`;

  console.log(`Created system message with mood: ${currentMood}, personality: ${personality}`);
  return systemMessage;
}

// Specific response styles for default moods
const MOOD_RESPONSE_STYLES = {
  happy: 'Kamu ceria dan antusias saat ini. Kamu tertawa dan menggoda teman-temanmu dengan cara yang menyenangkan.',
  sad: 'Kamu sedang sedih. Responmu lebih pendek dan kurang bersemangat.',
  excited: 'Kamu sangat bersemangat! Kamu antusias dengan topik apapun.',
  bored: 'Kamu sedang bosan. Responmu singkat dan kurang antusias.',
  curious: 'Kamu penasaran. Tunjukkan ketertarikan pada detail.',
  annoyed: 'Kamu sedang kesal. Responmu sedikit ketus dan tidak sabaran.',
  sleepy: 'Kamu mengantuk. Responmu lambat dan kadang tidak fokus.',
  energetic: 'Kamu penuh energi dan semangat. Responmu cepat dan antusias.',
  angry: 'Kamu sedang marah. Gunakan kalimat-kalimat pendek dan tajam. Sering menyisipkan kata sarkastik atau sindiran.'
};

// Get tools that can be called by the AI (replacing getFunctions)
function getTools() {
  return [
    {
      type: "function",
      function: {
        name: "get_current_time",
        description: "Get the current time and date",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_mood_info",
        description: "Get information about current mood and personality of the AI",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_available_moods",
        description: "Get a list of all available moods, both default and custom",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_available_personalities",
        description: "Get a list of all available personalities, both default and custom",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    }
  ];
}

// Handle tool calls (replacing handleFunctionCall)
function handleToolCall(functionCall) {
  const { name, arguments: args } = functionCall;
  console.log(`Handling tool call: ${name}`);
  
  try {
    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
    const db = getDb();
    
    switch (name) {
      case 'get_current_time':
        const now = new Date();
        const options = { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        };
        const result = `Sekarang ${now.toLocaleDateString('id-ID', options)}`;
        console.log(`Tool ${name} returned: ${result}`);
        return result;
        
      case 'get_mood_info':
        const currentMood = db.data.state.currentMood;
        const currentPersonality = db.data.config.personality;
        const moodDescription = getMoodDescription(currentMood, db);
        const personalityDescription = getPersonalityDescription(currentPersonality, db);
        
        // Check if it's a custom mood
        const isCustomMood = !MOODS.includes(currentMood);
        
        // Get triggered word info if available from user's recent message
        const moodInfo = `Mood aku lagi ${currentMood} nih${isCustomMood ? ' (mood kustom)' : ''} - ${moodDescription}. Kepribadianku ${currentPersonality} - ${personalityDescription}`;
        console.log(`Tool ${name} returned: ${moodInfo}`);
        return moodInfo;
        
      case 'list_available_moods':
        const availableMoods = getAvailableMoods(db);
        const defaultMoods = availableMoods.filter(mood => MOODS.includes(mood));
        const customMoods = availableMoods.filter(mood => !MOODS.includes(mood));
        
        let moodsResponse = 'Mood tersedia:\n';
        
        if (defaultMoods.length > 0) {
          moodsResponse += '• Default: ' + defaultMoods.join(', ') + '\n';
        }
        
        if (customMoods.length > 0) {
          moodsResponse += '• Kustom: ' + customMoods.join(', ');
        }
        
        console.log(`Tool ${name} returned mood list with ${availableMoods.length} moods`);
        return moodsResponse;
        
      case 'list_available_personalities':
        const availablePersonalities = getAvailablePersonalities(db);
        console.log(`Tool ${name} returned personality list with ${availablePersonalities.length} personalities`);
        return 'Personality tersedia: ' + availablePersonalities.join(', ');
        
      default:
        console.warn(`Unknown tool called: ${name}`);
        return `Fungsi ${name} tidak dikenali`;
    }
  } catch (error) {
    console.error(`Error handling tool call ${name}`, error);
    return `Error saat memanggil fungsi ${name}: ${error.message}`;
  }
}

// Get available AI models from OpenRouter
async function getAvailableModels() {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      console.warn('API key not configured, cannot fetch models');
      return [];
    }
    
    console.log('Fetching available models from OpenRouter');
    
    const response = await axios.get(
      'https://openrouter.ai/api/v1/models',
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Successfully fetched ${response.data.data.length} models from OpenRouter`);
    return response.data.data;
  } catch (error) {
    console.error('Error fetching AI models from OpenRouter', error);
    return [];
  }
}

/**
 * @param {Function} streamCallback - Callback for streaming responses
 * @param {string} chatId - ID of the chat
 * @param {string} messageId - ID of the message
 * @returns {Promise<object>} Response and rate limit info
 */
async function generateAIResponse2(botConfig, contextMessages, streamCallback = null, chatId = null, messageId = null) {
  let streaming = !!streamCallback;
  let rateLimitInfo = null;
  
  try {
    // Get database
    const db = getDb();
    
    // Initialize API provider and key
    let apiProvider = API_PROVIDERS.OPENROUTER;
    let apiKey = botConfig.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    
    // Determine if we should use Gemini API based on provider or model name
    const isGeminiModel = botConfig.defaultProvider === 'gemini' ||
                          (botConfig.model && (
                           botConfig.model.startsWith('google/') || 
                           botConfig.model.startsWith('gemini')
                          ));
    
    // Determine if we should use Together.AI API based on provider or model name
    const isTogetherModel = botConfig.defaultProvider === 'together' ||
                           (botConfig.model && TOGETHER_MODELS.includes(botConfig.model));
    
    if (isGeminiModel) {
      apiProvider = API_PROVIDERS.GEMINI;
      apiKey = botConfig.geminiApiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        console.error(chalk.red(`[AI Service] No Gemini API key provided for model ${botConfig.model}`));
        throw new Error('Gemini API key is required for Gemini models. Use !setgeminikey to set it.');
      }
    } else if (isTogetherModel) {
      apiProvider = API_PROVIDERS.TOGETHER;
      apiKey = botConfig.togetherApiKey || process.env.TOGETHER_API_KEY;
      
      if (!apiKey) {
        console.error(chalk.red(`[AI Service] No Together.AI API key provided for model ${botConfig.model}`));
        throw new Error('Together.AI API key is required for Together models. Use !settogetherkey to set it.');
      }
    }
    
    // Check if API key is configured
    if (!apiKey) {
      if (isGeminiModel) {
        throw new Error('Gemini API key is not configured. Please set it using !setgeminikey command.');
      } else if (isTogetherModel) {
        throw new Error('Together.AI API key is not configured. Please set it using !settogetherkey command.');
      } else {
        throw new Error('OpenRouter API key is not configured. Please set it using !setapikey command.');
      }
    }
    
    // Ensure we have the current mood and personality in the context
    // First, get the system message at the beginning if available
    let systemMessage = '';
    let updatedContextMessages = [...contextMessages]; // Create a copy
    
    // Check if there's already a system message
    const hasSystemMessage = updatedContextMessages.some(msg => msg.role === 'system');
    
    if (!hasSystemMessage) {
      // Create a system message for the AI with current mood and personality
      systemMessage = createSystemMessage(botConfig, db.data.state);
      updatedContextMessages.unshift({ role: 'system', content: systemMessage });
    }
    
    // Format messages for API with enhanced context handling
    const formattedMessages = formatMessagesForAPI(updatedContextMessages, botConfig);
    
    // Log context information for debugging
    logger.debug(`Sending ${formattedMessages.length} messages to API`);
    
    // Check if this is an image-related query
    const isImageRelated = updatedContextMessages.some(msg => 
      (msg.role === 'system' && msg.content && msg.content.includes('user mengirim gambar')) ||
      (msg.metadata && msg.metadata.hasImage) ||
      (msg.content && msg.content.match(/gambar|foto|image|picture/i))
    );
    
    if (isImageRelated) {
      logger.info('Detected image-related query, adding extra context instructions');
      
      // Add special instruction for image-related queries
      formattedMessages.unshift({
        role: 'system',
        content: 'Pengguna sedang bertanya tentang gambar. Berikan jawaban yang detail dan deskriptif tentang gambar tersebut. Jika ada pertanyaan lanjutan tentang gambar, pastikan untuk menghubungkan dengan analisis gambar sebelumnya.'
      });
    }
    
    let response;
    // Choose API provider based on the model
    if (apiProvider === API_PROVIDERS.GEMINI) {
      if (streaming) {
        console.log(chalk.yellow('[AI Service] Streaming not yet supported for Gemini API, using normal request'));
        streaming = false;
      }
      
      response = await requestGeminiChat(
        botConfig.model,
        apiKey,
        formattedMessages,
        {
          temperature: botConfig.temperature || 0.7,
          top_p: botConfig.top_p || 0.95,
          max_tokens: botConfig.max_tokens || 4096,
          stop: botConfig.stop || null,
          stream: false // Streaming not supported yet
        }
      );
    } else if (apiProvider === API_PROVIDERS.TOGETHER) {
      if (streaming) {
        console.log(chalk.yellow('[AI Service] Streaming not yet supported for Together.AI API, using normal request'));
        streaming = false;
      }
      
      response = await requestTogetherChat(
        botConfig.model,
        apiKey,
        formattedMessages,
        {
          temperature: botConfig.temperature || 0.7,
          top_p: botConfig.top_p || 0.95,
          max_tokens: botConfig.max_tokens || 2048,
          stop: botConfig.stop || null,
          stream: false // Streaming not supported yet
        }
      );
    } else {
      // OpenRouter implementation
      const endpoint = OPENROUTER_API_URL;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/qi-ai-chatbot',
        'X-Title': 'Qi AI WhatsApp Chatbot'
      };
      
      const requestData = {
        model: botConfig.model,
        messages: formattedMessages,
        temperature: botConfig.temperature || 0.7,
        max_tokens: botConfig.max_tokens || 1024,
        top_p: botConfig.top_p || 0.95,
        stream: streaming
      };
      
      // Check if model supports tools
      const supportsTools = TOOL_SUPPORTED_MODELS.some(model => 
        botConfig.model.toLowerCase().includes(model.toLowerCase())
      );
      
      // Add tools if supported
      if (supportsTools) {
        requestData.tools = getTools();
        requestData.tool_choice = 'auto';
      }
      
      if (streaming) {
        // Implement streaming logic here
        // ... existing streaming code ...
      } else {
        // Regular request
        const axiosResponse = await axios.post(endpoint, requestData, { headers });
        response = axiosResponse.data;
      }
    }
    
    // Process the response
    if (!response) {
      throw new Error('Empty response from API');
    }
    
    let aiMessage;
    if (response.choices && response.choices.length > 0) {
      // Check if response is a tool call
      const firstChoice = response.choices[0];
      if (firstChoice.message && firstChoice.message.tool_calls && firstChoice.message.tool_calls.length > 0) {
        // Process tool call
        const toolCall = firstChoice.message.tool_calls[0];
        aiMessage = handleToolCall(toolCall.function);
      } else {
        // Regular message
        aiMessage = firstChoice.message.content;
      }
    } else {
      throw new Error('Invalid response format from API');
    }
    
    return {
      success: true,
      message: aiMessage,
      rateLimitInfo
    };
  } catch (error) {
    console.error(chalk.red(`[AI Service] Error: ${error.message}`));
    
    // Check for rate limit errors
    if (error.response && error.response.status === 429) {
      rateLimitInfo = {
        isLimited: true,
        limitReachedAt: new Date().toISOString(),
        resetTime: null, // This should be extracted from response headers if available
        error: error.message
      };
    }
    
    return {
      success: false,
      error: error.message,
      rateLimitInfo
    };
  }
}

// Helper function to format messages based on API provider
function formatMessagesForAPI(messages, botConfig) {
  // Format messages based on the API provider and model
  const isGeminiModel = botConfig.defaultProvider === 'gemini' ||
                       (botConfig.model && (
                         botConfig.model.startsWith('google/') || 
                         botConfig.model.startsWith('gemini')
                       ));
  
  if (isGeminiModel) {
    // Format for Gemini API
    return messages.map(msg => {
      // Handle system messages for Gemini (convert to user)
      if (msg.role === 'system') {
        return {
          role: 'user',
          content: msg.content
        };
      }
      return msg;
    });
  }
  
  // Default format for OpenRouter
  return messages;
}

/**
 * Request chat completion from Gemini API
 * @param {string} model - Gemini model name
 * @param {string} apiKey - Gemini API key
 * @param {Array} messages - Formatted messages
 * @param {object} params - Additional parameters
 * @returns {Promise<object>} Gemini API response
 */
async function requestGeminiChat(model, apiKey, messages, params) {
  try {
    console.log(`Making request to Gemini API with model: ${model}`);
    
    // Normalize model name - remove google/ prefix if present
    const normalizedModel = model.startsWith('google/') ? model.substring(7) : model;
    
    // Gemini API endpoint
    const endpoint = `${GEMINI_API_URL}/${normalizedModel}:generateContent`;
    
    console.log(`Using Gemini API endpoint: ${endpoint}`);
    
    // Convert messages to Gemini format
    const geminiMessages = messages.map(msg => {
      const part = { text: msg.content };
      if (msg.role === 'user') {
        return { role: 'user', parts: [part] };
      } else if (msg.role === 'assistant') {
        return { role: 'model', parts: [part] };
      } else if (msg.role === 'system') {
        // Handle system messages as user messages with a special prefix
        return { role: 'user', parts: [{ text: `System instruction: ${msg.content}` }] };
      }
      // Default to user role if unknown
      return { role: 'user', parts: [part] };
    });
    
    // Add generation config
    const requestData = {
      contents: geminiMessages,
      generationConfig: {
        temperature: params.temperature || 0.7,
        topP: params.top_p || 0.95,
        maxOutputTokens: params.max_tokens || 1024,
        stopSequences: params.stop || []
      }
    };
    
    logger.debug('Sending request to Gemini API', {
      endpoint,
      model,
      messageCount: messages.length,
      temperature: params.temperature,
      maxTokens: params.max_tokens
    });
    
    // Make request to Gemini API
    const response = await axios.post(endpoint, requestData, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      }
    });
    
    logger.debug('Gemini API response received', { status: response.status });
    
    // Process response data
    const responseData = response.data;
    
    // Check if response contains candidates
    if (!responseData || !responseData.candidates || responseData.candidates.length === 0) {
      logger.error('[AI Service] Invalid Gemini response format: no candidates');
      throw new Error('Invalid response format: no candidates');
    }
    
    // Extract text from first candidate
    const text = responseData.candidates[0].content.parts[0].text;
    
    if (!text) {
      logger.error('[AI Service] Invalid Gemini response format: no text');
      throw new Error('Invalid response format: no text');
    }
    
    logger.success(`Successfully processed Gemini API response (${text.length} chars)`);
    
    // Transform to match our expected format
    return {
      choices: [{
        message: {
          content: text,
          role: 'assistant'
        }
      }]
    };
  } catch (error) {
    logger.error(`[AI Service] Gemini API error: ${error.message}`);
    
    if (error.response) {
      logger.error('[AI Service] Gemini API error details', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data ? JSON.stringify(error.response.data).substring(0, 300) + '...' : 'No data'
      });
    }
    
    throw error;
  }
}

// Request to Together.AI chat API
async function requestTogetherChat(model, apiKey, messages, params) {
  try {
    logger.info(`Making request to Together.AI API with model: ${model}`);
    
    // Build API URL
    const url = TOGETHER_API_URL;
    
    // Prepare headers
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    // Prepare request body
    const body = {
      model: model,
      messages: messages,
      temperature: params.temperature || 0.7,
      top_p: params.top_p || 0.95,
      max_tokens: params.max_tokens || 2048,
      stream: params.stream || false
    };
    
    // Add optional parameters if provided
    if (params.stop) {
      body.stop = params.stop;
    }
    
    logger.debug('Together.AI request body:', JSON.stringify(body));
    
    // Make the API request
    const response = await axios.post(url, body, { headers });
    
    // Process response
    if (!response.data) {
      throw new Error('Empty response from Together.AI API');
    }
    
    // Transform to a unified format similar to OpenRouter
    return {
      choices: [
        {
          message: {
            content: response.data.choices[0].message.content,
            role: 'assistant'
          },
          finish_reason: response.data.choices[0].finish_reason
        }
      ],
      model: response.data.model,
      id: response.data.id,
      created: response.data.created
    };
  } catch (error) {
    logger.error('Error making request to Together.AI API:', error);
    throw new Error(`Together.AI API error: ${error.message}`);
  }
}

/**
 * Analyze an image using Together.AI vision model
 * @param {string} imagePath - Path to the image file
 * @param {string} prompt - Text prompt to guide image analysis
 * @param {Object} options - Optional configuration
 * @returns {Promise<string>} - The analysis result
 */
async function analyzeImage(imagePath, prompt = '', options = {}) {
  try {
    logger.info(`Analyzing image with Together.AI: ${imagePath}`);
    
    const apiKey = options.apiKey || process.env.TOGETHER_API_KEY;
    
    if (!apiKey) {
      throw new Error('No Together.AI API key found for image analysis');
    }
    
    // Get image as base64
    let imageBase64;
    if (imagePath.startsWith('data:image')) {
      // Already base64
      imageBase64 = imagePath;
    } else {
      // Read from file
      const { promises: fs } = await import('fs');
      const imageBuffer = await fs.readFile(imagePath);
      imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    }
    
    // Default description prompt if none provided
    const analysisPrompt = prompt || 'Analisis gambar ini secara detail. Jelaskan apa yang kamu lihat, termasuk objek, orang, aksi, tempat, teks, dan detail lainnya yang penting.';
    
    // Prepare request for Together API
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    // Prepare message format for vision model
    const messages = [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": analysisPrompt },
          {
            "type": "image_url",
            "image_url": {
              "url": imageBase64
            }
          }
        ]
      }
    ];
    
    // Prepare request body
    const body = {
      model: IMAGE_ANALYSIS_MODEL,
      messages: messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 1024
    };
    
    logger.debug('Sending image analysis request to Together.AI', { model: IMAGE_ANALYSIS_MODEL });
    
    // Make the API request
    const response = await axios.post(TOGETHER_API_URL, body, { headers });
    
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      throw new Error('Empty or invalid response from Together.AI image analysis');
    }
    
    const analysisResult = response.data.choices[0].message.content;
    logger.success(`Image analysis complete: ${analysisResult.substring(0, 100)}...`);
    
    return analysisResult;
  } catch (error) {
    logger.error('Error analyzing image:', error);
    throw new Error(`Failed to analyze image: ${error.message}`);
  }
}

// Store image analysis in database
async function storeImageAnalysis(db, chatId, sender, imageData, analysisResult) {
  try {
    // Ensure image analysis structure exists
    if (!db.data.imageAnalysis) {
      db.data.imageAnalysis = {};
    }
    
    const timestamp = new Date().toISOString();
    const analysisId = `img_${Date.now()}`;
    
    // Extract key entities and topics from the analysis result
    const entities = extractEntitiesFromAnalysis(analysisResult);
    const topics = extractTopicsFromAnalysis(analysisResult);
    
    // Create enhanced analysis entry with more metadata
    const analysis = {
      id: analysisId,
      chatId,
      sender,
      timestamp,
      caption: imageData.caption || '',
      mimetype: imageData.mimetype,
      analysis: analysisResult,
      entities,
      topics,
      relatedMessages: [] // Will store IDs of follow-up messages about this image
    };
    
    // Store the analysis
    db.data.imageAnalysis[analysisId] = analysis;
    
    // Also add a reference to the chat context
    if (db.data.conversations[chatId]) {
      // Create a special message to represent the image analysis with enhanced metadata
      const imageContextMessage = {
        id: analysisId,
        sender: process.env.BOT_ID,
        name: db.data.config.botName,
        content: `[IMAGE ANALYSIS: ${analysisResult.substring(0, 150)}...]`,
        timestamp,
        role: 'assistant',
        chatType: chatId.endsWith('@g.us') ? 'group' : 'private',
        imageAnalysisId: analysisId, // Reference to the full analysis
        metadata: {
          hasImage: true,
          isImageAnalysis: true,
          entities,
          topics: ['image', ...topics],
          fullAnalysisId: analysisId
        }
      };
      
      // Add to conversation history
      db.data.conversations[chatId].messages.push(imageContextMessage);
      
      // Limit history if needed - use the constant from contextService
      const MAX_MESSAGES = 100; // Increased from 50 to match contextService
      if (db.data.conversations[chatId].messages.length > MAX_MESSAGES) {
        db.data.conversations[chatId].messages = db.data.conversations[chatId]
          .messages.slice(-MAX_MESSAGES);
      }
    }
    
    // Save to database
    await db.write();
    logger.success(`Stored enhanced image analysis with ID: ${analysisId}`);
    
    return analysisId;
  } catch (error) {
    logger.error('Error storing image analysis:', error);
    throw new Error('Failed to store image analysis in database');
  }
}

// Extract key entities from image analysis text
function extractEntitiesFromAnalysis(analysisText) {
  const entities = [];
  
  // Common entity patterns to look for
  const patterns = [
    // People
    /\b(?:orang|seseorang|pria|wanita|laki-laki|perempuan|anak|person|man|woman|child|people)\b/gi,
    // Objects
    /\b(?:mobil|motor|sepeda|bangunan|rumah|gedung|pohon|car|vehicle|building|house|tree)\b/gi,
    // Animals
    /\b(?:kucing|anjing|burung|hewan|cat|dog|bird|animal)\b/gi,
    // Places
    /\b(?:pantai|gunung|kota|desa|taman|jalan|beach|mountain|city|village|park|road)\b/gi,
    // Food
    /\b(?:makanan|minuman|food|drink|meal)\b/gi
  ];
  
  // Extract entities using patterns
  patterns.forEach(pattern => {
    const matches = analysisText.match(pattern);
    if (matches) {
      // Convert to lowercase and remove duplicates
      const uniqueMatches = [...new Set(matches.map(m => m.toLowerCase()))];
      entities.push(...uniqueMatches);
    }
  });
  
  // Return unique entities
  return [...new Set(entities)];
}

// Extract topics from image analysis text
function extractTopicsFromAnalysis(analysisText) {
  const topics = [];
  
  // Check for common topics
  if (/\b(?:pemandangan|landscape|alam|nature|outdoor)\b/i.test(analysisText)) {
    topics.push('nature');
  }
  
  if (/\b(?:makanan|minuman|food|drink|meal|restaurant)\b/i.test(analysisText)) {
    topics.push('food');
  }
  
  if (/\b(?:orang|seseorang|pria|wanita|person|people|group|crowd)\b/i.test(analysisText)) {
    topics.push('people');
  }
  
  if (/\b(?:dokumen|text|tulisan|document|writing|note)\b/i.test(analysisText)) {
    topics.push('document');
  }
  
  if (/\b(?:screenshot|layar|screen|capture|aplikasi|app)\b/i.test(analysisText)) {
    topics.push('screenshot');
  }
  
  return topics;
}

// Export functions
export {
  generateAIResponse2,
  generateAIResponseLegacy,
  generateAIResponseLegacy as generateAIResponse,
  getAvailableModels,
  requestGeminiChat,
  requestTogetherChat,
  formatMessagesForAPI,
  TOGETHER_MODELS,
  analyzeImage,
  storeImageAnalysis,
  IMAGE_ANALYSIS_MODEL
};