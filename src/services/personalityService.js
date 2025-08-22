// Available moods for the AI - Predefined set
const MOODS = ['happy', 'sad', 'excited', 'bored', 'curious', 'annoyed', 'sleepy', 'energetic', 'angry', 'nostalgic', 'proud', 'anxious', 'relaxed', 'flirty', 'confused', 'silly', 'focused', 'inspired', 'grateful', 'determined'];

// Available personality traits - Predefined set
const PERSONALITIES = ['friendly', 'sassy', 'shy', 'confident', 'helpful', 'sarcastic', 'chill', 'dramatic', 'rude', 'intellectual', 'poetic', 'playful', 'mysterious', 'supportive', 'professional', 'witty', 'adventurous', 'creative', 'analytical', 'empathetic'];

// Mood trigger keywords - words that might trigger a mood change
const MOOD_TRIGGERS = {
  happy: ['bagus', 'senang', 'suka', 'keren', 'baik', 'lucu', 'haha', 'wkwk', '😂', '😁', '😄', 'mantap', 'asik', 'awesome', 'great', 'nice', 'good', 'funny', 'lol', 'amazing', 'wonderful', 'fantastic', 'excellent', 'perfect', 'love it', 'suka banget', 'keren abis', 'mantap jiwa'],
  sad: ['sedih', 'maaf', 'kasihan', 'sakit', 'gagal', 'kecewa', 'buruk', '😢', '😭', '😔', 'kangen', 'sorry', 'sad', 'unfortunate', 'disappointed', 'failed', 'bad', 'terrible', 'awful', 'horrible', 'miserable', 'heartbroken', 'depressed', 'lonely', 'miss you', 'rindu'],
  excited: ['wow', 'keren', 'mantap', 'asik', 'seru', 'gila', 'yuk', 'ayo', '!', '🔥', '⚡', 'ajak', 'amazing', 'incredible', 'awesome', 'fantastic', 'let\'s go', 'come on', 'yes!', 'woohoo', 'yay', 'finally', 'can\'t wait', 'so excited', 'bersemangat', 'semangat'],
  bored: ['bosan', 'lama', 'males', 'malas', 'capek', 'cape', 'ngantuk', 'lambat', 'biasa', 'basi', 'boring', 'tired', 'slow', 'dull', 'monotonous', 'repetitive', 'nothing to do', 'idle', 'uninteresting', 'tedious', 'mundane', 'routine', 'predictable'],
  curious: ['kenapa', 'gimana', 'bagaimana', 'apa', 'siapa', 'kapan', 'dimana', 'mengapa', 'apakah', '?', 'kok', 'why', 'how', 'what', 'who', 'when', 'where', 'which', 'tell me', 'explain', 'describe', 'show me', 'i wonder', 'interesting', 'fascinating', 'curious', 'penasaran'],
  annoyed: ['bodo', 'jelek', 'bodoh', 'payah', 'nyebelin', 'ganggu', 'berisik', 'bising', 'benci', 'sebel', 'annoying', 'stupid', 'idiot', 'dumb', 'fool', 'irritating', 'bothersome', 'noisy', 'loud', 'hate', 'dislike', 'frustrated', 'angry', 'mad', 'upset', 'fed up'],
  sleepy: ['malam', 'malem', 'tidur', 'ngantuk', 'lelah', 'istirahat', 'jam', 'capek', 'lelah', 'cape', 'night', 'sleep', 'tired', 'exhausted', 'rest', 'bedtime', 'drowsy', 'yawn', 'zzz', 'sleepy', 'fatigue', 'weary', 'late', 'midnight', 'early morning'],
  energetic: ['pagi', 'semangat', 'olahraga', 'main', 'lari', 'cepat', 'aktif', 'workout', 'jalan', 'latihan', 'morning', 'energy', 'exercise', 'sport', 'run', 'fast', 'active', 'workout', 'walk', 'training', 'vibrant', 'lively', 'dynamic', 'enthusiastic', 'motivated'],
  angry: ['marah', 'kesal', 'emosi', 'bete', 'kesel', 'sialan', 'brengsek', 'kampret', 'anjing', 'bangsat', 'goblok', 'bego', 'tai', '🤬', '😡', '💢', 'angry', 'mad', 'furious', 'rage', 'hate', 'disgusted', 'outraged', 'livid', 'irate', 'fuming', 'enraged', 'infuriated'],
  nostalgic: ['dulu', 'ingat', 'kenangan', 'masa lalu', 'zaman', 'rindu', 'memories', 'kangen', 'lama', 'nostalgia', 'jaman dulu', 'waktu itu', 'remember', 'memories', 'past', 'old days', 'childhood', 'back then', 'used to', 'good old days', 'throwback', 'flashback', 'reminisce'],
  proud: ['bangga', 'berhasil', 'sukses', 'hebat', 'prestasi', 'pencapaian', 'achievement', 'bisa', 'mampu', 'luar biasa', '👏', '🏆', 'proud', 'success', 'achievement', 'accomplished', 'great job', 'well done', 'excellent', 'outstanding', 'amazing work', 'congratulations', 'winner', 'champion'],
  anxious: ['khawatir', 'cemas', 'takut', 'bingung', 'gelisah', 'stress', 'panik', 'deg-degan', 'tegang', 'gugup', 'was-was', '😰', '😨', 'worried', 'anxious', 'nervous', 'scared', 'afraid', 'stress', 'panic', 'tense', 'jittery', 'uneasy', 'concerned', 'fearful', 'apprehensive'],
  relaxed: ['santai', 'tenang', 'nyaman', 'damai', 'rileks', 'kalem', 'adem', 'slow', 'enak', 'peace', '😌', '😊', '🧘', 'relaxed', 'calm', 'peaceful', 'comfortable', 'chill', 'easy', 'slow', 'gentle', 'tranquil', 'serene', 'mellow', 'laid back', 'easygoing'],
  flirty: ['genit', 'nakal', 'sayang', 'cinta', 'suka', 'cantik', 'ganteng', 'manis', 'manja', 'gombal', 'pacar', 'jadian', '😘', '😍', '❤️', 'flirty', 'cute', 'handsome', 'beautiful', 'love', 'sweet', 'darling', 'honey', 'babe', 'romantic', 'attractive', 'charming'],
  confused: ['bingung', 'ga ngerti', 'tidak paham', 'aneh', 'membingungkan', 'random', 'ngaco', 'absurd', 'ga jelas', 'apa sih', 'maksudnya', '🤔', '❓', 'confused', 'don\'t understand', 'weird', 'strange', 'random', 'nonsense', 'absurd', 'unclear', 'what do you mean', 'huh', 'what'],
  silly: ['lucu', 'kocak', 'gila', 'gokil', 'absurd', 'random', 'nonsense', 'funny', 'hilarious', 'ridiculous', 'crazy', 'wild', 'bonkers', 'nuts', 'wacky', 'goofy', 'silly', 'stupid joke', 'dad joke', 'pun', '🤪', '😜', '🤡', '💩'],
  focused: ['fokus', 'serius', 'kerja', 'tugas', 'deadline', 'project', 'work', 'study', 'learn', 'concentrate', 'focus', 'serious', 'business', 'important', 'urgent', 'priority', 'goal', 'target', 'mission', 'objective', 'determined', 'committed'],
  inspired: ['inspirasi', 'ide', 'kreatif', 'inovasi', 'baru', 'fresh', 'creative', 'inspiration', 'idea', 'innovation', 'new', 'original', 'unique', 'brilliant', 'genius', 'amazing idea', 'lightbulb', 'eureka', 'breakthrough', 'discovery', '💡', '✨', '🌟'],
  grateful: ['terima kasih', 'makasih', 'thanks', 'thank you', 'appreciate', 'grateful', 'blessed', 'lucky', 'fortunate', 'thankful', 'appreciation', 'gratitude', 'kindness', 'helpful', 'support', 'love', 'care', '🙏', '💝', '💕', '❤️'],
  determined: ['semangat', 'pantang menyerah', 'never give up', 'keep going', 'persevere', 'determined', 'motivated', 'driven', 'ambitious', 'goal-oriented', 'focused', 'committed', 'dedicated', 'hard work', 'effort', 'success', 'achievement', '💪', '🔥', '⚡']
};

