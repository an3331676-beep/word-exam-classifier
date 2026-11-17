import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { exportCategoryDocx } from '../src/exams/export-docx';
import { importBatch } from '../src/exams/import-batch';
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

  test('exports each reading passage once, applies new numbers, and appends mapped answers', async () => {
    const bytes = await createDocxFixture([
      { text: '四、阅读理解' },
      { text: 'Passage A' },
      { text: 'Tom lives in Beijing.' },
      { text: '21. Where does Tom live?' },
      { text: 'A. Beijing B. Shanghai C. Tianjin D. Shenzhen' },
      { text: '22. What does Tom like?' },
      { text: 'A. Music B. Art C. Sport D. Books' },
      { text: 'Passage B' },
      { text: 'Lucy likes music.' },
      { text: '23. What does Lucy like?' },
      { text: 'A. Music B. Art C. Sport D. Books' },
      { text: '参考答案' },
      { text: 'Passage A' },
      { text: '21. A 解析：定位第一段。' },
      { text: '22. D' },
      { text: 'Passage B' },
      { text: '23. A 解析：定位第二篇。' },
    ]);
    const result = await importBatch([{
      name: '阅读卷.docx',
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }]);

    const exported = await exportCategoryDocx(
      'reading',
      result.questions,
      result.exams,
      result.groups,
      result.answers,
    );
    const zip = await JSZip.loadAsync(exported.bytes);
    const documentXml = await zip.file('word/document.xml')!.async('string');

    expect(documentXml.match(/阅读 1/g)).toHaveLength(2);
    expect(documentXml.match(/阅读 2/g)).toHaveLength(2);
    expect(documentXml.match(/Tom lives in Beijing/g)).toHaveLength(1);
    expect(documentXml).toContain('1. Where does Tom live?');
    expect(documentXml).toContain('3. What does Lucy like?');
    expect(documentXml.indexOf('答案与解析')).toBeGreaterThan(documentXml.indexOf('3. What does Lucy like?'));
    expect(documentXml).toContain('1. A 解析');
    expect(documentXml).not.toContain('<w:numId');
  });
});
