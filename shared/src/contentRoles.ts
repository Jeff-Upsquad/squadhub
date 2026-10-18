// SYNCED COPY — keep identical in Profiles, SquadHub (squadhub) and SquadCRM
// (squadcrm), plus SquadHire CRM, at shared/src/contentRoles.ts. Each repo has a content-roles
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
    slug: 'videographer', serviceSlug: 'videographer', formType: 'videographer',
    id: 'ca148001-5800-4800-8800-000000000004', name: 'Videographer', pipeline: 'Videographers and Photographers',
    description: 'Brand films, product videos, event coverage and commercial video production.',
    detailKey: 'equipment_and_travel', detailLabel: 'Equipment, production setup and travel',
    detailHint: 'List camera, audio, lighting and crew capabilities, your shooting locations and travel availability.',
    categories: ['Brand films', 'Product videos', 'Events', 'Interviews', 'Social video shoots', 'Commercials', 'Documentaries', 'Music videos'],
    skills: ['Camera operation', 'Lighting', 'Composition', 'Audio recording', 'Shot planning', 'On-set direction', 'Color grading', 'Production coordination'],
    tools: ['DaVinci Resolve', 'Adobe Premiere Pro', 'Final Cut Pro', 'Frame.io', 'After Effects'],
    aiTools: ['Runway', 'Topaz Video AI', 'Adobe Firefly', 'Kling'],
    objectives: ['Brand storytelling', 'Product launch', 'Event coverage', 'Social content', 'Content library'],
    briefHint: 'Describe shoot location, dates, number of sessions, shot list, crew/equipment needs and final deliverables.',
    scopeLabel: 'Video shoot types',
    briefFields: [
      { key: 'shoot_location', label: 'Shoot location and travel requirements', required: true },
      { key: 'shoot_dates', label: 'Shoot dates and number of sessions', required: true },
      { key: 'deliverables', label: 'Shot list and final deliverables', required: true },
      { key: 'usage_rights', label: 'Intended usage and asset rights', required: false },
    ],

  },
  {
    slug: 'photographer', serviceSlug: 'photographer', formType: 'photographer',
    id: 'ca148001-5800-4800-8800-000000000006', name: 'Photographer', pipeline: 'Videographers and Photographers',
    description: 'Brand, product, event, portrait and commercial photography.',
    detailKey: 'equipment_and_travel', detailLabel: 'Equipment, production setup and travel',
    detailHint: 'List camera, lenses, lighting and studio capabilities, your shooting locations and travel availability.',
    categories: ['Product photography', 'Portraits', 'Events', 'Food photography', 'Real estate', 'Fashion photography', 'Editorial', 'Architecture'],
    skills: ['Camera operation', 'Studio lighting', 'Natural lighting', 'Composition', 'Photo retouching', 'Color correction', 'On-set direction', 'Location scouting'],
    tools: ['Adobe Lightroom', 'Adobe Photoshop', 'Capture One'],
    aiTools: ['Adobe Firefly', 'Photoshop Generative Fill', 'Topaz Photo AI', 'Midjourney'],
    objectives: ['Product launch', 'Brand visuals', 'Event coverage', 'Content library', 'Editorial'],
    briefHint: 'Describe shoot location, dates, number of sessions, shot list, equipment/studio needs and final deliverables.',
    scopeLabel: 'Photography types',
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

/** Additional squad roles from the UpSquad website catalog. Stable IDs link
 * profiles, subscriptions and assignments across the product boundary. */
export const REMAINING_ROLES = [
  {
    "squad": "marketing",
    "slug": "seo-specialist",
    "serviceSlug": "seo_specialist",
    "formType": "seo_specialist",
    "id": "ca148002-5800-4800-8800-000000000001",
    "name": "SEO Specialist",
    "pipeline": "SEO Specialists",
    "description": "Explain your SEO audit process, search markets and organic growth results.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Explain your SEO audit process, search markets and organic growth results. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Technical SEO",
      "On-page SEO",
      "Local SEO",
      "E-commerce SEO",
      "Content SEO",
      "SEO audits"
    ],
    "skills": [
      "Keyword research",
      "Technical audits",
      "Search analytics",
      "Link strategy",
      "Content optimization"
    ],
    "tools": [
      "Google Search Console",
      "Google Analytics",
      "Semrush",
      "Ahrefs",
      "Screaming Frog"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Technical SEO",
      "On-page SEO",
      "Local SEO",
      "E-commerce SEO"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "website",
        "label": "Website and target markets",
        "required": true
      },
      {
        "key": "seo_goals",
        "label": "Search goals and current performance",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "marketing",
    "slug": "digital-marketing-team",
    "serviceSlug": "digital_marketing_team",
    "formType": "digital_marketing_team",
    "id": "ca148002-5800-4800-8800-000000000002",
    "name": "Digital Marketing Team",
    "pipeline": "Digital Marketing Teams",
    "description": "Describe channel expertise, team responsibilities and campaign outcomes.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe channel expertise, team responsibilities and campaign outcomes. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Marketing strategy",
      "Campaign management",
      "Email marketing",
      "Conversion optimization",
      "Analytics",
      "Growth marketing"
    ],
    "skills": [
      "Channel strategy",
      "Campaign planning",
      "Attribution",
      "Reporting",
      "Conversion optimization"
    ],
    "tools": [
      "Google Analytics",
      "HubSpot",
      "Mailchimp",
      "Meta Business Suite",
      "Looker Studio"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Marketing strategy",
      "Campaign management",
      "Email marketing",
      "Conversion optimization"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "channels",
        "label": "Channels and current marketing setup",
        "required": true
      },
      {
        "key": "growth_goals",
        "label": "Growth goals and team scope",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "marketing",
    "slug": "influencer-marketing",
    "serviceSlug": "influencer_marketing",
    "formType": "influencer_marketing",
    "id": "ca148002-5800-4800-8800-000000000003",
    "name": "Influencer Marketing Expert",
    "pipeline": "Influencer Marketing Experts",
    "description": "Describe creator selection, campaign coordination and measurable results.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe creator selection, campaign coordination and measurable results. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Creator sourcing",
      "Campaign strategy",
      "Creator partnerships",
      "UGC campaigns",
      "Campaign reporting"
    ],
    "skills": [
      "Creator evaluation",
      "Negotiation",
      "Briefing",
      "Campaign measurement",
      "Relationship management"
    ],
    "tools": [
      "Instagram",
      "YouTube",
      "TikTok",
      "Modash",
      "Google Sheets"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Creator sourcing",
      "Campaign strategy",
      "Creator partnerships",
      "UGC campaigns"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "audience",
        "label": "Target audience and markets",
        "required": true
      },
      {
        "key": "creator_scope",
        "label": "Creator criteria, deliverables and usage rights",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "marketing",
    "slug": "offline-marketing",
    "serviceSlug": "offline_marketing",
    "formType": "offline_marketing",
    "id": "ca148002-5800-4800-8800-000000000004",
    "name": "Offline Marketing Specialist",
    "pipeline": "Offline Marketing Specialists",
    "description": "Describe on-ground campaigns, locations served and execution capacity.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe on-ground campaigns, locations served and execution capacity. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Brand activations",
      "Events",
      "Retail marketing",
      "Outdoor advertising",
      "Local promotions"
    ],
    "skills": [
      "Activation planning",
      "Vendor coordination",
      "Event execution",
      "Lead capture",
      "Budget management"
    ],
    "tools": [
      "Google Sheets",
      "Canva",
      "Trello",
      "Google Maps"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Brand activations",
      "Events",
      "Retail marketing",
      "Outdoor advertising"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "locations",
        "label": "Campaign locations and dates",
        "required": true
      },
      {
        "key": "activation_scope",
        "label": "Activation scope and expected reach",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "tech",
    "slug": "web-development",
    "serviceSlug": "web_development",
    "formType": "web_development",
    "id": "ca148002-5800-4800-8800-000000000005",
    "name": "Web Developer",
    "pipeline": "Web Developers",
    "description": "Describe your stack, delivery process, testing and deployed projects.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe your stack, delivery process, testing and deployed projects. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Business websites",
      "E-commerce",
      "Web applications",
      "CMS development",
      "Website maintenance"
    ],
    "skills": [
      "Frontend development",
      "Backend development",
      "Accessibility",
      "API integration",
      "Testing",
      "Performance"
    ],
    "tools": [
      "React",
      "Next.js",
      "WordPress",
      "Shopify",
      "Node.js",
      "Git",
      "PostgreSQL"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Business websites",
      "E-commerce",
      "Web applications",
      "CMS development"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "technical_scope",
        "label": "Features, integrations and existing website",
        "required": true
      },
      {
        "key": "delivery_requirements",
        "label": "Hosting, handover and acceptance requirements",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "tech",
    "slug": "app-building",
    "serviceSlug": "app_building",
    "formType": "app_building",
    "id": "ca148002-5800-4800-8800-000000000006",
    "name": "App Developer",
    "pipeline": "App Developers",
    "description": "Describe platforms, architecture, app releases and maintenance experience.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe platforms, architecture, app releases and maintenance experience. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Android apps",
      "iOS apps",
      "Cross-platform apps",
      "App maintenance",
      "App integrations"
    ],
    "skills": [
      "Mobile architecture",
      "API integration",
      "UI implementation",
      "Testing",
      "App publishing"
    ],
    "tools": [
      "Flutter",
      "React Native",
      "Android Studio",
      "Xcode",
      "Firebase",
      "Git"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Android apps",
      "iOS apps",
      "Cross-platform apps",
      "App maintenance"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "platforms",
        "label": "Platforms, users and core features",
        "required": true
      },
      {
        "key": "integrations",
        "label": "Integrations and release requirements",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "tech",
    "slug": "automation",
    "serviceSlug": "automation",
    "formType": "automation",
    "id": "ca148002-5800-4800-8800-000000000007",
    "name": "Automation Specialist",
    "pipeline": "Automation Specialists",
    "description": "Describe workflows automated, systems connected and reliability controls.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe workflows automated, systems connected and reliability controls. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Workflow automation",
      "CRM automation",
      "Data synchronization",
      "Reporting automation",
      "AI workflows"
    ],
    "skills": [
      "Process mapping",
      "API integration",
      "Error handling",
      "Workflow testing",
      "Documentation"
    ],
    "tools": [
      "n8n",
      "Zapier",
      "Make",
      "Python",
      "HubSpot",
      "Google Apps Script"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Workflow automation",
      "CRM automation",
      "Data synchronization",
      "Reporting automation"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "current_workflow",
        "label": "Current workflow and connected systems",
        "required": true
      },
      {
        "key": "automation_goals",
        "label": "Triggers, outputs and success criteria",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "tech",
    "slug": "software-solutions",
    "serviceSlug": "software_solutions",
    "formType": "software_solutions",
    "id": "ca148002-5800-4800-8800-000000000008",
    "name": "Software Developer",
    "pipeline": "Software Developers",
    "description": "Describe software architecture, integrations and production support experience.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe software architecture, integrations and production support experience. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Custom software",
      "Internal tools",
      "SaaS products",
      "System integrations",
      "Software maintenance"
    ],
    "skills": [
      "Architecture",
      "Database design",
      "Backend development",
      "Security",
      "Testing",
      "Deployment"
    ],
    "tools": [
      "Python",
      "Node.js",
      "TypeScript",
      "PostgreSQL",
      "Docker",
      "Git"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Custom software",
      "Internal tools",
      "SaaS products",
      "System integrations"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "software_scope",
        "label": "Users, workflows and required features",
        "required": true
      },
      {
        "key": "technical_constraints",
        "label": "Existing systems, security and acceptance requirements",
        "required": true
      }
    ],
    "portfolio": true
  },
  {
    "squad": "accounts-finance",
    "slug": "cfo-ca",
    "serviceSlug": "cfo_ca",
    "formType": "cfo_ca",
    "id": "ca148002-5800-4800-8800-000000000009",
    "name": "CFO / Chartered Accountant",
    "pipeline": "CFOs and Chartered Accountants",
    "description": "Describe qualifications, professional registrations where applicable, finance responsibilities and outcomes.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe qualifications, professional registrations where applicable, finance responsibilities and outcomes. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Financial planning",
      "Management reporting",
      "Cash flow",
      "Budgeting",
      "Audit support",
      "Financial advisory"
    ],
    "skills": [
      "Financial analysis",
      "Forecasting",
      "Financial controls",
      "Management reporting",
      "Risk assessment"
    ],
    "tools": [
      "Excel",
      "Google Sheets",
      "Tally Prime",
      "Zoho Books",
      "QuickBooks"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Financial planning",
      "Management reporting",
      "Cash flow",
      "Budgeting"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "finance_scope",
        "label": "Financial scope, reporting and business stage",
        "required": true
      },
      {
        "key": "reporting_period",
        "label": "Reporting periods and existing accounting systems",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "accounts-finance",
    "slug": "gst-experts",
    "serviceSlug": "gst_experts",
    "formType": "gst_experts",
    "id": "ca148002-5800-4800-8800-000000000010",
    "name": "GST Expert",
    "pipeline": "GST Experts",
    "description": "Describe qualifications, GST work experience, reconciliations and filing process.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe qualifications, GST work experience, reconciliations and filing process. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "GST returns",
      "GST reconciliation",
      "GST registration",
      "GST advisory",
      "Notice support"
    ],
    "skills": [
      "Return preparation",
      "Input tax reconciliation",
      "Documentation",
      "Tax research",
      "Compliance tracking"
    ],
    "tools": [
      "GST Portal",
      "Tally Prime",
      "Excel",
      "Zoho Books"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "GST returns",
      "GST reconciliation",
      "GST registration",
      "GST advisory"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "gst_scope",
        "label": "GST scope, registrations and transaction volume",
        "required": true
      },
      {
        "key": "tax_periods",
        "label": "Periods, deadlines and existing records",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "accounts-finance",
    "slug": "tds-experts",
    "serviceSlug": "tds_experts",
    "formType": "tds_experts",
    "id": "ca148002-5800-4800-8800-000000000011",
    "name": "TDS Expert",
    "pipeline": "TDS Experts",
    "description": "Describe TDS work, reconciliation process and qualifications.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe TDS work, reconciliation process and qualifications. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "TDS calculations",
      "TDS returns",
      "Challan reconciliation",
      "Certificates",
      "Correction returns"
    ],
    "skills": [
      "Deduction review",
      "Return preparation",
      "Reconciliation",
      "Documentation",
      "Compliance tracking"
    ],
    "tools": [
      "TRACES",
      "Income Tax Portal",
      "Excel",
      "Tally Prime"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "TDS calculations",
      "TDS returns",
      "Challan reconciliation",
      "Certificates"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "tds_scope",
        "label": "Deduction categories, deductors and transaction volume",
        "required": true
      },
      {
        "key": "tax_periods",
        "label": "Periods, deadlines and existing records",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "accounts-finance",
    "slug": "labour-law",
    "serviceSlug": "labour_law",
    "formType": "labour_law",
    "id": "ca148002-5800-4800-8800-000000000012",
    "name": "Labour Law Expert",
    "pipeline": "Labour Law Experts",
    "description": "Describe qualifications, jurisdictions served and employment compliance experience.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe qualifications, jurisdictions served and employment compliance experience. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Payroll compliance",
      "Employment compliance",
      "Statutory records",
      "HR compliance audits",
      "Registration support"
    ],
    "skills": [
      "Compliance review",
      "Payroll reconciliation",
      "Documentation",
      "Policy review",
      "Deadline management"
    ],
    "tools": [
      "EPFO Portal",
      "ESIC Portal",
      "Excel",
      "HRMS"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Payroll compliance",
      "Employment compliance",
      "Statutory records",
      "HR compliance audits"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "jurisdiction",
        "label": "Jurisdictions and workforce locations",
        "required": true
      },
      {
        "key": "workforce_scope",
        "label": "Headcount, payroll setup and compliance scope",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "accounts-finance",
    "slug": "incorporation",
    "serviceSlug": "incorporation",
    "formType": "incorporation",
    "id": "ca148002-5800-4800-8800-000000000013",
    "name": "Incorporation & Licensing Specialist",
    "pipeline": "Incorporation and Licensing Specialists",
    "description": "Describe qualifications, entity types, jurisdictions and registration experience.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe qualifications, entity types, jurisdictions and registration experience. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Company registration",
      "Business licenses",
      "Entity changes",
      "Registration documentation",
      "Annual compliance"
    ],
    "skills": [
      "Entity documentation",
      "Application coordination",
      "Compliance tracking",
      "Record management"
    ],
    "tools": [
      "MCA Portal",
      "Excel",
      "Google Workspace",
      "Document management"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Company registration",
      "Business licenses",
      "Entity changes",
      "Registration documentation"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "entity_scope",
        "label": "Entity type and registration or license scope",
        "required": true
      },
      {
        "key": "jurisdiction",
        "label": "Jurisdiction and business activities",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "legal",
    "slug": "contract-drafting",
    "serviceSlug": "contract_drafting",
    "formType": "contract_drafting",
    "id": "ca148002-5800-4800-8800-000000000014",
    "name": "Contract Drafting Specialist",
    "pipeline": "Contract Drafting Specialists",
    "description": "Describe legal qualifications, registrations, jurisdictions and contract experience.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe legal qualifications, registrations, jurisdictions and contract experience. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Commercial contracts",
      "Employment agreements",
      "NDAs",
      "Vendor agreements",
      "Contract review"
    ],
    "skills": [
      "Legal drafting",
      "Contract review",
      "Risk analysis",
      "Negotiation support",
      "Legal research"
    ],
    "tools": [
      "Microsoft Word",
      "Google Docs",
      "DocuSign",
      "Adobe Acrobat"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Commercial contracts",
      "Employment agreements",
      "NDAs",
      "Vendor agreements"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "contract_scope",
        "label": "Agreement types, parties and drafting or review scope",
        "required": true
      },
      {
        "key": "jurisdiction",
        "label": "Governing jurisdiction and deadlines",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "legal",
    "slug": "ip-protection",
    "serviceSlug": "ip_protection",
    "formType": "ip_protection",
    "id": "ca148002-5800-4800-8800-000000000015",
    "name": "IP Protection Specialist",
    "pipeline": "IP Protection Specialists",
    "description": "Describe legal qualifications, jurisdictions, IP types and experience.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe legal qualifications, jurisdictions, IP types and experience. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Trademarks",
      "Copyrights",
      "IP documentation",
      "IP portfolio review",
      "Licensing support"
    ],
    "skills": [
      "IP research",
      "Application support",
      "Documentation",
      "Brand clearance",
      "Rights management"
    ],
    "tools": [
      "IP India Portal",
      "WIPO tools",
      "Microsoft Word",
      "Excel"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Trademarks",
      "Copyrights",
      "IP documentation",
      "IP portfolio review"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "ip_scope",
        "label": "IP types, ownership and protection scope",
        "required": true
      },
      {
        "key": "jurisdiction",
        "label": "Jurisdictions and filing deadlines",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "legal",
    "slug": "compliance",
    "serviceSlug": "compliance",
    "formType": "compliance",
    "id": "ca148002-5800-4800-8800-000000000016",
    "name": "Compliance Specialist",
    "pipeline": "Compliance Specialists",
    "description": "Describe qualifications, industries, jurisdictions and compliance review experience.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe qualifications, industries, jurisdictions and compliance review experience. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Regulatory review",
      "Compliance audits",
      "Policy documentation",
      "Compliance calendars",
      "Governance support"
    ],
    "skills": [
      "Regulatory research",
      "Risk assessment",
      "Policy drafting",
      "Audit documentation",
      "Compliance monitoring"
    ],
    "tools": [
      "Excel",
      "Microsoft Word",
      "Notion",
      "Document management"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Regulatory review",
      "Compliance audits",
      "Policy documentation",
      "Compliance calendars"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "compliance_scope",
        "label": "Industry, applicable obligations and required scope",
        "required": true
      },
      {
        "key": "jurisdiction",
        "label": "Jurisdictions and review deadlines",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "legal",
    "slug": "business-formation",
    "serviceSlug": "business_formation",
    "formType": "business_formation",
    "id": "ca148002-5800-4800-8800-000000000017",
    "name": "Business Formation Specialist",
    "pipeline": "Business Formation Specialists",
    "description": "Describe qualifications, entity structures and jurisdictions supported.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe qualifications, entity structures and jurisdictions supported. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Entity structuring",
      "Formation documentation",
      "Founder agreements",
      "Registration coordination",
      "Governance setup"
    ],
    "skills": [
      "Entity research",
      "Legal drafting",
      "Document review",
      "Registration coordination",
      "Governance documentation"
    ],
    "tools": [
      "MCA Portal",
      "Microsoft Word",
      "DocuSign",
      "Google Workspace"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Entity structuring",
      "Formation documentation",
      "Founder agreements",
      "Registration coordination"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "formation_scope",
        "label": "Entity type, ownership and formation scope",
        "required": true
      },
      {
        "key": "jurisdiction",
        "label": "Jurisdiction, business activities and deadlines",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "hiring-hr",
    "slug": "end-to-end-hiring",
    "serviceSlug": "end_to_end_hiring",
    "formType": "end_to_end_hiring",
    "id": "ca148002-5800-4800-8800-000000000018",
    "name": "Recruitment Specialist",
    "pipeline": "Recruitment Specialists",
    "description": "Describe roles hired, sourcing methods, hiring volume and placement results.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe roles hired, sourcing methods, hiring volume and placement results. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Candidate sourcing",
      "Screening",
      "Interview coordination",
      "Offer coordination",
      "Recruitment reporting"
    ],
    "skills": [
      "Sourcing",
      "Candidate assessment",
      "Stakeholder management",
      "Interview planning",
      "Recruitment analytics"
    ],
    "tools": [
      "LinkedIn Recruiter",
      "Naukri",
      "Indeed",
      "ATS",
      "Google Sheets"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Candidate sourcing",
      "Screening",
      "Interview coordination",
      "Offer coordination"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "hiring_scope",
        "label": "Roles, headcount, locations and salary ranges",
        "required": true
      },
      {
        "key": "hiring_process",
        "label": "Selection process and target joining dates",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "hiring-hr",
    "slug": "team-building",
    "serviceSlug": "team_building",
    "formType": "team_building",
    "id": "ca148002-5800-4800-8800-000000000019",
    "name": "Team Building Specialist",
    "pipeline": "Team Building Specialists",
    "description": "Describe teams supported, facilitation approach and organizational outcomes.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe teams supported, facilitation approach and organizational outcomes. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Workforce planning",
      "Team design",
      "Competency mapping",
      "Team development",
      "Manager enablement"
    ],
    "skills": [
      "Organization design",
      "Facilitation",
      "Skills assessment",
      "Workforce planning",
      "Stakeholder management"
    ],
    "tools": [
      "Miro",
      "Notion",
      "Google Workspace",
      "Microsoft Teams"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Workforce planning",
      "Team design",
      "Competency mapping",
      "Team development"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "team_context",
        "label": "Team size, structure and current challenges",
        "required": true
      },
      {
        "key": "team_goals",
        "label": "Goals, session scope and expected outcomes",
        "required": true
      }
    ],
    "portfolio": false
  },
  {
    "squad": "hiring-hr",
    "slug": "hr-process",
    "serviceSlug": "hr_process",
    "formType": "hr_process",
    "id": "ca148002-5800-4800-8800-000000000020",
    "name": "HR Process Specialist",
    "pipeline": "HR Process Specialists",
    "description": "Describe HR operations, workforce sizes, systems and process improvements.",
    "detailKey": "professional_context",
    "detailLabel": "Experience, approach and results",
    "detailHint": "Describe HR operations, workforce sizes, systems and process improvements. Describe your responsibilities, approach and results; use anonymized examples.",
    "categories": [
      "Employee onboarding",
      "HR policies",
      "HR operations",
      "Performance processes",
      "Employee records"
    ],
    "skills": [
      "Process design",
      "Policy documentation",
      "HR reporting",
      "Employee lifecycle management",
      "HRIS administration"
    ],
    "tools": [
      "Zoho People",
      "BambooHR",
      "Google Workspace",
      "Excel",
      "HRMS"
    ],
    "aiTools": [
      "ChatGPT",
      "Claude"
    ],
    "objectives": [
      "Employee onboarding",
      "HR policies",
      "HR operations",
      "Performance processes"
    ],
    "briefHint": "Describe the scope, expected outcomes, current setup, timeline and review process.",
    "scopeLabel": "Services and scope",
    "briefFields": [
      {
        "key": "hr_scope",
        "label": "Headcount, locations and required HR processes",
        "required": true
      },
      {
        "key": "current_systems",
        "label": "Current systems, policies and desired outcomes",
        "required": true
      }
    ],
    "portfolio": false
  }
] as const;

