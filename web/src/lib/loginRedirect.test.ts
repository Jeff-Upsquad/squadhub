import { describe, expect, it } from 'vitest';
import { loginRedirect } from './loginRedirect';

describe('login return destination', () => {
  it('preserves the resource, page and edit request through sign-in', () => {
    const destination = '/app?open_resource=document-id&resource_page=page-id&edit_resource=1';
    expect(loginRedirect(`?redirect=${encodeURIComponent(destination)}`)).toBe(destination);
  });

  it.each(['https://example.com', '//example.com', '/\\example.com', '/\n/example.com', 'javascript:alert(1)'])('rejects an unsafe redirect: %s', (destination) => {
    expect(loginRedirect(`?redirect=${encodeURIComponent(destination)}`)).toBe('/app');
  });

  it('keeps ordinary logins working without a redirect', () => {
    expect(loginRedirect('')).toBe('/app');
  });
});
