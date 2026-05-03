# Modül B — Aufmaß ↔ Angebot Fiyat Senkronizasyonu

**Branch:** `caglayan`
**Owner:** Çağlayan
**Status:** Spec hazır, geliştirme bekliyor
**Bağımlılıklar:** Modül F (PDF Cover/AGB/Branch Company Info) tamamlanmış olmalı (✓)

---

## 0. Tek Cümlede

Aufmaß formunda seçilen ürün ve ölçüleri Angebot modal'ına otomatik yansıtmak; fiyatı `ProductPricing` sayfasından çekmek; fiyatı tanımlanmamış ürünler için bayiye uyarı vermek.

> **Çağlayan / Claude Code için başlangıç notu:**
>
> Bu spec self-contained. Önce **Bölüm 1–2** (sorun + hedef) oku, **Bölüm 9 "Kod Referans Haritası"** ile mevcut yapıya bak (10 dk), sonra **Bölüm 11 "Geliştirme Sırası"**'na göre adım adım git.

---

## 1. Mevcut Durum (Sorun)

Aufmaß formunda kullanıcı şunu giriyor:
- Kategori (ÜBERDACHUNG / MARKISE / UNTERBAUELEMENTE)
- Tür (Glasdach / Pergola / AUFGLAS / ...)
- Model (Skyline / ANCONA AG / ALUXE / ...)
- Ölçüler (breite / tiefe / hoehe vs. — ürüne göre değişir)
- Diğer özellikler (renk, befestigung, vs.)

Veriler `aufmass_forms` tablosuna kaydediliyor. Status `Angebot Versendet` olunca açılan Angebot modal'ı **boş başlıyor** — kullanıcı:
- Bezeichnung'u manuel yazıyor
- Fiyatı `ProductPricing` sayfasına bakıp manuel kopyalıyor

Bu duplikasyon hata yapma riski yaratıyor + bayi zamanını alıyor.

Ek sorun: `ProductPricing` sayfasında **sadece bayinin manuel girdiği ürünler** görünüyor. productConfig.json'daki diğer modeller görünmüyor — bayi "şu modelin fiyatını da girmeyi unuttum" durumunu fark etmiyor.

---

## 2. Hedef

1. **Eager seed**: ProductPricing sayfasında productConfig.json'daki TÜM modeller görünür. Fiyatı olmayanlar **boş matris** olarak görünür.
2. **Otomatik dolum**: Angebot modal açılınca, aufmaß formundaki model+ölçüler `lead_products` tablosunda lookup edilir, fiyat varsa otomatik dolu gelir.
3. **Yukarı yuvarlama**: Tam ölçü grid'de yoksa bir üst boyut bulunur (mevcut algoritma korunur).
4. **Fiyat eksik uyarısı**: Lookup'ta fiyat NULL ise modal'da kırmızı badge: *"Preis fehlt — jetzt eintragen"*.
5. **productConfig.json yerinde kalır** — Aufmaß formunun model dropdown'ı, renk listeleri, form fields hepsi şu an olduğu gibi devam eder. Sadece `lead_products`'a eager seed eklenir.

---

## 3. Mimari Karar Özeti

| Konu | Seçim | Sebep |
|---|---|---|
| Source-of-truth (model listesi) | **`productConfig.json`** (yerinde kalır) | Mevcut akışı bozmamak; renkler/form fields zaten orada |
| `lead_products` doluluğu | **Eager seed productConfig.json'dan** | Bayi tüm modelleri görür, eksik fiyatları takip eder |
| Boyut profilleri | **Ürün-türüne göre dinamik** (8 profil) | Her ürün doğru boyut alanlarına sahip |
| Branch storage | **Per-branch seed** | Her bayi izolasyonu |
| Branch-level deaktive | **`is_active` flag** (soft) | Geçmiş referanslar kırılmaz |
| ProductPricing filter | **Kategori chip'leri + tür chip'leri + model arama** | 100+ model tek sayfada handle olmaz |
| Yukarı yuvarlama | **Mevcut algoritma korunur** | Bayinin alıştığı davranış |

---

## 4. Veri Modeli

### 4.1 Tek Değişen Tablo: `aufmass_lead_products`

Yeni tablo açılmıyor. Mevcut `aufmass_lead_products` genişletilir:

