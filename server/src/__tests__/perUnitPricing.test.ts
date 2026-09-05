import { describe, expect, it } from 'vitest';
import { offerQuantity, totalOfferFigures } from '../utils/perUnitPricing';

describe('per-unit assignment pricing', () => {
  it('uses the requested video quantity when locking an accepted quote', () => {
    expect(totalOfferFigures(1500, 1200, {
      pricing_basis: 'per_unit',
      unit: 'video',
      quantity: 4,
    })).toEqual({ business: 6000, partner: 4800 });
  });

  it('keeps project pricing as a single amount', () => {
    expect(totalOfferFigures(15000, 12000, {
      pricing_basis: 'project',
      quantity: 4,
    })).toEqual({ business: 15000, partner: 12000 });
  });

  it('falls back safely when quantity metadata is invalid', () => {
    expect(offerQuantity({ pricing_basis: 'per_unit', unit: 'design', quantity: 0 })).toBe(1);
  });
});
