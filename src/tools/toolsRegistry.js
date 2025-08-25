/**
 * Tools Registry
 * Centralized management of all available tools for the AI chatbot
 * This file provides a unified interface for tool definitions and execution
 * Auto-loads all tool files from the tools directory
 */

import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tools registry with metadata
let toolsRegistry = {};

/**
 * Get tool settings from database
 * @returns {Object} - Tool settings object
 */
function getToolSettings() {
  try {
    const db = getDb();
    return db.data.config.toolSettings || {};
  } catch (error) {
    console.warn('Could not get tool settings from database:', error.message);
    return {};
  }
}

/**
 * Save tool settings to database
 * @param {Object} settings - Tool settings to save
 */
async function saveToolSettings(settings) {
  try {
    const db = getDb();
    db.data.config.toolSettings = settings;
    await db.write();
  } catch (error) {
    console.error('Could not save tool settings to database:', error.message);
  }
}

/**
 * Auto-load all tool files from the tools directory
 * @returns {Promise<void>}
 */
async function loadTools() {
  try {
    const toolsDir = __dirname;
    const files = await readdir(toolsDir);
    
    // Filter for tool files (excluding this registry file and other non-tool files)
    const toolFiles = files.filter(file => 
      file.endsWith('.js') &&
      file !== 'toolsRegistry.js' && 
      file !== 'README.md'
    );
    
    console.log(`Auto-loading ${toolFiles.length} tool files...`);
    
    // Get tool settings from database
    const toolSettings = getToolSettings();
    
    // Load each tool file
    for (const file of toolFiles) {
      try {
        const toolModule = await import(`./${file}`);
        
        // Check if the module exports both the function and toolDefinition
        if (toolModule.toolDefinition) {
          // Find the tool function (could be named anything, not just ending with 'Tool')
          const toolFunctionName = Object.keys(toolModule).find(key => 
            typeof toolModule[key] === 'function' && 
            key !== 'default' && 
            key !== 'toolDefinition'
          );
          
          if (toolFunctionName) {
            const toolName = toolModule.toolDefinition.function.name;
            const toolFunction = toolModule[toolFunctionName];
            
            // Determine category from file name or default to 'utility'
            let category = 'utility';
            if (file.includes('Search') || file.includes('search')) {
              category = 'search';
            } else if (file.includes('Fetch') || file.includes('fetch') || file.includes('Content')) {
              category = 'content-extraction';
            } else if (file.includes('Steam') || file.includes('steam') || file.includes('Game')) {
              category = 'gaming';
            }
            
            // Check if tool is enabled (default to true if not set)
            const isEnabled = toolSettings[toolName] !== false; // Default to true
            
            // Add to registry
            toolsRegistry[toolName] = {
              definition: toolModule.toolDefinition,
              function: toolFunction,
              category: category,
              description: toolModule.toolDefinition.function.description || 'No description available',
              file: file,
              enabled: isEnabled
            };
            
            console.log(`✅ Loaded tool: ${toolName} (${category}) from ${file} - ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
          } else {
            console.warn(`⚠️  Skipping ${file}: Missing tool function export`);
          }
        } else {
          console.warn(`⚠️  Skipping ${file}: Missing required exports (toolDefinition or Tool function)`);
        }
      } catch (error) {
        console.error(`❌ Error loading tool from ${file}:`, error.message);
      }
    }
    
    console.log(`🎉 Successfully loaded ${Object.keys(toolsRegistry).length} tools`);
    
  } catch (error) {
    console.error('❌ Error loading tools:', error);
    throw error;
  }
}

/**
 * Get all available tools for AI models (only enabled tools)
 * @returns {Array} - Array of tool definitions
 */
function _getTools() {
  return Object.values(toolsRegistry)
    .filter(tool => tool.enabled)
    .map(tool => tool.definition);
}

/**
 * Get all tools including disabled ones
 * @returns {Array} - Array of all tool definitions
 */
function _getAllTools() {
  return Object.values(toolsRegistry).map(tool => tool.definition);
}

/**
 * Get tools by category (only enabled tools)
 * @param {string} category - The category to filter by
 * @returns {Array} - Array of tool definitions for the specified category
 */
function _getToolsByCategory(category) {
  return Object.values(toolsRegistry)
    .filter(tool => tool.category === category && tool.enabled)
    .map(tool => tool.definition);
}

/**
 * Get all tools by category including disabled ones
 * @param {string} category - The category to filter by
 * @returns {Array} - Array of all tool definitions for the specified category
 */
function _getAllToolsByCategory(category) {
  return Object.values(toolsRegistry)
    .filter(tool => tool.category === category)
    .map(tool => tool.definition);
}

/**
 * Get available tool categories
 * @returns {Array} - Array of available categories
 */
function _getToolCategories() {
  return [...new Set(Object.values(toolsRegistry).map(tool => tool.category))];
}

/**
 * Handle tool call execution
 * @param {Object} functionCall - The function call object from AI
 * @returns {Promise<string>} - The result of the tool execution
 */
async function _handleToolCall(functionCall) {
  const { name, arguments: args } = functionCall;
  
  try {
    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
    
    // Check if tool exists in registry
    if (!toolsRegistry[name]) {
      return `Error: Tool "${name}" tidak tersedia.`;
    }
    
    const tool = toolsRegistry[name];
    
    // Execute the tool function
    const result = await tool.function(parsedArgs);
    
    // Handle different result formats
    if (typeof result === 'string') {
      return result;
    } else if (result && typeof result === 'object') {
      return result.message || result.error || JSON.stringify(result);
    } else {
      return String(result);
    }
    
  } catch (error) {
    console.error(`Error handling tool call ${name}:`, error);
    return `Error: Terjadi kesalahan saat menjalankan tool "${name}": ${error.message}`;
  }
}

/**
 * Get tool information by name
 * @param {string} toolName - The name of the tool
 * @returns {Object|null} - Tool information or null if not found
 */
function _getToolInfo(toolName) {
  return toolsRegistry[toolName] || null;
}

/**
 * Enable a tool
 * @param {string} toolName - The name of the tool to enable
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function _enableTool(toolName) {
  try {
    if (!toolsRegistry[toolName]) {
      return { success: false, message: `Tool "${toolName}" tidak ditemukan.` };
    }
    
    if (toolsRegistry[toolName].enabled) {
      return { success: true, message: `Tool "${toolName}" sudah aktif.` };
    }
    
    // Enable the tool
    toolsRegistry[toolName].enabled = true;
    
    // Save settings to database
    const toolSettings = getToolSettings();
    toolSettings[toolName] = true;
    await saveToolSettings(toolSettings);
    
    return { success: true, message: `Tool "${toolName}" berhasil diaktifkan.` };
  } catch (error) {
    console.error(`Error enabling tool ${toolName}:`, error);
    return { success: false, message: `Error mengaktifkan tool "${toolName}": ${error.message}` };
  }
}

/**
 * Disable a tool
 * @param {string} toolName - The name of the tool to disable
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function _disableTool(toolName) {
  try {
    if (!toolsRegistry[toolName]) {
      return { success: false, message: `Tool "${toolName}" tidak ditemukan.` };
    }
    
    if (!toolsRegistry[toolName].enabled) {
      return { success: true, message: `Tool "${toolName}" sudah dinonaktifkan.` };
    }
    
    // Disable the tool
    toolsRegistry[toolName].enabled = false;
    
    // Save settings to database
    const toolSettings = getToolSettings();
    toolSettings[toolName] = false;
    await saveToolSettings(toolSettings);
    
    return { success: true, message: `Tool "${toolName}" berhasil dinonaktifkan.` };
  } catch (error) {
    console.error(`Error disabling tool ${toolName}:`, error);
    return { success: false, message: `Error menonaktifkan tool "${toolName}": ${error.message}` };
  }
}

/**
 * Enable all tools
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function _enableAllTools() {
  try {
    const toolSettings = getToolSettings();
    let enabledCount = 0;
    
    for (const toolName in toolsRegistry) {
      if (!toolsRegistry[toolName].enabled) {
        toolsRegistry[toolName].enabled = true;
        toolSettings[toolName] = true;
        enabledCount++;
      }
    }
    
    await saveToolSettings(toolSettings);
    
    return { 
      success: true, 
      message: `Berhasil mengaktifkan ${enabledCount} tool. Total tool aktif: ${Object.keys(toolsRegistry).length}` 
    };
  } catch (error) {
    console.error('Error enabling all tools:', error);
    return { success: false, message: `Error mengaktifkan semua tool: ${error.message}` };
  }
}

/**
 * Disable all tools
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function _disableAllTools() {
  try {
    const toolSettings = getToolSettings();
    let disabledCount = 0;
    
    for (const toolName in toolsRegistry) {
      if (toolsRegistry[toolName].enabled) {
        toolsRegistry[toolName].enabled = false;
        toolSettings[toolName] = false;
        disabledCount++;
      }
    }
    
    await saveToolSettings(toolSettings);
    
    return { 
      success: true, 
      message: `Berhasil menonaktifkan ${disabledCount} tool. Semua tool sekarang dinonaktifkan.` 
    };
  } catch (error) {
    console.error('Error disabling all tools:', error);
    return { success: false, message: `Error menonaktifkan semua tool: ${error.message}` };
  }
}

/**
 * Enable tools by category
 * @param {string} category - The category to enable
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function _enableToolsByCategory(category) {
  try {
    const toolSettings = getToolSettings();
    let enabledCount = 0;
    
    for (const toolName in toolsRegistry) {
      if (toolsRegistry[toolName].category === category && !toolsRegistry[toolName].enabled) {
        toolsRegistry[toolName].enabled = true;
        toolSettings[toolName] = true;
        enabledCount++;
      }
    }
    
    await saveToolSettings(toolSettings);
    
    return { 
      success: true, 
      message: `Berhasil mengaktifkan ${enabledCount} tool dalam kategori "${category}".` 
    };
  } catch (error) {
    console.error(`Error enabling tools in category ${category}:`, error);
    return { success: false, message: `Error mengaktifkan tool kategori "${category}": ${error.message}` };
  }
}

/**
 * Disable tools by category
 * @param {string} category - The category to disable
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function _disableToolsByCategory(category) {
  try {
    const toolSettings = getToolSettings();
    let disabledCount = 0;
    
    for (const toolName in toolsRegistry) {
      if (toolsRegistry[toolName].category === category && toolsRegistry[toolName].enabled) {
        toolsRegistry[toolName].enabled = false;
        toolSettings[toolName] = false;
        disabledCount++;
      }
    }
    
    await saveToolSettings(toolSettings);
    
    return { 
      success: true, 
      message: `Berhasil menonaktifkan ${disabledCount} tool dalam kategori "${category}".` 
    };
  } catch (error) {
    console.error(`Error disabling tools in category ${category}:`, error);
    return { success: false, message: `Error menonaktifkan tool kategori "${category}": ${error.message}` };
  }
}

/**
 * List all available tools with their descriptions and status
 * @returns {Array} - Array of tool information objects
 */
function _listAllTools() {
  return Object.entries(toolsRegistry).map(([name, tool]) => ({
    name,
    category: tool.category,
    description: tool.description,
    parameters: tool.definition.function.parameters,
    file: tool.file,
    enabled: tool.enabled
  }));
}

/**
 * Get tools registry status with enabled/disabled counts
 * @returns {Object} - Registry status information
 */
function _getRegistryStatus() {
  const enabledTools = Object.values(toolsRegistry).filter(tool => tool.enabled);
  const disabledTools = Object.values(toolsRegistry).filter(tool => !tool.enabled);
  
  return {
    totalTools: Object.keys(toolsRegistry).length,
    enabledTools: enabledTools.length,
    disabledTools: disabledTools.length,
    categories: _getToolCategories(),
    tools: Object.keys(toolsRegistry),
    enabledToolNames: enabledTools.map(tool => tool.definition.function.name),
    disabledToolNames: disabledTools.map(tool => tool.definition.function.name),
    loaded: Object.keys(toolsRegistry).length > 0
  };
}

/**
 * Reload all tools (useful for development)
 * @returns {Promise<void>}
 */
async function reloadTools() {
  console.log('🔄 Reloading tools...');
  toolsRegistry = {};
  await loadTools();
}

// Initialize tools on module load
let toolsLoaded = false;

/**
 * Ensure tools are loaded before use
 * @returns {Promise<void>}
 */
async function ensureToolsLoaded() {
  if (!toolsLoaded) {
    await loadTools();
    toolsLoaded = true;
  }
}

// Export functions that ensure tools are loaded
export {
  reloadTools
};

// Export async wrapper functions
export async function getTools() {
  await ensureToolsLoaded();
  return _getTools();
}

export async function getAllTools() {
  await ensureToolsLoaded();
  return _getAllTools();
}

export async function getToolsByCategory(category) {
  await ensureToolsLoaded();
  return _getToolsByCategory(category);
}

export async function getAllToolsByCategory(category) {
  await ensureToolsLoaded();
  return _getAllToolsByCategory(category);
}

export async function getToolCategories() {
  await ensureToolsLoaded();
  return _getToolCategories();
}

export async function handleToolCall(functionCall) {
  await ensureToolsLoaded();
  return _handleToolCall(functionCall);
}

export async function getToolInfo(toolName) {
  await ensureToolsLoaded();
  return _getToolInfo(toolName);
}

export async function listAllTools() {
  await ensureToolsLoaded();
  return _listAllTools();
}

export async function getRegistryStatus() {
  await ensureToolsLoaded();
  return _getRegistryStatus();
}

export async function getToolsRegistry() {
  await ensureToolsLoaded();
  return toolsRegistry;
}

// Export tool management functions
export async function enableTool(toolName) {
  await ensureToolsLoaded();
  return _enableTool(toolName);
}

export async function disableTool(toolName) {
  await ensureToolsLoaded();
  return _disableTool(toolName);
}

export async function enableAllTools() {
  await ensureToolsLoaded();
  return _enableAllTools();
}

export async function disableAllTools() {
  await ensureToolsLoaded();
  return _disableAllTools();
}

export async function enableToolsByCategory(category) {
  await ensureToolsLoaded();
  return _enableToolsByCategory(category);
}

export async function disableToolsByCategory(category) {
  await ensureToolsLoaded();
  return _disableToolsByCategory(category);
}
