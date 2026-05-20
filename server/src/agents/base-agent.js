import supabase from '../services/supabase.js';
import { messageBus } from '../services/message-bus.js';

export class BaseAgent {
  constructor(id, name, role) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.running = false;
  }

  async updateStatus(status, currentTask = null) {
    await supabase
      .from('agents')
      .update({ status, current_task: currentTask, updated_at: new Date().toISOString() })
      .eq('id', this.id);

    messageBus.broadcast('agent_update', {
      id: this.id,
      name: this.name,
      status,
      current_task: currentTask,
    });
  }

  async logDecision(decision, requiresApproval = false, metadata = {}) {
    const { data } = await supabase
      .from('decisions')
      .insert({
        agent_id: this.id,
        agent_name: this.name,
        decision,
        requires_approval: requiresApproval,
        approved: requiresApproval ? null : true,
        metadata,
      })
      .select()
      .single();

    if (requiresApproval) {
      messageBus.broadcast('approval_needed', data);
    }

    return data;
  }

  async say(message, toAgent = null) {
    await messageBus.sendMessage(this.name, toAgent ?? 'broadcast', message);
    await messageBus.logActivity(this.id, message);
  }

  async waitForApproval(decisionId, timeoutMs = 300000) {
    return new Promise((resolve) => {
      const check = async () => {
        const { data } = await supabase
          .from('decisions')
          .select('approved')
          .eq('id', decisionId)
          .single();

        if (data?.approved !== null) return resolve(data.approved);
        if (Date.now() > start + timeoutMs) return resolve(false);
        setTimeout(check, 5000);
      };
      const start = Date.now();
      check();
    });
  }

  start() {
    this.running = true;
    this.updateStatus('active');
    this.run().catch((err) => {
      console.error(`[${this.name}] crashed:`, err.message);
      this.updateStatus('error', err.message);
    });
  }

  stop() {
    this.running = false;
    this.updateStatus('idle');
  }

  async run() {
    throw new Error(`${this.name}: run() not implemented`);
  }
}
