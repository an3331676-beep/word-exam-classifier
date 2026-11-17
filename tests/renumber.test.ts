import { describe, expect, test } from 'vitest';
import { createNumberMap, renumberAllTypes, renumberQuestions } from '../src/exams/renumber';
import type { ClassifiedQuestion } from '../src/exams/model';

const question = (id: string, type: ClassifiedQuestion['type'], originalNumber: string): ClassifiedQuestion => ({
  id,
  sourceId: id.split('-')[0],
  originalNumber,
  startBlock: 0,
  endBlock: 1,
  issues: [],
  type,
  reason: '测试',
});

describe('renumberQuestions', () => {
  test('numbers only the selected type continuously in document order', () => {
    const input = [
      question('doc1-r21', 'reading', '21'),
      question('doc1-c1', 'choice', '1'),
      question('doc1-r22', 'reading', '22'),
      question('doc2-r1', 'reading', '1'),
    ];

    const result = renumberQuestions(input, 'reading');

    expect(result.numbering).toEqual([
      { questionId: 'doc1-r21', value: 1 },
      { questionId: 'doc1-r22', value: 2 },
      { questionId: 'doc2-r1', value: 3 },
    ]);
    expect(result.questions.map((item) => item.outputNumber)).toEqual([1, undefined, 2, 3]);
    expect(createNumberMap(result.numbering).get('doc2-r1')).toBe(3);
  });

  test('builds independent number sequences for all four export types', () => {
    const input = [
      question('a-c', 'choice', '8'),
      question('a-f', 'fill', '9'),
      question('a-r', 'reading', '21'),
      question('a-z', 'cloze', '31'),
      question('b-r', 'reading', '1'),
      question('b-c', 'choice', '2'),
    ];

    const result = renumberAllTypes(input);

    expect(result.numberingByType.choice?.map((item) => item.value)).toEqual([1, 2]);
    expect(result.numberingByType.fill?.map((item) => item.value)).toEqual([1]);
    expect(result.numberingByType.reading?.map((item) => item.value)).toEqual([1, 2]);
    expect(result.numberingByType.cloze?.map((item) => item.value)).toEqual([1]);
  });
});
