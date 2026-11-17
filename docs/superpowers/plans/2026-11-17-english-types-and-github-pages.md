# English Exam Types and GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing browser-only Word exam classifier with English reading comprehension and cloze groups, continuous renumbering, end-of-document answer mapping, target-type selection, and repeatable GitHub Pages deployment.

**Architecture:** Keep `.docx` parsing and export in the browser. Add a group layer over existing document blocks so one passage can own several questions, retain answer blocks instead of discarding them, and derive a deterministic output-number map from upload order. The UI selects one target type from already parsed documents, while GitHub Actions builds and deploys the static `dist/` directory.

**Tech Stack:** TypeScript, Vite, JSZip, DOMParser, Vitest, GitHub Actions, GitHub Pages

---

## File map

- Modify `src/exams/model.ts` for the expanded question types, groups, answers, and output-number map.
- Modify `src/exams/segment.ts` to recognize English section headings and retain answer sections.
- Create `src/exams/group-english.ts` for passage boundaries and question membership.
- Create `src/exams/answers.ts` for answer parsing and new-number association.
- Create `src/exams/renumber.ts` for stable continuous numbering.
- Modify `src/exams/import-batch.ts` to return groups and answer items.
- Modify `src/exams/export-docx.ts` for grouped material, new numbers, and final answers.
- Split `src/app.ts` by creating `src/ui/type-selector.ts` and `src/ui/group-view.ts` so the existing large file does not accumulate unrelated rendering logic.
- Modify `src/style.css` for target-type cards and passage-group previews.
- Add `.github/workflows/deploy-pages.yml` for automatic static deployment.
- Modify `README.md` with the new workflow and GitHub Pages setup.

### Task 1: Establish Git history and extend the domain model

**Files:**
- Modify: `src/exams/model.ts`
- Create: `tests/model.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Initialize the local repository before making feature changes**

Run:

```powershell
git init
git branch -M main
git add .
git commit -m "chore: checkpoint existing Word exam classifier"
```

Expected: a new local `main` branch with the current working application as its first commit. Do not add a remote or publish anything in this step.

- [ ] **Step 2: Write the failing model test**

Add `tests/model.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { isEnglishQuestionType } from '../src/exams/model';

