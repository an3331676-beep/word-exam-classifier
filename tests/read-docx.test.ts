import { describe, expect, test } from 'vitest';
import { readDocx } from '../src/exams/read-docx';
import { createDocxFixture, source } from './helpers/docx-fixture';

describe('readDocx', () => {
  test('preserves body order, resolves automatic numbering and image relationships', async () => {
    const bytes = await createDocxFixture([
      { text: '一、选择题' },
      { text: '太阳从哪边升起？', numId: '1' },
      { text: 'A. 东  B. 西  C. 南  D. 北' },
      {
        text: '方向示意图',
        image: { relationshipId: 'rId5', fileName: 'image1.png', bytes: new Uint8Array([1, 2, 3]) },
      },
      { kind: 'table', text: '表格中的补充条件' },
    ]);

    const exam = await readDocx(bytes, source('paper-a', '甲卷.docx'));

    expect(exam.blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'table',
    ]);
    expect(exam.blocks[1].number).toMatchObject({ value: 1, level: 0, numId: '1' });
    expect(exam.blocks[3].relationshipIds).toEqual(['rId5']);
    expect(exam.resources.get('rId5')?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('keeps formulas in raw XML and reports an invalid Word package clearly', async () => {
    const bytes = await createDocxFixture([{ text: '计算', formula: 'x+1=2' }]);
    const exam = await readDocx(bytes, source('paper-b', '乙卷.docx'));
    expect(exam.blocks[0].hasFormula).toBe(true);
    expect(exam.blocks[0].xml).toContain('oMath');

    await expect(readDocx(new Uint8Array([9, 8, 7]), source('bad', '损坏.docx'))).rejects.toThrow(
      '无法读取“损坏.docx”',
    );
  });
});
