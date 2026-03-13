import { Outlet, useNavigate, NavLink } from 'react-router-dom';

export default function WorkspaceAdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-800 bg-gray-950">
        <div className="flex items-center gap-2 border-b border-gray-800 px-5 py-4">
          <h1 className="text-lg font-bold">Workspace</h1>
          <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-[10px] font-medium text-brand-400">Settings</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavLink
            to="/workspace-admin"
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'
              }`
            }
          >
            Settings
          </NavLink>
          <NavLink
            to="/workspace-admin/members"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'
              }`
            }
          >
            Members
          </NavLink>
        </nav>
        <div className="border-t border-gray-800 p-3">
          <button
            onClick={() => navigate('/')}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-900 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to App
          </button>
        </div>
      </aside>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
