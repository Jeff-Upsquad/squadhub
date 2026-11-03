// Shared candidate-facing snapshots for both business submission and admin publishing.
export function jobCardContent(card: any, profile: any, business: any, brand: any, location: any): Record<string, unknown> {
  const brandName: string = (brand?.name as string | undefined) || (business.name as string);

  // Self-contained snapshots — the candidate should understand the business
  // and the job without asking questions (requirement B).
  return {
    // Top-level summary reused verbatim by push + WhatsApp interpolation.
    title: profile.title,
    brand_name: brandName,
    description: profile.description ?? null,
    card_type: 'hiring',
    job_profile: {
      // REQUIRED (contract §4): Profiles keys its canonical job_profiles
      // mirror on this — it 400s hiring cards without it.
      external_id: profile.id,
      title: profile.title,
      description: profile.description ?? null,
      responsibilities: profile.responsibilities ?? [],
      requirements: profile.requirements ?? [],
      skills: profile.skills ?? [],
      min_experience_years: profile.min_experience_years ?? null,
      max_experience_years: profile.max_experience_years ?? null,
      education: profile.education ?? null,
      employment_type: profile.employment_type,
      work_mode: profile.work_mode,
      working_days: profile.working_days ?? [],
      working_hours: profile.working_hours ?? null,
      salary_min: profile.salary_min ?? null,
      salary_max: profile.salary_max ?? null,
      salary_currency: profile.salary_currency ?? 'INR',
      salary_period: profile.salary_period ?? 'monthly',
      benefits: profile.benefits ?? [],
      growth_path: profile.growth_path ?? null,
      location: location
        ? {
            label: location.label,
            address: location.address,
            city: location.city ?? null,
            district: location.district ?? null,
            region: location.region ?? null,
            postal_code: location.postal_code ?? null,
            description: location.description ?? null,
            google_maps_url: location.google_maps_url ?? null,
          }
        : null,
    },
    business_profile: {
      external_id: business.id,
      name: business.name,
      about: business.about ?? null,
      industry: business.industry ?? null,
      company_size: business.company_size ?? null,
      website: business.website ?? null,
      socials: business.socials ?? {},
      logo_url: business.logo_url ?? null,
      photos: business.photos ?? [],
      culture: business.culture ?? null,
      perks: business.perks ?? [],
      founded_year: business.founded_year ?? null,
    },
    brand_profile: brand
      ? {
          external_id: brand.id,
          name: brand.name,
          about: brand.about ?? null,
          industry: brand.industry ?? null,
          website: brand.website ?? null,
          socials: brand.socials ?? {},
          logo_url: brand.logo_url ?? null,
          photos: brand.photos ?? [],
        }
      : null,
    // Card-level offer terms (can differ from the profile's advertised range).
    package_min: card.package_min ?? null,
    package_max: card.package_max ?? null,
    package_currency: card.package_currency ?? 'INR',
    package_period: card.package_period ?? 'monthly',
    package_notes: card.package_notes ?? null,
    openings_count: card.openings_count ?? 1,
    expected_joining_date: card.expected_joining_date ?? null,
  };

}
