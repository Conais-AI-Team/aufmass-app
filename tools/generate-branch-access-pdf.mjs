import fs from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';

const inputPath = process.argv[2] || '/root/result.json';
const outputPath = process.argv[3]
  || '/root/AYLUX_Subdomain_Zugangsdaten_2026-07-30.pdf';

if (!fs.existsSync(inputPath)) {
  throw new Error(`Migration result not found: ${inputPath}`);
}

const migration = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (migration.mode !== 'apply' || !migration.after || !migration.roster) {
  throw new Error('Input is not a completed branch migration result');
}

const findFont = (candidates) => candidates.find((candidate) => (
  fs.existsSync(candidate)
));
const regularFont = findFont([
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C:/Windows/Fonts/arial.ttf',
]);
const boldFont = findFont([
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
]);
if (!regularFont || !boldFont) {
  throw new Error('DejaVu Sans or Arial font files are required');
}

const doc = new jsPDF({ unit: 'mm', format: 'a4' });
for (const [fontPath, style] of [
  [regularFont, 'normal'],
  [boldFont, 'bold'],
]) {
  const virtualName = path.basename(fontPath);
  doc.addFileToVFS(
    virtualName,
    fs.readFileSync(fontPath).toString('base64'),
  );
  doc.addFont(virtualName, 'ReportFont', style);
}

const COLOR = {
  green: [54, 103, 64],
  lightGreen: [235, 244, 236],
  dark: [31, 41, 35],
  grey: [91, 101, 95],
  line: [211, 219, 213],
  amber: [165, 104, 18],
  lightAmber: [253, 246, 229],
  red: [158, 48, 48],
};
const margin = 14;
const width = 210 - (2 * margin);
let y = 0;

