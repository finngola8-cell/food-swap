import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

import { messageBus } from './services/message-bus.js';
import agentsRouter from './routes/agents.js';
import decisionsRouter from './routes/decisions.js';
import dashboardRouter from './routes/dashboard.js';

import { DesignAgent } from './agents/design-agent.js';
import { ListingAgent } from './agents/listing-agent.js';
import { CustomerServiceAgent } from './agents/customer-service-agent.js';
import { MarketingAgent } from './agents/marketing-agent.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

app.use('/api/agents', agentsRouter);
app.use('/api/decisions', decisionsRouter);
app.use('/api/dashboard', dashboardRouter);

app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

wss.on('connection', (ws) => {
  messageBus.addWsClient(ws);
  ws.send(JSON.stringify({ event: 'connected', data: { message: 'AI Empire server connected' } }));
});

// Agent registry — shared with routes
export const agentRegistry = {
  'design-agent': new DesignAgent(),
  'listing-agent': new ListingAgent(),
  'customer-service-agent': new CustomerServiceAgent(),
  'marketing-agent': new MarketingAgent(),
};

const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => {
  console.log(`AI Empire server running on port ${PORT}`);
  console.log('Agents initialized and standing by.');
});
