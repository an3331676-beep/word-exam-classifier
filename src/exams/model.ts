export type QuestionType = 'choice' | 'fill' | 'solution' | 'unknown';
export type SectionType = Exclude<QuestionType, 'unknown'> | 'unsupported';

export interface ExamSource {
  id: string;
  fileName: string;
}

export interface BlockNumber {
  value: number;
  level: number;
  numId: string;
  label: string;
}

export interface Block {
  index: number;
  kind: 'paragraph' | 'table';
  text: string;
  xml: string;
  number?: BlockNumber;
  relationshipIds: string[];
  hasFormula: boolean;
  issues: string[];
}

export interface DocumentResource {
  relationshipId: string;
  type: string;
  targetPath: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ParsedExam {
  source: ExamSource;
  blocks: Block[];
  resources: Map<string, DocumentResource>;
  issues: string[];
}

export interface QuestionDraft {
  id: string;
  sourceId: string;
  originalNumber: string;
  sectionTitle?: string;
  sectionType?: SectionType;
  startBlock: number;
  endBlock: number;
  issues: string[];
}

export interface ClassifiedQuestion extends QuestionDraft {
  type: QuestionType;
  reason: string;
}

export interface ReviewItem {
  id: string;
  sourceId: string;
  startBlock: number;
  endBlock: number;
  reason: string;
}

export interface SegmentResult {
  questions: QuestionDraft[];
  reviewItems: ReviewItem[];
}

export interface FileError {
  fileName: string;
  message: string;
}

export interface BatchResult {
  exams: ParsedExam[];
  questions: ClassifiedQuestion[];
  reviewItems: ReviewItem[];
  fileErrors: FileError[];
}

export interface UploadLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
