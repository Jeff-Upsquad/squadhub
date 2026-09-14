'use client';

import { useEffect, useState } from 'react';

type Manifest = { version_name?: string; version_code?: number };

type Versions = { business?: string; partner?: string; internal?: string };

async function fetchVersionName(endpoint: string): Promise<string | undefined> {
  try {
    const r = await fetch(endpoint, { cache: 'no-store' });
    if (!r.ok) return undefined;
    const res = await r.json();
    const name: string | undefined = res?.data?.version_name;
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function useNativeAppVersions(): Versions {
  const [versions, setVersions] = useState<Versions>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [business, partner, internal] = await Promise.all([
        fetchVersionName('/business-app/version'),
        fetchVersionName('/partner-app/version'),
        fetchVersionName('/internal-app/version'),
      ]);
      if (!cancelled) setVersions({ business, partner, internal });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return versions;
}

/** Compact footer: brand + live native-app versions. Dark-drawer friendly. */
export default function AppVersionsFooter({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { business, partner, internal } = useNativeAppVersions();
  const muted = tone === 'dark' ? 'rgba(255,255,255,0.55)' : '#A3A3A3';
  const strong = tone === 'dark' ? '#fff' : '#0A0A0A';
  const rows: { label: string; value?: string }[] = [
    { label: 'Business', value: business },
    { label: 'Partner', value: partner },
    { label: 'Internal', value: internal },
  ];
  const anyLoaded = rows.some((r) => r.value);
  return (
    <div style={{ padding: '14px 16px calc(14px + env(safe-area-inset-bottom))' }}>
      <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.01em', color: strong, lineHeight: 1.2 }}>
        SquadHub
      </div>
      <div style={{ fontSize: 13, color: muted, marginTop: 2 }}>powered by UpSquad</div>
      <div style={{ fontSize: 11.5, color: muted, marginTop: 8, lineHeight: 1.6 }}>
        {anyLoaded ? (
          <>
            {rows.map((r) =>
              r.value ? (
                <div key={r.label}>
                  {r.label} v{r.value}
                </div>
              ) : null,
            )}
          </>
        ) : (
          <div>Checking app versions…</div>
        )}
      </div>
    </div>
  );
}
