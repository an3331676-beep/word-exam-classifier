import type {
  ClassifiedQuestion,
  ExportQuestionType,
  OutputNumber,
} from './model';

export const EXPORT_TYPES: ExportQuestionType[] = ['choice', 'fill', 'reading', 'cloze'];

export function createNumberMap(numbering: OutputNumber[]): Map<string, number> {
  return new Map(numbering.map((item) => [item.questionId, item.value]));
}

export function renumberQuestions(
  allQuestions: ClassifiedQuestion[],
  type: ExportQuestionType,
): { questions: ClassifiedQuestion[]; numbering: OutputNumber[] } {
  const numbering: OutputNumber[] = [];
  let value = 0;
  const questions = allQuestions.map((question) => {
    if (question.type !== type) return { ...question };
    value += 1;
    numbering.push({ questionId: question.id, value });
    return { ...question, outputNumber: value };
  });
  return { questions, numbering };
}

export function renumberAllTypes(allQuestions: ClassifiedQuestion[]): {
  questions: ClassifiedQuestion[];
  numberingByType: Partial<Record<ExportQuestionType, OutputNumber[]>>;
} {
  const counters = new Map<ExportQuestionType, number>(EXPORT_TYPES.map((type) => [type, 0]));
  const numberingByType: Partial<Record<ExportQuestionType, OutputNumber[]>> = Object.fromEntries(
    EXPORT_TYPES.map((type) => [type, []]),
  );
  const questions = allQuestions.map((question) => {
    if (!EXPORT_TYPES.includes(question.type as ExportQuestionType)) return { ...question };
    const type = question.type as ExportQuestionType;
    const value = (counters.get(type) ?? 0) + 1;
    counters.set(type, value);
    numberingByType[type]!.push({ questionId: question.id, value });
    return { ...question, outputNumber: value };
  });
  return { questions, numberingByType };
}
