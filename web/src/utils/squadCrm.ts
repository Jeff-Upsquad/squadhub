import type { CrmChatEntityType } from '@squadhub/shared';

/** Squad CRM base URL (prod default; override with NEXT_PUBLIC_CRM_URL for local). */
export const SQUAD_CRM_URL = (
  process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.squadhub.in'
).replace(/\/+$/, '');

/** Build a deep link into the CRM entity detail page. */
export function crmEntityUrl(
  entityType: CrmChatEntityType | string | null | undefined,
  entityId: string | null | undefined,
): string | null {
  if (!entityId) return null;
  if (entityType === 'crm_deal') return `${SQUAD_CRM_URL}/app/deals/${entityId}`;
  if (entityType === 'crm_contact') return `${SQUAD_CRM_URL}/app/contacts/${entityId}`;
  if (entityType === 'crm_lead') return `${SQUAD_CRM_URL}/app/leads/${entityId}`;
  // Unknown type — still open CRM home rather than a broken path.
  return SQUAD_CRM_URL;
}

export function openCrmEntity(
  entityType: CrmChatEntityType | string | null | undefined,
  entityId: string | null | undefined,
): void {
  const url = crmEntityUrl(entityType, entityId) || SQUAD_CRM_URL;
  window.open(url, '_blank', 'noopener,noreferrer');
}
