import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

export default function DeadlinesPanel() {
  const queryClient = useQueryClient();

  const { data: settingsRes } = useQuery({
    queryKey: ['admin-checkin-user-settings'],
    queryFn: () => api.get('/admin/checkin/user-settings').then((r) => r.data),
  });

  const { data: usersRes } = useQuery({
    queryKey: ['admin-users-checkin'],
    queryFn: () => api.get('/admin/users?limit=100').then((r) => r.data),
  });

  const updateDeadlineMutation = useMutation({
    mutationFn: (data: { userId: string; deadline_time: string }) =>
      api.put(`/admin/checkin/user-settings/${data.userId}`, { deadline_time: data.deadline_time }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-checkin-user-settings'] }),
  });

  const users = usersRes?.data || [];
  const userSettings = settingsRes?.data || [];
  const settingsMap = new Map<string, string>(userSettings.map((s: any) => [s.user_id, s.deadline_time]));

  return (
    <div className="rounded-xl border border-divider bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-divider text-left">
            <th className="px-5 py-3 text-xs font-medium text-foreground-muted">User</th>
            <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Email</th>
            <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Deadline (IST)</th>
            <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u: any) => {
            const deadline = settingsMap.get(u.id) || '10:00';
            return (
              <tr key={u.id} className="border-b border-divider last:border-0">
                <td className="px-5 py-3 text-sm text-foreground">{u.display_name}</td>
                <td className="px-5 py-3 text-sm text-foreground-muted">{u.email}</td>
                <td className="px-5 py-3">
                  <input
                    type="time"
                    defaultValue={deadline}
                    className="rounded border border-divider px-2 py-1 text-sm"
                    onBlur={(e) => {
                      if (e.target.value !== deadline) {
                        updateDeadlineMutation.mutate({ userId: u.id, deadline_time: e.target.value });
                      }
                    }}
                  />
                </td>
                <td className="px-5 py-3 text-xs text-foreground-dim">
                  {u.custom_role?.name || 'No role'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
