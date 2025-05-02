import axios from 'axios';
import { getDb } from '../database/index.js';
import chalk from 'chalk';
import { 
  getAvailableMoods, 
  getAvailablePersonalities, 
  getMoodDescription, 
  getPersonalityDescription,
  MOODS,
  getCharacterKnowledge,
  PERSONALITIES
} from './personalityService.js';
import { logApiRequest } from './apiLogService.js';
import { requestNvidiaChat } from './aiRequest.js';
import fetchUrlContent from '../tools/fetchUrlContent.js';

// Constants for API URLs
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1/models';
const TOGETHER_API_URL = 'https://api.together.xyz/v1/chat/completions';

// List of models that support tool/function calling
const TOOL_SUPPORTED_MODELS = [
  // Meta Llama models
  'meta-llama/Llama-4-Maverick-17B',
  'meta-llama/Llama-4-Scout-17B',
  'meta-llama/Meta-Llama-3.1-8B',
  'meta-llama/Meta-Llama-3.1-70B',
  'meta-llama/Meta-Llama-3.1-405B',
  'meta-llama/Llama-3.3-70B',
  'meta-llama/Llama-3.2-3B',
  'meta/llama-3.3-70b-instruct',
  // Qwen models
  'Qwen/Qwen2.5-7B',
  'Qwen/Qwen2.5-72B',
  'Qwen/Qwen3-235B',
  // Deepseek models
  'deepseek-ai/DeepSeek-V3',
  // Mistral models
  'mistralai/Mistral-Small-24B',
  // Claude models
  'claude-3-5-sonnet',
  'claude-3-haiku',
  'claude-3-opus',
  // OpenAI models
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  // Google models
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash'
];

// Model definitions for Together.AI
const TOGETHER_MODELS = [
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
  'meta-llama/Llama-3.3-8B-Instruct-Turbo-Free',
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

// New function for generating analysis of message content to determine mood and personality
async function generateAnalysis(prompt, options = {}, context = []) {
  try {
    logger.info('Generating analysis for mood/personality determination');
    
    const db = getDb();
    const { config } = db.data;
    
    // Use a simpler, faster model for analysis to reduce token usage
    // Prefer the current provider but with a more efficient model
    let provider = 'gemini';
    let model = null;
    
    // Select appropriate model based on provider
    if (provider === 'gemini') {
      model = 'google/gemini-2.0-flash-lite'; // Faster Gemini model
    } else if (provider === 'together') {
      model = 'meta-llama/Llama-3.3-8B-Instruct-Turbo-Free'; // Smaller, faster Together model
    } else {
      // OpenRouter - use a smaller, efficient model
      model = 'anthropic/claude-3-haiku';
    }
    
    // Get appropriate API key
    let apiKey;
    if (provider === 'gemini') {
      apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    } else if (provider === 'together') {
      apiKey = config.togetherApiKey || process.env.TOGETHER_API_KEY;
    } else if (provider === 'nvidia') {
      apiKey = config.nvidiaApiKey || process.env.NVIDIA_API_KEY;
    } else {
      apiKey = process.env.OPENROUTER_API_KEY;
    }
    
    if (!apiKey) {
      logger.warning(`No API key configured for ${provider}, falling back to OpenRouter`);
      provider = 'openrouter';
      model = 'anthropic/claude-3-haiku';
      apiKey = process.env.OPENROUTER_API_KEY;
      
      if (!apiKey) {
        throw new Error('No API keys configured for any provider');
      }
    }
    
    // Prepare messages for API
    const messages = [
      { role: 'system', content: 'You are an expert at analyzing message tone, emotion, and context. Your task is to determine the most appropriate mood and personality for a conversational AI to adopt when responding.' },
      { role: 'system', content: 'Here is the conversation history:' },
      ...context.map(msg => ({
        role: msg.role,
        content: `Sender: ${msg.name} at ${msg.timestamp}: ${msg.content}`,
        name: msg.name
      })),
      { role: 'user', content: prompt }
    ];
    
    // Set parameters
    const params = {
      temperature: options.temperature || 0.3, // Lower temperature for more consistent analysis
      max_tokens: options.max_tokens || 300,
      top_p: options.top_p || 0.95,
      stream: false
    };
    
    // Make API request based on provider
    let response;
    if (provider === 'gemini') {
      // Format messages for Gemini
      const formattedMessages = formatMessagesForAPI(messages, { defaultProvider: 'gemini' });
      const geminiResponse = await requestGeminiChat(model, apiKey, formattedMessages, params);
      
      // For Gemini, the response is already the text content
      response = geminiResponse;
      
      // If the response is an object (newer Gemini API), extract the text content
      if (typeof response === 'object' && response.choices && response.choices[0] && response.choices[0].message) {
        response = response.choices[0].message.content;
        logger.debug('Extracted text content from Gemini response object');
      }
    } else if (provider === 'together') {
      const togetherResponse = await requestTogetherChat(model, apiKey, messages, params);
      
      // For Together, extract the text content from the response
      if (typeof togetherResponse === 'object' && togetherResponse.choices && togetherResponse.choices[0]) {
        response = togetherResponse.choices[0].message.content;
      } else {
        response = togetherResponse;
      }
    } else {
      // OpenRouter request
      const apiResponse = await axios.post(
        OPENROUTER_API_URL,
        {
          model: model,
          messages: messages,
          ...params
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://github.com/Qi-Blockchain/qi-ai-chatbot'
          }
        }
      );
      
      // Log API usage
      await logApiRequest('openrouter', model, messages, apiResponse.data, null);
      
      // Extract response text
      response = apiResponse.data.choices[0]?.message?.content || '';
    }
    
    logger.success('Successfully generated mood/personality analysis');
    return response;
  } catch (error) {
    logger.error('Error generating analysis:', error);
    throw error;
  }
}

