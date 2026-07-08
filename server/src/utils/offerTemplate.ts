import type {
  OfferCompensationRow,
  OfferLetterTemplate,
  OfferTemplateMergeField,
  OfferTemplateSection,
  OfferTemplateSignatory,
} from '@squadhub/shared';

/**
 * Offer-letter template rendering (offer_letter_templates, migration 161).
 *
 * Templates are a fixed skeleton of ordered sections whose body_html carries
 * {{merge_field}} placeholders, plus a data-driven compensation table
 * (compensation_schema rows × the offer's compensation amounts — rendered by
 * the composer UI, not by this text renderer). renderOfferTemplate() replaces
 * the placeholders it has values for and leaves unknown tokens intact so a
 * preview makes missing fields obvious.
 *
 * Templates are CANONICAL on SquadHub (contract §1) — SquadHire's business
 * composer pulls them via the signed integration GET and edits sections +
 * package per offer before sending; the rendered letter is frozen on the
 * Profiles side and mirrored back into job_offers.rendered_body_html.
 */

export interface RenderedOfferSection {
  key: string;
  title: string;
  body_html: string;
}

export interface RenderedOfferLetter {
  sections: RenderedOfferSection[];
  /** Sections concatenated into one HTML document body. */
  body_html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replace {{key}} tokens for the provided keys. Unknown tokens stay put. */
export function renderMergeFields(
  text: string,
  values: Record<string, string | number | null | undefined>,
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (token, key: string) => {
    const v = values[key];
    if (v === null || v === undefined || v === '') return token;
    return escapeHtml(String(v));
  });
}

export function renderOfferTemplate(
  template: Pick<OfferLetterTemplate, 'sections'>,
  values: Record<string, string | number | null | undefined>,
): RenderedOfferLetter {
  const sections: RenderedOfferSection[] = (template.sections ?? []).map((s: OfferTemplateSection) => ({
    key: s.key,
    title: renderMergeFields(s.title ?? '', values),
    body_html: renderMergeFields(s.body_html ?? '', values),
  }));
  const body_html = sections
    .map((s) => `<section data-section="${escapeHtml(s.key)}">${s.title ? `<h3>${s.title}</h3>` : ''}${s.body_html}</section>`)
    .join('\n');
  return { sections, body_html };
}

// ------------------------------------------------------------
// Default template — skeleton extracted from the sample offer letter
// ("Chindoora — Offer Letter — Sales Freshers"): letterhead → greeting +
// offer paragraph (position / effective / join-by / expiry) → boilerplate
// sections → compensation table (schema below) → closing signatory. No
// candidate signature block — acceptance is digital (accept / decline /
// negotiate buttons on the talent side).
// ------------------------------------------------------------

export const DEFAULT_OFFER_MERGE_FIELDS: OfferTemplateMergeField[] = [
  { key: 'candidate_name', label: 'Candidate name', source: 'candidate' },
  { key: 'position', label: 'Position title', source: 'card' },
  { key: 'effective_date', label: 'Effective date', source: 'manual' },
  { key: 'join_by_date', label: 'Join by date', source: 'card' },
  { key: 'expiry_date', label: 'Offer expiry date', source: 'manual' },
  { key: 'document_date', label: 'Document date', source: 'manual' },
  { key: 'business_name', label: 'Business name', source: 'business' },
  { key: 'brand_name', label: 'Brand name', source: 'business' },
  { key: 'workplace_location', label: 'Workplace location', source: 'business' },
  { key: 'working_hours', label: 'Working hours', source: 'card' },
  { key: 'working_days', label: 'Working days', source: 'card' },
  { key: 'signatory_name', label: 'Signatory name', source: 'manual' },
  { key: 'signatory_title', label: 'Signatory title', source: 'manual' },
];

export const DEFAULT_OFFER_COMPENSATION_SCHEMA: OfferCompensationRow[] = [
  { key: 'training', component: 'Training Period', cadence: 'per_month' },
  { key: 'probation', component: 'Probation Period', cadence: 'per_month' },
  { key: 'confirmed', component: 'After Probation', cadence: 'per_month' },
];

