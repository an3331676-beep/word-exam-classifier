import type { ClassifiedQuestion, QuestionType, ReviewItem } from './model';

export function updateQuestionType(
  questions: ClassifiedQuestion[],
  questionId: string,
  type: QuestionType,
): ClassifiedQuestion[] {
  return questions.map((question) =>
    question.id === questionId ? { ...question, type, reason: '人工调整' } : question,
  );
}

export function splitQuestion(
  questions: ClassifiedQuestion[],
  questionId: string,
  splitBlock: number,
): ClassifiedQuestion[] {
  const index = questions.findIndex((question) => question.id === questionId);
  if (index < 0) return questions;
  const question = questions[index];
  if (splitBlock <= question.startBlock || splitBlock >= question.endBlock) return questions;
  const first = { ...question, endBlock: splitBlock };
  const second: ClassifiedQuestion = {
    ...question,
    id: `${question.id}:split:${splitBlock}`,
    originalNumber: `${question.originalNumber}（续）`,
    startBlock: splitBlock,
    reason: '人工拆分，题型沿用',
  };
  return [...questions.slice(0, index), first, second, ...questions.slice(index + 1)];
}

export function mergeWithNext(questions: ClassifiedQuestion[], questionId: string): ClassifiedQuestion[] {
  const index = questions.findIndex((question) => question.id === questionId);
  const current = questions[index];
  const next = questions[index + 1];
  if (!current || !next || current.sourceId !== next.sourceId || current.endBlock !== next.startBlock) {
    return questions;
  }
  const merged: ClassifiedQuestion = {
    ...current,
    endBlock: next.endBlock,
    issues: [...new Set([...current.issues, ...next.issues])],
    reason: current.type === next.type ? '人工合并' : '人工合并，请重新核对题型',
    type: current.type === next.type ? current.type : 'unknown',
  };
  return [...questions.slice(0, index), merged, ...questions.slice(index + 2)];
}

export function promoteReviewRange(
  questions: ClassifiedQuestion[],
  reviewItem: ReviewItem,
): ClassifiedQuestion[] {
  const overlaps = questions.some(
    (question) =>
      question.sourceId === reviewItem.sourceId &&
      question.startBlock < reviewItem.endBlock &&
      reviewItem.startBlock < question.endBlock,
  );
  if (overlaps || reviewItem.startBlock >= reviewItem.endBlock) return questions;
  const promoted: ClassifiedQuestion = {
    id: `${reviewItem.id}:promoted`,
    sourceId: reviewItem.sourceId,
    originalNumber: '待补题号',
    startBlock: reviewItem.startBlock,
    endBlock: reviewItem.endBlock,
    issues: [reviewItem.reason],
    type: 'unknown',
    reason: '由待核对片段创建',
  };
  const beforeIndex = questions.findIndex(
    (question) => question.sourceId === reviewItem.sourceId && question.startBlock > reviewItem.startBlock,
  );
  if (beforeIndex >= 0) {
    return [...questions.slice(0, beforeIndex), promoted, ...questions.slice(beforeIndex)];
  }
  let lastSourceIndex = -1;
  for (let index = questions.length - 1; index >= 0; index -= 1) {
    if (questions[index].sourceId === reviewItem.sourceId) {
      lastSourceIndex = index;
      break;
    }
  }
  if (lastSourceIndex >= 0) {
    return [
      ...questions.slice(0, lastSourceIndex + 1),
      promoted,
      ...questions.slice(lastSourceIndex + 1),
    ];
  }
  return [...questions, promoted];
}
