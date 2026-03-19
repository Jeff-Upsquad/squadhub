import { Outlet, useNavigate, NavLink } from 'react-router-dom';

export default function WorkspaceAdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-[#ededed]">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-[#222] bg-[#0a0a0a]">
        <div className="flex items-center gap-2 border-b border-[#222] px-5 py-4">
          <h1 className="text-lg font-semibold text-[#ededed]">Workspace</h1>
          <span className="rounded-full bg-[#ededed]/10 px-2 py-0.5 text-[10px] font-medium text-[#888]">Settings</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          <NavLink
            to="/workspace-admin"
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                isActive ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#888] hover:bg-[#111] hover:text-[#ededed]'
              }`
            }
          >
            Settings
          </NavLink>
          <NavLink
            to="/workspace-admin/members"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                isActive ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#888] hover:bg-[#111] hover:text-[#ededed]'
              }`
            }
          >
            Members
          </NavLink>
        </nav>
        <div className="border-t border-[#222] p-3">
          <button
            onClick={() => navigate('/')}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[#888] hover:bg-[#111] hover:text-[#ededed]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
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
