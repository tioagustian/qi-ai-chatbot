import { setMood, setPersonality, getAvailableMoods, getAvailablePersonalities, addCustomMood, addCustomPersonality, addMoodTriggers, removeCustomMood, removeCustomPersonality, getMoodDescription, getPersonalityDescription, getAllMoodTriggers, setCharacterKnowledge, getCharacterKnowledge, MOODS, PERSONALITIES } from './personalityService.js';
import { clearContext } from './contextService.js';
import { getAvailableModels, TOGETHER_MODELS } from './aiService.js';
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
          const availableMoods = getAvailableMoods(db);
          return `Mood yang tersedia: ${availableMoods.join(', ')}\nGunakan: !setmood [nama_mood]`;
        }
        const moodResult = await setMood(db, args[0]);
        return moodResult.message;
        
      case 'setpersonality':
        if (args.length === 0) {
          const availablePersonalities = getAvailablePersonalities(db);
          return `Personality yang tersedia: ${availablePersonalities.join(', ')}\nGunakan: !setpersonality [nama_personality]`;
        }
        const personalityResult = await setPersonality(db, args[0]);
        return personalityResult.message;
        
      case 'addmood':
        if (args.length < 2) {
          return 'Gunakan format: !addmood [nama_mood] [deskripsi]\nContoh: !addmood playful Suka bermain dan penuh dengan candaan';
        }
        const moodName = args[0];
        const moodDescription = args.slice(1).join(' ');
        const addMoodResult = await addCustomMood(db, moodName, moodDescription);
        return addMoodResult.message;
        
      case 'addpersonality':
        if (args.length < 2) {
          return 'Gunakan format: !addpersonality [nama_personality] [deskripsi]\nContoh: !addpersonality quirky Memiliki pemikiran dan selera humor yang unik';
        }
        const personalityName = args[0];
        const personalityDescription = args.slice(1).join(' ');
        const addPersonalityResult = await addCustomPersonality(db, personalityName, personalityDescription);
        return addPersonalityResult.message;
        
      case 'addtriggers':
        if (args.length < 2) {
          return 'Gunakan format: !addtriggers [nama_mood] [trigger1] [trigger2] ...\nContoh: !addtriggers happy seneng gembira sukses berhasil';
        }
        const triggerMood = args[0];
        const triggers = args.slice(1);
        const addTriggersResult = await addMoodTriggers(db, triggerMood, triggers);
        return addTriggersResult.message;
        
      case 'removemood':
        if (args.length === 0) {
          return 'Gunakan format: !removemood [nama_mood]\nContoh: !removemood playful';
        }
        const removeMoodResult = await removeCustomMood(db, args[0]);
        return removeMoodResult.message;
        
      case 'removepersonality':
        if (args.length === 0) {
          return 'Gunakan format: !removepersonality [nama_personality]\nContoh: !removepersonality quirky';
        }
        const removePersonalityResult = await removeCustomPersonality(db, args[0]);
        return removePersonalityResult.message;
        
      case 'listmoods':
        return await getMoodsListMessage(db);
        
      case 'listpersonalities':
        return await getPersonalitiesListMessage(db);
        
      case 'moodinfo':
        if (args.length === 0) {
          return 'Gunakan format: !moodinfo [nama_mood]\nContoh: !moodinfo happy';
        }
        return await getMoodInfoMessage(db, args[0]);
        
      case 'personalityinfo':
        if (args.length === 0) {
          return 'Gunakan format: !personalityinfo [nama_personality]\nContoh: !personalityinfo friendly';
        }
        return await getPersonalityInfoMessage(db, args[0]);
        
      case 'listtriggers':
        if (args.length === 0) {
          return await getAllTriggersMessage(db);
        } else {
          return await getMoodTriggersMessage(db, args[0]);
        }
        
      case 'setmodel':
        if (args.length === 0) {
          const models = await getAvailableModels();
          return getModelSelectionText(models);
        }
        const modelResult = await setModel(db, args[0]);
        return modelResult.message;
        
      case 'setprovider':
        if (args.length === 0) {
          return 'Gunakan format: !setprovider [openrouter/gemini/together]\nProvider saat ini: ' + (db.data.config.defaultProvider || 'openrouter');
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
        
      case 'settogetherkey':
        if (args.length === 0) {
          return 'Gunakan format: !settogetherkey [YOUR_TOGETHER_API_KEY]';
        }
        const togetherKeyResult = await setTogetherApiKey(args[0]);
        return togetherKeyResult.message;
        
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
        
      case 'setcharacter':
        if (args.length === 0) {
          const currentKnowledge = getCharacterKnowledge(db);
          return `Pengetahuan karakter saat ini: ${currentKnowledge || 'Belum ada'}\nGunakan: !setcharacter [deskripsi_karakter]`;
        }
        const knowledgeResult = await setCharacterKnowledge(db, args.join(' '));
        return knowledgeResult.message;
        
      case 'removecharacter':
        const removeResult = await setCharacterKnowledge(db, '');
        return removeResult.message;
        
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

// Set Together.AI API key
async function setTogetherApiKey(apiKey) {
  try {
    // Validate the API key format (basic validation)
    if (!apiKey || apiKey.length < 10) {
      return {
        success: false,
        message: 'API key tidak valid. Harap berikan kunci yang valid.'
      };
    }
    
    // Set the API key in environment variables
    process.env.TOGETHER_API_KEY = apiKey;
    
    // Update the config in database
    const db = (await import('../database/index.js')).getDb();
    db.data.config.togetherApiKey = apiKey;
    await db.write();
    
    console.log('Together.AI API key set successfully');
    
    return {
      success: true,
      message: 'Together.AI API key berhasil dikonfigurasi. Sekarang kamu bisa menggunakan model Together.AI.'
    };
  } catch (error) {
    console.error('Error setting Together.AI API key:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat mengatur Together.AI API key: ' + error.message
    };
  }
}

// Set AI model
async function setModel(db, modelId) {
  try {
    // Check for empty model ID
    if (!modelId) {
      return { success: false, message: 'Model ID tidak boleh kosong' };
    }
    
    // Normalize model ID
    const normalizedModelId = modelId.trim();
    
    // Get current provider
    const currentProvider = db.data.config.defaultProvider || 'openrouter';
    
    // Check if this is a Together.AI model
    if (currentProvider === 'together') {
      // For Together.AI, check if the model is in the allowed list
      const isValidTogetherModel = TOGETHER_MODELS.includes(normalizedModelId);
      
      if (!isValidTogetherModel) {
        return {
          success: false,
          message: `Model "${normalizedModelId}" tidak tersedia di Together.AI. Model yang tersedia: ${TOGETHER_MODELS.join(', ')}`
        };
      }
    }
    
    // Check if this is a Gemini model
    if (currentProvider === 'gemini') {
      // For Gemini, ensure model ID has the correct prefix
      const isGeminiModel = normalizedModelId.startsWith('google/') || 
                            normalizedModelId.startsWith('gemini');
      
      if (!isGeminiModel) {
        return {
          success: false,
          message: `Model "${normalizedModelId}" tidak valid untuk provider Gemini. Model harus dimulai dengan "google/" atau "gemini".`
        };
      }
    }
    
    // Set the model
    db.data.config.model = normalizedModelId;
    await db.write();
    
    return {
      success: true,
      message: `Model berhasil diubah ke: ${normalizedModelId}`
    };
  } catch (error) {
    console.error('Error setting model:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat mengubah model: ' + error.message
    };
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
  return `🤖 Daftar Perintah:

*Perintah Dasar:*
!help - Menampilkan bantuan
!ping - Mengecek apakah bot aktif
!status - Menampilkan status bot
!debug - Informasi debug

*Pengaturan AI:*
!setapikey [key] - Mengatur API key OpenRouter
!setgeminikey [key] - Mengatur API key Gemini
!settogetherkey [key] - Mengatur API key Together.AI
!setmodel [model] - Mengatur model AI
!setprovider [provider] - Mengatur provider (openrouter/gemini/together)

*Pengaturan Bot:*
!setname [nama] - Mengatur nama bot
!clear - Menghapus konteks percakapan
!setcharacter [deskripsi] - Mengatur pengetahuan karakter
!removecharacter - Menghapus pengetahuan karakter

*Pengaturan Mood:*
!setmood [mood] - Mengatur mood bot
!listmoods - Menampilkan daftar mood
!moodinfo [mood] - Info detail tentang mood
!addmood [nama] [deskripsi] - Menambah mood kustom
!removemood [nama] - Menghapus mood kustom

*Pengaturan Personality:*
!setpersonality [personality] - Mengatur personality bot
!listpersonalities - Menampilkan daftar personality
!personalityinfo [personality] - Info detail tentang personality
!addpersonality [nama] [deskripsi] - Menambah personality kustom
!removepersonality [nama] - Menghapus personality kustom

*Pengaturan Trigger:*
!listtriggers [mood?] - Menampilkan trigger words
!addtriggers [mood] [trigger1] [trigger2] ... - Menambah trigger untuk mood

Semua perintah hanya dapat dijalankan oleh admin di chat pribadi.`;
}

// Get status text
function getStatusText(db) {
  const status = {
    botName: db.data.config.botName,
    version: '1.0.0',
    currentTime: new Date().toISOString(),
    mood: db.data.state.currentMood,
    personality: db.data.config.personality,
    messageCount: db.data.state.messageCount || 0,
    provider: db.data.config.defaultProvider || 'openrouter',
    model: db.data.config.model || 'N/A',
    openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    togetherConfigured: !!process.env.TOGETHER_API_KEY,
    enhancedMemory: db.data.config.enhancedMemoryEnabled || false,
    maxContextMessages: db.data.config.maxContextMessages || 100,
    maxRelevantMessages: db.data.config.maxRelevantMessages || 20,
    maxCrossChatMessages: db.data.config.maxCrossChatMessages || 8,
    maxImageAnalysisMessages: db.data.config.maxImageAnalysisMessages || 3,
    maxTopicSpecificMessages: db.data.config.maxTopicSpecificMessages || 10
  };
  
  // Format status as text
  return `📊 Status Bot:
• Nama: ${status.botName}
• Versi: ${status.version}
• Waktu Server: ${new Date().toLocaleString('id-ID')}
• Mood: ${status.mood}
• Personality: ${status.personality}
• Jumlah Pesan: ${status.messageCount}
• Provider: ${status.provider}
• Model: ${status.model}
• OpenRouter API: ${status.openrouterConfigured ? '✅ Terkonfigurasi' : '❌ Belum dikonfigurasi'} 
• Gemini API: ${status.geminiConfigured ? '✅ Terkonfigurasi' : '❌ Belum dikonfigurasi'}
• Together.AI API: ${status.togetherConfigured ? '✅ Terkonfigurasi' : '❌ Belum dikonfigurasi'}
• Enhanced Memory: ${status.enhancedMemory ? '✅ Aktif' : '❌ Nonaktif'}
• Max Context Messages: ${status.maxContextMessages}
• Max Relevant Messages: ${status.maxRelevantMessages}
• Max Cross-Chat Messages: ${status.maxCrossChatMessages}
• Max Image Analysis Messages: ${status.maxImageAnalysisMessages}
• Max Topic-Specific Messages: ${status.maxTopicSpecificMessages}`;
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
      `Sender ID: ${sender}`,
      `Provider: ${db.data.config.defaultProvider || 'openrouter'}`,
      `Model: ${db.data.config.model || 'N/A'}`,
      `Enhanced Memory: ${db.data.config.enhancedMemoryEnabled ? 'Enabled' : 'Disabled'}`
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
      
      // Add image analysis info if available
      if (db.data.imageAnalysis[chatId]) {
        const imageCount = Object.keys(db.data.imageAnalysis[chatId]).length;
        chatInfo.push(`Image Analysis Count: ${imageCount}`);
      }
      
      // Add topic memory info if available
      if (db.data.topicMemory[chatId]) {
        const topicCount = Object.keys(db.data.topicMemory[chatId]).length;
        chatInfo.push(`Topic Memory Count: ${topicCount}`);
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
    if (!['openrouter', 'gemini', 'together'].includes(normalizedProvider)) {
      return {
        success: false,
        message: 'Provider tidak valid. Gunakan "openrouter", "gemini", atau "together".'
      };
    }
    
    // Check if API key is set for the selected provider
    if (normalizedProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
      return {
        success: false,
        message: 'Gemini API key belum dikonfigurasi. Gunakan !setgeminikey terlebih dahulu.'
      };
    } else if (normalizedProvider === 'together' && !process.env.TOGETHER_API_KEY) {
      return {
        success: false,
        message: 'Together.AI API key belum dikonfigurasi. Gunakan !settogetherkey terlebih dahulu.'
      };
    } else if (normalizedProvider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
      return {
        success: false,
        message: 'OpenRouter API key belum dikonfigurasi. Gunakan !setapikey terlebih dahulu.'
      };
    }
    
    // Set the provider in database
    db.data.config.defaultProvider = normalizedProvider;
    
    // Set default model for the provider if not set
    if (!db.data.config.model || db.data.config.model.startsWith('gemini') || db.data.config.model.startsWith('google/')) {
      if (normalizedProvider === 'gemini') {
        // Default Gemini model
        db.data.config.model = 'google/gemini-1.5-pro';
      } else if (normalizedProvider === 'together') {
        // Default Together model
        db.data.config.model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free';
      } else {
        // Default OpenRouter model
        db.data.config.model = 'anthropic/claude-3-haiku';
      }
    }
    
    await db.write();
    
    return {
      success: true,
      message: `Provider berhasil diubah ke ${normalizedProvider}. Model: ${db.data.config.model}`
    };
  } catch (error) {
    console.error('Error setting provider:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat mengatur provider: ' + error.message
    };
  }
}

// Function to get detailed info about moods
async function getMoodsListMessage(db) {
  try {
    const moods = getAvailableMoods(db);
    const defaultMoods = moods.filter(mood => MOODS.includes(mood));
    const customMoods = moods.filter(mood => !MOODS.includes(mood));
    
    let message = '*Daftar Mood Tersedia*\n\n';
    
    if (defaultMoods.length > 0) {
      message += '*Mood Default:*\n';
      message += defaultMoods.join(', ');
      message += '\n\n';
    }
    
    if (customMoods.length > 0) {
      message += '*Mood Kustom:*\n';
      message += customMoods.join(', ');
    } else {
      message += 'Belum ada mood kustom.\nGunakan !addmood untuk menambahkan mood baru.';
    }
    
    message += '\n\nGunakan !moodinfo [nama_mood] untuk melihat detail mood tertentu.';
    
    return message;
  } catch (error) {
    console.error('Error getting moods list:', error);
    return 'Terjadi kesalahan saat mengambil daftar mood';
  }
}

// Function to get detailed info about personalities
async function getPersonalitiesListMessage(db) {
  try {
    const personalities = getAvailablePersonalities(db);
    const defaultPersonalities = personalities.filter(p => PERSONALITIES.includes(p));
    const customPersonalities = personalities.filter(p => !PERSONALITIES.includes(p));
    
    let message = '*Daftar Personality Tersedia*\n\n';
    
    if (defaultPersonalities.length > 0) {
      message += '*Personality Default:*\n';
      message += defaultPersonalities.join(', ');
      message += '\n\n';
    }
    
    if (customPersonalities.length > 0) {
      message += '*Personality Kustom:*\n';
      message += customPersonalities.join(', ');
    } else {
      message += 'Belum ada personality kustom.\nGunakan !addpersonality untuk menambahkan personality baru.';
    }
    
    message += '\n\nGunakan !personalityinfo [nama_personality] untuk melihat detail personality tertentu.';
    
    return message;
  } catch (error) {
    console.error('Error getting personalities list:', error);
    return 'Terjadi kesalahan saat mengambil daftar personality';
  }
}

// Function to get detailed info about a specific mood
async function getMoodInfoMessage(db, moodName) {
  try {
    const moods = getAvailableMoods(db);
    moodName = moodName.toLowerCase();
    
    if (!moods.includes(moodName)) {
      return `Mood "${moodName}" tidak ditemukan. Gunakan !listmoods untuk melihat mood yang tersedia.`;
    }
    
    const description = getMoodDescription(moodName, db);
    const currentMood = db.data.state.currentMood;
    const isDefault = MOODS.includes(moodName);
    
    // Get triggers for this mood
    const allTriggers = getAllMoodTriggers(db);
    const triggers = allTriggers[moodName] || [];
    
    let message = `*Detail Mood: ${moodName}*\n\n`;
    message += `Deskripsi: ${description}\n`;
    message += `Status: ${isDefault ? 'Default' : 'Kustom'}\n`;
    message += `Active: ${currentMood === moodName ? 'Ya' : 'Tidak'}\n\n`;
    
    if (triggers.length > 0) {
      message += `*Trigger Words (${triggers.length}):*\n`;
      message += triggers.slice(0, 10).join(', ');
      
      if (triggers.length > 10) {
        message += `, ... dan ${triggers.length - 10} lainnya`;
      }
    } else {
      message += '*Trigger Words:* Tidak ada\n';
      message += 'Gunakan !addtriggers untuk menambahkan trigger words.';
    }
    
    return message;
  } catch (error) {
    console.error('Error getting mood info:', error);
    return 'Terjadi kesalahan saat mengambil informasi mood';
  }
}

// Function to get detailed info about a specific personality
async function getPersonalityInfoMessage(db, personalityName) {
  try {
    const personalities = getAvailablePersonalities(db);
    personalityName = personalityName.toLowerCase();
    
    if (!personalities.includes(personalityName)) {
      return `Personality "${personalityName}" tidak ditemukan. Gunakan !listpersonalities untuk melihat personality yang tersedia.`;
    }
    
    const description = getPersonalityDescription(personalityName, db);
    const currentPersonality = db.data.config.personality;
    const isDefault = PERSONALITIES.includes(personalityName);
    
    let message = `*Detail Personality: ${personalityName}*\n\n`;
    message += `Deskripsi: ${description}\n`;
    message += `Status: ${isDefault ? 'Default' : 'Kustom'}\n`;
    message += `Active: ${currentPersonality === personalityName ? 'Ya' : 'Tidak'}\n`;
    
    return message;
  } catch (error) {
    console.error('Error getting personality info:', error);
    return 'Terjadi kesalahan saat mengambil informasi personality';
  }
}

// Function to get all mood triggers
async function getAllTriggersMessage(db) {
  try {
    const allTriggers = getAllMoodTriggers(db);
    const availableMoods = getAvailableMoods(db);
    
    let message = '*Daftar Trigger Words Semua Mood*\n\n';
    
    let hasTriggers = false;
    
    for (const mood of availableMoods) {
      const triggers = allTriggers[mood] || [];
      
      if (triggers.length > 0) {
        hasTriggers = true;
        message += `*${mood}* (${triggers.length}): `;
        message += triggers.slice(0, 5).join(', ');
        
        if (triggers.length > 5) {
          message += `, ... dan ${triggers.length - 5} lainnya`;
        }
        
        message += '\n\n';
      }
    }
    
    if (!hasTriggers) {
      message += 'Belum ada mood dengan trigger words. Gunakan !addtriggers untuk menambahkan trigger words.';
    }
    
    message += 'Gunakan !listtriggers [nama_mood] untuk melihat semua trigger dari mood tertentu.';
    
    return message;
  } catch (error) {
    console.error('Error getting all triggers:', error);
    return 'Terjadi kesalahan saat mengambil daftar trigger words';
  }
}

// Function to get triggers for a specific mood
async function getMoodTriggersMessage(db, moodName) {
  try {
    const availableMoods = getAvailableMoods(db);
    moodName = moodName.toLowerCase();
    
    if (!availableMoods.includes(moodName)) {
      return `Mood "${moodName}" tidak ditemukan. Gunakan !listmoods untuk melihat mood yang tersedia.`;
    }
    
    const allTriggers = getAllMoodTriggers(db);
    const triggers = allTriggers[moodName] || [];
    
    let message = `*Trigger Words untuk Mood: ${moodName}*\n\n`;
    
    if (triggers.length > 0) {
      message += triggers.join(', ');
    } else {
      message += 'Mood ini belum memiliki trigger words.\n';
      message += `Gunakan !addtriggers ${moodName} [trigger1] [trigger2] ... untuk menambahkan trigger words.`;
    }
    
    return message;
  } catch (error) {
    console.error('Error getting mood triggers:', error);
    return 'Terjadi kesalahan saat mengambil trigger words';
  }
}

export {
  detectCommand,
  executeCommand,
  setApiKey,
  setGeminiApiKey,
  setTogetherApiKey,
  setModel,
  setBotName,
  setProvider
}; 