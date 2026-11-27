/**
 * my-home — Lettura automatica CONSUMI GIORNALIERI kWh da Gmail (Google Apps Script 24/7)
 * File: apps-script/sync_consumi_edistribuzione.js
 *
 * COSA FA QUESTO SCRIPT:
 * - Controlla la sola INBOX di Gmail ogni 10 minuti (SYNC_INTERVAL_MINUTES = 10), 24/7 a PC spento.
 * - Legge ESCLUSIVAMENTE le email dei consumi elettrici giornalieri di e-distribuzione:
 *     • Oggetto: "Dettaglio curve di carico"
 *     • Mittenti: notifichemailped@enel.com, e-distribuzione.it, e-distribuzione.com
 *     • Allegati: file .csv o .zip con i quarti d'ora/ore (calcola F1, F2, F3, totale kWh e picco kW)
 * - Salva i nuovi consumi giornalieri su Firebase Firestore (collection `energyReadings`).
 * - Sposta nel Cestino SOLO le email "Dettaglio curve di carico" già importate con successo.
 *
 * COSA NON FA QUESTO SCRIPT (gestito dagli altri file):
 * - Bollette Luce / Acqua / TARI (PDF, CSV, XML, ZIP, corpo email) + avvisi Email/WhatsApp
 *   -> gestiti ogni 10 minuti da GitHub Actions: `scripts/sync_gmail_consumi_e_bollette.py`
 *      (workflow: `.github/workflows/sync-gmail-consumi-bollette-tariffe.yml`; le bollette NON vanno mai nel Cestino)
 * - Confronto tariffe luce fornitori esterni vs Octopus 2027
 *   -> gestito da: `scripts/check_octopus_tariff.py`
 * - Promemoria scadenze casa & manutenzione auto (Email/WhatsApp giornaliero)
 *   -> gestiti in questo stesso progetto Apps Script dal file: `notifiche_promemoria_giornaliere.js`
 *
 * CONVIENE LASCIARLI ENTRAMBI ATTIVI? SÌ (consigliato):
 * - Non vanno in conflitto e non creano duplicati: il primo che trova l'email e-distribuzione
 *   in INBOX salva i giorni mancanti e la sposta nel Cestino; l'altro al giro successivo non
 *   la trova più (o ignora le date <= ultima data su Firestore con 0 scritture).
 * - Apps Script è più puntuale ogni 10 minuti e usa Gmail nativamente (senza App Password);
 *   lo script Python su GitHub Actions funge da backup automatico per i kWh ed è comunque
 *   indispensabile perché è l'unico a importare le bollette (Luce, Acqua, TARI) e inviare
 *   i relativi avvisi Email/WhatsApp (su repo GitHub pubblico Actions è gratuito e illimitato).
 *
 * Come attivarlo una sola volta su https://script.google.com :
 * 1. Collega il progetto GCP numero 902318210670 (Impostazioni progetto -> Cambia progetto)
 *    oppure imposta la proprietà script `FIREBASE_SERVICE_ACCOUNT`.
 * 2. Verifica che `appsscript.json` includa gli scope Gmail + Datastore.
 * 3. Seleziona `attivaControlloAutomatico` in alto e clicca Esegui (accetta i permessi Google).
 */

const FIREBASE_PROJECT_ID = 'gen-lang-client-0721850501';
const FIRESTORE_DATABASE_ID = 'ai-studio-30a168e3-8158-474f-b9f2-f717d7220314';
const GCP_PROJECT_NUMBER = '902318210670';
const SYNC_INTERVAL_MINUTES = 10; // Valori supportati da Apps Script: 5, 10, 15, 30, 60
const DEFAULT_TARIFF_EUR_PER_KWH = 0.1595;
const HANDLER_FN_NAME = 'syncMyHomeGmail24x7';

const FIRESTORE_DOCS_BASE =
  'https://firestore.googleapis.com/v1/projects/' +
  FIREBASE_PROJECT_ID +
  '/databases/' +
  FIRESTORE_DATABASE_ID +
  '/documents';

/**
 * Esegui QUESTA funzione una sola volta per installare il controllo automatico 24/7.
 */
function attivaControlloAutomatico() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === HANDLER_FN_NAME) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  var builder = ScriptApp.newTrigger(HANDLER_FN_NAME).timeBased();
  if (SYNC_INTERVAL_MINUTES === 60) {
    builder.everyHours(1).create();
  } else {
    var allowed = [5, 10, 15, 30];
    var mins = allowed.indexOf(SYNC_INTERVAL_MINUTES) !== -1 ? SYNC_INTERVAL_MINUTES : 10;
    builder.everyMinutes(mins).create();
  }

  Logger.log(
    'Trigger 24/7 attivato: ' +
      HANDLER_FN_NAME +
      ' ogni ' +
      SYNC_INTERVAL_MINUTES +
      ' minuti.'
  );
  syncMyHomeGmail24x7();
}

