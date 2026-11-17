import { isEnglishQuestionType } from './model';
import type { ClassifiedQuestion, EnglishQuestionType, ParsedExam, QuestionGroup } from './model';

interface PassageMarker {
  index: number;
  label: string;
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function detectPassageLabel(text: string): string | undefined {
  const value = normalized(text);
  if (value.length > 40) return undefined;
  if (/^(?:Passage|Text)\s+[A-Z0-9一二三四五六七八九十]+(?:\s*[:：.-])?$/i.test(value)) return value;
  if (/^第\s*[一二三四五六七八九十0-9]+\s*篇(?:\s*[:：.-])?$/.test(value)) return value;
  if (/^[A-ZＡ-Ｚ]\s*篇(?:\s*[:：.-])?$/i.test(value)) return value;
  return undefined;
}

function findSectionStart(exam: ParsedExam, questions: ClassifiedQuestion[]): number {
  const first = questions[0];
  const title = normalized(first.sectionTitle ?? '');
  if (!title) return first.startBlock;

  let result = first.startBlock;
  for (const block of exam.blocks) {
    if (block.index >= first.startBlock) break;
    if (normalized(block.text) === title) result = block.index;
  }
  return result;
}

function groupType(
  exam: ParsedExam,
  allQuestions: ClassifiedQuestion[],
  type: EnglishQuestionType,
  questionById: Map<string, ClassifiedQuestion>,
): QuestionGroup[] {
  const questions = allQuestions
    .filter((question) => question.type === type)
    .sort((a, b) => a.startBlock - b.startBlock);
  if (questions.length === 0) return [];

  const sectionStart = findSectionStart(exam, questions);
  const finalEnd = Math.max(...questions.map((question) => question.endBlock));
  const markers: PassageMarker[] = exam.blocks
    .filter((block) => block.index > sectionStart && block.index <= questions.at(-1)!.startBlock)
    .flatMap((block) => {
      const label = detectPassageLabel(block.text);
      return label ? [{ index: block.index, label }] : [];
    });

  const starts: PassageMarker[] = [];
  if (markers.length === 0 || markers[0].index > questions[0].startBlock) {
    starts.push({ index: sectionStart + 1, label: '' });
  }
  starts.push(...markers);

  const groups: QuestionGroup[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const marker = starts[index];
    const nextStart = starts[index + 1]?.index ?? finalEnd;
    const members = questions.filter((question) => {
      const afterStart = marker.label ? question.startBlock > marker.index : question.startBlock >= marker.index;
      return afterStart && question.startBlock < nextStart;
    });
    if (members.length === 0) continue;

    const id = `${exam.source.id}:${type}:group-${groups.length + 1}`;
    const materialEndBlock = members[0].startBlock;
    const group: QuestionGroup = {
      id,
      sourceId: exam.source.id,
      type,
      ...(marker.label ? { originalLabel: marker.label } : {}),
      materialStartBlock: marker.index,
      materialEndBlock,
      questionIds: members.map((question) => question.id),
      issues: materialEndBlock <= marker.index ? ['未识别到独立的文章正文'] : [],
    };
    groups.push(group);

    for (const member of members) {
      const output = questionById.get(member.id)!;
      output.groupId = id;
      if (output.endBlock > nextStart) output.endBlock = nextStart;
    }
  }

  return groups;
}

export function groupEnglishQuestions(
  exam: ParsedExam,
  questions: ClassifiedQuestion[],
): { groups: QuestionGroup[]; questions: ClassifiedQuestion[] } {
  const outputQuestions = questions.map((question) => ({ ...question, issues: [...question.issues] }));
  const questionById = new Map(outputQuestions.map((question) => [question.id, question]));
  const englishTypes = outputQuestions
    .map((question) => question.type)
    .filter(isEnglishQuestionType);
  const types = [...new Set(englishTypes)];
  const groups = types.flatMap((type) => groupType(exam, outputQuestions, type, questionById));
  return { groups, questions: outputQuestions };
}
