import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './api/api';
import { client, addLog } from './bot/bot';

import { initDbConnection, getDb } from './utils/db';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

async function bootstrap() {
  // 1. Initialize Database (MongoDB Atlas / local file fallback)
  await initDbConnection();

  const db = getDb();
  const activeToken = db.credentials?.discordToken || process.env.DISCORD_TOKEN;

  // 2. Start Express Server
  app.listen(PORT, () => {
    addLog(`Dashboard API Server running on port ${PORT}`, 'info');
  });

  // 3. Login Discord Bot
  if (!activeToken) {
    addLog('No Discord Bot Token found in database or .env. Bot will not start!', 'error');
  } else {
    client.login(activeToken).catch((err) => {
      addLog(`Failed to login Discord Bot: ${err.message}`, 'error');
    });
  }
}

bootstrap();
