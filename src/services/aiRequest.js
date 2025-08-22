import { logApiRequest } from './apiLogService.js';
import axios from 'axios';
import { logger } from '../utils/logger.js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1/models';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TOGETHER_API_URL = 'https://api.together.xyz/v1/chat/completions';
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

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
    
    logger.debug('Sending request to Together.AI API using model: ' + model);
    
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
    
    logger.debug('Sending request to Gemini API using model: ' + model);
    
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
 * Request chat completion from NVIDIA API
 * @param {string} model - NVIDIA model name
 * @param {string} apiKey - NVIDIA API key
 * @param {Array} messages - Formatted messages
 * @param {object} params - Additional parameters
 * @returns {Promise<object>} NVIDIA API response
 */
async function requestNvidiaChat(model = 'meta/llama-3.3-70b-instruct', apiKey, messages, params) {
  const startTime = Date.now();
  let responseData = null;
  let errorOccurred = false;
  let errorDetails = null;
  
  // Estimate token count to ensure we stay under 8000 tokens
  const estimatedTokenCount = messages.reduce((count, msg) => {
    // Rough estimate: 1 token ≈ 4 chars for English text
    return count + (msg.content ? Math.ceil(msg.content.length / 3) : 0);
  }, 0);
  
  logger.debug(`Estimated token count for NVIDIA request: ${estimatedTokenCount}`);
  // If estimated tokens exceed 7000, reduce context to stay safely under 8000 limit
  let processedMessages = messages;
  // Move requestData declaration outside the try block so it's accessible in the catch block
  let requestData = {
    model: model,
    messages: processedMessages,
    temperature: params.temperature || 0.7,
    top_p: params.top_p || 0.95,
    max_tokens: Math.min(params.max_tokens || 1500, 1500), // Cap at 1500 tokens for response
    stream: false
  };
  
  // Add tool support according to NVIDIA documentation
  if (params.tools) {
    requestData.tools = params.tools;
  }
  
  // Add tool_choice if specified
  if (params.tool_choice) {
    requestData.tool_choice = params.tool_choice;
  }
  
  try {
    console.log(`Making request to NVIDIA API with model: ${model}`);
    
    // NVIDIA API endpoint
    const endpoint = NVIDIA_API_URL;
    
    console.log(`Using NVIDIA API endpoint: ${endpoint}`);
    
    // Add stop sequences if provided
    if (params.stop && Array.isArray(params.stop) && params.stop.length > 0) {
      requestData.stop = params.stop;
    }
    
    logger.debug('Sending request to NVIDIA API using model: ' + model);
    
    // Prepare request options
    const requestOptions = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    };
    
    // Make request to NVIDIA API
    const response = await axios.post(endpoint, requestData, requestOptions);
    
    logger.debug('NVIDIA API response received', { status: response.status });
    
    // Process response data
    responseData = response.data;
    
    if (!responseData || !responseData.choices || responseData.choices.length === 0) {
      logger.error('[AI Service] Invalid NVIDIA response format: no choices');
      errorOccurred = true;
      errorDetails = 'Invalid response format: no choices';
      throw new Error('Invalid response format: no choices');
    }
    
    // Extract response from first choice
    const messageData = responseData.choices[0].message;
    
    // Check for standard tool calls format first
    if (messageData && messageData.tool_calls && messageData.tool_calls.length > 0) {
      logger.debug('NVIDIA response contains standard tool calls', {
        toolCallsCount: messageData.tool_calls.length,
        firstToolCall: messageData.tool_calls[0]
      });
    }
    // Check for custom function call format: <function>name_of_function{"query": "harga game R.E.P.O. di internet"}<br></function>
    else if (messageData && messageData.content && typeof messageData.content === 'string') {
      // Log original content for debugging
      logger.debug('Checking for NVIDIA function call in content:', {
        contentPreview: messageData.content.substring(0, 200) + (messageData.content.length > 200 ? '...' : '')
      });
      
      // 1. Check for the exact format in the user query: <function>name_of_function{"query": "value"}<br></function>
      const exactFormatRegex = /<function>([a-zA-Z0-9_]+)({.*?})<br><\/function>/s;
      const exactMatch = messageData.content.match(exactFormatRegex);
      
      if (exactMatch) {
        logger.info('Detected exact NVIDIA function call format from the user query');
        
        try {
          const functionName = exactMatch[1].trim();
          let jsonString = exactMatch[2].trim();
          let functionArgs = {};
          
          try {
            functionArgs = JSON.parse(jsonString);
          } catch (parseError) {
            logger.warning(`Error parsing exact format function arguments: ${parseError.message}, attempting cleanup`);
            
            // Extract query parameter if it exists in the standard format
            const queryMatch = jsonString.match(/"query"\s*:\s*"([^"]*)"/);
            if (queryMatch) {
              functionArgs.query = queryMatch[1];
            } else {
              // If still can't parse, create a simple arguments object with the raw text
              functionArgs = { raw_arguments: jsonString };
            }
          }
          
          // Create a standard tool_calls format
          messageData.tool_calls = [{
            index: 0,
            id: `nvidia_call_${Date.now()}`,
            type: "function",
            function: {
              name: functionName,
              arguments: JSON.stringify(functionArgs)
            }
          }];
          
          // Remove the function call from the content
          messageData.content = messageData.content.replace(exactMatch[0], '').trim();
          
          logger.debug('Converted exact NVIDIA function call format', {
            originalMatch: exactMatch[0],
            functionName,
            functionArgs: JSON.stringify(functionArgs)
          });
        } catch (error) {
          logger.error('Error processing exact NVIDIA function call format', error);
        }
      }
      // 2. Try more robust regex pattern if exact format isn't found
      else {
        // More robust regex that can handle variations in the format
        const functionCallRegex = /<function>\s*([a-zA-Z0-9_]+)\s*({.*?})\s*(?:<br>)?\s*<\/function>/s;
        const match = messageData.content.match(functionCallRegex);
        
        if (match) {
          logger.info('Detected custom NVIDIA function call format');
          
          try {
            const functionName = match[1].trim();
            let functionArgs = {};
            let jsonString = match[2].trim();
            
            // Handle case where JSON might not be properly formatted
            try {
              functionArgs = JSON.parse(jsonString);
            } catch (parseError) {
              logger.warning(`Error parsing function arguments: ${parseError.message}, trying to clean up JSON`);
              
              // Try to clean up potentially malformed JSON
              const cleanedJson = jsonString
                .replace(/,\s*}/g, '}')  // Remove trailing commas
                .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
                .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')  // Ensure property names are quoted
                .replace(/\\"/g, '"')    // Fix escaped quotes
                .replace(/"{/g, '{')     // Remove leading quotes before brackets
                .replace(/}"/g, '}')     // Remove trailing quotes after brackets
                .replace(/\n/g, ' ');    // Remove newlines
                
              try {
                functionArgs = JSON.parse(cleanedJson);
              } catch (secondError) {
                // If still failing, try a more aggressive approach to extract key-value pairs
                logger.warning(`Second attempt at parsing JSON failed: ${secondError.message}, trying advanced extraction`);
                
                // Extract key-value pairs manually
                const kvPattern = /"?([a-zA-Z0-9_]+)"?\s*:\s*"([^"]*)"/g;
                let match;
                
                while ((match = kvPattern.exec(jsonString)) !== null) {
                  functionArgs[match[1]] = match[2];
                }
                
                if (Object.keys(functionArgs).length === 0) {
                  throw new Error("Could not parse function arguments");
                }
              }
            }
            
            // Create a standard tool_calls format that our existing code can handle
            messageData.tool_calls = [{
              index: 0,
              id: `nvidia_call_${Date.now()}`,
              type: "function",
              function: {
                name: functionName,
                arguments: JSON.stringify(functionArgs)
              }
            }];
            
            // Remove the function call from the content to avoid confusion
            messageData.content = messageData.content.replace(match[0], '').trim();
            
            logger.debug('Converted NVIDIA custom function call to standard format', {
              originalMatch: match[0],
              functionName,
              functionArgs: JSON.stringify(functionArgs)
            });
          } catch (error) {
            logger.error('Error processing NVIDIA custom function call format', error);
            logger.error('Function call pattern that failed to parse:', match ? match[0] : 'No match');
          }
        } else {
          // Try an alternative format pattern that some NVIDIA models might return
          const alternativePattern = /<function>([^<]+)<\/function>/s;
          const altMatch = messageData.content.match(alternativePattern);
          
          if (altMatch) {
            logger.info('Detected alternative NVIDIA function call format');
            
            try {
              // This format might have the function name and arguments in a single string
              const fullFunctionText = altMatch[1].trim();
              
              // Try to extract function name and arguments
              const functionNameMatch = fullFunctionText.match(/^([a-zA-Z0-9_]+)/);
              const functionName = functionNameMatch ? functionNameMatch[1] : 'unknown_function';
              
              // Extract anything that looks like JSON
              const jsonMatch = fullFunctionText.match(/({.*})/);
              let functionArgs = {};
              
              if (jsonMatch) {
                try {
                  functionArgs = JSON.parse(jsonMatch[1]);
                } catch (parseError) {
                  logger.warning(`Error parsing alternative function format: ${parseError.message}`);
                  
                  // Try to extract key-value pairs manually
                  const kvPattern = /"?([a-zA-Z0-9_]+)"?\s*:\s*"([^"]*)"/g;
                  let match;
                  
                  while ((match = kvPattern.exec(jsonMatch[1])) !== null) {
                    functionArgs[match[1]] = match[2];
                  }
                }
              } else {
                // If no JSON-like structure is found, try to extract query parameter
                const queryMatch = fullFunctionText.match(/query\s*[:=]\s*"([^"]*)"/);
                if (queryMatch) {
                  functionArgs.query = queryMatch[1];
                }
              }
              
              // Create standard tool_calls format
              messageData.tool_calls = [{
                index: 0,
                id: `nvidia_call_${Date.now()}`,
                type: "function",
                function: {
                  name: functionName,
                  arguments: JSON.stringify(functionArgs)
                }
              }];
              
              // Remove the function call from the content
              messageData.content = messageData.content.replace(altMatch[0], '').trim();
              
              logger.debug('Converted alternative NVIDIA function call format', {
                originalMatch: altMatch[0],
                functionName,
                functionArgs: JSON.stringify(functionArgs)
              });
            } catch (error) {
              logger.error('Error processing alternative NVIDIA function call format', error);
            }
          }
        }
      }
    }
    
    // Check content exists if there's no tool call
    if (!messageData.tool_calls && (!messageData || !messageData.content)) {
      logger.error('[AI Service] Invalid NVIDIA response format: no message content or tool_calls');
      errorOccurred = true;
      errorDetails = 'Invalid response format: no message content or tool_calls';
      throw new Error('Invalid response format: no message content or tool_calls');
    }
    
    logger.success(`Successfully processed NVIDIA API response`);
    
    // Extract token usage if available
    const promptTokens = responseData.usage?.prompt_tokens || 0;
    const completionTokens = responseData.usage?.completion_tokens || 0;
    
    // Log API request and response
    await logApiRequest(
      endpoint,
      'nvidia',
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
    logger.error(`[AI Service] NVIDIA API error: ${error.message}`);
    
    if (error.response) {
      logger.error('[AI Service] NVIDIA API error details', {
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
        NVIDIA_API_URL, // Fixed: Changed incorrect TOGETHER_API_URL to NVIDIA_API_URL
        'nvidia',
        model,
        {
          method: 'POST',
          url: NVIDIA_API_URL, // Fixed: Changed incorrect TOGETHER_API_URL to NVIDIA_API_URL
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

export { TOGETHER_API_URL, GEMINI_API_URL, OPENROUTER_API_URL, NVIDIA_API_URL, requestTogetherChat, requestGeminiChat, requestNvidiaChat };