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
