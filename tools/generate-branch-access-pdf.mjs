import fs from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim();
}

const input = await readStdin();
if (!input) throw new Error('Provisioning JSON is required on stdin');
const data = JSON.parse(input);
if (data.mode !== 'apply' || !Array.isArray(data.credentials)) {
  throw new Error('Applied provisioning result with credentials is required');
}

function dateInBerlin(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const outputPath = path.resolve(
  getArg(
    '--out',
    `AYLUX_Branch_Kullanim_Listesi_${dateInBerlin(data.appliedAt)}.pdf`,
  ),
);
const dnsStatus = getArg('--siegen-dns', 'pending');
const httpsStatus = getArg('--siegen-https', 'pending');

const doc = new jsPDF({ unit: 'mm', format: 'a4' });
const fontSets = [
  {
    name: 'Arial',
    normal: 'C:/Windows/Fonts/arial.ttf',
    bold: 'C:/Windows/Fonts/arialbd.ttf',
  },
  {
    name: 'DejaVuSans',
    normal: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  },
  {
    name: 'LiberationSans',
    normal: '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    bold: '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
  },
];
const selectedFonts = fontSets.find((set) => (
  fs.existsSync(set.normal) && fs.existsSync(set.bold)
));
if (!selectedFonts) {
  throw new Error(
    'Unicode font not found. Install fonts-dejavu-core on Linux or Arial on Windows.',
  );
}
for (const [file, style] of [
  [selectedFonts.normal, 'normal'],
  [selectedFonts.bold, 'bold'],
]) {
  const base64 = fs.readFileSync(file).toString('base64');
  const vfsName = path.basename(file);
  doc.addFileToVFS(vfsName, base64);
  doc.addFont(vfsName, selectedFonts.name, style);
}

const COLORS = {
  green: [99, 130, 39],
  greenLight: [238, 243, 228],
  dark: [34, 38, 30],
  grey: [102, 108, 98],
  line: [214, 219, 208],
  amber: [176, 122, 20],
  amberLight: [252, 245, 228],
  red: [165, 49, 49],
  redLight: [251, 235, 235],
  white: [255, 255, 255],
};
const MARGIN = 12;
const WIDTH = 210 - (MARGIN * 2);

function font(style = 'normal', size = 9) {
  doc.setFont(selectedFonts.name, style);
  doc.setFontSize(size);
}

function textColor(color) {
  doc.setTextColor(...color);
}

function fillColor(color) {
  doc.setFillColor(...color);
}

function drawColor(color) {
  doc.setDrawColor(...color);
}

function addHeader(title, subtitle) {
  fillColor(COLORS.green);
  doc.rect(0, 0, 210, 30, 'F');
  font('bold', 16);
  textColor(COLORS.white);
  doc.text(title, MARGIN, 13.5);
  font('normal', 8.8);
  textColor([226, 236, 209]);
  doc.text(subtitle, MARGIN, 21);
}

function addFooter(pageNumber) {
  drawColor(COLORS.line);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 283, MARGIN + WIDTH, 283);
  font('normal', 6.8);
  textColor(COLORS.grey);
  doc.text('GİZLİ · Geçici parolaları güvenli kanaldan paylaşın ve ilk girişte değiştirin.', MARGIN, 288);
  doc.text(`AYLUX × Conais · Sayfa ${pageNumber}`, MARGIN + WIDTH, 288, { align: 'right' });
}

function sectionTitle(title, y) {
  font('bold', 11);
  textColor(COLORS.dark);
  doc.text(title, MARGIN, y);
  drawColor(COLORS.green);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, y + 2.5, MARGIN + 45, y + 2.5);
  return y + 9;
}

function wrappedText(value, x, y, maxWidth, lineHeight = 4.2) {
  const lines = doc.splitTextToSize(String(value), maxWidth);
  doc.text(lines, x, y);
  return y + (lines.length * lineHeight);
}

function credentialCard(credential, y) {
  fillColor(COLORS.greenLight);
  drawColor(COLORS.green);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, y, WIDTH, 42, 2, 2, 'FD');

  font('bold', 11.5);
  textColor(COLORS.green);
  doc.text(credential.branchName, MARGIN + 6, y + 8);

  const rows = [
    ['URL', credential.url],
    ['Kullanıcı', credential.email],
    ['Geçici parola', credential.temporaryPassword],
  ];
  let rowY = y + 15;
  for (const [label, value] of rows) {
    font('bold', 8.2);
    textColor(COLORS.dark);
    doc.text(label, MARGIN + 6, rowY);
    font(label === 'Geçici parola' ? 'bold' : 'normal', label === 'Geçici parola' ? 10 : 8.2);
    textColor(label === 'Geçici parola' ? COLORS.red : COLORS.dark);
    doc.text(value, MARGIN + 37, rowY);
    rowY += 7;
  }

  font('normal', 7);
  textColor(COLORS.grey);
  doc.text('Rol: admin · Parola ilk girişten sonra değiştirilmelidir.', MARGIN + 6, y + 37);
  return y + 48;
}

