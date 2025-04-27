// Available moods for the AI - Predefined set
const MOODS = ['happy', 'sad', 'excited', 'bored', 'curious', 'annoyed', 'sleepy', 'energetic'];

// Available personality traits - Predefined set
const PERSONALITIES = ['friendly', 'sassy', 'shy', 'confident', 'helpful', 'sarcastic', 'chill', 'dramatic'];

// Mood trigger keywords - words that might trigger a mood change
const MOOD_TRIGGERS = {
  happy: ['bagus', 'senang', 'suka', 'keren', 'baik', 'lucu', 'haha', 'wkwk', '😂', '😁', '😄', 'mantap', 'asik'],
  sad: ['sedih', 'maaf', 'kasihan', 'sakit', 'gagal', 'kecewa', 'buruk', '😢', '😭', '😔', 'kangen'],
  excited: ['wow', 'keren', 'mantap', 'asik', 'seru', 'gila', 'yuk', 'ayo', '!', '🔥', '⚡', 'ajak'],
  bored: ['bosan', 'lama', 'males', 'malas', 'capek', 'cape', 'ngantuk', 'lambat', 'biasa', 'basi'],
  curious: ['kenapa', 'gimana', 'bagaimana', 'apa', 'siapa', 'kapan', 'dimana', 'mengapa', 'apakah', '?', 'kok'],
  annoyed: ['bodo', 'jelek', 'bodoh', 'payah', 'nyebelin', 'ganggu', 'berisik', 'bising', 'benci', 'sebel'],
  sleepy: ['malam', 'malem', 'tidur', 'ngantuk', 'lelah', 'istirahat', 'jam', 'capek', 'lelah', 'cape'],
  energetic: ['pagi', 'semangat', 'olahraga', 'main', 'lari', 'cepat', 'aktif', 'workout', 'jalan', 'latihan']
};

// Personality descriptions - how each personality affects responses
const PERSONALITY_DESCRIPTIONS = {
  friendly: 'Ramah dan suka membantu. Selalu positif dan mendukung orang lain',
  sassy: 'Sedikit berani dan menggoda. Suka membuat komentar lucu dan agak usil',
  shy: 'Pemalu dan tidak terlalu banyak bicara. Lebih suka menyimak daripada berbicara',
  confident: 'Percaya diri dan tegas. Tidak ragu memberikan pendapat',
  helpful: 'Selalu ingin membantu dan berguna. Fokus pada memberikan solusi',
  sarcastic: 'Suka menyindir dengan gaya humor yang kering. Sering membuat komentar ironis',
  chill: 'Santai dan tidak terlalu emosional. Mengambil segala sesuatu dengan tenang',
  dramatic: 'Ekspresif dan teatrikal. Bereaksi berlebihan terhadap hal-hal kecil'
};

// Mood descriptions - detailed behavior patterns for each mood
const MOOD_DESCRIPTIONS = {
  happy: 'Sangat ceria dan antusias. Menggunakan emoji dan nada yang penuh semangat. Tertawa dan menggoda teman-teman dengan cara yang menyenangkan',
  sad: 'Sedang sedih. Respons lebih pendek dan kurang bersemangat. Cenderung membela orang lain yang mendapat ledekan',
  excited: 'Sangat bersemangat! Menggunakan banyak tanda seru dan emoji yang menunjukkan kegembiraan. Sangat antusias dengan topik apapun dan suka menyarankan kegiatan baru',
  bored: 'Sedang bosan. Respons singkat dan kurang antusias. Mengeluh tentang aktivitas yang tidak menarik',
  curious: 'Sangat penasaran. Mengajukan pertanyaan dan menunjukkan ketertarikan pada detail. Ingin tahu lebih banyak tentang segala hal',
  annoyed: 'Sedang kesal. Respons sedikit ketus dan tidak sabaran. Cenderung mendebat hal-hal kecil',
  sleepy: 'Sangat mengantuk. Respons lambat dan kadang tidak fokus. Menyebutkan bahwa sedang bersiap tidur atau baru bangun',
  energetic: 'Penuh energi dan semangat. Respons cepat dan antusias. Selalu siap untuk aktivitas dan mendorong orang lain untuk aktif'
};

