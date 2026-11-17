import type { Block, ClassifiedQuestion, QuestionDraft, QuestionType } from './model';

function distinctOptionSequence(text: string): boolean {
  const markers = [...text.matchAll(/(?:^|\s)([A-DＡ-Ｄ])\s*[.．、:：)）]/g)].map((match) =>
    match[1].normalize('NFKC'),
  );
  return ['A', 'B', 'C', 'D'].every((letter, index) => markers[index] === letter);
}

function fallbackSignals(text: string): QuestionType[] {
  const signals: QuestionType[] = [];
  if (distinctOptionSequence(text)) signals.push('choice');
  if (/(?:_{3,}|＿{3,}|（\s*）|\(\s*\))/.test(text) && /(?:填|横线|空处|空格|填入)/.test(text)) {
    signals.push('fill');
  }
  const subQuestions = text.match(/(?:（\d+）|\(\d+\))/g) ?? [];
  if (/(?:求|计算|解答|证明|说明理由|写出|作图)/.test(text) && subQuestions.length > 0) {
    signals.push('solution');
  }
  return [...new Set(signals)];
}

export function classifyQuestion(draft: QuestionDraft, blocks: Block[]): ClassifiedQuestion {
  if (draft.sectionType && draft.sectionType !== 'unsupported') {
    return {
      ...draft,
      type: draft.sectionType,
      reason: `依据栏目“${draft.sectionTitle ?? draft.sectionType}”`,
    };
  }
  if (draft.sectionType === 'unsupported') {
    return { ...draft, type: 'unknown', reason: `栏目“${draft.sectionTitle ?? '其他题型'}”不在三类范围内` };
  }

  const text = blocks.map((block) => block.text).join(' ');
  const signals = fallbackSignals(text);
  if (signals.length === 1) {
    const labels: Record<Exclude<QuestionType, 'unknown'>, string> = {
      choice: '检测到按序排列的 A—D 选项',
      fill: '检测到明确填答语句和空线',
      solution: '检测到求解要求和独立小问',
      reading: '依据阅读理解栏目',
      cloze: '依据完形填空栏目',
    };
    return { ...draft, type: signals[0], reason: labels[signals[0] as Exclude<QuestionType, 'unknown'>] };
  }
  return {
    ...draft,
    type: 'unknown',
    reason: signals.length > 1 ? '同时命中多种题型结构' : '没有足够的题型依据',
  };
}
