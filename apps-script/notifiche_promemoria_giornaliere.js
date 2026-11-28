/**
 * my-home — Notifiche Giornaliere Promemoria & Manutenzione Auto (Google Apps Script 24/7)
 * File: apps-script/notifiche_promemoria_giornaliere.js
 *
 * COSA FA QUESTO SCRIPT:
 * - Viene eseguito 1 volta al giorno su Google Apps Script tramite trigger su `checkMyHomeRemindersDaily`.
 * - LEGGE LIVE da Firestore (`gen-lang-client-0721850501`) tutti i promemoria (`__promemoria__`),
 *   i km/capacità batteria auto (`__macchina__`) e i canali salvati (`rem_notify_config`).
 * - Qualsiasi modifica fatta nell'app (es. anticipo avviso, durata, completamento, rinnovo)
 *   si riflette AUTOMATICAMENTE senza dover modificare questo script.
 * - Invia avvisi via Email e WhatsApp (CallMeBot) per le scadenze imminenti o scadute.
 *
 * ALTRI SCRIPT DEL PROGETTO:
 * - Consumi kWh ogni 10 min (`Dettaglio curve di carico`): `apps-script/sync_consumi_edistribuzione.js`
 * - Consumi kWh + Bollette Luce/Acqua/TARI multi-formato ogni 10 min: `scripts/sync_gmail_consumi_e_bollette.py`
 * - Confronto tariffe luce fornitori vs Octopus 2027: `scripts/check_octopus_tariff.py`
 *
 * Configurazione su https://script.google.com -> Impostazioni progetto:
 * 1) Proprietà script:
 *    - CALLMEBOT_PHONE    = il tuo numero con prefisso (es. 393XXXXXXXXX)
 *    - CALLMEBOT_API_KEY  = la tua apikey ricevuta da CallMeBot
 *    - REMINDERS_EMAIL_TO = (opzionale) email destinatario
 * 2) File manifest `appsscript.json` ("oauthScopes"):
 *    - "https://www.googleapis.com/auth/datastore"
 *    - "https://www.googleapis.com/auth/script.external_request"
 *    - "https://www.googleapis.com/auth/script.send_mail"
 */
/**
 * Esegui QUESTA funzione una sola volta su script.google.com per creare il trigger
 * giornaliero (ogni mattina ~08:30 Europe/Rome) ed eseguire subito un test live.
 */
function attivaPromemoriaGiornalieri() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkMyHomeRemindersDaily') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('checkMyHomeRemindersDaily')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(30)
    .create();
  Logger.log('Trigger giornaliero attivato per checkMyHomeRemindersDaily (08:30 Europe/Rome).');
  checkMyHomeRemindersDaily();
}

