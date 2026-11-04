import { describe, expect, it } from 'vitest';
import { SPECIALIST_ROLES, additionalRequirementCatalog } from '@squadhub/shared';
import { pipelineMatchesService, pipelineConflictsWithService } from '../utils/crmPipelineMatch';

describe('Squad commercial routing', () => {
  it('keeps specialists in their configured lead/deal families despite shared words', () => {
    for (const role of SPECIALIST_ROLES) {
      expect(pipelineMatchesService(`${role.pipeline} Deals`, role.pipeline)).toBe(true);
      for (const other of SPECIALIST_ROLES.filter((r) => r.slug !== role.slug)) {
        // Photographers and videographers intentionally share one pipeline.
        const sameFamily = other.pipeline === role.pipeline;
        expect(pipelineMatchesService(`${other.pipeline} Leads`, role.pipeline)).toBe(sameFamily);
        expect(pipelineConflictsWithService(`${other.pipeline} Leads`, role.pipeline)).toBe(!sameFamily);
      }
    }
    expect(pipelineMatchesService('Designer and Editor Deals', 'AI Video and Image Creators')).toBe(false);
    expect(pipelineMatchesService('Designer and Editor Leads', 'Editors')).toBe(true);
  });
  it('provides specialist catalogs rather than silently showing Designer skills', () => {
    for (const role of SPECIALIST_ROLES) {
      const groups = additionalRequirementCatalog(role.serviceSlug);
      expect(groups.find((g) => g.key === 'skills')?.options).toContain(role.skills[0]);
      expect(groups.find((g) => g.key === 'tools')?.options).toContain(role.tools[0]);
    }
  });
});
