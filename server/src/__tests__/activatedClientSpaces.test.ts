import { describe, expect, it } from 'vitest';
import {
  brandFolderName,
  templateListRows,
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

describe('brand folder naming', () => {
  it('uses the company when brand_name is just the contact person', () => {
    expect(brandFolderName(
      { brand_name: 'Jeff', customer_name: 'Jeff', customer_company: 'tag connect' },
      { business_name: 'tag connect' },
    )).toBe('tag connect');
  });

  it('keeps a real brand that differs from the contact person', () => {
    expect(brandFolderName(
      { brand_name: 'Growth Digital Hub', customer_name: 'Majin', customer_company: 'Growth Digital Hub' },
      { business_name: 'Growth Digital Hub' },
    )).toBe('Growth Digital Hub');
  });
});

describe('template list rows', () => {
  it('omits default_view so drifted production lists tables still accept the insert', () => {
    const rows = templateListRows({
      spaceId: 'space-1',
      folderId: 'folder-1',
      actorId: 'actor-1',
      lists: [
        { name: 'Briefs', position: 0, default_view: 'list' } as { name: string; position?: number },
        { name: 'In Progress', position: 1 },
        { name: 'Reviews', position: 2 },
      ],
    });
    expect(rows).toEqual([
      { space_id: 'space-1', folder_id: 'folder-1', name: 'Briefs', position: 0, is_private: true, created_by: 'actor-1' },
      { space_id: 'space-1', folder_id: 'folder-1', name: 'In Progress', position: 1, is_private: true, created_by: 'actor-1' },
      { space_id: 'space-1', folder_id: 'folder-1', name: 'Reviews', position: 2, is_private: true, created_by: 'actor-1' },
    ]);
    expect(rows.every((row) => !('default_view' in row))).toBe(true);
  });
});
