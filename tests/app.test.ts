import { describe, expect, test, vi } from 'vitest';
import { createExamApp } from '../src/app';
import type { BatchResult } from '../src/exams/model';

const result: BatchResult = {
  exams: [{
    source: { id: 'paper', fileName: '示例卷.docx' },
    blocks: [
      {
        index: 0,
        kind: 'paragraph',
        text: '1. 下列说法正确的是',
        xml: '',
        relationshipIds: [],
        hasFormula: false,
        issues: [],
      },
      {
        index: 1,
        kind: 'paragraph',
        text: 'A. 甲 B. 乙 C. 丙 D. 丁',
        xml: '',
        relationshipIds: [],
        hasFormula: false,
        issues: [],
      },
    ],
    resources: new Map(),
    issues: [],
  }],
  questions: [{
    id: 'q1',
    sourceId: 'paper',
    originalNumber: '1',
    sectionTitle: '一、选择题',
    sectionType: 'choice',
    startBlock: 0,
    endBlock: 2,
    issues: [],
    type: 'choice',
    reason: '依据栏目“一、选择题”',
  }],
  groups: [],
  answers: [],
  numberingByType: {},
  reviewItems: [],
  fileErrors: [],
};

describe('createExamApp', () => {
  test('imports multiple Word files, displays traceable questions and supports manual type changes', async () => {
    const root = document.createElement('main');
    const importDocuments = vi.fn().mockResolvedValue(result);
    createExamApp(root, { importDocuments });

    expect(root.textContent).toContain('添加 Word 试卷');
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [{ name: '示例卷.docx' }], configurable: true });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(importDocuments).toHaveBeenCalledOnce();
    expect(root.querySelector('[data-count="choice"]')?.textContent).toContain('1');
    expect(root.textContent).toContain('示例卷.docx');
    expect(root.textContent).toContain('原题 1');

    const typeSelect = root.querySelector<HTMLSelectElement>('[data-action="type"]')!;
    typeSelect.value = 'fill';
    typeSelect.dispatchEvent(new Event('change'));
    expect(root.querySelector('[data-count="fill"]')?.textContent).toContain('1');
    expect(root.textContent).toContain('人工调整');
  });
});
