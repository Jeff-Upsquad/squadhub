'use client';
import { useParams } from 'next/navigation';
import SquadBotsMoved from '@/components/SquadBotsMoved';
export default function SquadBotDetailPage() {
  const params = useParams();
  return <SquadBotsMoved section="settings" id={params.id as string} />;
}