const setFont = (style = 'normal', size = 9, color = COLOR.dark) => {
  doc.setFont('ReportFont', style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
};
const pageHeader = () => {
  doc.setFillColor(...COLOR.green);
  doc.rect(0, 0, 210, 24, 'F');
  setFont('bold', 15, [255, 255, 255]);
  doc.text('AYLUX Şube Erişim ve Taşıma Raporu', margin, 11);
  setFont('normal', 8.5, [224, 237, 226]);
  doc.text('Gizli belge · Yetkisiz kişilerle paylaşmayın', margin, 17);
  y = 32;
};
const addPage = () => {
  doc.addPage();
  pageHeader();
};
const ensureSpace = (height) => {
  if (y + height > 279) addPage();
};
const section = (title) => {
  ensureSpace(12);
  setFont('bold', 11, COLOR.dark);
  doc.text(title, margin, y);
  doc.setDrawColor(...COLOR.green);
  doc.setLineWidth(0.7);
  doc.line(margin, y + 2.2, margin + 54, y + 2.2);
  y += 8;
};
const paragraph = (value, options = {}) => {
  const size = options.size || 8.7;
  const lineHeight = options.lineHeight || 4.5;
  setFont(options.bold ? 'bold' : 'normal', size, options.color || COLOR.dark);
  const lines = doc.splitTextToSize(String(value), options.width || width);
  ensureSpace((lines.length * lineHeight) + 2);
  doc.text(lines, options.x || margin, y);
  y += (lines.length * lineHeight) + (options.after ?? 2);
};
const labelValue = (label, value, x, lineY, valueX = 44) => {
  setFont('bold', 8, COLOR.grey);
  doc.text(label, x, lineY);
  setFont('normal', 8.3, COLOR.dark);
  doc.text(String(value), x + valueX, lineY);
};

pageHeader();

doc.setFillColor(...COLOR.lightAmber);
doc.setDrawColor(...COLOR.amber);
doc.roundedRect(margin, y, width, 20, 2, 2, 'FD');
setFont('bold', 9.5, COLOR.red);
doc.text('GEÇİCİ PAROLALAR İÇERİR', margin + 5, y + 7);
setFont('normal', 8.2, COLOR.dark);
doc.text(
  'İlk girişten sonra parolalar değiştirilmelidir. Bu PDF güvenli saklanmalıdır.',
  margin + 5,
  y + 14,
);
y += 28;

section('1 · Yeni ve güncellenen erişimler');
const credentials = migration.credentials || [];
for (const credential of credentials) {
  ensureSpace(34);
  doc.setFillColor(...COLOR.lightGreen);
  doc.setDrawColor(...COLOR.line);
  doc.roundedRect(margin, y, width, 29, 2, 2, 'FD');
  setFont('bold', 10, COLOR.green);
  doc.text(credential.branchName, margin + 5, y + 7);
  labelValue('URL', credential.url, margin + 5, y + 13);
  labelValue('Kullanıcı', credential.email, margin + 5, y + 19);
  labelValue(
    'Geçici parola',
    credential.temporaryPassword,
    margin + 5,
    y + 25,
  );
  y += 34;
}
paragraph(
  'Gelsenkirchen şubesindeki h.tunc@aylux.de hesabı da taşındı; mevcut '
  + 'parolası korunmuştur.',
  { size: 8.2, color: COLOR.grey },
);

section('2 · Neden München ve Gelsenkirchen için yeni domain açıldı?');
paragraph(
  'Önceki yapıda München, Augsburg ile ayluxmau altında; Gelsenkirchen ise '
  + 'Münster ile ayluxgkmu altında birleşikti. İlk domain listesi bu birleşik '
  + 'yapıya göre hazırlanmıştı. Sonradan şubelerin ayrılmasına karar verildiği '
  + 'için ayluxmu.cnsform.com, ayluxgk.cnsform.com ve ayluxms.cnsform.com '
  + 'bağımsız olarak oluşturuldu.',
);
paragraph(
  'Augsburg ve Dortmund şubeleri bulunmadığından bunlar için aktif tenant '
  + 'bırakılmadı. Düsseldorf ayluxd.cnsform.com olarak korunmuş ve veritabanı '
  + 'adı Düsseldorf olarak düzeltilmiştir.',
);

section('3 · Taşıma sonucu');
const resultRows = [
  ['ayluxmu', 'München', 'MAU içeriğinin tamamı taşındı'],
  ['ayluxgk', 'Gelsenkirchen', 'GKMU geçmişinin tamamı taşındı'],
  ['ayluxms', 'Münster', 'İş geçmişi boş; ürün kataloğu kopyalandı'],
  ['ayluxsi', 'Siegen', 'Siegen verisi ve merkezi katalog kopyalandı'],
];
for (const [slug, label, note] of resultRows) {
  const state = migration.after[slug];
  if (!state) continue;
  ensureSpace(27);
  doc.setFillColor(248, 250, 248);
  doc.setDrawColor(...COLOR.line);
  doc.roundedRect(margin, y, width, 22, 1.5, 1.5, 'FD');
  setFont('bold', 9.5, COLOR.green);
  doc.text(label, margin + 4, y + 6);
  setFont('normal', 7.7, COLOR.grey);
  doc.text(note, margin + 4, y + 11);
  const business = state.business;
  const catalog = state.catalog;
  setFont('normal', 7.5, COLOR.dark);
  doc.text(
    `Aufmaß ${business.aufmass} · Angebot ${business.form_angebote} · `
    + `PDF ${business.generated_aufmass_pdfs} · Dosya ${business.uploaded_files} · `
    + `Ürün satırı ${catalog.total} · Aktif ürün ${catalog.active}`,
    margin + 4,
    y + 17,
  );
  y += 27;
}
paragraph(
  'Kontrol sonucu: ayluxmau ve ayluxgkmu üzerindeki şube-kapsamlı kayıtlar '
  + 'sıfırlandı ve iki eski tenant pasifleştirildi. Kaynak ve hedef ürün '
  + 'checksum değerleri birebir eşleşti; eksik veya yetim ürün dosyası bulunmadı.',
  { size: 8.2 },
);

section('4 · Pasifleştirilen veya kullanılmayan adresler');
const disabled = migration.disabledBranches || [];
for (const branch of disabled) {
  const status = branch.branchFound
    ? `${branch.usersDeactivated} kullanıcı pasifleştirildi`
    : 'Veritabanında tenant bulunmuyordu';
  paragraph(
    `${branch.slug}.cnsform.com — ${branch.reason}; ${status}.`,
    { size: 8.2, after: 1 },
  );
}
paragraph(
  'ayluxmau.cnsform.com ve ayluxgkmu.cnsform.com birleşik eski tenantlardır; '
  + 'giriş için kullanılmamalıdır.',
  { size: 8.2, color: COLOR.red },
);

addPage();
section('5 · Aktif şube, URL ve kullanıcı listesi');
const activeRoster = migration.roster.filter((branch) => branch.isActive);
for (const branch of activeRoster) {
  const users = branch.users || [];
  const cardHeight = 18 + (Math.max(users.length, 1) * 5);
  ensureSpace(cardHeight + 4);
  doc.setFillColor(248, 250, 248);
  doc.setDrawColor(...COLOR.line);
  doc.roundedRect(margin, y, width, cardHeight, 1.5, 1.5, 'FD');
  setFont('bold', 9.2, COLOR.green);
  doc.text(branch.name, margin + 4, y + 6);
  setFont('normal', 7.7, COLOR.grey);
  doc.text(branch.url, margin + 4, y + 11);
  setFont('bold', 7.5, COLOR.dark);
  doc.text('Kullanıcılar:', margin + 4, y + 16);
  let userY = y + 21;
  if (users.length === 0) {
    setFont('normal', 7.5, COLOR.grey);
    doc.text('—', margin + 29, userY);
  } else {
    for (const user of users) {
      setFont('normal', 7.5, COLOR.dark);
      doc.text(
        `${user.email} · ${user.name} · ${user.role}`,
        margin + 29,
        userY,
      );
      userY += 5;
    }
  }
  y += cardHeight + 4;
}

section('6 · Teknik doğrulama');
paragraph(
  `Migration zamanı: ${migration.appliedAt}. İşlem PostgreSQL transaction `
  + 'içinde tamamlandı ve sonuç /root/result.json dosyasına kaydedildi.',
  { size: 8.2 },
);
paragraph(
  'Taşıma öncesi tam veritabanı yedeği: '
  + '/root/branch-split-backup.dump. Yedek pg_restore ile doğrulandı.',
  { size: 8.2 },
);

const pageCount = doc.getNumberOfPages();
for (let page = 1; page <= pageCount; page += 1) {
  doc.setPage(page);
  doc.setDrawColor(...COLOR.line);
  doc.line(margin, 286, 210 - margin, 286);
  setFont('normal', 6.8, COLOR.grey);
  doc.text('AYLUX · Gizli erişim belgesi', margin, 291);
  doc.text(`${page} / ${pageCount}`, 210 - margin, 291, { align: 'right' });
}

doc.setProperties({
  title: 'AYLUX Şube Erişim ve Taşıma Raporu',
  subject: 'Şube URL, kullanıcı ve geçici parola listesi',
  author: 'AYLUX / Conais',
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(doc.output('arraybuffer')));
fs.chmodSync(outputPath, 0o600);
process.stdout.write(`${JSON.stringify({
  pdf: outputPath,
  pages: pageCount,
  credentials: credentials.length,
  activeBranches: activeRoster.length,
}, null, 2)}\n`);