```sql
ALTER TABLE aufmass_lead_products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS size_values JSONB,            -- jenerik N-eksenli boyut: { breite: 5000, tiefe: 4000 }
  ADD COLUMN IF NOT EXISTS size_profile VARCHAR(10),     -- 'P1' .. 'P8' (Bölüm 4.2)
  ALTER COLUMN price DROP NOT NULL,                      -- price artık NULLABLE
  ALTER COLUMN branch_id SET NOT NULL;                   -- artık zorunlu

CREATE INDEX IF NOT EXISTS idx_lead_products_active ON aufmass_lead_products(branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lead_products_size_values ON aufmass_lead_products USING GIN (size_values);
```

**Mevcut UNIQUE** `(branch_id, product_name, breite, tiefe)` korunur (legacy 2D satırlar için).
**Yeni UNIQUE** ekleniyor: `(branch_id, product_name, size_values)`. Migration sırasında eski satırların `size_values`'u doldurulduğundan ikisi de geçerli.

### 4.2 Boyut Tipi Profilleri (productConfig.json İncelemesi)

Aufmaß formunda her ürün-türü farklı boyut alanları kullanır. 8 profil tespit ettim:

| Profil | Eksenler | Hangi türlerde | Örnek `size_values` |
|---|---|---|---|
| **P1** — 2D (B×T) | `["breite","tiefe"]` | ÜBERDACHUNG/Glasdach, Lamellendach, Pergola, Vordach | `{ breite: 5000, tiefe: 3500 }` |
| **P2** — Markise 2D (B×L) | `["markisenbreite","markisenlaenge"]` | MARKISE/AUFGLAS | `{ markisenbreite: 5000, markisenlaenge: 3000 }` |
| **P3** — Markise 3D (B×L×H) | `["markisenbreite","markisenlaenge","markisenhoehe"]` | MARKISE/UNTERGLAS | `{ markisenbreite: 4000, markisenlaenge: 2500, markisenhoehe: 2800 }` |
| **P4** — Senkrecht 2D (B×H) | `["markisenbreite","markisenhoehe"]` | MARKISE/SENKRECHT | `{ markisenbreite: 2500, markisenhoehe: 3000 }` |
| **P5** — Markise 1D (B) | `["markisenbreite"]` | MARKISE/VOLKASSETTE, HALBEKASSETTE | `{ markisenbreite: 5000 }` |
| **P6** — Element 2D (B×H) | `["breite","hoehe"]` | UNTERBAUELEMENTE/GG Schiebe, Rahmen Schiebe, Festes Element (Rechteck), Dreh Tür | `{ breite: 2000, hoehe: 2500 }` |
| **P7** — Trapez 3D | `["breite","vorneHoehe","hintenHoehe"]` | UNTERBAUELEMENTE/Festes Element (Trapez varyantı) | `{ breite: 1500, vorneHoehe: 2200, hintenHoehe: 2800 }` |
| **P8** — Keil 3D | `["laenge","vorneHoehe","hintenHoehe"]` | UNTERBAUELEMENTE/Keil | `{ laenge: 1500, vorneHoehe: 2000, hintenHoehe: 2800 }` |

**Profil tespiti**: productConfig.json'daki her ürün-türünün `fields[]`'inden tespit edilir. Helper:

```javascript
function inferSizeProfile(category, productType, fields) {
  const fieldNames = fields.map(f => f.name);
  if (fieldNames.includes('markisenbreite') && fieldNames.includes('markisenlaenge') && fieldNames.includes('markisenhoehe')) return 'P3';
  if (fieldNames.includes('markisenbreite') && fieldNames.includes('markisenlaenge')) return 'P2';
  if (fieldNames.includes('markisenbreite') && fieldNames.includes('markisenhoehe')) return 'P4';
  if (fieldNames.includes('markisenbreite')) return 'P5';
  if (fieldNames.includes('breite') && fieldNames.includes('vorneHoehe') && fieldNames.includes('hintenHoehe')) return 'P7';
  if (fieldNames.includes('laenge') && fieldNames.includes('vorneHoehe') && fieldNames.includes('hintenHoehe')) return 'P8';
  if (fieldNames.includes('breite') && fieldNames.includes('hoehe')) return 'P6';
  if (fieldNames.includes('breite') && fieldNames.includes('tiefe')) return 'P1';
  return null;  // pricing_type='unit' veya boyut yok
}
```

**Profil → axes mapping**:
```javascript
const PROFILE_AXES = {
  P1: ['breite', 'tiefe'],
  P2: ['markisenbreite', 'markisenlaenge'],
  P3: ['markisenbreite', 'markisenlaenge', 'markisenhoehe'],
  P4: ['markisenbreite', 'markisenhoehe'],
  P5: ['markisenbreite'],
  P6: ['breite', 'hoehe'],
  P7: ['breite', 'vorneHoehe', 'hintenHoehe'],
  P8: ['laenge', 'vorneHoehe', 'hintenHoehe']
};
```

