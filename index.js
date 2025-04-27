import 'dotenv/config';
import { startBot } from './src/bot.js';
import { setupDatabase } from './src/database/index.js';

async function main() {
  // Initialize database
  await setupDatabase();
  
  // Start WhatsApp bot
  await startBot();
  
  console.log('Bot is running...');
}

// Handle errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});

// Start the application
main().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
}); 