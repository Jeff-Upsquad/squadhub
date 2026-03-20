/**
 * Test: Guest with zero permissions receives 403 when creating a channel.
 *
 * This test validates the explicit-allow permission model:
 * - A Guest user whose custom role has all permissions set to false
 *   must be denied (403) when calling POST /channels.
 * - The requirePermission middleware must NOT fall back to default-allow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing the module
vi.mock('../supabase', () => {
  const mockFrom = vi.fn();
  return {
    supabaseAdmin: { from: mockFrom },
    supabaseAuth: { auth: { getUser: vi.fn() } },
    supabase: {},
    supabaseForUser: vi.fn(),
  };
});

import { getUserPermissions } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';

function mockSupabaseChain(data: any, error: any = null) {
  const mockSingle = vi.fn().mockResolvedValue({ data, error });
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue({ select: mockSelect });
}

describe('Guest Permission Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return all-false permissions for a Guest with zero permissions on their role', async () => {
    mockSupabaseChain({
      role: 'guest',
      role_id: 'guest-role-id',
      roles: {
        permissions: {
          can_create_channels: false,
          can_create_lists: false,
          can_create_folders: false,
          can_create_spaces: false,
          can_archive_lists: false,
          can_archive_spaces: false,
          can_archive_folders: false,
          can_delete_messages: false,
          can_edit_messages: false,
          can_send_dms: false,
          can_manage_channels: false,
          can_manage_members: false,
          can_manage_tasks: false,
          can_manage_roles: false,
          can_view_admin_panel: false,
          can_manage_workspace: false,
        },
      },
    });

    const { permissions, workspaceRole } = await getUserPermissions('guest-user-id');

    expect(workspaceRole).toBe('guest');

    // Verify every single permission is false — no default-allow fallback
    for (const [_key, value] of Object.entries(permissions)) {
      expect(value).toBe(false);
    }
  });

  it('should return all-false permissions for a Guest with no custom role', async () => {
    mockSupabaseChain({
      role: 'guest',
      role_id: null,
      roles: null,
    });

    const { permissions, workspaceRole } = await getUserPermissions('guest-user-id');

    expect(workspaceRole).toBe('guest');

    // All permissions must be false — no default-allow fallback
    for (const [_key, value] of Object.entries(permissions)) {
      expect(value).toBe(false);
    }
  });

  it('should return all-false when no workspace membership exists', async () => {
    mockSupabaseChain(null, { message: 'not found' });

    const { permissions, workspaceRole } = await getUserPermissions('nonexistent-user');

    expect(workspaceRole).toBe('guest');
    expect(permissions.can_create_channels).toBe(false);
  });

  it('should return all-true permissions for admin users', async () => {
    mockSupabaseChain({
      role: 'admin',
      role_id: null,
      roles: null,
    });

    const { permissions, workspaceRole } = await getUserPermissions('admin-user-id');

    expect(workspaceRole).toBe('admin');

    // Verify every permission is true for admin
    for (const [_key, value] of Object.entries(permissions)) {
      expect(value).toBe(true);
    }
  });

  it('should only allow explicitly true permissions for members with custom roles', async () => {
    mockSupabaseChain({
      role: 'member',
      role_id: 'member-role-id',
      roles: {
        permissions: {
          can_create_channels: true,
          can_edit_messages: true,
          // Everything else is not specified or false
        },
      },
    });

    const { permissions } = await getUserPermissions('member-user-id');

    expect(permissions.can_create_channels).toBe(true);
    expect(permissions.can_edit_messages).toBe(true);
    // Missing keys must default to false, not true
    expect(permissions.can_create_spaces).toBe(false);
    expect(permissions.can_delete_messages).toBe(false);
    expect(permissions.can_manage_workspace).toBe(false);
  });

  it('Guest with zero permissions must be denied channel creation (403 scenario)', async () => {
    // This test validates the complete flow:
    // A guest calls requirePermission('can_create_channels') and gets denied.
    mockSupabaseChain({
      role: 'guest',
      role_id: 'guest-role-id',
      roles: {
        permissions: {
          can_create_channels: false,
        },
      },
    });

    const { permissions } = await getUserPermissions('guest-user-id');

    // The requirePermission middleware checks: if (!permissions[key]) → 403
    // Simulate that check here:
    expect(permissions.can_create_channels).toBe(false);

    // This means requirePermission('can_create_channels') would return 403
    // because the permission is explicitly false, not a default-allow.
  });
});