### 4.3 Default Boyut Grid'leri (Eager Seed için)

Her profil için varsayılan grid değerleri. Backend startup script'te kullanılır.

```javascript
const DEFAULT_GRIDS = {
  P1: { breite: [3000, 4000, 5000, 6000, 7000], tiefe: [2500, 3000, 3500, 4000, 5000] },
  P2: { markisenbreite: [3000, 4000, 5000, 6000], markisenlaenge: [2000, 2500, 3000, 3500] },
  P3: { markisenbreite: [3000, 4000, 5000], markisenlaenge: [2000, 2500, 3000], markisenhoehe: [2500, 3000] },
  P4: { markisenbreite: [1500, 2000, 2500, 3000], markisenhoehe: [2000, 2500, 3000] },
  P5: { markisenbreite: [3000, 4000, 5000, 6000, 7000] },
  P6: { breite: [1000, 1500, 2000, 2500, 3000], hoehe: [2000, 2200, 2500, 2800] },
  P7: { breite: [1000, 1500, 2000], vorneHoehe: [2000, 2200, 2500], hintenHoehe: [2500, 2800, 3000] },
  P8: { laenge: [500, 1000, 1500, 2000], vorneHoehe: [2000, 2500], hintenHoehe: [2500, 3000] }
};
```

Bayi/admin daha sonra ProductPricing sayfasından kendi grid'ini özelleştirebilir (yeni breite/tiefe satırı ekleme — mevcut UI'da zaten var).

### 4.4 Mevcut Satırlara Migration

Mevcut bayinin manuel girdiği satırlara dokunulmaz. Sadece:
- `is_active = true` set edilir
- `size_profile` ürünün kategori/tür'üne göre tespit edilir
- `size_values` legacy `breite/tiefe`'den doldurulur (2D profiller için):
  ```sql
  UPDATE aufmass_lead_products
  SET size_values = jsonb_build_object('breite', breite, 'tiefe', tiefe),
      size_profile = 'P1'
  WHERE size_values IS NULL
    AND product_name IN (SELECT model FROM <productConfig P1 modelleri>);
  ```
  3D profiller (P3, P7, P8) için `size_values` manuel doldurulamaz — Çağlayan migration sırasında bayilerin verisini review eder.

---

## 5. Eager Seed Mantığı

Backend startup'ta veya yeni branch açıldığında çalışır.

```javascript
async function seedLeadProductsForBranch(branchSlug) {
  const config = require('../src/config/productConfig.json');

  for (const [category, types] of Object.entries(config)) {
    for (const [productType, typeData] of Object.entries(types)) {
      const profile = inferSizeProfile(category, productType, typeData.fields || []);
      if (!profile) continue;  // boyut yok, atla

      const axes = PROFILE_AXES[profile];
      const grid = DEFAULT_GRIDS[profile];

      for (const modelName of typeData.models) {
        // Cartesian product: her axis kombinasyonu için bir satır
        const combinations = cartesianProduct(axes.map(a => grid[a]));

        for (const combo of combinations) {
          const sizeValues = Object.fromEntries(axes.map((a, i) => [a, combo[i]]));

          // Idempotent — varsa atla
          await pool.query(`
            INSERT INTO aufmass_lead_products
              (branch_id, category, product_type, product_name,
               breite, tiefe,                                 -- legacy uyumluluk için doldurulur
               size_values, size_profile,
               price, pricing_type, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NULL, 'dimension', true)
            ON CONFLICT (branch_id, product_name, breite, tiefe) DO NOTHING
          `, [
            branchSlug, category, productType, modelName,
            sizeValues.breite || sizeValues.markisenbreite || sizeValues.laenge || 0,
            sizeValues.tiefe || sizeValues.markisenlaenge || sizeValues.markisenhoehe || sizeValues.hoehe || sizeValues.vorneHoehe || 0,
            JSON.stringify(sizeValues), profile
          ]);
        }
      }
    }
  }
}
```

**Çağrılma yerleri:**
1. Backend startup — her aktif branch için (idempotent, mevcut satırlara dokunmaz)
2. Yeni branch oluşturulduğunda — sadece o branch için
3. productConfig.json güncellenip deploy yapıldığında (startup tetikler)

