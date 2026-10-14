// SYNCED COPY — keep identical in Profiles, SquadHub (squadhub) and SquadCRM
// (squadcrm) at shared/src/contentRoles.ts. Each repo has a content-roles
// sync test pinning this file's SHA-256: change all three copies together and
// update the hash in all three tests.
/** Content Squad vocabulary shared by onboarding, profiles and business briefs.
 * Category UUIDs are stable soft references used by SquadHub's catalog. */
export const CONTENT_ROLES = [
  {
    slug: 'creative-director', serviceSlug: 'creative_director', formType: 'creative_director',
    id: 'ca148001-5800-4800-8800-000000000001', name: 'Creative Director', pipeline: 'Creative Directors',
    description: 'Creative strategy, brand direction, campaign concepts and production leadership.',
    detailKey: 'creative_leadership', detailLabel: 'Creative leadership and results',
    detailHint: 'Describe your creative process, team leadership, campaign scope and measurable results.',
    categories: ['Brand strategy', 'Campaign concepts', 'Art direction', 'Content strategy', 'Video direction', 'Creative production', 'Brand guidelines', 'Creative audits'],
    skills: ['Creative strategy', 'Concept development', 'Art direction', 'Storytelling', 'Team leadership', 'Production planning', 'Client presentation', 'Creative quality control'],
    tools: ['Figma', 'Adobe Creative Cloud', 'Miro', 'Notion', 'Google Slides', 'Frame.io'],
    aiTools: ['ChatGPT', 'Claude', 'Midjourney', 'Adobe Firefly'],
    objectives: ['Brand consistency', 'Campaign launch', 'Creative quality', 'Content strategy', 'Production efficiency'],
    briefHint: 'Describe the brand challenge, campaign, creative team, deliverables and approval responsibilities.',
    scopeLabel: 'Creative scope',
    briefFields: [
      { key: 'creative_team', label: 'Creative team and responsibilities', required: false },
      { key: 'approval_owner', label: 'Approval process and stakeholders', required: false },
    ],

  },
  {
    slug: 'copy-content-writer', serviceSlug: 'copy_content_writer', formType: 'copy_content_writer',
    id: 'ca148001-5800-4800-8800-000000000002', name: 'Copy / Content Writer', pipeline: 'Copy and Content Writers',
    description: 'Brand copy, articles, scripts, email campaigns and search-focused content.',
    detailKey: 'writing_approach', detailLabel: 'Writing approach and subject expertise',
    detailHint: 'Describe your research, tone of voice, subject expertise and how you measure content performance.',
    categories: ['Website copy', 'Blog articles', 'SEO content', 'Ad copy', 'Email campaigns', 'Social captions', 'Video scripts', 'Brand messaging'],
    skills: ['Copywriting', 'Content research', 'SEO writing', 'Editing and proofreading', 'Brand voice', 'Scriptwriting', 'Conversion writing', 'Fact checking'],
    tools: ['Google Docs', 'Microsoft Word', 'Grammarly', 'WordPress', 'Semrush', 'Ahrefs', 'Notion'],
    aiTools: ['ChatGPT', 'Claude', 'Jasper', 'Perplexity'],
    objectives: ['Brand messaging', 'Organic traffic', 'Conversions', 'Thought leadership', 'Content consistency'],
    briefHint: 'Describe the audience, topics, tone, formats, content volume, research needs and review process.',
    scopeLabel: 'Content formats',
    briefFields: [
      { key: 'content_volume', label: 'Content volume and lengths', required: true },
      { key: 'brand_voice', label: 'Tone of voice and reference content', required: false },
    ],

  },
  {
    slug: 'social-media-manager', serviceSlug: 'social_media_manager', formType: 'social_media_manager',
    id: 'ca148001-5800-4800-8800-000000000003', name: 'Social Media Manager', pipeline: 'Social Media Managers',
    description: 'Social strategy, publishing, community management and organic audience growth.',
    detailKey: 'account_results', detailLabel: 'Accounts managed and growth results',
    detailHint: 'Describe platforms, account sizes, engagement improvements, community work and reporting.',
    categories: ['Instagram', 'Facebook', 'LinkedIn', 'YouTube', 'TikTok', 'X / Twitter', 'Pinterest', 'Community management'],
    skills: ['Social strategy', 'Content calendars', 'Community management', 'Social copywriting', 'Social analytics', 'Audience growth', 'Influencer coordination', 'Crisis response'],
    tools: ['Meta Business Suite', 'Buffer', 'Hootsuite', 'Later', 'Sprout Social', 'Canva', 'Google Analytics'],
    aiTools: ['ChatGPT', 'Claude', 'Canva Magic Studio', 'CapCut AI'],
    objectives: ['Audience growth', 'Engagement', 'Community building', 'Brand awareness', 'Inbound enquiries'],
    briefHint: 'Describe the accounts, current audience, publishing volume, community coverage and growth targets.',
    scopeLabel: 'Platforms and services',
    briefFields: [
      { key: 'social_accounts', label: 'Account handles and current audience', required: true },
      { key: 'publishing_volume', label: 'Publishing volume and community coverage', required: true },
    ],

  },
  {
    slug: 'videographer-photographer', serviceSlug: 'videographer_photographer', formType: 'videographer_photographer',
    id: 'ca148001-5800-4800-8800-000000000004', name: 'Videographer / Photographer', pipeline: 'Videographers and Photographers',
    description: 'Brand, product, event and location photography and video production.',
    detailKey: 'equipment_and_travel', detailLabel: 'Equipment, production setup and travel',
    detailHint: 'List camera, audio, lighting and crew capabilities, your shooting locations and travel availability.',
    categories: ['Product photography', 'Brand films', 'Events', 'Portraits', 'Food photography', 'Real estate', 'Interviews', 'Social video shoots'],
    skills: ['Camera operation', 'Lighting', 'Composition', 'Audio recording', 'Shot planning', 'On-set direction', 'Photo retouching', 'Production coordination'],
    tools: ['Adobe Lightroom', 'Adobe Photoshop', 'DaVinci Resolve', 'Adobe Premiere Pro', 'Capture One', 'Frame.io'],
    aiTools: ['Adobe Firefly', 'Photoshop Generative Fill', 'Topaz Photo AI', 'Runway'],
    objectives: ['Product launch', 'Brand storytelling', 'Event coverage', 'Content library', 'Social content'],
    briefHint: 'Describe shoot location, dates, number of sessions, shot list, crew/equipment needs and final deliverables.',
    scopeLabel: 'Shoot types',
    briefFields: [
      { key: 'shoot_location', label: 'Shoot location and travel requirements', required: true },
      { key: 'shoot_dates', label: 'Shoot dates and number of sessions', required: true },
      { key: 'deliverables', label: 'Shot list and final deliverables', required: true },
      { key: 'usage_rights', label: 'Intended usage and asset rights', required: false },
    ],

  },
  {
    slug: 'ai-video-image-creator', serviceSlug: 'ai_video_image_creator', formType: 'ai_video_image_creator',
    id: 'ca148001-5800-4800-8800-000000000005', name: 'AI Video / Image Creator', pipeline: 'AI Video and Image Creators',
    description: 'AI-assisted visual concepts, images and video with consistent creative finishing.',
    detailKey: 'ai_workflow', detailLabel: 'AI workflow and creative finishing',
    detailHint: 'Explain generation tools, prompting, character/style consistency, editing and your commercial-use checks.',
    categories: ['AI product images', 'AI brand visuals', 'AI video ads', 'AI short films', 'Storyboards', 'Character design', 'Image enhancement', 'Visual concepts'],
    skills: ['Prompt design', 'Image generation', 'Video generation', 'Style consistency', 'Character consistency', 'Compositing', 'Upscaling', 'Creative quality control'],
    tools: ['Adobe Photoshop', 'Adobe Premiere Pro', 'DaVinci Resolve', 'ComfyUI', 'Canva', 'After Effects'],
    aiTools: ['Midjourney', 'Runway', 'Kling', 'Adobe Firefly', 'Stable Diffusion', 'Sora', 'Veo'],
    objectives: ['Creative prototyping', 'Ad variants', 'Production speed', 'Visual consistency', 'Content scale'],
    briefHint: 'Describe image/video quantities, reference style, aspect ratios, consistency needs, source assets and intended usage.',
    scopeLabel: 'Visual formats',
    briefFields: [
      { key: 'output_specs', label: 'Quantities, durations and aspect ratios', required: true },
      { key: 'reference_style', label: 'Reference style and consistency needs', required: false },
      { key: 'usage_rights', label: 'Intended usage and source asset rights', required: false },
    ],

  },
] as const;

export type ContentRole = typeof CONTENT_ROLES[number];
export type ContentFormType = ContentRole['formType'];
export type ContentServiceSlug = ContentRole['serviceSlug'];

export const TALENT_CATEGORY_OPTIONS = [
  { value: 'creative', label: 'Designer / Editor', slugs: ['designer', 'video-editor', 'designer-editor'] },
  ...CONTENT_ROLES.map((r) => ({ value: r.formType, label: r.name, slugs: [r.slug] })),
  { value: 'ads_specialist', label: 'Ads Specialist', slugs: ['ads-specialist'] },
  { value: 'accountant', label: 'Accountant', slugs: ['accountant'] },
  { value: 'sales', label: 'Sales', slugs: ['sales'] },
] as const;

export const PORTFOLIO_FORM_TYPES: readonly string[] = ['creative', 'ads_specialist', ...CONTENT_ROLES.map((r) => r.formType)];
export const MIN_PORTFOLIO_ITEMS: Record<string, number> = {
  designer: 10, 'video-editor': 10,
  ...Object.fromEntries(CONTENT_ROLES.map((r) => [r.slug, 3])),
};
