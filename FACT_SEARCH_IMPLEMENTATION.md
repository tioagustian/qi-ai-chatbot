# Fact Search Implementation

## Overview

This implementation provides a comprehensive fact search system for the Qi AI chatbot, allowing the bot to actively search and retrieve relevant facts from the database based on user messages. The system combines both keyword-based and semantic search capabilities to provide accurate and relevant fact retrieval.

## Features

### 🔍 **Multi-Modal Search**
- **Keyword Search**: Traditional keyword matching across fact keys, values, categories, and tags
- **Semantic Search**: AI-powered semantic similarity search using Gemini API
- **Hybrid Approach**: Combines both methods for optimal results

### 🧠 **Intelligent Fact Integration**
- **Context-Aware Analysis**: Analyzes message intent and conversation context
- **Intent Recognition**: Detects personal questions, factual queries, and conversational patterns
- **Natural Integration**: Seamlessly incorporates facts into responses without explicit mention
- **Dynamic Prioritization**: Prioritizes facts based on relevance to current conversation

### 📊 **Comprehensive Fact Coverage**
- **User Facts**: Personal facts about individual users
- **Global Facts**: General knowledge and shared information
- **Other Users' Facts**: Facts from other participants (in group chats)

### 🎯 **Smart Relevance Scoring**
- **Multi-factor scoring**: Considers keyword matches, confidence levels, recency, and semantic similarity
- **Context scoring**: Additional scoring based on conversation context and message intent
- **Dynamic thresholds**: Configurable minimum relevance scores
- **Usage tracking**: Tracks fact usage for improved future searches

### 🛠 **User Commands**
- `!searchfacts [query]` - Search for relevant facts
- `!factstats` - View fact statistics
- `!factsuggest [input]` - Get fact suggestions based on partial input

## Architecture

### Core Components

#### 1. **Fact Search Service** (`src/services/factSearchService.js`)
The main service that handles all fact search operations:

```javascript
// Main search function
async function searchFacts(userId, message, options = {})

// Specialized search functions
async function searchUserFacts(userId, message, keywords, options)
async function searchGlobalFacts(message, keywords, options)
async function searchOtherUserFacts(currentUserId, message, keywords, options)

// Utility functions
function extractKeywords(message)
function searchFactsByKeywords(facts, keywords, factType, userId)
async function searchFactsSemantically(facts, message, factType, userId)
```

#### 2. **Fact Integration Service** (`src/services/factIntegrationService.js`)
The intelligent service that integrates facts into conversations:

```javascript
// Main integration function
async function integrateFactsIntelligently(userId, message, conversationHistory, options)

// Analysis functions
function analyzeMessageIntent(message, conversationHistory)
function prioritizeFactsByContext(facts, messageAnalysis, conversationHistory, maxFacts)

// Context enhancement
function createNaturalContextEnhancement(facts, messageAnalysis, conversationHistory)
async function enhanceContextWithFacts(userId, message, contextMessages, conversationHistory)
```

#### 3. **Message Handler Integration** (`src/handlers/messageHandler.js`)
Intelligently integrates facts during message processing:

```javascript
// Intelligent fact integration is triggered before AI response generation
const intelligentFactIntegration = await integrateFactsIntelligently(
  actualUserId, 
  content, 
  recentHistory,
  {
    maxFacts: 4,
    minRelevance: 0.4,
    useSemanticSearch: true,
    includeGlobalFacts: true,
    includeUserFacts: true,
    contextAware: true
  }
);
```

#### 4. **Command Service Integration** (`src/services/commandService.js`)
Provides user-accessible commands for fact searching:

```javascript
case 'searchfacts':
  // Manual fact search command
case 'factstats':
  // Fact statistics command
case 'factsuggest':
  // Fact suggestions command
```

## Search Algorithms

### 1. **Keyword-Based Search**

**Scoring System:**
- **Key matches**: 0.4 points (highest priority)
- **Value matches**: 0.3 points
- **Category matches**: 0.2 points
- **Tag matches**: 0.1 points
- **Confidence boost**: +10% of fact confidence
- **Recency boost**: +0.1 for facts updated within 7 days

**Implementation:**
```javascript
function searchFactsByKeywords(facts, keywords, factType, userId = null) {
  // Iterates through all facts
  // Applies scoring algorithm
  // Returns ranked results
}
```

### 2. **Semantic Search**

**AI-Powered Analysis:**
- Uses Gemini 2.0 Flash model for semantic understanding
- Analyzes user message context and intent
- Finds semantically related facts even without exact keyword matches

**Prompt Structure:**
```
You are a fact search assistant. Given a user message and a list of facts, 
find the most semantically relevant facts.

SEARCH CRITERIA:
1. Direct relevance: Facts that directly answer or relate to the user's question/topic
2. Contextual relevance: Facts that provide useful context for the user's message
3. Thematic relevance: Facts that share themes or concepts with the user's message
4. Implicit relevance: Facts that might be useful based on the conversation context
```

### 3. **Result Combination**

**Deduplication Strategy:**
- Combines keyword and semantic results
- Merges duplicate facts with highest relevance scores
- Preserves reasoning from semantic search
- Tracks search methods used

## Usage Examples

### Intelligent Fact Integration (During Conversations)

The bot intelligently integrates facts into conversations based on context and intent:

