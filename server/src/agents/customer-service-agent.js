import { BaseAgent } from './base-agent.js';
import { askClaude } from '../services/claude.js';
import supabase from '../services/supabase.js';

const SYSTEM_PROMPT = `You are a friendly, professional Customer Service Agent for an Etsy shop.
You respond to customer messages warmly, solve problems efficiently, and protect the shop's reputation.
Keep responses concise (under 150 words), empathetic, and solution-focused.
Rules:
- Approve refunds for orders under $30 automatically
- For refunds over $30, escalate to human
- Never make promises about custom orders without human approval
- Always end with a warm sign-off`;

export class CustomerServiceAgent extends BaseAgent {
  constructor() {
    super('customer-service-agent', 'Customer Service Agent', 'support');
    this.intervalMs = 15 * 60 * 1000; // check every 15 minutes
  }

  async run() {
    while (this.running) {
      await this.checkMessages();
      await new Promise((r) => setTimeout(r, this.intervalMs));
    }
  }

  async checkMessages() {
    const { data: unhandled } = await supabase
      .from('customer_messages')
      .select('*')
      .eq('status', 'unhandled')
      .limit(10);

    if (!unhandled?.length) return;

    await this.updateStatus('active', `Handling ${unhandled.length} customer messages...`);

    for (const msg of unhandled) {
      await this.handleMessage(msg);
    }

    await this.updateStatus('idle', null);
  }

  async handleMessage(msg) {
    await this.say(`Responding to customer message: "${msg.subject ?? msg.content.slice(0, 50)}..."`);

    const isRefund = /refund|return|cancel/i.test(msg.content);
    const isHighValue = msg.order_amount > 30;

    if (isRefund && isHighValue) {
      await this.logDecision(
        `High-value refund request from customer ${msg.customer_name} — order $${msg.order_amount}`,
        true,
        { message_id: msg.id, customer: msg.customer_name, amount: msg.order_amount }
      );
      await this.say(`Escalated high-value refund to human review: $${msg.order_amount}`);
      await supabase.from('customer_messages').update({ status: 'escalated' }).eq('id', msg.id);
      return;
    }

    const response = await askClaude(
      SYSTEM_PROMPT,
      `Customer message:\n${msg.content}\n\nOrder details: ${JSON.stringify(msg.order_details ?? {})}`
    );

    await supabase.from('customer_messages').update({
      status: 'handled',
      agent_response: response,
      handled_at: new Date().toISOString(),
    }).eq('id', msg.id);

    await this.logDecision(`Responded to customer ${msg.customer_name}`, false, { message_id: msg.id });
    await this.say(`Sent response to ${msg.customer_name}`);
  }
}