// Update the AI's mood and personality based on probability and context
async function updateMoodAndPersonality(db, message = null) {
  try {
    const { moodChangeProbability } = db.data.config;
    const currentTime = new Date();
    const lastInteraction = new Date(db.data.state.lastInteraction || 0);
    const currentMood = db.data.state.currentMood;
    let shouldChangeMood = false;
    let newMood = currentMood;
    
    // Get all available moods (including custom ones)
    const availableMoods = getAllMoods(db);
    
    // Context-based mood change (if message is provided)
    if (message) {
      const lowerMessage = message.toLowerCase();
      
      // Check if message contains mood trigger words
      let highestTriggerCount = 0;
      let triggeredMood = null;
      
      // Process both default and custom mood triggers
      const allMoodTriggers = getAllMoodTriggers(db);
      
      for (const [mood, triggers] of Object.entries(allMoodTriggers)) {
        // Skip if the mood doesn't exist anymore
        if (!availableMoods.includes(mood)) continue;
        
        // Count how many trigger words for this mood appear in the message
        const triggerCount = triggers.reduce((count, trigger) => {
          return count + (lowerMessage.includes(trigger) ? 1 : 0);
        }, 0);
        
        // If this mood has more trigger words than previously found ones
        if (triggerCount > highestTriggerCount && triggerCount > 0) {
          highestTriggerCount = triggerCount;
          triggeredMood = mood;
        }
      }
      
      // If a mood was triggered and it's different from current mood
      if (triggeredMood && triggeredMood !== currentMood) {
        // Adjust probability based on trigger count - more triggers = higher probability
        const adjustedProbability = Math.min(0.5 + (highestTriggerCount * 0.1), 0.9);
        const randomFactor = Math.random();
        
        if (randomFactor < adjustedProbability) {
          shouldChangeMood = true;
          newMood = triggeredMood;
          console.log(`Bot mood changing to: ${newMood} based on conversation triggers (probability: ${adjustedProbability.toFixed(2)})`);
        }
      }
    }
    
    // Time-based mood change (only if no context-based change happened)
    if (!shouldChangeMood) {
      // Only consider time-based mood change after some time has passed (at least 15 minutes)
      const timeDiff = (currentTime - lastInteraction) / (1000 * 60); // in minutes
      
      if (timeDiff >= 15) {
        // Probability check for mood change
        shouldChangeMood = Math.random() < moodChangeProbability;
        
        if (shouldChangeMood) {
          // Get a random mood that's different from current (including custom moods)
          do {
            newMood = availableMoods[Math.floor(Math.random() * availableMoods.length)];
          } while (newMood === currentMood);
          
          console.log(`Bot mood changing to: ${newMood} based on time (${timeDiff.toFixed(1)} minutes since last interaction)`);
        }
      }
    }
    
    // Apply mood change if determined
    if (shouldChangeMood) {
      // Update mood
      db.data.state.currentMood = newMood;
      db.data.state.lastMoodChange = currentTime.toISOString();
      
      // Check if we should change personality too based on mood-personality compatibility
      if (Math.random() < 0.2) { // 20% chance to change personality with mood
        const currentPersonality = db.data.config.personality;
        let newPersonality;
        
        // Get all available personalities
        const availablePersonalities = getAllPersonalities(db);
        
        // Sometimes choose a personality that complements the mood
        if (Math.random() < 0.7) { // 70% chance to pick a complementary personality
          const compatiblePersonalities = getCompatiblePersonalities(newMood, db);
          
          if (compatiblePersonalities.length > 0) {
            // Choose from compatible personalities
            newPersonality = compatiblePersonalities[Math.floor(Math.random() * compatiblePersonalities.length)];
          } else {
            // Fallback to random
            do {
              newPersonality = availablePersonalities[Math.floor(Math.random() * availablePersonalities.length)];
            } while (newPersonality === currentPersonality);
          }
        } else {
          // Otherwise pick a random personality
          do {
            newPersonality = availablePersonalities[Math.floor(Math.random() * availablePersonalities.length)];
          } while (newPersonality === currentPersonality);
        }
        
        db.data.config.personality = newPersonality;
        console.log(`Bot personality changed to: ${newPersonality} to match mood: ${newMood}`);
      }
      
      // Save changes
      await db.write();
      
      console.log(`Bot mood updated to: ${newMood}, personality: ${db.data.config.personality}`);
      return true; // Mood was changed
    }
    
    return false; // Mood was not changed
  } catch (error) {
    console.error('Error updating mood and personality:', error);
    return false;
  }
}

