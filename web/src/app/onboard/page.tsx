'use client';

import { useState } from 'react';

type FormData = {
  business_name: string;
  contact_person: string;
  designation: string;
  contact_number: string;
  email: string;
  business_address: string;
  gst_registered: boolean;
  gst_number: string;
  accounts_email: string;
};

const initialForm: FormData = {
  business_name: '',
  contact_person: '',
  designation: '',
  contact_number: '',
  email: '',
  business_address: '',
  gst_registered: false,
  gst_number: '',
  accounts_email: '',
};

export default function OnboardPage() {
  const [form, setForm] = useState<FormData>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

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
          ...form,
          accounts_email: form.accounts_email || undefined,
          designation: form.designation || undefined,
          gst_number: form.gst_registered ? form.gst_number : undefined,
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

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#0F172B]">Thank You!</h1>
          <p className="mt-2 text-sm text-[#62748E]">
            Your information has been submitted successfully. Our team will review your details and get back to you soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#F1F5F9] px-4 py-8 sm:py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-[#0F172B]">SquadHub</h1>
          <p className="mt-1 text-sm text-[#62748E]">Client Onboarding Form</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm sm:p-8 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          <Field label="Name of Business / Brand" required>
            <input
              type="text"
              required
              value={form.business_name}
              onChange={(e) => update('business_name', e.target.value)}
              className="input-field"
            />
          </Field>

          <Field label="Contact Person Name" required>
            <input
              type="text"
              required
              value={form.contact_person}
              onChange={(e) => update('contact_person', e.target.value)}
              className="input-field"
            />
          </Field>

          <Field label="Designation of Contact Person">
            <input
              type="text"
              value={form.designation}
              onChange={(e) => update('designation', e.target.value)}
              className="input-field"
            />
          </Field>

          <Field label="Contact Number" required helper="Ideally a WhatsApp number">
            <div className="flex">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 border-[#E2E8F0] bg-[#F8FAFC] px-3 text-sm text-[#62748E]">+91</span>
              <input
                type="tel"
                required
                value={form.contact_number}
                onChange={(e) => update('contact_number', e.target.value)}
                className="input-field !rounded-l-none"
              />
            </div>
          </Field>

          <Field label="Official Email" required>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              className="input-field"
            />
          </Field>

          <Field label="Business Address" required helper="For billing purpose">
            <textarea
              required
              rows={3}
              value={form.business_address}
              onChange={(e) => update('business_address', e.target.value)}
              className="input-field resize-none"
            />
          </Field>

          <Field label="GST Registered?" required>
            <select
              required
              value={form.gst_registered ? 'yes' : 'no'}
              onChange={(e) => update('gst_registered', e.target.value === 'yes')}
              className="input-field"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>

          {form.gst_registered && (
            <Field label="GST Number" required>
              <input
                type="text"
                required
                value={form.gst_number}
                onChange={(e) => update('gst_number', e.target.value)}
                className="input-field"
              />
            </Field>
          )}

          <Field label="Accounts Email ID" helper="To which invoices should be mailed">
            <input
              type="email"
              value={form.accounts_email}
              onChange={(e) => update('accounts_email', e.target.value)}
              className="input-field"
            />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#0F172B] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1E293B] disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </form>
      </div>

      <style jsx global>{`
        .input-field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #E2E8F0;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #0F172B;
          transition: border-color 0.15s;
        }
        .input-field:focus {
          outline: none;
          border-color: #2962FF;
          box-shadow: 0 0 0 1px #2962FF;
        }
        .input-field::placeholder {
          color: #90A1B9;
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
      <label className="mb-1.5 block text-sm font-medium text-[#0F172B]">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {helper && <p className="mt-1 text-xs text-[#90A1B9]">{helper}</p>}
    </div>
  );
}
