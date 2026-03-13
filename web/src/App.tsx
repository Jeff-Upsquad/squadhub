import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import MainLayout from './layouts/MainLayout';
import MasterAdminLayout from './layouts/MasterAdminLayout';
import WorkspaceAdminLayout from './layouts/WorkspaceAdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminWorkspaces from './pages/admin/AdminWorkspaces';
import WsAdminSettings from './pages/workspace-admin/WsAdminSettings';
import WsAdminMembers from './pages/workspace-admin/WsAdminMembers';

// Protect routes that require authentication
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Redirect authenticated users away from auth pages
function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Require platform admin role
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Auth */}
      <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
      <Route path="/signup" element={<GuestRoute><SignupPage /></GuestRoute>} />

      {/* Master Admin — platform owner */}
      <Route path="/admin" element={<RequireAdmin><MasterAdminLayout /></RequireAdmin>}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="workspaces" element={<AdminWorkspaces />} />
      </Route>

      {/* Workspace Admin — workspace owner/admin */}
      <Route path="/workspace-admin" element={<ProtectedRoute><WorkspaceAdminLayout /></ProtectedRoute>}>
        <Route index element={<WsAdminSettings />} />
        <Route path="members" element={<WsAdminMembers />} />
      </Route>

      {/* Main App — Chat + PM */}
      <Route path="/*" element={<ProtectedRoute><MainLayout /></ProtectedRoute>} />
    </Routes>
  );
}