addHeader(
  'AYLUX Branch Kullanım ve Giriş Listesi',
  `Düsseldorf ve Siegen erişimleri · Oluşturma: ${new Date(data.appliedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
);

let y = 40;
fillColor(COLORS.redLight);
drawColor(COLORS.red);
doc.setLineWidth(0.4);
doc.roundedRect(MARGIN, y, WIDTH, 18, 2, 2, 'FD');
font('bold', 9.2);
textColor(COLORS.red);
doc.text('GİZLİ BELGE', MARGIN + 5, y + 7);
font('normal', 7.8);
textColor(COLORS.dark);
doc.text('Bu belge geçici parolalar içerir. E-posta veya herkese açık mesaj grubunda paylaşmayın.', MARGIN + 5, y + 13);
y += 27;

y = sectionTitle('1 · Yeni / düzeltilen branch girişleri', y);
for (const credential of data.credentials) {
  y = credentialCard(credential, y);
}

const siegenDnsReady = dnsStatus === 'ready';
const siegenHttpsReady = httpsStatus === 'ready';
const siegenDomainReady = siegenDnsReady && siegenHttpsReady;
fillColor(siegenDomainReady ? COLORS.greenLight : COLORS.amberLight);
drawColor(siegenDomainReady ? COLORS.green : COLORS.amber);
doc.setLineWidth(0.35);
doc.roundedRect(MARGIN, y, WIDTH, 17, 1.5, 1.5, 'FD');
font('bold', 8.3);
textColor(siegenDomainReady ? COLORS.green : COLORS.amber);
doc.text(`Siegen domain durumu: ${siegenDomainReady ? 'HAZIR' : 'BEKLİYOR'}`, MARGIN + 5, y + 7);
font('normal', 7.5);
textColor(COLORS.dark);
doc.text(
  siegenDomainReady
    ? 'ayluxsi.cnsform.com DNS, HTTPS ve uygulama yönlendirmesi doğrulandı.'
    : `DNS: ${siegenDnsReady ? 'hazır' : 'bekliyor'} · HTTPS/uygulama: ${siegenHttpsReady ? 'hazır' : 'bekliyor'}.`,
  MARGIN + 5,
  y + 12.5,
);

addFooter(1);

doc.addPage();
addHeader(
  'Branch Kararları ve Veri Koruma Notu',
  'Neden München ve Gelsenkirchen için yeni domain açılmadı?',
);
y = 42;
y = sectionTitle('2 · München', y);
font('normal', 8.5);
textColor(COLORS.dark);
const muenchenBefore = data.before?.branches?.find((branch) => branch.slug === 'ayluxmau');
y = wrappedText(
  `Mevcut tenant: ayluxmau.cnsform.com. Bu tenant canlıda zaten München olarak kullanılıyor ve ${muenchenBefore?.form_count ?? 'mevcut'} Aufmaß kaydını barındırıyor. Patron bilgisinde Augsburg şubesi bulunmadığı için yeni Augsburg tenantı açılmadı. Mevcut slug korunarak şirket adı “AYLUX München GmbH” olarak düzeltildi. Böylece kayıtlar, katalog, sayaçlar, geçmiş bağlantılar ve PDF referansları bölünmedi.`,
  MARGIN,
  y,
  WIDTH,
);

y += 6;
y = sectionTitle('3 · Gelsenkirchen', y);
font('normal', 8.5);
textColor(COLORS.dark);
const gelsenkirchenBefore = data.before?.branches?.find((branch) => branch.slug === 'ayluxgkmu');
y = wrappedText(
  `Mevcut tenant: ayluxgkmu.cnsform.com ve ${gelsenkirchenBefore?.form_count ?? 'mevcut'} Aufmaß kaydı bulunuyor. İlk işletme kararında Gelsenkirchen ve Münster tek GmbH / tek tenant olarak tanımlandı. Patron mesajı Dortmund şubesinin bulunmadığını, yalnız Gelsenkirchen tarafının kullanıldığını belirtiyor. Bu nedenle yeni Dortmund veya yeni Gelsenkirchen domaini açılmadı; mevcut tenant ve içindeki veriler yerinde korundu.`,
  MARGIN,
  y,
  WIDTH,
);

y += 6;
y = sectionTitle('4 · Yapılan veri işlemleri', y);
const operationLines = [
  `Siegen’e taşınan Aufmaß: ${(data.movedFormIds || []).length} adet${data.movedFormIds?.length ? ` (ID: ${data.movedFormIds.join(', ')})` : ''}.`,
  `Siegen’e taşınan Lead: ${(data.movedLeadIds || []).length} adet.`,
  `Siegen katalogu: ${data.catalog?.targetCount || 0} satır (${data.catalog?.inserted ? 'merkez katalogdan kopyalandı' : 'mevcut katalog doğrulandı'}).`,
  'Düsseldorf tenantı ayluxd olarak korundu; yanlış Dortmund etiketi Düsseldorf olarak düzeltildi.',
  'Kullanılmayacak ayluxl (Leipzig), ayluxdo (Dortmund) ve ayluxau (Augsburg) branchleri DB’de pasifleştirildi; bağlı kullanıcıların girişleri kapatıldı. Kayıtlar geri dönüş güvenliği için silinmedi.',
  'Berlin, München ve Gelsenkirchen/Münster tenantlarının mevcut verileri fiziksel olarak taşınmadı.',
];
for (const line of operationLines) {
  font('normal', 8.1);
  textColor(COLORS.dark);
  doc.text('•', MARGIN + 1, y);
  y = wrappedText(line, MARGIN + 6, y, WIDTH - 6, 4);
  y += 1.5;
}

y += 5;
fillColor(COLORS.amberLight);
drawColor(COLORS.amber);
doc.setLineWidth(0.35);
doc.roundedRect(MARGIN, y, WIDTH, 22, 1.5, 1.5, 'FD');
font('bold', 8.2);
textColor(COLORS.amber);
doc.text('Kullanım notu', MARGIN + 5, y + 7);
font('normal', 7.6);
textColor(COLORS.dark);
wrappedText(
  'Kullanıcı her zaman kendi branch URL’sinden giriş yapmalıdır. Başka bir branch URL’si farklı veri alanını açar. Geçici parola ilk girişten sonra Profil → Passwort ändern bölümünden değiştirilmelidir.',
  MARGIN + 5,
  y + 13,
  WIDTH - 10,
  3.7,
);
addFooter(2);

doc.addPage();
addHeader(
  'Aktif Branch · Kullanıcı · URL Listesi',
  'Parolalar yalnız 1. sayfadaki yeni/düzeltilen erişimler için gösterilir.',
);
y = 40;

const activeRoster = (data.roster || [])
  .filter((branch) => branch.isActive && branch.slug !== 'demo')
  .sort((a, b) => a.name.localeCompare(b.name, 'de'));

const columns = [
  { key: 'name', label: 'Branch', width: 51 },
  { key: 'url', label: 'URL', width: 60 },
  { key: 'users', label: 'Aktif kullanıcı', width: 75 },
];
const columnX = [];
let currentX = MARGIN;
for (const column of columns) {
  columnX.push(currentX);
  currentX += column.width;
}

function drawRosterHeader() {
  fillColor(COLORS.green);
  doc.rect(MARGIN, y, WIDTH, 8, 'F');
  font('bold', 7.4);
  textColor(COLORS.white);
  columns.forEach((column, index) => {
    doc.text(column.label, columnX[index] + 2, y + 5.2);
  });
  y += 9;
}

drawRosterHeader();
for (const [index, branch] of activeRoster.entries()) {
  const activeUsers = (branch.users || []).filter((user) => user.isActive);
  const userText = activeUsers.map((user) => user.email).join(', ') || '—';
  font('normal', 6.6);
  const nameLines = doc.splitTextToSize(branch.name, columns[0].width - 4);
  const urlLines = doc.splitTextToSize(branch.url, columns[1].width - 4);
  const userLines = doc.splitTextToSize(userText, columns[2].width - 4);
  const lineCount = Math.max(nameLines.length, urlLines.length, userLines.length);
  const rowHeight = Math.max(8, (lineCount * 3.2) + 3);

  if (y + rowHeight > 278) {
    addFooter(doc.getNumberOfPages());
    doc.addPage();
    addHeader('Aktif Branch · Kullanıcı · URL Listesi', 'Devam');
    y = 40;
    drawRosterHeader();
  }

  if (index % 2 === 1) {
    fillColor([248, 250, 245]);
    doc.rect(MARGIN, y - 1, WIDTH, rowHeight, 'F');
  }
  font('bold', 6.6);
  textColor(COLORS.dark);
  doc.text(nameLines, columnX[0] + 2, y + 3);
  font('normal', 6.4);
  textColor(COLORS.green);
  doc.text(urlLines, columnX[1] + 2, y + 3);
  font('normal', 6.4);
  textColor(COLORS.dark);
  doc.text(userLines, columnX[2] + 2, y + 3);
  drawColor(COLORS.line);
  doc.setLineWidth(0.15);
  doc.line(MARGIN, y + rowHeight - 1, MARGIN + WIDTH, y + rowHeight - 1);
  y += rowHeight;
}

addFooter(doc.getNumberOfPages());
doc.save(outputPath);
process.stdout.write(`${JSON.stringify({ outputPath, pages: doc.getNumberOfPages() })}\n`);
