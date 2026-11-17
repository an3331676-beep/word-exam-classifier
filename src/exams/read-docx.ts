import JSZip from 'jszip';
import type { Block, BlockNumber, DocumentResource, ExamSource, ParsedExam } from './model';
import {
  attributeByLocalName,
  directChildrenByLocalName,
  elementsByLocalName,
  firstByLocalName,
  parseXml,
  REL_NS,
} from './xml';

interface NumberLevel {
  start: number;
  format: string;
  text: string;
}

interface NumberingDefinition {
  abstractByNumId: Map<string, string>;
  levelsByAbstractId: Map<string, Map<number, NumberLevel>>;
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

function normalizePackagePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function resolveTarget(sourcePath: string, target: string): string {
  if (target.startsWith('/')) return normalizePackagePath(target.slice(1));
  const directory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
  return normalizePackagePath(`${directory}${target}`);
}

function relationshipsPath(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const directory = slash >= 0 ? partPath.slice(0, slash + 1) : '';
  const fileName = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return `${directory}_rels/${fileName}.rels`;
}

function parseNumbering(xml?: string): NumberingDefinition {
  const definition: NumberingDefinition = {
    abstractByNumId: new Map(),
    levelsByAbstractId: new Map(),
  };
  if (!xml) return definition;

  const document = parseXml(xml, '编号');
  for (const abstract of elementsByLocalName(document, 'abstractNum')) {
    const abstractId = attributeByLocalName(abstract, 'abstractNumId');
    if (!abstractId) continue;
    const levels = new Map<number, NumberLevel>();
    for (const level of elementsByLocalName(abstract, 'lvl')) {
      const levelIndex = Number(attributeByLocalName(level, 'ilvl') ?? '0');
      const start = Number(attributeByLocalName(firstByLocalName(level, 'start') ?? level, 'val') ?? '1');
      const format = attributeByLocalName(firstByLocalName(level, 'numFmt') ?? level, 'val') ?? 'decimal';
      const text = attributeByLocalName(firstByLocalName(level, 'lvlText') ?? level, 'val') ?? `%${levelIndex + 1}.`;
      levels.set(levelIndex, { start, format, text });
    }
    definition.levelsByAbstractId.set(abstractId, levels);
  }
  for (const num of elementsByLocalName(document, 'num')) {
    const numId = attributeByLocalName(num, 'numId');
    const abstractId = attributeByLocalName(firstByLocalName(num, 'abstractNumId') ?? num, 'val');
    if (numId && abstractId) definition.abstractByNumId.set(numId, abstractId);
  }
  return definition;
}

function createNumberResolver(definition: NumberingDefinition) {
  const counters = new Map<string, Map<number, number>>();
  return (paragraph: Element): BlockNumber | undefined => {
    const numPr = firstByLocalName(paragraph, 'numPr');
    if (!numPr) return undefined;
    const numId = attributeByLocalName(firstByLocalName(numPr, 'numId') ?? numPr, 'val');
    const level = Number(attributeByLocalName(firstByLocalName(numPr, 'ilvl') ?? numPr, 'val') ?? '0');
    if (!numId) return undefined;
    const abstractId = definition.abstractByNumId.get(numId);
    const levelDefinition = abstractId ? definition.levelsByAbstractId.get(abstractId)?.get(level) : undefined;
    if (!levelDefinition || levelDefinition.format !== 'decimal') return undefined;

    const perLevel = counters.get(numId) ?? new Map<number, number>();
    const value = (perLevel.get(level) ?? levelDefinition.start - 1) + 1;
    perLevel.set(level, value);
    for (const key of [...perLevel.keys()]) {
      if (key > level) perLevel.delete(key);
    }
    counters.set(numId, perLevel);
    const label = levelDefinition.text.replace(`%${level + 1}`, String(value));
    return { value, level, numId, label };
  };
}

function extractText(element: Element): string {
  const pieces: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  let current = walker.currentNode as Element;
  while (current) {
    if (current.localName === 't') pieces.push(current.textContent ?? '');
    if (current.localName === 'tab') pieces.push('\t');
    if (current.localName === 'br') pieces.push('\n');
    current = walker.nextNode() as Element;
  }
  return pieces.join('').replace(/[ \t]+\n/g, '\n').trim();
}

function relationshipIds(element: Element): string[] {
  const ids = new Set<string>();
  for (const node of [element, ...Array.from(element.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.namespaceURI === REL_NS && ['id', 'embed', 'link'].includes(attribute.localName)) {
        ids.add(attribute.value);
      }
    }
  }
  return [...ids];
}

async function readRelationships(
  zip: JSZip,
  partPath: string,
): Promise<Map<string, DocumentResource>> {
  const result = new Map<string, DocumentResource>();
  const file = zip.file(relationshipsPath(partPath));
  if (!file) return result;
  const document = parseXml(await file.async('string'), '文档关系');
  for (const relationship of elementsByLocalName(document, 'Relationship')) {
    const relationshipId = relationship.getAttribute('Id');
    const type = relationship.getAttribute('Type') ?? '';
    const target = relationship.getAttribute('Target');
    if (!relationshipId || !target || relationship.getAttribute('TargetMode') === 'External') continue;
    const targetPath = resolveTarget(partPath, target);
    const targetFile = zip.file(targetPath);
    if (!targetFile) continue;
    const extension = targetPath.split('.').pop()?.toLowerCase() ?? '';
    result.set(relationshipId, {
      relationshipId,
      type,
      targetPath,
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
      bytes: await targetFile.async('uint8array'),
    });
  }
  return result;
}

async function locateMainDocument(zip: JSZip): Promise<string> {
  const rootRelationships = zip.file('_rels/.rels');
  if (!rootRelationships) return 'word/document.xml';
  const document = parseXml(await rootRelationships.async('string'), '包关系');
  const officeDocument = elementsByLocalName(document, 'Relationship').find((element) =>
    (element.getAttribute('Type') ?? '').endsWith('/officeDocument'),
  );
  return normalizePackagePath(officeDocument?.getAttribute('Target') ?? 'word/document.xml');
}

export async function readDocx(bytes: Uint8Array, source: ExamSource): Promise<ParsedExam> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const documentPath = await locateMainDocument(zip);
    const documentFile = zip.file(documentPath);
    if (!documentFile) throw new Error('缺少正文');
    const document = parseXml(await documentFile.async('string'), '正文');
    const body = firstByLocalName(document, 'body');
    if (!body) throw new Error('缺少正文内容');

