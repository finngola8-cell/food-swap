import { EventEmitter } from 'events';
import supabase from './supabase.js';

class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.wsClients = new Set();
  }

  addWsClient(ws) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
  }

  broadcast(event, data) {
    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    for (const client of this.wsClients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  async sendMessage(fromAgent, toAgent, content, type = 'info') {
    const message = { from_agent: fromAgent, to_agent: toAgent, content, type };

    const { data } = await supabase.from('messages').insert(message).select().single();

    this.emit('message', data ?? message);
    this.broadcast('message', data ?? message);

    return data ?? message;
  }

  async logActivity(agentId, activity, metadata = {}) {
    const entry = { agent_id: agentId, activity, metadata };
    await supabase.from('activity_log').insert(entry);
    this.broadcast('activity', { agent_id: agentId, activity, metadata, timestamp: new Date().toISOString() });
  }
}

export const messageBus = new MessageBus();
