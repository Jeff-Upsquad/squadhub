import { redirect } from 'next/navigation';

// The Mac/Windows desktop download lives on the combined download page now —
// alongside the menu-bar companion. Keep this route as a redirect so old links
// and bookmarks still land in the right place.
export default function DesktopRedirect() {
  redirect('/download-app');
}
