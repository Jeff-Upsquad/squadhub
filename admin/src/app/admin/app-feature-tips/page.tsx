'use client';

import AdminFeatureTips from '@/views/admin/feature-tips/AdminFeatureTips';

// "App Tooltips" — the same Feature Tips manager scoped to the native partner
// app (platform='app'). App tips target app screens/anchors and only ever show
// in the phone app, never on the web.
export default function AppFeatureTipsPage() {
  return <AdminFeatureTips platform="app" />;
}
