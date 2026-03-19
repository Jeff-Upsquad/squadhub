-- ============================================================
-- Migration 004: Custom Roles System
-- Creates a roles table for granular permission management
-- and links workspace_members to custom roles
-- ============================================================

-- 1. Create roles table (platform-wide, since there's one workspace)
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#888888',
  permissions JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seed default roles
INSERT INTO roles (name, color, permissions, is_default) VALUES
  ('Member', '#22c55e', '{"can_manage_channels":false,"can_delete_messages":false,"can_manage_members":false,"can_manage_tasks":true,"can_manage_roles":false,"can_view_admin_panel":false,"can_manage_workspace":false}', true),
  ('Moderator', '#a855f7', '{"can_manage_channels":true,"can_delete_messages":true,"can_manage_members":false,"can_manage_tasks":true,"can_manage_roles":false,"can_view_admin_panel":false,"can_manage_workspace":false}', false);

-- 3. Add role_id column to workspace_members
ALTER TABLE workspace_members ADD COLUMN role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

-- 4. Backfill existing members with the default "Member" role
UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE is_default = true LIMIT 1);