**Tahmini satır sayısı:** ~48 model × ortalama ~15 grid kombinasyonu = **~720 satır per branch**. 15 branch = ~10800 satır. Index'lerle performans sorun değil.

---

## 6. API Endpoint'leri

### 6.1 Yeni Endpoint'ler

#### Lookup (Angebot modal için)

```
GET /api/lead-products/lookup?model=Skyline&size_values={breite:350,tiefe:210}
```

Response:
```json
// Tam match
{ "matched": true, "exact": true, "lead_product": { "id": 42, "price": 1850, "size_values": {...}, ... } }

// Yukarı yuvarlama
{ "matched": true, "exact": false,
  "rounded_to": { "breite": 4000, "tiefe": 2500 },
  "lead_product": { ..., "price": 2100 } }

// Model var ama bu kombinasyon için fiyat NULL
{ "matched": true, "exact": false, "price_missing": true,
  "lead_product": { ..., "price": null } }

// Hiç match yok (eager seed çalışmadıysa veya manuel custom model)
{ "matched": false }
```

#### Upsert (Angebot save'de)

```
POST /api/lead-products/upsert-from-angebot
Body: { product_name, size_values, price, size_profile? }
```

Branch'in kendi tablosuna fiyat yazar. Mevcut satır varsa UPDATE, yoksa INSERT (catalog dışı custom ürünler için).

### 6.2 Mevcut Endpoint'lerin Değişimi

```
GET /api/lead-products
  ↳ artık eager seed'le tüm modeller döner (price=NULL'lar dahil)
  ↳ ProductPricing sayfası bunları matris olarak gösterir, NULL'lar "—" olarak

PUT /api/lead-products/:id
  ↳ price update (mevcut)
  ↳ + is_active toggle desteği eklenir
```

---

## 7. UI Değişiklikleri

### 7.1 ProductPricing Sayfası

**Üst bar — özet + filter:**

```
┌────────────────────────────────────────────────────────────────────┐
│ 📊 48 Modelle · ✓ 23 mit Preis · ⚠ 25 ohne Preis                   │
├────────────────────────────────────────────────────────────────────┤
│ Kategorie:  ●ÜBERDACHUNG (13)  ○MARKISE (10)  ○UNTERBAUELEMENTE   │
│ Typ:        ●Glasdach (13)  ○Lamellendach  ○Pergola  ○Vordach     │
│ 🔍 Modell suchen...                                                │
│ [☐ Nur ohne Preis]  [☐ Pasif olanları göster]                     │
└────────────────────────────────────────────────────────────────────┘
```

**Filter mantığı:**
- 3 ana kategori chip'i (ÜBERDACHUNG / MARKISE / UNTERBAUELEMENTE) — sayılarla
- Tür chip'leri kategoriye göre dinamik gelir
- Model search input — real-time filter
- Default: hiçbir filter seçili değil → tüm modeller listelenir

**Her ürün kartında:**
- **Status badge**: ✓ Vollständig / ⚠ Teilweise / ✗ Keine Preise
- **Boyut profili badge**: `[B×T]`, `[B×L×H]`, `[B]` — bayi bir bakışta görür
- Mevcut accordion + matris UI korunur
- Boş matris hücreleri "—" gösterir (mevcut)
- Empty state mesajı: *"Diese Modell hat noch keine Preise. Tragen Sie Preise ein, um es im Angebot nutzen zu können."*

**1D profili (P5)**: matris yerine **liste** UI (her breite için bir satır).
**3D profili (P3, P7, P8)**: matris üstünde **3. boyut tab'ları** (örn `Höhe 2500 | 3000 | 3500`).

**Yeni butonlar:**
- "Modell deaktivieren" — `is_active=false` bulk update (bu modelin tüm grid satırları için)
- "Reaktivieren" — pasif modellerde gösterilir

### 7.2 Aufmaß Formu

**Değişmez.** productConfig.json import'u ve form alanları olduğu gibi kalır. Bayi alıştığı şekilde devam eder.

### 7.3 Angebot Modal — Auto-Fill

Modal `handleStatusChange` → `'angebot_versendet'` branch'inde, mevcut `getAngebot` çağrısından **önce**:

