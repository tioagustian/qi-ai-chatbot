/**
 * Tool: Get Current Time
 * Description: Get the current time and date in Indonesian format
 * Type: function
 * Category: utility
 */

/**
 * Get the current time and date
 * @param {Object} args - Arguments object (empty for this tool)
 * @returns {string} - Current time and date in Indonesian format
 */
async function getCurrentTime(args = {}) {
  const now = new Date();
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return `Sekarang ${now.toLocaleDateString('id-ID', options)}`;
}

// Tool definition for AI models
const toolDefinition = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Get the current time and date in Indonesian format",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
};

export { getCurrentTime, toolDefinition };
