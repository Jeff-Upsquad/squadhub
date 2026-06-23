import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../../services/api';
import { IconClose, IconPlus } from './atoms/Icons';
import type { AccessLevel } from '@squadhub/shared';

interface PoolUser {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  user_type: string;
  client_role: { id: string; name: string; color: string } | null;
}

interface FolderMember {
  id: string;
  user_id: string;
  access_level: AccessLevel;
  user?: { id: string; display_name: string; email: string; avatar_url: string | null };
}

const ACCESS_LEVELS: { value: AccessLevel; label: string }[] = [
  { value: 'viewer', label: 'View only' },
  { value: 'commenter', label: 'Comment only' },
  { value: 'member', label: 'Full access' },
  { value: 'manager', label: 'Manager' },
];

// Platform user-type chip (Internal / Client / Partner)
const USER_TYPE_STYLES: Record<string, { label: string; bg: string; fg: string }> = {
  internal: { label: 'Internal', bg: '#EEF2FF', fg: '#3730A3' },
  client: { label: 'Client', bg: '#ECFDF5', fg: '#065F46' },
  partner: { label: 'Partner', bg: '#F5F3FF', fg: '#5B21B6' },
};

function UserTypeChip({ userType }: { userType?: string | null }) {
  if (!userType) return null;
  const s = USER_TYPE_STYLES[userType] || { label: userType, bg: 'var(--cd-bg-2)', fg: 'var(--cd-fg-2)' };
  return (
    <span
      style={{
        padding: '1px 6px',
        borderRadius: 8,
        background: s.bg,
        color: s.fg,
        fontSize: 9.5,
        fontWeight: 600,
      }}
      title={`User type: ${s.label}`}
    >
      {s.label}
    </span>
  );
}

