import { supabaseAdmin } from '../supabase';

// Shared helpers for the workspace `projects` entity. Areas (spaces), Spaces
// (folders), and lists reference a project via project_id — these keep the
// "project must live in the same workspace" rule in one place.

/**
 * Resolve the workspace a container belongs to (a folder/list reaches it via
 * its space). Returns null when the container doesn't exist.
 */
export async function containerWorkspaceId(
  type: 'space' | 'folder' | 'list',
  id: string,
): Promise<string | null> {
  if (type === 'space') {
    const { data } = await supabaseAdmin.from('spaces').select('workspace_id').eq('id', id).maybeSingle();
    return data?.workspace_id ?? null;
  }
  const { data } = await supabaseAdmin
    .from(type === 'folder' ? 'folders' : 'lists')
    .select('space_id')
    .eq('id', id)
    .maybeSingle();
  if (!data?.space_id) return null;
  const { data: space } = await supabaseAdmin.from('spaces').select('workspace_id').eq('id', data.space_id).maybeSingle();
  return space?.workspace_id ?? null;
}

/**
 * Validate that `projectId` is a live project inside `workspaceId`. Returns an
 * error message the caller can send to the client, or null when usable.
 */
export async function projectAssignmentError(
  projectId: string,
  workspaceId: string | null,
): Promise<string | null> {
  if (!workspaceId) return 'Container not found';
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  return data ? null : 'Project not found in this workspace';
}
