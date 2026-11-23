# my-home — Istruzioni Tecniche & Passaggio di Consegne AI

> **Scopo di questo file:** fornire a qualsiasi AI (Claude, ChatGPT, Gemini, Cursor, ecc.) tutto il contesto architetturale, le regole di sicurezza, le scorciatoie anti-spreco e la mappa dei file del progetto **my-home**, così da poter riprendere lo sviluppo subito senza consumare crediti in analisi esplorative inutili.

---

## 1. Regole Fondamentali (LEGGERE PRIMA DI TOCCARE QUALSIASI FILE)

1. **ZERO CREDITI AI SU CONSUMI, BOLLETTE E PDF:**
   - **NON leggere mai** eventuali file binari o PDF in `public/assets/` (sono protetti in `.aiignore`).
   - **NON usare mai** chiamate a LLM / Gemini API per parsare CSV e-distribuzione, bollette Edison/Acegas/TARI o allegati PDF. Il parsing è al 100% locale e deterministico lato browser (`pdfjs-dist`, `jszip`, regex) e lato Python (`scripts/sync_edistribuzione.py`).
   - L'unico uso opzionale dell'API Gemini riguarda la ricerca articoli in `server.ts` (`/api/articles/search` e `/api/articles/manual`), che ha già un fallback gratuito automatico su Wikidata / Wikipedia / link produttore in caso di quota `429` o assenza di `GEMINI_API_KEY`.

2. **PROGETTO FIREBASE UNIFICATO (`gen-lang-client-0721850501`):**
   - `src/firebase.ts` usa **un solo progetto Firebase principale** letto da `firebase-applet-config.json`:
     - `projectId`: `gen-lang-client-0721850501`
     - `firestoreDatabaseId`: `ai-studio-30a168e3-8158-474f-b9f2-f717d7220314`
     - Qui risiedono **Auth Google + Gmail OAuth (`connectGmailAccount()`) + tutti i dati Firestore + Vault PDF + `FIREBASE_SERVICE_ACCOUNT`** usato dai bot GitHub Actions 24/7.
   - `getLegacyMigrationFirebase()` in `src/firebase.ts` mantiene un'app lazy secondaria esclusivamente per la migrazione one-click dal vecchio database gestito (`spiritual-bearing-sq7xb`) via `src/utils/legacyMigration.ts`.
   - **VIETATO:** rimuovere `oAuthClientId` da `firebase-applet-config.json` o rompere la compatibilità delle regole in `firestore.rules` (verifica sempre con `npx eslint firestore.rules`).

