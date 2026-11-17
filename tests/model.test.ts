import { describe, expect, test } from 'vitest';
import { isEnglishQuestionType } from '../src/exams/model';

describe('question type model', () => {
  test('recognizes reading and cloze as grouped English types', () => {
    expect(isEnglishQuestionType('reading')).toBe(true);
    expect(isEnglishQuestionType('cloze')).toBe(true);
    expect(isEnglishQuestionType('choice')).toBe(false);
  });
});
