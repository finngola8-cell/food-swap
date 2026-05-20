import { BaseAgent } from './base-agent.js';
import { askClaudeJson } from '../services/claude.js';
import supabase from '../services/supabase.js';

const SYSTEM_PROMPT = `You are a Listing Agent for an Etsy/Printify business.
You take product ideas and optimize them for Etsy search, then prepare them for publishing.
Always return valid JSON matching the exact schema requested.`;

export class ListingAgent extends BaseAgent {
  constructor() {
    super('listing-agent', 'Listing Agent', 'lister');
    this.intervalMs = 30 * 60 * 1000; // check for drafts every 30 minutes
  }

  async run() {
    while (this.running) {
      await this.processDraftListings();
      await new Promise((r) => setTimeout(r, this.intervalMs));
    }
  }

  async processDraftListings() {
    const { data: drafts } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'draft')
      .limit(3);

    if (!drafts?.length) return;

    await this.updateStatus('active', `Processing ${drafts.length} draft listings...`);

    for (const draft of drafts) {
      await this.optimizeAndPublish(draft);
    }

    await this.updateStatus('idle', null);
  }

  async optimizeAndPublish(listing) {
    await this.say(`Optimizing listing: "${listing.title}"`);

    const optimized = await askClaudeJson(
      SYSTEM_PROMPT,
      `Optimize this Etsy listing for maximum SEO and sales conversion:
      Title: ${listing.title}
      Description: ${listing.description}
      Tags: ${listing.tags?.join(', ')}
      Price: $${listing.suggested_price}

      Return JSON:
      {
        "optimized_title": "...",
        "optimized_description": "...",
        "optimized_tags": ["tag1",...],
        "final_price": 24.99,
        "shipping_profile": "standard",
        "quantity": 999
      }`
    );

    // Require human approval before spending (Printify publish costs money)
    const decision = await this.logDecision(
      `Publish listing to Etsy/Printify: "${optimized.optimized_title}" at $${optimized.final_price}`,
      true,
      { listing_id: listing.id, optimized }
    );

    await supabase
      .from('listings')
      .update({
        title: optimized.optimized_title,
        description: optimized.optimized_description,
        tags: optimized.optimized_tags,
        final_price: optimized.final_price,
        status: 'pending_approval',
        decision_id: decision?.id,
      })
      .eq('id', listing.id);

    await this.say(`Listing "${optimized.optimized_title}" is ready — awaiting human approval to publish`);
  }
}