3. **LINGUA, VINCOLI UI & AMBIENTE:**
   - L'interfaccia è interamente in **italiano**, tema dark (`slate-950` / `slate-900` / accenti `sky` / `emerald` / `amber`), Tailwind CSS v4 (`@import "tailwindcss";` in `src/index.css`).
   - **NON usare** `window.alert`, `window.confirm` o `window.open` (l'app può girare in iframe; usa modali React custom o link `<a target="_blank">`).
   - **NON cancellare** funzionalità esistenti né sostituire dati reali con dati finti.

---

## 2. Identità Casa, Utenze & Stack Tecnico

- **Repository GitHub:** `mauriziominieri/my-home`
- **URL Produzione (GitHub Pages):** `https://mauriziominieri.github.io/my-home/`
- **Proprietario:** `mauminieri@gmail.com` (`appMeta/owner` memorizza dinamicamente l'`ownerUid` su `gen-lang-client-0721850501`).
- **POD Luce:** `IT001E11251419` (6,0 kW impegnati; tariffa di riferimento Octopus Fissa 24M `0,1595 €/kWh` o config personalizzata in `homeConfig`).
- **Impianto Clima:** Pompa di calore / centrale **Ariston NET** + termostati di zona **Rehau Nea Smart 2.0** (zone: `salone`, `roberta`, `bagno1`, `matrimoniale`, `bagno2`, `maurizio`) + **VMC**.
- **Veicolo principale:** Fiat Panda targa **`EA218ES`**.
- **Supermercati confrontati nella Spesa:** `IN'S`, `MD`, `CONAD`.
- **Stack:** React 19, TypeScript, Vite 8 (`base: '/my-home/'` quando `GITHUB_PAGES=true`), Express (`server.ts`, porta `3000`), Recharts, Lucide Icons, Firebase v13, `pdfjs-dist`, `jszip`.

---

## 3. Flusso Consumi & Bollette (GitHub Actions ➔ Firestore Diretto)

1. **GitHub Actions 24/7 (`.github/workflows/sync-edistribuzione.yml`):**
   - Schedulato ogni 10 minuti (`cron: '*/10 * * * *'`, tempi reali ~10–30 min in base alla coda GitHub) o avviabile manualmente (`workflow_dispatch`).
   - Esegue `scripts/sync_edistribuzione.py`:
     - Legge via IMAP Gmail (`secrets.GMAIL_USER` + `secrets.GMAIL_APP_PASSWORD`) **solo la INBOX** (ignorando il Cestino).
     - Estrae CSV/ZIP di e-distribuzione, bollette PDF Edison Luce, bollette PDF Acegas Acqua e avvisi PDF TARI.
     - Scrive **direttamente su Firestore** tramite `firebase-admin` usando `secrets.FIREBASE_SERVICE_ACCOUNT` (sia i documenti strutturati che i PDF originali in `vaultFiles`/`vaultFileChunks`), risolvendo `ownerUid` da `appMeta/owner` o `auth.get_user_by_email('mauminieri@gmail.com')` e leggendo la tariffa reale da `homeConfig/main`.
     - Sposta nel Cestino Gmail solo le email elaborate e salvate con successo.
   - Esegue inoltre `scripts/check_octopus_tariff.py` (in cron dedicato alle 23:45 UTC) che salva il confronto tariffe mercato su Firestore (`appMeta/octopusTariff`).
   - *Nota su GitHub Actions:* GitHub sospende i workflow `schedule` dopo 60 giorni senza commit umani su `main`.
2. **Lettura nell'App React (`src/App.tsx`):**
   - Quando l'utente è autenticato (`user?.uid`), sottoscrive in tempo reale tutte le subcollection sotto `users/{uid}/...` e `appMeta/octopusTariff`, salvando i dati in cache `localStorage` (`myhome_readings_cache_last`) per visualizzazione offline/sloggata senza errori di permessi.
   - Supporta la migrazione one-click dal vecchio database (`spiritual-bearing-sq7xb`) via `src/utils/legacyMigration.ts`.
3. **Sync Gmail Istantaneo dal Browser (`src/utils/gmailSync.ts`):**
   - Pulsante nella barra in alto (**"Collega Gmail"** / **"Sincronizza Gmail"**) visibile quando loggati: scansiona la INBOX via Gmail REST API e importa subito letture/bollette/PDF su Firestore senza attendere la coda GitHub Actions.

---

## 4. Schema Firestore & Regole di Sicurezza (`firestore.rules`)

**ATTENZIONE:** ogni collection in `firestore.rules` ha controlli rigidi con `hasAll([...])` e `hasOnly([...])` oltre ai range numerici e lunghezze stringa. Controlla sempre `firestore.rules` e `firebase-blueprint.json` prima di aggiungere un campo, e valida con `npx eslint firestore.rules`.

- `appMeta/owner` (`{ ownerUid, updatedAt }`): letta solo da autenticati; scritta solo se `ownerUid == request.auth.uid`.
- `appMeta/octopusTariff`: letta solo da autenticati; aggiornata via Admin SDK dal bot Python.
- `users/{userId}/energyReadings/{day_YYYYMMDD}`
  - Campi: `ownerId`, `date` (`YYYY-MM-DD`), `f1Kwh`..`f3Kwh` (`0..500`), `totalKwh` (`0..1500`), `peakKw` (`0..50`), `estimatedCostEur` (`0..1000`), `source` (`'e-distribuzione-csv' | 'e-distribuzione-api' | 'manuale'`), `notes?` (max 240), `createdAt` (`serverTimestamp()`).
- `users/{userId}/homeConfig/main`
- `users/{userId}/climateLogs/{logId}` (inclusi gli ID `auto_YYYYMMDD` dell'Autopilot Clima).
- `users/{userId}/electricityBills/{billId}`, `waterBills/{billId}`, `tariBills/{billId}`, `gsePayments/{paymentId}`.
- `users/{userId}/homeArticles/{articleId}`:
  - Oltre agli articoli di casa per stanza (`Cucina`, `Salone`, `Stanza Maurizio`, `Stanza Roberta`, ecc.), usa `room` di sistema speciali:
    - `__macchina__` -> Profilo Fiat Panda `EA218ES` (`car_profile_main`) + storico spese/manutenzioni (`src/utils/carGroceryStore.ts`)
    - `__spesa__` -> Catalogo prodotti alimentari e prezzi IN'S / MD / CONAD (`src/utils/carGroceryStore.ts`)
    - `__documenti__` -> Documenti utili casa (mutuo, Wi-Fi WindTre, contratti, ecc.) (`src/utils/documentVault.ts`)
    - `__clima_autopilot__` -> Stato attivo/spento e combinazione dell'Autopilot Clima (`climate_autopilot_main`, `src/utils/climateAutopilot.ts`)
    - `__migrazione__` -> Marker completamento migrazione dal vecchio DB (`db_migration_gen_lang_done`, `src/utils/legacyMigration.ts`)
- `users/{userId}/vaultFiles/{fileKey}` e `users/{userId}/vaultFileChunks/{fileKey}_chunk_{i}`:
  - Archiviazione binaria cross-device su Firestore in chunk Base64 (`<= 6 MB` per file, max 16 chunk da `600_000` caratteri) + cache locale IndexedDB (`myhome_vault_files_v1`).

---

## 5. Mappa Completa File & Componenti

- **Entry & Shell:**
  - `src/App.tsx`: auth, sottoscrizioni Firestore con fallback cache locale, migrazione one-click legacy DB, Autopilot Clima giornaliero automatico, stato sync Gmail, navigazione sidebar 9 sezioni.
  - `server.ts`: server Express porta 3000 (dev con `vite.middlewares`, prod serve `dist/`) + endpoint `/api/articles/search` e `/api/articles/manual`.
- **Viste Principali (`src/components/`):**
  - `OverviewView.tsx` (`panoramica`): KPI annuali, riepilogo FV/GSE e stato impianto.
  - `EnergyDatabaseView.tsx` (`consumi`): matrice annuale 12 mesi x 31 giorni + barre mensili + classifica combinazioni NeaSmart + Autopilot Clima (`ClimateAutopilotCard.tsx`) + dettaglio giornaliero con copia/incolla combinazioni (`Ctrl+C`/`Ctrl+V`, selezione multipla trascinando).
  - `DomoticsView.tsx` (`domotica`): impostazioni Ariston NET / Rehau Nea Smart 2.0, tariffa €/kWh, POD, log clima.
  - `BillsView.tsx` (`bollette`): bollette Luce (Edison), Acqua (Acegas), TARI, pagamenti GSE, monitor tariffe mercato; importazione PDF locale zero-crediti (`BillImportModal.tsx`), download PDF originale e condivisione (`ShareSheetModal.tsx`).
  - `ArticlesView.tsx` (`articoli`): inventario casa per stanze, ricerca online, schede e manuali esportabili (`src/utils/articleCatalog.ts`, `src/data/articlesSeed.ts`).
  - `DocumentsView.tsx` (`documenti`): archivio contratti e documenti utili (mutuo, Wi-Fi WindTre, polizze, bollette condivisibili), upload allegati fino a 6 MB su Firestore Vault, download e ShareSheet.
  - `CarView.tsx` (`macchina`): scheda Fiat Panda `EA218ES` (scadenze bollo/assicurazione/revisione/tagliando, km, interventi).
  - `GroceryView.tsx` (`spesa`): listino e confronto prezzi tra IN'S, MD, CONAD + lista spesa rapida (pre-popolato a zero crediti da `src/data/grocerySeed.ts` con sync automatico iniziale su Firestore).
  - `InfoGuideView.tsx` (`info`): guide pratiche Nea Smart 2.0, Ariston NET, VMC, e-distribuzione, flusso diretto GitHub Actions ➔ Firestore + pulsante download di questo file.
  - `AccessUnlockBanner.tsx` & `VaultCloudNotice.tsx`: banner informativo da sloggati e stato sincronizzazione Cloud PDF.
- **Script & Workflow:**
  - `scripts/sync_edistribuzione.py`: sync Gmail IMAP ➔ Firestore diretto (consumi, bollette Luce/Acqua/TARI + PDF Vault) via `firebase-admin`.
  - `scripts/check_octopus_tariff.py`: monitoraggio tariffe Octopus / mercato su `appMeta/octopusTariff` via `firebase-admin`.
  - `.github/workflows/sync-edistribuzione.yml` & `.github/workflows/deploy-pages.yml`.

---

## 6. Comandi di Verifica & Sviluppo

```bash
npm run dev                  # Avvia server Express + Vite HMR/dev su http://0.0.0.0:3000
npm run lint                 # Controllo TypeScript completo (tsc --noEmit)
npm run build                # Build produzione Vite in dist/
GITHUB_PAGES=true npm run build  # Build per GitHub Pages con base /my-home/
npx eslint firestore.rules   # Verifica sintassi e sicurezza di firestore.rules
```