// Get all moods (both predefined and custom)
function getAllMoods(db) {
  // Ensure custom moods structure exists
  ensureCustomPersonalityStructure(db);
  
  // Combine predefined and custom moods
  return [...MOODS, ...Object.keys(db.data.customMoods || {})];
}

// Get all personalities (both predefined and custom)
function getAllPersonalities(db) {
  // Ensure custom personalities structure exists
  ensureCustomPersonalityStructure(db);
  
  // Combine predefined and custom personalities
  return [...PERSONALITIES, ...Object.keys(db.data.customPersonalities || {})];
}

// Get all mood triggers (both predefined and custom)
function getAllMoodTriggers(db) {
  // Ensure custom moods structure exists
  ensureCustomPersonalityStructure(db);
  
  // Create a combined triggers object
  const allTriggers = {...MOOD_TRIGGERS};
  
  // Add custom mood triggers
  Object.entries(db.data.customMoods || {}).forEach(([mood, data]) => {
    if (data.triggers && Array.isArray(data.triggers)) {
      allTriggers[mood] = data.triggers;
    }
  });
  
  return allTriggers;
}

// Get personalities compatible with a given mood
function getCompatiblePersonalities(mood, db) {
  // Simple compatibility logic based on mood-personality synergy
  const defaultCompatibility = {
    happy: ['friendly', 'confident', 'energetic', 'sassy'],
    sad: ['shy', 'helpful', 'chill'],
    excited: ['dramatic', 'confident', 'sassy'],
    bored: ['sarcastic', 'chill', 'sassy'],
    curious: ['helpful', 'friendly', 'confident'],
    annoyed: ['sarcastic', 'dramatic'],
    sleepy: ['chill', 'shy'],
    energetic: ['friendly', 'confident', 'dramatic']
  };
  
  // Get custom mood compatibility if exists
  const customCompatibility = db.data.customMoods?.[mood]?.compatiblePersonalities || [];
  
  // Combine default and custom compatibility
  return [...(defaultCompatibility[mood] || []), ...customCompatibility].filter(p => {
    // Only include personalities that actually exist in the system
    return getAllPersonalities(db).includes(p);
  });
}

// Ensure the custom personality data structure exists in the DB
function ensureCustomPersonalityStructure(db) {
  if (!db.data.customMoods) {
    db.data.customMoods = {};
  }
  
  if (!db.data.customPersonalities) {
    db.data.customPersonalities = {};
  }
}

// Set mood explicitly
async function setMood(db, mood) {
  const availableMoods = getAllMoods(db);
  
  if (!availableMoods.includes(mood)) {
    return { success: false, message: `Mood tidak valid. Pilih dari: ${availableMoods.join(', ')}` };
  }
  
  try {
    db.data.state.currentMood = mood;
    db.data.state.lastMoodChange = new Date().toISOString();
    await db.write();
    
    return { 
      success: true, 
      message: `Mood berhasil diubah menjadi: ${mood}` 
    };
  } catch (error) {
    console.error('Error setting mood:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengubah mood' };
  }
}

// Set personality explicitly
async function setPersonality(db, personality) {
  const availablePersonalities = getAllPersonalities(db);
  
  if (!availablePersonalities.includes(personality)) {
    return { success: false, message: `Personality tidak valid. Pilih dari: ${availablePersonalities.join(', ')}` };
  }
  
  try {
    db.data.config.personality = personality;
    await db.write();
    
    return { 
      success: true, 
      message: `Personality berhasil diubah menjadi: ${personality}` 
    };
  } catch (error) {
    console.error('Error setting personality:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengubah personality' };
  }
}

