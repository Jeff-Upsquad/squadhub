'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { FeatureTipRow, TipPlatform, audienceSummary } from './types';
import FeatureTipEditor from './FeatureTipEditor';
import FeatureTipRoster from './FeatureTipRoster';
import FeatureTipTriggerDialog from './FeatureTipTriggerDialog';
import FeatureTipPreview from './FeatureTipPreview';

export default function AdminFeatureTips({ platform = 'web' }: { platform?: TipPlatform }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FeatureTipRow | 'new' | null>(null);
  const [rosterTip, setRosterTip] = useState<FeatureTipRow | null>(null);
  const [triggerTip, setTriggerTip] = useState<FeatureTipRow | null>(null);
  const [deleteTip, setDeleteTip] = useState<FeatureTipRow | null>(null);
  const [previewTip, setPreviewTip] = useState<FeatureTipRow | null>(null);

  const listKey = ['admin-feature-tips', platform];
  const { data: res, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get(`/admin/feature-tips?platform=${platform}`).then((r) => r.data),
  });
  const tips: FeatureTipRow[] = res?.data || [];

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/feature-tips/${id}`),
    onSuccess: () => {
      setDeleteTip(null);
      qc.invalidateQueries({ queryKey: listKey });
    },
  });

  const isApp = platform === 'app';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
            {isApp ? 'App Tooltips' : 'Feature Tips'}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {isApp
              ? 'Announce features inside the native partner app with a coachmark or card. Trigger to push it to app users — each must accept it (or dismiss to be reminded in 3 hours). Re-trigger any time.'
              : 'Announce new features with a coachmark or card. Trigger to push it to users — each must accept it (or dismiss to be reminded in 3 hours). Re-trigger any time.'}
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover"
        >
          New tip
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-divider bg-surface">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-foreground-muted">Loading…</div>
        ) : tips.length === 0 ? (
          <div className="p-8 text-center text-sm text-foreground-muted">
            No tips yet. Create one to announce a feature.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-[11px] uppercase tracking-wider text-foreground-dim">
                <th className="px-4 py-2.5 font-medium">Tip</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Audience</th>
                <th className="px-4 py-2.5 font-medium">Accepted</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {tips.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{t.title}</div>
                    <div className="mt-0.5 line-clamp-1 max-w-md text-xs text-foreground-muted">{t.body}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge active={t.is_active} revision={t.current_revision} />
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground-muted">
                    {t.steps && t.steps.length > 0 ? (
                      <span className="text-foreground">Guided tour · {t.steps.length} steps</span>
                    ) : t.target_anchor ? (
                      <>
                        <span className="text-foreground">{t.target_view || '—'}</span>
                        <div className="font-[family-name:var(--font-mono)] text-[11px] text-foreground-dim">
                          ⌖ {t.target_anchor}
                        </div>
                      </>
                    ) : t.target_view ? (
                      <span className="text-foreground">{t.target_view}</span>
                    ) : (
                      <span className="text-foreground-dim">Centered card</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground-muted">{audienceSummary(t.audience)}</td>
                  <td className="px-4 py-3 text-foreground">{t.accepted_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 text-xs">
                      <RowBtn onClick={() => setPreviewTip(t)}>Preview</RowBtn>
                      <RowBtn onClick={() => setEditing(t)}>Edit</RowBtn>
                      <RowBtn onClick={() => setRosterTip(t)}>Roster</RowBtn>
                      <RowBtn onClick={() => setTriggerTip(t)} accent>
                        {t.is_active ? 'Re-trigger' : 'Trigger'}
                      </RowBtn>
                      <RowBtn onClick={() => setDeleteTip(t)} danger>
                        Delete
                      </RowBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <FeatureTipEditor
          tip={editing === 'new' ? null : editing}
          platform={platform}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: listKey });
          }}
        />
      )}

      {rosterTip && <FeatureTipRoster tip={rosterTip} onClose={() => setRosterTip(null)} />}

      {triggerTip && (
        <FeatureTipTriggerDialog
          tip={triggerTip}
          onClose={() => setTriggerTip(null)}
          onTriggered={() => {
            setTriggerTip(null);
            qc.invalidateQueries({ queryKey: listKey });
          }}
        />
      )}

      {previewTip && (
        <FeatureTipPreview
          title={previewTip.title}
          body={previewTip.body}
          targetView={previewTip.target_view}
          targetAnchor={previewTip.target_anchor}
          viewLabel={previewTip.target_view}
          steps={previewTip.steps ?? null}
          onClose={() => setPreviewTip(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTip}
        title="Delete this tip?"
        description={`"${deleteTip?.title}" and all of its acceptance history will be permanently removed.`}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        variant="danger"
        isPending={del.isPending}
        onCancel={() => setDeleteTip(null)}
        onConfirm={() => deleteTip && del.mutate(deleteTip.id)}
      />
    </div>
  );
}

function StatusBadge({ active, revision }: { active: boolean; revision: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        active ? 'bg-emerald-50 text-emerald-600' : 'bg-surface-alt text-foreground-muted'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
      {revision > 1 && <span className="text-foreground-dim">· r{revision}</span>}
    </span>
  );
}

function RowBtn({
  children,
  onClick,
  accent,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  danger?: boolean;
}) {
  const tone = danger
    ? 'text-red-600 hover:bg-red-50'
    : accent
      ? 'text-accent hover:bg-surface-alt'
      : 'text-foreground-muted hover:bg-surface-alt hover:text-foreground';
  return (
    <button onClick={onClick} className={`rounded-md px-2 py-1 font-medium transition ${tone}`}>
      {children}
    </button>
  );
}
