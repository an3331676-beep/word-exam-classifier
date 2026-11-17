import { detectPassageLabel } from './group-english';
import type {
  AnswerItem,
  Block,
  ClassifiedQuestion,
  QuestionGroup,
  ReviewItem,
} from './model';

function normalized(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function parseAnswerBlocks(sourceId: string, blocks: Block[]): AnswerItem[] {
  const answers: AnswerItem[] = [];
  let activeGroupLabel: string | undefined;

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text && block.relationshipIds.length === 0) continue;
    const label = detectPassageLabel(text);
    if (label) {
      activeGroupLabel = label;
      continue;
    }
    const match = text.match(/^(\d{1,3})\s*[.、)）]\s*/);
    answers.push({
      id: `${sourceId}:answer:${block.index}:${answers.length + 1}`,
      sourceId,
      ...(match ? { originalNumber: match[1] } : {}),
      text,
      startBlock: block.index,
      endBlock: block.index + 1,
      ...(activeGroupLabel ? { groupLabel: activeGroupLabel } : {}),
      issues: [...block.issues],
    });
  }

  const byKey = new Map<string, AnswerItem[]>();
  for (const answer of answers) {
    if (!answer.originalNumber) continue;
    const key = `${normalized(answer.groupLabel)}|${answer.originalNumber}`;
    const values = byKey.get(key) ?? [];
    values.push(answer);
    byKey.set(key, values);
  }
  for (const values of byKey.values()) {
    if (values.length < 2) continue;
    for (const answer of values) answer.issues.push('答案编号重复');
  }
  return answers;
}

export function associateAnswers(
  inputAnswers: AnswerItem[],
  inputQuestions: ClassifiedQuestion[],
  groups: QuestionGroup[],
): { answers: AnswerItem[]; questions: ClassifiedQuestion[]; reviewItems: ReviewItem[] } {
  const answers = inputAnswers.map((answer) => ({ ...answer, issues: [...answer.issues] }));
  const questions = inputQuestions.map((question) => ({ ...question, issues: [...question.issues] }));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const matched = new Set<string>();
  const reviewItems: ReviewItem[] = [];

  for (const answer of answers) {
    let candidates: ClassifiedQuestion[] = [];
    if (!answer.issues.includes('答案编号重复')) {
      if (answer.originalNumber) {
        candidates = questions.filter(
          (question) => question.sourceId === answer.sourceId
            && question.originalNumber === answer.originalNumber
            && !matched.has(question.id),
        );
      } else {
        candidates = questions.filter(
          (question) => question.sourceId === answer.sourceId && !matched.has(question.id),
        );
      }

      if (answer.groupLabel) {
        const expected = normalized(answer.groupLabel);
        candidates = candidates.filter((question) => {
          const group = question.groupId ? groupById.get(question.groupId) : undefined;
          return normalized(group?.originalLabel) === expected;
        });
      }
      if (!answer.originalNumber && candidates.length > 0) candidates = [candidates[0]];
    }

    if (candidates.length === 1) {
      const question = questionById.get(candidates[0].id)!;
      answer.questionId = question.id;
      question.answerId = answer.id;
      matched.add(question.id);
      continue;
    }

    const reason = answer.issues.includes('答案编号重复') ? '答案编号重复' : '答案无法唯一关联到小题';
    if (!answer.issues.includes(reason)) answer.issues.push(reason);
    reviewItems.push({
      id: `${answer.id}:review`,
      sourceId: answer.sourceId,
      startBlock: answer.startBlock,
      endBlock: answer.endBlock,
      reason,
    });
  }
  return { answers, questions, reviewItems };
}
