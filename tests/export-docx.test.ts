import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { exportCategoryDocx } from '../src/exams/export-docx';
import { classifyQuestion } from '../src/exams/classify';
import { readDocx } from '../src/exams/read-docx';
import { segmentExam } from '../src/exams/segment';
import { createDocxFixture, source } from './helpers/docx-fixture';

describe('exportCategoryDocx', () => {
  test('remaps colliding image relationships and preserves Office Math', async () => {
    const firstBytes = await createDocxFixture([
      { text: '三、解答题' },
      { text: '求 x', numId: '1', formula: 'x+1=2' },
      { text: '图一', image: { relationshipId: 'rId5', fileName: 'image1.png', bytes: new Uint8Array([1, 1]) } },
    ]);
    const secondBytes = await createDocxFixture([
      { text: '三、解答题' },
      { text: '求 y', numId: '1', formula: 'y-1=2' },
      { text: '图二', image: { relationshipId: 'rId5', fileName: 'image1.png', bytes: new Uint8Array([2, 2]) } },
    ]);
    const first = await readDocx(firstBytes, source('first', '第一卷.docx'));
    const second = await readDocx(secondBytes, source('second', '第二卷.docx'));
    const questions = [first, second].flatMap((exam) =>
      segmentExam(exam).questions.map((item) => classifyQuestion(item, exam.blocks.slice(item.startBlock, item.endBlock))),
    );

    const exported = await exportCategoryDocx('solution', questions, [first, second]);
    const zip = await JSZip.loadAsync(exported.bytes);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    const relationshipXml = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const mediaFiles = Object.keys(zip.files).filter((path) => path.startsWith('word/media/') && !zip.files[path].dir);
    const mediaContents = await Promise.all(mediaFiles.map((path) => zip.file(path)!.async('uint8array')));

    expect(documentXml.match(/<m:oMath(?:\s|>)/g)).toHaveLength(2);
    expect(documentXml).not.toContain('<w:numId');
    expect(mediaFiles).toHaveLength(2);
    expect(mediaContents).toEqual(expect.arrayContaining([new Uint8Array([1, 1]), new Uint8Array([2, 2])]));
    expect(relationshipXml.match(/relationships\/image/g)).toHaveLength(2);
  });
});
