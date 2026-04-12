'use client';
import { useParams, useRouter } from 'next/navigation';
import AdminCustomProfileDetail from '@/views/admin/AdminCustomProfileDetail';

export default function CustomProfileDetailPage() {
  const params = useParams();
  const router = useRouter();
  return (
    <AdminCustomProfileDetail
      profileId={params.id as string}
      onBack={() => router.push('/admin/custom-profiles')}
    />
  );
}
