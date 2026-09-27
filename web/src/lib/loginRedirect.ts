/** Only allow same-origin app paths after signing in. */
export function loginRedirect(search: string): string {
  const redirect = new URLSearchParams(search).get('redirect');
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//') || /[\\\u0000-\u0020]/.test(redirect)) return '/app';
  return redirect;
}
