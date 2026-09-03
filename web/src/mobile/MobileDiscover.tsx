'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { MIcon } from './MobileKit';

type View = { level: 'categories' } | { level: 'profiles'; category: Category };

interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon_url?: string;
}

interface Profile {
  id: string;
  talent_user?: { full_name?: string; profile_photo_url?: string; current_location?: string };
  field_data?: Record<string, any>;
  category_id?: string;
  status?: string;
}

interface DiscoverResponse {
  profiles: Profile[];
  total: number;
  page: number;
  per_page: number;
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'experience_high', label: 'Experience: High to Low' },
  { value: 'experience_low', label: 'Experience: Low to High' },
  { value: 'salary_low', label: 'Salary: Low to High' },
  { value: 'salary_high', label: 'Salary: High to Low' },
] as const;

const CATEGORY_ICONS: Record<string, string> = {
  accountant: '📊',
  'video-editor': '🎬',
  designer: '🎨',
  writer: '✍️',
  developer: '💻',
  marketing: '📈',
  hr: '👥',
  legal: '⚖️',
  finance: '💰',
};

export default function MobileDiscover() {
  const [view, setView] = useState<View>({ level: 'categories' });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [page, setPage] = useState(1);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['discover-categories'],
    queryFn: () => api.get('/partner/discover/categories').then((r) => r.data?.categories ?? r.data ?? []),
    staleTime: 300_000,
  });

  const categories: Category[] = useMemo(() => {
    const data = categoriesQuery.data;
    if (Array.isArray(data)) return data;
    if (data?.categories) return data.categories;
    return [];
  }, [categoriesQuery.data]);

  const profilesQuery = useQuery({
    queryKey: ['discover-profiles', view.level === 'profiles' ? view.category.slug : null, search, sortBy, page],
    queryFn: () => {
      if (view.level !== 'profiles') return Promise.resolve(null);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (sortBy) params.set('sort_by', sortBy);
      if (page > 1) params.set('page', String(page));
      const qs = params.toString();
      return api.get(`/partner/discover/${view.category.slug}${qs ? `?${qs}` : ''}`).then((r) => r.data);
    },
    enabled: view.level === 'profiles',
    staleTime: 30_000,
  });

  const profiles: Profile[] = profilesQuery.data?.profiles ?? [];
  const total: number = profilesQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / (profilesQuery.data?.per_page ?? 20));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const selectCategory = (cat: Category) => {
    setView({ level: 'profiles', category: cat });
    setSearch('');
    setSearchInput('');
    setSortBy('newest');
    setPage(1);
  };

  const goBack = () => {
    setView({ level: 'categories' });
    setSelectedProfile(null);
  };

  // Profile detail — full screen
  if (selectedProfile) {
    return <ProfileDetail profile={selectedProfile} onBack={() => setSelectedProfile(null)} />;
  }

  return (
    <div className="mdiscover">
      {view.level === 'categories' ? (
        <>
          <header className="mdiscover-head">
            <span className="mdiscover-eyebrow">Talent marketplace</span>
            <div className="mdiscover-title-row">
              <div>
                <h1>Discover</h1>
                <p>Browse talent by job category</p>
              </div>
              <span className="mdiscover-title-icon">{MIcon.discover}</span>
            </div>
          </header>

          {categoriesQuery.isLoading ? (
            <div className="mdiscover-skeletons"><i /><i /><i /><i /><i /><i /></div>
          ) : categories.length === 0 ? (
            <div className="mdiscover-empty">
              <span>{MIcon.inboxOutline}</span>
              <b>No categories available</b>
              <p>Check back soon for new talent categories.</p>
            </div>
          ) : (
            <div className="mdiscover-categories">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className="mdiscover-category"
                  onClick={() => selectCategory(cat)}
                >
                  <span className="mdiscover-category-icon">
                    {CATEGORY_ICONS[cat.slug] || '📋'}
                  </span>
                  <span className="mdiscover-category-copy">
                    <b>{cat.name}</b>
                    {cat.description && <small>{cat.description}</small>}
                  </span>
                  <span className="mdiscover-chevron">{MIcon.chevron}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <header className="mdiscover-head">
            <button type="button" className="mdiscover-back" onClick={goBack}>
              {MIcon.back}
            </button>
            <div className="mdiscover-title-row">
              <div>
                <span className="mdiscover-eyebrow">
                  <span className="mdiscover-breadcrumb" onClick={goBack}>Discover</span>
                  {' / '}
                  <span>{view.category.name}</span>
                </span>
                <h1>{view.category.name}</h1>
                <p>{total} approved profile{total !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </header>

          <div className="mdiscover-search-bar">
            <form onSubmit={handleSearch} className="mdiscover-search-form">
              <div className="mdiscover-search-field">
                <span>{MIcon.search}</span>
                <input
                  type="text"
                  placeholder="Search by name, skills, location…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <button type="submit" className="mdiscover-search-btn">Search</button>
            </form>
            <select
              className="mdiscover-sort"
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {profilesQuery.isLoading ? (
            <div className="mdiscover-skeletons"><i /><i /><i /></div>
          ) : profiles.length === 0 ? (
            <div className="mdiscover-empty">
              <span>{MIcon.inboxOutline}</span>
              <b>No profiles found</b>
              <p>Try adjusting your search or filters.</p>
            </div>
          ) : (
            <>
              <div className="mdiscover-list">
                {profiles.map((p) => (
                  <ProfileCard key={p.id} profile={p} onClick={() => setSelectedProfile(p)} />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="mdiscover-pagination">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <span>Page {page} of {totalPages}</span>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ProfileCard({ profile, onClick }: { profile: Profile; onClick: () => void }) {
  const name = profile.talent_user?.full_name ?? 'Talent';
  const fd = profile.field_data ?? {};
  const experience = fd.years_experience;
  const salary = fd.expected_salary;
  const typeOfWork = fd.type_of_work ? String(fd.type_of_work).replace(/_/g, ' ') : null;
  const skills = (fd.accounting_software as string[] | undefined)?.slice(0, 4);

  return (
    <button type="button" className="mdiscover-card" onClick={onClick}>
      <span className="mdiscover-card-icon">{MIcon.profile}</span>
      <span className="mdiscover-card-copy">
        <b>{name}</b>
        <span className="mdiscover-card-meta">
          {experience != null && <span>{experience} yrs exp</span>}
          {salary != null && <span>₹{Number(salary).toLocaleString('en-IN')}/mo</span>}
          {typeOfWork && <span>{typeOfWork}</span>}
        </span>
        {skills && skills.length > 0 && (
          <span className="mdiscover-chips">
            {skills.map((s) => <span key={s}>{s.replace(/_/g, ' ')}</span>)}
          </span>
        )}
      </span>
      <span className="mdiscover-chevron">{MIcon.chevron}</span>
    </button>
  );
}

function ProfileDetail({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const name = profile.talent_user?.full_name ?? 'Talent';
  const location = profile.talent_user?.current_location;
  const fd = profile.field_data ?? {};

  const details = Object.entries(fd)
    .filter(([k, v]) => v != null && v !== '' && k !== 'accounting_software' && k !== 'type_of_work')
    .map(([k, v]) => ({
      label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: Array.isArray(v) ? v.join(', ') : String(v),
    }));

  return (
    <div className="mdiscover">
      <header className="mdiscover-head">
        <button type="button" className="mdiscover-back" onClick={onBack}>
          {MIcon.back}
        </button>
        <div className="mdiscover-title-row">
          <div>
            <h1>{name}</h1>
            {location && <p>{location}</p>}
          </div>
        </div>
      </header>

      <div className="mdiscover-detail">
        {details.length > 0 && (
          <dl className="mdiscover-details">
            {details.map((d) => <div key={d.label}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}
          </dl>
        )}
      </div>
    </div>
  );
}
