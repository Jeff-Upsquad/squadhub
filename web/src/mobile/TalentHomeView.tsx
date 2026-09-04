'use client';

const TALENT_WEB_BASE = 'https://squadhire.upsquadconnect.com';

export default function TalentHomeView() {
  const src = `${TALENT_WEB_BASE}/talent/dashboard?in_app=1`;
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F5F5F6] pt-1">
      <iframe
        src={src}
        title="SquadHire Talent Dashboard"
        className="block h-[calc(100dvh-148px)] min-h-[520px] w-full flex-none border-0 bg-white"
        loading="lazy"
        style={{ display: 'block' }}
      />
      <div className="border-t border-[#E7E7EA] bg-white px-3 py-2 text-center">
        <a href={src} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#525252] hover:text-[#0a0a0a]">
          Open in SquadHire
        </a>
      </div>
    </div>
  );
}