// Generate a response using the AI model
async function generateAIResponseLegacy(message, context, botData, senderName = null) {
  try {
    const startTime = Date.now();
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
    
    // Prepare messages array for the API
    const messages = [
      { role: 'system', content: systemMessage },
      ...formatContextForAPI(context),
      { role: 'user', content: message, name: senderName }
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
            stream: false,
            tools: TOOL_SUPPORTED_MODELS.some(model => 
              config.model.toLowerCase().includes(model.toLowerCase())
            ) ? getTools() : null // Pass tools to Gemini if supported
          }
        );
        
        if (!response) {
          logger.error('Empty response from Gemini API');
          return 'Maaf, Gemini API tidak memberikan respons. Coba lagi nanti ya~';
        }
        
        logger.success(`Successfully processed Gemini API response`);
        
        // Process response - check for tool calls first
        if (response.choices && response.choices.length > 0 && 
            response.choices[0].message && response.choices[0].message.tool_calls) {
          
          // Handle tool calls
          logger.info('Gemini returned tool calls, processing...');
          
          try {
            const toolCall = response.choices[0].message.tool_calls[0];
            const result = await handleToolCall(toolCall.function);
            return result;
          } catch (toolError) {
            logger.error('Error handling tool calls from Gemini', toolError);
            return `Maaf, terjadi kesalahan saat memproses tool calls: ${toolError.message}`;
          }
        }
        
        // If no tool calls, process as normal text response
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
            stream: false,
            tools: TOOL_SUPPORTED_MODELS.some(model => 
              config.model.toLowerCase().includes(model.toLowerCase())
            ) ? getTools() : null // Pass tools to Together API if supported
          }
        );
        
        if (!response) {
          logger.error('Empty response from Together.AI API');
          return 'Maaf, Together.AI API tidak memberikan respons. Coba lagi nanti ya~';
        }
        
        logger.success(`Successfully processed Together.AI API response`);
        
        // Check for tool calls first
        if (response.choices && response.choices.length > 0 && 
            response.choices[0].message && response.choices[0].message.tool_calls) {
          
          // Handle tool calls
          logger.info('Together.AI returned tool calls, processing...');
          
          try {
            const toolCall = response.choices[0].message.tool_calls[0];
            const result = await handleToolCall(toolCall.function);
            return result;
          } catch (toolError) {
            logger.error('Error handling tool calls from Together.AI', toolError);
            return `Maaf, terjadi kesalahan saat memproses tool calls: ${toolError.message}`;
          }
        }
        
        // If no tool calls, process as normal text response
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
        
        // Prepare a readable error message
        let errorMessage = togetherError.message || 'Unknown error';
        let errorCode = togetherError.response?.status || 'unknown';
        let errorDetail = '';
        
        if (togetherError.response?.data?.error?.message) {
          errorDetail = togetherError.response.data.error.message;
          logger.debug(`Together.AI detailed error: ${errorDetail}`);
        }
        
        // Check for specific error types to inform fallback decisions
        const isRateLimited = errorCode === 429 || 
          RATE_LIMIT_ERRORS.some(term => 
            errorMessage.toLowerCase().includes(term) || 
            (errorDetail && errorDetail.toLowerCase().includes(term))
          );
        
        const isContextTooLong = 
          errorCode === 422 && 
          (errorDetail.includes('tokens + `max_new_tokens`') || 
           errorDetail.includes('Input validation error') ||
           errorDetail.includes('token limit'));
           
        const isModelUnavailable = 
          errorCode === 404 || 
          errorMessage.includes('not found') || 
          errorMessage.includes('unavailable');
        
        // For these error types, try Gemini as fallback
        if (isRateLimited || isContextTooLong || isModelUnavailable) {
          // Log appropriate message based on error type
          if (isRateLimited) {
          logger.warning('Together.AI API rate limited, falling back to NVIDIA API');
          } else if (isContextTooLong) {
            logger.warning(`Together.AI context too long (${errorDetail}), falling back to NVIDIA API`);
          } else if (isModelUnavailable) {
            logger.warning(`Together.AI model unavailable (${errorDetail}), falling back to NVIDA API`);
          }

          const formattedMessages = formatMessagesForAPI(messages, config);
          const nvidiaApiKey = config.nvidiaApiKey || process.env.NVIDIA_API_KEY;
          const nvidiaModel = config.nvidiaModel || process.env.NVIDIA_MODEL;
          
          try {
            const response = await requestNvidiaChat(
              nvidiaModel,
              nvidiaApiKey,
              formattedMessages,
              {
                temperature: 0.7,
                top_p: 0.9,
                max_tokens: 1000,
                stop: null,
                stream: false,
                tools: TOOL_SUPPORTED_MODELS.some(model => 
                  config.model.toLowerCase().includes(model.toLowerCase())
                ) ? getTools() : null // Pass tools to NVIDIA API if supported
              }
            );
            
            if (!response) {
              logger.error('Empty response from NVIDIA API');
              return 'Maaf, NVIDIA API tidak memberikan respons. Coba lagi nanti ya~';
            }
            
            logger.success(`Successfully processed NVIDIA API response`);
            
            // Check for tool calls first
            if (response.choices && response.choices.length > 0 && 
                response.choices[0].message && response.choices[0].message.tool_calls) {
              
              // Handle tool calls
              logger.info('NVIDIA returned tool calls, processing...');
              
              try {
                const toolCall = response.choices[0].message.tool_calls[0];
                const result = await handleToolCall(toolCall.function);
                return result;
              } catch (toolError) {
                logger.error('Error handling tool calls from NVIDIA', toolError);
                return `Maaf, terjadi kesalahan saat memproses tool calls: ${toolError.message}`;
              }
            }
            
            // If no tool calls, process as normal text response
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
              logger.error('Invalid response format from NVIDIA API');
              return 'Maaf, format respons dari NVIDIA API tidak valid. Coba lagi nanti ya~';
            }
          } catch (nvidiaError) {
            logger.error('NVIDIA API request failed', nvidiaError);
            let errorMessage = nvidiaError.message || 'Unknown error';
            let errorCode = nvidiaError.response?.status || 'unknown';
            let errorDetail = '';
            
            if (nvidiaError.response?.data?.error?.message) {
              errorDetail = nvidiaError.response.data.error.message;
              logger.debug(`NVIDIA detailed error: ${errorDetail}`);
            }
            
            // Check for specific error types to inform fallback decisions
            const isRateLimited = errorCode === 429 || 
              RATE_LIMIT_ERRORS.some(term => 
                errorMessage.toLowerCase().includes(term) || 
                (errorDetail && errorDetail.toLowerCase().includes(term))
              );
            
            const isContextTooLong = 
              errorCode === 422 && 
              (errorDetail.includes('tokens + `max_new_tokens`') || 
               errorDetail.includes('Input validation error') ||
               errorDetail.includes('token limit'));
               
            const isModelUnavailable = 
              errorCode === 404 || 
              errorMessage.includes('not found') || 
              errorMessage.includes('unavailable');
            
            // For these error types, try Gemini as fallback
            if (isRateLimited || isContextTooLong || isModelUnavailable) {
              // Log appropriate message based on error type
              if (isRateLimited) {
              logger.warning('NVIDIA API rate limited, falling back to Gemini API');
              } else if (isContextTooLong) {
                logger.warning(`NVIDIA context too long (${errorDetail}), falling back to Gemini API`);
              } else if (isModelUnavailable) {
                logger.warning(`NVIDIA model unavailable (${errorDetail}), falling back to Gemini API`);
              }
              // Check if Gemini API key is available
              const geminiApiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
              
              if (!geminiApiKey) {
                logger.warning('Gemini API key not configured for fallback');
                return `Maaf, terjadi kesalahan dengan Together.AI API: ${isContextTooLong ? 'Pesan terlalu panjang' : errorMessage}. Gemini API key tidak tersedia untuk fallback. Coba lagi nanti ya~`;
              }
              
              try {
                // Convert messages to Gemini format
                const formattedMessages = formatMessagesForAPI(messages, config);
                
                // For context length issues, reduce message count by truncating history
                let truncatedMessages = formattedMessages;
                
                // Use Gemini 2.0 Flash as fallback for most cases
                // For context too long, try Gemini 2.0 Pro which has larger context window
                const fallbackModel = 'gemini-2.0-flash';
                logger.info(`Falling back to Gemini API with model: ${fallbackModel}`);
                
                // Call Gemini API
                const response = await requestGeminiChat(
                  fallbackModel,
                  geminiApiKey,
                  truncatedMessages,
                  {
                    temperature: 0.7,
                    top_p: 0.95,
                    max_tokens: 1000,
                    tools: TOOL_SUPPORTED_MODELS.some(model => 
                      config.model.toLowerCase().includes(model.toLowerCase())
                    ) ? getTools() : null // Pass tools to Gemini fallback if supported
                  }
                );
                
                if (!response) {
                  logger.error('Empty response from fallback Gemini API');
                  return 'Maaf, Together.AI API gagal dan Gemini API tidak memberikan respons. Coba lagi nanti ya~';
                }
                
                logger.success(`Successfully processed fallback Gemini API response`);
                
                // Check for tool calls in Gemini fallback response
                if (response.choices && response.choices.length > 0 && 
                    response.choices[0].message && response.choices[0].message.tool_calls) {
                  
                  // Handle tool calls from Gemini fallback
                  logger.info('Gemini fallback returned tool calls, processing...');
                  
                  try {
                    const toolCall = response.choices[0].message.tool_calls[0];
                    const result = await handleToolCall(toolCall.function);
                    return result;
                  } catch (toolError) {
                    logger.error('Error handling tool calls from Gemini fallback', toolError);
                    return `Maaf, terjadi kesalahan saat memproses tool calls: ${toolError.message}`;
                  }
                }
                
                // Process normal text response from Gemini fallback
                if (response.choices && response.choices.length > 0 && 
                    response.choices[0].message && response.choices[0].message.content) {
                  
                  let processedContent = response.choices[0].message.content;
                  
                  // Trim leading/trailing newlines
                  if (processedContent.match(/^\s*\n+/) || processedContent.match(/\n+\s*$/)) {
                    processedContent = processedContent.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
                  }
                  
                  logger.success(`Successfully processed fallback AI response (${processedContent.length} chars)`);
                  return processedContent;
                } else {
                  logger.error('Invalid response format from fallback Gemini API');
                  return 'Maaf, format respons dari Gemini API fallback tidak valid. Coba lagi nanti ya~';
                }
              } catch (fallbackError) {
                logger.error('Fallback to Gemini API failed', fallbackError);
                return `Maaf, terjadi kesalahan dengan Together.AI API, NVIDIA API, dan Gemini API fallback: ${fallbackError.message}. Coba lagi nanti ya~`;
              }
            } else {
              const errorResponse = `Maaf, terjadi kesalahan dengan Together.AI API, NVIDIA API, dan Gemini API fallback: ${errorDetail || errorMessage}. Coba lagi nanti ya~`;
              logger.debug('Returning error response', { errorResponse });
              return errorResponse;
            }
          }
          
        } else {
          // For other errors, return a helpful message
          const errorResponse = `Maaf, terjadi kesalahan dengan Together.AI API: ${errorDetail || errorMessage}. Coba lagi nanti ya~`;
          logger.debug('Returning error response', { errorResponse });
          return errorResponse;
        }
      }
    } else {
      // OpenRouter implementation
      logger.info(`Making request to OpenRouter API with model: ${config.model}`);
      
      // Prepare request body based on tool support
      let requestBody = {
        model: config.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9
      };
      
      // Only add tools if the model supports them
      if (TOOL_SUPPORTED_MODELS.some(model => 
        config.model.toLowerCase().includes(model.toLowerCase())
      )) {
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
        
        // Log API request and response
        await logApiRequest(
          OPENROUTER_API_URL,
          API_PROVIDERS.OPENROUTER, 
          config.model,
          {
            method: 'POST',
            url: OPENROUTER_API_URL,
            headers: {
              'Authorization': 'Bearer *** REDACTED ***',
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/qi-ai-chatbot',
              'X-Title': 'Qi AI WhatsApp Chatbot'
            },
            data: requestBody
          },
          {
            status: response.status,
            statusText: response.statusText,
            data: response.data
          },
          {
            executionTime: Date.now() - startTime,
            messageCount: messages.length,
            promptTokens: response.data.usage?.prompt_tokens || 0,
            completionTokens: response.data.usage?.completion_tokens || 0,
            success: true
          }
        );
        
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
        
        // Log the failed API request
        await logApiRequest(
          OPENROUTER_API_URL,
          API_PROVIDERS.OPENROUTER,
          config.model,
          {
            method: 'POST',
            url: OPENROUTER_API_URL,
            headers: {
              'Authorization': 'Bearer *** REDACTED ***',
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/qi-ai-chatbot',
              'X-Title': 'Qi AI WhatsApp Chatbot'
            },
            data: requestBody
          },
          apiError.response ? {
            status: apiError.response.status,
            statusText: apiError.response.statusText,
            data: apiError.response.data
          } : { error: apiError.message },
          {
            executionTime: Date.now() - startTime,
            messageCount: messages.length,
            success: false,
            error: apiError.message
          }
        );
        
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
  
  // Add character knowledge if exists
  const characterKnowledge = getCharacterKnowledge(db);
  if (characterKnowledge) {
    systemMessage += `Kamu tahu bahwa: ${characterKnowledge}. `;
  }
  
  // Add web search capability information
  const hasSearchCapability = process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (hasSearchCapability) {
    systemMessage += `Kamu dapat mencari informasi di internet menggunakan function calling. `;
    systemMessage += `Gunakan function search_web untuk mencari informasi terbaru, dan fetch_url_content untuk mengambil konten dari URL. `;
    systemMessage += `Gunakan kemampuan ini ketika ditanya tentang topik spesifik, berita terbaru, atau informasi faktual yang mungkin kamu tidak tahu. `;
  }
  
  // Add additional instructions
  systemMessage += `Selalu jawab dalam Bahasa Indonesia kecuali diminta menggunakan bahasa lain. `;
  systemMessage += `Hindari penyebutan "sebagai AI" atau "sebagai asisten AI". `;
  systemMessage += `Pada percakapan grup, kamu hanya merespon ketika disebutkan namamu (${botName}). `;
  
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
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description: "Search the web for current information on any topic",
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
    },
    {
      type: "function",
      function: {
        name: "fetch_url_content",
        description: "Fetch and extract the main content from a URL",
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
    }
  ];
}

