import type { SquadBotHomeApp, SquadBotStatus } from '@squadhub/shared';

export const STATUS_OPTIONS: { value: SquadBotStatus; label: string; hint: string; dot: string; chip: string }[] = [
  { value: 'off', label: 'Off', hint: 'Does nothing.', dot: 'bg-slate-400', chip: 'bg-canvas text-foreground-muted' },
  { value: 'practice', label: 'Practice', hint: 'Works in the background and logs what it would do, but sends nothing.', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700' },
  { value: 'approval', label: 'Needs approval', hint: 'Prepares replies; a person approves each one.', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700' },
  { value: 'live', label: 'Live', hint: 'Works on its own.', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
];

export function statusMeta(status: SquadBotStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
}

export const HOME_APP_LABELS: Record<SquadBotHomeApp, string> = {
  squadhire: 'SquadHire',
  squad_crm: 'Squad CRM',
  other: 'Other app',
};

export function StatusChip({ status }: { status: SquadBotStatus }) {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/** Four-way switch: Off · Practice · Needs approval · Live. */
export function StatusSwitch({
  value,
  onChange,
  disabled,
}: {
  value: SquadBotStatus;
  onChange: (next: SquadBotStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-divider bg-canvas p-0.5" role="radiogroup" aria-label="Bot status">
      {STATUS_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            disabled={disabled}
            onClick={() => !active && onChange(opt.value)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-50 ${
              active ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? opt.dot : 'bg-divider-strong'}`} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function errorMessage(e: any, fallback: string): string {
  return e?.response?.data?.error || fallback;
}
