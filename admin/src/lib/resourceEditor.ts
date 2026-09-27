/** Open the document in the main app's page editor. */
export function resourceEditorUrl(itemId: string, lessonId?: string | null): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === 'production' ? 'https://squadhub.in' : 'http://localhost:3000')).replace(/\/$/, '');
  const params = new URLSearchParams({ open_resource: itemId, edit_resource: '1' });
  if (lessonId) params.set('resource_page', lessonId);
  return `${base}/app?${params}`;
}