export const DEFAULT_OFFER_SECTIONS: OfferTemplateSection[] = [
  {
    key: 'offer',
    title: 'Offer of Employment',
    body_html:
      '<p>Hi {{candidate_name}},</p>' +
      '<p>We are pleased to offer you the position of <strong>{{position}}</strong> at {{business_name}}, ' +
      'effective {{effective_date}}. You are requested to join on or before {{join_by_date}}. ' +
      'This offer stands cancelled automatically if not accepted by {{expiry_date}}.</p>',
  },
  {
    key: 'duties',
    title: 'Duties & Responsibilities',
    body_html:
      '<p>Your duties and responsibilities are as set out in the job description shared with you. ' +
      'You are expected to perform them diligently and to take up any additional responsibilities ' +
      'reasonably assigned to you from time to time.</p>',
  },
  {
    key: 'work_timings',
    title: 'Work Timings',
    body_html:
      '<ul><li>Working days: {{working_days}}</li>' +
      '<li>Working hours: {{working_hours}}</li></ul>',
  },
  {
    key: 'remuneration',
    title: 'Remuneration & Salary Structure',
    body_html:
      '<p>Your remuneration is structured as per the compensation table in this letter. ' +
      'Salary is payable monthly, subject to statutory deductions as applicable.</p>',
  },
  {
    key: 'workplace',
    title: 'Workplace',
    body_html:
      '<p>Your place of work will be {{workplace_location}}. The company may transfer you to any of its ' +
      'offices or client locations with reasonable notice. You may be required to use your own device ' +
      'for work where applicable.</p>',
  },
  {
    key: 'compensation_notes',
    title: 'Notes on Compensation',
    body_html:
      '<p>Incentives, if any, are governed by the incentive plan in force. The company reserves the ' +
      'right to revise the compensation structure from time to time.</p>',
  },
  {
    key: 'devices',
    title: 'Devices Required',
    body_html: '<p>You are expected to have access to the devices required for this role.</p>',
  },
  {
    key: 'probation',
    title: 'Probation',
    body_html:
      '<p>You will be on probation for the period communicated to you. Confirmation is subject to ' +
      'satisfactory performance during probation.</p>',
  },
  {
    key: 'confirmation',
    title: 'Confirmation & Notice Period',
    body_html:
      '<p>On confirmation, either party may terminate employment by serving notice — 50 days during ' +
      'the first year of employment and 30 days thereafter.</p>',
  },
  {
    key: 'confidentiality',
    title: 'Confidentiality',
    body_html:
      '<p>You shall keep confidential all business, client and technical information of the company ' +
      'and shall not disclose it during or after your employment, except as required to perform ' +
      'your duties.</p>',
  },
  {
    key: 'ip_ownership',
    title: 'Intellectual Property',
    body_html:
      '<p>All work product, inventions and materials created by you in the course of your employment ' +
      'are the exclusive property of the company.</p>',
  },
  {
    key: 'non_solicitation',
    title: 'Non-Solicitation',
    body_html:
      '<p>For a period of two (2) years after leaving the company, you shall not solicit its employees ' +
      'or clients for a competing engagement.</p>',
  },
  {
    key: 'supplementary_employment',
    title: 'Supplementary Employment',
    body_html:
      '<p>You shall not take up any other employment, engagement or consultancy without the prior ' +
      'written consent of the company.</p>',
  },
  {
    key: 'service_condition',
    title: 'Service Conditions',
    body_html:
      '<p>Your employment is governed by the company’s policies and service conditions in force, ' +
      'as amended from time to time.</p>',
  },
  {
    key: 'closing',
    title: 'Closing',
    body_html:
      '<p>This letter supersedes all prior discussions and communications regarding your employment.</p>' +
      '<p>Warm regards,<br/><strong>{{signatory_name}}</strong><br/>{{signatory_title}}<br/>{{business_name}}</p>',
  },
];

export const DEFAULT_OFFER_SIGNATORY: OfferTemplateSignatory = {
  name: null,
  title: null,
  signature_image_url: null,
};

/** Insert shape for the seeded default template (offer_letter_templates). */
export const DEFAULT_OFFER_LETTER_TEMPLATE = {
  name: 'Standard offer letter',
  description:
    'Default offer letter skeleton (greeting, offer paragraph, boilerplate clauses, compensation table, closing). Edit sections per business or author profile-specific templates.',
  job_profile_id: null as string | null,
  sections: DEFAULT_OFFER_SECTIONS,
  merge_fields: DEFAULT_OFFER_MERGE_FIELDS,
  compensation_schema: DEFAULT_OFFER_COMPENSATION_SCHEMA,
  signatory: DEFAULT_OFFER_SIGNATORY,
  is_default: true,
};
