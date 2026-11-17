import { describe, expect, test } from 'vitest';
import { mergeWithNext, promoteReviewRange, splitQuestion, updateQuestionType } from '../src/exams/editor';
import type { ClassifiedQuestion } from '../src/exams/model';

const questions: ClassifiedQuestion[] = [
  {
    id: 'a', sourceId: 'paper', originalNumber: '1', startBlock: 2, endBlock: 5,
    issues: [], type: 'choice', reason: '栏目“选择题”',
  },
  {
    id: 'b', sourceId: 'paper', originalNumber: '2', startBlock: 5, endBlock: 8,
    issues: [], type: 'choice', reason: '栏目“选择题”',
  },
];

describe('question editor', () => {
  test('splits on an interior block without overlap and allows manual classification', () => {
    const split = splitQuestion(questions, 'a', 4);
    expect(split.map(({ startBlock, endBlock }) => [startBlock, endBlock])).toEqual([[2, 4], [4, 5], [5, 8]]);
    expect(updateQuestionType(split, split[1].id, 'fill')[1]).toMatchObject({ type: 'fill', reason: '人工调整' });
  });

  test('merges only adjacent questions from the same source', () => {
    expect(mergeWithNext(questions, 'a')).toHaveLength(1);
    expect(mergeWithNext(questions, 'a')[0]).toMatchObject({ startBlock: 2, endBlock: 8 });
  });

  test('promotes an unassigned review range without overlapping an existing question', () => {
    const promoted = promoteReviewRange(questions, {
      id: 'review', sourceId: 'paper', startBlock: 0, endBlock: 2, reason: '没有可靠题号',
    });
    expect(promoted[0]).toMatchObject({ startBlock: 0, endBlock: 2, type: 'unknown' });
    expect(promoteReviewRange(questions, {
      id: 'overlap', sourceId: 'paper', startBlock: 3, endBlock: 6, reason: '重叠',
    })).toBe(questions);
  });

  test('keeps the existing file order when a review range is promoted', () => {
    const ordered: ClassifiedQuestion[] = [
      { ...questions[0], id: 'source-2-q', sourceId: 'source-2' },
      { ...questions[1], id: 'source-10-q', sourceId: 'source-10' },
    ];
    const promoted = promoteReviewRange(ordered, {
      id: 'source-2-review', sourceId: 'source-2', startBlock: 0, endBlock: 2, reason: '漏题',
    });
    expect(promoted.map((question) => question.sourceId)).toEqual(['source-2', 'source-2', 'source-10']);
  });
});
