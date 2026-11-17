import { describe, expect, test } from 'vitest';
import { associateAnswers, parseAnswerBlocks } from '../src/exams/answers';
import type { Block, ClassifiedQuestion, QuestionGroup } from '../src/exams/model';

const answerBlock = (index: number, text: string): Block => ({
  index,
  kind: 'paragraph',
  text,
  xml: '',
  relationshipIds: [],
  hasFormula: false,
  issues: [],
});

const questions: ClassifiedQuestion[] = [21, 22, 23].map((originalNumber, index) => ({
  id: `q${originalNumber}`,
  sourceId: 'paper',
  originalNumber: String(originalNumber),
  startBlock: index,
  endBlock: index + 1,
  issues: [],
  type: 'reading',
  reason: '栏目识别',
  groupId: index < 2 ? 'g1' : 'g2',
  outputNumber: index + 1,
}));

const groups: QuestionGroup[] = [
  {
    id: 'g1', sourceId: 'paper', type: 'reading', originalLabel: 'Passage A',
    materialStartBlock: 0, materialEndBlock: 1, questionIds: ['q21', 'q22'], issues: [],
  },
  {
    id: 'g2', sourceId: 'paper', type: 'reading', originalLabel: 'Passage B',
    materialStartBlock: 3, materialEndBlock: 4, questionIds: ['q23'], issues: [],
  },
];

describe('answers', () => {
  test('maps original answer numbers while preserving passage order', () => {
    const answers = parseAnswerBlocks('paper', [
      answerBlock(10, 'Passage A'),
      answerBlock(11, '21. A 解析：定位第一段。'),
      answerBlock(12, '22. B'),
      answerBlock(13, 'Passage B'),
      answerBlock(14, '23. C 解析：定位第二篇。'),
    ]);
    const mapped = associateAnswers(answers, questions, groups);

    expect(mapped.answers.map((answer) => [answer.questionId, answer.originalNumber, answer.groupLabel])).toEqual([
      ['q21', '21', 'Passage A'],
      ['q22', '22', 'Passage A'],
      ['q23', '23', 'Passage B'],
    ]);
    expect(mapped.questions.map((question) => question.answerId)).toEqual(
      mapped.answers.map((answer) => answer.id),
    );
    expect(mapped.reviewItems).toEqual([]);
  });

  test('marks duplicate answer numbers for review', () => {
    const parsed = parseAnswerBlocks('paper', [
      answerBlock(10, '21. A'),
      answerBlock(11, '21. B'),
    ]);
    expect(parsed.filter((answer) => answer.issues.includes('答案编号重复'))).toHaveLength(2);
  });

  test('uses the next unmatched question for an unnumbered answer', () => {
    const answers = parseAnswerBlocks('paper', [
      answerBlock(10, '21. A'),
      answerBlock(11, 'B，解析：第二题'),
    ]);
    const mapped = associateAnswers(answers, questions.slice(0, 2), groups.slice(0, 1));
    expect(mapped.answers.map((answer) => answer.questionId)).toEqual(['q21', 'q22']);
  });
});
