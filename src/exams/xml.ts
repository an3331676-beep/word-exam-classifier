export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function parseXml(xml: string, label: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${label} XML 格式无效`);
  }
  return document;
}

export function elementsByLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', name));
}

export function directChildrenByLocalName(root: Element, names: ReadonlySet<string>): Element[] {
  return Array.from(root.children).filter((element) => names.has(element.localName));
}

export function firstByLocalName(root: Document | Element, name: string): Element | undefined {
  return elementsByLocalName(root, name)[0];
}

export function attributeByLocalName(element: Element, name: string): string | undefined {
  return Array.from(element.attributes).find((attribute) => attribute.localName === name)?.value;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