// Handle tool calls (replacing handleFunctionCall)
async function handleToolCall(functionCall) {
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
        
        const moodInfo = `Mood saat ini: ${currentMood} - ${moodDescription}\nPersonality saat ini: ${currentPersonality} - ${personalityDescription}`;
        console.log(`Tool ${name} returned mood and personality info`);
        return moodInfo;
        
      case 'list_available_moods':
        const availableMoods = getAvailableMoods(db);
        const defaultMoods = availableMoods.filter(mood => MOODS.includes(mood));
        const customMoods = availableMoods.filter(mood => !MOODS.includes(mood));
        
        let moodsResult = 'Daftar Mood Tersedia:\n\n';
        moodsResult += 'Mood Default: ' + defaultMoods.join(', ') + '\n\n';
        
        if (customMoods.length > 0) {
          moodsResult += 'Mood Kustom: ' + customMoods.join(', ');
        } else {
          moodsResult += 'Belum ada mood kustom.';
        }
        
        console.log(`Tool ${name} returned list of moods`);
        return moodsResult;
        
      case 'list_available_personalities':
        const availablePersonalities = getAvailablePersonalities(db);
        const defaultPersonalities = availablePersonalities.filter(p => PERSONALITIES.includes(p));
        const customPersonalities = availablePersonalities.filter(p => !PERSONALITIES.includes(p));
        
        let personalitiesResult = 'Daftar Personality Tersedia:\n\n';
        personalitiesResult += 'Personality Default: ' + defaultPersonalities.join(', ') + '\n\n';
        
        if (customPersonalities.length > 0) {
          personalitiesResult += 'Personality Kustom: ' + customPersonalities.join(', ');
        } else {
          personalitiesResult += 'Belum ada personality kustom.';
        }
        
        console.log(`Tool ${name} returned list of personalities`);
        return personalitiesResult;
        
      case 'search_web':
        if (!parsedArgs.query) {
          console.log(`Tool ${name} failed: Missing query parameter`);
          return 'Error: Missing query parameter. Please provide a search query.';
        }
        
        console.log(`Tool ${name} executing with query: ${parsedArgs.query}`);
        const searchResult = await searchWeb(parsedArgs.query);
        
        if (!searchResult.success) {
          console.log(`Tool ${name} failed: ${searchResult.error}`);
          return `Error mencari: ${searchResult.message}`;
        }
        
        console.log(`Tool ${name} returned ${searchResult.results?.length || 0} results`);
        return searchResult.message;
        
      case 'fetch_url_content':
        if (!parsedArgs.url) {
          console.log(`Tool ${name} failed: Missing url parameter`);
          return 'Error: Missing url parameter. Please provide a valid URL.';
        }
        
        console.log(`Tool ${name} executing with URL: ${parsedArgs.url}`);
        // Pass the original user query to the fetchUrlContent function
        const userQuery = parsedArgs.user_query || parsedArgs.query || '';
        const contentResult = await fetchUrlContent(parsedArgs.url, { userQuery });
        
        if (!contentResult.success) {
          console.log(`Tool ${name} failed: ${contentResult.error}`);
          return `Error mengambil konten URL: ${contentResult.message}`;
        }
        
        console.log(`Tool ${name} successfully fetched content from URL`);
        return contentResult.message;
        
      default:
        console.log(`Unknown tool: ${name}`);
        return `Error: Tool "${name}" tidak tersedia.`;
    }
  } catch (error) {
    console.error(`Error handling tool call ${name}:`, error);
    return `Error mengeksekusi ${name}: ${error.message}`;
  }
}

// Get available AI models from OpenRouter
async function getAvailableModels() {
  const startTime = Date.now();
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
    
    // Log API request and response
    await logApiRequest(
      'https://openrouter.ai/api/v1/models',
      API_PROVIDERS.OPENROUTER,
      'models-list',
      {
        method: 'GET',
        url: 'https://openrouter.ai/api/v1/models',
        headers: {
          'Authorization': 'Bearer *** REDACTED ***',
          'Content-Type': 'application/json'
        }
      },
      {
        status: response.status,
        statusText: response.statusText,
        data: response.data
      },
      {
        executionTime: Date.now() - startTime,
        success: true
      }
    );
    
    console.log(`Successfully fetched ${response.data.data.length} models from OpenRouter`);
    return response.data.data;
  } catch (error) {
    console.error('Error fetching AI models from OpenRouter', error);
    
    // Log failed API request
    await logApiRequest(
      'https://openrouter.ai/api/v1/models',
      API_PROVIDERS.OPENROUTER,
      'models-list',
      {
        method: 'GET',
        url: 'https://openrouter.ai/api/v1/models',
        headers: {
          'Authorization': 'Bearer *** REDACTED ***',
          'Content-Type': 'application/json'
        }
      },
      error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : { error: error.message },
      {
        executionTime: Date.now() - startTime,
        success: false,
        error: error.message
      }
    );
    
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
  try {
    logger.info(`Generating AI response with ${contextMessages.length} context messages`);
    
    // Get current provider from config
    const provider = botConfig.defaultProvider || 'openrouter';
    const modelId = botConfig.model || (provider === 'gemini' ? 'gemini-2.0-pro' : 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free');
    
    // Log what we're using
    logger.info(`Using provider: ${provider}, model: ${modelId}`);
    
    // Convert format if needed
    const formattedMessages = formatMessagesForAPI(contextMessages, botConfig);
    
    // Check if context is too large for the model
    let isContextTooLarge = formattedMessages.reduce((total, msg) => total + (msg.content?.length || 0), 0) > 32000;
    
    // If context seems too large, preemptively reduce it
    let messagesToUse = formattedMessages;
    if (isContextTooLarge) {
      logger.warning('Context is likely too large, preemptively reducing');
      messagesToUse = reduceContextSize(formattedMessages, {
        maxMessages: 15,
        alwaysKeepSystemMessages: true,
        alwaysKeepLastUserMessage: true
      });
    }
    
    // Main API request logic with error handling and fallbacks
    try {
      if (provider === 'gemini') {
        // Gemini provider
        const apiKey = botConfig.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
          throw new Error('Gemini API key not configured');
        }
        
        const response = await requestGeminiChat(
          modelId,
          apiKey,
          messagesToUse,
          {
            temperature: 0.7,
            top_p: 0.95,
            max_tokens: 1000,
            tools: TOOL_SUPPORTED_MODELS.some(model => 
              modelId.toLowerCase().includes(model.toLowerCase())
            ) ? getTools() : null
          }
        );
        
        // Check for function calls
        if (response.choices?.[0]?.message?.tool_calls?.length > 0) {
          const toolCall = response.choices[0].message.tool_calls[0];
          const result = await handleToolCall(toolCall.function);
          return result;
        }
        
        return response.choices[0].message.content;
      } 
      else if (provider === 'together') {
        // Together.AI provider
        const apiKey = botConfig.togetherApiKey || process.env.TOGETHER_API_KEY;
    if (!apiKey) {
          throw new Error('Together.AI API key not configured');
        }
        
        try {
          const response = await requestTogetherChat(
            modelId,
            apiKey,
            messagesToUse,
            {
              temperature: 0.7,
              top_p: 0.95,
              max_tokens: 1000,
              tools: TOOL_SUPPORTED_MODELS.some(model => 
                modelId.toLowerCase().includes(model.toLowerCase())
              ) ? getTools() : null
            }
          );
          
          // Check for function calls
          if (response.choices?.[0]?.message?.tool_calls?.length > 0) {
            const toolCall = response.choices[0].message.tool_calls[0];
            const result = await handleToolCall(toolCall.function);
            return result;
          }
          
          return response.choices[0].message.content;
        }
        catch (togetherError) {
          // Check for context too long errors
          let errorDetail = togetherError.response?.data?.error?.message || '';
          let errorCode = togetherError.response?.status || 'unknown';
          
          const isContextTooLong = 
            errorCode === 422 && 
            (errorDetail.includes('tokens + `max_new_tokens`') || 
             errorDetail.includes('Input validation error') ||
             errorDetail.includes('token limit'));
             
          if (isContextTooLong) {
            logger.warning(`Together.AI context too long (${errorDetail}), reducing context and retrying`);
            
            // Try with reduced context
            const reducedMessages = reduceContextSize(messagesToUse, {
              maxMessages: Math.floor(messages.length * 0.6), // More aggressive reduction
              alwaysKeepSystemMessages: true,
              alwaysKeepLastUserMessage: true,
            });
            
            const retryResponse = await requestTogetherChat(
              modelId,
        apiKey,
              reducedMessages,
              {
                temperature: 0.7,
                top_p: 0.95,
                max_tokens: 1000,
                tools: TOOL_SUPPORTED_MODELS.some(model => 
                  modelId.toLowerCase().includes(model.toLowerCase())
                ) ? getTools() : null
              }
            );
            
            // Check for function calls in retry
            if (retryResponse.choices?.[0]?.message?.tool_calls?.length > 0) {
              const toolCall = retryResponse.choices[0].message.tool_calls[0];
              const result = await handleToolCall(toolCall.function);
              return result;
            }
            
            return retryResponse.choices[0].message.content;
          }
          
          // If error is not about context length, or retry also failed, fall back to Gemini
          logger.warning(`Together.AI error (${togetherError.message}), falling back to Gemini`);
          
          // Check if Gemini API key is available for fallback
          const geminiApiKey = botConfig.geminiApiKey || process.env.GEMINI_API_KEY;
          if (!geminiApiKey) {
            throw new Error('Together.AI failed and Gemini API key not configured for fallback');
          }
          
          // Use reduced context for fallback
          const fallbackMessages = isContextTooLong ? 
            reduceContextSize(messagesToUse, { maxMessages: 10 }) : 
            messagesToUse;
          
          const geminiResponse = await requestGeminiChat(
            'gemini-2.0-flash', // Use a reliable model for fallback
            geminiApiKey,
            fallbackMessages,
            {
              temperature: 0.7,
              top_p: 0.95,
              max_tokens: 1000,
              tools: TOOL_SUPPORTED_MODELS.some(model => 
                modelId.toLowerCase().includes(model.toLowerCase())
              ) ? getTools() : null
            }
          );
          
          // Check for function calls in Gemini fallback
          if (geminiResponse.choices?.[0]?.message?.tool_calls?.length > 0) {
            const toolCall = geminiResponse.choices[0].message.tool_calls[0];
            const result = await handleToolCall(toolCall.function);
            return result;
          }
          
          return geminiResponse.choices[0].message.content;
        }
      }
      else {
        // OpenRouter provider (default)
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          throw new Error('OpenRouter API key not configured');
        }
        
        const endpoint = OPENROUTER_API_URL;
        
        const response = await axios.post(
          endpoint,
          {
            model: modelId,
            messages: messagesToUse,
            temperature: 0.7,
            max_tokens: 1000,
            top_p: 0.95,
            tools: TOOL_SUPPORTED_MODELS.some(model => 
              modelId.toLowerCase().includes(model.toLowerCase())
            ) ? getTools() : null,
            tool_choice: 'auto'
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://github.com/Qi-Blockchain/qi-ai-chatbot',
              'X-Title': 'Qi AI Chatbot'
            }
          }
        );
        
        // Check for function calls in OpenRouter response
        if (response.data.choices?.[0]?.message?.tool_calls?.length > 0) {
          const toolCall = response.data.choices[0].message.tool_calls[0];
          const result = await handleToolCall(toolCall.function);
          return result;
        }
        
        return response.data.choices[0].message.content;
      }
    }
    catch (mainError) {
      // Common fallback mechanism for all providers
      logger.error('Main AI request failed, attempting fallback', mainError);
      
      // First check if we have a Gemini key as a universal fallback
      const geminiApiKey = botConfig.geminiApiKey || process.env.GEMINI_API_KEY;
      
      if (geminiApiKey && provider !== 'gemini') {
        logger.warning('Falling back to Gemini due to error in primary provider');
        
        try {
          // Use reduced context for fallback
          const fallbackMessages = reduceContextSize(messagesToUse, { 
            maxMessages: 10,
            alwaysKeepSystemMessages: true,
            alwaysKeepLastUserMessage: true 
          });
          
          const geminiResponse = await requestGeminiChat(
            'gemini-2.0-flash', // Use a reliable model for fallback
            geminiApiKey,
            fallbackMessages,
            {
              temperature: 0.7,
              top_p: 0.95,
              max_tokens: 1000
            }
          );
          
          return geminiResponse.choices[0].message.content;
        }
        catch (geminiError) {
          logger.error('Gemini fallback also failed', geminiError);
          throw new Error(`Primary AI request failed: ${mainError.message}. Gemini fallback also failed: ${geminiError.message}`);
        }
      }
      
      // If no fallback available, rethrow the original error
      throw mainError;
    }
  }
  catch (error) {
    logger.error('AI generation failed with all providers', error);
    return `Maaf, terjadi kesalahan saat berkomunikasi dengan API AI: ${error.message}. Coba lagi nanti ya~`;
  }
}