// Get available moods (including custom ones)
function getAvailableMoods(db) {
  return getAllMoods(db);
}

// Get available personalities (including custom ones)
function getAvailablePersonalities(db) {
  return getAllPersonalities(db);
}

// Add a custom mood
async function addCustomMood(db, moodName, description, triggers = [], compatiblePersonalities = []) {
  try {
    ensureCustomPersonalityStructure(db);
    
    // Convert to lowercase for consistency
    moodName = moodName.toLowerCase();
    
    // Check if the mood already exists
    if (MOODS.includes(moodName)) {
      return { 
        success: false, 
        message: `Mood "${moodName}" sudah ada dalam daftar mood default`
      };
    }
    
    // Add or update the custom mood
    db.data.customMoods[moodName] = {
      description: description,
      triggers: triggers,
      compatiblePersonalities: compatiblePersonalities,
      createdAt: new Date().toISOString()
    };
    
    await db.write();
    
    return {
      success: true,
      message: `Mood "${moodName}" berhasil ditambahkan`
    };
  } catch (error) {
    console.error('Error adding custom mood:', error);
    return { success: false, message: 'Terjadi kesalahan saat menambahkan mood' };
  }
}

// Add a custom personality
async function addCustomPersonality(db, personalityName, description) {
  try {
    ensureCustomPersonalityStructure(db);
    
    // Convert to lowercase for consistency
    personalityName = personalityName.toLowerCase();
    
    // Check if the personality already exists
    if (PERSONALITIES.includes(personalityName)) {
      return { 
        success: false, 
        message: `Personality "${personalityName}" sudah ada dalam daftar personality default`
      };
    }
    
    // Add or update the custom personality
    db.data.customPersonalities[personalityName] = {
      description: description,
      createdAt: new Date().toISOString()
    };
    
    await db.write();
    
    return {
      success: true,
      message: `Personality "${personalityName}" berhasil ditambahkan`
    };
  } catch (error) {
    console.error('Error adding custom personality:', error);
    return { success: false, message: 'Terjadi kesalahan saat menambahkan personality' };
  }
}

// Add triggers to a mood
async function addMoodTriggers(db, moodName, newTriggers) {
  try {
    if (!Array.isArray(newTriggers) || newTriggers.length === 0) {
      return { success: false, message: 'Tidak ada trigger yang ditambahkan' };
    }
    
    ensureCustomPersonalityStructure(db);
    
    // Convert to lowercase for consistency
    moodName = moodName.toLowerCase();
    
    // Check if the mood exists
    const availableMoods = getAllMoods(db);
    if (!availableMoods.includes(moodName)) {
      return { 
        success: false, 
        message: `Mood "${moodName}" tidak ditemukan`
      };
    }
    
    // If it's a default mood, we need to create a custom entry for it first
    if (MOODS.includes(moodName) && !db.data.customMoods[moodName]) {
      db.data.customMoods[moodName] = {
        description: MOOD_DESCRIPTIONS[moodName] || `Custom mood: ${moodName}`,
        triggers: [...(MOOD_TRIGGERS[moodName] || [])],
        compatiblePersonalities: [],
        createdAt: new Date().toISOString()
      };
    }
    
    // Add the new triggers
    if (!db.data.customMoods[moodName]) {
      // This shouldn't happen but just in case
      return { 
        success: false, 
        message: `Error: Mood "${moodName}" tidak ditemukan dalam sistem`
      };
    }
    
    // Ensure triggers array exists
    if (!db.data.customMoods[moodName].triggers) {
      db.data.customMoods[moodName].triggers = [];
    }
    
    // Add triggers, avoiding duplicates
    const currentTriggers = db.data.customMoods[moodName].triggers;
    let addedCount = 0;
    
    for (const trigger of newTriggers) {
      if (!currentTriggers.includes(trigger)) {
        currentTriggers.push(trigger);
        addedCount++;
      }
    }
    
    await db.write();
    
    return {
      success: true,
      message: `${addedCount} trigger baru berhasil ditambahkan ke mood "${moodName}"`
    };
  } catch (error) {
    console.error('Error adding mood triggers:', error);
    return { success: false, message: 'Terjadi kesalahan saat menambahkan trigger' };
  }
}

