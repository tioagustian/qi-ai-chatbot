# Enhanced Response Determination with Gemini API

## Overview

The enhanced response determination system uses Google Gemini API to intelligently decide whether the bot should respond to incoming messages. This system provides more sophisticated analysis compared to the basic rule-based approach, especially for batch message processing.

## Features

### 🤖 AI-Powered Analysis
- Uses Gemini 2.0 Flash model for intelligent message analysis
- Considers message intent, context, and user behavior patterns
- Provides confidence scores for response decisions

### 📦 Batch Message Support
- Analyzes entire conversation batches as a single context
- Understands message flow and relationships within batches
- Determines optimal response timing for batched messages

### 🎯 Context-Aware Decision Making
- Considers chat type (private vs group)
- Analyzes message content, media attachments, and captions
- Evaluates user intent across multiple messages

## How It Works

### 1. Message Analysis
The system analyzes each message with the following context:
- Message content and type
- Media attachments (images, videos, audio, documents)
- Chat environment (private vs group)
- Tagging and bot name mentions
- Batch metadata (if part of a message batch)

### 2. AI Processing
The Gemini API receives a structured prompt containing:
```
CONTEXT:
- Message content: "user message"
- Message type: conversation/imageMessage/etc
- Has image: true/false
- Chat type: Group/Private
- Bot is tagged: true/false
- Bot name: "Qi AI"

BATCH CONTEXT (if applicable):
- This is message X of Y in a batch
- Is first/last message in batch
- All messages in batch with content
```

### 3. Response Rules
The AI follows these rules:
1. Always respond in private chats
2. Always respond if tagged (@botname)
3. Always respond if bot name is mentioned
4. For groups, respond to questions, requests, or commands
5. For batched messages:
   - Only respond to the last message (unless explicitly addressed earlier)
   - Consider entire conversation context
   - If first message is a question, respond to it
6. Respond to media with analysis requests
7. Don't respond to status updates or spam

### 4. Decision Output
The AI returns a JSON response:
```json
{
  "shouldRespond": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "analysis": {
    "messageIntent": "question/request/statement/command/other",
    "requiresResponse": true/false,
    "batchConsideration": "explanation if applicable",
    "contextRelevance": "how relevant to bot's capabilities",
    "batchContext": {
      "isPartOfBatch": true/false,
      "batchIntent": "overall intent of the batch",
      "shouldRespondToThisMessage": "why this specific message should/shouldn't get a response",
      "batchFlow": "how messages in batch relate to each other"
    }
  }
}
```

## Integration

### In Message Handler
The enhanced response determination is integrated into `src/handlers/messageHandler.js`:

```javascript
// Check if we need to respond to the message using enhanced AI-powered determination
let responseDetermination = await shouldRespondToMessageWithBatch(
  message, 
  content, 
  isTagged, 
  isGroup, 
  db.data.config.botName,
  message.batchMetadata,
  batchMessages
);

let shouldRespond = responseDetermination.shouldRespond;
```

### Batch Message Processing
For batched messages, the system:
1. Collects all messages in the batch
2. Adds batch metadata to each message
3. Processes each message with full batch context
4. Uses AI to determine optimal response timing

## Configuration

### Required Setup
1. **Gemini API Key**: Set `GEMINI_API_KEY` in environment variables
2. **Model Selection**: Uses `gemini-2.0-flash` by default
3. **Fallback Logic**: Automatically falls back to basic logic if API unavailable

### Environment Variables
```bash
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=google/gemini-2.0-flash
```

## Error Handling

### Fallback Mechanisms
1. **API Unavailable**: Falls back to basic rule-based logic
2. **Invalid Response**: Uses basic logic with error logging
3. **Low Confidence**: Logs warning but proceeds with AI decision

### Logging
The system provides detailed logging:
- `[RESPONSE-DET]` - General information
- `[RESPONSE-DET-DEBUG]` - Detailed analysis (when DEBUG=true)
- `[RESPONSE-DET-ERROR]` - Error conditions

## Testing

Run the test suite to verify functionality:
```bash
node test-enhanced-response-determination.js
```

The test covers:
- Private vs group chat scenarios
- Bot name mentions and tagging
- Question detection
- Batch message processing
- Image analysis requests
- Edge cases and error conditions

## Benefits

### 🎯 Improved Accuracy
- Better understanding of user intent
- Context-aware decision making
- Reduced false positives/negatives

### 📦 Enhanced Batch Processing
- Intelligent handling of message batches
- Optimal response timing
- Better conversation flow

### 🔄 Adaptive Learning
- AI can adapt to different conversation patterns
- Handles complex scenarios better than rule-based systems
- Provides confidence scores for transparency

### 🛡️ Robust Fallback
- Graceful degradation when AI is unavailable
- Maintains functionality even with API issues
- Comprehensive error handling

## Performance Considerations

### API Latency
- Average response time: 1-3 seconds
- Uses low temperature (0.1) for consistent results
- Optimized prompts for faster processing

### Rate Limiting
- Respects Gemini API rate limits
- Implements exponential backoff on errors
- Graceful fallback to basic logic

### Caching
- No caching implemented (real-time analysis)
- Each message analyzed independently
- Batch context provided fresh for each analysis

## Future Enhancements

### Planned Features
1. **Response Quality Scoring**: Rate response quality for learning
2. **User Preference Learning**: Adapt to individual user patterns
3. **Multi-Modal Analysis**: Better handling of images and media
4. **Conversation Memory**: Consider longer conversation history
5. **Custom Rules**: Allow users to define custom response rules

### Optimization Opportunities
1. **Batch Analysis**: Analyze entire batches at once
2. **Caching**: Cache similar message patterns
3. **Parallel Processing**: Analyze multiple messages concurrently
4. **Model Selection**: Choose optimal model based on message type