export const SPECIALIST_ROLES = [...CONTENT_ROLES, ...REMAINING_ROLES] as const;

export type SpecialistRole = typeof SPECIALIST_ROLES[number];
// Compatibility names retained for the existing specialist form components.
export type ContentRole = SpecialistRole;
export type ContentFormType = ContentRole['formType'];
export type ContentServiceSlug = ContentRole['serviceSlug'];

export const TALENT_CATEGORY_OPTIONS = [
  { value: 'creative', label: 'Designer / Editor', slugs: ['designer', 'video-editor', 'designer-editor'] },
  ...SPECIALIST_ROLES.map((r) => ({
    value: r.formType,
    label: r.name,
    slugs: r.slug === 'videographer' ? ['videographer', 'videographer-photographer'] : [r.slug],
  })),
  { value: 'ads_specialist', label: 'Ads Specialist', slugs: ['ads-specialist'] },
  { value: 'accountant', label: 'Accountant', slugs: ['accountant'] },
  { value: 'sales', label: 'Sales', slugs: ['sales'] },
] as const;

export const PORTFOLIO_FORM_TYPES: readonly string[] = ['creative', 'ads_specialist', ...CONTENT_ROLES.map((r) => r.formType), ...REMAINING_ROLES.filter((r) => r.portfolio).map((r) => r.formType)];
export const MIN_PORTFOLIO_ITEMS: Record<string, number> = {
  ...Object.fromEntries(REMAINING_ROLES.map((r) => [r.slug, r.portfolio ? 3 : 0])),
  designer: 10,
  'video-editor': 10,
  videographer: 10,
  photographer: 10,
  'videographer-photographer': 10,
  'ai-video-image-creator': 10,
  ...Object.fromEntries(
    CONTENT_ROLES.map((r) => [
      r.slug,
      r.slug === 'videographer' || r.slug === 'photographer' || r.slug === 'ai-video-image-creator' ? 10 : 3,
    ]),
  ),
};
