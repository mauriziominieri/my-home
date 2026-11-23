# my-home — Istruzioni Tecniche & Passaggio di Consegne AI

> **Scopo di questo file:** fornire a qualsiasi AI (Claude, ChatGPT, Gemini, Cursor, ecc.) tutto il contesto architetturale, le regole di sicurezza, le scorciatoie anti-spreco e la mappa dei file del progetto **my-home**, così da poter riprendere lo sviluppo subito senza consumare crediti in analisi esplorative inutili.

---

## 1. Regole Fondamentali (LEGGERE PRIMA DI TOCCARE QUALSIASI FILE)

1. **ZERO CREDITI AI SU CONSUMI, BOLLETTE E PDF:**
   - **NON leggere mai** `data/consumi.json` né `data/bollette.json` né i PDF in `public/assets/aistudio/` (sono protetti in `.aiignore`).
   - **NON usare mai** chiamate a LLM / Gemini API per parsare CSV e-distribuzione, bollette Edison/Acegas/TARI o allegati PDF. Il parsing è al 100% locale e deterministico lato browser (`pdfjs-dist`, `jszip`, regex) e lato Python (`scripts/sync_edistribuzione.py`).
   - L'unico uso opzionale dell'API Gemini riguarda la ricerca articoli in `server.ts` (`/api/articles/search` e `/api/articles/manual`), che ha già un fallback gratuito automatico su Wikidata / Wikipedia / link produttore in caso di quota `429` o assenza di `GEMINI_API_KEY`.

2. **DOPPIA CONFIGURAZIONE FIREBASE (NON UNIFICARE E NON ROMPERE MAI):**
   - `src/firebase.ts` usa **due app Firebase distinte**:
     1. **App Primaria (`FIRESTORE_CONFIG`):**
        - `projectId`: `spiritual-bearing-sq7xb`
        - `firestoreDatabaseId`: `ai-studio-30a168e3-8158-474f-b9f2-f717d7220314`
        - Qui risiedono **tutti i dati Firestore** e il login Google principale del proprietario (`mauminieri@gmail.com`, `PUBLIC_OWNER_UID = 'rXdhFrSuqzaYf8SYVbmQulPqg7m1'`).
     2. **App Secondaria (`gmailOAuthApp`, importata da `firebase-applet-config.json`):**
        - `projectId`: `gen-lang-client-0721850501`
        - Usata **esclusivamente** da `connectGmailAccount()` per richiedere lo scope OAuth `https://www.googleapis.com/auth/gmail.modify` (token tenuto **solo in RAM**, mai salvato in `localStorage` o `sessionStorage`).
   - **VIETATO:** modificare `firebase-applet-config.json`, cambiare i `projectId`/`firestoreDatabaseId` in `src/firebase.ts`, o lanciare deploy automatici su progetti sbagliati (`deploy_firebase` punterebbe al progetto OAuth invece che a `spiritual-bearing-sq7xb`).
   - Le modifiche a `firestore.rules` vanno applicate manualmente nella Console Firebase del progetto `spiritual-bearing-sq7xb` (database `ai-studio-30a168e3-8158-474f-b9f2-f717d7220314`).

