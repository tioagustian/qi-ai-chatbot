import { setMood, setPersonality, getAvailableMoods, getAvailablePersonalities } from './personalityService.js';
import { clearContext } from './contextService.js';
import { getAvailableModels } from './aiService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Command prefix
const COMMAND_PREFIX = ['!', '/'];

// Detect if a message is a command
function detectCommand(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  // Check if message starts with command prefix
  const firstChar = message.charAt(0);
  if (!COMMAND_PREFIX.includes(firstChar)) {
    return null;
  }

  // Parse command and arguments
  const parts = message.substring(1).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!command) {
    return null;
  }

  return { command, args };
}

// Execute a command
async function executeCommand(sock, message, commandData, db) {
  try {
    const { command, args } = commandData;
    const chatId = message.key.remoteJid;
    const sender = message.key.participant || message.key.remoteJid;
    
    // Check if this is a private chat
    const isPrivateChat = !chatId.endsWith('@g.us');
    
    // Check if sender is authorized (only 6282111182808 can execute commands)
    const authorizedSender = '6282111182808@s.whatsapp.net';
    const isAuthorized = sender === authorizedSender || chatId === authorizedSender;
    
    // If not private chat or not authorized, return message
    if (!isPrivateChat || !isAuthorized) {
      return 'Perintah hanya bisa dijalankan di chat pribadi dan oleh pengguna yang diizinkan.';
    }
    
    console.log(`Executing command: ${command} with args: ${args.join(', ')}`);
    
    switch (command.toLowerCase()) {
      case 'help':
        return getHelpText();
        
      case 'ping':
        return 'Pong! Bot aktif dan siap menjawab.';
        
      case 'setmood':
        if (args.length === 0) {
          const availableMoods = getAvailableMoods();
          return `Mood yang tersedia: ${availableMoods.join(', ')}\nGunakan: !setmood [nama_mood]`;
        }
        const moodResult = await setMood(db, args[0]);
        return moodResult.message;
        
      case 'setpersonality':
        if (args.length === 0) {
          const availablePersonalities = getAvailablePersonalities();
          return `Personality yang tersedia: ${availablePersonalities.join(', ')}\nGunakan: !setpersonality [nama_personality]`;
        }
        const personalityResult = await setPersonality(db, args[0]);
        return personalityResult.message;
        
      case 'setmodel':
        if (args.length === 0) {
          const models = await getAvailableModels();
          return getModelSelectionText(models);
        }
        const modelResult = await setModel(db, args[0]);
        return modelResult.message;
        
      case 'setprovider':
        if (args.length === 0) {
          return 'Gunakan format: !setprovider [openrouter/gemini]\nProvider saat ini: ' + (db.data.config.defaultProvider || 'openrouter');
        }
        const providerResult = await setProvider(db, args[0]);
        return providerResult.message;
        
      case 'setapikey':
        if (args.length === 0) {
          return 'Gunakan format: !setapikey [YOUR_API_KEY]';
        }
        const apiKeyResult = await setApiKey(args[0]);
        return apiKeyResult.message;
        
      case 'setgeminikey':
        if (args.length === 0) {
          return 'Gunakan format: !setgeminikey [YOUR_GEMINI_API_KEY]';
        }
        const geminiKeyResult = await setGeminiApiKey(args[0]);
        return geminiKeyResult.message;
        
      case 'status':
        return getStatusText(db);
        
      case 'clear':
        const clearResult = await clearContext(db, chatId);
        return clearResult.message;
        
      case 'setname':
        if (args.length === 0) {
          return `Nama bot saat ini: ${db.data.config.botName}\nGunakan: !setname [nama_baru]`;
        }
        const nameResult = await setBotName(db, args[0]);
        return nameResult.message;
        
      case 'debug':
        return getDebugInfo(db, chatId, sender);
        
      default:
        return `Perintah tidak dikenal: ${command}. Gunakan !help untuk bantuan.`;
    }
  } catch (error) {
    console.error('Error executing command:', error);
    return 'Terjadi kesalahan saat menjalankan perintah.';
  }
}

