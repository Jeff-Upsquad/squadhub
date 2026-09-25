import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabaseAdmin: {} }));
vi.mock('../services/squadhireTraining', () => ({ deliver: vi.fn() }));

import { answerToDoc } from '../services/knowledgeFromSquadhire';

describe('answerToDoc', () => {
  it('turns blank-line paragraphs, bullets and numbered steps into a Tiptap doc', () => {
    const doc = answerToDoc('Payments land between the 5th and 15th.\n\n- Subscription\n- Assignments\n\n1. Open Settings\n2. Add bank details');
    expect(doc.content.map((n: any) => n.type)).toEqual(['paragraph', 'bulletList', 'orderedList']);
    expect(doc.content[1].content[1].content[0].content[0].text).toBe('Assignments');
    expect(doc.content[2].content[0].content[0].content[0].text).toBe('Open Settings');
  });

  it('keeps single line breaks inside a paragraph', () => {
    const doc = answerToDoc('Line one\nLine two');
    expect(doc.content[0].content.map((n: any) => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });
});
