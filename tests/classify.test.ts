import { describe, expect, test } from 'vitest';
import { classifyQuestion } from '../src/exams/classify';
import type { Block, QuestionDraft } from '../src/exams/model';

const draft = (sectionType?: QuestionDraft['sectionType']): QuestionDraft => ({
  id: 'q1',
  sourceId: 'paper',
  originalNumber: '1',
  sectionTitle: sectionType ? '栏目' : undefined,
  sectionType,
  startBlock: 0,
  endBlock: 1,
  issues: [],
});

const blocks = (text: string): Block[] => [{
  index: 0,
  kind: 'paragraph',
  text,
  xml: '',
  relationshipIds: [],
  hasFormula: false,
  issues: [],
}];

describe('classifyQuestion', () => {
  test('uses an explicit supported section before question wording', () => {
    const result = classifyQuestion(draft('solution'), blocks('从 A、B、C、D 中选择并说明理由'));
    expect(result.type).toBe('solution');
    expect(result.reason).toContain('栏目');
  });

  test.each([
    ['A. 红 B. 黄 C. 蓝 D. 绿', 'choice'],
    ['请在横线 ______ 上填入合适的数', 'fill'],
    ['求函数最值。（1）写出定义域（2）证明结论', 'solution'],
  ] as const)('classifies clear structure “%s” as %s', (text, expected) => {
    expect(classifyQuestion(draft(), blocks(text)).type).toBe(expected);
  });

  test('keeps conflicting or unsupported evidence in review', () => {
    expect(classifyQuestion(draft(), blocks('A. 1 B. 2 C. 3 D. 4，请填在横线____')).type).toBe('unknown');
    expect(classifyQuestion(draft('unsupported'), blocks('A. 对 B. 错')).type).toBe('unknown');
  });
});