/**
 * Disattiva il controllo automatico su Google Apps Script.
 */
function disattivaControlloAutomatico() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === HANDLER_FN_NAME) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  Logger.log('Rimossi ' + removed + ' trigger automatici.');
}

/**
 * Funzione principale eseguita automaticamente ogni tot minuti da Google.
 */
function syncMyHomeGmail24x7() {
  var token = getFirestoreAccessToken_();
  var ownerUid = resolveOwnerUid_(token);
  var tariff = resolveTariff_(token, ownerUid);
  var latestDbDate = resolveLatestReadingDate_(token, ownerUid);

  // Scansiona SOLO la INBOX (mai Cestino/Spam) per le email di curve di carico e-distribuzione
  var query =
    'in:inbox -in:trash -in:spam (from:notifichemailped@enel.com OR from:e-distribuzione.it OR from:e-distribuzione.com OR subject:"Dettaglio curve di carico")';
  var threads = GmailApp.search(query, 0, 20);
  if (!threads || threads.length === 0) {
    Logger.log('INBOX controllata: nessuna nuova email e-distribuzione trovata.');
    return;
  }

  var readingsByDate = {};
  var skippedExisting = 0;
  var messagesToTrash = [];

  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      if (!msg.isInInbox() || msg.isInTrash()) continue;

      var attachments = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      if (!attachments || attachments.length === 0) continue;

      var msgReadings = [];
      for (var a = 0; a < attachments.length; a++) {
        var att = attachments[a];
        var name = (att.getName() || '').toLowerCase();
        try {
          if (name.endsWith('.csv')) {
            var csvText = att.getDataAsString('UTF-8');
            msgReadings = msgReadings.concat(parseEDistribuzioneCsv_(csvText));
          } else if (name.endsWith('.zip')) {
            var unzipped = Utilities.unzip(att.copyBlob());
            for (var z = 0; z < unzipped.length; z++) {
              var entryName = (unzipped[z].getName() || '').toLowerCase();
              if (entryName.endsWith('.csv')) {
                msgReadings = msgReadings.concat(
                  parseEDistribuzioneCsv_(unzipped[z].getDataAsString('UTF-8'))
                );
              }
            }
          }
        } catch (err) {
          Logger.log('Allegato ignorato (' + name + '): ' + err);
        }
      }

      if (msgReadings.length > 0) {
        for (var r = 0; r < msgReadings.length; r++) {
          var item = msgReadings[r];
          if (latestDbDate && item.date <= latestDbDate) {
            skippedExisting++;
            continue;
          }
          readingsByDate[item.date] = item;
        }
        messagesToTrash.push(msg);
      }
    }
  }

  var dates = Object.keys(readingsByDate).sort();
  if (dates.length > 0) {
    var docs = [];
    for (var i = 0; i < dates.length; i++) {
      docs.push(readingsByDate[dates[i]]);
    }
    writeReadingsBatch_(token, ownerUid, tariff, docs);
    Logger.log('Salvate ' + docs.length + ' nuove giornate su Firestore.');
  } else if (skippedExisting > 0) {
    Logger.log(
      'Nessun nuovo consumo dopo il ' +
        latestDbDate +
        ' (ignorate ' +
        skippedExisting +
        ' righe già presenti).'
    );
  }

  // Sposta nel Cestino solo le email CSV/ZIP e-distribuzione già elaborate (le bollette restano sempre in INBOX)
  for (var k = 0; k < messagesToTrash.length; k++) {
    messagesToTrash[k].moveToTrash();
  }
}

function getFirestoreAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var saRaw = props.getProperty('FIREBASE_SERVICE_ACCOUNT');
  if (saRaw && saRaw.trim()) {
    return getServiceAccountAccessToken_(JSON.parse(saRaw));
  }
  return ScriptApp.getOAuthToken();
}

function getServiceAccountAccessToken_(sa) {
  var now = Math.floor(Date.now() / 1000);
  var header = Utilities.base64EncodeWebSafe(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' })
  ).replace(/=+$/, '');
  var claim = Utilities.base64EncodeWebSafe(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  ).replace(/=+$/, '');
  var sigBytes = Utilities.computeRsaSha256Signature(header + '.' + claim, sa.private_key);
  var sig = Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/, '');
  var jwt = header + '.' + claim + '.' + sig;

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });
  var json = JSON.parse(res.getContentText());
  if (!json.access_token) {
    throw new Error('Errore token Service Account: ' + res.getContentText());
  }
  return json.access_token;
}

