'use strict';

const REQUIRED = [
  'PRINTIFY_API_KEY',
  'PRINTIFY_SHOP_ID',
  'ETSY_API_KEY',
  'ETSY_ACCESS_TOKEN',
  'ETSY_REFRESH_TOKEN',
  'ETSY_SHOP_ID',
  'ANTHROPIC_API_KEY',
];

const OPTIONAL_GROUPS = [
  {
    name: 'Image Generation (at least one required)',
    keys: ['FAL_API_KEY', 'REPLICATE_API_TOKEN'],
    requireAtLeastOne: true,
  },
  {
    name: 'Meta Ads (optional — Meta campaigns will be skipped if absent)',
    keys: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'],
    requireAtLeastOne: false,
  },
  {
    name: 'Pinterest (optional — Pinterest pins will be skipped if absent)',
    keys: ['PINTEREST_ACCESS_TOKEN', 'PINTEREST_BOARD_ID'],
    requireAtLeastOne: false,
  },
];

function validate() {
  const missing = [];
  const warnings = [];

  for (const key of REQUIRED) {
    if (!process.env[key]) missing.push(key);
  }

  for (const group of OPTIONAL_GROUPS) {
    const present = group.keys.filter((k) => process.env[k]);
    if (group.requireAtLeastOne && present.length === 0) {
      missing.push(`(one of: ${group.keys.join(', ')})`);
    } else if (!group.requireAtLeastOne && present.length > 0 && present.length < group.keys.length) {
      const absent = group.keys.filter((k) => !process.env[k]);
      warnings.push(`${group.name}: missing ${absent.join(', ')} — feature partially configured`);
    }
  }

  if (missing.length > 0) {
    console.error('\n❌  MISSING REQUIRED ENVIRONMENT VARIABLES:\n');
    for (const key of missing) console.error(`   • ${key}`);
    console.error('\nCopy .env.example to .env, fill in the values, then re-run.\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️   OPTIONAL ENV WARNINGS:');
    for (const w of warnings) console.warn(`   • ${w}`);
    console.warn('');
  }

  return {
    hasMetaAds: !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),
    hasPinterest: !!(process.env.PINTEREST_ACCESS_TOKEN && process.env.PINTEREST_BOARD_ID),
    imageProvider: process.env.FAL_API_KEY ? 'fal' : 'replicate',
  };
}

module.exports = { validate };
