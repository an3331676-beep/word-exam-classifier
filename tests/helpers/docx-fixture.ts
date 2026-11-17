import JSZip from 'jszip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export interface FixtureBlock {
  kind?: 'paragraph' | 'table';
  text: string;
  numId?: string;
  level?: number;
  image?: { relationshipId: string; fileName: string; bytes: Uint8Array };
  formula?: string;
  pageBreakBefore?: boolean;
}

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function paragraphXml(block: FixtureBlock): string {
  const numPr = block.numId
    ? `<w:numPr><w:ilvl w:val="${block.level ?? 0}"/><w:numId w:val="${block.numId}"/></w:numPr>`
    : '';
  const pageBreak = block.pageBreakBefore ? '<w:pageBreakBefore/>' : '';
  const image = block.image
    ? `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${block.image.relationshipId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    : '';
  const formula = block.formula
    ? `<m:oMath><m:r><m:t>${escapeXml(block.formula)}</m:t></m:r></m:oMath>`
    : '';
  return `<w:p><w:pPr>${pageBreak}${numPr}</w:pPr><w:r><w:t>${escapeXml(block.text)}</w:t></w:r>${formula}${image}</w:p>`;
}

function tableXml(block: FixtureBlock): string {
  return `<w:tbl><w:tr><w:tc>${paragraphXml({ text: block.text })}</w:tc></w:tr></w:tbl>`;
}

export async function createDocxFixture(blocks: FixtureBlock[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const images = blocks.flatMap((block) => (block.image ? [block.image] : []));
  const body = blocks.map((block) => (block.kind === 'table' ? tableXml(block) : paragraphXml(block))).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="${M}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const imageRelationships = images
    .map(
      (image) =>
        `<Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`,
    )
    .join('');

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file('word/document.xml', documentXml);
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="${REL}">${imageRelationships}<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
  );
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  for (const image of images) {
    zip.file(`word/media/${image.fileName}`, image.bytes);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

export const source = (id: string, fileName: string) => ({ id, fileName });