// Set API key
async function setApiKey(apiKey) {
  try {
    // Read existing .env file
    const envPath = path.resolve(__dirname, '../../.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update OPENROUTER_API_KEY value
    const regex = /OPENROUTER_API_KEY=.*/;
    const newEnvVar = `OPENROUTER_API_KEY=${apiKey}`;
    
    if (regex.test(envContent)) {
      // Replace existing value
      envContent = envContent.replace(regex, newEnvVar);
    } else {
      // Add new value
      envContent += `\n${newEnvVar}`;
    }
    
    // Write back to .env file
    fs.writeFileSync(envPath, envContent);
    
    // Update process.env
    process.env.OPENROUTER_API_KEY = apiKey;
    
    return { success: true, message: 'OpenRouter API key berhasil diatur. Bot sekarang dapat menggunakan OpenRouter API.' };
  } catch (error) {
    console.error('Error setting API key:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengatur API key.' };
  }
}

// Set Gemini API key
async function setGeminiApiKey(apiKey) {
  try {
    // Read existing .env file
    const envPath = path.resolve(__dirname, '../../.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update GEMINI_API_KEY value
    const regex = /GEMINI_API_KEY=.*/;
    const newEnvVar = `GEMINI_API_KEY=${apiKey}`;
    
    if (regex.test(envContent)) {
      // Replace existing value
      envContent = envContent.replace(regex, newEnvVar);
    } else {
      // Add new value
      envContent += `\n${newEnvVar}`;
    }
    
    // Write back to .env file
    fs.writeFileSync(envPath, envContent);
    
    // Update process.env
    process.env.GEMINI_API_KEY = apiKey;
    
    // Also store in the database
    const db = getDb();
    db.data.config.geminiApiKey = apiKey;
    await db.write();
    
    return { success: true, message: 'Gemini API key berhasil diatur. Bot sekarang dapat menggunakan model Google Gemini.' };
  } catch (error) {
    console.error('Error setting Gemini API key:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengatur Gemini API key.' };
  }
}

// Set AI model
async function setModel(db, modelId) {
  try {
    // Get current provider
    const currentProvider = db.data.config.defaultProvider || 'openrouter';
    
    // List of supported models with shortnames
    const supportedModels = {
      // OpenRouter models
      'gpt4o': 'openai/gpt-4o',
      'gpt4': 'openai/gpt-4',
      'gpt3': 'openai/gpt-3.5-turbo',
      'claude3opus': 'anthropic/claude-3-opus',
      'claude3sonnet': 'anthropic/claude-3-sonnet',
      'claude3haiku': 'anthropic/claude-3-haiku',
      'deepseek': 'deepseek/deepseek-chat-v3-0324:free',
      'mistral': 'mistralai/mistral-7b-instruct',
      'llama3': 'meta-llama/llama-3-8b-instruct',
      
      // Google Gemini models - no longer need google/ prefix
      'gemini15pro': 'gemini-1.5-pro',
      'gemini15flash': 'gemini-1.5-flash',
      'gemini10pro': 'gemini-1.0-pro',
      'gemini20flashlite': 'gemini-2.0-flash-lite',
      'gemini20flash': 'gemini-2.0-flash',
      'gemini25flash': 'gemini-2.5-flash-preview-04-17'
    };
    
    // Check if a short name was used and map it to the full model name
    const fullModelId = supportedModels[modelId.toLowerCase()] || modelId;
    
    // Check if this is a Gemini model - no more google/ prefix check
    const isGeminiModel = currentProvider === 'gemini' || 
                          fullModelId.startsWith('gemini') || 
                          fullModelId.startsWith('google/gemini');
    
    // Normalize the model ID based on provider
    let normalizedModelId = fullModelId;
    if (isGeminiModel) {
      // For Gemini provider, remove google/ prefix if exists
      normalizedModelId = fullModelId.replace('google/', '');
    } else if (currentProvider === 'openrouter' && !fullModelId.includes('/')) {
      // For OpenRouter, ensure models have proper format with / if missing
      // This is for backward compatibility
      if (fullModelId.startsWith('gemini')) {
        normalizedModelId = 'google/' + fullModelId;
      }
    }
    
    if (isGeminiModel) {
      // For Gemini models, check if API key is set
      if (!process.env.GEMINI_API_KEY && !db.data.config.geminiApiKey) {
        return {
          success: false,
          message: 'Untuk menggunakan model Gemini, kamu harus mengatur Gemini API key terlebih dahulu. Gunakan perintah !setgeminikey [YOUR_API_KEY]'
        };
      }
      
      // Verify Gemini model is supported
      const supportedGeminiModels = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash-preview-04-17'];
      if (!supportedGeminiModels.includes(normalizedModelId) && 
          !supportedGeminiModels.includes(normalizedModelId.replace('google/', ''))) {
        return {
          success: false,
          message: `Model Gemini "${normalizedModelId}" tidak dikenal. Model yang didukung: ${supportedGeminiModels.join(', ')}`
        };
      }
    } else {
      // For non-Gemini models (OpenRouter), check if API key is set
      if (!process.env.OPENROUTER_API_KEY) {
        return {
          success: false,
          message: 'Untuk menggunakan model OpenRouter, kamu harus mengatur OpenRouter API key terlebih dahulu. Gunakan perintah !setapikey [YOUR_API_KEY]'
        };
      }
      
      // Try to get available models from OpenRouter to validate
      let modelExists = false;
      try {
        const models = await getAvailableModels();
        modelExists = models.some(model => model.id === normalizedModelId);
      } catch (error) {
        console.warn('Could not verify model with OpenRouter:', error.message);
        // Continue anyway, assuming the model ID is valid
        modelExists = true;
      }
      
      if (!modelExists) {
        return { 
          success: false, 
          message: `Model "${normalizedModelId}" tidak ditemukan. Gunakan !setmodel tanpa argumen untuk melihat daftar model.` 
        };
      }
    }
    
    // Indicate if the model supports tools
    const toolSupportedModels = [
      'anthropic/claude-3-opus',
      'anthropic/claude-3-sonnet',
      'anthropic/claude-3-haiku',
      'openai/gpt-4o',
      'openai/gpt-4-turbo',
      'openai/gpt-4',
      'openai/gpt-3.5-turbo',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.5-flash-preview-04-17'
    ];
    
    // Check if model supports tools
    let supportsTools = false;
    for (const supportedModel of toolSupportedModels) {
      if (normalizedModelId === supportedModel || 
          normalizedModelId.includes(supportedModel) ||
          normalizedModelId.replace('google/', '') === supportedModel) {
        supportsTools = true;
        break;
      }
    }
    
    // Update model in database
    db.data.config.model = normalizedModelId;
    await db.write();
    
    return { 
      success: true, 
      message: `Model AI berhasil diubah menjadi: ${normalizedModelId}. ${supportsTools ? 'Model ini mendukung fungsi tools.' : 'Model ini tidak mendukung fungsi tools.'}`
    };
  } catch (error) {
    console.error('Error setting model:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengubah model AI.' };
  }
}

// Set bot name
async function setBotName(db, name) {
  try {
    db.data.config.botName = name;
    await db.write();
    
    return { success: true, message: `Nama bot berhasil diubah menjadi: ${name}` };
  } catch (error) {
    console.error('Error setting bot name:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengubah nama bot.' };
  }
}

// Get help text
function getHelpText() {
  return `*Daftar Perintah*
  
!help - Menampilkan bantuan
!ping - Cek bot aktif
!status - Cek status bot
!setmood [mood] - Ubah mood bot
!setpersonality [personality] - Ubah kepribadian bot
!clear - Hapus konteks percakapan
!setmodel [model_id] - Ubah model AI
!setprovider [openrouter/gemini] - Ubah provider AI default
!setapikey [api_key] - Atur OpenRouter API key
!setgeminikey [api_key] - Atur Google Gemini API key
!setname [nama] - Ubah nama bot
!debug - Tampilkan informasi debug

_Gunakan perintah tanpa argumen untuk melihat opsi yang tersedia._
_Perintah hanya bisa dijalankan oleh pengguna yang diizinkan di chat pribadi._`;
}

// Get status text
function getStatusText(db) {
  const { config, state } = db.data;
  const { botName, model, personality, defaultProvider } = config;
  const { currentMood, messageCount, lastInteraction } = state;
  
  const lastInteractionDate = new Date(lastInteraction);
  const formattedDate = lastInteractionDate.toLocaleString('id-ID');
  
  // Determine which API provider is being used
  const modelProvider = model.startsWith('google/') ? 'Google Gemini' : 'OpenRouter';
  
  return `*Status Bot*
  
Nama: ${botName}
Model: ${model}
Provider: ${modelProvider}
Default Provider: ${defaultProvider || 'openrouter'}
Mood: ${currentMood}
Personality: ${personality}
Total Pesan: ${messageCount}
Interaksi Terakhir: ${formattedDate}`;
}

// Get model selection text
function getModelSelectionText(models) {
  // Define supported models with shortnames and tool support
  const supportedModels = [
    // OpenRouter models
    { id: 'openai/gpt-4o', shortname: 'gpt4o', supportsTools: true, provider: 'OpenRouter' },
    { id: 'openai/gpt-4', shortname: 'gpt4', supportsTools: true, provider: 'OpenRouter' },
    { id: 'openai/gpt-3.5-turbo', shortname: 'gpt3', supportsTools: true, provider: 'OpenRouter' },
    { id: 'anthropic/claude-3-opus', shortname: 'claude3opus', supportsTools: true, provider: 'OpenRouter' },
    { id: 'anthropic/claude-3-sonnet', shortname: 'claude3sonnet', supportsTools: true, provider: 'OpenRouter' },
    { id: 'anthropic/claude-3-haiku', shortname: 'claude3haiku', supportsTools: true, provider: 'OpenRouter' },
    { id: 'deepseek/deepseek-chat-v3-0324:free', shortname: 'deepseek', supportsTools: false, provider: 'OpenRouter' },
    { id: 'mistralai/mistral-7b-instruct', shortname: 'mistral', supportsTools: false, provider: 'OpenRouter' },
    { id: 'meta-llama/llama-3-8b-instruct', shortname: 'llama3', supportsTools: false, provider: 'OpenRouter' },
    // Google Gemini models
    { id: 'google/gemini-1.5-pro', shortname: 'gemini15pro', supportsTools: true, provider: 'Google' },
    { id: 'google/gemini-1.5-flash', shortname: 'gemini15flash', supportsTools: true, provider: 'Google' },
    { id: 'google/gemini-1.0-pro', shortname: 'gemini10pro', supportsTools: false, provider: 'Google' },
    { id: 'google/gemini-2.0-flash', shortname: 'gemini20flash', supportsTools: true, provider: 'Google' },
    { id: 'google/gemini-2.0-flash-lite', shortname: 'gemini20flashlite', supportsTools: true, provider: 'Google' },
    { id: 'google/gemini-2.5-flash-preview-04-17', shortname: 'gemini25flash', supportsTools: true, provider: 'Google' },
  ];
  
  // If we have models from OpenRouter API, format and display them
  let modelsList = '';
  
  if (models && models.length > 0) {
    // Format OpenRouter model information
    modelsList = '*OpenRouter Models*\n\n';
    modelsList += models.map(model => {
      // Find if this model is in our supported models list
      const supportInfo = supportedModels.find(m => 
        model.id.toLowerCase().includes(m.id.toLowerCase())
      );
      
      // Add tool support and shortname info if available
      let modelLine = `- ${model.id}`;
      if (supportInfo) {
        modelLine += ` (shortname: ${supportInfo.shortname})`;
        if (supportInfo.supportsTools) {
          modelLine += ` ✅ mendukung tools`;
        }
      }
      
      return modelLine;
    }).join('\n');
    
    modelsList += '\n\n';
  } else {
    modelsList = '*Model AI*\n\n';
  }
  
  // Always add Gemini models
  modelsList += '*Google Gemini Models*\n\n';
  supportedModels.filter(m => m.provider === 'Google').forEach(model => {
    modelsList += `- ${model.id} (shortname: ${model.shortname})`;
    if (model.supportsTools) {
      modelsList += ` ✅ mendukung tools`;
    }
    modelsList += '\n';
  });
  
  return `${modelsList}
Gunakan !setmodel [model_id] untuk mengubah model.
Anda juga dapat menggunakan shortname (contoh: !setmodel gemini15pro).

*Note:* 
- Untuk model OpenRouter, pastikan telah mengatur API key dengan !setapikey
- Untuk model Gemini, pastikan telah mengatur API key dengan !setgeminikey`;
}

// Get debug information
function getDebugInfo(db, chatId, sender) {
  try {
    const isGroup = chatId.endsWith('@g.us');
    const botId = process.env.BOT_ID || db.data.config.botId || 'Not set';
    
    // Collect basic info
    const basicInfo = [
      `Bot ID: ${botId}`,
      `Chat ID: ${chatId}`,
      `Chat Type: ${isGroup ? 'Group' : 'Private'}`,
      `Sender ID: ${sender}`
    ];
    
    // Collect chat info
    const chatInfo = [];
    if (db.data.conversations[chatId]) {
      const chat = db.data.conversations[chatId];
      chatInfo.push(`Chat Name: ${chat.chatName}`);
      chatInfo.push(`Message Count: ${chat.messages.length}`);
      chatInfo.push(`Participant Count: ${Object.keys(chat.participants).length}`);
      chatInfo.push(`Has Introduced: ${chat.hasIntroduced}`);
      
      if (chat.lastIntroduction) {
        const lastIntro = new Date(chat.lastIntroduction);
        chatInfo.push(`Last Introduction: ${lastIntro.toLocaleString()}`);
      }
    } else {
      chatInfo.push('No conversation data found for this chat');
    }
    
    // Check if tagged recognition would work
    const tagInfo = [];
    tagInfo.push(`Bot Name: ${db.data.config.botName}`);
    
    // Return formatted debug info
    return `*Debug Information*\n\n*Basic Info:*\n${basicInfo.join('\n')}\n\n*Chat Info:*\n${chatInfo.join('\n')}\n\n*Tag Info:*\n${tagInfo.join('\n')}`;
  } catch (error) {
    console.error('Error getting debug info:', error);
    return 'Error getting debug info: ' + error.message;
  }
}

// Set provider preference
async function setProvider(db, provider) {
  try {
    const normalizedProvider = provider.toLowerCase();
    
    // Validate provider
    if (normalizedProvider !== 'openrouter' && normalizedProvider !== 'gemini') {
      return { success: false, message: 'Provider tidak valid. Gunakan "openrouter" atau "gemini".' };
    }
    
    // Check if API key is configured for the selected provider
    if (normalizedProvider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
      return { 
        success: false, 
        message: 'OpenRouter API key belum dikonfigurasi. Gunakan perintah !setapikey untuk mengatur kunci API.' 
      };
    }
    
    if (normalizedProvider === 'gemini' && !process.env.GEMINI_API_KEY && !db.data.config.geminiApiKey) {
      return { 
        success: false, 
        message: 'Gemini API key belum dikonfigurasi. Gunakan perintah !setgeminikey untuk mengatur kunci API Gemini.' 
      };
    }
    
    // Set default provider
    db.data.config.defaultProvider = normalizedProvider;
    await db.write();
    
    // Get the Gemini model from .env file, with fallback to gemini-1.5-pro
    const geminiModelFromEnv = process.env.GEMINI_MODEL || 'gemini-1.5-pro';
    
    // Set a default model for the provider if none is set
    if (normalizedProvider === 'gemini' && (!db.data.config.model || db.data.config.model.startsWith('google/'))) {
      db.data.config.model = geminiModelFromEnv;
      await db.write();
      return { 
        success: true, 
        message: `Provider berhasil diubah ke ${normalizedProvider}. Model default diubah ke ${geminiModelFromEnv}.` 
      };
    } else if (normalizedProvider === 'openrouter' && (!db.data.config.model || !db.data.config.model.includes('/'))) {
      // Default OpenRouter model from .env or fallback to claude-3-opus
      const defaultOpenRouterModel = process.env.DEFAULT_MODEL || 'anthropic/claude-3-opus';
      db.data.config.model = defaultOpenRouterModel;
      await db.write();
      return { 
        success: true, 
        message: `Provider berhasil diubah ke ${normalizedProvider}. Model default diubah ke ${defaultOpenRouterModel}.` 
      };
    }
    
    return { success: true, message: `Provider berhasil diubah ke ${normalizedProvider}.` };
  } catch (error) {
    console.error('Error setting provider:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengubah provider.' };
  }
}

export {
  detectCommand,
  executeCommand
}; 