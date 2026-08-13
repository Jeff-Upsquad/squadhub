'use client';

import { useState } from 'react';
import {
  additionalRequirementCatalog,
  hasAdditionalRequirements,
  type AdditionalRequirements,
} from '@squadhub/shared';

export interface ConnectAdditionalRequirementsRole {
  slug: string;
  label: string;
}

/**
 * Optional "Additional requirements" block for the /connect brief forms.
 *
 * Businesses can attach specific skills / software / AI tools they'd like the
 * talent to have. Descriptive only — it's captured and shown to talent, and is
 * NEVER used to match or filter talent during broadcast.
 *
 * Renders a single visible toggle. When on, it shows the category catalog chips
 * plus an "Add your own" input per group. Supports one role (accountant) or
 * several (the multi-role /connect form), keying values by role slug.
 *
 * Styling reuses the parent form's `connect-chip` classes; its own chrome is
 * scoped under `arq-` via the injected <style>.
 */
export default function ConnectAdditionalRequirements({
  roles,
  values,
  onChange,
}: {
  roles: ConnectAdditionalRequirementsRole[];
  values: Record<string, AdditionalRequirements>;
  onChange: (slug: string, next: AdditionalRequirements) => void;
}) {
  const [open, setOpen] = useState(
    () => roles.some((r) => hasAdditionalRequirements(values[r.slug])),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const multi = roles.length > 1;

  function has(slug: string, group: string, label: string): boolean {
    const list = values[slug]?.[group] ?? [];
    return list.some((x) => x.toLowerCase() === label.toLowerCase());
  }

  function toggleLabel(slug: string, group: string, label: string) {
    const cur = values[slug] ?? {};
    const list = cur[group] ?? [];
    const exists = list.some((x) => x.toLowerCase() === label.toLowerCase());
    const next = exists
      ? list.filter((x) => x.toLowerCase() !== label.toLowerCase())
      : [...list, label];
    onChange(slug, { ...cur, [group]: next });
  }

  function addCustom(slug: string, group: string) {
    const key = `${slug}:${group}`;
    const label = (drafts[key] ?? '').trim();
    if (!label) return;
    if (!has(slug, group, label)) {
      const cur = values[slug] ?? {};
      onChange(slug, { ...cur, [group]: [...(cur[group] ?? []), label] });
    }
    setDrafts((d) => ({ ...d, [key]: '' }));
  }

  function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    // Clearing on collapse keeps "off" meaning "nothing submitted".
    if (!nextOpen) roles.forEach((r) => onChange(r.slug, {}));
  }

  return (
    <div className="arq-card">
      <style>{ARQ_STYLES}</style>
      <div className="arq-top">
        <div className="arq-txt">
          <div className="arq-t">
            Add specific skills &amp; tools <span className="arq-tag">Optional</span>
          </div>
          <p className="arq-d">
            Have particular skills, software or AI tools in mind? List them and we&apos;ll
            pass them to talent as additional requirements.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Toggle additional requirements"
          className={`arq-switch ${open ? '' : 'off'}`}
          onClick={toggleOpen}
        >
          <span className="arq-knob" />
        </button>
      </div>

      {open && (
        <div className="arq-reveal">
          {roles.map((role) => {
            const groups = additionalRequirementCatalog(role.slug);
            return (
              <div key={role.slug} className={multi ? 'arq-role' : ''}>
                {multi && <p className="arq-rolehd">{role.label}</p>}
                {groups.map((group) => {
                  const selected = values[role.slug]?.[group.key] ?? [];
                  const customs = selected.filter(
                    (l) => !group.options.some((o) => o.toLowerCase() === l.toLowerCase()),
                  );
                  const draftKey = `${role.slug}:${group.key}`;
                  return (
                    <div key={group.key} className="arq-grp">
                      <p className="arq-gl">{group.label}</p>
                      <div className="arq-chips">
                        {group.options.map((opt) => {
                          const on = has(role.slug, group.key, opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              className={`connect-chip ${on ? 'connect-chip-on' : ''}`}
                              aria-pressed={on}
                              onClick={() => toggleLabel(role.slug, group.key, opt)}
                            >
                              {on ? `✓ ${opt}` : opt}
                            </button>
                          );
                        })}
                        {customs.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className="connect-chip connect-chip-on"
                            aria-pressed
                            onClick={() => toggleLabel(role.slug, group.key, c)}
                            title="Remove"
                          >
                            ✓ {c} <span className="arq-x">✕</span>
                          </button>
                        ))}
                      </div>
                      <div className="arq-addrow">
                        <input
                          className="arq-input"
                          placeholder={`Add your own ${group.label.toLowerCase()}…`}
                          value={drafts[draftKey] ?? ''}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [draftKey]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addCustom(role.slug, group.key);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="arq-addbtn"
                          onClick={() => addCustom(role.slug, group.key)}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="arq-callout">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 8h.01M11 12h1v4h1" />
            </svg>
            <span>
              These are shared with talent as <b>additional requirements</b> and shown on
              their card. They are <b>not</b> used to match or filter talent during broadcast.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const ARQ_STYLES = `
.arq-card{background:#fff;border:2px solid #0a0a0a;border-radius:14px;padding:16px 18px;box-shadow:3px 3px 0 0 #0a0a0a}
.arq-top{display:flex;align-items:flex-start;gap:14px}
.arq-txt{flex:1;min-width:0}
.arq-t{font-size:15.5px;font-weight:700;color:#0a0a0a;display:flex;align-items:center;gap:8px}
.arq-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b6b6b;background:#F1EFE7;border:1px solid #E2DFD3;border-radius:999px;padding:2px 8px}
.arq-d{margin:4px 0 0;font-size:12.5px;color:#5C5C5C}
.arq-switch{flex-shrink:0;width:50px;height:30px;border-radius:999px;background:#0a0a0a;position:relative;cursor:pointer;border:none;padding:0}
.arq-knob{position:absolute;top:3px;left:23px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .15s}
.arq-switch.off{background:#D9D5C7}
.arq-switch.off .arq-knob{left:3px}
.arq-reveal{margin-top:18px;border-top:1px dashed #E2DFD3;padding-top:16px}
.arq-role{margin-top:18px}
.arq-role:first-child{margin-top:0}
.arq-rolehd{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7A7568;margin:0 0 10px}
.arq-grp{margin-top:18px}
.arq-grp:first-child{margin-top:2px}
.arq-gl{font-size:13px;font-weight:700;color:#222;margin:0 0 8px}
.arq-chips{display:flex;flex-wrap:wrap;gap:8px}
.arq-x{font-weight:700;opacity:.55;margin-left:1px}
.arq-addrow{display:flex;gap:8px;margin-top:9px}
.arq-input{flex:1;min-width:0;border:1px dashed #D9D5C7;border-radius:999px;background:#FBFAF6;padding:7px 14px;font-size:13.5px;color:#222;font-family:inherit}
.arq-input::placeholder{color:#9C9486}
.arq-input:focus{outline:none;border-color:#3A3A3A;background:#fff}
.arq-addbtn{border:1px solid #D9D5C7;background:#fff;border-radius:999px;padding:0 15px;font-size:13.5px;font-weight:600;color:#3A3A3A;cursor:pointer}
.arq-callout{display:flex;gap:9px;align-items:flex-start;background:#F7FBEC;border:1px solid #E3ECC6;border-radius:10px;padding:10px 12px;margin-top:16px;font-size:12px;color:#586138}
.arq-callout svg{flex-shrink:0;margin-top:1px}
`;
