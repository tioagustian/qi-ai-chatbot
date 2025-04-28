import { getDb } from '../database/index.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define logs directory path
const logsDir = path.join(__dirname, '../../logs/api');

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
 * Log an API request and its response to a file
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
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const logId = `log_${date}}`;
    
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
    
    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Write log to file
    const logFilePath = path.join(logsDir, `${logId}.json`);
    let previousLogData = [];
    if (fs.existsSync(logFilePath)) {
      previousLogData = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
    }
    await fs.promises.writeFile(logFilePath, JSON.stringify([...previousLogData, logEntry], null, 2));
    
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
    // Read all log files from directory
    if (!fs.existsSync(logsDir)) {
      return [];
    }
    
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.json'));
    
    // Read and parse each log file
    let logs = [];
    for (const file of logFiles) {
      try {
        const logData = JSON.parse(fs.readFileSync(path.join(logsDir, file), 'utf8'));
        logs.push(logData);
      } catch (err) {
        logger.error(`Error reading log file ${file}`, err);
      }
    }
    
    // Filter logs based on options
    let filteredLogs = [...logs];
    
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
 * Clear all API logs
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
async function clearApiLogs() {
  try {
    if (!fs.existsSync(logsDir)) {
      return true;
    }
    
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.json'));
    
    for (const file of logFiles) {
      fs.unlinkSync(path.join(logsDir, file));
    }
    
    logger.success('All API logs cleared successfully');
    return true;
  } catch (error) {
    logger.error('Error clearing API logs', error);
    return false;
  }
}

/**
 * Clean up old API logs based on retention days
 * @returns {Promise<number>} - Number of logs removed
 */
async function cleanupOldLogs() {
  try {
    const db = getDb();
    const retentionDays = db.data.config.apiLogRetentionDays || 7;
    
    if (!fs.existsSync(logsDir)) {
      return 0;
    }
    
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.json'));
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    let removedCount = 0;
    
    for (const file of logFiles) {
      try {
        const logPath = path.join(logsDir, file);
        const stats = fs.statSync(logPath);
        
        // Check if file's modified date is older than retention period
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(logPath);
          removedCount++;

        }
      } catch (err) {
        logger.error(`Error processing log file ${file} during cleanup`, err);
      }
    }
    
    if (removedCount > 0) {
      logger.success(`Cleaned up ${removedCount} old API logs (older than ${retentionDays} days)`);
    }
    
    return removedCount;
  } catch (error) {
    logger.error('Error cleaning up old API logs', error);
    return 0;
  }
}

export {
  logApiRequest,
  getApiLogs,
  clearApiLogs,
  cleanupOldLogs
}; 