```typescript
async function preFillAngebotItems(form) {
  const items = [];
  // Ana ürün
  if (form.model) {
    items.push(await lookupAndBuildItem(form.model, form.specifications, form.category, form.product_type));
  }
  // weitereProdukte
  for (const w of form.weitereProdukte || []) {
    items.push(await lookupAndBuildItem(w.model, w.specifications, w.category, w.productType));
  }
  return items;
}

async function lookupAndBuildItem(modelName, specs, category, productType) {
  // Profil'i productConfig.json'dan bulup axes'i çıkar
  const profile = inferSizeProfile(category, productType, getFields(category, productType));
  const axes = PROFILE_AXES[profile] || [];
  const sizeValues = Object.fromEntries(axes.map(a => [a, specs[a]]).filter(([_, v]) => v != null));

  const lookup = await api.get(`/lead-products/lookup`, { model: modelName, size_values: JSON.stringify(sizeValues) });

  const baseItem = {
    bezeichnung: `${modelName}${formatSizes(sizeValues)}`,
    menge: 1,
    einzelpreis: 0,
    gesamtpreis: 0,
    _meta: { lookupResult: lookup }
  };

  if (lookup.matched && lookup.exact && lookup.lead_product?.price) {
    baseItem.einzelpreis = lookup.lead_product.price;
    baseItem.gesamtpreis = lookup.lead_product.price;
    baseItem._meta.status = 'matched';
  } else if (lookup.matched && !lookup.exact && lookup.lead_product?.price) {
    baseItem.einzelpreis = lookup.lead_product.price;
    baseItem.gesamtpreis = lookup.lead_product.price;
    baseItem.bezeichnung += ` (auf ${formatSizes(lookup.rounded_to)} aufgerundet)`;
    baseItem._meta.status = 'rounded';
  } else if (lookup.matched && lookup.price_missing) {
    baseItem._meta.status = 'price_missing';
  } else {
    baseItem._meta.status = 'no_match';
  }

  return baseItem;
}
```

**Modal UI'da her item satırının yanında badge:**

| `_meta.status` | Badge | Renk | Davranış |
|---|---|---|---|
| `matched` | ✓ Aus Katalog | Yeşil | Otomatik dolu, kullanıcı isterse değiştirir |
| `rounded` | ↑ Aufgerundet auf {boyut} | Sarı | Otomatik dolu, "manuel überschreiben" mümkün |
| `price_missing` | ⚠ **Preis fehlt — [Eintragen]** | Kırmızı | Inline edit butonu açar |
| `no_match` | ⚠ Modell nicht im Katalog | Gri | Manuel girilir |

**`[Eintragen]` butonu**: küçük inline modal açar:
- Boyutlar (size_values) zaten dolu (read-only)
- Preis input
- Save → `POST /api/lead-products/upsert-from-angebot` → angebot item güncellenir + ProductPricing tablosu o satırı kazanır

**Save Angebot anında "Bu fiyatı katalog'a kaydet" toggle**:
- Default: ON (lookup'ta price_missing veya no_match'di) → `upsert-from-angebot` çağrılır
- Default: OFF (lookup'ta matched/rounded'dı, kullanıcı farklı fiyat girdi → özel iskonto sayılır)
- Kullanıcı toggle'ı manuel değiştirebilir

---

## 8. Yukarı Yuvarlama Algoritması (Generic, N-Eksenli)

```javascript
async function findRoundedMatch(branchId, modelName, sizeValues) {
  // sizeValues örn: { breite: 350, tiefe: 210 } veya { markisenbreite: 5000, markisenhoehe: 2200 }
  const axes = Object.keys(sizeValues);

  if (axes.length === 0) {
    // pricing_type='unit' — tek satır lookup
    const result = await pool.query(
      `SELECT * FROM aufmass_lead_products
       WHERE branch_id = $1 AND product_name = $2 AND is_active = true LIMIT 1`,
      [branchId, modelName]
    );
    return result.rows[0] ? { exact: true, row: result.rows[0] } : null;
  }

  // Tam match
  const exact = await pool.query(
    `SELECT * FROM aufmass_lead_products
     WHERE branch_id = $1 AND product_name = $2 AND size_values = $3::jsonb
       AND is_active = true`,
    [branchId, modelName, JSON.stringify(sizeValues)]
  );
  if (exact.rows.length > 0) return { exact: true, row: exact.rows[0] };

  // Yukarı yuvarlama — her axis için size_values->>axis::int >= requested
  const conditions = axes.map((axis, i) => `(size_values->>'${axis}')::int >= $${i + 3}`).join(' AND ');
  const orderBy = axes.map(a => `(size_values->>'${a}')::int ASC`).join(', ');
  const params = [branchId, modelName, ...axes.map(a => sizeValues[a])];

  const rounded = await pool.query(
    `SELECT * FROM aufmass_lead_products
     WHERE branch_id = $1 AND product_name = $2 AND is_active = true
       AND ${conditions}
     ORDER BY ${orderBy}
     LIMIT 1`,
    params
  );
  if (rounded.rows.length > 0) {
    return { exact: false, rounded_to: rounded.rows[0].size_values, row: rounded.rows[0] };
  }

  return null;
}
```

