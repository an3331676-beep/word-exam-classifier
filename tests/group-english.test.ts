import { describe, expect, test } from 'vitest';
import { groupEnglishQuestions } from '../src/exams/group-english';
import type { Block, ClassifiedQuestion, ParsedExam } from '../src/exams/model';

const block = (index: number, text: string): Block => ({
  index,
  kind: 'paragraph',
  text,
  xml: `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
  relationshipIds: [],
  hasFormula: false,
  issues: [],
});

const question = (
  id: string,
  type: 'reading' | 'cloze',
  startBlock: number,
  endBlock: number,
): ClassifiedQuestion => ({
  id,
  sourceId: 'exam',
  originalNumber: id.replace(/\D/g, ''),
  sectionTitle: type === 'reading' ? '四、阅读理解' : '五、完形填空',
  sectionType: type,
  startBlock,
  endBlock,
  issues: [],
  type,
  reason: '栏目识别',
});

const examWith = (blocks: Block[]): ParsedExam => ({
  source: { id: 'exam', fileName: '英语卷.docx' },
  blocks,
  resources: new Map(),
  issues: [],
});

describe('groupEnglishQuestions', () => {
  test('groups explicit passages and trims the previous question before the next passage', () => {
    const exam = examWith([
      block(0, '四、阅读理解'),
      block(1, 'Passage A'),
      block(2, 'Article A text.'),
      block(3, '21. Question one'),
      block(4, 'A. One B. Two C. Three D. Four'),
      block(5, '22. Question two'),
      block(6, 'A. One B. Two C. Three D. Four'),
      block(7, 'Passage B'),
      block(8, 'Article B text.'),
      block(9, '31. Question three'),
      block(10, 'A. One B. Two C. Three D. Four'),
    ]);

    const result = groupEnglishQuestions(exam, [
      question('q21', 'reading', 3, 5),
      question('q22', 'reading', 5, 9),
      question('q31', 'reading', 9, 11),
    ]);

    expect(result.groups.map((group) => ({
      originalLabel: group.originalLabel,
      materialStartBlock: group.materialStartBlock,
      materialEndBlock: group.materialEndBlock,
      questionIds: group.questionIds,
    }))).toEqual([
      { originalLabel: 'Passage A', materialStartBlock: 1, materialEndBlock: 3, questionIds: ['q21', 'q22'] },
      { originalLabel: 'Passage B', materialStartBlock: 7, materialEndBlock: 9, questionIds: ['q31'] },
    ]);
    expect(result.questions.find((item) => item.id === 'q22')?.endBlock).toBe(7);
    expect(result.questions.map((item) => item.groupId)).toEqual([
      result.groups[0].id,
      result.groups[0].id,
      result.groups[1].id,
    ]);
  });

  test('creates one inferred article group when passage labels are absent', () => {
    const exam = examWith([
      block(0, '五、完形填空'),
      block(1, 'When I was young, there was a blank in the story.'),
      block(2, '1. A. went B. goes C. go D. going'),
      block(3, '2. A. happy B. happily C. happiness D. happier'),
    ]);

    const result = groupEnglishQuestions(exam, [
      question('q1', 'cloze', 2, 3),
      question('q2', 'cloze', 3, 4),
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      type: 'cloze',
      materialStartBlock: 1,
      materialEndBlock: 2,
      questionIds: ['q1', 'q2'],
    });
  });
});
