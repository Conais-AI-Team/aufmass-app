const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const planArg = process.argv[2] || 'rechnung-revize-plani';
const inputPath = path.join(process.cwd(), '.claude', 'plans', `${planArg}.md`);
const outputPath = path.join(process.cwd(), '.claude', 'plans', `${planArg}.docx`);

if (!fs.existsSync(inputPath)) {
  console.error('Plan MD bulunamadi:', inputPath);
  process.exit(1);
}

const md = fs.readFileSync(inputPath, 'utf8');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textRun(text, options = {}) {
  const props = [];
  if (options.bold) props.push('<w:b/>');
  if (options.italic) props.push('<w:i/>');
  if (options.color) props.push(`<w:color w:val="${options.color}"/>`);
  if (options.size) props.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`);
  if (options.font) props.push(`<w:rFonts w:ascii="${options.font}" w:hAnsi="${options.font}" w:cs="${options.font}"/>`);
  return `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(text = '', options = {}) {
  const pPr = [];
  if (options.align) pPr.push(`<w:jc w:val="${options.align}"/>`);
  if (options.shading) pPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>`);
  if (options.spacingBefore !== undefined || options.spacingAfter !== undefined) {
    const attrs = [];
    if (options.spacingBefore !== undefined) attrs.push(`w:before="${options.spacingBefore}"`);
    if (options.spacingAfter !== undefined) attrs.push(`w:after="${options.spacingAfter}"`);
    pPr.push(`<w:spacing ${attrs.join(' ')}/>`);
  }
  if (options.indent) pPr.push(`<w:ind w:left="${options.indent}"/>`);
  let content = '';
  const lines = String(text).split('\n');
  lines.forEach((line, index) => {
    if (index > 0) content += '<w:r><w:br/></w:r>';
    content += textRun(line, options);
  });
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${content || '<w:r><w:t></w:t></w:r>'}</w:p>`;
}

function inlineRuns(text, baseOptions = {}) {
  // Parse **bold** and `code`
  const parts = [];
  let i = 0;
  let buffer = '';
  while (i < text.length) {
    if (text.substr(i, 2) === '**') {
      if (buffer) { parts.push(textRun(buffer, baseOptions)); buffer = ''; }
      const end = text.indexOf('**', i + 2);
      if (end === -1) { buffer += '**'; i += 2; continue; }
      parts.push(textRun(text.substring(i + 2, end), { ...baseOptions, bold: true }));
      i = end + 2;
    } else if (text[i] === '`') {
      if (buffer) { parts.push(textRun(buffer, baseOptions)); buffer = ''; }
      const end = text.indexOf('`', i + 1);
      if (end === -1) { buffer += '`'; i += 1; continue; }
      parts.push(textRun(text.substring(i + 1, end), { ...baseOptions, font: 'Consolas', shading: 'F4F4F4' }));
      i = end + 1;
    } else {
      buffer += text[i];
      i += 1;
    }
  }
  if (buffer) parts.push(textRun(buffer, baseOptions));
  return parts.join('');
}

function inlineParagraph(text, options = {}) {
  const pPr = [];
  if (options.spacingBefore !== undefined || options.spacingAfter !== undefined) {
    const attrs = [];
    if (options.spacingBefore !== undefined) attrs.push(`w:before="${options.spacingBefore}"`);
    if (options.spacingAfter !== undefined) attrs.push(`w:after="${options.spacingAfter}"`);
    pPr.push(`<w:spacing ${attrs.join(' ')}/>`);
  }
  if (options.indent) pPr.push(`<w:ind w:left="${options.indent}"/>`);
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${inlineRuns(text, options)}</w:p>`;
}

function heading1(text) {
  return paragraph(text, { bold: true, size: 36, color: '1F4E79', spacingBefore: 360, spacingAfter: 200 });
}
function heading2(text) {
  return paragraph(text, { bold: true, size: 28, color: '2E74B5', spacingBefore: 280, spacingAfter: 140 });
}
function heading3(text) {
  return paragraph(text, { bold: true, size: 24, color: '1F4E79', spacingBefore: 200, spacingAfter: 100 });
}

function cell(content, width, options = {}) {
  const lines = Array.isArray(content) ? content : String(content).split('\n');
  const paragraphs = lines.map((line) => {
    const pPr = [];
    if (options.header) pPr.push('<w:jc w:val="left"/>');
    return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${inlineRuns(line, { bold: options.header, size: options.header ? 20 : 18 })}</w:p>`;
  }).join('');
  const tcProps = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    options.header ? '<w:shd w:val="clear" w:color="auto" w:fill="2E74B5"/>' : '',
    '<w:vAlign w:val="center"/>'
  ].join('');
  return `<w:tc><w:tcPr>${tcProps}</w:tcPr>${paragraphs}</w:tc>`;
}