describe('question type model', () => {
  test('recognizes reading and cloze as grouped English types', () => {
    expect(isEnglishQuestionType('reading')).toBe(true);
    expect(isEnglishQuestionType('cloze')).toBe(true);
    expect(isEnglishQuestionType('choice')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
npm test -- tests/model.test.ts
```

Expected: FAIL because `isEnglishQuestionType` and the new union members do not exist.

- [ ] **Step 4: Extend the model**

Change the top of `src/exams/model.ts` and add the group and answer interfaces:

```ts
export type QuestionType =
  | 'choice'
  | 'fill'
  | 'solution'
  | 'reading'
  | 'cloze'
  | 'unknown';

export type EnglishQuestionType = 'reading' | 'cloze';
export type ExportQuestionType = Exclude<QuestionType, 'unknown' | 'solution'>;
export type SectionType = Exclude<QuestionType, 'unknown'> | 'unsupported';

export const isEnglishQuestionType = (
  type: QuestionType,
): type is EnglishQuestionType => type === 'reading' || type === 'cloze';

export interface QuestionGroup {
  id: string;
  sourceId: string;
  type: EnglishQuestionType;
  originalLabel?: string;
  materialStartBlock: number;
  materialEndBlock: number;
  questionIds: string[];
  issues: string[];
}

export interface AnswerItem {
  id: string;
  sourceId: string;
  originalNumber?: string;
  text: string;
  startBlock: number;
  endBlock: number;
  groupLabel?: string;
  questionId?: string;
  issues: string[];
}

export interface OutputNumber {
  questionId: string;
  value: number;
}
```

Extend `ClassifiedQuestion` with `groupId?: string`, `outputNumber?: number`, and `answerId?: string`. Extend `SegmentResult` with `answerBlocks: Block[]`. Extend `BatchResult` with `groups: QuestionGroup[]`, `answers: AnswerItem[]`, and `numberingByType: Partial<Record<ExportQuestionType, OutputNumber[]>>`.

- [ ] **Step 5: Run the focused test and full suite**

Run:

```powershell
npm test -- tests/model.test.ts
npm test
```

Expected: the model test passes. Existing compile failures caused by new required `BatchResult` fields are fixed by temporarily returning empty arrays in test fixtures and `importBatch`.

- [ ] **Step 6: Commit**

```powershell
git add src/exams/model.ts src/exams/import-batch.ts tests README.md
git commit -m "feat: add grouped English exam domain model"
```

### Task 2: Recognize English sections and retain answer blocks

**Files:**
- Modify: `src/exams/segment.ts`
- Modify: `tests/segment.test.ts`

- [ ] **Step 1: Add failing section and answer tests**

Append tests that use the existing `examWith` and `block` helpers:

```ts
test.each([
  ['四、阅读理解（共两篇）', 'reading'],
  ['Reading Comprehension', 'reading'],
  ['五、完形填空', 'cloze'],
  ['Cloze Test (15 points)', 'cloze'],
] as const)('recognizes English section %s', (title, sectionType) => {
  const result = segmentExam(examWith([
    block(0, title),
    block(1, '1. Which statement is correct?'),
  ]));
  expect(result.questions[0].sectionType).toBe(sectionType);
});

test('retains the independent answer section after finishing questions', () => {
  const result = segmentExam(examWith([
    block(0, '一、选择题'),
    block(1, '1. 题干'),
    block(2, '参考答案'),
    block(3, '1. A，解析：根据原文可知。'),
  ]));
  expect(result.questions[0]).toMatchObject({ startBlock: 1, endBlock: 2 });
  expect(result.answerBlocks.map((item) => item.index)).toEqual([3]);
});

test('does not treat a question sentence as an English section title', () => {
  const result = segmentExam(examWith([
    block(0, '一、解答题'),
    block(1, '1. 请说明阅读理解题的解题步骤'),
    block(2, '继续说明'),
  ]));
  expect(result.questions[0].endBlock).toBe(3);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/segment.test.ts
```

Expected: FAIL because reading/cloze are unsupported and answer blocks are discarded.

- [ ] **Step 3: Extend section patterns and answer capture**

In `src/exams/segment.ts`, add anchored patterns:

```ts
{ pattern: /^(?:英语)?阅读理解(?:$|[\s（(:，,])/, type: 'reading' },
{ pattern: /^Reading Comprehension(?:$|[\s（(:，,])/i, type: 'reading' },
{ pattern: /^(?:英语)?(?:完形|完型)填空(?:$|[\s（(:，,])/, type: 'cloze' },
{ pattern: /^(?:Cloze Test|完形阅读)(?:$|[\s（(:，,])/i, type: 'cloze' },
```

Replace the early `break` at an answer heading with an `inAnswerSection` state. Close the active question at the heading, skip the heading itself, and append later blocks to `answerBlocks`. Return `{ questions, reviewItems, answerBlocks }`.

- [ ] **Step 4: Run focused and full tests**

```powershell
npm test -- tests/segment.test.ts
npm test
```

Expected: all section tests pass, the existing “参考答案 excluded from questions” test remains green, and the answer block is retained separately.

- [ ] **Step 5: Commit**

```powershell
git add src/exams/segment.ts tests/segment.test.ts
git commit -m "feat: recognize English sections and retain answers"
```

### Task 3: Build reading and cloze passage groups

**Files:**
- Create: `src/exams/group-english.ts`
- Create: `tests/group-english.test.ts`
- Modify: `src/exams/import-batch.ts`

- [ ] **Step 1: Write failing group tests**

Create `tests/group-english.test.ts` with explicit passage labels and cloze blanks:

```ts
import { describe, expect, test } from 'vitest';
import { groupEnglishQuestions } from '../src/exams/group-english';
import type { Block, ClassifiedQuestion } from '../src/exams/model';

const makeBlock = (index: number, text: string): Block => ({
  index,
  kind: 'paragraph',
  text,
  xml: '',
  relationshipIds: [],
  hasFormula: false,
  issues: [],
});

const makeQuestion = (
  id: string,
  originalNumber: string,
  startBlock: number,
  endBlock: number,
  type: 'reading' | 'cloze',
): ClassifiedQuestion => ({
  id,
  sourceId: 'paper',
  originalNumber,
  sectionType: type,
  startBlock,
  endBlock,
  issues: [],
  type,
  reason: '栏目识别',
});

test('groups two passages and keeps each material once', () => {
  const blocks = [
    makeBlock(0, 'Passage A'),
    makeBlock(1, 'Tom lives in Beijing.'),
    makeBlock(2, '21. Where does Tom live?'),
    makeBlock(3, '22. What does he like?'),
    makeBlock(4, 'Passage B'),
    makeBlock(5, 'Lucy likes music.'),
    makeBlock(6, '23. What does Lucy like?'),
  ];
  const questions = [
    makeQuestion('q21', '21', 2, 3, 'reading'),
    makeQuestion('q22', '22', 3, 4, 'reading'),
    makeQuestion('q23', '23', 6, 7, 'reading'),
  ];
  const result = groupEnglishQuestions('paper', blocks, questions);
  expect(result.groups.map((group) => ({
    label: group.originalLabel,
    material: [group.materialStartBlock, group.materialEndBlock],
    questionIds: group.questionIds,
  }))).toEqual([
    { label: 'Passage A', material: [0, 2], questionIds: ['q21', 'q22'] },
    { label: 'Passage B', material: [4, 6], questionIds: ['q23'] },
  ]);
});

test('keeps cloze blank numbers inside one passage', () => {
  const blocks = [
    makeBlock(0, '完形填空'),
    makeBlock(1, 'I have (1) apple and (2) orange.'),
    makeBlock(2, '1. A. a B. an C. the D. /'),
    makeBlock(3, '2. A. a B. an C. the D. /'),
  ];
  const questions = [
    makeQuestion('q1', '1', 2, 3, 'cloze'),
    makeQuestion('q2', '2', 3, 4, 'cloze'),
  ];
  expect(groupEnglishQuestions('paper', blocks, questions).groups).toHaveLength(1);
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/group-english.test.ts
```

Expected: FAIL because `groupEnglishQuestions` does not exist.

- [ ] **Step 3: Implement deterministic group boundaries**

Create `src/exams/group-english.ts` with:

```ts
import type {
  Block,
  ClassifiedQuestion,
  EnglishQuestionType,
  QuestionGroup,
  ReviewItem,
} from './model';

const passageLabel = /^(?:第[一二三四五六七八九十\d]+篇|Passage\s*[A-Z\d]+|Text\s*[A-Z\d]+|[A-Z]\s*篇)(?:$|[\s（(:，,])/i;

export function groupEnglishQuestions(
  sourceId: string,
  blocks: Block[],
  questions: ClassifiedQuestion[],
): { groups: QuestionGroup[]; reviewItems: ReviewItem[] } {
  const english = questions.filter(
    (question): question is ClassifiedQuestion & { type: EnglishQuestionType } =>
      question.type === 'reading' || question.type === 'cloze',
  );
  if (!english.length) return { groups: [], reviewItems: [] };

  const labels = blocks.filter((block) => passageLabel.test(block.text.trim()));
  const starts = labels.length ? labels.map((block) => block.index) : [
    Math.max(0, english[0].startBlock - 1),
  ];
  const groups: QuestionGroup[] = starts.map((start, index) => {
    const end = starts[index + 1] ?? blocks.length;
    const members = english.filter(
      (question) => question.startBlock >= start && question.startBlock < end,
    );
    const firstQuestionStart = members[0]?.startBlock ?? end;
    return {
      id: `${sourceId}:group:${start}`,
      sourceId,
      type: members[0]?.type ?? english[0].type,
      originalLabel: blocks[start]?.text,
      materialStartBlock: start,
      materialEndBlock: firstQuestionStart,
      questionIds: members.map((question) => question.id),
      issues: members.length ? [] : ['文章没有识别到所属小题'],
    };
  });
  const assigned = new Set(groups.flatMap((group) => group.questionIds));
  const reviewItems = english
    .filter((question) => !assigned.has(question.id))
    .map((question) => ({
      id: `${question.id}:group`,
      sourceId,
      startBlock: question.startBlock,
      endBlock: question.endBlock,
      reason: '英语小题无法关联到文章材料',
    }));
  return { groups, reviewItems };
}
```

After constructing each group, assign its `id` to member questions. In `importBatch`, call the grouper per parsed exam after classification and append its review items.

- [ ] **Step 4: Run tests and refactor label handling**

```powershell
npm test -- tests/group-english.test.ts
npm test
```

Expected: two reading groups, one cloze group, and no duplicate material.

- [ ] **Step 5: Commit**

```powershell
git add src/exams/group-english.ts src/exams/import-batch.ts tests/group-english.test.ts
git commit -m "feat: group reading and cloze passages"
```

### Task 4: Renumber questions continuously across documents

**Files:**
- Create: `src/exams/renumber.ts`
- Create: `tests/renumber.test.ts`
- Modify: `src/exams/import-batch.ts`

- [ ] **Step 1: Write the failing numbering test**

Create `tests/renumber.test.ts`:

```ts
import { expect, test } from 'vitest';
import { renumberQuestions } from '../src/exams/renumber';
import type { ClassifiedQuestion } from '../src/exams/model';

const question = (id: string, sourceId: string, startBlock: number): ClassifiedQuestion => ({
  id,
  sourceId,
  originalNumber: '21',
  startBlock,
  endBlock: startBlock + 1,
  issues: [],
  type: 'reading',
  reason: '栏目识别',
});

test('numbers selected questions from 1 across passage and document boundaries', () => {
  const questions = [
    question('a', 'source-1', 10),
    question('b', 'source-1', 11),
    question('c', 'source-2', 4),
  ];
  const result = renumberQuestions(questions, 'reading');
  expect(result.map(({ id, outputNumber }) => ({ id, outputNumber }))).toEqual([
    { id: 'a', outputNumber: 1 },
    { id: 'b', outputNumber: 2 },
    { id: 'c', outputNumber: 3 },
  ]);
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/renumber.test.ts
```

Expected: FAIL because `renumberQuestions` does not exist.

- [ ] **Step 3: Implement numbering without changing source order**

Create `src/exams/renumber.ts`:

```ts
import type { ClassifiedQuestion, OutputNumber, QuestionType } from './model';

export function renumberQuestions(
  questions: ClassifiedQuestion[],
  selectedType: QuestionType,
): ClassifiedQuestion[] {
  let next = 1;
  return questions
    .filter((question) => question.type === selectedType)
    .map((question) => ({ ...question, outputNumber: next++ }));
}

export const createNumberMap = (
  questions: ClassifiedQuestion[],
): OutputNumber[] => questions
  .filter((question) => question.outputNumber !== undefined)
  .map((question) => ({ questionId: question.id, value: question.outputNumber! }));
```

Call this only after `importBatch` has preserved upload order and block order. Do not lexically sort source IDs because `source-10` would precede `source-2`. Populate `BatchResult.numberingByType` for `choice`, `fill`, `reading`, and `cloze` using `createNumberMap(renumberQuestions(questions, type))`.

- [ ] **Step 4: Run focused and full tests**

```powershell
npm test -- tests/renumber.test.ts
npm test
```

Expected: output numbers are `1, 2, 3` and original question numbers remain unchanged for traceability.

- [ ] **Step 5: Commit**

```powershell
git add src/exams/renumber.ts src/exams/import-batch.ts tests/renumber.test.ts
git commit -m "feat: renumber extracted questions continuously"
```

### Task 5: Parse and associate answers in passage order

**Files:**
- Create: `src/exams/answers.ts`
- Create: `tests/answers.test.ts`
- Modify: `src/exams/import-batch.ts`

- [ ] **Step 1: Write failing answer mapping tests**

Create `tests/answers.test.ts`:

```ts
import { expect, test } from 'vitest';
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

test('moves answers to the end and maps original numbers to new numbers', () => {
  const questions = [21, 22, 23].map((originalNumber, index): ClassifiedQuestion => ({
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
    { id: 'g1', sourceId: 'paper', type: 'reading', materialStartBlock: 0, materialEndBlock: 1, questionIds: ['q21', 'q22'], issues: [] },
    { id: 'g2', sourceId: 'paper', type: 'reading', materialStartBlock: 3, materialEndBlock: 4, questionIds: ['q23'], issues: [] },
  ];
  const answers = parseAnswerBlocks('paper', [
    answerBlock(10, '21. A 解析：定位第一段。'),
    answerBlock(11, '22. B'),
    answerBlock(12, '23. C 解析：定位第二篇。'),
  ]);
  const mapped = associateAnswers(answers, questions, groups);
  expect(mapped.answers.map((answer) => [answer.questionId, answer.originalNumber])).toEqual([
    ['q21', '21'], ['q22', '22'], ['q23', '23'],
  ]);
  expect(mapped.reviewItems).toEqual([]);
});

test('sends duplicate answer numbers to review', () => {
  const parsed = parseAnswerBlocks('paper', [
    answerBlock(10, '21. A'),
    answerBlock(11, '21. B'),
  ]);
  expect(parsed.filter((answer) => answer.issues.length > 0)).toHaveLength(2);
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/answers.test.ts
```

Expected: FAIL because answer functions do not exist.

- [ ] **Step 3: Implement answer parsing and association**

Create `src/exams/answers.ts`. Track answer-side passage labels with the same anchored label rule used by `group-english.ts`, and store the active label in `AnswerItem.groupLabel`. Parse a leading original number using `/^(\d{1,3})\s*[.、)]\s*/`. Preserve the full block text. Mark duplicate source-number-label triples with `答案编号重复`.

Association uses these exact steps:

1. Find questions from the same source with the answer's `originalNumber`.
2. When `groupLabel` is present, narrow candidates to the group with the same normalized label.
3. Associate a single remaining candidate.
4. For an answer without an original number, use the next unmatched question from the same source in document order.
5. Return a `ReviewItem` with `答案无法唯一关联到小题` when zero or multiple candidates remain.

Use the following public signatures:

```ts
export function parseAnswerBlocks(sourceId: string, blocks: Block[]): AnswerItem[];

export function associateAnswers(
  answers: AnswerItem[],
  questions: ClassifiedQuestion[],
  groups: QuestionGroup[],
): { answers: AnswerItem[]; questions: ClassifiedQuestion[]; reviewItems: ReviewItem[] };
```

When association succeeds, set both `answer.questionId` and `question.answerId`. Keep answer array order unchanged so export can group it using `QuestionGroup.questionIds`.

- [ ] **Step 4: Run focused and full tests**

```powershell
npm test -- tests/answers.test.ts
npm test
```

Expected: unique answers map correctly, duplicate answers enter review, and documents without answers return empty arrays without errors.

- [ ] **Step 5: Commit**

```powershell
git add src/exams/answers.ts src/exams/import-batch.ts tests/answers.test.ts
git commit -m "feat: associate answer analysis with renumbered questions"
```

### Task 6: Export selected types with grouped passages and final answers

**Files:**
- Modify: `src/exams/export-docx.ts`
- Modify: `tests/export-docx.test.ts`

- [ ] **Step 1: Add failing grouped export assertions**

Add a test fixture with two reading groups and three questions. Export `reading`, unzip the result, and assert:

```ts
expect(documentXml.match(/阅读 1/g)).toHaveLength(2); // body heading and answer heading
expect(documentXml.match(/阅读 2/g)).toHaveLength(2);
expect(documentXml.match(/Tom lives in Beijing/g)).toHaveLength(1);
expect(documentXml).toContain('1. Where does Tom live?');
expect(documentXml).toContain('3. What does Lucy like?');
expect(documentXml.indexOf('答案与解析')).toBeGreaterThan(documentXml.indexOf('3. What does Lucy like?'));
expect(documentXml).toContain('1. A 解析');
expect(documentXml).not.toContain('<w:numId');
```

Update the function call to pass groups and answers:

```ts
await exportCategoryDocx('reading', questions, exams, groups, answers);
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/export-docx.test.ts
```

Expected: FAIL because `reading`, groups, answers, and new numbers are unsupported.

- [ ] **Step 3: Extend export signatures and body generation**

Use this signature:

```ts
export async function exportCategoryDocx(
  type: ExportQuestionType,
  allQuestions: ClassifiedQuestion[],
  exams: ParsedExam[],
  groups: QuestionGroup[] = [],
  answers: AnswerItem[] = [],
): Promise<ExportedDocx>;
```

For `choice` and `fill`, render filtered questions in output-number order. For `reading` and `cloze`, iterate groups in array order, copy material blocks once, then copy member question blocks. Remove the original leading manual question number from the first text run when it matches `originalNumber`, and prepend `${outputNumber}. ` using a new `w:r` so formulas and images remain untouched.

After all body content, append `答案与解析` only when at least one mapped answer exists. Iterate groups and their `questionIds`, find each mapped answer, and render the output number followed by answer text with the original number prefix removed.

- [ ] **Step 4: Run export and full tests**

```powershell
npm test -- tests/export-docx.test.ts
npm test
```

Expected: each passage appears once, new numbers are continuous, answers appear after all questions, and existing image/formula relationship tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add src/exams/export-docx.ts tests/export-docx.test.ts
git commit -m "feat: export grouped English passages and answers"
```

### Task 7: Add target-type selection and grouped review UI

**Files:**
- Create: `src/ui/type-selector.ts`
- Create: `src/ui/group-view.ts`
- Modify: `src/app.ts`
- Modify: `src/style.css`
- Modify: `tests/app.test.ts`

- [ ] **Step 1: Add failing application tests**

Extend `tests/app.test.ts` with this fixture and test:

```ts
const resultWithReadingAndCloze: BatchResult = {
  exams: [{
    source: { id: 'paper', fileName: '英语卷.docx' },
    blocks: [
      { index: 0, kind: 'paragraph', text: 'Passage A', xml: '', relationshipIds: [], hasFormula: false, issues: [] },
      { index: 1, kind: 'paragraph', text: 'Tom lives in Beijing.', xml: '', relationshipIds: [], hasFormula: false, issues: [] },
      { index: 2, kind: 'paragraph', text: '21. Where does Tom live?', xml: '', relationshipIds: [], hasFormula: false, issues: [] },
      { index: 3, kind: 'paragraph', text: '完形填空', xml: '', relationshipIds: [], hasFormula: false, issues: [] },
      { index: 4, kind: 'paragraph', text: 'I have (1) apple.', xml: '', relationshipIds: [], hasFormula: false, issues: [] },
      { index: 5, kind: 'paragraph', text: '1. A. a B. an C. the D. /', xml: '', relationshipIds: [], hasFormula: false, issues: [] },
    ],
    resources: new Map(),
    issues: [],
  }],
  questions: [
    { id: 'reading-q', sourceId: 'paper', originalNumber: '21', startBlock: 2, endBlock: 3, issues: [], type: 'reading', reason: '栏目识别', groupId: 'reading-g' },
    { id: 'cloze-q', sourceId: 'paper', originalNumber: '1', startBlock: 5, endBlock: 6, issues: [], type: 'cloze', reason: '栏目识别', groupId: 'cloze-g' },
  ],
  groups: [
    { id: 'reading-g', sourceId: 'paper', type: 'reading', originalLabel: 'Passage A', materialStartBlock: 0, materialEndBlock: 2, questionIds: ['reading-q'], issues: [] },
    { id: 'cloze-g', sourceId: 'paper', type: 'cloze', originalLabel: '完形 1', materialStartBlock: 3, materialEndBlock: 5, questionIds: ['cloze-q'], issues: [] },
  ],
  answers: [],
  numberingByType: {},
  reviewItems: [],
  fileErrors: [],
};

test('selects one target type before upload and switches parsed results without reimporting', async () => {
  const root = document.createElement('main');
  const importDocuments = vi.fn().mockResolvedValue(resultWithReadingAndCloze);
  createExamApp(root, { importDocuments });
  const reading = root.querySelector<HTMLInputElement>('input[value="reading"]')!;
  reading.click();
  expect(reading.checked).toBe(true);
  expect(root.textContent).toContain('提取英语阅读理解');

  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [{ name: '英语卷.docx' }], configurable: true });
  input.dispatchEvent(new Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(importDocuments).toHaveBeenCalledOnce();
  expect(root.textContent).toContain('阅读 1');
  root.querySelector<HTMLInputElement>('input[value="cloze"]')!.click();
  expect(importDocuments).toHaveBeenCalledOnce();
  expect(root.textContent).toContain('完形 1');
});
```

Create the fixture with both `reading` and `cloze` questions, their groups, answer items, and numbering map.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/app.test.ts
```

Expected: FAIL because the radio controls and grouped view do not exist.

- [ ] **Step 3: Extract the selector and group renderer**

`src/ui/type-selector.ts` exports:

```ts
import type { ExportQuestionType } from '../exams/model';

export const selectableTypes: Array<{ value: ExportQuestionType; label: string; description: string }> = [
  { value: 'choice', label: '选择题', description: '提取独立选择题' },
  { value: 'fill', label: '填空题', description: '提取独立填空题' },
  { value: 'reading', label: '英语阅读理解', description: '保留文章并整理所属小题' },
  { value: 'cloze', label: '英语完形填空', description: '保留完形材料并整理空位小题' },
];

export function renderTypeSelector(selected: ExportQuestionType): string {
  return `<fieldset class="type-selector"><legend>选择要提取的题型</legend>${selectableTypes.map((item) =>
    `<label class="type-option"><input type="radio" name="target-type" value="${item.value}" ${selected === item.value ? 'checked' : ''}/><span><b>${item.label}</b><small>${item.description}</small></span></label>`
  ).join('')}</fieldset>`;
}
```

`src/ui/group-view.ts` renders one group article, copies material blocks once through callbacks provided by `app.ts`, and renders member questions with `outputNumber`.

- [ ] **Step 4: Connect selection state in `app.ts`**

Add `selectedType: ExportQuestionType = 'choice'`. Render the selector above the upload zone and in the results header. Radio change updates `selectedType` and re-renders without calling `importDocuments` again. Derive displayed questions with `renumberQuestions(questions, selectedType)`. English types use `renderGroupView`; ordinary types keep the existing question card.

Update export and print handlers to use `selectedType`, `result.groups`, and `result.answers`. Remove `solution` from the user-facing extraction options while preserving its internal parser support for compatibility with existing documents.

- [ ] **Step 5: Add CSS and run UI tests**

Add a responsive four-card `.type-selector`, selected-state accent, `.passage-card`, `.passage-material`, `.passage-question-list`, and `.answer-match-summary`. At widths below `680px`, use one type card per row and keep controls at least 44px high.

Run:

```powershell
npm test -- tests/app.test.ts
npm test
npm run build
```

Expected: selection works before and after upload, no second import occurs when changing type, all tests pass, and Vite builds successfully.

- [ ] **Step 6: Commit**

```powershell
git add src/app.ts src/style.css src/ui tests/app.test.ts
git commit -m "feat: add target type selection and passage review"
```

### Task 8: Configure GitHub Pages deployment

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Modify: `README.md`

- [ ] **Step 1: Add the deployment workflow**

Create `.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy static site to Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Test
        run: npm test
      - name: Build for project Pages
        shell: bash
        run: |
          if [[ "${{ github.event.repository.name }}" == "${{ github.repository_owner }}.github.io" ]]; then
            BASE_PATH="/"
          else
            BASE_PATH="/${{ github.event.repository.name }}/"
          fi
          npm run build -- --base "$BASE_PATH"
      - name: Configure Pages
        uses: actions/configure-pages@v5
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the workflow structure locally**

Run:

```powershell
npm test
npm run build -- --base "/word-exam-classifier/"
Test-Path .\dist\index.html
```

Expected: tests and build exit with code 0; `Test-Path` prints `True`; built asset URLs begin with `/word-exam-classifier/`.

- [ ] **Step 3: Document repository and Pages setup**

Add a GitHub Pages section to `README.md` explaining:

```text
1. Create an empty GitHub repository and push the local main branch.
2. Open Settings → Pages.
3. Choose GitHub Actions as the publishing source.
4. Push to main or run “Deploy static site to Pages” manually.
5. Open the URL shown in the deployment job.
```

State that uploaded Word files are processed in the browser and are not sent to a project server. Also state that GitHub logs visitor IP addresses as part of normal Pages security operations, while the application does not submit the selected document contents.

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/deploy-pages.yml README.md
git commit -m "ci: deploy static app to GitHub Pages"
```

### Task 9: Final verification and publication handoff

**Files:**
- Verify: all source, tests, workflow, and README files

- [ ] **Step 1: Run the full verification suite**

```powershell
npm test
npm run build
rg -n "[T]ODO|[T]BD" src tests README.md .github
git status --short
```

Expected: all tests pass, production build succeeds, `rg` returns no placeholder matches, and Git status is clean.

- [ ] **Step 2: Perform browser QA**

Start the local preview and verify desktop plus a `390 × 844` viewport:

```powershell
npm run dev -- --host 127.0.0.1
```

Check that all four radio cards are usable, selection remains after import, a reading passage is shown once, output numbers are continuous, answer status is visible, and no browser console errors occur. Stop the preview server after QA.

- [ ] **Step 3: Verify a real sample set**

Use at least two user-approved reading `.docx` files and two user-approved cloze `.docx` files. One file must contain answers and one must contain an image, table, or Office Math. Compare passage boundaries, question order, new numbering, and final answer mapping against the originals. Record any unresolved structure in the UI rather than silently exporting it.

- [ ] **Step 4: Prepare GitHub publication without publishing yet**

```powershell
git log --oneline --decorate -8
git status --short
```

Expected: feature commits and the deployment commit are present, and the working tree is clean. Creating the GitHub repository, adding a remote, pushing, and enabling Pages require the user's chosen repository/account and explicit publication authorization.
