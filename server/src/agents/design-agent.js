import { BaseAgent } from './base-agent.js';
import { askClaudeJson } from '../services/claude.js';
import supabase from '../services/supabase.js';

const SYSTEM_PROMPT = `You are a Design Agent for an Etsy/Printify print-on-demand business.
Your job is to research trending niches and generate product ideas that will sell well.
Always return valid JSON matching the exact schema requested.`;

export class DesignAgent extends BaseAgent {
  constructor() {
    super('design-agent', 'Design Agent', 'designer');
    this.intervalMs = 6 * 60 * 60 * 1000; // run every 6 hours
  }

  async run() {
    while (this.running) {
      await this.generateProductIdeas();
      await new Promise((r) => setTimeout(r, this.intervalMs));
    }
  }

  async generateProductIdeas() {
    await this.updateStatus('active', 'Researching trending niches...');
    await this.say('Analyzing trending Etsy niches and generating new product ideas...');

    const ideas = await askClaudeJson(
      SYSTEM_PROMPT,
      `Generate 3 trending Etsy print-on-demand product ideas for ${new Date().toLocaleDateString()}.
      For each idea return:
      {
        "title": "listing title (max 140 chars, SEO optimized)",
        "niche": "niche category",
        "description": "product description (2-3 sentences)",
        "tags": ["tag1", "tag2", ... up to 13 tags],
        "suggested_price": 24.99,
        "printify_blueprint": "suggested product type (e.g. Unisex T-Shirt, Mug, Tote Bag)",
        "design_prompt": "detailed visual description for AI image generation"
      }
      Return as JSON array.`
    );

    for (const idea of ideas) {
      const { data: listing } = await supabase
        .from('listings')
        .insert({
          platform: 'etsy',
          title: idea.title,
          niche: idea.niche,
          description: idea.description,
          tags: idea.tags,
          suggested_price: idea.suggested_price,
          printify_blueprint: idea.printify_blueprint,
          design_prompt: idea.design_prompt,
          status: 'draft',
          created_by: this.id,
        })
        .select()
        .single();

      await this.say(`Created product idea: "${idea.title}" in the ${idea.niche} niche`);
      await this.logDecision(`Generated product idea: ${idea.title}`, false, { listing_id: listing?.id });
    }

    await this.updateStatus('idle', null);
    return ideas;
  }
}
