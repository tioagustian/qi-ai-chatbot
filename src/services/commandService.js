import { setMood, setPersonality, getAvailableMoods, getAvailablePersonalities, addCustomMood, addCustomPersonality, addMoodTriggers, removeCustomMood, removeCustomPersonality, getMoodDescription, getPersonalityDescription, getAllMoodTriggers, setCharacterKnowledge, getCharacterKnowledge, MOODS, PERSONALITIES } from './personalityService.js';
import { clearContext } from './contextService.js';
import { getAvailableModels, TOGETHER_MODELS } from './aiService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getApiLogs, clearApiLogs } from './apiLogService.js';
import { getDb } from '../database/index.js';
import chalk from 'chalk';
import { getBatchStatus, forceProcessBatch, getGroupPresenceStats, processGroupMessageBatch, GROUP_BATCH_CONFIG } from './messageBatchingService.js';
import { searchFacts, getFactStatistics, getFactSuggestions } from './factSearchService.js';
import { advancedFactSearch, searchByTaxonomy, getFactInsights } from './advancedFactSearchService.js';
import { listAllTools, getRegistryStatus, enableTool, disableTool, enableAllTools, disableAllTools, enableToolsByCategory, disableToolsByCategory, getToolCategories, getToolsRegistry } from '../tools/toolsRegistry.js';

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
        
      case 'mood':
        const currentMoodStatus = db.data.state.currentMood;
        const moodDescStatus = getMoodDescription(currentMoodStatus, db);
        return `Current mood: ${currentMoodStatus}\nDescription: ${moodDescStatus}`;
        
      case 'personality':
        const currentPersonalityStatus = db.data.config.personality;
        const personalityDescStatus = getPersonalityDescription(currentPersonalityStatus, db);
        return `Current personality: ${currentPersonalityStatus}\nDescription: ${personalityDescStatus}`;
        
      case 'status':
        const moodStatus = db.data.state.currentMood;
        const personalityStatus = db.data.config.personality;
        const moodDesc2Status = getMoodDescription(moodStatus, db);
        const personalityDesc2Status = getPersonalityDescription(personalityStatus, db);
        return `🤖 Qi Status:\n\nMood: ${moodStatus}\n${moodDesc2Status}\n\nPersonality: ${personalityStatus}\n${personalityDesc2Status}`;
        
      case 'listmoods':
        const availableMoodsList = getAvailableMoods(db);
        return `📋 Available Moods:\n\n${availableMoodsList.map(m => `• ${m}`).join('\n')}\n\nUse !moodinfo [mood] for detailed information`;
        
      case 'listpersonalities':
        const availablePersonalitiesList = getAvailablePersonalities(db);
        return `📋 Available Personalities:\n\n${availablePersonalitiesList.map(p => `• ${p}`).join('\n')}\n\nUse !personalityinfo [personality] for detailed information`;
        
      case 'moodinfo':
        if (args.length === 0) {
          return 'Usage: !moodinfo [mood_name]\nExample: !moodinfo happy';
        }
        const moodNameInfo = args[0].toLowerCase();
        const moodInfoDesc = getMoodDescription(moodNameInfo, db);
        const moodTriggersInfo = getAllMoodTriggers(db)[moodNameInfo] || [];
        return `📖 Mood Info: ${moodNameInfo}\n\nDescription: ${moodInfoDesc}\n\nTrigger words: ${moodTriggersInfo.join(', ')}`;
        
      case 'personalityinfo':
        if (args.length === 0) {
          return 'Usage: !personalityinfo [personality_name]\nExample: !personalityinfo friendly';
        }
        const personalityNameInfo = args[0].toLowerCase();
        const personalityInfoDesc = getPersonalityDescription(personalityNameInfo, db);
        return `📖 Personality Info: ${personalityNameInfo}\n\nDescription: ${personalityInfoDesc}`;
        
      case 'newmoods':
        return `🆕 New Moods & Personalities!\n\n*New Moods:*\n• silly - Very funny and playful, likes dad jokes and absurd humor\n• focused - Very serious and focused, structured responses\n• inspired - Full of inspiration and creativity, innovative solutions\n• grateful - Very thankful and appreciative, warm communication\n• determined - Very determined and persistent, motivational language\n\n*New Personalities:*\n• witty - Smart and humorous, clever jokes and sophisticated humor\n• adventurous - Brave and challenging, suggests exciting activities\n• creative - Very creative and imaginative, unique perspectives\n• analytical - Logical and systematic thinking, detailed analysis\n• empathetic - Very understanding of others' feelings, emotional support\n\nUse !setmood or !setpersonality to try them!`;
        
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
        
      case 'searchfacts':
        if (args.length === 0) {
          return 'Gunakan format: !searchfacts [query]\nContoh: !searchfacts nama saya\n\nPerintah ini akan mencari fakta yang relevan dengan query Anda dari database.';
        }
        const searchQuery = args.join(' ');
        try {
          const searchResult = await searchFacts(sender, searchQuery, {
            includeGlobalFacts: true,
            includeUserFacts: true,
            includeOtherUsers: false,
            maxResults: 10,
            minRelevance: 0.2,
            useSemanticSearch: true
          });
          
          if (searchResult.topResults && searchResult.topResults.length > 0) {
            const factList = searchResult.topResults.map((fact, index) => {
              const sourceLabel = fact.source === 'global' ? '🌍' : fact.source === 'user' ? '👤' : '👥';
              return `${index + 1}. ${sourceLabel} ${fact.key}: ${fact.value}\n   Relevansi: ${(fact.relevanceScore * 100).toFixed(1)}%`;
            }).join('\n\n');
            
            return `🔍 Hasil Pencarian Fakta untuk "${searchQuery}":\n\n${factList}\n\nTotal: ${searchResult.topResults.length} fakta ditemukan\nKualitas pencarian: ${(searchResult.searchQuality * 100).toFixed(1)}%`;
          } else {
            return `❌ Tidak ada fakta yang ditemukan untuk query "${searchQuery}"\n\nCoba gunakan kata kunci yang berbeda atau lebih spesifik.`;
          }
        } catch (error) {
          console.error('Error in fact search command:', error);
          return '❌ Terjadi kesalahan saat mencari fakta. Silakan coba lagi.';
        }
        
      case 'factstats':
        try {
          const stats = getFactStatistics(sender);
          const userFactsByCategory = Object.entries(stats.userFactsByCategory)
            .map(([category, count]) => `${category}: ${count}`)
            .join(', ');
          
          const globalFactsByCategory = Object.entries(stats.globalFactsByCategory)
            .map(([category, count]) => `${category}: ${count}`)
            .join(', ');
          
          return `📊 Statistik Fakta:\n\n👤 Fakta Pengguna: ${stats.totalUserFacts}\n🌍 Fakta Global: ${stats.totalGlobalFacts}\n🆕 Fakta Terbaru: ${stats.recentFacts}\n⭐ Fakta Berkualitas Tinggi: ${stats.highConfidenceFacts}\n\n📂 Kategori Fakta Pengguna:\n${userFactsByCategory || 'Tidak ada'}\n\n📂 Kategori Fakta Global:\n${globalFactsByCategory || 'Tidak ada'}`;
        } catch (error) {
          console.error('Error in fact stats command:', error);
          return '❌ Terjadi kesalahan saat mengambil statistik fakta.';
        }
        
                  case 'factsuggest':
              if (args.length === 0) {
                return 'Gunakan format: !factsuggest [partial_input]\nContoh: !factsuggest nam\n\nPerintah ini akan memberikan saran fakta berdasarkan input parsial Anda.';
              }
              const partialInput = args.join(' ');
              try {
                const suggestions = await getFactSuggestions(sender, partialInput);
                
                if (suggestions.length > 0) {
                  const suggestionList = suggestions.map((suggestion, index) => {
                    const typeLabel = suggestion.type === 'user_fact' ? '👤' : '🌍';
                    return `${index + 1}. ${typeLabel} ${suggestion.key}: ${suggestion.value}\n   Kategori: ${suggestion.category || 'Tidak ada'}\n   Kepercayaan: ${(suggestion.confidence * 100).toFixed(1)}%`;
                  }).join('\n\n');
                  
                  return `💡 Saran Fakta untuk "${partialInput}":\n\n${suggestionList}`;
                } else {
                  return `❌ Tidak ada saran fakta untuk "${partialInput}"\n\nCoba gunakan kata kunci yang berbeda.`;
                }
              } catch (error) {
                console.error('Error in fact suggestions command:', error);
                return '❌ Terjadi kesalahan saat mencari saran fakta.';
              }
              
            case 'advancedsearch':
              if (args.length === 0) {
                return 'Gunakan format: !advancedsearch [query]\nContoh: !advancedsearch game horror\n\nPerintah ini akan mencari fakta dengan analisis hubungan dan taksonomi.';
              }
              const advancedQuery = args.join(' ');
              try {
                const advancedResult = await advancedFactSearch(sender, advancedQuery, {
                  includeRelationships: true,
                  includeTaxonomies: true,
                  includeUsageAnalytics: true,
                  maxDepth: 2,
                  maxResults: 8
                });
                
                if (advancedResult.topResults && advancedResult.topResults.length > 0) {
                  let resultText = `🔍 Pencarian Lanjutan untuk "${advancedQuery}":\n\n`;
                  
                  // Main results
                  resultText += `📋 Hasil Utama (${advancedResult.topResults.length}):\n`;
                  advancedResult.topResults.forEach((fact, index) => {
                    const sourceLabel = fact.factType === 'global' ? '🌍' : '👤';
                    resultText += `${index + 1}. ${sourceLabel} ${fact.key}: ${fact.value.substring(0, 80)}...\n   Relevansi: ${(fact.relevanceScore * 100).toFixed(1)}% | Kategori: ${fact.category || 'N/A'}\n`;
                  });
                  
                  // Related facts
                  if (advancedResult.relatedFacts && advancedResult.relatedFacts.length > 0) {
                    resultText += `\n🔗 Fakta Terkait (${advancedResult.relatedFacts.length}):\n`;
                    advancedResult.relatedFacts.slice(0, 3).forEach((fact, index) => {
                      const sourceLabel = fact.factType === 'global' ? '🌍' : '👤';
                      resultText += `${index + 1}. ${sourceLabel} ${fact.key}: ${fact.value.substring(0, 60)}...\n   Hubungan: ${fact.relationshipType} (${(fact.relationshipStrength * 100).toFixed(1)}%)\n`;
                    });
                  }
                  
                  // Metrics
                  if (advancedResult.advancedMetrics) {
                    const metrics = advancedResult.advancedMetrics;
                    resultText += `\n📊 Metrik Lanjutan:\n`;
                    resultText += `• Rata-rata Kepercayaan: ${(metrics.averageConfidence * 100).toFixed(1)}%\n`;
                    resultText += `• Fakta Populer: ${metrics.popularFacts}\n`;
                    resultText += `• Fakta Terbaru: ${metrics.recentFacts}\n`;
                    resultText += `• Kepadatan Hubungan: ${(metrics.relationshipDensity * 100).toFixed(1)}%\n`;
                  }
                  
                  return resultText;
                } else {
                  return `❌ Tidak ada hasil pencarian lanjutan untuk "${advancedQuery}"`;
                }
              } catch (error) {
                console.error('Error in advanced search command:', error);
                return '❌ Terjadi kesalahan saat melakukan pencarian lanjutan.';
              }
              
            case 'factinsights':
              try {
                const insights = await getFactInsights(sender);
                
                let insightsText = `📊 Analisis Fakta Lanjutan:\n\n`;
                insightsText += `📈 Statistik Umum:\n`;
                insightsText += `• Total Fakta: ${insights.totalFacts}\n`;
                insightsText += `• Fakta Pengguna: ${insights.userFacts}\n`;
                insightsText += `• Fakta Global: ${insights.globalFacts}\n`;
                
                if (insights.relationshipStats) {
                  insightsText += `\n🔗 Statistik Hubungan:\n`;
                  insightsText += `• Total Hubungan: ${insights.relationshipStats.totalRelationships}\n`;
                  insightsText += `• Hubungan Pengguna: ${insights.relationshipStats.userRelationships}\n`;
                }
                
                if (insights.categories && Object.keys(insights.categories).length > 0) {
                  insightsText += `\n📂 Kategori Teratas:\n`;
                  const topCategories = Object.entries(insights.categories)
                    .sort(([,a], [,b]) => (a.user + a.global) - (b.user + b.global))
                    .slice(0, 5);
                  
                  topCategories.forEach(([category, counts]) => {
                    insightsText += `• ${category}: ${counts.user + counts.global} (${counts.user} user, ${counts.global} global)\n`;
                  });
                }
                
                if (insights.usageStats && insights.usageStats.user) {
                  const userStats = insights.usageStats.user;
                  insightsText += `\n📊 Statistik Penggunaan:\n`;
                  insightsText += `• Total Penggunaan: ${userStats.total}\n`;
                  insightsText += `• Rata-rata Penggunaan: ${userStats.count > 0 ? (userStats.total / userStats.count).toFixed(1) : 0}\n`;
                }
                
                return insightsText;
              } catch (error) {
                console.error('Error in fact insights command:', error);
                return '❌ Terjadi kesalahan saat mengambil analisis fakta.';
              }
              
            case 'taxonomysearch':
              if (args.length < 2) {
                return 'Gunakan format: !taxonomysearch [category] [query]\nContoh: !taxonomysearch web_search game\n\nPerintah ini akan mencari fakta berdasarkan kategori taksonomi.';
              }
              const category = args[0];
              const taxonomyQuery = args.slice(1).join(' ');
              try {
                const taxonomyResults = await searchByTaxonomy(sender, {
                  category: category,
                  minConfidence: 0.5
                });
                
                if (taxonomyResults.length > 0) {
                  let resultText = `🔍 Pencarian Taksonomi: ${category} untuk "${taxonomyQuery}"\n\n`;
                  
                  taxonomyResults.slice(0, 5).forEach((fact, index) => {
                    const sourceLabel = fact.factType === 'global' ? '🌍' : '👤';
                    resultText += `${index + 1}. ${sourceLabel} ${fact.key}: ${fact.value.substring(0, 80)}...\n   Kepercayaan: ${(fact.confidence * 100).toFixed(1)}% | Tipe: ${fact.factType || 'N/A'}\n`;
                  });
                  
                  return resultText;
                } else {
                  return `❌ Tidak ada fakta dalam kategori "${category}" untuk "${taxonomyQuery}"`;
                }
              } catch (error) {
                console.error('Error in taxonomy search command:', error);
                return '❌ Terjadi kesalahan saat mencari berdasarkan taksonomi.';
              }
              
            case 'tools':
            case 'listtools':
              try {
                const tools = await listAllTools();
                const status = await getRegistryStatus();
                
                if (tools.length === 0) {
                  return '❌ Tidak ada tool yang tersedia.';
                }
                
                let response = `🛠️ *Daftar Tools (${status.enabledTools}/${status.totalTools} aktif)*\n\n`;
                
                // Group tools by category
                const toolsByCategory = {};
                tools.forEach(tool => {
                  if (!toolsByCategory[tool.category]) {
                    toolsByCategory[tool.category] = [];
                  }
                  toolsByCategory[tool.category].push(tool);
                });
                
                // Display tools by category
                for (const [category, categoryTools] of Object.entries(toolsByCategory)) {
                  response += `*${category.toUpperCase()}*\n`;
                  categoryTools.forEach(tool => {
                    const status = tool.enabled ? '✅' : '❌';
                    response += `${status} ${tool.name}\n`;
                    if (tool.description && tool.description !== 'No description available') {
                      response += `   ${tool.description.substring(0, 60)}${tool.description.length > 60 ? '...' : ''}\n`;
                    }
                  });
                  response += '\n';
                }
                
                response += `*Commands:*\n`;
                response += `!enabletool [nama] - Aktifkan tool\n`;
                response += `!disabletool [nama] - Nonaktifkan tool\n`;
                response += `!enablecategory [kategori] - Aktifkan semua tool dalam kategori\n`;
                response += `!disablecategory [kategori] - Nonaktifkan semua tool dalam kategori\n`;
                response += `!toolstatus - Status detail tools\n`;
                
                return response;
              } catch (error) {
                console.error('Error listing tools:', error);
                return '❌ Terjadi kesalahan saat menampilkan daftar tools.';
              }
              
            case 'enabletool':
              if (args.length === 0) {
                return 'Gunakan format: !enabletool [nama_tool]\nContoh: !enabletool searchWebTool\n\nGunakan !tools untuk melihat daftar tools yang tersedia.';
              }
              try {
                const toolName = args[0];
                const result = await enableTool(toolName);
                return result.message;
              } catch (error) {
                console.error('Error enabling tool:', error);
                return '❌ Terjadi kesalahan saat mengaktifkan tool.';
              }
              
            case 'disabletool':
              if (args.length === 0) {
                return 'Gunakan format: !disabletool [nama_tool]\nContoh: !disabletool searchWebTool\n\nGunakan !tools untuk melihat daftar tools yang tersedia.';
              }
              try {
                const toolName = args[0];
                const result = await disableTool(toolName);
                return result.message;
              } catch (error) {
                console.error('Error disabling tool:', error);
                return '❌ Terjadi kesalahan saat menonaktifkan tool.';
              }
              
            case 'enablecategory':
              if (args.length === 0) {
                try {
                  const categories = await getToolCategories();
                  return `Gunakan format: !enablecategory [kategori]\nContoh: !enablecategory search\n\nKategori yang tersedia: ${categories.join(', ')}`;
                } catch (error) {
                  return 'Gunakan format: !enablecategory [kategori]\nContoh: !enablecategory search';
                }
              }
              try {
                const category = args[0];
                const result = await enableToolsByCategory(category);
                return result.message;
              } catch (error) {
                console.error('Error enabling category:', error);
                return '❌ Terjadi kesalahan saat mengaktifkan kategori tools.';
              }
              
            case 'disablecategory':
              if (args.length === 0) {
                try {
                  const categories = await getToolCategories();
                  return `Gunakan format: !disablecategory [kategori]\nContoh: !disablecategory search\n\nKategori yang tersedia: ${categories.join(', ')}`;
                } catch (error) {
                  return 'Gunakan format: !disablecategory [kategori]\nContoh: !disablecategory search';
                }
              }
              try {
                const category = args[0];
                const result = await disableToolsByCategory(category);
                return result.message;
              } catch (error) {
                console.error('Error disabling category:', error);
                return '❌ Terjadi kesalahan saat menonaktifkan kategori tools.';
              }
              
            case 'enablealltools':
              try {
                const result = await enableAllTools();
                return result.message;
              } catch (error) {
                console.error('Error enabling all tools:', error);
                return '❌ Terjadi kesalahan saat mengaktifkan semua tools.';
              }
              
            case 'disablealltools':
              try {
                const result = await disableAllTools();
                return result.message;
              } catch (error) {
                console.error('Error disabling all tools:', error);
                return '❌ Terjadi kesalahan saat menonaktifkan semua tools.';
              }
              
            case 'toolstatus':
              try {
                const status = await getRegistryStatus();
                const categories = await getToolCategories();
                const toolsRegistry = await getToolsRegistry();
                
                let response = `📊 *Tool Status*\n\n`;
                response += `Total Tools: ${status.totalTools}\n`;
                response += `Aktif: ${status.enabledTools}\n`;
                response += `Nonaktif: ${status.disabledTools}\n\n`;
                
                response += `*Kategori:*\n`;
                categories.forEach(category => {
                  const categoryTools = Object.values(toolsRegistry).filter(tool => tool.category === category);
                  const enabledInCategory = categoryTools.filter(tool => tool.enabled);
                  response += `• ${category}: ${enabledInCategory.length}/${categoryTools.length}\n`;
                });
                
                if (status.disabledTools > 0) {
                  response += `\n*Tools Nonaktif:*\n`;
                  status.disabledToolNames.slice(0, 5).forEach(tool => {
                    response += `• ${tool}\n`;
                  });
                  if (status.disabledToolNames.length > 5) {
                    response += `• ... dan ${status.disabledToolNames.length - 5} lainnya\n`;
                  }
                }
                
                return response;
              } catch (error) {
                console.error('Error getting tool status:', error);
                return '❌ Terjadi kesalahan saat mengambil status tools.';
              }
        
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
        
      case 'setsearchkey':
        if (args.length === 0) {
          return 'Gunakan format: !setsearchkey [YOUR_GOOGLE_SEARCH_API_KEY]';
        }
        const searchKeyResult = await setGoogleSearchApiKey(args[0]);
        return searchKeyResult.message;
        
      case 'setsearchengineid':
        if (args.length === 0) {
          return 'Gunakan format: !setsearchengineid [YOUR_GOOGLE_SEARCH_ENGINE_ID]';
        }
        const searchEngineResult = await setGoogleSearchEngineId(args[0]);
        return searchEngineResult.message;
        
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
        
      case 'apilogs':
        return await handleApiLogsCommand(sock, message, args, db);
        
      case 'batch':
        return await handleBatchCommand(sock, message, args, db);
        
      case 'groupbatch':
      case 'gbatch':
        return await handleGroupBatchCommand(sock, message, args, db);
        
      case 'usermap':
      case 'users':
        return await handleUserMappingCommand(sock, message, args, db);
        
      case 'getapikey':
        if (!process.env.OPENROUTER_API_KEY) {
          return 'API key belum dikonfigurasi di environment variables.';
        }
        return `API key: ${process.env.OPENROUTER_API_KEY.substring(0, 5)}...${process.env.OPENROUTER_API_KEY.substring(process.env.OPENROUTER_API_KEY.length - 5)}`;
        
      case 'testmood':
        if (args.length === 0) {
          return 'Gunakan format: !testmood [pesan_uji]\nContoh: !testmood Hari ini aku sangat senang sekali!';
        }
        
        // Get the test message
        const testMessage = args.join(' ');
        
        // Import the necessary functions
        const { updateMoodAndPersonalityWithAI } = await import('./personalityService.js');
        const { generateAnalysis } = await import('./aiService.js');
        
        // Log current mood and personality
        const currentMood = db.data.state.currentMood;
        const currentPersonality = db.data.config.personality;
        
        // Create some dummy context
        const dummyContext = [
          { role: 'system', content: 'This is a test conversation.' },
          { role: 'user', content: testMessage }
        ];
        
        // Run the AI mood detection
        const aiResult = await updateMoodAndPersonalityWithAI(db, testMessage, dummyContext, { generateAnalysis });
        
        // Get updated mood and personality
        const newMood = db.data.state.currentMood;
        const newPersonality = db.data.config.personality;
        
        // Get descriptions
        const moodDesc = getMoodDescription(newMood, db);
        const personalityDesc = getPersonalityDescription(newPersonality, db);
        
        let response = '';
        
        if (aiResult) {
          response = `✅ AI mood detection berhasil mendeteksi mood/personality!\n\n`;
          response += `Pesan uji: "${testMessage}"\n\n`;
          response += `Sebelum: Mood=${currentMood}, Personality=${currentPersonality}\n`;
          response += `Sesudah: Mood=${newMood}, Personality=${newPersonality}\n\n`;
          response += `Deskripsi mood saat ini: ${moodDesc}\n`;
          response += `Deskripsi personality saat ini: ${personalityDesc}`;
        } else {
          response = `❌ AI mood detection tidak mendeteksi perubahan mood/personality untuk pesan: "${testMessage}"\n\n`;
          response += `Mood tetap: ${newMood} - ${moodDesc}\n`;
          response += `Personality tetap: ${newPersonality} - ${personalityDesc}`;
        }
        
        return response;
        
      case 'resetmood':
        await setMood(db, 'happy');
        await setPersonality(db, 'friendly');
        return 'Mood dan personality di-reset ke default (happy & friendly).';
        
      case 'newmoods':
        // Get all available moods and personalities
        const allMoods = getAvailableMoods(db);
        const allPersonalities = getAvailablePersonalities(db);
        
        // Filter to only show new ones
        const newMoods = ['nostalgic', 'proud', 'anxious', 'relaxed', 'flirty', 'confused'];
        const newPersonalities = ['intellectual', 'poetic', 'playful', 'mysterious', 'supportive', 'professional'];
        
        // Get their descriptions
        const moodDescriptions = newMoods.map(mood => {
          return `• ${mood}: ${getMoodDescription(mood, db).substring(0, 50)}...`;
        });
        
        const personalityDescriptions = newPersonalities.map(personality => {
          return `• ${personality}: ${getPersonalityDescription(personality, db)}`;
        });
        
        return `*New Moods & Personalities Update*\n\n` +
               `Bot sekarang memiliki 15 mood dan 15 personality, dengan 6 mood baru dan 6 personality baru!\n\n` +
               `*Mood Baru:*\n${moodDescriptions.join('\n')}\n\n` +
               `*Personality Baru:*\n${personalityDescriptions.join('\n')}\n\n` +
               `Coba gunakan !setmood atau !setpersonality untuk mencoba mood dan personality baru ini!\n` +
               `Atau biarkan bot mengubah mood secara dinamis berdasarkan percakapan.`;
        
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
    if (!apiKey || apiKey.length < 5) {
      return {
        success: false,
        message: 'API key tidak valid'
      };
    }
    
    // Validate key format - Together.AI keys typically start with 'a' 
    if (!apiKey.startsWith('a')) {
      return {
        success: false,
        message: 'Together.AI API key biasanya dimulai dengan "a". Pastikan kunci yang benar.'
      };
    }
    
    // Update environment variable
    process.env.TOGETHER_API_KEY = apiKey;
    
    // Store in database
    const db = getDb();
    db.data.config.togetherApiKey = apiKey;
    await db.write();
    
    console.log('Together.AI API key diperbarui dan disimpan');
    
    return {
      success: true,
      message: `Together.AI API key berhasil diperbarui! [${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 3)}]`
    };
  } catch (error) {
    console.error('Error setting Together.AI API key:', error);
    return {
      success: false,
      message: `Error setting Together.AI API key: ${error.message}`
    };
  }
}

