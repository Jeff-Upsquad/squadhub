import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface DesignSource {
  id: string;
  name: string;
  url: string;
  platform: string[];
  captured: string;
  path: string;
  description: string;
  colors: string[];
  fonts: string[];
  stats?: { pages?: number; tokens?: number; icons?: number };
  tags?: string[];
}

const LIB_BASE = '/design-library/';

export default function AdminDesignLibrary() {
  const [active, setActive] = useState<string>('hub');

  const { data: sources, isLoading } = useQuery<DesignSource[]>({
    queryKey: ['design-library-sources'],
    queryFn: async () => {
      const res = await fetch(`${LIB_BASE}sources.json`);
      if (!res.ok) throw new Error('sources.json not found');
      const json = await res.json();
      return json.sources ?? [];
    },
  });

  const iframeSrc =
    active === 'hub' ? `${LIB_BASE}index.html` : `${LIB_BASE}${active}/index.html`;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Design Library</h1>
          <p className="mt-1 text-sm text-[#62748E]">
            Design systems captured from other products — tokens, typography, icons and components, extracted from their production CSS.
          </p>
        </div>
        <a
          href={iframeSrc}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#E2E8F0] px-3 py-2 text-sm text-[#62748E] transition hover:bg-[#F8FAFC] hover:text-[#0F172B]"
        >
          Open full screen
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </a>
      </div>

      {/* Source cards */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading sources...</p>
      ) : !sources || sources.length === 0 ? (
        <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">No sources captured yet.</p>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`overflow-hidden rounded-lg border bg-white text-left transition hover:shadow-sm ${
                active === s.id ? 'border-[#0F172B]' : 'border-[#E2E8F0]'
              }`}
            >
              <div className="flex h-7">
                {s.colors.map((c) => (
                  <span key={c} className="flex-1" style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#0F172B]">{s.name}</span>
                  {s.platform.map((p) => (
                    <span
                      key={p}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        p === 'mobile' ? 'bg-indigo-50 text-indigo-600' : 'bg-[#F1F5F9] text-[#62748E]'
                      }`}
                    >
                      {p}
                    </span>
                  ))}
                  <span className="ml-auto text-[11px] text-[#90A1B9]">{s.captured}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#62748E]">{s.description}</p>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-[#90A1B9]">
                  <span className="truncate">{s.fonts.slice(0, 3).join(' · ')}</span>
                  {s.stats?.tokens ? <span className="shrink-0">{s.stats.tokens} tokens</span> : null}
                  {s.stats?.icons ? <span className="shrink-0">{s.stats.icons} icons</span> : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Viewer */}
      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <div className="flex items-center gap-1 border-b border-[#E2E8F0] px-2 py-1.5">
          <button
            onClick={() => setActive('hub')}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              active === 'hub' ? 'bg-[#F8FAFC] font-medium text-[#0F172B]' : 'text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]'
            }`}
          >
            Hub
          </button>
          {(sources ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                active === s.id ? 'bg-[#F8FAFC] font-medium text-[#0F172B]' : 'text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          title="Design library viewer"
          className="h-[72vh] w-full bg-white"
        />
      </div>

      <p className="mt-3 text-xs text-[#90A1B9]">
        To capture a new source, ask Claude Code: <span className="rounded bg-[#F1F5F9] px-1.5 py-0.5 font-mono text-[11px] text-[#62748E]">Add &lt;url&gt; to the design library</span> — it lands in <span className="font-mono text-[11px]">admin/public/design-library/</span> and registers itself here.
      </p>
    </div>
  );
}