function checkMyHomeRemindersDaily() {
  var FIREBASE_PROJECT_ID = 'gen-lang-client-0721850501';
  var FIRESTORE_DB_ID = 'ai-studio-30a168e3-8158-474f-b9f2-f717d7220314';
  var BASE_DOCS_URL =
    'https://firestore.googleapis.com/v1/projects/' +
    FIREBASE_PROJECT_ID +
    '/databases/' +
    FIRESTORE_DB_ID +
    '/documents';

  var props = PropertiesService.getScriptProperties();
  var oauthToken = getRemindersFirestoreToken_(props);

  var ownerUid = (props.getProperty('FIREBASE_OWNER_UID') || props.getProperty('OWNER_UID') || 'UnFRruOuLTMCgy8ftX8AQEw8I4K3').trim();
  if (!ownerUid) {
    var metaResp = UrlFetchApp.fetch(BASE_DOCS_URL + '/appMeta/owner', {
      headers: { Authorization: 'Bearer ' + oauthToken },
      muteHttpExceptions: true
    });
    if (metaResp.getResponseCode() >= 200 && metaResp.getResponseCode() < 300) {
      var metaJson = JSON.parse(metaResp.getContentText() || '{}');
      ownerUid =
        (metaJson.fields && metaJson.fields.ownerUid && metaJson.fields.ownerUid.stringValue) || '';
    }
  }
  if (!ownerUid) {
    throw new Error('Impossibile determinare FIREBASE_OWNER_UID da appMeta/owner.');
  }

  var queryUrl = BASE_DOCS_URL + '/users/' + encodeURIComponent(ownerUid) + ':runQuery';
  var queryPayload = {
    structuredQuery: {
      from: [{ collectionId: 'homeArticles' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'room' },
          op: 'IN',
          value: {
            arrayValue: {
              values: [{ stringValue: '__promemoria__' }, { stringValue: '__macchina__' }]
            }
          }
        }
      }
    }
  };

  var queryResp = UrlFetchApp.fetch(queryUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + oauthToken },
    payload: JSON.stringify(queryPayload),
    muteHttpExceptions: true
  });

  var qCode = queryResp.getResponseCode();
  if (qCode < 200 || qCode >= 300) {
    throw new Error(
      'Errore lettura Firestore HTTP ' +
        qCode +
        '. Verifica che il progetto GCP sia 902318210670 (o imposta FIREBASE_SERVICE_ACCOUNT) e che appsscript.json abbia lo scope datastore. Dettagli: ' +
        queryResp.getContentText()
    );
  }

  var rows = JSON.parse(queryResp.getContentText() || '[]');
  var liveReminders = [];
  var firestoreEmail = '';
  var firestorePhone = '';
  var carCurrentKm = 0;
  var carBatteryCapacityPct = null;

  rows.forEach(function (row) {
    var doc = row && row.document;
    if (!doc || !doc.fields) return;
    var parts = String(doc.name || '').split('/');
    var docId = parts[parts.length - 1] || '';
    var fields = doc.fields;
    var room = (fields.room && fields.room.stringValue) || '';
    var specs = (fields.specs && fields.specs.stringValue) || '';
    var rawJson = (fields.manualExtractText && fields.manualExtractText.stringValue) || '';

    if (docId === 'rem_notify_config') {
      try {
        var cfg = JSON.parse(rawJson || '{}');
        if (cfg.defaultEmail) firestoreEmail = String(cfg.defaultEmail).trim();
        if (cfg.whatsappPhone) firestorePhone = String(cfg.whatsappPhone).replace(/[^\d]/g, '');
      } catch (e) {}
      return;
    }

    if (room === '__macchina__') {
      var kmMatch = specs.match(/(?:^|\|)KM:(\d+)/);
      if (kmMatch) {
        var kmVal = Number(kmMatch[1]);
        if (kmVal > carCurrentKm) carCurrentKm = kmVal;
      }
      if (docId === 'car_profile_ea218es' && rawJson) {
        try {
          var carExtra = JSON.parse(rawJson);
          if (typeof carExtra.batteryCapacityPct === 'number') {
            carBatteryCapacityPct = carExtra.batteryCapacityPct;
          }
        } catch (e) {}
      }
      return;
    }

    if (room === '__promemoria__') {
      var parsed = null;
      try {
        parsed = rawJson ? JSON.parse(rawJson) : null;
      } catch (e) {
        parsed = null;
      }
      if (parsed && typeof parsed === 'object') {
        if (!parsed.title && fields.name && fields.name.stringValue) {
          parsed.title = fields.name.stringValue;
        }
        liveReminders.push(parsed);
      }
    }
  });

  var sessionEmail = '';
  try {
    sessionEmail = (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').trim();
  } catch (e) {}

  var EMAIL_TO = (props.getProperty('REMINDERS_EMAIL_TO') || firestoreEmail || sessionEmail || '').trim();
  var WA_PHONE = (props.getProperty('CALLMEBOT_PHONE') || firestorePhone || '').replace(/[^\d]/g, '');
  var CALLMEBOT_KEY = (props.getProperty('CALLMEBOT_API_KEY') || '').trim();

  var todayIso = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
  var todayParts = todayIso.split('-');
  var todayUtc = Date.UTC(Number(todayParts[0]), Number(todayParts[1]) - 1, Number(todayParts[2]));

  Logger.log(
    'Promemoria letti da Firestore: ' +
      liveReminders.length +
      ' | todayIso=' +
      todayIso +
      ' | emailConfig=' +
      (EMAIL_TO ? 'OK' : 'ASSENTE') +
      ' | waPhone=' +
      (WA_PHONE ? 'OK' : 'ASSENTE') +
      ' | callmebotKey=' +
      (CALLMEBOT_KEY ? 'OK' : 'ASSENTE')
  );

  var emailAlerts = [];
  var whatsappAlerts = [];

  liveReminders.forEach(function (r) {
    if (!r || r.completed || r.notifyEnabled === false) {
      if (r && r.title) Logger.log('Saltato "' + r.title + '": completed=' + Boolean(r.completed) + ', notifyEnabled=' + r.notifyEnabled);
      return;
    }
    if (r.lastNotifiedDate === todayIso) {
      Logger.log('Saltato "' + r.title + '": già notificato oggi (' + todayIso + ').');
      return;
    }

    var startIso = normalizeIso_(r.startDate) || todayIso;
    var dueIso =
      normalizeIso_(r.customEndDate) ||
      addDurationToIso_(startIso, Number(r.durationYears) || 0, Number(r.durationMonths) || 0, Number(r.durationDays) || 0);
    var warningStartIso = addDurationToIso_(
      dueIso,
      0,
      -(Number(r.leadMonths) || 0),
      -(Number(r.leadDays) || 0)
    );

    var dueParts = dueIso.split('-');
    var dueUtc = Date.UTC(Number(dueParts[0]), Number(dueParts[1]) - 1, Number(dueParts[2]));
    var diffDays = Math.round((dueUtc - todayUtc) / 86400000);

    var isKmWarning = false;
    var isKmOverdue = false;
    var kmNote = '';
    if (r.trackKm && Number(r.intervalKm) > 0 && carCurrentKm > 0) {
      var baseKm = typeof r.startKm === 'number' ? r.startKm : carCurrentKm;
      var kmElapsed = Math.max(0, Math.round(carCurrentKm - baseKm));
      var kmRemaining = Math.round(Number(r.intervalKm) - kmElapsed);
      var kmPct = (kmElapsed / Number(r.intervalKm)) * 100;
      isKmOverdue = kmRemaining <= 0;
      isKmWarning = kmPct >= 85 || kmRemaining <= 1500;
      kmNote = ' · ' + kmElapsed + '/' + r.intervalKm + ' km';
    }

    var isOverdue = diffDays < 0 || isKmOverdue;
    var isInWarningWindow = todayIso >= warningStartIso || isKmWarning || isOverdue;
    Logger.log(
      'Check "' +
        r.title +
        '": due=' +
        dueIso +
        ', warningStart=' +
        warningStartIso +
        ', diffDays=' +
        diffDays +
        ', inWindow=' +
        isInWarningWindow +
        ', notifyEmail=' +
        (r.notifyEmail !== false) +
        ', notifyWhatsapp=' +
        (r.notifyWhatsapp === true)
    );
    if (!isInWarningWindow) return;

    var capPct =
      typeof r.capacityPct === 'number'
        ? r.capacityPct
        : /batteria/i.test(String(r.title || '')) && carBatteryCapacityPct !== null
          ? carBatteryCapacityPct
          : null;
    var capNote = capPct !== null ? ' · Capacità: ' + capPct + '%' : '';

    var statusLabel =
      diffDays < 0
        ? 'SCADUTO da ' + Math.abs(diffDays) + ' gg'
        : diffDays === 0
          ? 'SCADE OGGI'
          : 'mancano ' + diffDays + ' gg';
    var line = '• ' + r.title + ' — ' + dueIso + ' (' + statusLabel + ')' + kmNote + capNote;

    if (r.notifyEmail !== false) emailAlerts.push(line);
    if (r.notifyWhatsapp === true) whatsappAlerts.push(line);
  });

  if (emailAlerts.length > 0) {
    if (!EMAIL_TO) {
      Logger.log('Avviso Email NON inviato: REMINDERS_EMAIL_TO e email Firestore assenti.');
    } else {
      var emailBody =
        'Promemoria giornalieri My Home (' +
        todayIso +
        '):\n\n' +
        emailAlerts.join('\n') +
        '\n\nApri https://mauriziominieri.github.io/my-home/ per rinnovare o completare.';
      MailApp.sendEmail(EMAIL_TO, '[My Home] ' + emailAlerts.length + ' scadenze in corso', emailBody);
      Logger.log('Email promemoria inviata con successo (' + emailAlerts.length + ' voci).');
    }
  } else {
    Logger.log('Nessun promemoria in finestra di avviso per Email oggi.');
  }

  if (whatsappAlerts.length > 0) {
    if (!WA_PHONE || !CALLMEBOT_KEY) {
      Logger.log('Avviso WhatsApp NON inviato: CALLMEBOT_PHONE o CALLMEBOT_API_KEY mancanti in Proprietà script.');
    } else {
      var waBody =
        '*My Home — Promemoria (' +
        todayIso +
        ')*\n\n' +
        whatsappAlerts.join('\n') +
        '\n\nhttps://mauriziominieri.github.io/my-home/';
      if (waBody.length > 1400) {
        waBody = waBody.slice(0, 1397) + '...';
      }
      var waUrl =
        'https://api.callmebot.com/whatsapp.php?phone=' +
        encodeURIComponent(WA_PHONE) +
        '&text=' +
        encodeURIComponent(waBody) +
        '&apikey=' +
        encodeURIComponent(CALLMEBOT_KEY);
      var resp = UrlFetchApp.fetch(waUrl, { muteHttpExceptions: true });
      var code = resp.getResponseCode();
      Logger.log('Risposta CallMeBot HTTP ' + code + ': ' + resp.getContentText());
    }
  } else {
    Logger.log('Nessun promemoria in finestra di avviso per WhatsApp oggi.');
  }
}

