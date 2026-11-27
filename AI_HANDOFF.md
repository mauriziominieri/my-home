# my-home — Istruzioni Tecniche & Passaggio di Consegne AI

> **Ultimo aggiornamento manuale:** `27/11/2026`
> **Nota:** questo file `.md` **non si auto-genera** automaticamente a ogni modifica dell'app; va mantenuto manualmente quando cambiano architettura, flussi, componenti o API server.
> **Scopo di questo file:** fornire a qualsiasi AI (Claude, ChatGPT, Gemini, Cursor, ecc.) tutto il contesto architetturale, le regole di sicurezza, le scorciatoie anti-spreco e la mappa completa dei file del progetto **my-home**, così da riprendere lo sviluppo subito senza consumare crediti in esplorazioni inutili.

---

## 1. Regole Fondamentali (LEGGERE PRIMA DI TOCCARE QUALSIASI FILE)

1. **ZERO CREDITI AI SU CONSUMI & BOLLETTE PDF STANDARD:**
   - **NON leggere mai** eventuali file binari o PDF in `public/assets/` (protetti in `.aiignore`).
   - Il parsing dei CSV/ZIP e-distribuzione (`src/utils/edistribuzioneCsv.ts`) e delle bollette PDF Edison / Octopus / Acegas Acqua / TARI (`src/utils/billImporter.ts`) è **100% locale e deterministico** nel browser (`pdfjs-dist`, `jszip`, regex), a **0 crediti AI**.
   - **Smart Import Documenti:** `DocumentsView.tsx` prova sempre prima `extractPdfTextFromBytes` + `parseBillText` in locale (`0` chiamate server/AI); invoca `POST /api/documents/classify` (`server.ts`, modello `gemini-4-hydrogen` con fallback deterministico locale) solo per documenti generici, scansioni/immagini o PDF ambigui.
   - L'estrazione dettagli prodotto e manuali da link passa da `server.ts` (`/api/researches/extract`, `/api/researches/fetch-document`, `/api/documents/download`, `/api/documents/inspect-link`).

2. **PROGETTO FIREBASE UNIFICATO (`gen-lang-client-0721850501`):**
   - `src/firebase.ts` usa **un solo progetto Firebase principale** letto da `firebase-applet-config.json`:
     - `projectId`: `gen-lang-client-0721850501`
     - `firestoreDatabaseId`: `ai-studio-30a168e3-8158-474f-b9f2-f717d7220314`
     - Qui risiedono **Auth Google + Gmail OAuth (`connectGmailAccount()`) + tutti i dati Firestore + Vault PDF**.
   - `getLegacyMigrationFirebase()` in `src/firebase.ts` mantiene un'app lazy secondaria esclusivamente per la migrazione one-click dal vecchio database gestito (`spiritual-bearing-sq7xb`) via `src/utils/legacyMigration.ts`.
   - **VIETATO:** rimuovere `oAuthClientId` da `firebase-applet-config.json` o modificare `firestore.rules` senza aver verificato le autorizzazioni di deploy del progetto. In `src/firebase.ts` usa sempre i wrapper tracciati (`guardedSetDoc`, `guardedDeleteDoc`, `guardedWriteBatch`, `trackedGetDoc`, `trackedGetDocs`, `trackedOnSnapshot`).

3. **MODALITÀ TEST BROWSER & QUOTA FIRESTORE (`src/firebase.ts`, `SettingsView.tsx`):**
   - L'app supporta la **Modalità Test Browser (`firestoreWritesDisabled`)**: quando attiva, tutte le scritture/eliminazioni dati (prodotti, bollette, domotica, documenti, spesa, macchina, promemoria, Vinted, Vault) vengono simulate in locale con **0 scritture Firestore** e messe in coda (`localStorage`) con anteprima diff/dettagli e flush batch su conferma.
   - Le preferenze utente (`src/utils/appSettings.ts`, salvate in `users/{uid}/homeArticles/app_settings_state`) bypassano intenzionalmente il blocco Test Mode solo quando un valore cambia davvero (`1` scrittura Firestore, `0` letture).
   - Il tracker giornaliero in `src/firebase.ts` (`myhome_firestore_daily_usage_v1`, storico 30 giorni in `SettingsView.tsx`) registra scritture, eliminazioni, scritture impostazioni, letture reali (esclusa cache offline Firestore) e operazioni risparmiate in Modalità Test rispetto ai limiti giornalieri gratuiti Spark (`20.000` scritture+eliminazioni/giorno, `50.000` letture/giorno).

