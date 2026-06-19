// Shared SquadNotes client types. Note content is a Tiptap JSON doc, stored
// opaquely (shape owned by the editor), so it's typed as `unknown` here.

export type NoteTextSize = 'small' | 'normal' | 'large';
export type NoteVisibility = 'private' | 'shared';
export type NoteGranteeType = 'user' | 'role' | 'department';
export type NoteAccessLevel = 'read' | 'edit';

// Light fields returned for the sidebar tree.
export interface NoteTreeItem {
  id: string;
  parent_id: string | null;
  root_id: string | null;
  title: string;
  icon: string | null;
  position: number;
  owner_id: string;
  visibility: NoteVisibility;
  updated_at: string;
}

// A full page.
export interface Note extends NoteTreeItem {
  workspace_id: string;
  cover_url: string | null;
  text_size: NoteTextSize;
  full_width: boolean;
  content: unknown; // Tiptap JSON doc
  created_by: string | null;
  last_edited_by: string | null;
  created_at: string;
  deleted_at: string | null;
  // Present on GET /notes/:id — the caller's access level for this note.
  access?: NoteAccessLevel;
}

export interface GranteeOption {
  id: string;
  name: string;
}

export interface NoteShare {
  id: string;
  grantee_type: NoteGranteeType;
  grantee_id: string;
  access_level: NoteAccessLevel;
  label: string;
  avatar_url: string | null;
}

export interface NoteSharesResponse {
  root_id: string;
  visibility: NoteVisibility;
  shares: NoteShare[];
}

export interface NoteTrashItem {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  deleted_at: string;
  owner_id: string;
}

export interface UnfurlResult {
  kind: 'bookmark' | 'clip-embed';
  url: string;
  embed_url?: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
  favicon?: string;
}

// Patch shape accepted by PATCH /notes/:id.
export interface NotePatch {
  title?: string;
  content?: unknown;
  icon?: string | null;
  cover_url?: string | null;
  text_size?: NoteTextSize;
  full_width?: boolean;
  position?: number;
}