// Helper function to format messages based on API provider
function formatMessagesForAPI(messages, botConfig) {
  // Format messages berdasarkan provider dan model
  const isGeminiModel = botConfig.defaultProvider === 'gemini' ||
                       (botConfig.model && (
                         botConfig.model.startsWith('google/') || 
                         botConfig.model.startsWith('gemini')
                       ));
  
  // Format semua pesan agar memasukkan name dan timestamp ke dalam content
  return messages.map(msg => {
    if (msg.role === 'user') {
      // Get sender name from various possible locations in message metadata
      let senderName = msg.name;
      if (!senderName && msg.metadata) {
        senderName = msg.metadata.senderName || msg.metadata.sender_name || msg.metadata.from_name || msg.name;
      }
      if (!senderName && msg.sender) {
        // If it's a phone number/ID, extract just the name part
        senderName = msg.sender.split('@')[0];
      }
      // Final fallback - this should rarely happen
      if (!senderName) {
        senderName = 'Unknown User';
      }
      
      const timestamp = msg.timestamp || new Date().toISOString();
      
      // Convert to Asia/Jakarta timezone and format
      const jakartaTime = new Date(timestamp).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const content = typeof msg.content === 'string' ? msg.content : '';
      return {
        role: 'user',
        content: `${senderName !== 'Unknown User' ? `name: ${senderName}` : ''} \n time: ${jakartaTime} \n content: ${content}`
      };
    } else if (msg.role === 'system') {
      // For system messages, handle Gemini's special case
      return {
        role: isGeminiModel ? 'user' : 'system',
        content: msg.content
      };
    } else {
      // For other roles (e.g. assistant), keep as is
      return msg;
    }
  });
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
  const startTime = Date.now();
  let responseData = null;
  let errorOccurred = false;
  let errorDetails = null;
  
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
    let requestData = {
      contents: geminiMessages,
      generationConfig: {
        temperature: params.temperature || 0.7,
        topP: params.top_p || 0.95,
        maxOutputTokens: params.max_tokens || 1024,
        stopSequences: params.stop || []
      }
    };
    
    // Add tools support according to the Gemini API documentation
    // https://ai.google.dev/gemini-api/docs/function-calling
    if (params.tools && true === false) {
      // Check if we're using a newer Gemini model (2.0+) which requires different formatting
      if (normalizedModel.includes('gemini-2') || normalizedModel.includes('gemini-1.5')) {
        // For Gemini 1.5/2.0, use the newer format with toolConfig
        requestData.toolConfig = {
          functionCallingConfig: {
            mode: "AUTO"
          }
        };
        
        // Convert OpenAI-style tools to Gemini-style tools
        const functionDeclarations = params.tools
          .filter(tool => tool.type === 'function' && tool.function)
          .map(tool => ({
            name: tool.function.name,
            description: tool.function.description || '',
            parameters: tool.function.parameters
          }));
        
        if (functionDeclarations.length > 0) {
          requestData.tools = [
            {
              functionDeclarations
            }
          ];
        }
      } else {
        // Older Gemini API format
        logger.warning('Using older Gemini model, function calling might not be supported');
        // Don't add tools to the request for older models
      }
    }
    
    logger.debug('Sending request to Gemini API', {
      endpoint,
      model,
      messageCount: messages.length,
      temperature: params.temperature,
      maxTokens: params.max_tokens,
      hasTools: !!params.tools
    });
    
    // Prepare request options
    const requestOptions = {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      }
    };
    
    // Make request to Gemini API
    const response = await axios.post(endpoint, requestData, requestOptions);
    
    logger.debug('Gemini API response received', { status: response.status });
    
    // Process response data
    responseData = response.data;
    
    // Check if response contains candidates
    if (!responseData || !responseData.candidates || responseData.candidates.length === 0) {
      logger.error('[AI Service] Invalid Gemini response format: no candidates');
      errorOccurred = true;
      errorDetails = 'Invalid response format: no candidates';
      throw new Error('Invalid response format: no candidates');
    }
    
    // Get first candidate
    const candidate = responseData.candidates[0];
    
    if (!candidate.content || !candidate.content.parts) {
      logger.error('[AI Service] Invalid Gemini response format: candidate missing content or parts');
      errorOccurred = true;
      errorDetails = 'Invalid response format: candidate missing content or parts';
      throw new Error('Invalid response format: candidate missing content or parts');
    }
    
    // Check for function calls / tool calls in the response
    let toolCalls = null;
    if (candidate.content.parts && candidate.content.parts.some(part => part.functionCall)) {
      toolCalls = candidate.content.parts
        .filter(part => part.functionCall)
        .map((part, index) => {
          const fnCall = part.functionCall;
          return {
            index,
            id: `call_${Math.random().toString(36).substring(2)}`,
            type: "function",
            function: {
              name: fnCall.name,
              arguments: JSON.stringify(fnCall.args)
            }
          };
        });
        
      logger.debug('Gemini response contains function calls', {
        functionCallsCount: toolCalls.length,
        firstFunctionCall: toolCalls[0]
      });
    }
    
    // Extract text content (if any)
    let textContent = "";
    for (const part of candidate.content.parts) {
      if (part.text) {
        textContent += part.text;
      }
    }
    
    logger.success(`Successfully processed Gemini API response (${textContent.length} chars)`);
    
    // Transform to match our expected format (OpenAI API style)
    let formattedResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: textContent
        }
      }]
    };
    
    // Add tool calls if present
    if (toolCalls && toolCalls.length > 0) {
      formattedResponse.choices[0].message.tool_calls = toolCalls;
      // Clear content if there are only function calls and no text
      if (!textContent.trim()) {
        formattedResponse.choices[0].message.content = null;
      }
    }
    
    // Log API request and response
    await logApiRequest(
      endpoint,
      'gemini',
      model,
      {
        method: 'POST',
        url: endpoint,
        headers: requestOptions.headers,
        data: requestData
      },
      {
        status: response.status,
        statusText: response.statusText,
        data: responseData
      },
      {
        executionTime: Date.now() - startTime,
        messageCount: messages.length,
        promptTokens: messages.reduce((total, msg) => total + (msg.content.length / 4), 0),
        completionTokens: textContent.length / 4,
        success: true
      }
    );
    
    return formattedResponse;
  } catch (error) {
    logger.error(`[AI Service] Gemini API error: ${error.message}`);
    
    if (error.response) {
      logger.error('[AI Service] Gemini API error details', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data ? JSON.stringify(error.response.data).substring(0, 300) + '...' : 'No data'
      });
      
      responseData = error.response.data;
      errorDetails = {
        status: error.response.status,
        statusText: error.response.statusText,
        message: error.message
      };
    } else {
      errorDetails = { message: error.message };
    }
    
    // Log the failed API request
    if (!errorOccurred) {
      await logApiRequest(
        `${GEMINI_API_URL}/${model.startsWith('google/') ? model.substring(7) : model}:generateContent`,
        'gemini',
        model,
        {
          method: 'POST',
          url: `${GEMINI_API_URL}/${model.startsWith('google/') ? model.substring(7) : model}:generateContent`,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': '*** REDACTED ***'
          },
          data: {
            contents: messages.map(msg => ({ role: msg.role, text: msg.content })),
            generationConfig: {
              temperature: params.temperature || 0.7,
              topP: params.top_p || 0.95,
              maxOutputTokens: params.max_tokens || 1024,
              stopSequences: params.stop || []
            }
          }
        },
        responseData || { error: error.message },
        {
          executionTime: Date.now() - startTime,
          messageCount: messages.length,
          promptTokens: messages.reduce((total, msg) => total + (msg.content.length / 4), 0),
          success: false,
          error: errorDetails
        }
      );
    }
    
    throw error;
  }
}

