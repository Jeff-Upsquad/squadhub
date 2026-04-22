'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type OnboardCountry = { id: string; name: string; currency: 'INR' | 'USD'; sort_order: number };
type SalesPerson = { id: string; display_name: string; email: string; avatar_url: string | null };

const COUNTRY_CODES = [
  { code: '+91', country: 'IN', flag: '🇮🇳' },
  { code: '+1', country: 'US', flag: '🇺🇸' },
  { code: '+44', country: 'GB', flag: '🇬🇧' },
  { code: '+971', country: 'AE', flag: '🇦🇪' },
  { code: '+65', country: 'SG', flag: '🇸🇬' },
  { code: '+61', country: 'AU', flag: '🇦🇺' },
  { code: '+49', country: 'DE', flag: '🇩🇪' },
  { code: '+33', country: 'FR', flag: '🇫🇷' },
  { code: '+81', country: 'JP', flag: '🇯🇵' },
  { code: '+86', country: 'CN', flag: '🇨🇳' },
  { code: '+55', country: 'BR', flag: '🇧🇷' },
  { code: '+27', country: 'ZA', flag: '🇿🇦' },
  { code: '+234', country: 'NG', flag: '🇳🇬' },
  { code: '+254', country: 'KE', flag: '🇰🇪' },
  { code: '+62', country: 'ID', flag: '🇮🇩' },
  { code: '+60', country: 'MY', flag: '🇲🇾' },
  { code: '+966', country: 'SA', flag: '🇸🇦' },
  { code: '+974', country: 'QA', flag: '🇶🇦' },
];

type FormData = {
  business_name: string;
  contact_person: string;
  designation: string;
  country_code: string;
  contact_number: string;
  email: string;
  business_address: string;
  gst_registered: boolean;
  gst_number: string;
  accounts_email: string;
  country_id: string;
  secondary_sales_person_id: string;
};

const initialForm: FormData = {
  business_name: '',
  contact_person: '',
  designation: '',
  country_code: '+91',
  contact_number: '',
  email: '',
  business_address: '',
  gst_registered: false,
  gst_number: '',
  accounts_email: '',
  country_id: '',
  secondary_sales_person_id: '',
};

type LinkMeta = {
  valid: boolean;
  expired: boolean;
  used: boolean;
  expires_at?: string;
  primary_sales_person?: SalesPerson | null;
  secondary_sales_person?: SalesPerson | null;
};

