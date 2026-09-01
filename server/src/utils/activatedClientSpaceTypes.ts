const TEMPLATE_SLUGS_BY_SERVICE: Record<string, string[]> = {
  Designers: ['design-space'],
  Editors: ['video-editing-space'],
  'Designer plus Editor': ['design-space', 'video-editing-space'],
};

/** The client-space templates required by a subscription card. */
export function templateSlugsForServiceType(serviceType: string | null | undefined): string[] {
  return serviceType ? [...(TEMPLATE_SLUGS_BY_SERVICE[serviceType] ?? [])] : [];
}

const TEMPLATE_SLUGS_BY_SUBSCRIPTION: Record<string, string[]> = {
  designer: ['design-space'],
  video_editor: ['video-editing-space'],
  designer_video_editor: ['design-space', 'video-editing-space'],
};

export function templateSlugsForSubscriptionSlug(subscriptionSlug: string | null | undefined): string[] {
  return subscriptionSlug ? [...(TEMPLATE_SLUGS_BY_SUBSCRIPTION[subscriptionSlug] ?? [])] : [];
}

/**
 * Brand folder name for an activated card. If brand_name is just the contact
 * person's name, use the company so two cards for the same client share one
 * folder instead of creating a "Jeff" brand next to "tag connect".
 */
export function brandFolderName(
  card: { brand_name?: string | null; customer_name?: string | null; customer_company?: string | null },
  client: { business_name?: string | null },
): string {
  const brand = String(card.brand_name || '').trim();
  const person = String(card.customer_name || '').trim();
  const company = String(card.customer_company || client.business_name || '').trim();
  if (brand && (!person || brand.toLowerCase() !== person.toLowerCase())) return brand;
  return company || brand || 'Client';
}

/** List rows for a client-space template. Omit default_view — production lists drifted and has no such column. */
export function templateListRows(input: {
  spaceId: string;
  folderId: string;
  actorId: string;
  lists: Array<{ name: string; position?: number }>;
}): Array<{
  space_id: string;
  folder_id: string;
  name: string;
  position: number;
  is_private: true;
  created_by: string;
}> {
  return input.lists
    .map((list) => ({
      space_id: input.spaceId,
      folder_id: input.folderId,
      name: String(list.name || '').trim(),
      position: list.position ?? 0,
      is_private: true as const,
      created_by: input.actorId,
    }))
    .filter((row) => row.name.length > 0);
}
