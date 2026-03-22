'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import CreateWorkspaceView from '@/views/app/CreateWorkspaceView';

export default function Dashboard() {
  const router = useRouter();
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);

  useEffect(() => {
    // If a workspace is selected, navigate to it
    if (currentWorkspace?.id) {
      router.push(`/app/workspace/${currentWorkspace.id}`);
    }
  }, [currentWorkspace?.id, router]);

  // Show create workspace view when no workspace is selected
  return <CreateWorkspaceView />;
}