// Personality descriptions - how each personality affects responses
const PERSONALITY_DESCRIPTIONS = {
  friendly: 'Warm and helpful. Always positive and supportive of others. Uses encouraging language and shows genuine interest in helping people',
  sassy: 'Bold and slightly teasing. Likes to make witty comments and playful remarks. Has a confident attitude with a touch of attitude',
  shy: 'Timid and doesn\'t talk too much. Prefers to listen rather than speak. Gives shorter, more reserved responses',
  confident: 'Self-assured and assertive. Doesn\'t hesitate to give opinions. Speaks with authority and conviction',
  helpful: 'Always wants to be useful and assist others. Focuses on providing solutions and practical advice',
  sarcastic: 'Likes to make dry humor and ironic comments. Often uses wit to point out absurdities or contradictions',
  chill: 'Relaxed and not too emotional. Takes everything calmly and doesn\'t get easily worked up',
  dramatic: 'Expressive and theatrical. Overreacts to small things and makes everything seem more intense than it is',
  rude: 'Blunt and direct. Often uses strong language and doesn\'t care about others\' feelings. Can be harsh or offensive',
  intellectual: 'Analytical and logical thinking. Likes to use technical terms and discuss deep topics. Interested in knowledge and facts',
  poetic: 'Speaks with beautiful and meaningful language. Often uses analogies and metaphors. Appreciates beauty in everything',
  playful: 'Likes to joke and have fun. Always makes the atmosphere light and enjoyable. Full of humor and cheerfulness',
  mysterious: 'Doesn\'t reveal much about oneself. Answers are often ambiguous and make people curious. Likes to give hints without complete answers',
  supportive: 'Very supportive and caring. Always there to listen and give positive encouragement. Prioritizes others\' feelings',
  professional: 'Formal and efficiency-oriented. Speaks clearly and gets straight to the point. Upholds ethics and quality',
  witty: 'Smart and humorous. Likes to make clever jokes and witty comments. Uses wordplay and sophisticated humor. Always has clever comebacks',
  adventurous: 'Brave and loves challenges. Likes to suggest exciting and exploratory activities. Uses enthusiastic and energetic language. Not afraid to try new things',
  creative: 'Very creative and imaginative. Likes to give unique and original ideas. Uses colorful and expressive language. Often provides unusual perspectives',
  analytical: 'Logical and systematic thinking. Likes to analyze problems in detail and provide structured solutions. Uses data and facts to support arguments',
  empathetic: 'Very understanding of others\' feelings. Likes to provide emotional support and validation. Uses warm and empathetic language. Always tries to understand others\' perspectives'
};

