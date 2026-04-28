# MODÜL B — Tablı Angebot — Geliştirme Planı

**Branch:** `caglayan` (ayrılmıyoruz, başka branch açmıyoruz)
**Kapsam:** Sadece Modül B. Modül A ve C'ye dokunulmaz.
**Doküman:** `rechnung-revize-plani.docx` — Modül B kısmı + planın 11. bölümündeki Dev 2 görevleri

---

## Sahip Olunan Dosyalar (planın 11. bölümünden)

- `src/pages/Angebote.tsx` — 2 tab
- `src/components/LeadFormModal.tsx` — Aus Aufmaß seçim arayüzü + auto-fill
- `src/pages/Dashboard.tsx` — Aufmaß listesinde "Angebot erstellen" butonu
- `src/services/api.ts` — Senkron endpoint çağrıları
- `server/index.js` — Aufmaß ↔ Angebote senkron logic (status hook)

---

## Plan Kurallarına Uyum (uyacağımız kurallar)

1. ❌ Mevcut hiçbir status silinmez/yeniden adlandırılmaz
2. ✅ Aufmaß listesinde "Angebot erstellen" kunde+ürün dolu olanda görünür
3. ✅ Status filtresi YOK (kunde+ürün şartı yeter)
4. ✅ Auto-fill: kunde + ürün + ölçü + foto
5. ✅ Fiyat manuel
6. ✅ İki yönlü senkron (her iki yönde backend tetikli)
7. ✅ Bearbeiten'de de çalışır (FormPage `PUT /api/forms/:id` ortak endpoint)
8. ✅ Tab seçimi sayfa yenilenince hatırlanır (URL param)
9. ✅ Branch isimlendirme planda `feature/modul-b-tabli-angebot` ama kullanıcı direktifi: `caglayan`'da kal
10. ✅ Conventional commits (`feat:`, `fix:`, `refactor:`)
11. ✅ Commit atmadan önce kullanıcıdan onay
12. ✅ Push atmadan önce kullanıcıdan onay (kullanıcı "push at" diyene kadar local commit)
13. ✅ Merge öncesi `npx tsc -b` hatasız geçmeli
14. ✅ Modül C/D ile çakışacak dosyalar (Dashboard.tsx, api.ts, server/index.js) — Modül C henüz başlamadığı için şu an çakışma yok

---

## Onaylı Kararlar (kullanıcı cevaplarına göre)

