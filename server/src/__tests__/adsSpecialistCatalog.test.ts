import { describe, expect, it } from 'vitest';
import { additionalRequirementCatalog } from '@squadhub/shared';

describe('Ads Specialist requirement catalog', () => {
  it('uses Ads-specific skills, tools, and AI tools', () => {
    const groups = additionalRequirementCatalog('ads_specialist');

    expect(groups.map((group) => group.key)).toEqual(['skills', 'tools', 'ai_tools']);
    expect(groups.find((group) => group.key === 'skills')?.options).toContain('Paid media strategy');
    expect(groups.find((group) => group.key === 'tools')?.options).toContain('Meta Ads Manager');
    expect(groups.find((group) => group.key === 'ai_tools')?.options).toContain('ChatGPT');
    expect(groups.flatMap((group) => group.options)).not.toContain('Brand identity');
  });
});
