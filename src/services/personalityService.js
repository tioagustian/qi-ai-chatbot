// Available moods for the AI
const MOODS = ['happy', 'sad', 'excited', 'bored', 'curious', 'annoyed', 'sleepy', 'energetic'];

// Available personality traits 
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

// Update the AI's mood and personality based on probability and context
async function updateMoodAndPersonality(db, message = null) {
  try {
    const { moodChangeProbability } = db.data.config;
    const currentTime = new Date();
    const lastInteraction = new Date(db.data.state.lastInteraction || 0);
    const currentMood = db.data.state.currentMood;
    let shouldChangeMood = false;
    let newMood = currentMood;
    
    // Context-based mood change (if message is provided)
    if (message) {
      const lowerMessage = message.toLowerCase();
      
      // Check if message contains mood trigger words
      let highestTriggerCount = 0;
      let triggeredMood = null;
      
      for (const [mood, triggers] of Object.entries(MOOD_TRIGGERS)) {
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
        // 50% chance to change mood based on conversation triggers
        const randomFactor = Math.random();
        if (randomFactor < 0.5) {
          shouldChangeMood = true;
          newMood = triggeredMood;
          console.log(`Bot mood changing to: ${newMood} based on conversation triggers`);
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
          // Get a random mood that's different from current
          do {
            newMood = MOODS[Math.floor(Math.random() * MOODS.length)];
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
      
      // Occasionally change personality too (with lower probability)
      if (Math.random() < 0.1) {
        const currentPersonality = db.data.config.personality;
        let newPersonality;
        
        do {
          newPersonality = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
        } while (newPersonality === currentPersonality);
        
        db.data.config.personality = newPersonality;
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

// Set mood explicitly
async function setMood(db, mood) {
  if (!MOODS.includes(mood)) {
    return { success: false, message: `Mood tidak valid. Pilih dari: ${MOODS.join(', ')}` };
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
  if (!PERSONALITIES.includes(personality)) {
    return { success: false, message: `Personality tidak valid. Pilih dari: ${PERSONALITIES.join(', ')}` };
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

// Get available moods
function getAvailableMoods() {
  return MOODS;
}

// Get available personalities
function getAvailablePersonalities() {
  return PERSONALITIES;
}

export {
  updateMoodAndPersonality,
  setMood,
  setPersonality,
  getAvailableMoods,
  getAvailablePersonalities
}; 