/**
 * Request chat completion from Together.AI API
 * @param {string} model - Together.AI model name
 * @param {string} apiKey - Together.AI API key
 * @param {Array} messages - Formatted messages
 * @param {object} params - Additional parameters
 * @returns {Promise<object>} Together.AI API response
 */
async function requestTogetherChat(model, apiKey, messages, params) {
  const startTime = Date.now();
  let responseData = null;
  let errorOccurred = false;
  let errorDetails = null;
  
  // Estimate token count to ensure we stay under 8000 tokens
  const estimatedTokenCount = messages.reduce((count, msg) => {
    // Rough estimate: 1 token ≈ 4 chars for English text
    return count + (msg.content ? Math.ceil(msg.content.length / 3) : 0);
  }, 0);
  
  logger.debug(`Estimated token count for Together.AI request: ${estimatedTokenCount}`);
  
  // If estimated tokens exceed 7000, reduce context to stay safely under 8000 limit
  let processedMessages = messages;
  // if (estimatedTokenCount > 7000) {
  //   logger.warning(`Token count (${estimatedTokenCount}) exceeds safe limit, reducing context`);
  //   processedMessages = reduceContextSize(messages, {
  //     maxMessages: Math.floor(messages.length * 0.6), // More aggressive reduction
  //     alwaysKeepSystemMessages: true,
  //     alwaysKeepLastUserMessage: true,
  //     preserveRatio: 0.6, // Favor user messages slightly
  //     targetTokenCount: 6000 // Target a safe token count well under the 8K limit
  //   });
    
  //   logger.info(`Reduced token count from ~${estimatedTokenCount} to ~${
  //     processedMessages.reduce((count, msg) => {
  //       return count + (msg.content ? Math.ceil(msg.content.length / 4) : 0);
  //     }, 0)
  //   }`);
    
  //   // If still too large, truncate the content of messages
  //   const newTokenCount = processedMessages.reduce((count, msg) => {
  //     return count + (msg.content ? Math.ceil(msg.content.length / 4) : 0);
  //   }, 0);
  //   console.log(newTokenCount)
  //   if (newTokenCount > 7000) {
  //     logger.warning(`Still over token limit after reducing messages, truncating content`);
      
  //     // Separate system messages (don't modify these) from the rest
  //     const systemMsgs = processedMessages.filter(msg => msg.role === 'system');
  //     const nonSystemMsgs = processedMessages.filter(msg => msg.role !== 'system');
      
  //     // Calculate how much we need to trim
  //     const targetSize = 6500; // Aim for 6.5K tokens to be safe
  //     const currentSize = newTokenCount;
  //     const excessTokens = currentSize - targetSize;
      
  //     if (nonSystemMsgs.length > 0 && excessTokens > 0) {
  //       // Find the last user message
  //       const lastUserIndex = nonSystemMsgs.map(msg => msg.role).lastIndexOf('user');
        
  //       // Calculate how many characters to trim per message (excluding last user message)
  //       const messagesToTrim = lastUserIndex >= 0 ? nonSystemMsgs.length - 1 : nonSystemMsgs.length;
  //       const charsToTrimPerMessage = Math.ceil((excessTokens * 4) / messagesToTrim);
        
  //       // Trim each message except the last user message
  //       nonSystemMsgs.forEach((msg, index) => {
  //         if (lastUserIndex >= 0 && index === lastUserIndex) {
  //           // Don't trim the last user message
  //           return;
  //         }
          
  //         if (msg.content && msg.content.length > 150) { // Only trim longer messages
  //           const currentLength = msg.content.length;
  //           const targetLength = Math.max(100, currentLength - charsToTrimPerMessage);
            
  //           if (targetLength < currentLength) {
  //             // Preserve beginning and end, truncate middle
  //             const keepStart = Math.floor(targetLength * 0.6);
  //             const keepEnd = Math.max(40, targetLength - keepStart);
              
  //             msg.content = msg.content.substring(0, keepStart) + 
  //                           " [...] " + 
  //                           msg.content.substring(currentLength - keepEnd);
  //           }
  //         }
  //       });
  //     }
      
  //     // Reassemble the message list
  //     processedMessages = [...systemMsgs, ...nonSystemMsgs];
      
  //     // Log the final token count
  //     const finalTokenCount = processedMessages.reduce((count, msg) => {
  //       return count + (msg.content ? Math.ceil(msg.content.length / 4) : 0);
  //     }, 0);
      
  //     logger.info(`Final estimated token count after content truncation: ${finalTokenCount}`);
  //   }
  // }
  
  // Move requestData declaration outside the try block so it's accessible in the catch block
  let requestData = {
    model: model,
    messages: processedMessages,
    temperature: params.temperature || 0.7,
    top_p: params.top_p || 0.95,
    max_tokens: Math.min(params.max_tokens || 1500, 1500), // Cap at 1500 tokens for response
    stream: false
  };
  
  // Add tool support according to Together.AI documentation
  if (params.tools) {
    requestData.tools = params.tools;
  }
  
  // Add tool_choice if specified
  if (params.tool_choice) {
    requestData.tool_choice = params.tool_choice;
  }
  
  try {
    console.log(`Making request to Together.AI API with model: ${model}`);
    
    // Together.AI API endpoint
    const endpoint = TOGETHER_API_URL;
    
    console.log(`Using Together.AI API endpoint: ${endpoint}`);
    
    // Add stop sequences if provided
    if (params.stop && Array.isArray(params.stop) && params.stop.length > 0) {
      requestData.stop = params.stop;
    }
    
    logger.debug('Sending request to Together.AI API', {
      endpoint,
      model,
      messageCount: messages.length,
      temperature: params.temperature,
      maxTokens: params.max_tokens,
      hasTools: !!params.tools,
      toolChoice: params.tool_choice || 'auto'
    });
    
    // Prepare request options
    const requestOptions = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    };
    
    // Make request to Together.AI API
    const response = await axios.post(endpoint, requestData, requestOptions);
    
    logger.debug('Together.AI API response received', { status: response.status });
    
    // Process response data
    responseData = response.data;
    
    if (!responseData || !responseData.choices || responseData.choices.length === 0) {
      logger.error('[AI Service] Invalid Together.AI response format: no choices');
      errorOccurred = true;
      errorDetails = 'Invalid response format: no choices';
      throw new Error('Invalid response format: no choices');
    }
    
    // Extract response from first choice
    const messageData = responseData.choices[0].message;
    
    // Check if there's a tool call in the response
    if (messageData && messageData.tool_calls && messageData.tool_calls.length > 0) {
      logger.debug('Together.AI response contains tool calls', {
        toolCallsCount: messageData.tool_calls.length,
        firstToolCall: messageData.tool_calls[0]
      });
    }
    
    // Check content exists if there's no tool call
    if (!messageData.tool_calls && (!messageData || !messageData.content)) {
      logger.error('[AI Service] Invalid Together.AI response format: no message content or tool_calls');
      errorOccurred = true;
      errorDetails = 'Invalid response format: no message content or tool_calls';
      throw new Error('Invalid response format: no message content or tool_calls');
    }
    
    logger.success(`Successfully processed Together.AI API response`);
    
    // Extract token usage if available
    const promptTokens = responseData.usage?.prompt_tokens || 0;
    const completionTokens = responseData.usage?.completion_tokens || 0;
    
    // Log API request and response
    await logApiRequest(
      endpoint,
      'together',
      model,
      {
        method: 'POST',
        url: endpoint,
        headers: requestOptions.headers,
        data: requestData
      },
      {
        status: response.status,
        statusText: response.statusText,
        data: responseData
      },
      {
        executionTime: Date.now() - startTime,
        messageCount: messages.length,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        success: true
      }
    );
    
    return responseData;
  } catch (error) {
    logger.error(`[AI Service] Together.AI API error: ${error.message}`);
    
    if (error.response) {
      logger.error('[AI Service] Together.AI API error details', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data ? JSON.stringify(error.response.data).substring(0, 300) + '...' : 'No data'
      });
      
      responseData = error.response.data;
      errorDetails = {
        status: error.response.status,
        statusText: error.response.statusText,
        message: error.message
      };
    } else {
      errorDetails = { message: error.message };
    }
    
    // Log the failed API request
    if (!errorOccurred) {
      await logApiRequest(
        TOGETHER_API_URL,
        'together',
        model,
        {
          method: 'POST',
          url: TOGETHER_API_URL,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer *** REDACTED ***'
          },
          data: requestData
        },
        responseData || { error: error.message },
        {
          executionTime: Date.now() - startTime,
          messageCount: messages.length,
          success: false,
          error: errorDetails
        }
      );
    }
    
    throw error;
  }
}

