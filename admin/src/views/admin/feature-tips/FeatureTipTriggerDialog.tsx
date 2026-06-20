'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../../services/api';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { FeatureTipRow } from './types';

export default function FeatureTipTriggerDialog({
  tip,
  onClose,
  onTriggered,
}: {
  tip: FeatureTipRow;
  onClose: () => void;
  onTriggered: () => void;
}) {
  const isReissue = tip.is_active;
  const [scope, setScope] = useState<'everyone' | 'unaccepted'>('everyone');

  const trigger = useMutation({
    mutationFn: () => api.post(`/admin/feature-tips/${tip.id}/trigger`, { scope }),
    onSuccess: onTriggered,
  });

  return (
    <ConfirmDialog
      open
      title={isReissue ? 'Re-trigger this tip' : 'Trigger this tip'}
      description={
        isReissue
          ? 'Push it to users again. Pick who should see it.'
          : 'Activate the tip and push it to its audience. Each user must accept it (or dismiss to be reminded in 3 hours).'
      }
      confirmLabel={isReissue ? 'Re-trigger' : 'Trigger'}
      pendingLabel="Triggering…"
      isPending={trigger.isPending}
      onCancel={onClose}
      onConfirm={() => trigger.mutate()}
    >
      {isReissue && (
        <div className="mt-3 space-y-2">
          <ScopeOption
            checked={scope === 'everyone'}
            onSelect={() => setScope('everyone')}
            title="Everyone"
            desc="Show it again to all targeted users, even those who already accepted. Starts a new round (acceptance history is kept)."
          />
          <ScopeOption
            checked={scope === 'unaccepted'}
            onSelect={() => setScope('unaccepted')}
            title="Only un-accepted"
            desc="Re-show only to users who never accepted it. Anyone who already clicked “Got it” won’t see it again."
          />
        </div>
      )}
    </ConfirmDialog>
  );
}

function ScopeOption({
  checked,
  onSelect,
  title,
  desc,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition ${
        checked ? 'border-accent bg-surface-alt' : 'border-divider bg-surface hover:border-divider-strong'
      }`}
    >
      <span
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? 'border-accent' : 'border-divider-strong'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-foreground-muted">{desc}</span>
      </span>
    </button>
  );
}
