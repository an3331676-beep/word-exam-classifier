import { classifyQuestion } from './classify';
import type { BatchResult, ReviewItem, UploadLike } from './model';
import { readDocx } from './read-docx';
import { segmentExam } from './segment';

export async function importBatch(files: Iterable<UploadLike>): Promise<BatchResult> {
  const exams: BatchResult['exams'] = [];
  const questions: BatchResult['questions'] = [];
  const reviewItems: ReviewItem[] = [];
  const fileErrors: BatchResult['fileErrors'] = [];

  let index = 0;
  for (const file of files) {
    const sourceId = `source-${index + 1}`;
    index += 1;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      fileErrors.push({ fileName: file.name, message: '仅支持 .docx，请先在 Word 中另存为 .docx' });
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      const exam = await readDocx(new Uint8Array(buffer), { id: sourceId, fileName: file.name });
      exams.push(exam);
      const segmented = segmentExam(exam);
      reviewItems.push(...segmented.reviewItems);
      for (const draft of segmented.questions) {
        const classified = classifyQuestion(draft, exam.blocks.slice(draft.startBlock, draft.endBlock));
        questions.push(classified);
        for (const issue of classified.issues) {
          reviewItems.push({
            id: `${classified.id}:issue:${reviewItems.length}`,
            sourceId: classified.sourceId,
            startBlock: classified.startBlock,
            endBlock: classified.endBlock,
            reason: issue,
          });
        }
        if (classified.type === 'unknown') {
          reviewItems.push({
            id: `${classified.id}:classification`,
            sourceId: classified.sourceId,
            startBlock: classified.startBlock,
            endBlock: classified.endBlock,
            reason: classified.reason,
          });
        }
      }
    } catch (error) {
      fileErrors.push({
        fileName: file.name,
        message: error instanceof Error ? error.message : '读取失败',
      });
    }
  }

  return {
    exams,
    questions,
    groups: [],
    answers: [],
    numberingByType: {},
    reviewItems,
    fileErrors,
  };
}
