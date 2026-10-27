export interface RequirementReview {
    auto_broadcast_status?: string;
    auto_broadcast_error?: string | null;
    business_submitted_at?: string | null;
    requirement_reviewed_at?: string | null;
    requirement_reviewed_by?: string | null;
    requirement_reviewer_name?: string | null;
}
/** Public/business submissions are automatically delivered. Internal briefs and
 * custom/request cards retain the explicit broadcast action. */
export function canManuallyBroadcast(card: RequirementReview & {
    source?: string | null;
}): boolean {
    return ['internal_brief', 'custom', 'request', 'submission'].includes(card.source ?? '');
}