function buildTable(headers, rows, widths) {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const headerRow = `<w:tr>${headers.map((h, i) => cell(h, widths[i], { header: true })).join('')}</w:tr>`;
  const bodyRows = rows.map((row) => `<w:tr>${row.map((v, i) => cell(v, widths[i])).join('')}</w:tr>`).join('');
  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="999999"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="999999"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="999999"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="999999"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>${grid}</w:tblGrid>
      ${headerRow}
      ${bodyRows}
    </w:tbl>
  `;
}

// === MD parser ===
const lines = md.split(/\r?\n/);
const parts = [];
let i = 0;
let inCodeBlock = false;
let codeLines = [];

function flushCodeBlock() {
  if (codeLines.length === 0) return;
  // Render code block as monospace paragraphs with light gray background
  codeLines.forEach((line) => {
    parts.push(paragraph(line || ' ', {
      font: 'Consolas',
      size: 18,
      shading: 'F4F4F4',
      spacingAfter: 0
    }));
  });
  parts.push(paragraph('', { spacingAfter: 120 }));
  codeLines = [];
}

while (i < lines.length) {
  const line = lines[i];

  // Code block fence
  if (line.startsWith('```')) {
    if (inCodeBlock) {
      flushCodeBlock();
      inCodeBlock = false;
    } else {
      inCodeBlock = true;
    }
    i++;
    continue;
  }
  if (inCodeBlock) {
    codeLines.push(line);
    i++;
    continue;
  }

  // Horizontal rule
  if (/^---+$/.test(line.trim())) {
    parts.push(paragraph('', { spacingAfter: 120 }));
    i++;
    continue;
  }

  // Headings
  if (line.startsWith('# ')) { parts.push(heading1(line.substring(2).trim())); i++; continue; }
  if (line.startsWith('## ')) { parts.push(heading2(line.substring(3).trim())); i++; continue; }
  if (line.startsWith('### ')) { parts.push(heading3(line.substring(4).trim())); i++; continue; }
  if (line.startsWith('#### ')) { parts.push(heading3(line.substring(5).trim())); i++; continue; }

  // Tables
  if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*[-:]+/.test(lines[i + 1])) {
    const headerCells = line.split('|').map((c) => c.trim()).filter(Boolean);
    i += 2;
    const tableRows = [];
    while (i < lines.length && lines[i].includes('|')) {
      const rowCells = lines[i].split('|').map((c) => c.trim()).filter((c, idx, arr) => {
        // Keep cells that aren't outside the boundaries
        return !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === '');
      });
      // Simple split — restore by splitting differently
      const properCells = lines[i].split('|');
      // Strip first and last empty if line starts/ends with |
      if (properCells[0].trim() === '') properCells.shift();
      if (properCells[properCells.length - 1].trim() === '') properCells.pop();
      tableRows.push(properCells.map((c) => c.trim()));
      i++;
    }
    // Compute widths — total page width ~9000 dxa
    const totalWidth = 9000;
    const colCount = headerCells.length;
    const widths = new Array(colCount).fill(Math.floor(totalWidth / colCount));
    parts.push(buildTable(headerCells, tableRows, widths));
    parts.push(paragraph('', { spacingAfter: 120 }));
    continue;
  }

  // Bullet
  if (/^\s*[-*]\s/.test(line)) {
    const indent = line.match(/^(\s*)/)[1].length;
    const text = line.replace(/^\s*[-*]\s/, '');
    parts.push(inlineParagraph('• ' + text, { indent: 200 + indent * 200, size: 20, spacingAfter: 40 }));
    i++;
    continue;
  }

  // Numbered list
  if (/^\s*\d+\.\s/.test(line)) {
    const text = line.replace(/^\s*(\d+\.\s)/, '$1');
    parts.push(inlineParagraph(text, { indent: 200, size: 20, spacingAfter: 40 }));
    i++;
    continue;
  }

  // Blockquote
  if (line.startsWith('> ')) {
    parts.push(inlineParagraph(line.substring(2), { italic: true, color: '666666', indent: 400, size: 20, spacingAfter: 60 }));
    i++;
    continue;
  }

  // Empty line
  if (line.trim() === '') {
    parts.push(paragraph('', { spacingAfter: 80 }));
    i++;
    continue;
  }

  // Regular paragraph
  parts.push(inlineParagraph(line, { size: 20, spacingAfter: 80 }));
  i++;
}

// Flush any unclosed code block
if (inCodeBlock) flushCodeBlock();

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${parts.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
</w:styles>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

const createdDate = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Aufmass App - Rechnung Revize Plani</dc:title>
  <dc:creator>Claude Code</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdDate}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdDate}</dcterms:modified>
</cp:coreProperties>`;

const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Claude Code</Application>
  <DocSecurity>0</DocSecurity>
</Properties>`;

const buildDir = path.join(process.cwd(), '.docx-build-plan');
if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(buildDir, '_rels'), { recursive: true });
fs.mkdirSync(path.join(buildDir, 'docProps'), { recursive: true });
fs.mkdirSync(path.join(buildDir, 'word', '_rels'), { recursive: true });

fs.writeFileSync(path.join(buildDir, '[Content_Types].xml'), contentTypesXml, 'utf8');
fs.writeFileSync(path.join(buildDir, '_rels', '.rels'), relsXml, 'utf8');
fs.writeFileSync(path.join(buildDir, 'docProps', 'core.xml'), coreXml, 'utf8');
fs.writeFileSync(path.join(buildDir, 'docProps', 'app.xml'), appXml, 'utf8');
fs.writeFileSync(path.join(buildDir, 'word', 'document.xml'), documentXml, 'utf8');
fs.writeFileSync(path.join(buildDir, 'word', 'styles.xml'), stylesXml, 'utf8');
fs.writeFileSync(path.join(buildDir, 'word', '_rels', 'document.xml.rels'), documentRelsXml, 'utf8');

if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });

// Use PowerShell Compress-Archive
const tempZip = outputPath + '.zip';
const psCommand = `Compress-Archive -Path "${buildDir}\\*" -DestinationPath "${tempZip}" -Force`;
execFileSync('powershell', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
fs.renameSync(tempZip, outputPath);
fs.rmSync(buildDir, { recursive: true, force: true });

console.log('DOCX olusturuldu:', outputPath);
