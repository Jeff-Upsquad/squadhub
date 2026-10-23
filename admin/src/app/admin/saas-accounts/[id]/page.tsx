'use client';
import { useParams } from 'next/navigation';
import SaasAccountDetail from '@/views/admin/saas/SaasAccountDetail';

export default function SaasAccountDetailPage() {
  const params = useParams();
  return <SaasAccountDetail accountId={decodeURIComponent(params.id as string)} />;
}