**Edge case**: İstenen boyut grid maksimumunu aşıyor → `null` döner → modal'da `no_match` veya `price_missing` durumuna düşer (lookup endpoint logic'i).

---

## 9. Kod Referans Haritası

### Backend (`server/index.js`)

| Konu | Yer (yaklaşık line) | Pattern referansı |
|---|---|---|
| Migration: `aufmass_lead_products` ALTER kolonları | `initializeDatabase()` içinde, mevcut "MODÜL F" migration bloğundan sonra | `aufmass_branch_terms` ALTER örneği |
| Eager seed function `seedLeadProductsForBranch()` | Yeni helper, `initializeDatabase()` sonunda + branch-create endpoint'inden çağrılır | — |
| `GET /api/lead-products/lookup` | Mevcut `/api/lead-products` endpoint'i yakınına ekle (line ~4039) | Branch isolation pattern: `req.branchId \|\| 'koblenz'` |
| `POST /api/lead-products/upsert-from-angebot` | Aynı blok | INSERT … ON CONFLICT pattern |

**Mevcut benzer pattern'ler (referans okumak için):**
- `enrichItemsWithProductMeta()` (line ~4525) — model adı bazlı join örneği
- `aufmass_branch_terms` migration (line ~451) — ALTER COLUMN IF NOT EXISTS pattern
- MODÜL F2 endpoint section (line ~5944) — endpoint yapısı, multer, requireAdmin

### Frontend

| Dosya | Konu |
|---|---|
| `src/services/api.ts` | Yeni interface'ler (`LeadProductLookupResult`) ve API fonksiyonları (`lookupLeadProduct`, `upsertLeadProductFromAngebot`) — mevcut `// MODÜL F: BRANCH TERMS` section sonuna ekle |
| `src/utils/sizeProfile.ts` | YENİ — `inferSizeProfile()`, `PROFILE_AXES`, `DEFAULT_GRIDS` constants. productConfig.json import edip helper fonksiyonlar export eder |
| `src/pages/ProductPricing.tsx` | Üst bar (özet + filter), badge'ler, empty state mesajları |
| `src/pages/ProductPricing.css` | Filter chip'leri, badge stilleri |
| `src/pages/Dashboard.tsx` | `handleStatusChange()` (line ~332) `'angebot_versendet'` branch'inde `preFillAngebotItems(form)` ekle. Modal items render'ında badge UI (line ~2065) |
| `src/utils/preFillAngebot.ts` | YENİ — `preFillAngebotItems()`, `lookupAndBuildItem()` |
| `src/components/AngebotInlineEditModal.tsx` | YENİ — "Preis fehlt — Eintragen" inline mini-modal |

### Silinmez

| Dosya | Sebep |
|---|---|
| `src/config/productConfig.json` | **Source-of-truth korunur**. Aufmaß formu, renkler, form fields hep buradan. |

### Çağlayan'ın okuması gereken dosyalar (10 dk)

```
1. src/config/productConfig.json — model yapı + 8 boyut profili
2. server/index.js initializeDatabase() — migration pattern
3. server/index.js GET /api/lead-products (line ~4039) — endpoint pattern
4. src/pages/ProductPricing.tsx — mevcut accordion + matrix UI
5. src/pages/Dashboard.tsx handleStatusChange() (line ~332) — Angebot modal akışı
6. src/utils/productImagesCache.ts — frontend cache pattern (gerekirse benzer kullan)
```

---

## 10. Edge Case'ler

