export interface PerUnitAmountMetadata {
  pricing_basis?: string;
  unit?: string;
  quantity?: number;
}

export function offerQuantity(metadata: PerUnitAmountMetadata | null | undefined): number {
  if (
    metadata?.pricing_basis !== 'per_unit' ||
    (metadata.unit !== 'design' && metadata.unit !== 'video')
  ) return 1;
  const quantity = Number(metadata.quantity);
  return Number.isInteger(quantity) && quantity > 0 && quantity <= 999 ? quantity : 1;
}

export function totalOfferFigures(
  businessUnitPrice: number,
  partnerUnitPrice: number,
  metadata: PerUnitAmountMetadata | null | undefined,
): { business: number; partner: number } {
  const quantity = offerQuantity(metadata);
  return {
    business: Math.round(businessUnitPrice * quantity),
    partner: Math.round(partnerUnitPrice * quantity),
  };
}
