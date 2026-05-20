import { BaseAgent } from './base-agent.js';
import { askClaudeJson } from '../services/claude.js';
import supabase from '../services/supabase.js';

const SYSTEM_PROMPT = `You are a Marketing Agent for an Etsy print-on-demand business.
You create compelling social media content that drives traffic to Etsy listings.
Focus on Pinterest (high buyer intent) and Instagram. Always return valid JSON.`;

export class MarketingAgent extends BaseAgent {
  constructor() {
    super('marketing-agent', 'Marketing Agent', 'marketer');
    this.intervalMs = 4 * 60 * 60 * 1000; // every 4 hours
  }

  async run() {
    while (this.running) {
      await this.createContent();
      await new Promise((r) => setTimeout(r, this.intervalMs));
    }
  }

  async createContent() {
    const { data: listings } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'published')
      .limit(5);

    if (!listings?.length) {
      await this.say('No published listings yet — waiting for listings to go live...');
      return;
    }

    await this.updateStatus('active', 'Creating social media content...');

    for (const listing of listings) {
      await this.createListingContent(listing);
    }

    await this.updateStatus('idle', null);
  }

  async createListingContent(listing) {
    await this.say(`Creating social content for: "${listing.title}"`);

    const content = await askClaudeJson(
      SYSTEM_PROMPT,
      `Create social media content for this Etsy listing:
      Title: ${listing.title}
      Description: ${listing.description}
      Price: $${listing.final_price ?? listing.suggested_price}
      Niche: ${listing.niche}

      Return JSON:
      {
        "pinterest_title": "...",
        "pinterest_description": "...",
        "pinterest_keywords": ["kw1", "kw2", ...],
        "instagram_caption": "...",
        "instagram_hashtags": ["#tag1", "#tag2", ...],
        "content_angle": "emotional angle used"
      }`
    );

    await supabase.from('social_content').insert({
      listing_id: listing.id,
      platform: 'pinterest',
      title: content.pinterest_title,
      content: content.pinterest_description,
      keywords: content.pinterest_keywords,
      status: 'ready',
      created_by: this.id,
    });

    await supabase.from('social_content').insert({
      listing_id: listing.id,
      platform: 'instagram',
      content: content.instagram_caption,
      hashtags: content.instagram_hashtags,
      status: 'ready',
      created_by: this.id,
    });

    await this.logDecision(`Created social content for listing "${listing.title}"`, false, {
      listing_id: listing.id,
      angle: content.content_angle,
    });

    await this.say(`Social content ready for "${listing.title}" — Pinterest + Instagram posts queued`);
  }
}