/**
 * Analyze an image using Together.AI vision model
 * @param {string} imagePath - Path to the image file
 * @param {string} prompt - Text prompt to guide image analysis
 * @param {Object} options - Optional configuration
 * @returns {Promise<Object>} - The analysis result including embeddings
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
    
    // For face detection, add specific instructions
    const faceDetectionPrompt = analysisPrompt + ' Jika ada wajah manusia dalam gambar, harap sebutkan berapa banyak wajah yang terlihat dan jelaskan karakteristik wajah tersebut (gender, perkiraan umur, ekspresi, dll). Jika tidak ada wajah, nyatakan secara eksplisit.';
    
    // Enhanced prompt for better embedding generation
    const enhancedEmbeddingPrompt = faceDetectionPrompt + ' Berikan juga kategori utama dari gambar ini (misalnya: portrait, landscape, food, document, meme, screenshot, dll).';
    
    // Enhanced detail prompt for more precise analysis
    const enhancedDetailPrompt = options.enhancedPrompt ? 
      enhancedEmbeddingPrompt + ' Detail gambar ini dengan sangat spesifik, termasuk warna utama, komposisi, pencahayaan, dan elemen khusus yang terlihat dalam gambar. Jika ada teks yang terlihat, tuliskan teks tersebut secara tepat. Jika ada identitas orang atau objek yang bisa dikenali, sebutkan dengan jelas.' : 
      faceDetectionPrompt;
    
    // Final prompt based on options
    const finalPrompt = options.extractEmbeddings ? 
      enhancedEmbeddingPrompt : 
      (options.enhancedPrompt ? enhancedDetailPrompt : faceDetectionPrompt);
    
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
          { "type": "text", "text": finalPrompt },
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
    
    // Extract additional information
    let imageType = 'unknown';
    let faceCount = 0;
    let faceDescriptions = [];
    
    // Detect image type
    if (analysisResult.toLowerCase().includes('screenshot') || 
        analysisResult.toLowerCase().includes('tangkapan layar')) {
      imageType = 'screenshot';
    } else if (analysisResult.toLowerCase().includes('landscape') || 
              analysisResult.toLowerCase().includes('pemandangan')) {
      imageType = 'landscape';
    } else if (analysisResult.toLowerCase().includes('portrait') || 
              analysisResult.toLowerCase().includes('potret') ||
              analysisResult.toLowerCase().includes('selfie')) {
      imageType = 'portrait';
    } else if (analysisResult.toLowerCase().includes('food') || 
              analysisResult.toLowerCase().includes('makanan') ||
              analysisResult.toLowerCase().includes('minuman')) {
      imageType = 'food';
    } else if (analysisResult.toLowerCase().includes('document') || 
              analysisResult.toLowerCase().includes('dokumen') ||
              analysisResult.toLowerCase().includes('teks')) {
      imageType = 'document';
    } else if (analysisResult.toLowerCase().includes('meme') || 
              analysisResult.toLowerCase().includes('lucu') ||
              analysisResult.toLowerCase().includes('humor')) {
      imageType = 'meme';
    }
    
    // Detect faces
    const faceRegex = /(\d+)\s+(?:wajah|face|orang|person|people)/i;
    const faceMatch = analysisResult.match(faceRegex);
    if (faceMatch) {
      faceCount = parseInt(faceMatch[1]);
      
      // Try to extract face descriptions
      const faceSections = analysisResult.split(/(?:wajah|face|orang|person|people)/i).slice(1);
      faceDescriptions = faceSections.map(section => section.trim()).filter(s => s.length > 0);
    } else if (analysisResult.toLowerCase().includes('wajah') || 
               analysisResult.toLowerCase().includes('face')) {
      faceCount = 1;
    }
    
    // Generate a simple embedding from the analysis text if requested
    let embedding = null;
    let faceEmbeddings = [];
    
    if (options.extractEmbeddings) {
      // Generate placeholder embeddings
      // (In a production system, you would use a proper embedding model)
      const { generateTextEmbedding } = await import('./memoryService.js');
      embedding = generateTextEmbedding(analysisResult, 512);
      
      // Generate face embeddings if faces were detected
      if (faceCount > 0) {
        for (let i = 0; i < faceCount; i++) {
          const faceDescription = faceDescriptions[i] || `Face ${i+1}`;
          // Generate a unique embedding for each face based on its description
          faceEmbeddings.push(generateTextEmbedding(`face${i+1}_${faceDescription}`, 512));
        }
      }
    }
    
    // Return enhanced result with additional data
    return {
      analysis: analysisResult,
      imageType,
      faceCount,
      faceDescriptions,
      embedding,
      faceEmbeddings,
      detectedFaces: faceCount > 0
    };
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
    
    // Check if analysisResult is string or object
    let analysisText = '';
    let embedding = null;
    let faceEmbeddings = [];
    let imageType = null;
    let faceCount = 0;
    let faceDescriptions = [];
    
    if (typeof analysisResult === 'string') {
      analysisText = analysisResult;
    } else {
      // It's an enhanced analysis object
      analysisText = analysisResult.analysis;
      embedding = analysisResult.embedding;
      faceEmbeddings = analysisResult.faceEmbeddings || [];
      imageType = analysisResult.imageType;
      faceCount = analysisResult.faceCount || 0;
      faceDescriptions = analysisResult.faceDescriptions || [];
    }
    
    // Extract key entities and topics from the analysis result
    const entities = extractEntitiesFromAnalysis(analysisText);
    const topics = extractTopicsFromAnalysis(analysisText);
    
    // Create a summary of the image for easier reference
    const summaryLength = 100;
    const imageSummary = analysisText.length > summaryLength ? 
      analysisText.substring(0, summaryLength).trim() + '...' : 
      analysisText;
    
    // Create enhanced analysis entry with more metadata
    const analysis = {
      id: analysisId,
      chatId,
      sender,
      timestamp,
      caption: imageData.caption || '',
      mimetype: imageData.mimetype,
      analysis: analysisText,
      summary: imageSummary,
      entities,
      topics,
      imageType,
      faceCount,
      faceDescriptions,
      relatedMessages: [], // Will store IDs of follow-up messages about this image
      hasBeenShown: false, // Track if this analysis has been shown to the user
      lastAccessTime: timestamp, // Track when this analysis was last accessed
      messageId: imageData.messageId || null, // Store the original message ID
      senderName: imageData.senderName || sender.split('@')[0] // Store sender's name for better context
    };
    
    // Store the analysis
    db.data.imageAnalysis[analysisId] = analysis;
    
    // Also add a reference to the chat context
    if (db.data.conversations[chatId]) {
      // Create a special message to represent the image analysis with enhanced metadata
      // This message will be stored in context but not sent to the user unless requested
      const imageContextMessage = {
        id: analysisId,
        sender: process.env.BOT_ID,
        name: db.data.config.botName,
        content: `[IMAGE ANALYSIS: ${analysisText}]`,
        timestamp,
        role: 'assistant',
        chatType: chatId.endsWith('@g.us') ? 'group' : 'private',
        imageAnalysisId: analysisId, // Reference to the full analysis
        metadata: {
          hasImage: true,
          isImageAnalysis: true,
          entities,
          topics: ['image', ...topics],
          fullAnalysisId: analysisId,
          silentAnalysis: true, // Mark that this analysis was not shown to the user
          originalSender: sender, // Track who sent the original image
          originalSenderName: imageData.senderName || sender.split('@')[0], // Store sender's name
          originalTimestamp: timestamp, // When the image was originally sent
          originalMessageId: imageData.messageId || null, // Store original message ID for reference
          imageType,
          faceCount,
          hasEmbedding: !!embedding
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
    
    // Store embedding data if available
    if (embedding || (faceEmbeddings && faceEmbeddings.length > 0)) {
      try {
        const { storeImageEmbedding, addImageRecognitionFacts } = await import('./memoryService.js');
        
        // Store the embedding
        await storeImageEmbedding(analysisId, embedding, faceEmbeddings, {
          chatId,
          sender,
          timestamp,
          caption: imageData.caption || '',
          imageType,
          faceCount,
          analysisId
        });
        
        // Add image recognition facts for the user
        await addImageRecognitionFacts(sender, {
          faces: faceEmbeddings,
          imageType,
          description: imageSummary
        });
        
        logger.success(`Stored embeddings for image ${analysisId}`);
      } catch (embeddingError) {
        logger.error('Error storing image embedding:', embeddingError);
      }
    }
    
    // Save to database
    await db.write();
    logger.success(`Stored enhanced image analysis with ID: ${analysisId} (silent mode)`);
    
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
  
  // Common topic categories to extract
  const topicPatterns = {
    'landscape': /\b(?:pemandangan|landscape|alam|nature|gunung|mountain|pantai|beach|laut|sea|danau|lake|outdoor)\b/gi,
    'portrait': /\b(?:potret|portrait|selfie|wajah|face|foto diri|profile picture)\b/gi,
    'food': /\b(?:makanan|food|minuman|drink|masakan|cuisine|hidangan|dish|menu|restaurant)\b/gi,
    'document': /\b(?:dokumen|document|teks|text|tulisan|writing|kertas|paper|surat|letter|note)\b/gi,
    'screenshot': /\b(?:screenshot|tangkapan layar|layar|screen|aplikasi|application|website|situs|web|app|capture)\b/gi,
    'meme': /\b(?:meme|lucu|funny|humor|komik|comic|lelucon|joke)\b/gi,
    'art': /\b(?:seni|art|lukisan|painting|gambar|drawing|sketsa|sketch|karya)\b/gi,
    'animal': /\b(?:hewan|animal|binatang|kucing|cat|anjing|dog|burung|bird)\b/gi,
    'vehicle': /\b(?:kendaraan|vehicle|mobil|car|motor|motorcycle|sepeda|bicycle|transportasi|transportation)\b/gi,
    'building': /\b(?:bangunan|building|gedung|rumah|house|arsitektur|architecture|konstruksi|construction)\b/gi,
    'group': /\b(?:grup|group|kumpulan|gathering|kerumunan|crowd|orang-orang|people)\b/gi,
    'chart': /\b(?:grafik|chart|diagram|bagan|plot|statistik|statistics|data|angka|numbers)\b/gi
  };
  
  // Extract topics based on patterns
  Object.entries(topicPatterns).forEach(([topic, pattern]) => {
    if (pattern.test(analysisText)) {
      topics.push(topic);
    }
  });
  
  // Also extract any hashtag-like terms
  const hashtagPattern = /#(\w+)/g;
  const hashtagMatches = analysisText.match(hashtagPattern);
  if (hashtagMatches) {
    hashtagMatches.forEach(tag => {
      topics.push(tag.substring(1).toLowerCase());
    });
  }
  
  // Add general image category
  topics.push('image');
  
  return [...new Set(topics)];
}

// Constants for image generation
const IMAGE_GENERATION_MODEL = 'gemini-2.0-flash-exp';
const GEMINI_IMAGE_GEN_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Generate an image using the Gemini model
 * @param {string} prompt - Text prompt to generate image
 * @param {Object} options - Optional configuration
 * @returns {Promise<Object>} - The generated image in base64 format
 */
