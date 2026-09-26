'use client';
import { useParams, useRouter } from 'next/navigation';
import AdminSquadBotDetail from '@/views/admin/AdminSquadBotDetail';

export default function SquadBotDetailPage() {
  const params = useParams();
  const router = useRouter();
  return <AdminSquadBotDetail botId={params.id as string} onBack={() => router.push('/admin/squad-bots')} />;
}
