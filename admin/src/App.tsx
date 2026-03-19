import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import MasterAdminLayout from './layouts/MasterAdminLayout';
import WorkspaceAdminLayout from './layouts/WorkspaceAdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminApprovals from './pages/admin/AdminApprovals';
import AdminUsers from './pages/admin/AdminUsers';
import AdminWorkspaces from './pages/admin/AdminWorkspaces';
import AdminRoles from './pages/admin/AdminRoles';
import WsAdminSettings from './pages/workspace-admin/WsAdminSettings';
import WsAdminMembers from './pages/workspace-admin/WsAdminMembers';

// Require authenticated admin user
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Require authenticated user (workspace admin doesn't need platform admin role)
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Redirect authenticated users away from login
function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Login */}
      <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />

      {/* Master Admin — platform owner */}
      <Route path="/" element={<RequireAdmin><MasterAdminLayout /></RequireAdmin>}>
        <Route index element={<AdminDashboard />} />
        <Route path="approvals" element={<AdminApprovals />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="roles" element={<AdminRoles />} />
        <Route path="workspaces" element={<AdminWorkspaces />} />
      </Route>

      {/* Workspace Admin — workspace owner/admin */}
      <Route path="/workspace-admin" element={<RequireAuth><WorkspaceAdminLayout /></RequireAuth>}>
        <Route index element={<WsAdminSettings />} />
        <Route path="members" element={<WsAdminMembers />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