function getRemindersFirestoreToken_(props) {
  var saRaw = props.getProperty('FIREBASE_SERVICE_ACCOUNT');
  if (saRaw && saRaw.trim()) {
    var sa = JSON.parse(saRaw);
    var now = Math.floor(Date.now() / 1000);
    var header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=+$/, '');
    var claim = Utilities.base64EncodeWebSafe(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      })
    ).replace(/=+$/, '');
    var sigBytes = Utilities.computeRsaSha256Signature(header + '.' + claim, sa.private_key);
    var sig = Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/, '');
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: header + '.' + claim + '.' + sig
      },
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText() || '{}');
    if (json.access_token) return json.access_token;
    throw new Error('Errore token Service Account: ' + res.getContentText());
  }
  return ScriptApp.getOAuthToken();
}

function normalizeIso_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  var mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) return mIso[1] + '-' + mIso[2] + '-' + mIso[3];
  var mIt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mIt) {
    var dd = mIt[1].length < 2 ? '0' + mIt[1] : mIt[1];
    var mm = mIt[2].length < 2 ? '0' + mIt[2] : mIt[2];
    return mIt[3] + '-' + mm + '-' + dd;
  }
  return '';
}

function addDurationToIso_(iso, years, months, days) {
  var p = iso.split('-');
  var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  var totalMonths = Math.round((years || 0) * 12 + (months || 0));
  if (totalMonths !== 0) {
    var origDay = dt.getUTCDate();
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() + totalMonths);
    var maxDays = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(origDay, maxDays));
  }
  if (days) {
    dt.setUTCDate(dt.getUTCDate() + Math.round(days));
  }
  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1);
  if (m.length < 2) m = '0' + m;
  var d = String(dt.getUTCDate());
  if (d.length < 2) d = '0' + d;
  return y + '-' + m + '-' + d;
}