async function generateImage(prompt, options = {}) {
  try {
    logger.info(`Generating image with Gemini: prompt="${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      throw new Error('No Gemini API key found for image generation');
    }
    
    const model = IMAGE_GENERATION_MODEL;
    const endpoint = `${GEMINI_IMAGE_GEN_URL}/${model}:generateContent`;
    
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    };
    
    // Prepare request data
    const requestData = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generation_config: {
        responseModalities: ["image", "text"],
      }
    };
    
    
    // Make the API request
    const response = await axios.post(endpoint, requestData, { headers });
    if (!response.data) {
      throw new Error('Empty response from Gemini image generation');
    }
    
    logger.debug('Gemini response structure:', {
      hasCandidates: !!response.data.candidates,
      candidatesLength: response.data.candidates ? response.data.candidates.length : 0,
      firstCandidateKeys: response.data.candidates && response.data.candidates.length > 0 ? 
        Object.keys(response.data.candidates[0]) : []
    });
    
    if (!response.data.candidates || 
        response.data.candidates.length === 0 ||
        !response.data.candidates[0].content ||
        !response.data.candidates[0].content.parts ||
        response.data.candidates[0].content.parts.length === 0) {
      throw new Error('Invalid response structure from Gemini image generation');
    }
    
    // Extract image data - try to handle different response formats
    const parts = response.data.candidates[0].content.parts;
    logger.debug('Gemini image parts:', {
      partsLength: parts.length,
      partsTypes: parts.map(p => Object.keys(p)).flat()
    });
    
    // Look for image data in any of the parts
    const part = parts.find(part => part.inlineData) || parts.find(part => part.fileData) || parts[0];
    
    if (!part) {
      throw new Error('No content parts found in Gemini response');
    }
    
    // Check for different possible image data formats
    if (part.inlineData) {
      // Standard format
      const imageData = part.inlineData;
      logger.success('Successfully generated image with Gemini (inlineData format)');
      
      return {
        mimeType: imageData.mimeType,
        base64Data: imageData.data,
        fullBase64: `data:${imageData.mimeType};base64,${imageData.data}`
      };
    } else if (part.fileData) {
      // Alternative format
      const imageData = part.fileData;
      logger.success('Successfully generated image with Gemini (fileData format)');
      
      return {
        mimeType: imageData.mimeType || 'image/jpeg',
        base64Data: imageData.fileData || imageData.data,
        fullBase64: `data:${imageData.mimeType || 'image/jpeg'};base64,${imageData.fileData || imageData.data}`
      };
    } else if (part.text && part.text.includes('base64')) {
      // Sometimes the model returns base64 data as text
      logger.success('Successfully generated image with Gemini (text with base64 format)');
      
      // Try to extract base64 data from text
      const base64Match = part.text.match(/data:(image\/[^;]+);base64,([^"'\s]+)/);
      if (base64Match) {
        return {
          mimeType: base64Match[1],
          base64Data: base64Match[2],
          fullBase64: `data:${base64Match[1]};base64,${base64Match[2]}`
        };
      }
    }
    
    // We've tried all formats but couldn't find valid image data
    throw new Error('No image data found in Gemini response');
  } catch (error) {
    logger.error('Error generating image with Gemini:', error);
    
    if (error.response && error.response.data) {
      const errorData = JSON.stringify(error.response.data).substring(0, 500);
      logger.error(`Gemini API error details: ${errorData}`);
    } else if (error.response) {
      // Log other response properties if data is not available
      logger.error('Gemini API error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers
      });
    }
    
    // Try Together.ai fallback
    try {
      logger.info(`Gemini image generation failed, trying Together.ai fallback: ${error.message}`);
      return await generateImageWithTogetherAI(prompt, options);
    } catch (fallbackError) {
      logger.error('Both Gemini and Together.ai image generation failed:', fallbackError);
      throw new Error(`Failed to generate image with Gemini (${error.message}) and Together.ai fallback (${fallbackError.message})`);
    }
  }
}

/**
 * Generate an image using Together.ai as fallback
 * @param {string} prompt - Text prompt to generate image
 * @param {Object} options - Optional configuration
 * @returns {Promise<Object>} - The generated image in base64 format
 */
async function generateImageWithTogetherAI(prompt, options = {}) {
  try {
    logger.info(`Generating image with Together.ai: prompt="${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    
    const apiKey = options.togetherApiKey || process.env.TOGETHER_API_KEY;
    
    if (!apiKey) {
      throw new Error('No Together.ai API key found for image generation fallback');
    }
    
    const model = options.togetherModel || process.env.TOGETHER_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell-Free';
    const endpoint = `https://api.together.xyz/v1/images/generations`;
    
    logger.info(`Using Together.ai model: ${model} for image generation`);
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    
    // Prepare request data for Together.ai
    const requestData = {
      model: model,
      prompt: prompt,
      n: 1, // Generate one image
      width: options.width || 1024,
      height: options.height || 1024,
      steps: options.steps || 4, // Fixed: steps must be between 1 and 4
      seed: options.seed || Math.floor(Math.random() * 10000000)
    };
    
    // Make the API request
    const response = await axios.post(endpoint, requestData, { headers });
    
    // Handle the new response format where image URL is in data[0].url
    if (response.data && response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
      // Get the first image URL
      const imageUrl = response.data.data[0].url;
      
      if (!imageUrl) {
        throw new Error('No image URL found in Together.ai response');
      }
      
      logger.info('Received image URL from Together.ai, downloading...');
      
      // Download the image
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(imageResponse.data);
      const base64Data = buffer.toString('base64');
      
      // Determine mime type based on URL or default to jpeg
      let mimeType = 'image/jpeg';
      if (imageUrl.endsWith('.png')) {
        mimeType = 'image/png';
      }
      
      logger.success('Successfully generated image with Together.ai');
      
      return {
        mimeType: mimeType,
        base64Data: base64Data,
        fullBase64: `data:${mimeType};base64,${base64Data}`
      };
    } 
    // Legacy format handling
    else if (response.data && response.data.output) {
      // Extract image data - Together.ai typically returns base64 or URLs
      const imageData = response.data.output;
      logger.debug('Together.ai legacy response structure detected');
      
      // Check if response is a URL or base64
      if (typeof imageData === 'string' && imageData.startsWith('http')) {
        // It's a URL, download the image
        logger.info('Received legacy image URL from Together.ai, downloading...');
        const imageResponse = await axios.get(imageData, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(imageResponse.data);
        const base64Data = buffer.toString('base64');
        
        // Determine mime type based on URL or default to jpeg
        let mimeType = 'image/jpeg';
        if (imageData.endsWith('.png')) {
          mimeType = 'image/png';
        }
        
        logger.success('Successfully generated image with Together.ai (legacy URL mode)');
        
        return {
          mimeType: mimeType,
          base64Data: base64Data,
          fullBase64: `data:${mimeType};base64,${base64Data}`
        };
      } else if (Array.isArray(imageData) && imageData.length > 0) {
        // Some Together.ai models return an array of images
        logger.success('Successfully generated image with Together.ai (legacy array mode)');
        
        // Get the first image
        let base64Data = imageData[0];
        
        // Strip data:image prefix if present
        if (base64Data.startsWith('data:image')) {
          const parts = base64Data.split(',');
          const mimeMatch = parts[0].match(/data:(image\/[^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          
          return {
            mimeType: mimeType,
            base64Data: parts[1],
            fullBase64: base64Data
          };
        }
        
        return {
          mimeType: 'image/jpeg', // Default to JPEG if not specified
          base64Data: base64Data,
          fullBase64: `data:image/jpeg;base64,${base64Data}`
        };
      } else if (response.data.output && response.data.output.data) {
        // Some Together.ai endpoints return {output: {data: "base64string", mime_type: "image/jpeg"}}
        logger.success('Successfully generated image with Together.ai (legacy data object mode)');
        
        const mimeType = response.data.output.mime_type || 'image/jpeg';
        const base64Data = response.data.output.data;
        
        return {
          mimeType: mimeType,
          base64Data: base64Data,
          fullBase64: `data:${mimeType};base64,${base64Data}`
        };
      } else {
        // Last attempt to handle any other format
        logger.warning('Unexpected Together.ai legacy response format, attempting to parse...');
        
        if (typeof imageData === 'string') {
          // Assume it's a base64 string directly
          logger.success('Treating legacy response as direct base64 string');
          return {
            mimeType: 'image/jpeg',
            base64Data: imageData,
            fullBase64: `data:image/jpeg;base64,${imageData}`
          };
        }
      }
    }
    
    // If we reached here, we couldn't handle the response format
    logger.error('Unhandled Together.ai response format:', JSON.stringify(response.data));
    throw new Error('Unsupported or empty response format from Together.ai image generation');
  } catch (error) {
    logger.error('Error generating image with Together.ai:', error);
    
    if (error.response && error.response.data) {
      const errorData = JSON.stringify(error.response.data).substring(0, 500);
      logger.error(`Together.ai API error details: ${errorData}`);
    }
    
    throw new Error(`Failed to generate image with Together.ai: ${error.message}`);
  }
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
  generateImage,
  generateImageWithTogetherAI,
  generateAnalysis,
  extractEntitiesFromAnalysis,
  extractTopicsFromAnalysis,
  searchWeb,
  fetchUrlContent,
  getTools,
  handleToolCall,
  TOOL_SUPPORTED_MODELS,
  reduceContextSize
};

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

/**
 * Reduce context size by keeping only the most important messages
 * @param {Array} messages - Original message array
 * @param {Object} options - Options for context reduction
 * @returns {Array} - Reduced message array
 */
function reduceContextSize(messages, options = {}) {
  const {
    maxMessages = 8,
    alwaysKeepSystemMessages = true,
    alwaysKeepLastUserMessage = true,
    preserveRatio = 0.5, // Try to keep 50% of messages as assistant's responses
    targetTokenCount = 0  // Optional token count target
  } = options;
  
  logger.info(`Reducing context size from ${messages.length} messages to max ${maxMessages}`);
  
  // If we're already under the max and not targeting tokens, just return the original
  if (messages.length <= maxMessages && !targetTokenCount) {
    return messages;
  }
  
  // Check token count if a target is specified
  if (targetTokenCount > 0) {
    const estimatedTokens = messages.reduce((sum, msg) => {
      return sum + (msg.content ? Math.ceil(msg.content.length / 4) : 0);
    }, 0);
    
    logger.debug(`Current estimated tokens: ${estimatedTokens}, target: ${targetTokenCount}`);
    
    // If already under target token count, return as is
    if (estimatedTokens <= targetTokenCount) {
      return messages;
    }
  }
  
  // Separate messages by role
  const systemMessages = messages.filter(msg => msg.role === 'system');
  const userMessages = messages.filter(msg => msg.role === 'user');
  const assistantMessages = messages.filter(msg => msg.role === 'assistant');
  
  logger.debug('Context reduction - message counts', {
    total: messages.length,
    system: systemMessages.length,
    user: userMessages.length,
    assistant: assistantMessages.length
  });
  
  // Calculate how many messages to keep
  let remainingSlots = maxMessages;
  
  // Always keep system messages if specified
  let resultMessages = [];
  if (alwaysKeepSystemMessages) {
    // If there are many system messages, prioritize the most important ones
    if (systemMessages.length > 3 && systemMessages.length > maxMessages / 3) {
      // Prioritize certain system messages
      const criticalSystemMessages = systemMessages.filter(msg => 
        msg.content.includes('IMPORTANT') || 
        msg.content.includes('personality') || 
        msg.name === 'system_instruction'
      );
      
      if (criticalSystemMessages.length > 0) {
        resultMessages = [...criticalSystemMessages];
      } else {
        // If no critical messages, take the first and last system messages
        resultMessages = [
          systemMessages[0],
          ...(systemMessages.length > 1 ? [systemMessages[systemMessages.length - 1]] : [])
        ];
      }
    } else {
      // Keep all system messages
      resultMessages = [...systemMessages];
    }
    
    remainingSlots -= resultMessages.length;
  }
  
  // If no slots remain, return what we have
  if (remainingSlots <= 0) {
    logger.warning('No slots remain after keeping system messages, context will be incomplete');
    return resultMessages;
  }
  
  // Handle the last user message specially if specified
  let lastUserMessage = null;
  if (alwaysKeepLastUserMessage && userMessages.length > 0) {
    lastUserMessage = userMessages.pop(); // Remove and save the last message
    remainingSlots--;
  }
  
  // If no slots remain, return what we have plus last user message
  if (remainingSlots <= 0) {
    if (lastUserMessage) {
      resultMessages.push(lastUserMessage);
    }
    return resultMessages;
  }
  
  // Score user messages by importance (higher = more important)
  const scoredUserMessages = userMessages.map((msg, index) => {
    let score = index; // Base score by position (newer = higher index = more important)
    
    // Boost score for messages with questions
    if (msg.content && (
        msg.content.includes('?') || 
        /\b(what|who|when|where|why|how)\b/i.test(msg.content)
      )) {
      score += 2;
    }
    
    // Boost score for longer messages (likely more important)
    if (msg.content && msg.content.length > 100) {
      score += Math.min(msg.content.length / 200, 2);
    }
    
    return { message: msg, score, index };
  });
  
  // Calculate how many of each type to keep based on preserveRatio
  const userToAssistantRatio = preserveRatio;
  const userMessagesToKeep = Math.floor(remainingSlots * userToAssistantRatio);
  const assistantMessagesToKeep = remainingSlots - userMessagesToKeep;
  
  // For user messages, use the score to prioritize
  scoredUserMessages.sort((a, b) => b.score - a.score);
  const keptUserMessages = scoredUserMessages
    .slice(0, userMessagesToKeep)
    .sort((a, b) => a.index - b.index); // Resort by original index to maintain order
  
  // Keep the most recent assistant messages
  const keptAssistantMessages = assistantMessages.slice(-assistantMessagesToKeep);
  
  logger.debug('Keeping messages', {
    userToKeep: keptUserMessages.length,
    assistantToKeep: keptAssistantMessages.length,
    lastUserMessage: lastUserMessage ? 'yes' : 'no'
  });
  
  // Combine messages, trying to maintain conversation flow
  // This interleaves user and assistant messages as much as possible
  let interleaved = [];
  const maxInterleaveLength = Math.max(keptUserMessages.length, keptAssistantMessages.length);
  
  for (let i = 0; i < maxInterleaveLength; i++) {
    // Add user message if available
    if (i < keptUserMessages.length) {
      interleaved.push(keptUserMessages[i].message);
    }
    
    // Add assistant message if available
    if (i < keptAssistantMessages.length) {
      interleaved.push(keptAssistantMessages[i]);
    }
  }
  
  // Combine everything, adding the last user message at the end
  resultMessages = [...resultMessages, ...interleaved];
  if (lastUserMessage) {
    resultMessages.push(lastUserMessage);
  }
  
  // If targeting token count, check if we need further reduction
  if (targetTokenCount > 0) {
    const currentTokens = resultMessages.reduce((sum, msg) => {
      return sum + (msg.content ? Math.ceil(msg.content.length / 4) : 0);
    }, 0);
    
    if (currentTokens > targetTokenCount) {
      logger.warning(`Still over token limit (${currentTokens} > ${targetTokenCount}), truncating content`);
      
      // Identify system messages and last user message to preserve
      const systemMsgs = resultMessages.filter(msg => msg.role === 'system');
      const lastMsg = lastUserMessage ? [lastUserMessage] : [];
      const otherMsgs = resultMessages.filter(msg => 
        msg.role !== 'system' && 
        (lastUserMessage ? msg !== lastUserMessage : true)
      );
      
      // Calculate total tokens in protected messages
      const protectedTokens = [...systemMsgs, ...lastMsg].reduce((sum, msg) => {
        return sum + (msg.content ? Math.ceil(msg.content.length / 4) : 0);
      }, 0);
      
      // Calculate how many tokens we need to trim from other messages
      const tokensToTrim = currentTokens - targetTokenCount;
      const trimPercentage = 1 - ((targetTokenCount - protectedTokens) / 
                                   Math.max(1, currentTokens - protectedTokens));
      
      // Apply trimming to other messages
      otherMsgs.forEach(msg => {
        if (msg.content && msg.content.length > 100) {
          const originalLength = msg.content.length;
          // Keep 60% from start, 40% from end for most messages
          const keepStart = Math.floor(originalLength * 0.6 * (1 - trimPercentage));
          const keepEnd = Math.floor(originalLength * 0.4 * (1 - trimPercentage));
          
          if (keepStart + keepEnd < originalLength) {
            msg.content = msg.content.substring(0, keepStart) + 
                          " [...] " + 
                          msg.content.substring(originalLength - keepEnd);
          }
        }
      });
      
      // Reassemble message list
      resultMessages = [...systemMsgs, ...otherMsgs, ...lastMsg];
    }
  }
  
  logger.info(`Context reduced from ${messages.length} to ${resultMessages.length} messages`);
  return resultMessages;
}
