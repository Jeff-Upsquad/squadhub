'use client';
import AdminLmsItemEditor from '@/views/admin/AdminLmsItemEditor';
import { useParams } from 'next/navigation';

export default function LearningItemPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id) return null;
  return <AdminLmsItemEditor itemId={id} />;
}
