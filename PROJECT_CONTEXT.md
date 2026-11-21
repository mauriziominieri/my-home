# My Home — Contesto Progetto per Chat Future

- **Proprietario:** Maurizio Minieri (`mauminieri@gmail.com`)
- **Firebase UID:** `rXdhFrSuqzaYf8SYVbmQulPqg7m1` (dashboard visibile in sola lettura senza login; modifiche solo con login Google verificato)
- **Firestore DB:** `ai-studio-30a168e3-8158-474f-b9f2-f717d7220314` (`projectId`: `spiritual-bearing-sq7xb`)
- **Sito GitHub Pages:** `https://mauriziominieri.github.io/my-home/` (deploy automatico dal branch `main` via `.github/workflows/deploy-pages.yml`)
- **POD Luce:** `IT001E11251419` · Potenza impegnata `6 kW`

## Collezioni Firestore (`/users/{userId}/...`)
- `energyReadings` — Letture giornaliere F1/F2/F3 e picchi kW da CSV e-distribuzione
- `homeConfig/main` — Configurazione Ariston + Nea Smart 2.0 + POD
- `climateLogs` — Accensioni giornaliere riscaldamento/raffrescamento Nea Smart 2.0
- `electricityBills` — Bollette elettriche reali (Edison Energia + future Octopus)
- `waterBills` — Bollette idriche reali AcegasApsAmga (Contratto `3040787553`, Cliente `1014119052`)
- `tariBills` — Avvisi TARI AcegasApsAmga (estratti da Gmail `tassa_rifiuti@acegasapsamga.it` o manuali)
- `gsePayments` — Accrediti/bonifici GSE Scambio sul Posto (FV Huawei `SUN2000-4KTL-L1`)
- `homeArticles` — Inventario articoli ed elettrodomestici di casa (inclusa Garanzia Family scad. `07/03/2027`)

## Automazioni GitHub Actions (`.github/workflows/sync-edistribuzione.yml`, ogni 15 min)
1. `scripts/sync_edistribuzione.py`: estrae CSV curve di carico e-distribuzione (anche dal cestino Gmail `[Gmail]/Cestino` / `[Gmail]/Trash`), bollette PDF Edison e avvisi PDF TARI (`tassa_rifiuti@acegasapsamga.it`) da Gmail → aggiorna `data/consumi.json` e `data/bollette.json` (senza mai eliminare le email delle fatture).
2. `scripts/check_octopus_tariff.py`: confronta Octopus Fissa 24M (`0,1595 €/kWh`, fisso `6 €/mese`) con Octopus attuale e principali fornitori italiani (Eni Plenitude, E.ON, NeN, Sorgenia, Enel); invia email solo se un'offerta fa risparmiare >= 5 €/anno (`data/octopus_tariff.json`).

## Regole di Lavoro / Preferenze UI
- **Lingua risposte:** Italiano, sintetiche e chiare.
- **File/PDF allegati in chat:** estrarre i dati reali, aggiornare le collezioni/seed Firestore (`src/data/billsSeed.ts` / `data/bollette.json`), e **eliminare sempre i file PDF allegati** dal workspace per mantenere il progetto leggero.
- **Sezione Bollette (`BillsView.tsx`):** Luce, Acqua, TARI, Fotovoltaico & GSE SSP con indicazione esplicita Gmail vs caricamento manuale in Firestore.
- **Mappa Annuale (`EnergyDatabaseView.tsx`):** evidenziazione bidirezionale riga Classifica <-> giorni Mappa Annuale, riga speciale `OFF · Spento` con nota MVC 20–30 agosto, zoom regolabile, stato live acceso/spento.
- **App di casa (`InfoGuideView.tsx`):** Rehau Nea Smart 2.0 (guida dettagliata simboli, impostazioni `-2 K` e grafico Diagnosi), Ariston NET, e-distribuzione (contatore 6 kW).