function firestoreRequest_(method, url, token, payload) {
  var opts = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
    },
    muteHttpExceptions: true,
  };
  if (payload !== undefined && payload !== null) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code >= 200 && code < 300) {
    return body ? JSON.parse(body) : {};
  }
  if (code === 404) return null;
  if (code === 403 && body.indexOf('has not been used in project') !== -1) {
    throw new Error(
      'Collega questo script al progetto GCP numero ' +
        GCP_PROJECT_NUMBER +
        ' (Impostazioni progetto -> Progetto Google Cloud Platform -> Cambia progetto -> ' +
        GCP_PROJECT_NUMBER +
        ') oppure imposta FIREBASE_SERVICE_ACCOUNT nelle Proprietà script.'
    );
  }
  throw new Error('Firestore HTTP ' + code + ': ' + body.slice(0, 300));
}

function resolveOwnerUid_(token) {
  var customUid = PropertiesService.getScriptProperties().getProperty('OWNER_UID');
  if (customUid && customUid.trim()) return customUid.trim();

  var meta = firestoreRequest_('get', FIRESTORE_DOCS_BASE + '/appMeta/owner', token);
  if (meta && meta.fields && meta.fields.ownerUid && meta.fields.ownerUid.stringValue) {
    return meta.fields.ownerUid.stringValue;
  }
  throw new Error(
    'appMeta/owner non trovato su Firestore: accedi almeno una volta all’app web con il tuo account Google.'
  );
}

function resolveTariff_(token, ownerUid) {
  var cfg = firestoreRequest_(
    'get',
    FIRESTORE_DOCS_BASE + '/users/' + encodeURIComponent(ownerUid) + '/homeConfig/main',
    token
  );
  if (cfg && cfg.fields && cfg.fields.tariffEurPerKwh) {
    var raw =
      cfg.fields.tariffEurPerKwh.doubleValue !== undefined
        ? Number(cfg.fields.tariffEurPerKwh.doubleValue)
        : Number(cfg.fields.tariffEurPerKwh.integerValue);
    if (isFinite(raw) && raw >= 0.05 && raw <= 2.0) return raw;
  }
  return DEFAULT_TARIFF_EUR_PER_KWH;
}

function resolveLatestReadingDate_(token, ownerUid) {
  var rows = firestoreRequest_(
    'post',
    FIRESTORE_DOCS_BASE + '/users/' + encodeURIComponent(ownerUid) + ':runQuery',
    token,
    {
      structuredQuery: {
        from: [{ collectionId: 'energyReadings' }],
        orderBy: [{ field: { fieldPath: 'date' }, direction: 'DESCENDING' }],
        limit: 1,
      },
    }
  );
  if (rows && rows.length > 0 && rows[0].document && rows[0].document.fields && rows[0].document.fields.date) {
    return rows[0].document.fields.date.stringValue || null;
  }
  return null;
}

function writeReadingsBatch_(token, ownerUid, tariff, items) {
  var docPrefix =
    'projects/' +
    FIREBASE_PROJECT_ID +
    '/databases/' +
    FIRESTORE_DATABASE_ID +
    '/documents/users/' +
    ownerUid +
    '/energyReadings/';

  for (var start = 0; start < items.length; start += 250) {
    var chunk = items.slice(start, start + 250);
    var writes = [];
    for (var i = 0; i < chunk.length; i++) {
      var r = chunk[i];
      var docId = 'day_' + r.date.replace(/-/g, '');
      var estCost = Math.round(r.totalKwh * tariff * 100) / 100;
      writes.push({
        update: {
          name: docPrefix + docId,
          fields: {
            ownerId: { stringValue: ownerUid },
            date: { stringValue: r.date },
            f1Kwh: { doubleValue: r.f1Kwh },
            f2Kwh: { doubleValue: r.f2Kwh },
            f3Kwh: { doubleValue: r.f3Kwh },
            totalKwh: { doubleValue: r.totalKwh },
            peakKw: { doubleValue: r.peakKw },
            estimatedCostEur: { doubleValue: estCost },
            source: { stringValue: 'e-distribuzione-api' },
          },
        },
        updateTransforms: [
          {
            fieldPath: 'createdAt',
            setToServerValue: 'REQUEST_TIME',
          },
        ],
      });
    }
    firestoreRequest_('post', FIRESTORE_DOCS_BASE + ':commit', token, { writes: writes });
  }
}

function parseItFloat_(raw) {
  if (!raw) return 0;
  var cleaned = String(raw).trim().replace(/"/g, '').replace(/\s+/g, '').replace(',', '.');
  var val = Number(cleaned);
  return isFinite(val) && val >= 0 ? val : 0;
}

function normalizeDate_(raw, preferMdy) {
  if (!raw) return null;
  var cleaned = String(raw).trim().replace(/"/g, '').split(' ')[0];
  var todayIso = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');

  function validIso(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return null;
    }
    var iso =
      String(y) +
      '-' +
      (m < 10 ? '0' + m : String(m)) +
      '-' +
      (d < 10 ? '0' + d : String(d));
    return iso <= todayIso ? iso : null;
  }

  var m = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    var p1 = Number(m[1]);
    var p2 = Number(m[2]);
    var y = Number(m[3]);
    return preferMdy
      ? validIso(y, p1, p2) || validIso(y, p2, p1)
      : validIso(y, p2, p1) || validIso(y, p1, p2);
  }

  m = cleaned.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));

  return null;
}