export default function SquadShareModal({
  folderId,
  folderName,
  onClose,
}: {
  folderId: string;
  folderName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingLevel, setPendingLevel] = useState<Record<string, AccessLevel>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data: pool = [] } = useQuery<PoolUser[]>({
    queryKey: ['squad-pool', folderId],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/${folderId}/squad-pool`);
      return res.data.data;
    },
    enabled: showAdd,
  });

  const { data: members = [] } = useQuery<FolderMember[]>({
    queryKey: ['folder-members', folderId],
    queryFn: async () => {
      const res = await api.get(`/memberships?resource_type=folder&resource_id=${folderId}`);
      return res.data.data;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['folder-members', folderId] });
    qc.invalidateQueries({ queryKey: ['squad-pool', folderId] });
  };

  const addMember = useMutation({
    mutationFn: (body: { user_id: string; access_level: AccessLevel }) =>
      api.post('/memberships', {
        resource_type: 'folder',
        resource_id: folderId,
        ...body,
      }),
    onSuccess: () => { invalidate(); setPendingLevel({}); },
  });

  const updateMember = useMutation({
    mutationFn: ({ id, access_level }: { id: string; access_level: AccessLevel }) =>
      api.put(`/memberships/${id}`, { access_level }),
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (id: string) => api.delete(`/memberships/${id}`),
    onSuccess: invalidate,
  });

  const filteredPool = pool.filter(
    (u) =>
      !search ||
      u.display_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="cd-root" style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <div className="cd-modal-backdrop" onClick={onClose}>
        <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cd-modal-head">
            <span className="tag">SHARE</span>
            <span className="cd-modal-title">{folderName}</span>
            <button className="cd-modal-close" onClick={onClose} aria-label="Close">
              <IconClose size={14} />
            </button>
          </div>

          <div className="cd-modal-body">
            <p style={{ fontSize: 12, color: 'var(--cd-fg-2)', margin: '4px 0 12px' }}>
              You can invite users who already have access to this client.
            </p>

            {/* Add user section */}
            {!showAdd ? (
              <button
                className="cd-btn"
                style={{ width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => setShowAdd(true)}
                type="button"
              >
                <IconPlus size={12} /> Add user
              </button>
            ) : (
              <div
                style={{
                  border: '1px solid var(--cd-br-1)',
                  borderRadius: 6,
                  padding: 10,
                  background: 'var(--cd-bg-2)',
                }}
              >
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  className="cd-input"
                  style={{
                    background: 'var(--cd-bg-1)',
                    border: '1px solid var(--cd-br-1)',
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontSize: 12,
                    width: '100%',
                    marginBottom: 8,
                  }}
                />
                <div style={{ maxHeight: 240, overflow: 'auto' }}>
                  {filteredPool.length === 0 ? (
                    <p style={{ fontSize: 11, color: 'var(--cd-fg-3)', padding: '8px 4px' }}>
                      No more users available. Ask an admin to add more users in Client Access.
                    </p>
                  ) : (
                    filteredPool.map((u) => {
                      const level = pendingLevel[u.id] || 'member';
                      return (
                        <div
                          key={u.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 4px',
                            borderBottom: '1px solid var(--cd-br-0)',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 12.5,
                                fontWeight: 500,
                                color: 'var(--cd-fg-0)',
                              }}
                            >
                              <span>{u.display_name}</span>
                              <UserTypeChip userType={u.user_type} />
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--cd-fg-2)' }}>
                              {u.email}
                              {u.client_role && (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    padding: '0 6px',
                                    borderRadius: 8,
                                    background: u.client_role.color + '22',
                                    color: u.client_role.color,
                                    fontFamily: 'var(--cd-font-mono)',
                                    fontSize: 9.5,
                                  }}
                                  title={`Client-access role: ${u.client_role.name}`}
                                >
                                  {u.client_role.name}
                                </span>
                              )}
                            </div>
                          </div>
                          <select
                            value={level}
                            onChange={(e) => setPendingLevel((p) => ({ ...p, [u.id]: e.target.value as AccessLevel }))}
                            style={{
                              fontSize: 11,
                              padding: '4px 6px',
                              border: '1px solid var(--cd-br-1)',
                              borderRadius: 4,
                              background: 'var(--cd-bg-1)',
                            }}
                          >
                            {ACCESS_LEVELS.map((l) => (
                              <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="cd-btn primary"
                            disabled={addMember.isPending}
                            onClick={() => addMember.mutate({ user_id: u.id, access_level: level })}
                            style={{ padding: '4px 10px', fontSize: 11 }}
                          >
                            Add
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setSearch(''); }}
                  style={{
                    marginTop: 8,
                    fontSize: 10.5,
                    color: 'var(--cd-fg-3)',
                    background: 'none',
                    border: 0,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Current members */}
            <div className="cd-sub-head" style={{ marginTop: 18 }}>
              People with access ({members.length})
            </div>
            {members.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--cd-fg-3)', padding: '8px 0' }}>
                No one has been invited yet.
              </p>
            ) : (
              <div>
                {members.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--cd-br-0)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: 'var(--cd-fg-0)',
                        }}
                      >
                        <span>{m.user?.display_name || 'Unknown'}</span>
                        <UserTypeChip userType={(m.user as any)?.user_type} />
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--cd-fg-2)' }}>{m.user?.email || ''}</div>
                    </div>
                    <select
                      value={m.access_level}
                      onChange={(e) => updateMember.mutate({ id: m.id, access_level: e.target.value as AccessLevel })}
                      style={{
                        fontSize: 11,
                        padding: '4px 6px',
                        border: '1px solid var(--cd-br-1)',
                        borderRadius: 4,
                        background: 'var(--cd-bg-1)',
                      }}
                    >
                      {ACCESS_LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                    <button
                      className="cd-modal-close"
                      onClick={() => removeMember.mutate(m.id)}
                      title="Remove"
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cd-modal-foot">
            <div className="estimate" />
            <button className="cd-btn" onClick={onClose} type="button">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
