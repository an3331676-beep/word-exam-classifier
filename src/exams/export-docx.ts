import JSZip from 'jszip';
import type { ClassifiedQuestion, DocumentResource, ParsedExam, QuestionType } from './model';
import { escapeXml, parseXml, REL_NS } from './xml';

export interface ExportedDocx {
  bytes: Uint8Array;
  warnings: string[];
  questionCount: number;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const LABELS: Record<Exclude<QuestionType, 'unknown'>, string> = {
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
  return Array.from(root.children).map((child) => new XMLSerializer().serializeToString(child)).join('');
}

function textParagraph(text: string, style = ''): string {
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export async function exportCategoryDocx(
  type: Exclude<QuestionType, 'unknown'>,
  allQuestions: ClassifiedQuestion[],
  exams: ParsedExam[],
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
  for (const [index, question] of questions.entries()) {
    const exam = examsById.get(question.sourceId);
    if (!exam) {
      warnings.push(`找不到题目 ${question.id} 的来源文档`);
      continue;
    }
    bodyParts.push(
      textParagraph(
        `${index + 1}.  来源：${exam.source.fileName} · 原题 ${question.originalNumber}`,
        '<w:pPr><w:spacing w:before="240" w:after="80"/><w:keepNext/></w:pPr>',
      ),
    );
    for (const block of exam.blocks.slice(question.startBlock, question.endBlock)) {
      bodyParts.push(
        sanitizeBlockXml(
          block.xml,
          exam,
          (resource) => registerResource(exam.source.id, resource),
          warnings,
        ),
      );
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