function getAreraBand_(isoDate, hour) {
  var parts = isoDate.split('-');
  var dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  var weekday = dt.getUTCDay(); // 0=Dom, 6=Sab
  if (weekday === 0) return 'F3';
  if (weekday === 6) return hour >= 7 && hour < 23 ? 'F2' : 'F3';
  if (hour >= 8 && hour < 19) return 'F1';
  if ((hour >= 7 && hour < 8) || (hour >= 19 && hour < 23)) return 'F2';
  return 'F3';
}

function parseEDistribuzioneCsv_(text) {
  var clean = String(text || '').replace(/^\uFEFF/, '');
  var lines = clean
    .split(/\r?\n/)
    .map(function (ln) {
      return ln.trim();
    })
    .filter(Boolean);
  if (lines.length < 2) return [];

  var delimiter = lines[0].split(';').length >= lines[0].split(',').length ? ';' : ',';
  for (var li = 0; li < Math.min(10, lines.length); li++) {
    if (lines[li].split(';').length >= 11) {
      delimiter = ';';
      break;
    }
  }

  var rows = Utilities.parseCsv(lines.join('\n'), delimiter);
  var mdyVotes = 0;
  var dmyVotes = 0;
  for (var ri = 0; ri < rows.length; ri++) {
    for (var ci = 0; ci < Math.min(3, rows[ri].length); ci++) {
      var cell = String(rows[ri][ci] || '').trim().replace(/"/g, '').split(' ')[0];
      var dm = cell.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (dm) {
        var a = Number(dm[1]);
        var b = Number(dm[2]);
        if (a > 12) dmyVotes++;
        else if (b > 12) mdyVotes++;
      }
    }
  }
  var preferMdy = mdyVotes > dmyVotes;

  var out = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row || row.length < 2) continue;

    var dateIdx = -1;
    var iso = null;
    for (var c = 0; c < Math.min(3, row.length); c++) {
      var cand = normalizeDate_(row[c], preferMdy);
      if (cand) {
        dateIdx = c;
        iso = cand;
        break;
      }
    }
    if (!iso || dateIdx === -1) continue;

    var valueCells = row.slice(dateIdx + 1);
    if (valueCells.length >= 24) {
      var isHourly = valueCells.length < 48;
      var f1 = 0;
      var f2 = 0;
      var f3 = 0;
      var maxSlot = 0;
      var limit = Math.min(96, valueCells.length);

      for (var s = 0; s < limit; s++) {
        var val = parseItFloat_(valueCells[s]);
        if (val > maxSlot) maxSlot = val;
        var hour = isHourly ? s : Math.min(23, Math.floor(s / 4));
        var band = getAreraBand_(iso, hour);
        if (band === 'F1') f1 += val;
        else if (band === 'F2') f2 += val;
        else f3 += val;
      }

      f1 = Math.round(f1 * 100) / 100;
      f2 = Math.round(f2 * 100) / 100;
      f3 = Math.round(f3 * 100) / 100;
      var tot = Math.round((f1 + f2 + f3) * 100) / 100;
      var peakKw = Math.round(Math.min(6.0, isHourly ? maxSlot : maxSlot * 4.0) * 100) / 100;
      out.push({
        date: iso,
        f1Kwh: f1,
        f2Kwh: f2,
        f3Kwh: f3,
        totalKwh: tot,
        peakKw: peakKw,
      });
    } else {
      var nums = [];
      for (var v = 0; v < valueCells.length; v++) {
        if (String(valueCells[v] || '').trim()) {
          nums.push(parseItFloat_(valueCells[v]));
        }
      }
      if (nums.length === 0) continue;
      var cf1 = nums.length >= 3 ? Math.round(nums[0] * 100) / 100 : 0;
      var cf2 = nums.length >= 3 ? Math.round(nums[1] * 100) / 100 : 0;
      var cf3 = nums.length >= 3 ? Math.round(nums[2] * 100) / 100 : Math.round(nums[0] * 100) / 100;
      out.push({
        date: iso,
        f1Kwh: cf1,
        f2Kwh: cf2,
        f3Kwh: cf3,
        totalKwh: Math.round((cf1 + cf2 + cf3) * 100) / 100,
        peakKw: 0,
      });
    }
  }
  return out;
}