// Mood descriptions - detailed behavior patterns for each mood
const MOOD_DESCRIPTIONS = {
  happy: 'Very cheerful and enthusiastic. Uses emojis and energetic tone. Laughs and teases friends in a pleasant way. Shows genuine joy and positivity in responses',
  sad: 'Currently sad. Responses are shorter and less enthusiastic. Tends to defend others who are being teased. Uses melancholic language and shows empathy',
  excited: 'Very excited! Uses many exclamation marks and emojis showing joy. Very enthusiastic about any topic and likes to suggest new activities. Shows high energy and enthusiasm',
  bored: 'Currently bored. Short and unenthusiastic responses. Complains about uninteresting activities. Shows lack of interest and engagement',
  curious: 'Very curious. Asks questions and shows interest in details. Wants to know more about everything. Shows genuine interest and asks follow-up questions',
  annoyed: 'Currently irritated. Slightly curt and impatient responses. Tends to argue about small things. Shows frustration and impatience',
  sleepy: 'Very sleepy. Slow responses and sometimes unfocused. Mentions being ready for bed or just waking up. Shows tiredness and drowsiness',
  energetic: 'Full of energy and enthusiasm. Fast and enthusiastic responses. Always ready for activities and encourages others to be active. Shows high energy and motivation',
  angry: 'Very angry and emotional. Uses short and sharp sentences. Often curses and uses harsh language. Easily provoked and becomes defensive. Uses exclamation marks and capitalization to show emotion. Becomes blunt and doesn\'t care about others\' feelings',
  nostalgic: 'Currently nostalgic and reminiscing about the past. Often invites conversation partners to remember past experiences or asks about their memories. Uses phrases like "back then...", "I remember...", "in the old days...". Speaks with longing and warmth about old things',
  proud: 'Currently proud and satisfied with achievements. Highlights successes and positive things. Gives sincere and enthusiastic praise. Uses language showing appreciation and recognition. Often uses emojis like 👏 and 🏆',
  anxious: 'Currently anxious and worried. Expresses many doubts and fears. Often asks "what if..." or worries about bad possibilities. Gives responses that seem nervous and uneasy. Sometimes repeats important questions or statements',
  relaxed: 'Very relaxed and calm. Speaks with slow and pleasant tempo. Not in a hurry and enjoys the moment. Often uses calming words and encourages not to stress. Provides peaceful and balanced perspective',
  flirty: 'Teasing and slightly naughty. Often gives compliments and personal attention. Uses slightly seductive and attentive language. Likes to give emojis like 😘, 😍, and ❤️. Communication is more personal and warm, with a touch of romance',
  confused: 'Currently confused and unsure. Answers are less structured and sometimes asks back for clarification. Uses phrases like "Hmm...", "I\'m not sure...", or "I\'m still confused...". Sometimes gives multiple possible answers because unsure which is correct',
  silly: 'Very funny and playful. Likes to make jokes, dad jokes, and absurd humor. Uses funny and expressive emojis. Not too serious and likes to make the atmosphere light. Sometimes gives unexpected but entertaining answers',
  focused: 'Very focused and serious. Structured answers and gets straight to the point. Uses formal and professional language. Doesn\'t joke much and prioritizes efficiency in communication',
  inspired: 'Full of inspiration and creativity. Likes to give new ideas and innovative solutions. Uses enthusiastic and energetic language. Often gives out-of-the-box suggestions and motivates others',
  grateful: 'Very thankful and appreciative. Likes to say thank you and give appreciation. Uses warm and loving language. Always sees the positive side of every situation',
  determined: 'Very determined and persistent. Uses motivational and encouraging language. Likes to give encouragement and support to achieve goals. Doesn\'t give up easily and always looks for solutions'
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
      // Only consider time-based mood change after some time has passed (at least 10 minutes)
      const timeDiff = (currentTime - lastInteraction) / (1000 * 60); // in minutes
      
      if (timeDiff >= 10) {
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
      
      // NEW: Record mood change in history
      if (!db.data.moodHistory) {
        db.data.moodHistory = [];
      }
      
      // Track why the mood changed for better awareness
      const moodChangeReason = message 
        ? `Detected mood triggers in message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`
        : `Time-based change after ${timeDiff.toFixed(1)} minutes of inactivity`;
      
      // Get current chat info if available
      const currentChatId = db.data.state.currentChat || null;
      const chatName = currentChatId && db.data.conversations[currentChatId] 
                      ? db.data.conversations[currentChatId].chatName || null
                      : null;
      
      // Add to mood history
      db.data.moodHistory.push({
        mood: newMood,
        previousMood: currentMood,
        timestamp: currentTime.toISOString(),
        reason: moodChangeReason,
        chatId: currentChatId,
        chatName: chatName,
        messageBased: !!message
      });
      
      // Limit history size
      if (db.data.moodHistory.length > 20) {
        db.data.moodHistory = db.data.moodHistory.slice(-20);
      }
      
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

// NEW FUNCTION: Update mood and personality using AI analysis
// Uses AI to determine appropriate mood and personality based on message context
async function updateMoodAndPersonalityWithAI(db, message, context, aiService) {
  try {
    console.log(`Analyzing message for AI-based mood/personality change: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
    const currentTime = new Date();
    const lastInteraction = new Date(db.data.state.lastInteraction || 0);
    const currentMood = db.data.state.currentMood;
    const currentPersonality = db.data.config.personality;
    
    // Only consider AI-based mood change with some probability or after significant time
    const timeDiff = (currentTime - lastInteraction) / (1000 * 60); // in minutes
    const shouldAnalyze = Math.random() < 0.5 || timeDiff >= 15; // 50% chance or after 15 minutes
    
    if (!shouldAnalyze) {
      console.log('Skipping AI mood analysis due to probability check');
      return false;
    }
    
    // Get all available moods and personalities
    const availableMoods = getAllMoods(db);
    const availablePersonalities = getAllPersonalities(db);
    
    // Prepare prompt for AI to analyze appropriate mood/personality
    const analysisPrompt = `
Analyze the following message and conversation context to determine the most appropriate mood and personality for me (Qi) to respond with.

Recent message: "${message}"

Current mood: ${currentMood}
Current personality: ${currentPersonality}

Available moods: ${availableMoods.join(', ')}
Available personalities: ${availablePersonalities.join(', ')}

Based on the message content, tone, and context, determine:
1. What mood would be most natural for me to have right now? Should I keep my current mood or change to a different mood?
2. What personality would be most appropriate for responding to this message?
3. Provide a brief explanation of why these changes make sense in this context.

Consider the emotional tone, user's intent, and conversation flow when making your decision.

Return your response in this format only:
{
  "mood": "selected_mood",
  "personality": "selected_personality",
  "explanation": "brief explanation of why these fit the context"
}
`;

    // Use AI to analyze the message and recommend mood/personality
    const analysisResponse = await aiService.generateAnalysis(analysisPrompt, {
      temperature: 0.7,
      max_tokens: 300
    }, context);
    
    // Parse the AI response to extract mood and personality
    let resultData;
    try {
      // Try to parse the response in different ways depending on the format
      if (typeof analysisResponse === 'object') {
        // If it's already an object, try to use it directly
        if (analysisResponse.mood && analysisResponse.personality) {
          resultData = analysisResponse;
        } else if (analysisResponse.text || analysisResponse.content) {
          // If it's an object with text/content property, extract JSON from there
          const textContent = analysisResponse.text || analysisResponse.content;
          const jsonMatch = textContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resultData = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error('No valid JSON found in response object text');
          }
        } else {
          // Try to stringify and re-parse to get a clean object
          const jsonString = JSON.stringify(analysisResponse);
          resultData = JSON.parse(jsonString);
        }
      } else if (typeof analysisResponse === 'string') {
        // If it's a string, try to extract JSON from it
        const jsonMatch = analysisResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          resultData = JSON.parse(jsonMatch[0]);
        } else {
          // If no JSON object is found, try to parse key-value pairs
          const moodMatch = analysisResponse.match(/mood["\s:]+([a-z]+)/i);
          const personalityMatch = analysisResponse.match(/personality["\s:]+([a-z]+)/i);
          const explanationMatch = analysisResponse.match(/explanation["\s:]+["']([^"']+)/i);
          
          if (moodMatch || personalityMatch) {
            resultData = {
              mood: moodMatch ? moodMatch[1].toLowerCase() : currentMood,
              personality: personalityMatch ? personalityMatch[1].toLowerCase() : currentPersonality,
              explanation: explanationMatch ? explanationMatch[1] : 'Based on message content.'
            };
          } else {
            throw new Error('No valid mood/personality data found in response');
          }
        }
      } else {
        throw new Error(`Unexpected response type: ${typeof analysisResponse}`);
      }
    } catch (parseError) {
      console.error('Error parsing AI mood analysis response:', parseError);
      console.log('Raw response:', analysisResponse);
      
      // Fallback to basic mood detection using keywords for reliability
      await updateMoodAndPersonality(db, message);
      
      return false;
    }
    
    const { mood: suggestedMood, personality: suggestedPersonality, explanation } = resultData;
    
    // Validate suggested mood and personality
    let shouldChangeMood = false;
    let shouldChangePersonality = false;
    let newMood = currentMood;
    let newPersonality = currentPersonality;
    
    // Check if suggested mood is valid and different from current
    if (suggestedMood && availableMoods.includes(suggestedMood) && suggestedMood !== currentMood) {
      shouldChangeMood = true;
      newMood = suggestedMood;
    }
    
    // Check if suggested personality is valid and different from current
    if (suggestedPersonality && availablePersonalities.includes(suggestedPersonality) && suggestedPersonality !== currentPersonality) {
      shouldChangePersonality = true;
      newPersonality = suggestedPersonality;
    }
    
    // Apply changes if any
    if (shouldChangeMood || shouldChangePersonality) {
      if (shouldChangeMood) {
        db.data.state.currentMood = newMood;
        db.data.state.lastMoodChange = currentTime.toISOString();
        db.data.state.lastMoodChangeReason = explanation || 'AI-determined mood change';
        console.log(`Bot mood changed to: ${newMood} (AI-determined)`);
        
        // NEW: Record mood change in history
        if (!db.data.moodHistory) {
          db.data.moodHistory = [];
        }
        
        // Get current chat info if available
        const currentChatId = db.data.state.currentChat || null;
        const chatName = currentChatId && db.data.conversations[currentChatId] 
                        ? db.data.conversations[currentChatId].chatName || null
                        : null;
        
        // Add to mood history with AI-based explanation
        db.data.moodHistory.push({
          mood: newMood,
          previousMood: currentMood,
          timestamp: currentTime.toISOString(),
          reason: explanation || 'AI-determined based on message content',
          chatId: currentChatId,
          chatName: chatName,
          messageBased: true,
          aiDetermined: true
        });
        
        // Limit history size
        if (db.data.moodHistory.length > 20) {
          db.data.moodHistory = db.data.moodHistory.slice(-20);
        }
      }
      
      if (shouldChangePersonality) {
        db.data.config.personality = newPersonality;
        db.data.state.lastPersonalityChange = currentTime.toISOString();
        db.data.state.lastPersonalityChangeReason = explanation || 'AI-determined personality change';
        console.log(`Bot personality changed to: ${newPersonality} (AI-determined)`);
      }
      
      // Log the explanation
      console.log(`Mood/personality change explanation: ${explanation}`);
      
      // Save changes
      await db.write();
      return true; // Changes were made
    }
    
    return false; // No changes were made
  } catch (error) {
    console.error('Error in AI-based mood and personality update:', error);
    
    // Fallback to basic mood detection using keywords for reliability
    await updateMoodAndPersonality(db, message);
    
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
    happy: ['friendly', 'confident', 'energetic', 'sassy', 'playful', 'supportive', 'witty', 'creative'],
    sad: ['shy', 'helpful', 'chill', 'poetic', 'supportive', 'professional', 'empathetic'],
    excited: ['dramatic', 'confident', 'sassy', 'playful', 'energetic', 'friendly', 'adventurous', 'creative'],
    bored: ['sarcastic', 'chill', 'sassy', 'mysterious', 'intellectual', 'poetic', 'witty'],
    curious: ['helpful', 'friendly', 'confident', 'intellectual', 'mysterious', 'professional', 'analytical'],
    annoyed: ['sarcastic', 'dramatic', 'rude', 'professional', 'intellectual', 'witty'],
    sleepy: ['chill', 'shy', 'poetic', 'mysterious', 'empathetic'],
    energetic: ['friendly', 'confident', 'dramatic', 'playful', 'sassy', 'adventurous'],
    angry: ['rude', 'sarcastic', 'dramatic', 'professional', 'analytical'],
    nostalgic: ['poetic', 'chill', 'supportive', 'shy', 'friendly', 'empathetic'],
    proud: ['confident', 'friendly', 'professional', 'supportive', 'playful', 'creative'],
    anxious: ['shy', 'supportive', 'helpful', 'professional', 'friendly', 'empathetic'],
    relaxed: ['chill', 'friendly', 'poetic', 'playful', 'supportive', 'empathetic'],
    flirty: ['sassy', 'playful', 'confident', 'dramatic', 'mysterious', 'witty'],
    confused: ['helpful', 'professional', 'intellectual', 'supportive', 'friendly', 'analytical'],
    silly: ['playful', 'witty', 'sassy', 'creative', 'friendly', 'dramatic'],
    focused: ['professional', 'analytical', 'intellectual', 'confident', 'helpful'],
    inspired: ['creative', 'adventurous', 'confident', 'energetic', 'supportive', 'dramatic'],
    grateful: ['empathetic', 'supportive', 'friendly', 'poetic', 'helpful'],
    determined: ['confident', 'energetic', 'adventurous', 'professional', 'analytical', 'supportive']
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

// Set character knowledge
async function setCharacterKnowledge(db, knowledge) {
  try {
    db.data.config.characterKnowledge = knowledge;
    await db.write();
    
    return { 
      success: true, 
      message: 'Pengetahuan karakter berhasil diubah' 
    };
  } catch (error) {
    console.error('Error setting character knowledge:', error);
    return { success: false, message: 'Terjadi kesalahan saat mengubah pengetahuan karakter' };
  }
}

// Get character knowledge
function getCharacterKnowledge(db) {
  return db.data.config.characterKnowledge || '';
}

export {
  MOODS,
  PERSONALITIES,
  MOOD_TRIGGERS,
  PERSONALITY_DESCRIPTIONS,
  MOOD_DESCRIPTIONS,
  updateMoodAndPersonality,
  updateMoodAndPersonalityWithAI,
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
  setCharacterKnowledge,
  getCharacterKnowledge
}; 