| # | Soru | Cevap |
|---|------|-------|
| 1 | "Versendet işareti" DB'de nasıl tutulacak? | `aufmass_leads.angebot_sent_at TIMESTAMP NULL` yeni kolon |
| 2 | Foto handling? | Aufmaß tarafı nasıl handle ediyorsa aynı şekilde — `aufmass_bilder` tablosundan oku, `getImageUrl(id)` ile çek, LeadFormModal'da read-only grid'de göster (Angebot tarafında foto çekilmez), Angebot PDF'inde de embed edilir |
| 3 | "Angebot gönderildi" tetikleyici? | (a) Form içi "E-Mail senden" checkbox + mail başarısı → otomatik; (b) Dashboard kart üzerinden mail → otomatik; (c) Hiçbiri yok → SADECE ADMIN manuel "Gönderildi" butonu (office'e verme) |

---

## Mevcut Aufmaß Foto Pattern (Aus Aufmaß'ta aynı pattern kullanılacak)

- **DB:** `aufmass_bilder (form_id, file_name, file_data BYTEA, file_type)` — server/index.js:1818
- **Backend:** `POST /api/forms/:id/images` (multer max 10), `GET /api/images/:id` (auth)
- **Service:** `uploadImages(formId, files)`, `getImageUrl(imageId)` — src/services/api.ts:544
- **UI:** FinalSection.tsx grid (max 10, min 2 zorunlu — Aufmaß için)
- **PDF embed:** pdfGenerator.ts:1680-1795 → `ServerImage` → `fetchServerImageAsBase64(id)` → EXIF fix → `pdf.addImage()`

→ Aus Aufmaß'tan açılan LeadFormModal aynı pattern'i kullanır, **upload bölümü olmaz** (read-only görüntüleme).

---

## Step-by-Step Adımlar

### ADIM 1 — Backend altyapı (DB + iki yönlü senkron)
**Dosya:** `server/index.js`

- [x] **1.1** DB migration: `aufmass_leads.angebot_sent_at TIMESTAMP NULL` (initializeTables içinde `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
- [x] **1.2** Cross-sync helper'ları: `FORM_STATUS_ORDER`, `syncLeadFromForm(formId, newStatus)`, `syncFormsFromLead(leadId, userId)`
- [x] **1.3** `PUT /api/forms/:id` içine `syncLeadFromForm` hook'u (status `angebot_versendet`'e çekildiğinde tetikler)
- [x] **1.4** Yeni endpoint: `POST /api/leads/:id/mark-angebot-sent` (auto-trigger, idempotent)
- [x] **1.5** Yeni endpoint: `POST /api/leads/:id/mark-angebot-sent-manual` (admin-only, `requireAdmin` middleware)
- [x] **1.6** `GET /api/leads` zaten `SELECT l.*` kullanıyor — yeni kolon otomatik response'a dahil. Ekstra iş yok.
- [x] **1.7** `POST /api/leads` body'sine opsiyonel `aufmass_form_id` parametresi → eğer dolu gelirse `aufmass_forms.lead_id` bağı kurulur (branch-scoped)

### ADIM 2 — Frontend service fonksiyonları
**Dosya:** `src/services/api.ts`

- [x] **2.1** `markLeadAngebotAsSent(leadId)` → `POST /api/leads/:id/mark-angebot-sent`
- [x] **2.2** `markLeadAngebotAsSentManual(leadId)` → `POST /api/leads/:id/mark-angebot-sent-manual` (admin)

### ADIM 3 — Angebote.tsx'e tab yapısı
**Dosya:** `src/pages/Angebote.tsx`

- [ ] **3.1** 2 tab: "Schnellangebot" / "Aus Aufmaß"
- [ ] **3.2** `activeTab` state, URL param ile saklanır (`?tab=schnell|aus_aufmass`) — test #6
- [ ] **3.3** Tab 1: mevcut lead listesi (DOKUNULMAZ)
- [ ] **3.4** Tab 2: ADIM 4'te dolacak placeholder
- [ ] **3.5** "Neues Angebot" butonu sadece Tab 1'de görünür

### ADIM 4 — "Aus Aufmaß" tab listesi
**Dosya:** `src/pages/Angebote.tsx` (tab içeriği)

- [ ] **4.1** `GET /api/forms` çağrısı → frontend filter: kunde DOLU (`kunde_vorname || kunde_nachname`) + ürün DOLU (`category && productType`). Status filtresi YOK.
- [ ] **4.2** Kart listesi: kunde adı, ürün özet (kategori/productType/model), tarih, "Angebot erstellen" butonu
- [ ] **4.3** Tıklayınca: state olarak `fromAufmassFormId` set + LeadFormModal aç (auto-fill mode)
- [ ] **4.4** Search box (Tab 1'le aynı UX)

### ADIM 5 — LeadFormModal'a `fromAufmass` mode + foto görüntüleme
**Dosya:** `src/components/LeadFormModal.tsx`

- [ ] **5.1** Yeni prop: `fromAufmassFormId?: number`
- [ ] **5.2** `useEffect` içinde:
  - `getForm(fromAufmassFormId)` ile Aufmaß'ı çek (bilder dahil)
  - **Kunde alanları** auto-fill (düzenlenebilir)
  - **productRows** Aufmaß'ın `category + productType + model + specifications.breite/tiefe + weitereProdukte` ile doldurulur. Fiyat boş.
  - **Notes** Aufmaß'ın `bemerkungen`'i kopyalanır (düzenlenebilir)
- [ ] **5.3** **Bilder:** Yeni "Fotos vom Aufmaß" section — Aufmaß'taki resimleri `getImageUrl(id)` ile thumbnail grid'de göster (read-only, silme/ekleme YOK). Banner: "Diese Fotos werden im Angebot-PDF eingebettet."
- [ ] **5.4** **"E-Mail senden" checkbox** (Soru-3-a):
  - Form altına: "Angebot direkt per E-Mail senden"
  - ✅ İşaretli + form kaydedildi → kayıt sonrası EmailComposer otomatik açılır, mail gönderilince `markLeadAngebotAsSent(leadId)` tetiklenir
  - ❌ İşaretsiz → kaydet, kullanıcı sonra dashboard'dan gönderir
- [ ] **5.5** Submit'te `aufmass_form_id` backend'e gönderilir → bağ kurulur

### ADIM 6 — Angebot PDF generator'a foto embed
**Dosya:** `src/utils/angebotPdfGenerator.ts`

- [ ] **6.1** `pdfGenerator.ts:1680-1795` foto embed pattern'ini port et
- [ ] **6.2** `AngebotPdfData` interface'ine `bilder?: ServerImage[]` ekle
- [ ] **6.3** LeadFormModal kayıttan sonra PDF üretirken `fromAufmass` mode'da Aufmaß'tan çekilen bilder'ları PDF'e geçirir
- [ ] **6.4** Mevcut Schnellangebot için `bilder` boş → mevcut davranış değişmez

### ADIM 7 — Dashboard'a "Angebot erstellen" butonu (Aufmaß listesi)
**Dosya:** `src/pages/Dashboard.tsx`

- [ ] **7.1** Aufmaß kartlarına buton: kunde DOLU + ürün DOLU şartı
- [ ] **7.2** Tıklayınca `navigate('/angebote?tab=aus_aufmass&from_aufmass=<formId>')`
- [ ] **7.3** Angebote sayfası bu query'yi yakalayıp LeadFormModal'ı `fromAufmassFormId` ile direkt açar (ADIM 3+4'le entegre)

### ADIM 8 — EmailComposer entegrasyonu (Soru-3-a + b)
**Dosya:** `src/components/EmailComposer.tsx`

- [ ] **8.1** Mevcut Angebot mail gönderme akışı (`emailType: 'angebot'`) — mail başarıyla gönderildikten sonra `leadId` varsa `markLeadAngebotAsSent(leadId)` çağrılır
- [ ] **8.2** Tek nokta: hem ADIM 5.4 (form içi checkbox akışı), hem mevcut Dashboard kart "E-Mail senden" akışı (Soru-3-b)

### ADIM 9 — Manuel "Gönderildi olarak işaretle" butonu (Soru-3-c, ADMIN-only)
**Dosya:** `src/pages/Angebote.tsx`

- [ ] **9.1** Lead kartında: `angebot_sent_at` NULL ise + user admin ise → "Manuel gönderildi" butonu görünür
- [ ] **9.2** Tıklayınca confirm dialog ("Angebot wurde per Post versendet?") → `markLeadAngebotAsSentManual(leadId)`
- [ ] **9.3** Office user için buton görünmez (frontend filter + backend zaten reddeder)

### ADIM 10 — Angebote listesinde "versendet" rozeti
**Dosya:** `src/pages/Angebote.tsx`

- [ ] **10.1** `Lead` interface'ine `angebot_sent_at?: string` ekle
- [ ] **10.2** Lead kartında `kunden_nummer` rozeti yanına: `{lead.angebot_sent_at && <span class="versendet-badge">✓ Versendet</span>}`

### ADIM 11 — Bearbeiten (FormPage) entegrasyonu doğrula
- [ ] **11.1** ADIM 1.3 sayesinde Bearbeiten'den status değişimi (FormPage'in `PUT /api/forms/:id` çağrısı) otomatik `syncLeadFromForm` tetikler. Frontend ek iş YOK. Test ile doğrula.

### ADIM 12 — E2E test (planın 6 senaryosu + soru-3 katmanları)
- [ ] **12.1** Aufmaß listesinde "Angebot erstellen" butonu doğru kayıtlarda görünüyor mu
- [ ] **12.2** Schnellangebot ↔ Aus Aufmaß tab geçişi kayıpsız mı
- [ ] **12.3** Auto-fill: kunde + ürün + ölçü + foto tamamlandı mı
- [ ] **12.4** Form içi checkbox + mail başarısı → Aufmaß `angebot_versendet`'e geçti mi
- [ ] **12.5** Dashboard kartından mail → Aufmaß `angebot_versendet`'e geçti mi
- [ ] **12.6** Aufmaß status manuel `angebot_versendet`'e çekilince → Angebote'de "versendet" rozeti düştü mü
- [ ] **12.7** Manuel "Gönderildi" butonu sadece admin'de görünüyor mu, office'te gizli mi
- [ ] **12.8** Bearbeiten'den status değişimi de senkronu tetikliyor mu
- [ ] **12.9** Tab seçimi sayfa yenilenince hatırlanıyor mu (URL param)

---

## Commit Stratejisi (her commit öncesi onay alınacak)

| # | Commit Mesajı (Conventional) | Kapsam | Durum |
|---|------------------------------|--------|-------|
| 1 | `feat(modul-b): add backend cross-sync infrastructure for Aufmaß↔Lead status` | ADIM 1 + ADIM 2 | ⏳ Onay bekliyor |
| 2 | `feat(modul-b): add tab structure to Angebote page (Schnellangebot + Aus Aufmaß)` | ADIM 3 | 📋 Yapılacak |
| 3 | `feat(modul-b): add "Aus Aufmaß" tab listing and "Angebot erstellen" button on Dashboard` | ADIM 4 + ADIM 7 | 📋 Yapılacak |
| 4 | `feat(modul-b): add fromAufmass mode and photo display in LeadFormModal` | ADIM 5 | 📋 Yapılacak |
| 5 | `feat(modul-b): embed Aufmaß photos in Angebot PDF` | ADIM 6 | 📋 Yapılacak |
| 6 | `feat(modul-b): wire two-way sync triggers (auto + admin manual mark-sent)` | ADIM 8 + ADIM 9 + ADIM 10 | 📋 Yapılacak |
| 7 | `fix(modul-b): <test sonucu>` veya `refactor(modul-b): <iyileştirme>` | ADIM 11 + 12 test sonucu varsa | 📋 Yapılacak |

**Push politikası:** Local commit atılır, `git push` için ayrıca onay alınır. Kullanıcı "push at" demedikçe local'de kalır.

---

## ADIM 1 + 2 — Yapılan Değişiklikler (Commit-1 öncesi review)

### `server/index.js` (5 yer)
1. **Migration** (`initializeTables` içinde, EMAIL SMTP SETTINGS bölümünden hemen önce): `aufmass_leads.angebot_sent_at TIMESTAMP NULL` kolonu eklendi
2. **Cross-sync helper'lar** (auth middleware'larından sonra): `FORM_STATUS_ORDER`, `syncLeadFromForm()`, `syncFormsFromLead()` — backend STATUS_ORDER frontend ile birebir aynı
3. **`PUT /api/forms/:id`** (status_history INSERT'inden sonra): `syncLeadFromForm(id, updates.status)` çağrısı eklendi
4. **`POST /api/leads`** (body destructure'a `aufmass_form_id` eklendi, response'tan önce branch-scoped UPDATE ile `aufmass_forms.lead_id` bağlanır)
5. **2 yeni endpoint:**
   - `POST /api/leads/:id/mark-angebot-sent` — auto-trigger, idempotent
   - `POST /api/leads/:id/mark-angebot-sent-manual` — `requireAdmin` middleware

### `src/services/api.ts` (1 yer, `updateLeadStatus`'ten sonra)
1. `markLeadAngebotAsSent(leadId)` — auto-trigger için
2. `markLeadAngebotAsSentManual(leadId)` — admin manuel için

**Plan kurallarına uyum:**
- ✅ Mevcut hiçbir status silinmedi/yeniden adlandırılmadı (sadece `angebot_sent_at` timestamp eklendi)
- ✅ Sync sadece ileri yönde (FORM_STATUS_ORDER kontrolü, geri gitmez)
- ✅ Bearbeiten'de de çalışır (PUT `/api/forms/:id` ortak endpoint)
- ✅ Admin-only manuel buton (office reddi backend'de `requireAdmin`)

---

## Açık Konular / Notlar

- **TypeScript build kontrolü:** `node_modules` yok (clean clone). Commit öncesi `npm install` çalıştırılması gerekiyor mu? Kullanıcıdan onay bekleniyor.
- **Plan dokümanı yedeği:** `rechnung-revize-plani.docx` repo root'unda mevcut, dokunulmadı.