// Set Google Search API key
async function setGoogleSearchApiKey(apiKey) {
  try {
    if (!apiKey || apiKey.length < 5) {
      return {
        success: false,
        message: 'API key tidak valid'
      };
    }
    
    // Validate key format - Google API keys are typically 39 characters
    if (apiKey.length < 20) {
      return {
        success: false,
        message: 'Google Search API key biasanya lebih dari 20 karakter. Pastikan kunci yang benar.'
      };
    }
    
    // Update environment variable
    process.env.GOOGLE_SEARCH_API_KEY = apiKey;
    
    // Store in database
    const db = getDb();
    if (!db.data.config.searchApi) {
      db.data.config.searchApi = {};
    }
    db.data.config.searchApi.googleApiKey = apiKey;
    await db.write();
    
    console.log('Google Search API key diperbarui dan disimpan');
    
    return {
      success: true,
      message: `Google Search API key berhasil diperbarui! [${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 3)}]`
    };
  } catch (error) {
    console.error('Error setting Google Search API key:', error);
    return {
      success: false,
      message: `Error setting Google Search API key: ${error.message}`
    };
  }
}

// Set Google Search Engine ID
async function setGoogleSearchEngineId(engineId) {
  try {
    if (!engineId || engineId.length < 5) {
      return {
        success: false,
        message: 'Search Engine ID tidak valid'
      };
    }
    
    // Update environment variable
    process.env.GOOGLE_SEARCH_ENGINE_ID = engineId;
    
    // Store in database
    const db = getDb();
    if (!db.data.config.searchApi) {
      db.data.config.searchApi = {};
    }
    db.data.config.searchApi.googleSearchEngineId = engineId;
    await db.write();
    
    console.log('Google Search Engine ID diperbarui dan disimpan');
    
    return {
      success: true,
      message: `Google Search Engine ID berhasil diperbarui! [${engineId}]`
    };
  } catch (error) {
    console.error('Error setting Google Search Engine ID:', error);
    return {
      success: false,
      message: `Error setting Google Search Engine ID: ${error.message}`
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

*Pengaturan Web Search:*
!setsearchkey [key] - Mengatur Google Search API key
!setsearchengineid [id] - Mengatur Google Search Engine ID

*Pengaturan Bot:*
!setname [nama] - Mengatur nama bot
!clear - Menghapus konteks percakapan
!setcharacter [deskripsi] - Mengatur pengetahuan karakter
!removecharacter - Menghapus pengetahuan karakter

*Pengaturan Mood:*
!setmood [mood] - Mengatur mood bot (sekarang tersedia 20 mood!)
!listmoods - Menampilkan daftar mood
!moodinfo [mood] - Info detail tentang mood
!addmood [nama] [deskripsi] - Menambah mood kustom
!removemood [nama] - Menghapus mood kustom
!testmood [pesan_uji] - Uji deteksi mood AI
!resetmood - Reset mood dan personality ke default
!newmoods - Lihat info tentang mood dan personality baru

*Pengaturan Personality:*
!setpersonality [personality] - Mengatur personality bot (sekarang tersedia 20 personality!)
!listpersonalities - Menampilkan daftar personality
!personalityinfo [personality] - Info detail tentang personality
!addpersonality [nama] [deskripsi] - Menambah personality kustom
!removepersonality [nama] - Menghapus personality kustom

*Pengaturan Trigger:*
!addtriggers [mood] [kata1] [kata2] - Menambah kata pemicu mood
!listtriggers - Menampilkan daftar kata pemicu

*Fitur Logging:*
!apilogs - Menampilkan log permintaan API terbaru
!apilogs limit [jumlah] - Menampilkan lebih banyak log
!apilogs provider [nama] - Filter log berdasarkan provider
!apilogs model [nama] - Filter log berdasarkan model
!apilogs clear - Hapus log lama (simpan 24 jam terakhir)
!apilogs clear all - Hapus semua log

*Pencarian Fakta:*
!searchfacts [query] - Mencari fakta yang relevan dengan query
!factstats - Menampilkan statistik fakta pengguna
!factsuggest [input] - Memberikan saran fakta berdasarkan input parsial
!advancedsearch [query] - Pencarian lanjutan dengan analisis hubungan
!factinsights - Analisis fakta lanjutan dan statistik
!taxonomysearch [category] [query] - Pencarian berdasarkan kategori taksonomi

*Manajemen Tools:*
!tools - Menampilkan daftar semua tools dengan status
!enabletool [nama] - Mengaktifkan tool tertentu
!disabletool [nama] - Menonaktifkan tool tertentu
!enablecategory [kategori] - Mengaktifkan semua tool dalam kategori
!disablecategory [kategori] - Menonaktifkan semua tool dalam kategori
!enablealltools - Mengaktifkan semua tools
!disablealltools - Menonaktifkan semua tools
!toolstatus - Menampilkan status detail tools

Gunakan !help [perintah] untuk bantuan lebih detail tentang perintah tertentu.`;
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
    searchApiConfigured: !!process.env.GOOGLE_SEARCH_API_KEY,
    searchEngineConfigured: !!process.env.GOOGLE_SEARCH_ENGINE_ID,
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
• Google Search API: ${status.searchApiConfigured ? '✅ Terkonfigurasi' : '❌ Belum dikonfigurasi'}
• Google CSE ID: ${status.searchEngineConfigured ? '✅ Terkonfigurasi' : '❌ Belum dikonfigurasi'}
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
    // if (!db.data.config.model || db.data.config.model.startsWith('gemini') || db.data.config.model.startsWith('google/')) {
    //   if (normalizedProvider === 'gemini') {
    //     // Default Gemini model
    //     db.data.config.model = 'google/gemini-1.5-pro';
    //   } else if (normalizedProvider === 'together') {
    //     // Default Together model
    //     db.data.config.model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free';
    //   } else {
    //     // Default OpenRouter model
    //     db.data.config.model = 'anthropic/claude-3-haiku';
    //   }
    // }
    
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

// Add the !apilogs command handler
async function handleBatchCommand(sock, message, args, db) {
  try {
    const chatId = message.key.remoteJid;
    
    if (args.length === 0) {
      // Show current batch status
      const status = getBatchStatus(chatId);
      
      if (!status) {
        return 'No active message batch for this chat.';
      }
      
      const timeSinceStart = Date.now() - status.startTime;
      const isTyping = status.isTyping ? 'Yes' : 'No';
      
      return `*Message Batch Status*\n\n` +
             `Messages in batch: ${status.messageCount}\n` +
             `Processing: ${status.processing ? 'Yes' : 'No'}\n` +
             `User typing: ${isTyping}\n` +
             `Time since first message: ${Math.round(timeSinceStart / 1000)}s\n` +
             `Last typing time: ${status.lastTypingTime ? new Date(status.lastTypingTime).toLocaleTimeString() : 'N/A'}`;
    }
    
    const subCommand = args[0].toLowerCase();
    
    switch (subCommand) {
      case 'force':
        // Force process current batch
        await forceProcessBatch(sock, chatId);
        return 'Forced processing of current message batch.';
        
      case 'status':
        // Show detailed status
        const status = getBatchStatus(chatId);
        
        if (!status) {
          return 'No active message batch for this chat.';
        }
        
        const timeSinceStart = Date.now() - status.startTime;
        const isTyping = status.isTyping ? 'Yes' : 'No';
        
        return `*Detailed Batch Status*\n\n` +
               `Messages in batch: ${status.messageCount}\n` +
               `Processing: ${status.processing ? 'Yes' : 'No'}\n` +
               `User typing: ${isTyping}\n` +
               `Time since first message: ${Math.round(timeSinceStart / 1000)}s\n` +
               `Last typing time: ${status.lastTypingTime ? new Date(status.lastTypingTime).toLocaleTimeString() : 'N/A'}\n\n` +
               `*Batch Configuration*\n` +
               `Typing timeout: 3s\n` +
               `Max wait time: 8s\n` +
               `Min wait time: 1.5s\n` +
               `Initial delay: 0.8s`;
        
      case 'help':
        return `*Message Batching Commands*\n\n` +
               `!batch - Show current batch status\n` +
               `!batch status - Show detailed status\n` +
               `!batch force - Force process current batch\n` +
               `!batch help - Show this help\n\n` +
               `*How it works:*\n` +
               `Bot waits for you to finish typing before processing messages. This makes conversations more natural.`;
        
      default:
        return `Unknown batch command: ${subCommand}. Use !batch help for available commands.`;
    }
  } catch (error) {
    console.error('Error handling batch command:', error);
    return 'Error handling batch command: ' + error.message;
  }
}

async function handleApiLogsCommand(sock, message, args, db) {
  try {
    const chatId = message.key.remoteJid;
    
    // Check if API logging is enabled
    if (!db.data.config.apiLoggingEnabled) {
      return 'API logging is disabled. Enable it with !config apiLoggingEnabled true';
    }
    
    // Parse arguments
    const options = {};
    let limit = 5; // Default limit
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i].toLowerCase();
      
      if (arg === 'limit' && i + 1 < args.length) {
        limit = parseInt(args[i + 1]) || 5;
        i++; // Skip the next argument
      } else if (arg === 'model' && i + 1 < args.length) {
        options.model = args[i + 1];
        i++; // Skip the next argument
      } else if (arg === 'provider' && i + 1 < args.length) {
        options.provider = args[i + 1];
        i++; // Skip the next argument
      } else if (arg === 'clear') {
        // Clear logs
        await clearApiLogs();
        return 'API logs have been cleared completely';
      } else if (arg === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        options.startDate = today;
      } else if (arg === 'chat') {
        options.chatId = chatId;
      }
    }
    
    // Get logs
    const logs = getApiLogs(options, limit);
    
    if (logs.length === 0) {
      return 'No API logs found matching your criteria';
    }
    
    // Format logs for display
    let response = `*API Logs (${logs.length})*\n`;
    
    logs.forEach((log, index) => {
      const date = new Date(log.timestamp).toLocaleString();
      const executionTime = log.metadata.executionTime || 'N/A';
      const status = log.metadata.status || 'N/A';
      
      response += `\n*${index + 1}. ${log.provider} - ${log.model}*\n`;
      response += `Time: ${date}\n`;
      response += `Status: ${status}\n`;
      response += `Execution: ${executionTime}ms\n`;
      
      // Add message count if available
      if (log.metadata.messageCount) {
        response += `Messages: ${log.metadata.messageCount}\n`;
      }
      
      // Add token counts if available
      if (log.metadata.promptTokens) {
        response += `Prompt Tokens: ~${Math.round(log.metadata.promptTokens)}\n`;
      }
      
      if (log.metadata.completionTokens) {
        response += `Completion Tokens: ~${Math.round(log.metadata.completionTokens)}\n`;
      }
      
      // Add error info if available
      if (log.metadata.success === false) {
        response += `Error: ${log.metadata.error?.message || 'Unknown error'}\n`;
      }
    });
    
    response += '\nUse !apilogs limit [number] to show more logs';
    response += '\nOptions: provider [name], model [name], clear, today, chat';
    
    return response;
  } catch (error) {
    console.error('Error handling API logs command:', error);
    return 'Error retrieving API logs: ' + error.message;
  }
}

async function handleGroupBatchCommand(sock, message, args, db) {
  try {
    const chatId = message.key.remoteJid;
    
    // Only allow in group chats
    if (!chatId.endsWith('@g.us')) {
      return 'This command only works in group chats.';
    }
    
    if (args.length === 0) {
      // Show group batch status
      const presenceStats = getGroupPresenceStats(chatId);
      
      if (!presenceStats) {
        return 'No group activity tracked yet for this group.';
      }
      
      return `*Group Batch Status*\n\n` +
             `📊 *Group Activity:*\n` +
             `Total tracked members: ${presenceStats.totalTrackedMembers}\n` +
             `Recently active: ${presenceStats.recentActiveMembers}\n` +
             `Messages processed: ${presenceStats.messageCount}\n` +
             `Tracking duration: ${Math.round(presenceStats.trackingDuration / 1000 / 60)}m\n\n` +
             `⚙️ *Batch Configuration:*\n` +
             `Min wait time: ${GROUP_BATCH_CONFIG.minWaitTime / 1000}s\n` +
             `Max wait time: ${GROUP_BATCH_CONFIG.maxWaitTime / 1000}s\n` +
             `Typing timeout: ${GROUP_BATCH_CONFIG.typingTimeout / 1000}s\n` +
             `Max batch size: ${GROUP_BATCH_CONFIG.maxBatchSize} messages\n\n` +
             `*Commands:*\n` +
             `!gbatch - Show status\n` +
             `!gbatch force - Force process current batch\n` +
             `!gbatch help - Show help`;
    }
    
    const subCommand = args[0].toLowerCase();
    
    switch (subCommand) {
      case 'force':
        // Force process current group batch
        try {
          await processGroupMessageBatch(sock, chatId);
          return 'Forced processing of current group message batch.';
        } catch (error) {
          return `Error forcing group batch processing: ${error.message}`;
        }
        
      case 'help':
        return `*Group Message Batching System*\n\n` +
               `Advanced batching for group chats that waits for the very last message before processing.\n\n` +
               `*How it works:*\n` +
               `🔄 Collects messages from multiple users\n` +
               `👀 Monitors typing indicators in real-time\n` +
               `⏱️ Waits until everyone stops typing\n` +
               `🧠 Processes all messages with full context\n` +
               `🆔 Uses unified user identity mapping\n\n` +
               `*Commands:*\n` +
               `!gbatch - Show current status\n` +
               `!gbatch force - Force process batch\n` +
               `!gbatch help - This help\n\n` +
               `*Benefits:*\n` +
               `• Better conversation context\n` +
               `• Reduces interruptions\n` +
               `• More natural responses\n` +
               `• Multi-user awareness`;
        
      default:
        return `Unknown group batch command: ${subCommand}. Use !gbatch help for available commands.`;
    }
  } catch (error) {
    console.error('Error handling group batch command:', error);
    return 'Error handling group batch command: ' + error.message;
  }
}

async function handleUserMappingCommand(sock, message, args, db) {
  try {
    const { getUserMappingStats, getAllUserIds, extractPhoneNumber } = await import('../utils/messageUtils.js');
    const chatId = message.key.remoteJid;
    const sender = message.key.participant || message.key.remoteJid;
    
    if (args.length === 0) {
      // Show general statistics
      const stats = getUserMappingStats();
      
      return `*User Identity Mapping Statistics*\n\n` +
             `📊 *Overview:*\n` +
             `Total users tracked: ${stats.totalUsers}\n` +
             `Complete mappings: ${stats.usersWithBothIds}\n` +
             `Personal chat only: ${stats.usersWithPersonalOnly}\n` +
             `Group chat only: ${stats.usersWithGroupOnly}\n` +
             `Recently active (1h): ${stats.recentlyActive}\n\n` +
             `*Commands:*\n` +
             `!usermap - Show statistics\n` +
             `!usermap me - Show your identity mapping\n` +
             `!usermap phone <number> - Lookup by phone number\n` +
             `!usermap help - Show help`;
    }
    
    const subCommand = args[0].toLowerCase();
    
    switch (subCommand) {
      case 'me':
        // Show current user's identity mapping
        const myIds = getAllUserIds(sender);
        
        return `*Your Identity Mapping*\n\n` +
               `📱 Phone: ${myIds.phoneNumber || 'Unknown'}\n` +
               `👤 Personal ID: ${myIds.personalId || 'Not mapped'}\n` +
               `👥 Group ID: ${myIds.groupId || 'Not mapped'}\n` +
               `✅ Complete: ${myIds.isComplete ? 'Yes' : 'No'}\n` +
               `📛 Display Name: ${myIds.displayName || 'Unknown'}\n\n` +
               `*Current Context:*\n` +
               `Current ID: ${sender}\n` +
               `Phone extracted: ${extractPhoneNumber(sender)}`;
        
      case 'phone':
        if (args.length < 2) {
          return 'Please provide a phone number: !usermap phone 628123456789';
        }
        
        const phoneNumber = args[1];
        const phoneIds = getAllUserIds(`${phoneNumber}@s.whatsapp.net`);
        
        if (!phoneIds.phoneNumber) {
          return `No user found with phone number: ${phoneNumber}`;
        }
        
        return `*User Identity for ${phoneNumber}*\n\n` +
               `👤 Personal ID: ${phoneIds.personalId || 'Not mapped'}\n` +
               `👥 Group ID: ${phoneIds.groupId || 'Not mapped'}\n` +
               `✅ Complete: ${phoneIds.isComplete ? 'Yes' : 'No'}\n` +
               `📛 Display Name: ${phoneIds.displayName || 'Unknown'}`;
        
      case 'help':
        return `*User Identity Mapping System*\n\n` +
               `This system maps the same user's different WhatsApp IDs:\n` +
               `• Personal chat: 628xxx@s.whatsapp.net\n` +
               `• Group chat: 628xxx@lid\n\n` +
               `*Commands:*\n` +
               `!usermap - Show statistics\n` +
               `!usermap me - Your identity info\n` +
               `!usermap phone <number> - Lookup user\n` +
               `!usermap help - This help\n\n` +
               `*Why this matters:*\n` +
               `The bot can now recognize that messages from the same person in groups and personal chats are from the same user, enabling better context and memory.`;
        
      default:
        return `Unknown usermap command: ${subCommand}. Use !usermap help for available commands.`;
    }
  } catch (error) {
    console.error('Error handling usermap command:', error);
    return 'Error handling usermap command: ' + error.message;
  }
}

export {
  detectCommand,
  executeCommand,
  setApiKey,
  setGeminiApiKey,
  setTogetherApiKey,
  setGoogleSearchApiKey,
  setGoogleSearchEngineId,
  setModel,
  setBotName,
  setProvider
}; 