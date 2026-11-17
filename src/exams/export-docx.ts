import JSZip from 'jszip';
import type {
  AnswerItem,
  ClassifiedQuestion,
  DocumentResource,
  ExportQuestionType,
  ParsedExam,
  QuestionGroup,
} from './model';
import { escapeXml, parseXml, REL_NS } from './xml';

export interface ExportedDocx {
  bytes: Uint8Array;
  warnings: string[];
  questionCount: number;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

type ExportableQuestionType = ExportQuestionType | 'solution';

const LABELS: Record<ExportableQuestionType, string> = {
  choice: '选择题汇总',
  fill: '填空题汇总',
  solution: '解答题汇总',
  reading: '英语阅读理解汇总',
  cloze: '英语完形填空汇总',
};

function extension(path: string): string {
  return path.split('.').pop()?.toLowerCase() || 'bin';
}

function sanitizeBlockXml(
  xml: string,
  source: ParsedExam,
  resourceId: (resource: DocumentResource) => string,
  warnings: string[],
  numbering?: { originalNumber: string; outputNumber: number },
): string {
  const wrapped = `<root xmlns:w="${W}" xmlns:r="${REL_NS}" xmlns:m="${M}">${xml}</root>`;
  const document = parseXml(wrapped, '导出内容');
  const root = document.documentElement;
  for (const name of ['numPr', 'pStyle', 'rStyle']) {
    for (const element of Array.from(root.getElementsByTagNameNS('*', name))) element.remove();
  }
  for (const element of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    for (const attribute of [...Array.from(element.attributes)]) {
      if (attribute.namespaceURI !== REL_NS || !['id', 'embed', 'link'].includes(attribute.localName)) continue;
      const resource = source.resources.get(attribute.value);
      if (resource?.type.endsWith('/image')) {
        element.setAttributeNS(REL_NS, attribute.name, resourceId(resource));
      } else {
        element.removeAttributeNode(attribute);
        warnings.push(`已移除无法迁移的外部对象关系 ${attribute.value}`);
      }
    }
  }
  if (numbering) {
    const firstText = Array.from(root.getElementsByTagNameNS(W, 't'))[0];
    const escapedNumber = numbering.originalNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = new RegExp(`^(?:第\\s*)?${escapedNumber}(?:\\s*题|\\s*[.．、)）]\\s*)`);
    if (firstText) {
      const content = firstText.textContent ?? '';
      firstText.textContent = `${numbering.outputNumber}. ${content.replace(prefix, '')}`;
      firstText.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    } else {
      const paragraph = Array.from(root.getElementsByTagNameNS(W, 'p'))[0];
      if (paragraph) {
        const run = document.createElementNS(W, 'w:r');
        const text = document.createElementNS(W, 'w:t');
        text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        text.textContent = `${numbering.outputNumber}. `;
        run.append(text);
        const properties = Array.from(paragraph.children).find((child) => child.localName === 'pPr');
        paragraph.insertBefore(run, properties?.nextSibling ?? paragraph.firstChild);
      }
    }
  }
  return Array.from(root.children).map((child) => new XMLSerializer().serializeToString(child)).join('');
}

function textParagraph(text: string, style = ''): string {
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export async function exportCategoryDocx(
  type: ExportableQuestionType,
  allQuestions: ClassifiedQuestion[],
  exams: ParsedExam[],
  groups: QuestionGroup[] = [],
  answers: AnswerItem[] = [],
): Promise<ExportedDocx> {
  const questions = allQuestions.filter((question) => question.type === type);
  const examsById = new Map(exams.map((exam) => [exam.source.id, exam]));
  const zip = new JSZip();
  const warnings: string[] = [];
  const relationships: string[] = [];
  const imageContentTypes = new Map<string, string>();
  const resourceIds = new Map<string, string>();
  let imageSequence = 0;

  const registerResource = (sourceId: string, resource: DocumentResource): string => {
    const key = `${sourceId}:${resource.relationshipId}`;
    const existing = resourceIds.get(key);
    if (existing) return existing;
    imageSequence += 1;
    const relationshipId = `rIdImage${imageSequence}`;
    const ext = extension(resource.targetPath);
    const target = `media/image-${imageSequence}.${ext}`;
    zip.file(`word/${target}`, resource.bytes);
    relationships.push(
      `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`,
    );
    imageContentTypes.set(ext, resource.contentType);
    resourceIds.set(key, relationshipId);
    return relationshipId;
  };

  const bodyParts = [
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${LABELS[type]}</w:t></w:r></w:p>`,
  ];

  const fallbackNumber = new Map(questions.map((question, index) => [question.id, index + 1]));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const renderedQuestionIds = new Set<string>();
  const renderBlocks = (exam: ParsedExam, startBlock: number, endBlock: number) => {
    for (const block of exam.blocks.slice(startBlock, endBlock)) {
      bodyParts.push(
        sanitizeBlockXml(
          block.xml,
          exam,
          (resource) => registerResource(exam.source.id, resource),
          warnings,
        ),
      );
    }
  };
  const renderQuestion = (question: ClassifiedQuestion) => {
    const exam = examsById.get(question.sourceId);
    if (!exam) {
      warnings.push(`找不到题目 ${question.id} 的来源文档`);
      return;
    }
    const outputNumber = question.outputNumber ?? fallbackNumber.get(question.id) ?? 1;
    for (const [index, block] of exam.blocks.slice(question.startBlock, question.endBlock).entries()) {
      bodyParts.push(
        sanitizeBlockXml(
          block.xml,
          exam,
          (resource) => registerResource(exam.source.id, resource),
          warnings,
          index === 0 ? { originalNumber: question.originalNumber, outputNumber } : undefined,
        ),
      );
    }
    renderedQuestionIds.add(question.id);
  };

  const isGroupedType = type === 'reading' || type === 'cloze';
  const typeGroups = groups.filter((group) => group.type === type);
  if (isGroupedType && typeGroups.length > 0) {
    for (const [groupIndex, group] of typeGroups.entries()) {
      const groupQuestions = group.questionIds
        .map((id) => questionById.get(id))
        .filter((question): question is ClassifiedQuestion => Boolean(question));
      if (groupQuestions.length === 0) continue;
      bodyParts.push(
        textParagraph(
          `${type === 'reading' ? '阅读' : '完形'} ${groupIndex + 1}`,
          '<w:pPr><w:spacing w:before="320" w:after="120"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr>',
        ),
      );
      const exam = examsById.get(group.sourceId);
      if (exam) renderBlocks(exam, group.materialStartBlock, group.materialEndBlock);
      else warnings.push(`找不到文章组 ${group.id} 的来源文档`);
      for (const question of groupQuestions) renderQuestion(question);
    }
  }
  for (const question of questions) {
    if (!renderedQuestionIds.has(question.id)) renderQuestion(question);
  }

  const mappedAnswers = answers.filter((answer) => answer.questionId && questionById.has(answer.questionId));
  const answerByQuestionId = new Map(mappedAnswers.map((answer) => [answer.questionId!, answer]));
  const stripAnswerNumber = (answer: AnswerItem): string => {
    if (!answer.originalNumber) return answer.text;
    const escapedNumber = answer.originalNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return answer.text.replace(new RegExp(`^${escapedNumber}\\s*[.、)）]\\s*`), '');
  };
  const renderAnswer = (question: ClassifiedQuestion) => {
    const answer = answerByQuestionId.get(question.id);
    if (!answer) return;
    const outputNumber = question.outputNumber ?? fallbackNumber.get(question.id) ?? 1;
    bodyParts.push(textParagraph(`${outputNumber}. ${stripAnswerNumber(answer)}`));
  };
  if (mappedAnswers.length > 0) {
    bodyParts.push(
      textParagraph(
        '答案与解析',
        '<w:pPr><w:pageBreakBefore/><w:spacing w:after="180"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr>',
      ),
    );
    if (isGroupedType && typeGroups.length > 0) {
      for (const [groupIndex, group] of typeGroups.entries()) {
        const groupQuestions = group.questionIds
          .map((id) => questionById.get(id))
          .filter((question): question is ClassifiedQuestion => Boolean(question));
        if (!groupQuestions.some((question) => answerByQuestionId.has(question.id))) continue;
        bodyParts.push(
          textParagraph(
            `${type === 'reading' ? '阅读' : '完形'} ${groupIndex + 1}`,
            '<w:pPr><w:spacing w:before="240" w:after="80"/><w:keepNext/></w:pPr><w:rPr><w:b/></w:rPr>',
          ),
        );
        for (const question of groupQuestions) renderAnswer(question);
      }
    } else {
      for (const question of questions) renderAnswer(question);
    }
  }

  const defaults = [...imageContentTypes.entries()]
    .map(([ext, contentType]) => `<Default Extension="${escapeXml(ext)}" ContentType="${escapeXml(contentType)}"/>`)
    .join('');
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL}">${relationships.join('')}</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${REL_NS}" xmlns:m="${M}"><w:body>${bodyParts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
  );
  return {
    bytes: await zip.generateAsync({ type: 'uint8array' }),
    warnings: [...new Set(warnings)],
    questionCount: questions.length,
  };
}
