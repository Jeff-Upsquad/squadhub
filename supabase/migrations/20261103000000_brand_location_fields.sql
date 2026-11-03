-- =============================================================
-- Job Cards — brand-scoped outlet locations
-- =============================================================
-- business_locations now optionally hang off a brand profile:
--   brand_profile_id NULL = a shared business-level venue
--   brand_profile_id set  = an outlet of that brand
-- (A business hiring under itself keeps locations at business
-- level — business and brand "are the same".)
-- Plus outlet detail fields: district and description.
-- =============================================================

ALTER TABLE business_locations
  ADD COLUMN brand_profile_id UUID REFERENCES brand_profiles(id) ON DELETE SET NULL,
  ADD COLUMN district TEXT,
  ADD COLUMN description TEXT;

CREATE INDEX idx_business_locations_brand ON business_locations(brand_profile_id);

NOTIFY pgrst, 'reload schema';
