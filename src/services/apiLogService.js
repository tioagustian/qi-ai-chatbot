import { getDb } from '../database/index.js';
import chalk from 'chalk';

// Console logging helper
const logger = {
  info: (message) => console.log(chalk.blue(`[API-LOG][${new Date().toISOString()}] ${message}`)),
  success: (message) => console.log(chalk.green(`[API-LOG][${new Date().toISOString()}] ${message}`)),
  warning: (message) => console.log(chalk.yellow(`[API-LOG][${new Date().toISOString()}] ${message}`)),
  error: (message, error) => {
    console.log(chalk.red(`[API-LOG ERROR][${new Date().toISOString()}] ${message}`));
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
      console.log(chalk.magenta(`[API-LOG DEBUG][${new Date().toISOString()}] ${message}`));
      if (data) console.log(chalk.magenta('Debug data:'), data);
    }
  }
};

/**
 * Log an API request and its response
 * @param {string} endpoint - API endpoint
 * @param {string} provider - API provider (e.g., 'gemini', 'openrouter', 'together')
 * @param {string} model - Model being used
 * @param {Object} requestData - Request data sent to the API
 * @param {Object} responseData - Response received from the API
 * @param {Object} metadata - Additional metadata (chatId, messageId, etc.)
 * @returns {Promise<string>} - ID of the log entry
 */
async function logApiRequest(endpoint, provider, model, requestData, responseData, metadata = {}) {
  try {
    const db = getDb();
    
    // Check if API logging is enabled
    if (!db.data.config.apiLoggingEnabled) {
      logger.debug('API logging is disabled, skipping log');
      return null;
    }
    
    // Create a log entry
    const timestamp = new Date().toISOString();
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // Sanitize request data by removing API keys
    let sanitizedRequestData = JSON.parse(JSON.stringify(requestData));
    
    // Remove API keys from headers if present
    if (sanitizedRequestData.headers) {
      const sensitiveHeaderKeys = ['authorization', 'x-goog-api-key', 'api-key', 'x-api-key'];
      sensitiveHeaderKeys.forEach(key => {
        if (sanitizedRequestData.headers[key]) {
          sanitizedRequestData.headers[key] = '*** REDACTED ***';
        }
      });
    }
    
    // Create the log entry
    const logEntry = {
      id: logId,
      timestamp,
      endpoint,
      provider,
      model,
      request: sanitizedRequestData,
      response: responseData,
      metadata: {
        ...metadata,
        executionTime: metadata.executionTime || null,
        status: responseData?.status || null,
        statusText: responseData?.statusText || null
      }
    };
    
    // Add to database
    db.data.apiLogs.push(logEntry);
    
    // Limit the number of logs (keep latest 1000)
    const maxLogEntries = 1000;
    if (db.data.apiLogs.length > maxLogEntries) {
      db.data.apiLogs = db.data.apiLogs.slice(-maxLogEntries);
    }
    
    // Save to database
    await db.write();
    
    logger.success(`Logged API request to ${provider} (${model}) with log ID: ${logId}`);
    
    return logId;
  } catch (error) {
    logger.error('Error logging API request', error);
    return null;
  }
}

/**
 * Get API logs with optional filtering
 * @param {Object} options - Filter options
 * @param {number} limit - Maximum number of logs to return
 * @returns {Array} - Filtered API logs
 */
function getApiLogs(options = {}, limit = 100) {
  try {
    const db = getDb();
    
    // Filter logs based on options
    let filteredLogs = [...db.data.apiLogs];
    
    // Filter by provider
    if (options.provider) {
      filteredLogs = filteredLogs.filter(log => log.provider === options.provider);
    }
    
    // Filter by model
    if (options.model) {
      filteredLogs = filteredLogs.filter(log => log.model.includes(options.model));
    }
    
    // Filter by chat ID
    if (options.chatId) {
      filteredLogs = filteredLogs.filter(log => log.metadata?.chatId === options.chatId);
    }
    
    // Filter by date range
    if (options.startDate) {
      const startDate = new Date(options.startDate);
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= startDate);
    }
    
    if (options.endDate) {
      const endDate = new Date(options.endDate);
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= endDate);
    }
    
    // Sort by timestamp (newest first)
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Limit results
    return filteredLogs.slice(0, limit);
  } catch (error) {
    logger.error('Error getting API logs', error);
    return [];
  }
}

/**
 * Clear API logs (for maintenance or privacy reasons)
 * @param {boolean} keepLastDay - Whether to keep the last day of logs
 * @returns {Promise<boolean>} - Success status
 */
async function clearApiLogs(keepLastDay = true) {
  try {
    const db = getDb();
    
    if (keepLastDay) {
      // Keep only the last 24 hours of logs
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 1);
      
      db.data.apiLogs = db.data.apiLogs.filter(log => 
        new Date(log.timestamp) > cutoffDate
      );
    } else {
      // Clear all logs
      db.data.apiLogs = [];
    }
    
    // Save to database
    await db.write();
    
    logger.success(`Cleared API logs (keepLastDay: ${keepLastDay})`);
    return true;
  } catch (error) {
    logger.error('Error clearing API logs', error);
    return false;
  }
}

export {
  logApiRequest,
  getApiLogs,
  clearApiLogs
}; 