```javascript
// Example: User says "What's my name?"
// Bot analyzes intent as "personal_question"
// Bot finds relevant facts and creates natural context
// Bot responds: "Nama kamu John Doe, kan? 😊"
```

### Intent Recognition Examples

- **Personal Question**: "Siapa nama saya?" → Intent: `personal_question`
- **Factual Question**: "Apa itu Jakarta?" → Intent: `factual_question`  
- **Conversational**: "Halo, apa kabar?" → Intent: `conversational`
- **Personal Statement**: "Saya suka musik jazz" → Intent: `personal_statement`

### Manual Fact Search Commands

#### Search for Specific Facts
```
User: !searchfacts nama saya
Bot: 🔍 Hasil Pencarian Fakta untuk "nama saya":
     1. 👤 user_name: John Doe
        Relevansi: 95.2%
     2. 👤 full_name: John Michael Doe
        Relevansi: 87.1%
```

#### View Fact Statistics
```
User: !factstats
Bot: 📊 Statistik Fakta:
     👤 Fakta Pengguna: 15
     🌍 Fakta Global: 42
     🆕 Fakta Terbaru: 3
     ⭐ Fakta Berkualitas Tinggi: 12
```

#### Get Fact Suggestions
```
User: !factsuggest nam
Bot: 💡 Saran Fakta untuk "nam":
     1. 👤 user_name: John Doe
        Kategori: personal
        Kepercayaan: 95.0%
     2. 👤 nickname: Johnny
        Kategori: personal
        Kepercayaan: 88.0%
```

## Configuration Options

### Search Parameters

```javascript
const searchOptions = {
  includeGlobalFacts: true,      // Include global facts in search
  includeUserFacts: true,        // Include user-specific facts
  includeOtherUsers: false,      // Include other users' facts (group chats)
  maxResults: 10,                // Maximum number of results
  minRelevance: 0.3,            // Minimum relevance score (0.0-1.0)
  useSemanticSearch: true        // Enable AI-powered semantic search
};
```

### Constants

```javascript
const SEARCH_MODEL = 'gemini-2.0-flash';    // AI model for semantic search
const MAX_SEARCH_RESULTS = 10;              // Default max results
const MIN_RELEVANCE_SCORE = 0.3;           // Default minimum relevance
const SEMANTIC_SEARCH_ENABLED = true;      // Enable semantic search by default
```

## Performance Considerations

### Optimization Strategies

1. **Caching**: Search results can be cached for repeated queries
2. **Indexing**: Facts are indexed by keywords for faster retrieval
3. **Batch Processing**: Multiple facts are processed in batches
4. **Early Termination**: Search stops when sufficient results are found

### Resource Usage

- **API Calls**: Semantic search requires Gemini API calls (configurable)
- **Memory**: Search results are stored temporarily in memory
- **Database**: Frequent reads from fact storage

## Best Practices

### For Developers

1. **Error Handling**: Always wrap search operations in try-catch blocks
2. **Logging**: Use appropriate logging levels for debugging
3. **Configuration**: Make search parameters configurable
4. **Testing**: Test with various query types and fact structures

### For Users

1. **Specific Queries**: Use specific keywords for better results
2. **Natural Language**: Semantic search works well with natural language
3. **Context**: Provide context in queries for better relevance
4. **Feedback**: Use fact statistics to understand search quality

## Integration Points

### With Existing Systems

1. **Memory Service**: Leverages existing fact extraction and storage
2. **Context Service**: Integrates with conversation context
3. **AI Service**: Uses Gemini API for semantic search
4. **Command Service**: Provides user-accessible commands

### Data Flow

```
User Message → Message Handler → Fact Search → AI Response Generation
     ↓              ↓              ↓              ↓
Extract Content → Search Facts → Get Context → Generate Response
```

## Future Enhancements

### Planned Features

1. **Advanced Filtering**: Filter by fact categories, dates, confidence levels
2. **Search History**: Track and learn from user search patterns
3. **Fact Relationships**: Search based on fact relationships and connections
4. **Multi-language Support**: Support for multiple languages in search
5. **Search Analytics**: Detailed analytics on search performance and usage

### Potential Improvements

1. **Vector Search**: Implement vector embeddings for faster semantic search
2. **Fuzzy Matching**: Add fuzzy string matching for typos and variations
3. **Search Suggestions**: Provide search suggestions based on user history
4. **Fact Ranking**: Implement more sophisticated fact ranking algorithms

## Troubleshooting

### Common Issues

1. **No Results Found**
   - Check if facts exist in the database
   - Lower the minimum relevance threshold
   - Try different keywords or natural language

2. **Low Search Quality**
   - Verify fact data quality and confidence scores
   - Check semantic search API configuration
   - Review search parameters and thresholds

3. **Performance Issues**
   - Reduce maximum results limit
   - Disable semantic search for faster results
   - Check database performance and indexing

### Debug Commands

```javascript
// Enable debug logging
process.env.DEBUG = 'true';

// Test search functionality
node test-fact-search.js
```

## Conclusion

The fact search implementation provides a robust, scalable solution for retrieving relevant facts from the bot's knowledge base. By combining keyword and semantic search approaches, it ensures high-quality results while maintaining good performance. The system is designed to be user-friendly, developer-friendly, and easily extensible for future enhancements.
