import { describe, expect, it } from 'vitest';
import {
  templateSlugsForServiceType,
  templateSlugsForSubscriptionSlug,
} from '../utils/activatedClientSpaceTypes';

describe('activated client-space template mapping', () => {
  it('creates a design space for designer subscriptions', () => {
    expect(templateSlugsForServiceType('Designers')).toEqual(['design-space']);
  });

  it('creates a video space for editor subscriptions', () => {
    expect(templateSlugsForServiceType('Editors')).toEqual(['video-editing-space']);
  });

  it('creates both spaces for combined subscriptions', () => {
    expect(templateSlugsForServiceType('Designer plus Editor')).toEqual([
      'design-space',
      'video-editing-space',
    ]);
  });

  it('does not invent a space when no matching template exists', () => {
    expect(templateSlugsForServiceType('Accountants')).toEqual([]);
    expect(templateSlugsForServiceType(null)).toEqual([]);
  });

  it('falls back to canonical subscription slugs for staged cards', () => {
    expect(templateSlugsForSubscriptionSlug('designer')).toEqual(['design-space']);
    expect(templateSlugsForSubscriptionSlug('video_editor')).toEqual(['video-editing-space']);
    expect(templateSlugsForSubscriptionSlug('designer_video_editor')).toEqual([
      'design-space',
      'video-editing-space',
    ]);
  });
});