| Durum | Davranış |
|---|---|
| productConfig.json'a yeni model eklenir, deploy yapılır | Backend startup script otomatik eager seed eder (idempotent, sadece eksik satırları ekler) |
| Bayi modeli pasif yapar | Aufmaß formu **dropdown'da gösterir** (productConfig.json yerinde — değişmez), ama Angebot lookup'ta `is_active=false` satırlar **fiyat bulamaz** → kullanıcıya `price_missing` badge gösterir. Yani pasif yapma sadece "fiyat sorulmasın" anlamına gelir, "model gizlensin" değil. **Karar**: bu beklenmedik bir davranış, `is_active` sadece **ProductPricing UI'da gri görünme** anlamında kullanılır. Lookup her zaman `is_active=true` filtreler |
| Bayi catalog dışı bir model girmek isterse | ProductPricing'te "Manuell hinzufügen" mevcut, custom model adı + boyut girer, `size_profile=NULL` kalır. Eager seed bu satırı bozmaz |
| Aufmaß'taki ölçü boş (`breite=null`) | Lookup `size_values: {}` ile yapılır → `pricing_type='unit'` arar, yoksa `no_match` |
| Boyut grid maksimumunu aşıyor (örn 8000mm, grid 7000'de bitiyor) | Yuvarlama `null` döner → `no_match` veya `price_missing` |
| Trapez varyantı (Festes Element + elementForm:Trapez) | Migration'da bu durumda `size_profile='P7'` set edilir, `size_values` `breite/vorneHoehe/hintenHoehe` içerir. ProductPricing'te 3D tab UI ile gösterilir |
| weitereProdukte (her biri ayrı) | Aynı `lookupAndBuildItem` mantığıyla her biri için ayrı angebot item üretilir |
| Migration sırasında 3D profillerin `size_values`'unu doldurma | Eski sadece breite/tiefe vardı. Çağlayan migration script'te bu satırlar için manuel review listesi çıkarır, ya da `size_values=NULL` bırakır (sonradan bayi düzenler) |

---

## 11. Geliştirme Sırası

1. **DB Migration + Seed Function** (1 gün)
   - `aufmass_lead_products` ALTER (size_values, size_profile, is_active)
   - `seedLeadProductsForBranch()` helper
   - Backend startup'ta her aktif branch için seed çağrısı (idempotent)
   - Mevcut satırların `size_values`/`size_profile` doldurulması

2. **Backend API** (1 gün)
   - `GET /api/lead-products/lookup` (yukarı yuvarlama dahil)
   - `POST /api/lead-products/upsert-from-angebot`
   - `PUT /api/lead-products/:id` is_active toggle desteği

3. **Frontend Helper'lar** (0.5 gün)
   - `src/utils/sizeProfile.ts` (inferSizeProfile, PROFILE_AXES, DEFAULT_GRIDS)
   - `src/utils/preFillAngebot.ts` (preFillAngebotItems, lookupAndBuildItem)

4. **ProductPricing UI** (1.5 gün)
   - Üst bar: özet sayılar
   - 3 seviyeli filter (kategori chip + tür chip + arama)
   - Status badge'ler (✓/⚠/✗) + boyut profili badge'i
   - Empty state mesajları
   - "Modell deaktivieren / Reaktivieren" butonları
   - 1D liste UI (P5 için)
   - 3D tab UI (P3/P7/P8 için)

5. **Angebot Modal Auto-Fill** (1.5 gün)
   - `preFillAngebotItems` çağrısı handleStatusChange içinde
   - 4 durum badge UI'ı
   - "Preis fehlt — Eintragen" inline modal
   - "Bu fiyatı katalog'a kaydet" toggle

6. **Test + Migration Yürütme** (0.5 gün)
   - Staging'te seed test
   - Production migration
   - Kabul kriterleri kontrol

**Toplam: ~6 iş günü**

---

## 12. Kabul Kriterleri (DoD)

- [ ] `aufmass_lead_products` ALTER tamamlandı (`is_active`, `size_values`, `size_profile` kolonları)
- [ ] Backend startup `seedLeadProductsForBranch()` her aktif branch için çalışıyor (idempotent)
- [ ] productConfig.json'daki 8 profil için doğru `size_values` Cartesian product satırları üretiliyor
- [ ] Mevcut bayinin manuel girdiği satırlar bozulmadı (test: 1 modelin manuel fiyatı korunuyor)
- [ ] Mevcut 2D satırların `size_values` legacy `breite/tiefe`'den otomatik dolduruldu (P1, P2, P4, P6)
- [ ] `GET /api/lead-products/lookup` 4 senaryoyu doğru dönüyor (matched/rounded/price_missing/no_match)
- [ ] Yukarı yuvarlama algoritması generic çalışıyor — test case'ler:
  - 2D profil (P1): tam match, eksik tiefe, grid dışı
  - 1D profil (P5): tek-eksen lookup
  - 3D profil (P3): 3 eksenli yuvarlama
- [ ] `POST /api/lead-products/upsert-from-angebot` çalışıyor
- [ ] ProductPricing özet bar doğru sayıları gösteriyor (`X mit Preis / Y ohne Preis`)
- [ ] Kategori chip filter (3 ana) çalışıyor, sayılarla
- [ ] Tür chip filter kategori seçiminden sonra dinamik geliyor
- [ ] Model search input real-time filtre yapıyor
- [ ] "Nur ohne Preis" filter çalışıyor
- [ ] Her ürün kartında doğru status badge görünüyor (✓/⚠/✗)
- [ ] Boyut profili badge'i her kartta görünüyor (`[B×T]`, `[B×L×H]`, `[B]`)
- [ ] 1D profil (P5) liste UI'ında görünüyor
- [ ] 3D profil (P3/P7/P8) tab UI'ında görünüyor
- [ ] "Modell deaktivieren" butonu `is_active=false` set ediyor (bulk)
- [ ] "Reaktivieren" pasif modellerde görünüyor
- [ ] Aufmaß formu **değişmedi** (regression test: form save/load eskiden olduğu gibi çalışıyor)
- [ ] Angebot modal'ı açıldığında auto-fill çalışıyor
- [ ] 4 durum badge görünüyor (matched/rounded/price_missing/no_match)
- [ ] "Preis fehlt — Eintragen" inline modal'ı çalışıyor, kaydedince hem angebot item hem lead_products güncelleniyor
- [ ] "Bu fiyatı katalog'a kaydet" toggle Angebot save'de doğru davranış
- [ ] Eski Aufmaß PDF'leri / Angebot kayıtları regression yok
- [ ] weitereProdukte için aynı auto-fill akışı çalışıyor

---

## 13. Riskler ve Önlemler

| Risk | Olasılık | Etki | Önlem |
|---|---|---|---|
| Mevcut lead_products satırlarının `size_values` migration'ı 3D profiller için tam yapılamaz | Orta | Düşük | Migration sırasında null bırak, bayi sonradan düzenler. Lookup `size_values IS NULL` satırları atlar |
| productConfig.json'daki yeni model deploy sonrası seed iz takip edilmez | Düşük | Düşük | Backend startup script idempotent — her açılışta eksik satırları ekler |
| Yukarı yuvarlama bayinin niyetinden farklı sonuç verir | Orta | Orta | Modal'da "rounded" badge + tooltip + "Manuel überschreiben" her zaman mümkün |
| Bayi yanlışlıkla bir modeli pasif yapar | Düşük | Düşük | "Pasif olanları göster" filter + "Reaktivieren" butonu |
| Per-branch seed çok satır üretir (~10800 satır 15 branch için) | Düşük | Düşük | Index'ler doğru; query performans test edilmeli |
| Mevcut `(branch_id, product_name, breite, tiefe)` UNIQUE constraint'i 3D profilde çakışır (aynı breite/tiefe ama farklı 3. eksen) | Yüksek | Orta | 3D satırlar için `breite/tiefe`'i kombine sayı yap (örn `breite=4000, tiefe=2500` 3 farklı `markisenhoehe` için 3 ayrı satır olamaz). **Çözüm**: 3D profillerde `breite/tiefe` kolonlarına 3. eksen değerini de encode et (ör. `tiefe = (markisenlaenge * 10000 + markisenhoehe)`) — kötü hack. **Daha iyi**: UNIQUE constraint'i kaldır, yeni `(branch_id, product_name, size_values)` constraint'i kur |

**3D profil constraint sorunu için karar**:

```sql
-- Eski UNIQUE'i kaldır
ALTER TABLE aufmass_lead_products DROP CONSTRAINT IF EXISTS aufmass_lead_products_branch_product_size_key;
-- Yeni UNIQUE
ALTER TABLE aufmass_lead_products
  ADD CONSTRAINT uq_lead_products_size_values
  UNIQUE (branch_id, product_name, size_values);
```

`breite/tiefe` legacy kolonları kalır ama UNIQUE değil. Yeni satırlar `size_values`'a güvenir.

---

## 14. Sonraki Modül Tohumları

- **Modül B v2** — productConfig.json'u DB'ye taşı (catalog tablosu açma) — admin panelinden CRUD; deploy gerektirmez
- **Modül B v3** — Aufmaß formuna `lead_product_id` FK ekle (string match yerine ID-bazlı join)
- **Modül C** — Angebot modal'ı catalog picker'a çevir (en modern UX)

---

**Hazırlayan:** Sistem (Claude)
**Onay:** Fuat (Aylux)
**Devir:** Çağlayan branch'i için iş paketi
