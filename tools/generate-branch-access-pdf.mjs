import fs from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';

const args = process.argv.slice(2);
const language = (
  args.find((arg) => arg.startsWith('--lang='))?.split('=')[1] || 'tr'
).toLowerCase();
if (!['tr', 'de'].includes(language)) {
  throw new Error('Supported languages: tr, de');
}
const positional = args.filter((arg) => !arg.startsWith('--'));
const inputPath = positional[0] || '/root/result.json';
const defaultFilename = language === 'de'
  ? 'AYLUX_Filial_Zugangsdaten_DE_2026-07-30.pdf'
  : 'AYLUX_Sube_Erisim_Rehberi_TR_2026-07-30.pdf';
const outputPath = positional[1] || `/root/${defaultFilename}`;

if (!fs.existsSync(inputPath)) {
  throw new Error(`Migration result not found: ${inputPath}`);
}
const migration = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (migration.mode !== 'apply' || !migration.roster) {
  throw new Error('Input is not a completed branch migration result');
}

const COPY = {
  tr: {
    title: 'AYLUX Şube Erişim Rehberi',
    subtitle: 'Güncel şube, URL, kullanıcı ve erişim bilgileri',
    confidential: 'GİZLİ ERİŞİM BELGESİ',
    confidentialText:
      'Geçici parolalar ilk girişten sonra değiştirilmelidir. Belgeyi yalnızca yetkili kişilerle paylaşın.',
    stats: [
      ['0', 'Ana yönetici hesabı'],
      ['18', 'Aktif şube'],
      ['4', 'Doğrulanmış HTTPS alanı'],
    ],
    sections: {
      access: 'Yönetici erişimleri',
      structure: 'Güncel domain yapısı',
      state: 'Güncel veri durumu',
      changes: 'Değiştirilen ve kaldırılan yapılar',
      roster: 'Aktif şube, URL ve kullanıcı listesi',
    },
    labels: {
      url: 'URL',
      user: 'Kullanıcı',
      password: 'Geçici parola',
      users: 'Kullanıcılar',
      mainUser: 'Ana hesap',
      otherUsers: 'Diğer kullanıcılar',
      branch: 'Şube',
      data: 'Mevcut veri',
      status: 'Durum',
      active: 'Aktif',
      inactive: 'Pasif',
    },
    existingUser:
      'Ana hesap dışındaki kullanıcılar Bölüm 5’te parolasız listelenmiştir. Gelsenkirchen şubesindeki h.tunc@aylux.de hesabı mevcut parolasıyla kullanılmaya devam eder.',
    structureParagraphs: [
      'München, Gelsenkirchen, Münster ve Siegen artık kendi bağımsız domainleri üzerinden çalışır: ayluxmu.cnsform.com, ayluxgk.cnsform.com, ayluxms.cnsform.com ve ayluxsi.cnsform.com.',
      'Düsseldorf ayluxd.cnsform.com adresini kullanmaya devam eder. Veritabanındaki yanlış “Dortmund” adı “AYLUX Düsseldorf GmbH” olarak düzeltilmiştir.',
      'Münster mevcut ürün kataloğuyla fakat iş geçmişi olmadan çalışır. Gelsenkirchen birleşik GKMU geçmişini; München ise birleşik MAU geçmişini devralmıştır.',
    ],
    dataLines: {
      aufmass: 'Aufmaß',
      angebot: 'Angebot',
      pdf: 'PDF',
      files: 'Dosya',
      products: 'Ürün satırı',
    },
    stateNotes: {
      ayluxd: 'Düsseldorf olarak korunuyor',
      ayluxmu: 'MAU içeriğinin tamamı burada',
      ayluxgk: 'GKMU geçmişinin tamamı burada',
      ayluxms: 'Ürün kataloğu mevcut; iş geçmişi boş',
      ayluxsi: 'Siegen verisi ve merkezi katalog mevcut',
    },
    changes: [
      ['ayluxmau', 'ayluxmu', 'Eski birleşik tenant pasifleştirildi; tüm kullanıcı, Aufmaß, Angebot, PDF, dosya ve ürün verileri München’e taşındı. Augsburg aktif bir şube değildir.'],
      ['ayluxgkmu', 'ayluxgk / ayluxms', 'Eski birleşik tenant pasifleştirildi. Geçmiş kayıtlar Gelsenkirchen’e taşındı; Münster ayrı katalogla iş geçmişi boş olarak ayrıldı.'],
      ['aylux → Siegen', 'ayluxsi', 'Siegen kullanıcısı, kendisine ait Aufmaß ve bağlı dosyalar merkez tenanttan ayrıldı. Merkezi ürün kataloğu Siegen’e kopyalandı.'],
      ['ayluxd', 'ayluxd', 'Domain korunmuştur. Yanlış Dortmund şube adı Düsseldorf olarak düzeltilmiştir.'],
      ['ayluxl', 'kullanılmıyor', 'Leipzig şubesi bulunmadığı için tenant ve kullanıcı erişimi pasifleştirilmiştir.'],
      ['ayluxdo / ayluxau', 'kullanılmıyor', 'Dortmund ve Augsburg şubeleri bulunmadığından aktif tenant veya giriş hesabı yoktur.'],
    ],
    footer: 'AYLUX · Gizli erişim belgesi',
    metadataTitle: 'AYLUX Şube Erişim Rehberi',
    metadataSubject: 'Güncel şube URL, kullanıcı ve parola listesi',
  },
  de: {
    title: 'AYLUX Filial-Zugangsübersicht',
    subtitle: 'Aktuelle Filialen, URLs, Benutzer und Zugangsdaten',
    confidential: 'VERTRAULICHE ZUGANGSDATEN',
    confidentialText:
      'Temporäre Passwörter sind nach der ersten Anmeldung zu ändern. Dieses Dokument darf nur an berechtigte Personen weitergegeben werden.',
    stats: [
      ['0', 'Hauptadministrator-Konten'],
      ['18', 'Aktive Filialen'],
      ['4', 'Geprüfte HTTPS-Domains'],
    ],
    sections: {
      access: 'Administrator-Zugänge',
      structure: 'Aktuelle Domain-Struktur',
      state: 'Aktueller Datenbestand',
      changes: 'Geänderte und stillgelegte Strukturen',
      roster: 'Aktive Filialen, URLs und Benutzer',
    },
    labels: {
      url: 'URL',
      user: 'Benutzer',
      password: 'Temporäres Passwort',
      users: 'Benutzer',
      mainUser: 'Hauptkonto',
      otherUsers: 'Weitere Benutzer',
      branch: 'Filiale',
      data: 'Datenbestand',
      status: 'Status',
      active: 'Aktiv',
      inactive: 'Inaktiv',
    },
    existingUser:
      'Benutzer außerhalb der Hauptkonten werden in Abschnitt 5 ohne Passwort aufgeführt. Das Konto h.tunc@aylux.de in Gelsenkirchen verwendet weiterhin das bestehende Passwort.',
    structureParagraphs: [
      'München, Gelsenkirchen, Münster und Siegen arbeiten über eigene Domains: ayluxmu.cnsform.com, ayluxgk.cnsform.com, ayluxms.cnsform.com und ayluxsi.cnsform.com.',
      'Düsseldorf verwendet weiterhin ayluxd.cnsform.com. Die falsche Datenbankbezeichnung „Dortmund“ wurde in „AYLUX Düsseldorf GmbH“ korrigiert.',
      'Münster verfügt über den vollständigen Produktkatalog, startet jedoch ohne Geschäftshistorie. Gelsenkirchen übernimmt die bisherige GKMU-Historie; München übernimmt die bisherige MAU-Historie.',
    ],
    dataLines: {
      aufmass: 'Aufmaße',
      angebot: 'Angebote',
      pdf: 'PDFs',
      files: 'Dateien',
      products: 'Produktzeilen',
    },
    stateNotes: {
      ayluxd: 'Als Düsseldorf beibehalten',
      ayluxmu: 'Vollständiger MAU-Bestand',
      ayluxgk: 'Vollständige GKMU-Historie',
      ayluxms: 'Produktkatalog vorhanden; keine Geschäftshistorie',
      ayluxsi: 'Siegen-Daten und zentraler Katalog vorhanden',
    },
    changes: [
      ['ayluxmau', 'ayluxmu', 'Der bisherige kombinierte Tenant wurde deaktiviert. Benutzer, Aufmaße, Angebote, PDFs, Dateien und Produkte wurden vollständig nach München übertragen. Augsburg ist keine aktive Filiale.'],
      ['ayluxgkmu', 'ayluxgk / ayluxms', 'Der kombinierte Tenant wurde deaktiviert. Die Historie wurde Gelsenkirchen zugeordnet; Münster wurde mit eigenem Katalog und ohne Geschäftshistorie getrennt.'],
      ['aylux → Siegen', 'ayluxsi', 'Der Siegen-Benutzer sowie das zugehörige Aufmaß und die Dateien wurden vom Zentral-Tenant getrennt. Der zentrale Produktkatalog wurde nach Siegen kopiert.'],
      ['ayluxd', 'ayluxd', 'Die Domain bleibt bestehen. Die falsche Bezeichnung Dortmund wurde in Düsseldorf korrigiert.'],
      ['ayluxl', 'nicht verwendet', 'Da keine Filiale Leipzig besteht, wurden Tenant und Benutzerzugang deaktiviert.'],
      ['ayluxdo / ayluxau', 'nicht verwendet', 'Für Dortmund und Augsburg bestehen weder aktive Tenants noch Anmeldekonten.'],
    ],
    footer: 'AYLUX · Vertrauliche Zugangsdaten',
    metadataTitle: 'AYLUX Filial-Zugangsübersicht',
    metadataSubject: 'Aktuelle Filial-URLs, Benutzer und Passwörter',
  },
};
const copy = COPY[language];
const reportCredentials = migration.credentials || [];
const activeRoster = (migration.roster || []).filter((branch) => (
  branch.isActive
));
const credentialByBranch = new Map(reportCredentials.map((credential) => (
  [credential.branchSlug, credential]
)));
const BRANCH_DISPLAY_NAMES = {
  ayluxa: 'AYLUX Andernach GmbH',
  ayluxb: 'AYLUX Berlin GmbH',
  ayluxbr: 'AYLUX Bremen GmbH',
  ayluxd: 'AYLUX Düsseldorf GmbH',
  ayluxf: 'AYLUX Frankfurt GmbH',
  ayluxgk: 'AYLUX Gelsenkirchen GmbH',
  ayluxhh: 'AYLUX Hamburg GmbH',
  ayluxha: 'AYLUX Hannover GmbH',
  ayluxma: 'AYLUX Mannheim GmbH',
  ayluxmu: 'AYLUX München GmbH',
  ayluxms: 'AYLUX Münster GmbH',
  ayluxsi: 'AYLUX Siegen GmbH',
  ayluxs: 'AYLUX Stuttgart GmbH',
  ayluxtr: 'AYLUX Trier',
  ayluxus: 'AYLUX Ulm GmbH',
  aylux: 'AYLUX Sonnenschutzsysteme GmbH',
  koblenz: 'AYLUX Koblenz',
};

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

