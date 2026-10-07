'use client';

export function squadBotsLocation(section: 'settings' | 'knowledge', id?: string) {
  const base = process.env.NEXT_PUBLIC_SQUAD_BOTS_URL || (process.env.NODE_ENV === 'production' ? 'https://bots.squadhub.in' : 'http://localhost:3020');
  const url = new URL(base);
  if (id) url.searchParams.set(section === 'settings' ? 'bot' : 'document', id);
  url.hash = section;
  return url.toString();
}
export default function SquadBotsMoved({ section, id }: { section: 'settings' | 'knowledge'; id?: string }) {
  return <div className="p-8"><h1 className="text-xl font-semibold">{section === 'settings' ? 'Bot management' : 'Knowledge documents'} lives in Squad Bots</h1><p className="mt-3 text-sm text-foreground-muted">Manage your bots, AI providers, jobs and shared knowledge in the independent Squad Bots workspace. Squad Hub connects to that service.</p><a className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 text-sm text-white" href={squadBotsLocation(section, id)}>Open Squad Bots {section === 'settings' ? 'Settings' : 'Knowledge'}</a></div>;
}
