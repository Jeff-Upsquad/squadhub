import { supabaseAdmin } from '../supabase';
import type { PlanMarginFields } from '@squadhub/shared';

export const ASSIGNMENT_TIERS = ['Junior', 'Pro', 'Top Talents'] as const;
export type AssignmentTier = (typeof ASSIGNMENT_TIERS)[number];

/** Card service_type labels → assignment catalog slugs (same map the card editor uses). */
const SERVICE_TYPE_TO_SLUG: Record<string, string> = {
  Designers: 'designer',
  Editors: 'video_editor',
  'Designer plus Editor': 'designer_video_editor',
  Accountants: 'accountant',
};

/**
 * Load one assignment service with its margin rows (level × country).
 * Mirrors hydrateSubscription so the admin UI renders both catalogs
 * from the same shape.
 */
export async function hydrateAssignmentService(serviceId: string) {
  const [{ data: service }, { data: margins }, { data: countries }] = await Promise.all([
    supabaseAdmin.from('assignment_services').select('*').eq('id', serviceId).single(),
    supabaseAdmin.from('assignment_service_margins').select('*').eq('service_id', serviceId),
    supabaseAdmin.from('countries').select('*').order('sort_order'),
  ]);

  if (!service) return null;

  const countriesById: Record<string, any> = {};
  (countries || []).forEach((c: any) => { countriesById[c.id] = c; });

  return {
    ...service,
    margins: (margins || []).map((m: any) => ({
      ...m,
      country: countriesById[m.country_id] || null,
    })),
  };
}

/** URL/DB-safe key for a service name, unique across the catalog. */
export function slugifyServiceName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'service';
}

/** Append _2, _3, … until the slug is free. */
export async function ensureUniqueServiceSlug(base: string): Promise<string> {
  const { data } = await supabaseAdmin.from('assignment_services').select('slug');
  const taken = new Set((data || []).map((r: any) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const next = `${base}_${i}`;
    if (!taken.has(next)) return next;
  }
  return `${base}_${Date.now()}`;
}

/**
 * Resolve a card's service_type to a catalog service id.
 * Known labels map by slug; admin-added services match on name, so a
 * service the admin creates ("Content") works without a code change.
 */
export async function resolveAssignmentServiceId(
  serviceType: string | null | undefined,
): Promise<string | null> {
  const label = String(serviceType ?? '').trim();
  if (!label) return null;

  const slug = SERVICE_TYPE_TO_SLUG[label] || slugifyServiceName(label);
  const { data: bySlug } = await supabaseAdmin
    .from('assignment_services')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (bySlug?.id) return bySlug.id as string;

  const { data: byName } = await supabaseAdmin
    .from('assignment_services')
    .select('id')
    .ilike('name', label)
    .maybeSingle();
  return (byName?.id as string | undefined) ?? null;
}

/**
 * The margin rule for an assignment card's service + level, as
 * PlanMarginFields so shared's pricing helpers can apply it.
 *
 * `price` is always null: assignments have no catalog rate, so there are no
 * bid floors — only the cut. Country falls back to India, then to any row
 * for that level (a single-country catalog shouldn't strand a card whose
 * targeting names some other country).
 */
export async function loadAssignmentMargin(opts: {
  serviceType: string | null | undefined;
  tier: string | null | undefined;
  countryId?: string | null;
}): Promise<PlanMarginFields | null> {
  const tier = String(opts.tier ?? '').trim();
  if (!tier) return null;

  const serviceId = await resolveAssignmentServiceId(opts.serviceType);
  if (!serviceId) return null;

  const { data: rows } = await supabaseAdmin
    .from('assignment_service_margins')
    .select('country_id, margin_value, margin_type, country:countries(name)')
    .eq('service_id', serviceId)
    .eq('tier', tier);
  if (!rows || rows.length === 0) return null;

  const pick =
    (opts.countryId && rows.find((r: any) => r.country_id === opts.countryId)) ||
    rows.find((r: any) => r.country?.name === 'India') ||
    rows[0];
  if (!pick) return null;

  return {
    price: null,
    margin_value: (pick as any).margin_value != null ? Number((pick as any).margin_value) : null,
    margin_type: ((pick as any).margin_type as 'fixed' | 'percent') ?? 'fixed',
  };
}