4. **LINGUA, TEMA & VINCOLI UI / AMBIENTE:**
   - L'interfaccia è interamente in **italiano**, supporta **Dark Mode** (predefinita) e **Light Mode** + 5 palette accento dinamiche CSS (`sky`, `amber`, `emerald`, `teal`, `indigo` in `src/index.css` via variabili `--brand-*`), più densità compatta/normale e sidebar espandibile.
   - **NON usare** `window.alert`, `window.confirm` o `window.open` (usa modali React custom o link/ancore `<a target="_blank" rel="noreferrer">`, es. `openVaultFileInNewTab`).
   - **NON cancellare** funzionalità esistenti né sostituire dati reali con dati finti.

---

## 2. Identità Casa, Utenze & Stack Tecnico

- **Repository GitHub:** `mauriziominieri/my-home`
- **URL Produzione (GitHub Pages):** `https://mauriziominieri.github.io/my-home/`
- **Proprietario:** `mauminieri@gmail.com` (`appMeta/owner` memorizza dinamicamente l'`ownerUid` su `gen-lang-client-0721850501`).
- **POD Luce:** `IT001E11251419` (6,0 kW impegnati; tariffa di riferimento Octopus Fissa 24M `0,1595 €/kWh` o config personalizzata in `homeConfig`).
- **Impianto Clima:** Pompa di calore / centrale **Ariston NET** + termostati di zona **Rehau Nea Smart 2.0** (zone: `salone`, `roberta`, `bagno1`, `matrimoniale`, `bagno2`, `maurizio`) + **VMC**.
- **Accoppiamento Riquadro Oggi ↔ Banner Autopilot (`src/App.tsx`):** modificare, aggiungere, incollare o eliminare sessioni NeaSmart nella data di oggi (`todayIso`) aggiorna automaticamente e atomicamente anche `CLIMATE_AUTOPILOT_DOC_ID` (`climate_autopilot_state`), mantenendo allineati il banner *Impianto Acceso* e la copia automatica giornaliera.
- **Veicolo principale:** Fiat Panda targa **`EA218ES`**.
- **Supermercati confrontati nella Spesa:** `IN'S`, `MD`, `CONAD`.
- **Stack:** React 19, TypeScript, Vite 8 (`base: '/my-home/'` quando `GITHUB_PAGES=true`), Express (`server.ts`, porta `3000`), `@google/genai` (solo server-side), Recharts, Lucide Icons, Firebase v13, `pdfjs-dist`, `jszip`.

---

## 3. Flusso Consumi & Bollette (Google Apps Script 24/7 + Sync Gmail Browser + Smart Import)

1. **Google Apps Script 24/7 (`apps-script/sync_consumi_edistribuzione.js` + `apps-script/notifiche_promemoria_giornaliere.js`):**
   - `sync_consumi_edistribuzione.js` (`syncMyHomeGmail24x7`) controlla ogni 10 minuti la INBOX Gmail per le curve di carico kWh **e-distribuzione** (`notifichemailped@enel.com` / `e-distribuzione`, oggetto `"Dettaglio curve di carico"`), salva `energyReadings` su Firestore e sposta nel Cestino solo quelle email già importate.
   - `notifiche_promemoria_giornaliere.js` (`checkMyHomeRemindersDaily`) controlla 1 volta al giorno i promemoria e le scadenze auto su Firestore inviando Email + WhatsApp.
2. **Sync Gmail Consumi & Bollette via GitHub Actions (`scripts/sync_gmail_consumi_e_bollette.py`, ogni 10 min via `.github/workflows/sync-gmail-consumi-bollette-tariffe.yml`):**
   - Oltre alle curve di carico e-distribuzione (cestinate dopo il salvataggio), scansiona la INBOX ogni 10 minuti per bollette **Luce** (Edison, Octopus, Enel, Plenitude, ENGIE), **Acqua** (AcegasApsAmga) e **TARI** in qualsiasi formato allegato (`.pdf`, `.zip`, `.csv`, `.xml` FatturaPA, `.txt`, `.html` o corpo email), **senza mai cestinare le email delle bollette**, archivia il PDF nel Vault e invia notifica immediata **Email + WhatsApp** per ogni nuova bolletta importata.
3. **Lettura nell'App React (`src/App.tsx`):**
   - Quando l'utente è autenticato (`user?.uid`), sottoscrive in tempo reale con `trackedOnSnapshot` tutte le subcollection sotto `users/{uid}/...` e `appMeta/octopusTariff`, salvando i dati in cache `localStorage` (`myhome_readings_cache_last`, ecc.) per consultazione offline/sloggata.
   - Supporta la migrazione one-click dal vecchio database (`spiritual-bearing-sq7xb`) via `src/utils/legacyMigration.ts`.
4. **Sync Gmail Istantaneo dal Browser (`src/utils/gmailSync.ts`):**
   - Pulsante **"Collega Gmail"** / **"Sincronizza Gmail"** visibile da loggati: scansiona la sola **INBOX** (mai Cestino/Spam) per estrarre bollette PDF **Edison/Octopus Luce**, **Acegas Acqua**, **TARI** e curve e-distribuzione, archiviando i PDF nel Vault Firestore e lasciando intatte in INBOX le email delle bollette.
5. **Monitoraggio Tariffe (`scripts/check_octopus_tariff.py`):**
   - Confronta i fornitori esterni con la tua offerta Octopus Fissa 24M (attiva dal 2027, 0,1595 €/kWh + 6 €/mese), salva su `appMeta/octopusTariff` (letto in `BillsView.tsx`) e invia Email + WhatsApp se un fornitore batte la tua offerta di almeno 5 €/anno.

---

## 4. Schema Firestore & Architettura `homeArticles` / `vaultFiles`

Tutte le subcollection principali sotto `users/{userId}/`:
- `appMeta/owner` & `appMeta/octopusTariff`
- `energyReadings/{day_YYYYMMDD}` (`ownerId`, `date`, `f1Kwh`..`f3Kwh`, `totalKwh`, `peakKw`, `estimatedCostEur`, `source`, `notes?`, `createdAt`)
- `homeConfig/main`
- `climateLogs/{logId}` (`auto_YYYYMMDD` per Autopilot Clima, `log_YYYYMMDD_*` per inserimenti manuali) + `vmcDays/{vmc_YYYYMMDD}`
- `electricityBills/{billId}`, `waterBills/{billId}`, `tariBills/{billId}`, `gsePayments/{paymentId}`
- `homeArticles/{articleId}`: collezione condivisa usata tramite `room` di sistema speciali:
  - `__macchina__` -> Profilo Fiat Panda `EA218ES` (`car_profile_main`), polizza (`car_policy_main`) e storico interventi (`src/utils/carGroceryStore.ts`)
  - `__spesa__` / `__spesa_meta__` -> Catalogo prodotti e prezzi `IN'S` / `MD` / `CONAD` (`src/utils/carGroceryStore.ts`)
  - `__documenti__` -> Archivio documenti casa + documenti collegati via `referenceCode` (`RES:...`, `AUTO:...`) (`src/utils/documentVault.ts`)
  - `__clima_auto__` -> Stato attivo/spento e combinazione di Autopilot Clima (`climate_autopilot_state`, `src/utils/climateAutopilot.ts`)
  - `__app_settings__` -> Preferenze tema/accento/UI/Test Mode sincronizzate su cloud (`app_settings_state`, `src/utils/appSettings.ts`)
  - `__migrazione__` -> Marker completamento migrazione dal vecchio DB (`db_migration_gen_lang_done`)
- `vaultFiles/{fileKey}` e `vaultFileChunks/{fileKey}_chunk_{i}`:
  - Archiviazione binaria cross-device su Firestore in chunk Base64 (`<= 6 MB` per file, chunk da `600_000` caratteri) + cache locale IndexedDB (`myhome_vault_files_v1`).

---

## 5. Mappa Completa File & Componenti

- **Entry & Shell:**
  - `src/App.tsx`: auth Google + Gmail, sottoscrizioni Firestore tracciate con cache locale, migrazione legacy DB, accoppiamento bidirezionale NeaSmart oggi ↔ Autopilot Clima, coda Test Mode, navigazione sidebar 10 sezioni.
  - `server.ts`: server Express porta `3000` (dev con `vite.middlewares`, prod serve `dist/`) + API `/api/researches/extract` (estrazione URL multi-piattaforma + varianti/immagini/documenti PDF), `/api/researches/fetch-document` (proxy download allegati/PDF con fallback TLS & Wayback), `/api/documents/inspect-link` (estrazione sicura metadati pagina web) e `/api/documents/classify` (classificazione automatica documenti/bollette e abbinamento prodotti con `gemini-4-hydrogen` + fallback deterministico).
- **Viste Principali (`src/components/`):**
  - `OverviewView.tsx` (`panoramica`): KPI annuali, riepilogo FV/GSE e stato impianto.
  - `EnergyDatabaseView.tsx` (`consumi`): matrice annuale 12 mesi × 31 giorni, grafici mensili, classifica combinazioni NeaSmart, `ClimateAutopilotCard.tsx`, copia/incolla e selezione multipla giornaliera.
  - `DomoticsView.tsx` (`domotica`): impostazioni Ariston NET / Rehau Nea Smart 2.0, tariffa €/kWh, POD, storico clima.
  - `BillsView.tsx` (`bollette`): vista **Elenco / Griglia**, bollette Luce (+ contratto Octopus), Acqua, TARI, bonifici GSE, monitor tariffe mercato; azioni allegati complete (**Apri in nuova scheda**, **Scarica**, **Condividi**, **Elimina**), import PDF locale zero-crediti (`BillImportModal.tsx`) e `ShareSheetModal.tsx`.
  - `ResearchesView.tsx` (`ricerche`, sezione UI **Prodotti**): gestione completa dei prodotti casa da URL (`extract` + varianti colore/taglia con foto dedicate, stanze, prezzi online e pagati, documenti/manuali collegati via file o link diretto, **Assicurazione Extra Family** attiva di default sui 4 elettrodomestici Electrolux/AEG in elenco con filtro rapido e toggle one-click, vista Elenco/Griglia).
  - `DocumentsView.tsx` (`documenti`): vista **Elenco / Griglia**, repository unificato di **tutti** i documenti dell'app (Documenti Casa, **Prodotti**, Macchina, Bollette Luce/Acqua/TARI e allegati GSE) con tab dedicata `Prodotti`, filtro per origine, azioni allegati (**Apri in nuova scheda**, **Scarica**, **Condividi**, **Modifica**, **Elimina**), **Importa Documenti (Auto)** e **Importa da Link** con riconoscimento automatico dei prodotti e sincronizzazione bidirezionale con `Bollette` e `Prodotti`.
  - `CarView.tsx` (`macchina`): scheda Fiat Panda `EA218ES`, parser polizza ConTe.it (`src/utils/carInsuranceParser.ts`), scadenze e manutenzioni.
  - `GroceryView.tsx` (`spesa`): listino e confronto prezzi tra `IN'S`, `MD`, `CONAD` + lista spesa rapida.
  - `SettingsView.tsx` (`impostazioni`): Modalità Test Browser (coda locale + flush batch), **Quota Giornaliera Firestore & Storico 30 giorni** (incluso conteggio scritture Impostazioni), tema Dark/Light, 5 colori accento, densità, sidebar, pagina iniziale, Gmail e backup JSON.
  - `InfoGuideView.tsx` (`info`): guide pratiche Nea Smart 2.0, Ariston NET, VMC, e-distribuzione e download di questo file `.md`.
  - `AccessUnlockBanner.tsx`, `AddReadingModal.tsx`, `ErrorBoundary.tsx`, `SortableHeader.tsx`, `VaultCloudNotice.tsx`.
- **Utilities (`src/utils/`):**
  - `appSettings.ts`, `billImporter.ts`, `carGroceryStore.ts`, `carInsuranceParser.ts`, `climateAutopilot.ts`, `climateTime.ts`, `documentVault.ts`, `edistribuzioneCsv.ts`, `gmailSync.ts`, `legacyMigration.ts`, `researchHelpers.ts`.
- **Script, Backend & Workflow nel repo:**
  - `render.yaml`: Render Blueprint (`my-home-backend`, `autoDeploy: true`, `/api/health`).
  - `apps-script/`: `sync_consumi_edistribuzione.js` (consumi kWh e-distribuzione ogni 10 min), `notifiche_promemoria_giornaliere.js` (promemoria/auto giornalieri Email + WhatsApp), `.clasp.json`, `.claspignore`, `README.md`.
  - `scripts/sync_gmail_consumi_e_bollette.py`: sync ogni 10 min da Gmail INBOX (consumi kWh + bollette multi-formato Luce/Acqua/TARI + avvisi Email/WhatsApp).
  - `scripts/check_octopus_tariff.py`: monitoraggio tariffe su `appMeta/octopusTariff` (confronto vs Octopus 2027 + avvisi Email/WhatsApp).
  - `.github/workflows/`: `deploy-pages.yml`, `deploy-render.yml`, `deploy-apps-script.yml`, `deploy-firestore-rules.yml`, `sync-gmail-consumi-bollette-tariffe.yml`.

---

## 6. Comandi di Verifica & Sviluppo

```bash
npm run dev                  # Avvia server Express + Vite su http://0.0.0.0:3000
npm run lint                 # Controllo TypeScript completo (tsc --noEmit)
npm run build                # Build produzione Vite in dist/
GITHUB_PAGES=true npm run build  # Build per GitHub Pages con base /my-home/
npx eslint firestore.rules   # Verifica sintassi e sicurezza di firestore.rules
```
