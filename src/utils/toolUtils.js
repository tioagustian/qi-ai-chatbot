/**
 * Tool Utilities
 * Common utility functions for tool management and validation
 */

/**
 * Validate tool parameters against a schema
 * @param {Object} args - The arguments to validate
 * @param {Object} schema - The parameter schema
 * @returns {Object} - Validation result with success and errors
 */
function validateToolParameters(args, schema) {
  const errors = [];
  
  // Check required parameters
  if (schema.required) {
    for (const param of schema.required) {
      if (!args.hasOwnProperty(param) || args[param] === undefined || args[param] === null) {
        errors.push(`Missing required parameter: ${param}`);
      }
    }
  }
  
  // Check parameter types
  if (schema.properties) {
    for (const [param, config] of Object.entries(schema.properties)) {
      if (args.hasOwnProperty(param) && args[param] !== undefined && args[param] !== null) {
        const value = args[param];
        const expectedType = config.type;
        
        switch (expectedType) {
          case 'string':
            if (typeof value !== 'string') {
              errors.push(`Parameter ${param} must be a string`);
            }
            break;
          case 'number':
            if (typeof value !== 'number' || isNaN(value)) {
              errors.push(`Parameter ${param} must be a number`);
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean') {
              errors.push(`Parameter ${param} must be a boolean`);
            }
            break;
          case 'object':
            if (typeof value !== 'object' || Array.isArray(value)) {
              errors.push(`Parameter ${param} must be an object`);
            }
            break;
          case 'array':
            if (!Array.isArray(value)) {
              errors.push(`Parameter ${param} must be an array`);
            }
            break;
        }
      }
    }
  }
  
  return {
    success: errors.length === 0,
    errors
  };
}

/**
 * Format tool execution result for consistent output
 * @param {any} result - The result from tool execution
 * @returns {string} - Formatted result string
 */
function formatToolResult(result) {
  if (typeof result === 'string') {
    return result;
  } else if (result && typeof result === 'object') {
    if (result.message) {
      return result.message;
    } else if (result.error) {
      return `Error: ${result.error}`;
    } else {
      return JSON.stringify(result, null, 2);
    }
  } else {
    return String(result);
  }
}

/**
 * Create a standardized error response for tools
 * @param {string} message - Error message
 * @param {string} code - Error code (optional)
 * @returns {Object} - Standardized error response
 */
function createToolError(message, code = 'TOOL_ERROR') {
  return {
    success: false,
    error: message,
    code,
    message: `Error: ${message}`
  };
}

/**
 * Create a standardized success response for tools
 * @param {any} data - The data to return
 * @param {string} message - Success message (optional)
 * @returns {Object} - Standardized success response
 */
function createToolSuccess(data, message = null) {
  return {
    success: true,
    data,
    message: message || formatToolResult(data)
  };
}

/**
 * Sanitize URL for security
 * @param {string} url - The URL to sanitize
 * @returns {string|null} - Sanitized URL or null if invalid
 */
function sanitizeUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Only allow http and https protocols
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return null;
    }
    
    // Block potentially dangerous domains
    const dangerousDomains = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      'file://',
      'data:',
      'javascript:',
      'vbscript:'
    ];
    
    const hostname = urlObj.hostname.toLowerCase();
    for (const domain of dangerousDomains) {
      if (hostname.includes(domain)) {
        return null;
      }
    }
    
    return urlObj.toString();
  } catch (error) {
    return null;
  }
}

/**
 * Truncate text to a maximum length
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add when truncated
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength = 1000, suffix = '...') {
  if (typeof text !== 'string') {
    return String(text);
  }
  
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Generate a unique identifier for tool calls
 * @returns {string} - Unique identifier
 */
function generateToolCallId() {
  return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export {
  validateToolParameters,
  formatToolResult,
  createToolError,
  createToolSuccess,
  sanitizeUrl,
  truncateText,
  generateToolCallId
};