    const numberingPath = resolveTarget(documentPath, 'numbering.xml');
    const numberingXml = zip.file(numberingPath) ? await zip.file(numberingPath)!.async('string') : undefined;
    const resolveNumber = createNumberResolver(parseNumbering(numberingXml));
    const resources = await readRelationships(zip, documentPath);
    const serializer = new XMLSerializer();
    const blockElements = directChildrenByLocalName(body, new Set(['p', 'tbl']));
    const blocks: Block[] = blockElements.map((element, index) => {
      const issues: string[] = [];
      if (elementsByLocalName(element, 'anchor').length > 0) issues.push('包含浮动对象，请核对归属');
      const number = element.localName === 'p' ? resolveNumber(element) : undefined;
      return {
        index,
        kind: element.localName === 'tbl' ? 'table' : 'paragraph',
        text: extractText(element),
        xml: serializer.serializeToString(element),
        ...(number ? { number } : {}),
        relationshipIds: relationshipIds(element).filter((id) => resources.has(id)),
        hasFormula: elementsByLocalName(element, 'oMath').length > 0 || elementsByLocalName(element, 'oMathPara').length > 0,
        issues,
      };
    });
    const visibleText = blocks.map((block) => block.text).join('').trim();
    const issues = visibleText ? [] : ['文档没有可编辑文字，可能是整页扫描图片'];
    return { source, blocks, resources, issues };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误';
    throw new Error(`无法读取“${source.fileName}”：${detail}`);
  }
}
