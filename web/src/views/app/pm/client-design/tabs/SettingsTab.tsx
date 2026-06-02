import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../../../services/api';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';

export default function SettingsTab({
  folderId,
  plan,
}: {
  folderId: string;
  plan: DesignPlan;
}) {
  const qc = useQueryClient();
  const [codeInput, setCodeInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);

  const { data: linkStatus } = useQuery({
    queryKey: ['folder-link-status', folderId],
    queryFn: () => api.get(`/pm/folders/${folderId}/link-status`).then((r) => r.data?.data),
  });

  const hoursLinked = linkStatus?.linked ?? false;
  const cardCode = linkStatus?.card_code ?? null;

  const linkMutation = useMutation({
    mutationFn: (card_code: string) => api.post(`/pm/folders/${folderId}/link-to-card`, { card_code }).then((r) => r.data),
    onSuccess: () => {
      setShowLinkInput(false);
      setCodeInput('');
      qc.invalidateQueries({ queryKey: ['folder-link-status', folderId] });
    },
  });

  return (
    <div style={{ padding: '4px 0', maxWidth: 480 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-fg-1)', marginBottom: 16 }}>
        Space Settings
      </div>

      {/* Card linking */}
      <Section title="Subscription Card">
        {hoursLinked ? (
          <div style={{ fontSize: 11, color: 'var(--cd-fg-2)', lineHeight: 1.6 }}>
            <div>Linked to card: <span style={{ fontFamily: 'var(--cd-font-mono)', color: 'var(--cd-fg-1)' }}>{cardCode}</span></div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--cd-fg-3)', marginBottom: 8 }}>
            No card linked.
          </div>
        )}

        {showLinkInput ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="Paste CARD-XXXXXX code"
              disabled={linkMutation.isPending}
              style={inputStyle}
              onKeyDown={(e) => e.key === 'Enter' && codeInput && linkMutation.mutate(codeInput)}
            />
            <button
              onClick={() => codeInput && linkMutation.mutate(codeInput)}
              disabled={!codeInput || linkMutation.isPending}
              style={{
                ...btnStyle,
                opacity: !codeInput ? 0.5 : 1,
                cursor: linkMutation.isPending ? 'wait' : 'pointer',
              }}
            >
              {linkMutation.isPending ? 'Linking\u2026' : 'Link'}
            </button>
            <button
              onClick={() => { setShowLinkInput(false); setCodeInput(''); }}
              style={btnSecondaryStyle}
            >
              Cancel
            </button>
            {linkMutation.isError && (
              <span style={{ color: 'var(--cd-red, #E53E3E)', fontSize: 10 }}>
                {(linkMutation.error as any)?.response?.data?.error || 'Link failed'}
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowLinkInput(!showLinkInput)}
            style={{ ...btnStyle, marginTop: 8 }}
          >
            {hoursLinked ? 'Change Card' : 'Link to Card'}
          </button>
        )}
      </Section>

      {/* Billing start date */}
      {hoursLinked && (
        <Section title="Billing Start Date">
          <div style={{ fontSize: 11, color: 'var(--cd-fg-3)', marginBottom: 8 }}>
            Set the date when billing started. The first month's hours will be prorated based on remaining days.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="date"
              defaultValue={linkStatus?.billing_start_date ?? ''}
              onChange={(e) => {
                const val = e.target.value || null;
                api.post(`/pm/folders/${folderId}/billing-start-date`, { billing_start_date: val }).then(() => {
                  qc.invalidateQueries({ queryKey: ['folder-link-status', folderId] });
                });
              }}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                fontFamily: 'var(--cd-font-mono)',
                border: '1px solid var(--cd-br-1)',
                borderRadius: 4,
                background: 'var(--cd-bg-1)',
                color: 'var(--cd-fg-1)',
                outline: 'none',
              }}
            />
            {linkStatus?.billing_start_date && (
              <span style={{ fontSize: 10, color: 'var(--cd-fg-3)' }}>
                First month prorated to {Math.round((plan.monthlyHours) * 10) / 10}h
              </span>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'var(--cd-font-mono)',
  border: '1px solid var(--cd-br-1)',
  borderRadius: 4,
  background: 'var(--cd-bg-1)',
  color: 'var(--cd-fg-1)',
  width: 200,
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  fontWeight: 600,
  border: 'none',
  borderRadius: 4,
  background: 'var(--cd-accent, #2962FF)',
  color: '#fff',
  cursor: 'pointer',
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 11,
  border: '1px solid var(--cd-br-1)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--cd-fg-2)',
  cursor: 'pointer',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        fontSize: 11,
        color: 'var(--cd-fg-2)',
        background: 'var(--cd-bg-2)',
        border: '1px solid var(--cd-br-1)',
        borderRadius: 6,
        marginBottom: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-fg-1)', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
