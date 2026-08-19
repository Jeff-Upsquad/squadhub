/**
 * Scoping a card module to one customer.
 *
 * The Subscription Cards module normally lists every card in the org. Opened
 * from a customer — the Hub's Contact detail panel, or Squad CRM's Requirement
 * Cards panel on a lead / deal / contact — it lists only that customer's cards
 * instead. The server resolves the id to a card set (see crmCardScope.ts), so
 * all the client does is pass the id through on every list query, and mix it
 * into the react-query keys so two scopes never share a cache entry.
 */

export type CardScope = {
  /** Hub client_submissions.id */
  submissionId?: string | null;
  /** Squad CRM crm_leads.id */
  crmLeadId?: string | null;
  /** Squad CRM crm_deals.id */
  crmDealId?: string | null;
  /** Squad CRM crm_contacts.id */
  crmContactId?: string | null;
};

/** Query params for GET /admin/subscription-cards. Empty when unscoped. */
export function cardScopeParams(scope?: CardScope | null): Record<string, string> {
  if (!scope) return {};
  const params: Record<string, string> = {};
  if (scope.submissionId) params.submission_id = scope.submissionId;
  if (scope.crmLeadId) params.crm_lead_id = scope.crmLeadId;
  if (scope.crmDealId) params.crm_deal_id = scope.crmDealId;
  if (scope.crmContactId) params.crm_contact_id = scope.crmContactId;
  return params;
}

/**
 * Stable react-query key fragment. '' for the unscoped module, so existing
 * cache keys keep the shape they had before scoping existed.
 */
export function cardScopeKey(scope?: CardScope | null): string {
  const params = cardScopeParams(scope);
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}:${params[k]}`).join('|');
}

export function isScoped(scope?: CardScope | null): boolean {
  return Object.keys(cardScopeParams(scope)).length > 0;
}