export default function OnboardTokenPage() {
  const params = useParams();
  const token = (params?.token as string) || '';

  const [linkMeta, setLinkMeta] = useState<LinkMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [form, setForm] = useState<FormData>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [countries, setCountries] = useState<OnboardCountry[]>([]);

  useEffect(() => {
    if (!token) {
      setMetaLoading(false);
      return;
    }
    fetch(`/clients/onboarding-links/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setLinkMeta(data.data);
          if (data.data?.secondary_sales_person) {
            setForm((prev) => ({ ...prev, secondary_sales_person_id: data.data.secondary_sales_person.id }));
          }
        } else {
          setLinkMeta({ valid: false, expired: false, used: false });
        }
      })
      .catch(() => setLinkMeta({ valid: false, expired: false, used: false }))
      .finally(() => setMetaLoading(false));
  }, [token]);

  useEffect(() => {
    fetch('/clients/countries')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setCountries(data.data);
          const india = data.data.find((c: OnboardCountry) => c.name === 'India');
          setForm((prev) => ({ ...prev, country_id: prev.country_id || india?.id || data.data[0]?.id || '' }));
        }
      })
      .catch(() => {/* non-fatal */});
  }, []);

  function update(field: keyof FormData, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/clients/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: form.business_name,
          contact_person: form.contact_person,
          designation: form.designation || undefined,
          contact_number: form.contact_number,
          email: form.email,
          business_address: form.business_address,
          gst_registered: form.gst_registered,
          gst_number: form.gst_registered ? form.gst_number : undefined,
          accounts_email: form.accounts_email || undefined,
          country_id: form.country_id,
          token,
          secondary_sales_person_id: form.secondary_sales_person_id || null,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Something went wrong');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (metaLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F7] px-4">
        <p className="text-sm text-[#717171]">Loading…</p>
      </div>
    );
  }

  if (!linkMeta || !linkMeta.valid) {
    const reason = linkMeta?.used
      ? 'This invite link has already been used.'
      : linkMeta?.expired
      ? 'This invite link has expired.'
      : 'This invite link is invalid.';
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F7] px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center border border-[#EBEBEB]">
          <h1 className="text-xl font-semibold text-[#222]">Link unavailable</h1>
          <p className="mt-2 text-base text-[#717171]">{reason}</p>
          <p className="mt-4 text-sm text-[#717171]">Please contact your sales representative for a new invite link.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F7] px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center border border-[#EBEBEB]">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#FFF0F2]">
            <svg className="h-8 w-8 text-[#FF385C]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-[#222]">Thank You!</h1>
          <p className="mt-2 text-base text-[#717171]">
            Your information has been submitted successfully. Our team will review your details and get back to you soon.
          </p>
        </div>
      </div>
    );
  }

  const primary = linkMeta.primary_sales_person;

  return (
    <div className="onboard-bg relative flex min-h-screen items-start justify-center px-4 py-8 sm:py-12 overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-[#FF385C] opacity-[0.06] blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[#D70466] opacity-[0.05] blur-[120px]" />
      <div className="pointer-events-none absolute top-1/3 right-0 h-[300px] w-[300px] rounded-full bg-[#E31C5F] opacity-[0.04] blur-[80px]" />
      <div className="relative z-10 w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="text-[26px] font-semibold text-[#222]">UpSquad</h1>
          <p className="mt-1 text-base text-[#717171]">Client Onboarding Form</p>
        </div>

        {primary && (
          <div className="mb-4 rounded-xl bg-white border border-[#EBEBEB] px-5 py-4 flex items-center gap-3">
            {primary.avatar_url ? (
              <img src={primary.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-[#FFF0F2] flex items-center justify-center text-[#FF385C] font-semibold">
                {primary.display_name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-xs text-[#717171]">Your sales representative</p>
              <p className="text-sm font-semibold text-[#222]">{primary.display_name}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="rounded-xl bg-white border border-[#EBEBEB] p-6 sm:p-8 space-y-6">
          {error && (
            <div className="rounded-lg bg-[#FFF0F2] border border-[#FF385C]/20 px-4 py-3 text-sm text-[#C13515]">{error}</div>
          )}

          <Field label="Name of Business / Brand" required>
            <input type="text" required placeholder="Enter your business or brand name" value={form.business_name} onChange={(e) => update('business_name', e.target.value)} className="input-field" />
          </Field>

          <Field label="Billing Country" required helper="India is billed in INR, everywhere else in USD">
            <select required value={form.country_id} onChange={(e) => update('country_id', e.target.value)} className="input-field">
              <option value="">Select a country</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
              ))}
            </select>
          </Field>

          <Field label="Contact Person Name" required>
            <input type="text" required placeholder="Full name" value={form.contact_person} onChange={(e) => update('contact_person', e.target.value)} className="input-field" />
          </Field>

          <Field label="Email" required helper="You'll use this to access our platform (can be changed later)">
            <input type="email" required placeholder="email@company.com" value={form.email} onChange={(e) => update('email', e.target.value)} className="input-field" />
          </Field>

          <Field label="Designation of Contact Person">
            <input type="text" placeholder="e.g. Marketing Head, CEO" value={form.designation} onChange={(e) => update('designation', e.target.value)} className="input-field" />
          </Field>

          <Field label="Contact Number" required helper="Ideally a WhatsApp number">
            <div className="phone-group" style={{ display: 'flex', alignItems: 'center', border: '1px solid #B0B0B0', borderRadius: 8, overflow: 'hidden', transition: 'border-color 0.2s, box-shadow 0.2s' }}>
              <select value={form.country_code} onChange={(e) => update('country_code', e.target.value)} style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', outline: 'none', background: '#F7F7F7', padding: '10px 28px 10px 12px', fontSize: 15, color: '#222', cursor: 'pointer' }}>
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                ))}
              </select>
              <div style={{ width: 1, height: 24, background: '#DDDDDD', flexShrink: 0 }} />
              <input type="tel" required placeholder="Phone number" value={form.contact_number} onChange={(e) => update('contact_number', e.target.value)} style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 12px', fontSize: 16, color: '#222', background: 'transparent' }} />
            </div>
          </Field>

          <Field label="Business Address" required helper="For billing purpose">
            <textarea required rows={3} placeholder="Full business address" value={form.business_address} onChange={(e) => update('business_address', e.target.value)} className="input-field resize-none" />
          </Field>

          <Field label="GST Registered?" required>
            <select required value={form.gst_registered ? 'yes' : 'no'} onChange={(e) => update('gst_registered', e.target.value === 'yes')} className="input-field">
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>

          {form.gst_registered && (
            <Field label="GST Number" required>
              <input type="text" required placeholder="e.g. 22AAAAA0000A1Z5" value={form.gst_number} onChange={(e) => update('gst_number', e.target.value)} className="input-field" />
            </Field>
          )}

          <Field label="Accounts Email ID" helper="To which invoices should be mailed">
            <input type="email" placeholder="accounts@company.com" value={form.accounts_email} onChange={(e) => update('accounts_email', e.target.value)} className="input-field" />
          </Field>

          <button type="submit" disabled={submitting} className="airbnb-btn w-full rounded-lg px-4 py-3.5 text-base font-semibold text-white transition-opacity disabled:opacity-50">
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </form>
      </div>

      <style jsx global>{`
        .input-field {
          width: 100%;
          border-radius: 8px;
          border: 1px solid #B0B0B0;
          padding: 10px 12px;
          font-size: 16px;
          color: #222;
          background: #fff;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .input-field:focus { outline: none; border-color: #222; box-shadow: 0 0 0 1px #222; }
        .input-field::placeholder { color: #717171; }
        .airbnb-btn { background: linear-gradient(to right, #E61E4D, #E31C5F, #D70466); }
        .airbnb-btn:hover { background: linear-gradient(to right, #D70466, #BD1E59, #BD1E59); }
        .phone-group:focus-within { border-color: #222 !important; box-shadow: 0 0 0 1px #222; }
        .onboard-bg {
          background: linear-gradient(135deg, #FAFAFA 0%, #F7F7F7 40%, #FFF5F6 100%);
          background-image:
            linear-gradient(135deg, #FAFAFA 0%, #F7F7F7 40%, #FFF5F6 100%),
            radial-gradient(circle at 1px 1px, #E0E0E0 0.5px, transparent 0);
          background-size: 100% 100%, 24px 24px;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, helper, children }: {
  label: string; required?: boolean; helper?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-[#222]">
        {label}{required && <span className="text-[#FF385C] ml-0.5">*</span>}
      </label>
      {children}
      {helper && <p className="mt-1.5 text-xs text-[#717171]">{helper}</p>}
    </div>
  );
}
