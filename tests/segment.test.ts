import { describe, expect, test } from 'vitest';
import type { Block, ParsedExam } from '../src/exams/model';
import { segmentExam } from '../src/exams/segment';

const block = (index: number, text: string, number?: number): Block => ({
  index,
  kind: 'paragraph',
  text,
  xml: `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
  relationshipIds: [],
  hasFormula: false,
  issues: [],
  ...(number ? { number: { value: number, level: 0, numId: '1', label: `${number}.` } } : {}),
});

const examWith = (blocks: Block[]): ParsedExam => ({
  source: { id: 'exam', fileName: '边界卷.docx' },
  blocks,
  resources: new Map(),
  issues: [],
});

describe('segmentExam', () => {
  test('keeps options, page continuations and subquestions with their main question', () => {
    const exam = examWith([
      block(0, '一、选择题'),
      block(1, '第一题题干', 1),
      block(2, 'A. 甲'),
      block(3, 'B. 乙 C. 丙 D. 丁'),
      block(4, '第二题题干', 2),
      block(5, '（1）第一小问'),
      block(6, '换页后的第二小问'),
      block(7, '二、解答题'),
      block(8, '求证结论', 3),
      block(9, '解：先连接辅助线'),
      block(10, '参考答案'),
      block(11, '1. A'),
    ]);

    const result = segmentExam(exam);

    expect(result.questions.map(({ originalNumber, startBlock, endBlock, sectionType }) => ({
      originalNumber,
      startBlock,
      endBlock,
      sectionType,
    }))).toEqual([
      { originalNumber: '1', startBlock: 1, endBlock: 4, sectionType: 'choice' },
      { originalNumber: '2', startBlock: 4, endBlock: 7, sectionType: 'choice' },
      { originalNumber: '3', startBlock: 8, endBlock: 10, sectionType: 'solution' },
    ]);
    expect(result.questions[1].endBlock).toBe(7);
  });

  test('marks same-paragraph multiple questions and unsupported sections for review', () => {
    const exam = examWith([
      block(0, '四、判断题'),
      block(1, '1. 地球是球体。 2. 月亮会发光。'),
    ]);

    const result = segmentExam(exam);

    expect(result.questions[0].sectionType).toBe('unsupported');
    expect(result.reviewItems.map((item) => item.reason).join(' ')).toContain('同一段落疑似包含多道题');
  });

  test('does not treat a sentence mentioning a question type as a section heading', () => {
    const exam = examWith([
      block(0, '一、解答题'),
      block(1, '请完成下面的问题', 1),
      block(2, '这道题包含选择题常见的四个选项，但需要说明理由。'),
      block(3, '第二题', 2),
    ]);

    const result = segmentExam(exam);

    expect(result.questions[0]).toMatchObject({ startBlock: 1, endBlock: 3, sectionType: 'solution' });
    expect(result.questions).toHaveLength(2);
  });

  test.each([
    ['四、阅读理解（共两篇）', 'reading'],
    ['Reading Comprehension', 'reading'],
    ['五、完形填空', 'cloze'],
    ['Cloze Test (15 points)', 'cloze'],
  ] as const)('recognizes English section %s', (title, sectionType) => {
    const result = segmentExam(examWith([
      block(0, title),
      block(1, '1. Which statement is correct?'),
    ]));
    expect(result.questions[0].sectionType).toBe(sectionType);
  });

  test('retains the independent answer section after finishing questions', () => {
    const result = segmentExam(examWith([
      block(0, '一、选择题'),
      block(1, '1. 题干'),
      block(2, '参考答案'),
      block(3, '1. A，解析：根据原文可知。'),
    ]));
    expect(result.questions[0]).toMatchObject({ startBlock: 1, endBlock: 2 });
    expect(result.answerBlocks.map((item) => item.index)).toEqual([3]);
  });

  test('does not treat a question sentence as an English section title', () => {
    const result = segmentExam(examWith([
      block(0, '一、解答题'),
      block(1, '1. 请说明阅读理解题的解题步骤'),
      block(2, '继续说明'),
    ]));
    expect(result.questions[0].endBlock).toBe(3);
  });
});
