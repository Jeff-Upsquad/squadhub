'use client';
import AdminLmsAssignments from '@/views/admin/AdminLmsAssignments';
import { useParams } from 'next/navigation';

export default function LearningAssignmentsPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id) return null;
  return <AdminLmsAssignments itemId={id} />;
}
