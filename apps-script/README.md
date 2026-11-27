# Google Apps Script (`apps-script/`) — Cosa contiene e a cosa serve

Questa cartella contiene gli script di **Google Apps Script** deployati automaticamente su `script.google.com` (`1Xv8LKzCxqu2n05njAGj9iMZLEETUD-uyUkaSkzThum6FmOStyTFiq5kh`) tramite GitHub Actions (`.github/workflows/deploy-apps-script.yml`) usando `@google/clasp`.

## File presenti nella cartella

1. **`sync_consumi_edistribuzione.js` — Consumi giornalieri kWh (`Dettaglio curve di carico`)**
   - Funzione principale: `syncMyHomeGmail24x7()` (attivata ogni **10 minuti** con `attivaControlloAutomatico()`).
   - Legge dalla INBOX di Gmail le email **Dettaglio curve di carico** inviate da `notifichemailped@enel.com` / `e-distribuzione.it` / `e-distribuzione.com` (allegati `.csv` o `.zip`).
   - Calcola le fasce `F1 / F2 / F3`, il totale giornaliero kWh e il picco kW, salva su Firestore (`energyReadings`) e **sposta nel Cestino solo quelle email già elaborate**.
   - **Nota:** le bollette **Luce, Acqua e TARI** (controllate ogni 10 minuti, **mai spostate nel Cestino**, con avviso Email + WhatsApp) e il monitoraggio **tariffe Octopus 2027 vs fornitori esterni** sono gestiti da GitHub Actions (`.github/workflows/sync-gmail-consumi-bollette-tariffe.yml` → `scripts/sync_gmail_consumi_e_bollette.py` e `scripts/check_octopus_tariff.py`).

2. **`notifiche_promemoria_giornaliere.js` — Promemoria scadenze & manutenzione auto**
   - Funzione principale: `checkMyHomeRemindersDaily()` (trigger giornaliero su Google Apps Script).
   - Legge in tempo reale da Firestore i promemoria (`__promemoria__`), i km e la batteria dell'auto (`__macchina__`) e invia avvisi via **Email** e **WhatsApp (CallMeBot)**.

## Setup una tantum

1. **Abilita Google Apps Script API** su <https://script.google.com/home/usersettings>.
2. **Secret GitHub per il deploy automatico:** salva il contenuto di `~/.clasprc.json` nel secret `CLASPRC_JSON`. Da quel momento ogni `git push` su `main` dentro `apps-script/` aggiorna automaticamente Google Apps Script via `clasp push --force`.
3. **Proprietà script su `script.google.com` → Impostazioni progetto → Proprietà script:**
   - `CALLMEBOT_PHONE`: numero con prefisso (es. `393XXXXXXXXX`)
   - `CALLMEBOT_API_KEY`: apikey CallMeBot
   - `REMINDERS_EMAIL_TO` *(opzionale se già salvata in app)*: la tua email
4. **Manifest `appsscript.json` ("oauthScopes"):**
   - `https://www.googleapis.com/auth/datastore`
   - `https://www.googleapis.com/auth/gmail.modify` (per `sync_consumi_edistribuzione.js`)
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/script.send_mail`
