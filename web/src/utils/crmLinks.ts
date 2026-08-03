import type { CrmChatEntityType } from '@squadhub/shared';

/**
 * Deep links into Squad CRM from SquadHub (CRM Chat panel, etc.).
 *
 * Named crmLinks (not squadCrm) on purpose: web's `@/` alias prefers web/src
 * over admin/src, so a web/src/utils/squadCrm.ts would shadow admin's
 * openLeadInCRM helper used by shared Leads modules and break the web build.
 */

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