// Remove a custom mood
async function removeCustomMood(db, moodName) {
  try {
    ensureCustomPersonalityStructure(db);
    
    // Convert to lowercase for consistency
    moodName = moodName.toLowerCase();
    
    // Can't remove predefined moods
    if (MOODS.includes(moodName)) {
      return { 
        success: false, 
        message: `Tidak dapat menghapus mood default "${moodName}"`
      };
    }
    
    // Check if the mood exists
    if (!db.data.customMoods[moodName]) {
      return { 
        success: false, 
        message: `Mood "${moodName}" tidak ditemukan`
      };
    }
    
    // Remove the mood
    delete db.data.customMoods[moodName];
    
    // If this was the current mood, reset to a default mood
    if (db.data.state.currentMood === moodName) {
      db.data.state.currentMood = 'happy'; // Reset to default happy mood
    }
    
    await db.write();
    
    return {
      success: true,
      message: `Mood "${moodName}" berhasil dihapus`
    };
  } catch (error) {
    console.error('Error removing custom mood:', error);
    return { success: false, message: 'Terjadi kesalahan saat menghapus mood' };
  }
}

// Remove a custom personality
async function removeCustomPersonality(db, personalityName) {
  try {
    ensureCustomPersonalityStructure(db);
    
    // Convert to lowercase for consistency
    personalityName = personalityName.toLowerCase();
    
    // Can't remove predefined personalities
    if (PERSONALITIES.includes(personalityName)) {
      return { 
        success: false, 
        message: `Tidak dapat menghapus personality default "${personalityName}"`
      };
    }
    
    // Check if the personality exists
    if (!db.data.customPersonalities[personalityName]) {
      return { 
        success: false, 
        message: `Personality "${personalityName}" tidak ditemukan`
      };
    }
    
    // Remove the personality
    delete db.data.customPersonalities[personalityName];
    
    // If this was the current personality, reset to a default personality
    if (db.data.config.personality === personalityName) {
      db.data.config.personality = 'friendly'; // Reset to default friendly personality
    }
    
    await db.write();
    
    return {
      success: true,
      message: `Personality "${personalityName}" berhasil dihapus`
    };
  } catch (error) {
    console.error('Error removing custom personality:', error);
    return { success: false, message: 'Terjadi kesalahan saat menghapus personality' };
  }
}

// Get mood description
function getMoodDescription(moodName, db) {
  // Convert to lowercase for consistency
  moodName = moodName.toLowerCase();
  
  // Check custom moods first
  if (db?.data?.customMoods?.[moodName]?.description) {
    return db.data.customMoods[moodName].description;
  }
  
  // Then check predefined moods
  return MOOD_DESCRIPTIONS[moodName] || `Mood: ${moodName}`;
}

// Get personality description
function getPersonalityDescription(personalityName, db) {
  // Convert to lowercase for consistency
  personalityName = personalityName.toLowerCase();
  
  // Check custom personalities first
  if (db?.data?.customPersonalities?.[personalityName]?.description) {
    return db.data.customPersonalities[personalityName].description;
  }
  
  // Then check predefined personalities
  return PERSONALITY_DESCRIPTIONS[personalityName] || `Personality: ${personalityName}`;
}

export {
  updateMoodAndPersonality,
  setMood,
  setPersonality,
  getAvailableMoods,
  getAvailablePersonalities,
  addCustomMood,
  addCustomPersonality,
  addMoodTriggers,
  removeCustomMood,
  removeCustomPersonality,
  getMoodDescription,
  getPersonalityDescription,
  getAllMoodTriggers,
  MOODS,
  PERSONALITIES
}; 