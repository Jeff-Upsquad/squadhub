/** Social creators publish through their own individual or channel identity. */
export const CREATOR_ROLES = [{
  squad: 'marketing', slug: 'social-media-creator', serviceSlug: 'social_media_creator',
  formType: 'social_media_creator', id: 'ca148003-5800-4800-8800-000000000001',
  name: 'Social Media Creator', pipeline: 'Social Media Creators',
  description: 'Individuals and channels creating content on Instagram, Facebook, TikTok, YouTube and other social platforms.',
  detailKey: 'creator_results', detailLabel: 'Channels, audience and content results',
  detailHint: 'Share your channel links, niche, audience locations, follower counts, average views and engagement, with the date measured.',
  categories: ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn', 'X / Twitter', 'Other'],
  skills: ['Short-form video', 'Long-form video', 'Storytelling', 'Product reviews', 'Live streaming', 'Photography', 'UGC', 'Brand collaborations'],
  tools: ['CapCut', 'Canva', 'Adobe Premiere Pro', 'DaVinci Resolve', 'YouTube Studio', 'Meta Business Suite'],
  aiTools: ['ChatGPT', 'Claude', 'CapCut AI'],
  objectives: ['Brand awareness', 'Audience engagement', 'Product launch', 'Conversions', 'Content production'],
  briefHint: 'Describe your brand, campaign, target audience, creator niche, platforms and content deliverables.',
  scopeLabel: 'Publishing platforms',
  briefFields: [
    { key: 'creator_audience', label: 'Creator niche, audience locations and desired reach', required: true },
    { key: 'deliverables', label: 'Content formats, quantities and publishing schedule', required: true },
    { key: 'usage_rights', label: 'Usage rights, paid ads, exclusivity and approval requirements', required: true },
    { key: 'campaign_logistics', label: 'Product delivery, travel and reporting requirements', required: false },
  ],
  portfolio: false,
}] as const;

export interface CreatorIdentity {
  signup_form_type?: string | null;
  signup_categories?: readonly string[] | null;
}

/** Persisted signup categories determine creator exemptions, including mixed-role signups. */
export function isSocialMediaCreator(talent: CreatorIdentity | null | undefined): boolean {
  return talent?.signup_form_type === 'social_media_creator'
    || talent?.signup_categories?.includes('social-media-creator') === true;
}
