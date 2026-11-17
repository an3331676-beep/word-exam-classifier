import type { Block, ParsedExam, QuestionDraft, ReviewItem, SectionType, SegmentResult } from './model';

interface SectionMatch {
  title: string;
  type: SectionType;
}

const SECTION_PATTERNS: Array<{ pattern: RegExp; type: SectionType }> = [
  { pattern: /^(?:单项|多项)?选择题(?:$|[\s（(:，,])/, type: 'choice' },
  { pattern: /^填空题(?:$|[\s（(:，,])/, type: 'fill' },
  { pattern: /^(?:英语)?阅读理解(?:$|[\s（(:，,])/, type: 'reading' },
  { pattern: /^Reading Comprehension(?:$|[\s（(:，,])/i, type: 'reading' },
  { pattern: /^(?:英语)?(?:完形|完型)填空(?:$|[\s（(:，,])/, type: 'cloze' },
  { pattern: /^(?:Cloze Test|完形阅读)(?:$|[\s（(:，,])/i, type: 'cloze' },
  { pattern: /^(?:解答题|计算题|证明题|综合题)(?:$|[\s（(:，,])/, type: 'solution' },
  { pattern: /^(?:判断题|实验题|作图题|连线题|阅读题)(?:$|[\s（(:，,])/, type: 'unsupported' },
];

function normalize(text: string): string {
  return text.replaceAll('．', '.').replaceAll('，', ',').replaceAll('：', ':').replace(/\s+/g, ' ').trim();
}

function sectionMatch(block: Block): SectionMatch | undefined {
  const text = normalize(block.text);
  if (!text || text.length > 80) return undefined;
  const withoutPrefix = text.replace(/^[一二三四五六七八九十]+\s*[、.:]\s*/, '');
  for (const candidate of SECTION_PATTERNS) {
    if (candidate.pattern.test(withoutPrefix)) return { title: block.text.trim(), type: candidate.type };
  }
  return undefined;
}

function isAnswerHeading(block: Block): boolean {
  const text = normalize(block.text);
  return text.length <= 30 && /^(?:[一二三四五六七八九十]+[、.])?\s*(?:参考答案|答案与解析|试题答案)\s*$/.test(text);
}

function mainQuestionNumber(block: Block): string | undefined {
  if (block.number?.level === 0) return String(block.number.value);
  const text = normalize(block.text);
  const match = text.match(/^(?:第\s*)?(\d{1,3})(?:\s*题|\s*[.、)]\s*)/);
  return match?.[1];
}

function multipleQuestionMarkers(text: string): boolean {
  const matches = normalize(text).match(/(?:^|\s)\d{1,3}\s*[.、]\s*\S/g) ?? [];
  return matches.length > 1;
}

function addReview(
  reviewItems: ReviewItem[],
  exam: ParsedExam,
  startBlock: number,
  endBlock: number,
  reason: string,
) {
  reviewItems.push({
    id: `${exam.source.id}:review:${startBlock}:${reviewItems.length}`,
    sourceId: exam.source.id,
    startBlock,
    endBlock,
    reason,
  });
}

export function segmentExam(exam: ParsedExam): SegmentResult {
  const questions: QuestionDraft[] = [];
  const reviewItems: ReviewItem[] = [];
  const answerBlocks: Block[] = [];
  let section: SectionMatch | undefined;
  let current: QuestionDraft | undefined;
  let unassignedStart: number | undefined;
  let inAnswerSection = false;

  const closeCurrent = (endBlock: number) => {
    if (!current) return;
    current.endBlock = endBlock;
    questions.push(current);
    current = undefined;
  };

  const closeUnassigned = (endBlock: number) => {
    if (unassignedStart === undefined || unassignedStart >= endBlock) return;
    addReview(reviewItems, exam, unassignedStart, endBlock, '内容没有可靠的主问题题号');
    unassignedStart = undefined;
  };

  for (const block of exam.blocks) {
    if (isAnswerHeading(block)) {
      closeCurrent(block.index);
      closeUnassigned(block.index);
      inAnswerSection = true;
      continue;
    }

    if (inAnswerSection) {
      answerBlocks.push(block);
      continue;
    }

    const nextSection = sectionMatch(block);
    if (nextSection) {
      closeCurrent(block.index);
      closeUnassigned(block.index);
      section = nextSection;
      continue;
    }

    const number = mainQuestionNumber(block);
    if (number) {
      closeCurrent(block.index);
      closeUnassigned(block.index);
      const issues = [...block.issues];
      if (multipleQuestionMarkers(block.text)) {
        const reason = '同一段落疑似包含多道题';
        issues.push(reason);
        addReview(reviewItems, exam, block.index, block.index + 1, reason);
      }
      current = {
        id: `${exam.source.id}:${block.index}`,
        sourceId: exam.source.id,
        originalNumber: number,
        sectionTitle: section?.title,
        sectionType: section?.type,
        startBlock: block.index,
        endBlock: block.index + 1,
        issues,
      };
      continue;
    }

    if (current) {
      current.endBlock = block.index + 1;
      current.issues.push(...block.issues);
    } else if (block.text || block.relationshipIds.length > 0) {
      unassignedStart ??= block.index;
    }
  }

  closeCurrent(exam.blocks.length);
  closeUnassigned(exam.blocks.length);
  for (const issue of exam.issues) addReview(reviewItems, exam, 0, exam.blocks.length, issue);
  return { questions, reviewItems, answerBlocks };
}
