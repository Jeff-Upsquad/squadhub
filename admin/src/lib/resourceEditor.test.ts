import { afterEach, describe, expect, it, vi } from 'vitest';
import { resourceEditorUrl } from './resourceEditor';

afterEach(() => vi.unstubAllEnvs());

describe('knowledge doc editor links', () => {
  it('opens the main production app rather than the admin origin', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    const url = new URL(resourceEditorUrl('doc-id', 'page-id'));
    expect(url.origin).toBe('https://squadhub.in');
    expect(url.pathname).toBe('/app');
    expect(Object.fromEntries(url.searchParams)).toEqual({ open_resource: 'doc-id', resource_page: 'page-id', edit_resource: '1' });
  });

  it('uses a configured main app URL without doubling slashes', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://preview.example.test/');
    expect(resourceEditorUrl('doc-id')).toBe('https://preview.example.test/app?open_resource=doc-id&edit_resource=1');
  });
});
