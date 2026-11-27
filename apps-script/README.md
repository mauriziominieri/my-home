# Google Apps Script — Deploy Automatico & Notifiche WhatsApp

Questa cartella collega il progetto Google Apps Script (`1Xv8LKzCxqu2n05njAGj9iMZLEETUD-uyUkaSkzThum6FmOStyTFiq5kh`) al deploy automatico tramite GitHub Actions (`.github/workflows/deploy-apps-script.yml`) usando `@google/clasp`.

## Setup una tantum

1. **Abilita l'API Google Apps Script:**
   - Vai su <https://script.google.com/home/usersettings> e attiva **Google Apps Script API**.

2. **Importa i file live esistenti prima di attivare il push automatico:**
   > Per evitare di sovrascrivere lo script 24/7 già presente su `script.google.com` (es. sync e-distribuzione / promemoria), importa prima i file esistenti nel repository:
   ```bash
   npx @google/clasp login
   cd apps-script
   npx @google/clasp pull
   ```
   Poi fai `git add apps-script/ && git commit -m "chore: import apps script" && git push`.

3. **Salva le credenziali su GitHub Secrets:**
   - Copia l'intero contenuto del file locale `~/.clasprc.json` generato da `clasp login`
   - Su GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Nome secret: `CLASPRC_JSON`

Da quel momento, ogni volta che modifichi e fai `git push` su `main` di un file dentro `apps-script/`, GitHub Actions esegue automaticamente `clasp push --force` sul progetto Apps Script.

## Notifiche WhatsApp (CallMeBot) + Sync Live Firestore per `checkMyHomeRemindersDaily`

`checkMyHomeRemindersDaily()` legge **direttamente da Firestore in tempo reale** tutti i promemoria (`__promemoria__`), la configurazione notifiche e i km/capacità batteria dell'auto (`__macchina__`). In questo modo qualsiasi modifica fatta da My Home (es. cambio di *"Avvisa quanti mesi prima"* da `3` a `1`, modifica durata, completamento, rinnovo o capacità batteria) entra subito in funzione senza dover toccare Apps Script.

Per motivi di sicurezza (questo repository è pubblico), **non inserire mai** numero di telefono e `apikey` CallMeBot dentro i file `.gs` del repository:

1. Apri il progetto su Google Apps Script → **Impostazioni progetto → Proprietà script** e aggiungi:
   - `CALLMEBOT_PHONE`: `393XXXXXXXXX` (solo cifre con prefisso)
   - `CALLMEBOT_API_KEY`: `<la tua apikey ricevuta da CallMeBot>`
   - `REMINDERS_EMAIL_TO` *(opzionale se salvata in Canali Avviso)*: `<la tua email>`
2. Sempre in **Impostazioni progetto**, abilita **Mostra file manifest "appsscript.json" nella barra laterale** e assicurati che `"oauthScopes"` includa:
   - `https://www.googleapis.com/auth/datastore` *(necessario per leggere in tempo reale i promemoria su Firestore)*
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/script.send_mail`
3. Dopo aver eseguito `clasp pull` la prima volta, integra il template `reminders.gs.template` in un file `.gs` (es. `reminders.gs`) oppure copia `checkMyHomeRemindersDaily()` direttamente dalla modale *Automazione 24/7* nella pagina **Promemoria** dell'app e imposta un attivatore giornaliero (es. 08:00–09:00).
