import { describe, expect, test } from 'vitest';
import { importBatch } from '../src/exams/import-batch';
import { createDocxFixture } from './helpers/docx-fixture';

const upload = (name: string, bytes: Uint8Array) => ({
  name,
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

describe('importBatch', () => {
  test('keeps duplicate file names and isolates a broken document', async () => {
    const valid = await createDocxFixture([
      { text: '一、选择题' },
      { text: '1. 题干' },
      { text: 'A. 甲 B. 乙 C. 丙 D. 丁' },
    ]);

    const result = await importBatch([
      upload('同名卷.docx', valid),
      upload('损坏.docx', new Uint8Array([1, 2, 3])),
      upload('同名卷.docx', valid),
    ]);

    expect(result.exams).toHaveLength(2);
    expect(result.exams[0].source.id).not.toBe(result.exams[1].source.id);
    expect(result.questions).toHaveLength(2);
    expect(result.questions.every((question) => question.originalNumber === '1')).toBe(true);
    expect(result.fileErrors).toEqual([{ fileName: '损坏.docx', message: expect.stringContaining('无法读取') }]);
  });
});
