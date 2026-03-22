'use client';
import { useParams, useRouter } from 'next/navigation';
import AdminMiniAppDetail from '@/views/admin/AdminMiniAppDetail';

export default function MiniAppDetailPage() {
  const params = useParams();
  const router = useRouter();
  return (
    <AdminMiniAppDetail
      miniAppId={params.id as string}
      onBack={() => router.push('/admin/mini-apps')}
    />
  );
}