const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
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
  green: [45, 104, 59],
  greenDark: [29, 73, 40],
  greenSoft: [234, 244, 236],
  cream: [248, 248, 244],
  dark: [31, 39, 34],
  grey: [91, 101, 95],
  line: [210, 219, 212],
  amber: [169, 105, 14],
  amberSoft: [253, 246, 229],
  red: [151, 45, 45],
  white: [255, 255, 255],
};
const margin = 13;
const contentWidth = 210 - (2 * margin);
const pageBottom = 281;
let y = 0;

const setFont = (style = 'normal', size = 9, color = COLOR.dark) => {
  doc.setFont('ReportFont', style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
};
const pageHeader = () => {
  doc.setFillColor(...COLOR.greenDark);
  doc.rect(0, 0, 210, 22, 'F');
  doc.setFillColor(...COLOR.green);
  doc.rect(0, 22, 210, 2, 'F');
  setFont('bold', 13.5, COLOR.white);
  doc.text('AYLUX', margin, 10);
  setFont('normal', 8.2, [221, 236, 224]);
  doc.text(copy.subtitle, margin, 16);
  y = 31;
};
const addPage = () => {
  doc.addPage();
  pageHeader();
};
const ensureSpace = (height) => {
  if (y + height > pageBottom) addPage();
};
const section = (number, title) => {
  // Keep the heading together with at least the first content block.
  ensureSpace(38);
  doc.setFillColor(...COLOR.green);
  doc.circle(margin + 4, y - 1, 4, 'F');
  setFont('bold', 8.5, COLOR.white);
  doc.text(String(number), margin + 4, y + 1.6, { align: 'center' });
  setFont('bold', 11.2, COLOR.dark);
  doc.text(title, margin + 11, y + 1);
  doc.setDrawColor(...COLOR.line);
  doc.setLineWidth(0.35);
  doc.line(margin + 11, y + 4.2, 210 - margin, y + 4.2);
  y += 10;
};
const paragraph = (text, options = {}) => {
  const fontSize = options.size || 8.5;
  const lineHeight = options.lineHeight || 4.25;
  setFont(options.bold ? 'bold' : 'normal', fontSize, options.color || COLOR.dark);
  const lines = doc.splitTextToSize(String(text), options.width || contentWidth);
  ensureSpace((lines.length * lineHeight) + 2);
  doc.text(lines, options.x || margin, y);
  y += (lines.length * lineHeight) + (options.after ?? 2.2);
};
const labelValue = (label, value, x, lineY, labelWidth = 37) => {
  setFont('bold', 7.4, COLOR.grey);
  doc.text(label, x, lineY);
  setFont('normal', 8.1, COLOR.dark);
  doc.text(String(value), x + labelWidth, lineY);
};

pageHeader();
setFont('bold', 19, COLOR.greenDark);
doc.text(copy.title, margin, y + 3);
y += 11;

doc.setFillColor(...COLOR.amberSoft);
doc.setDrawColor(...COLOR.amber);
doc.roundedRect(margin, y, contentWidth, 20, 2, 2, 'FD');
setFont('bold', 8.8, COLOR.red);
doc.text(copy.confidential, margin + 5, y + 7);
setFont('normal', 7.6, COLOR.dark);
const confidentialLines = doc.splitTextToSize(
  copy.confidentialText,
  contentWidth - 10,
);
doc.text(confidentialLines, margin + 5, y + 13);
y += 27;

const tileGap = 4;
const tileWidth = (contentWidth - (2 * tileGap)) / 3;
const reportStats = copy.stats.map(([value, label]) => [value, label]);
reportStats[0][0] = String(reportCredentials.length);
reportStats[1][0] = String(activeRoster.length);
reportStats.forEach(([value, label], index) => {
  const x = margin + (index * (tileWidth + tileGap));
  doc.setFillColor(...COLOR.greenSoft);
  doc.setDrawColor(...COLOR.line);
  doc.roundedRect(x, y, tileWidth, 19, 2, 2, 'FD');
  setFont('bold', 14, COLOR.green);
  doc.text(value, x + 5, y + 8);
  setFont('bold', 7.2, COLOR.dark);
  const labelLines = doc.splitTextToSize(label, tileWidth - 10);
  doc.text(labelLines, x + 5, y + 14);
});
y += 27;

section(1, copy.sections.access);
const credentialGap = 5;
const credentialCardWidth = (contentWidth - credentialGap) / 2;
const credentialCardHeight = 27.5;
const drawCredentialCard = (credential, x, top) => {
  doc.setFillColor(...COLOR.cream);
  doc.setDrawColor(...COLOR.line);
  doc.roundedRect(
    x,
    top,
    credentialCardWidth,
    credentialCardHeight,
    2,
    2,
    'FD',
  );
  doc.setFillColor(...COLOR.green);
  doc.roundedRect(x, top, credentialCardWidth, 8, 2, 2, 'F');
  doc.rect(x, top + 5, credentialCardWidth, 3, 'F');
  setFont('bold', 7.7, COLOR.white);
  doc.text(credential.branchName, x + 4, top + 5.2);
  setFont('normal', 6.2, [222, 239, 225]);
  doc.text(credential.branchSlug, x + credentialCardWidth - 4, top + 5.2, {
    align: 'right',
  });

  setFont('bold', 6.4, COLOR.grey);
  doc.text(copy.labels.url, x + 4, top + 12.6);
  doc.text(copy.labels.user, x + 4, top + 17.9);
  doc.text(copy.labels.password, x + 4, top + 23.7);
  setFont('normal', 6.8, COLOR.dark);
  doc.text(credential.url, x + 19, top + 12.6);
  doc.text(credential.email, x + 19, top + 17.9);
  doc.setFillColor(...COLOR.amberSoft);
  doc.roundedRect(
    x + 34,
    top + 19.7,
    credentialCardWidth - 38,
    6.2,
    1.2,
    1.2,
    'F',
  );
  setFont('bold', 7.4, COLOR.red);
  doc.text(credential.temporaryPassword, x + 37, top + 24.1);
};

for (let index = 0; index < reportCredentials.length; index += 2) {
  ensureSpace(credentialCardHeight + 3);
  drawCredentialCard(reportCredentials[index], margin, y);
  if (reportCredentials[index + 1]) {
    drawCredentialCard(
      reportCredentials[index + 1],
      margin + credentialCardWidth + credentialGap,
      y,
    );
  }
  y += credentialCardHeight + 3;
}
paragraph(copy.existingUser, { size: 7.8, color: COLOR.grey, after: 4 });

section(2, copy.sections.structure);
for (const text of copy.structureParagraphs) {
  ensureSpace(15);
  doc.setFillColor(...COLOR.greenSoft);
  doc.circle(margin + 4, y - 1.1, 1.15, 'F');
  paragraph(text, {
    x: margin + 11,
    width: contentWidth - 11,
    size: 8.2,
    after: 2.5,
  });
}

section(3, copy.sections.state);
const stateSlugs = ['ayluxd', 'ayluxmu', 'ayluxgk', 'ayluxms', 'ayluxsi'];
const fallbackStates = {
  ayluxd: {
    business: {
      aufmass: 0,
      form_angebote: 0,
      generated_aufmass_pdfs: 0,
      uploaded_files: 0,
    },
    catalog: { total: 58104 },
  },
};
const currentState = (slug) => (
  migration.after?.[slug]
  || migration.before?.branches?.[slug]
  || fallbackStates[slug]
);
for (const slug of stateSlugs) {
  const state = currentState(slug);
  if (!state) continue;
  ensureSpace(19);
  const credential = migration.credentials?.find((item) => (
    item.branchSlug === slug
  ));
  const branchName = credential?.branchName || slug;
  const business = state.business;
  const catalog = state.catalog;
  doc.setFillColor(...COLOR.cream);
  doc.setDrawColor(...COLOR.line);
  doc.roundedRect(margin, y, contentWidth, 14.5, 1.5, 1.5, 'FD');
  setFont('bold', 8.2, COLOR.greenDark);
  doc.text(branchName, margin + 4, y + 5.2);
  setFont('normal', 6.5, COLOR.grey);
  doc.text(copy.stateNotes[slug], margin + 4, y + 10.5);
  setFont('normal', 6.8, COLOR.dark);
  const values = [
    `${copy.dataLines.aufmass} ${business.aufmass || 0}`,
    `${copy.dataLines.angebot} ${business.form_angebote || 0}`,
    `${copy.dataLines.pdf} ${business.generated_aufmass_pdfs || 0}`,
    `${copy.dataLines.files} ${business.uploaded_files || 0}`,
    `${copy.dataLines.products} ${catalog.total || 0}`,
  ];
  doc.text(values.join('  ·  '), 210 - margin - 4, y + 8, {
    align: 'right',
  });
  y += 17.5;
}

section(4, copy.sections.changes);
for (let index = 0; index < copy.changes.length; index += 1) {
  const [source, target, detail] = copy.changes[index];
  setFont('normal', 6.8, COLOR.dark);
  const detailLines = doc.splitTextToSize(detail, contentWidth - 8);
  const rowHeight = Math.max(13.5, (detailLines.length * 3.2) + 9);
  ensureSpace(rowHeight + 2);
  if (index % 2 === 0) {
    doc.setFillColor(...COLOR.cream);
    doc.rect(margin, y, contentWidth, rowHeight, 'F');
  }
  doc.setDrawColor(...COLOR.line);
  doc.line(margin, y + rowHeight, 210 - margin, y + rowHeight);
  setFont('bold', 7.2, COLOR.greenDark);
  doc.text(source, margin + 3, y + 5);
  setFont('bold', 6.9, COLOR.amber);
  doc.text(`→  ${target}`, margin + 39, y + 5);
  setFont('normal', 6.7, COLOR.dark);
  doc.text(detailLines, margin + 3, y + 9.5);
  y += rowHeight;
}
y += 4;

section(5, copy.sections.roster);

const cardWidth = (contentWidth - 5) / 2;
const userText = (user) => (
  `${user.email} · ${user.name || ''} · ${user.role || ''}`
);
const rosterBlocksFor = (branch) => {
  const users = branch.users || [];
  const credential = credentialByBranch.get(branch.slug);
  if (!credential) {
    return [{
      label: copy.labels.users,
      users: users.length > 0 ? users : [{ email: '—', name: '', role: '' }],
    }];
  }
  const mainUser = users.find((user) => (
    user.email.toLowerCase() === credential.email.toLowerCase()
  )) || {
    email: credential.email,
    name: '',
    role: 'admin',
  };
  const otherUsers = users.filter((user) => (
    user.email.toLowerCase() !== credential.email.toLowerCase()
  ));
  const blocks = [{
    label: copy.labels.mainUser,
    users: [mainUser],
  }];
  if (otherUsers.length > 0) {
    blocks.push({
      label: copy.labels.otherUsers,
      users: otherUsers,
    });
  }
  return blocks;
};
const linesForUser = (user) => {
  setFont('normal', 6.6, COLOR.dark);
  return doc.splitTextToSize(
    userText(user),
    cardWidth - 10,
  );
};
const cardHeightFor = (branch) => {
  const blocks = rosterBlocksFor(branch);
  const contentHeight = blocks.reduce((total, block) => {
    const lineCount = block.users.reduce((sum, user) => (
      sum + linesForUser(user).length
    ), 0);
    return total + 4 + (lineCount * 3.6) + 1;
  }, 0);
  return 15 + contentHeight + 2;
};
const drawRosterCard = (branch, x, top, height) => {
  doc.setFillColor(...COLOR.cream);
  doc.setDrawColor(...COLOR.line);
  doc.roundedRect(x, top, cardWidth, height, 1.8, 1.8, 'FD');
  doc.setFillColor(...COLOR.greenSoft);
  doc.roundedRect(x, top, cardWidth, 12, 1.8, 1.8, 'F');
  doc.rect(x, top + 9, cardWidth, 3, 'F');
  setFont('bold', 8.2, COLOR.greenDark);
  doc.text(
    BRANCH_DISPLAY_NAMES[branch.slug] || branch.name,
    x + 4,
    top + 5.2,
  );
  setFont('normal', 6.5, COLOR.green);
  doc.text(branch.url, x + 4, top + 9.5);
  let cursorY = top + 15;
  const blocks = rosterBlocksFor(branch);
  for (const block of blocks) {
    setFont('bold', 6.6, COLOR.grey);
    doc.text(`${block.label}:`, x + 4, cursorY);
    cursorY += 4;
    for (const user of block.users) {
      setFont('normal', 6.6, COLOR.dark);
      const lines = linesForUser(user);
      doc.text(lines, x + 4, cursorY);
      cursorY += lines.length * 3.6;
    }
    cursorY += 1;
  }
};

for (let index = 0; index < activeRoster.length; index += 2) {
  const left = activeRoster[index];
  const right = activeRoster[index + 1] || null;
  const leftHeight = cardHeightFor(left);
  const rightHeight = right ? cardHeightFor(right) : 0;
  const rowHeight = Math.max(leftHeight, rightHeight);
  ensureSpace(rowHeight + 2);
  drawRosterCard(left, margin, y, rowHeight);
  if (right) {
    drawRosterCard(right, margin + cardWidth + 5, y, rowHeight);
  }
  y += rowHeight + 2;
}

const pageCount = doc.getNumberOfPages();
for (let page = 1; page <= pageCount; page += 1) {
  doc.setPage(page);
  doc.setDrawColor(...COLOR.line);
  doc.setLineWidth(0.3);
  doc.line(margin, 286, 210 - margin, 286);
  setFont('normal', 6.5, COLOR.grey);
  doc.text(copy.footer, margin, 291);
  doc.text(`${page} / ${pageCount}`, 210 - margin, 291, { align: 'right' });
}

doc.setProperties({
  title: copy.metadataTitle,
  subject: copy.metadataSubject,
  author: 'AYLUX / Conais',
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(doc.output('arraybuffer')));
fs.chmodSync(outputPath, 0o600);
process.stdout.write(`${JSON.stringify({
  language,
  pdf: outputPath,
  pages: pageCount,
  credentials: migration.credentials?.length || 0,
  activeBranches: activeRoster.length,
}, null, 2)}\n`);