3. **LINGUA, VINCOLI UI & AMBIENTE:**
   - L'interfaccia è interamente in **italiano**, tema dark (`slate-950` / `slate-900` / accenti `sky` / `emerald` / `amber`), Tailwind CSS v4 (`@import "tailwindcss";` in `src/index.css`).
   - **NON usare** `window.alert`, `window.confirm` o `window.open` (l'app può girare in iframe; usa modali React custom o link `<a target="_blank">`).
   - **NON cancellare** funzionalità esistenti né sostituire dati reali con dati finti.

---

## 2. Identità Casa, Utenze & Stack Tecnico

- **Repository GitHub:** `mauriziominieri/my-home`
- **URL Produzione (GitHub Pages):** `https://mauriziominieri.github.io/my-home/`
- **Owner UID:** `rXdhFrSuqzaYf8SYVbmQulPqg7m1` (`mauminieri@gmail.com`)
- **POD Luce:** `IT001E11251419` (6,0 kW impegnati; tariffa di riferimento Octopus Fissa 24M `0,1595 €/kWh` o config personalizzata in `homeConfig`).
- **Impianto Clima:** Pompa di calore / centrale **Ariston NET** + termostati di zona **Rehau Nea Smart 2.0** (zone: `salone`, `roberta`, `bagno1`, `matrimoniale`, `bagno2`, `maurizio`) + **VMC**.
- **Veicolo principale:** Fiat Panda targa **`EA218ES`**.
- **Supermercati confrontati nella Spesa:** `IN'S`, `MD`, `CONAD`.
- **Stack:** React 19, TypeScript, Vite 8 (`base: '/my-home/'` quando `GITHUB_PAGES=true`), Express (`server.ts`, porta `3000`), Recharts, Lucide Icons, Firebase v13, `pdfjs-dist`, `jszip`.

---

## 3. Flusso Consumi & Bollette (GitHub Actions + `data/consumi.json` + Firestore)

### Perché questo flusso esiste e come funziona:
1. **GitHub Actions 24/7 (`.github/workflows/sync-edistribuzione.yml`):**
   - Schedulato ogni 10 minuti (`cron: '*/10 * * * *'`, con tempi reali di **~10–30 minuti** in base alla coda dei runner gratuiti GitHub) o avviabile manualmente (`workflow_dispatch`) tramite `scripts/sync_edistribuzione.py`.
   - Usa IMAP Gmail (`secrets.GMAIL_USER` + `secrets.GMAIL_APP_PASSWORD`) leggendo **solo la INBOX** (ignorando il Cestino).
   - Estrae CSV/ZIP di e-distribuzione ("Dettaglio curve di carico"), bollette PDF Edison e avvisi TARI Acegas, aggiorna `data/consumi.json` e `data/bollette.json` sul branch `main` e sposta nel Cestino solo le email elaborate con successo.
   - *Nota importante su GitHub Actions:* GitHub sospende automaticamente i workflow `schedule` dopo 60 giorni senza commit umani sul repository, e i push fatti con `GITHUB_TOKEN` **non** innescano altri workflow `on: push` (come `deploy-pages.yml`).
   - *Come riattivarlo se appare fermo su GitHub:* Tab **Actions → Sync automatico e-distribuzione (da Gmail) → Enable workflow / Run workflow**.
2. **Lettura nell'App React (`src/App.tsx`):**
   - `fetchJsonWithFallback` carica `data/consumi.json` e `data/bollette.json` in quest'ordine:
     1. `./data/<file>` (se presente nel bundle locale/deploy)
     2. `https://raw.githubusercontent.com/mauriziominieri/my-home/main/data/<file>?v=...` *(sempre aggiornato in tempo reale appena il bot fa push su `main`, senza attendere GitHub Pages!)*
     3. `https://mauriziominieri.github.io/my-home/data/<file>?v=...`
   - `readings` è calcolato come **unione dinamica (`useMemo`)** tra `githubReadings` e `firestoreReadings`: i dati del JSON GitHub sono visibili subito anche da non loggati e non vengono mai sovrascritti da snapshot parziali.
   - Quando il proprietario è autenticato (`user.uid === activeUid`), l'app controlla i giorni di `githubReadings` assenti su Firestore e li salva automaticamente in batch da <= 400 rispettando tutti i limiti di `firestore.rules` (con pulsante manuale **"Aggiorna consumi.json"** nella pagina Consumi Annuali).
3. **Sync Gmail dal Browser (`src/utils/gmailSync.ts`):**
   - Pulsante unico nella barra in alto (**"Collega Gmail"** / **"Sincronizza Gmail"**) visibile quando loggati: scansiona la INBOX via Gmail REST API, importa subito letture/bollette (incluse bollette Acqua Acegas), archivia gli allegati PDF direttamente su Firestore (a zero crediti AI) e chiede conferma modale prima di spostare nel Cestino.

---

## 4. Schema Firestore & Regole di Sicurezza (`firestore.rules`)

**ATTENZIONE:** ogni collection in `firestore.rules` ha controlli rigidi con `hasAll([...])` e `hasOnly([...])` oltre ai range numerici e lunghezze stringa. Controlla sempre `firestore.rules` e `firebase-blueprint.json` prima di aggiungere un campo!

- `users/{userId}/energyReadings/{day_YYYYMMDD}`
  - Campi: `ownerId`, `date` (`YYYY-MM-DD`), `f1Kwh`..`f3Kwh` (`0..500`), `totalKwh` (`0..1500`), `peakKw` (`0..50`), `estimatedCostEur` (`0..1000`), `source` (`'e-distribuzione-csv' | 'e-distribuzione-api' | 'manuale'`), `notes?` (max 240), `createdAt` (`serverTimestamp()`).
- `users/{userId}/homeConfig/main`
- `users/{userId}/climateLogs/{logId}` (inclusi gli ID `auto_YYYYMMDD` dell'Autopilot Clima).
- `users/{userId}/electricityBills/{billId}`, `waterBills/{billId}`, `tariBills/{billId}`, `gsePayments/{paymentId}`.
- `users/{userId}/homeArticles/{articleId}`:
  - Oltre agli articoli di casa per stanza (`Cucina`, `Salone`, `Stanza Maurizio`, `Stanza Roberta`, ecc.), usa `room` di sistema speciali per memorizzare senza nuove collection:
    - `__macchina__` -> Profilo Fiat Panda `EA218ES` (`car_profile_main`) + storico spese/manutenzioni (`src/utils/carGroceryStore.ts`)
    - `__spesa__` -> Catalogo prodotti alimentari e prezzi IN'S / MD / CONAD (`src/utils/carGroceryStore.ts`)
    - `__documenti__` -> Documenti utili casa (mutuo, Wi-Fi WindTre, contratti, ecc.) (`src/utils/documentVault.ts`)
    - `__clima_autopilot__` -> Stato attivo/spento e combinazione dell'Autopilot Clima (`climate_autopilot_main`, `src/utils/climateAutopilot.ts`)
- `users/{userId}/vaultFiles/{fileKey}` e `users/{userId}/vaultFileChunks/{fileKey}_chunk_{i}`:
  - Archiviazione binaria cross-device su Firestore in chunk Base64 (`<= 6 MB` per file, max 16 chunk da `600_000` caratteri) + cache locale IndexedDB (`myhome_vault_files_v1`). Non ci sono PDF statici committati in `public/assets/` per motivi di privacy.
  - Nota sicurezza: `vaultFiles` e `vaultFileChunks` sono accessibili **solo al proprietario autenticato** (`isOwner(userId)`), mai ai visitatori anonimi.

---

## 5. Mappa Completa File & Componenti

- **Entry & Shell:**
  - `src/App.tsx`: auth, sottoscrizioni Firestore con fallback cache offline/quota, riconciliazione `data/consumi.json` + `data/bollette.json`, Autopilot Clima giornaliero automatico, stato sync Gmail, navigazione sidebar 9 sezioni.
  - `server.ts`: server Express porta 3000 (dev con `vite.middlewares`, prod serve `dist/`) + endpoint `/api/articles/search` e `/api/articles/manual`.
- **Viste Principali (`src/components/`):**
  - `OverviewView.tsx` (`panoramica`): KPI annuali, riepilogo FV/GSE e stato impianto.
  - `EnergyDatabaseView.tsx` (`consumi`): matrice annuale 12 mesi x 31 giorni + barre mensili + classifica combinazioni NeaSmart + Autopilot Clima (`ClimateAutopilotCard.tsx`) + dettaglio giornaliero con copia/incolla combinazioni (`Ctrl+C`/`Ctrl+V`, selezione multipla trascinando).
  - `DomoticsView.tsx` (`domotica`): impostazioni Ariston NET / Rehau Nea Smart 2.0, tariffa €/kWh, POD, log clima.
  - `BillsView.tsx` (`bollette`): bollette Luce (Edison), Acqua (Acegas), TARI, pagamenti GSE; importazione PDF locale zero-crediti (`BillImportModal.tsx`), download PDF originale e condivisione (`ShareSheetModal.tsx`).
  - `ArticlesView.tsx` (`articoli`): inventario casa per stanze, ricerca online, schede e manuali esportabili (`src/utils/articleCatalog.ts`, `src/data/articlesSeed.ts`).
  - `DocumentsView.tsx` (`documenti`): archivio contratti e documenti utili (mutuo, Wi-Fi WindTre, polizze, bollette condivisibili), upload allegati fino a 6 MB su Firestore Vault, download e ShareSheet.
  - `CarView.tsx` (`macchina`): scheda Fiat Panda `EA218ES` (scadenze bollo/assicurazione/revisione/tagliando, km, interventi).
  - `GroceryView.tsx` (`spesa`): listino e confronto prezzi tra IN'S, MD, CONAD + lista spesa rapida (pre-popolato a zero crediti da `src/data/grocerySeed.ts` con sync automatico iniziale su Firestore).
  - `InfoGuideView.tsx` (`info`): guide pratiche Nea Smart 2.0, Ariston NET, VMC, e-distribuzione, flusso GitHub Actions + pulsante download di questo file.
  - `AccessUnlockBanner.tsx` & `VaultCloudNotice.tsx`: banner "Sola Lettura" mostrato solo da sloggati su cosa sblocca Google / Gmail, e stato sincronizzazione Cloud PDF.
- **Script & Workflow:**
  - `scripts/sync_edistribuzione.py`: sync Gmail IMAP ➔ `data/consumi.json` + `data/bollette.json` (e Firestore opzionale se presente `FIREBASE_ID_TOKEN`).
  - `scripts/check_octopus_tariff.py`: monitoraggio tariffe Octopus / mercato in `data/octopus_tariff.json`.
  - `.github/workflows/sync-edistribuzione.yml`, `.github/workflows/deploy-pages.yml` & `.github/workflows/protect-data.yml` (ripristino automatico di `data/consumi.json` e `data/bollette.json` se rimossi per errore durante un push da export).

---

## 6. Comandi di Verifica & Sviluppo

```bash
npm run dev                  # Avvia server Express + Vite HMR/dev su http://0.0.0.0:3000
npm run lint                 # Controllo TypeScript completo (tsc --noEmit)
npm run build                # Build produzione Vite in dist/
GITHUB_PAGES=true npm run build  # Build per GitHub Pages con base /my-home/
npx eslint firestore.rules   # Verifica sintassi e sicurezza di firestore.rules
```
