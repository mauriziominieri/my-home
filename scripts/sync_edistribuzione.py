"""
Prelievo automatico del CSV "Dettaglio curve di carico" (FORNUTAIT...csv),
bollette Edison PDF e avvisi TARI PDF dalla INBOX di Gmail -> Firebase Firestore.
Mittente e-distribuzione: notifichemailped@enel.com | Oggetto: Dettaglio curve di carico
Supporta qualsiasi formato di data (D/M/YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) e
qualsiasi intestazione quartoraria (00:00 - 00:15, 00:15, Q1..Q96, 1..96).
"""

import csv
import email
import imaplib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

POD_CODE = os.environ.get("POD_CODE", "IT001E11251419")
TARIFF_EUR_PER_KWH = float(os.environ.get("TARIFF_EUR_PER_KWH", "0.24"))


def parse_it_float(raw: Optional[str]) -> float:
    if not raw:
        return 0.0
    cleaned = raw.strip().replace('"', "").replace(" ", "").replace(",", ".")
    try:
        val = float(cleaned)
        return val if val >= 0 else 0.0
    except ValueError:
        return 0.0


def normalize_date(raw: Optional[str], prefer_mdy: bool = False) -> Optional[str]:
    if not raw:
        return None
    cleaned = raw.strip().replace('"', "").split(" ")[0]
    today = datetime.now(timezone.utc).date()

    def _valid_iso(y: int, m: int, d: int) -> Optional[str]:
        try:
            dt = datetime(y, m, d).date()
            if dt <= today:
                return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass
        return None

    # YYYY-MM-DD or YYYY/MM/DD
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", cleaned)
    if m:
        return _valid_iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    # DD/MM/YYYY or MM/DD/YYYY
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", cleaned)
    if m:
        p1, p2, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if prefer_mdy:
            return _valid_iso(y, p1, p2) or _valid_iso(y, p2, p1)
        return _valid_iso(y, p2, p1) or _valid_iso(y, p1, p2)
    # YYYYMMDD
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", cleaned)
    if m:
        return _valid_iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def get_arera_band(iso_date: str, hour: int) -> str:
    """Calcola fascia ARERA (F1, F2, F3) in base al giorno della settimana e all'ora (0-23)."""
    dt = datetime.strptime(iso_date, "%Y-%m-%d")
    weekday = dt.weekday()  # 0=Lun .. 5=Sab, 6=Dom
    if weekday == 6:
        return "F3"
    if weekday == 5:
        return "F2" if 7 <= hour < 23 else "F3"
    if 8 <= hour < 19:
        return "F1"
    if (7 <= hour < 8) or (19 <= hour < 23):
        return "F2"
    return "F3"


def parse_csv_content(text: str) -> List[Dict[str, Any]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return []

    delimiter = ";" if lines[0].count(";") >= lines[0].count(",") else ","
    # Controlla anche le righe successive nel caso ci siano righe di intestazione/metadati in alto
    for ln in lines[:10]:
        if ln.count(";") >= 10:
            delimiter = ";"
            break

    results: List[Dict[str, Any]] = []
    reader = list(csv.reader(lines, delimiter=delimiter))

    # Rileva a livello di intero file se il CSV usa MM/DD/YYYY invece di DD/MM/YYYY
    mdy_votes = 0
    dmy_votes = 0
    for row in reader:
        for idx in range(min(3, len(row))):
            cleaned = row[idx].strip().replace('"', "").split(" ")[0]
            m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", cleaned)
            if m:
                p1, p2 = int(m.group(1)), int(m.group(2))
                if p1 > 12:
                    dmy_votes += 1
                elif p2 > 12:
                    mdy_votes += 1
    prefer_mdy = mdy_votes > dmy_votes

    # Scansiona tutte le righe: appena trova una riga che inizia con una data valida
    # e ha almeno 24 colonne numeriche, la elabora come curva di carico quartoraria/oraria!
    for row in reader:
        if len(row) < 2:
            continue

        # Cerca la colonna della data nelle prime 3 colonne
        date_idx = -1
        iso = None
        for idx in range(min(3, len(row))):
            cand = normalize_date(row[idx], prefer_mdy=prefer_mdy)
            if cand:
                date_idx = idx
                iso = cand
                break

        if not iso or date_idx == -1:
            continue

        value_cells = row[date_idx + 1 :]
        # Caso 1: Curva di carico quartoraria (96 colonne) o oraria (24 colonne)
        if len(value_cells) >= 24:
            is_hourly = len(value_cells) < 48
            f1 = 0.0
            f2 = 0.0
            f3 = 0.0
            max_slot = 0.0

            for slot_idx, cell in enumerate(value_cells[:96]):
                val = parse_it_float(cell)
                if val > max_slot:
                    max_slot = val
                hour = slot_idx if is_hourly else min(23, slot_idx // 4)
                band = get_arera_band(iso, hour)
                if band == "F1":
                    f1 += val
                elif band == "F2":
                    f2 += val
                else:
                    f3 += val

            f1 = round(f1, 2)
            f2 = round(f2, 2)
            f3 = round(f3, 2)
            tot = round(f1 + f2 + f3, 2)
            peak_kw = round(min(6.0, max_slot if is_hourly else max_slot * 4.0), 2)

            results.append(
                {
                    "date": iso,
                    "f1Kwh": f1,
                    "f2Kwh": f2,
                    "f3Kwh": f3,
                    "totalKwh": tot,
                    "peakKw": peak_kw,
                }
            )
        else:
            # Caso 2: Riga compatta con F1, F2, F3 o Totale
            nums = [parse_it_float(c) for c in value_cells if c.strip()]
            if not nums:
                continue
            if len(nums) >= 3:
                f1, f2, f3 = round(nums[0], 2), round(nums[1], 2), round(nums[2], 2)
                tot = round(f1 + f2 + f3, 2)
            else:
                f1, f2, f3 = 0.0, 0.0, round(nums[0], 2)
                tot = f3
            results.append(
                {
                    "date": iso,
                    "f1Kwh": f1,
                    "f2Kwh": f2,
                    "f3Kwh": f3,
                    "totalKwh": tot,
                    "peakKw": 0.0,
                }
            )

    if not results:
        print(f"DEBUG prime 2 righe CSV non riconosciute: {lines[:2]}")

    return results


def extract_csvs_from_gmail() -> tuple[Dict[bytes, List[Dict[str, Any]]], Optional[imaplib.IMAP4_SSL]]:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        raise RuntimeError("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti su GitHub.")

    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(gmail_user, gmail_pass)
    mail.select("INBOX")

    status, data = mail.search(
        None,
        '(OR FROM "notifichemailped@enel.com" SUBJECT "Dettaglio curve di carico")',
    )
    if status != "OK" or not data or not data[0]:
        print("Nessuna email 'Dettaglio curve di carico' trovata nella INBOX.")
        return {}, mail

    msg_ids = data[0].split()[-15:]
    print(f"Trovate {len(msg_ids)} email di e-distribuzione / Enel.")
    readings_by_msg: Dict[bytes, List[Dict[str, Any]]] = {}

    for msg_id in msg_ids:
        _, msg_data = mail.fetch(msg_id, "(RFC822)")
        if not msg_data or not isinstance(msg_data[0], tuple):
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        msg_readings: List[Dict[str, Any]] = []

        for part in msg.walk():
            filename = (part.get_filename() or "").lower()
            if not filename:
                continue

            payload = part.get_payload(decode=True)
            if not payload:
                continue

            if filename.endswith(".csv"):
                print(f"Elaborazione allegato CSV: {filename}")
                text = payload.decode("utf-8-sig", errors="replace")
                msg_readings.extend(parse_csv_content(text))
            elif filename.endswith(".zip"):
                print(f"Elaborazione allegato ZIP: {filename}")
                with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                    for name in zf.namelist():
                        if name.lower().endswith(".csv"):
                            text = zf.read(name).decode("utf-8-sig", errors="replace")
                            msg_readings.extend(parse_csv_content(text))

        if msg_readings:
            readings_by_msg[msg_id] = msg_readings

    return readings_by_msg, mail


def delete_processed_emails(mail: Optional[imaplib.IMAP4_SSL], msg_ids: List[bytes]) -> None:
    if not mail:
        return
    try:
        if msg_ids:
            for msg_id in msg_ids:
                # Sposta nel Cestino di Gmail (funziona indipendentemente dalla lingua) e rimuove da INBOX
                mail.store(msg_id, "+X-GM-LABELS", "\\Trash")
                mail.store(msg_id, "+FLAGS", "\\Deleted")
            mail.expunge()
            print(f"Eliminate {len(msg_ids)} email elaborate dalla INBOX (spostate nel Cestino).")
    finally:
        try:
            mail.logout()
        except Exception:
            pass


def parse_edison_pdf_bytes(pdf_bytes: bytes) -> Optional[Dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError:
        print("Modulo pypdf non installato: salto estrazione bollette PDF.")
        return None

    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "\n".join((page.extract_text() or "") for page in reader.pages[:2])
    if not text.strip():
        return None

    inv_m = re.search(r"Bolletta\s+n\.?\s*(\d+)\s+del\s+(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE)
    if not inv_m:
        inv_m = re.search(r"Fattura\s+N°?\s*(\d+)\s+del\s+(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE)
    if not inv_m:
        return None

    invoice_number = inv_m.group(1)
    issue_date = inv_m.group(2)

    period_m = re.search(r"Periodo\s+([A-Z]{3}\s+\d{4}\s*-\s*[A-Z]{3}\s+\d{4})", text, re.IGNORECASE)
    raw_period = period_m.group(1).strip() if period_m else issue_date

    # Calcola anno e sortKey dal periodo o dalla data di emissione
    month_map = {
        "GEN": "01", "FEB": "02", "MAR": "03", "APR": "04",
        "MAG": "05", "GIU": "06", "LUG": "07", "AGO": "08",
        "SET": "09", "OTT": "10", "NOV": "11", "DIC": "12",
    }
    end_m = re.search(r"-\s*([A-Z]{3})\s+(\d{4})", raw_period, re.IGNORECASE)
    if end_m:
        year = int(end_m.group(2))
        mm = month_map.get(end_m.group(1).upper(), "01")
        sort_key = f"{year}-{mm}"
    else:
        parts = issue_date.split("/")
        year = int(parts[2])
        sort_key = f"{parts[2]}-{parts[1]}"

    # Consumo kWh
    kwh_m = re.search(r"(\d+(?:\.\d+)?)\s*kWh\s+0,\d+\s*€/kWh", text)
    if not kwh_m:
        kwh_m = re.search(r"TOTALI\s+(\d+(?:\.\d+)?)\s*kWh", text, re.IGNORECASE)
    kwh = int(round(parse_it_float(kwh_m.group(1).replace(".", "")))) if kwh_m else 0

    # Prezzo medio quota consumi (senza accisa e IVA)
    var_m = re.search(r"\d+\s*kWh\s+(0,\d+)\s*€/kWh", text)
    var_net = parse_it_float(var_m.group(1)) if var_m else 0.0
    variable_cost_incl_vat = round((var_net + 0.0227) * 1.10, 3) if var_net > 0 else 0.0

    # Totale da pagare e Canone TV
    tot_m = re.search(r"TOTALE\s+DA\s+PAGARE\s+([\d.,]+)\s*€", text, re.IGNORECASE)
    total_paid = round(parse_it_float(tot_m.group(1).replace(".", "")), 2) if tot_m else 0.0

    tv_m = re.search(r"Canone\s+di\s+abbonamento\s+alla\s+televisione[^\n]*?([\d.,]+)\s*€", text, re.IGNORECASE)
    canone_tv = round(parse_it_float(tv_m.group(1).replace(".", "")), 2) if tv_m else 0.0

    elec_m = re.search(r"TOTALE\s+BOLLETTA\s+([\d.,]+)\s*€", text, re.IGNORECASE)
    electricity_only = (
        round(parse_it_float(elec_m.group(1).replace(".", "")), 2)
        if elec_m
        else round(max(0.0, total_paid - canone_tv), 2)
    )

    # PUN mensili
    puns = re.findall(r"\d{2}/\d{4}\s+(0,\d{4,6})", text)
    pun_vals = [f"{parse_it_float(p):.3f}".replace(".", ",") for p in puns[:2]]
    pun_text = f"{' / '.join(pun_vals)} €" if pun_vals else "—"

    offer_m = re.search(r"Nome\s+Offerta:\s*([^\n]+)", text, re.IGNORECASE)
    offer_name = offer_m.group(1).strip() if offer_m else "EDISON DYNAMIC LUCE"

    return {
        "invoiceNumber": invoice_number,
        "issueDate": issue_date,
        "sortKey": sort_key,
        "year": year,
        "period": raw_period.title().replace(" - ", " – "),
        "supplier": "Edison Energia",
        "offerName": offer_name,
        "kwh": kwh,
        "punText": pun_text,
        "variableCostPerKwh": variable_cost_incl_vat,
        "canoneTv": canone_tv,
        "electricityOnly": electricity_only,
        "totalPaid": total_paid,
    }


def extract_edison_bills_from_gmail(
    mail: Optional[imaplib.IMAP4_SSL],
) -> Dict[bytes, List[Dict[str, Any]]]:
    if not mail:
        return {}
    mail.select("INBOX")
    bills_by_msg: Dict[bytes, List[Dict[str, Any]]] = {}
    status, data = mail.search(
        None,
        '(OR FROM "fatturazione@edisonenergia.it" SUBJECT "Fattura Edison Energia")',
    )
    if status != "OK" or not data or not data[0]:
        print("Nessuna bolletta Edison trovata nella INBOX.")
        return {}

    msg_ids = data[0].split()[-12:]
    print(f"Trovate {len(msg_ids)} email di fatturazione Edison Energia nella INBOX.")
    for msg_id in msg_ids:
        _, msg_data = mail.fetch(msg_id, "(RFC822)")
        if not msg_data or not isinstance(msg_data[0], tuple):
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        msg_bills: List[Dict[str, Any]] = []
        for part in msg.walk():
            filename = (part.get_filename() or "").lower()
            if not filename.endswith(".pdf"):
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            print(f"Elaborazione bolletta PDF Edison: {filename}")
            parsed = parse_edison_pdf_bytes(payload)
            if parsed:
                msg_bills.append(parsed)
        if msg_bills:
            bills_by_msg[msg_id] = msg_bills
    return bills_by_msg


def parse_tari_pdf_bytes(
    pdf_bytes: bytes, msg_subject: str = "", msg_date: str = ""
) -> Optional[Dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError:
        print("Modulo pypdf non installato: salto estrazione PDF TARI.")
        return None

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:4])
    except Exception as exc:
        print(f"Errore lettura PDF TARI: {exc}")
        return None

    if not text.strip():
        return None

    notice_m = re.search(
        r"(?:Avviso(?:\s+di\s+pagamento)?|Documento|N°|Numero|Codice\s+Avviso)\s*(?:n\.?|numero)?\s*[:#]?\s*([A-Z0-9/-]{5,30})",
        text,
        re.IGNORECASE,
    )
    notice_number = notice_m.group(1).strip() if notice_m else ""

    # Estrai date (emissione e scadenza)
    issue_m = re.search(
        r"(?:data\s+emissione|emesso\s+il|del)\s*[:.]?\s*(\d{2}/\d{2}/\d{4})",
        text,
        re.IGNORECASE,
    )
    due_m = re.search(
        r"(?:scadenza|entro\s+il|pagare\s+entro\s+il)\s*[:.]?\s*(\d{2}/\d{2}/\d{4})",
        text,
        re.IGNORECASE,
    )
    all_dates = re.findall(r"\b(\d{2}/\d{2}/\d{4})\b", text)
    issue_date = issue_m.group(1) if issue_m else (all_dates[0] if all_dates else "—")
    due_date = due_m.group(1) if due_m else (all_dates[-1] if all_dates else issue_date)

    # Estrai anno di riferimento TARI
    year_m = re.search(r"TARI\s+(20\d{2})", text + " " + msg_subject, re.IGNORECASE)
    if not year_m:
        year_m = re.search(r"Anno(?:\s+d['’]imposta)?\s*[:.]?\s*(20\d{2})", text, re.IGNORECASE)
    if year_m:
        year = int(year_m.group(1))
    elif due_date and "/" in due_date:
        year = int(due_date.split("/")[-1])
    else:
        year = datetime.now(timezone.utc).year

    # Estrai importo totale da pagare
    amount_patterns = [
        r"(?:TOTALE\s+DA\s+PAGARE|IMPORTO\s+DA\s+PAGARE|TOTALE\s+AVVISO|TOTALE\s+DOVUTO)\s*[:€\s]*([\d.,]+)",
        r"(?:Importo|Totale)\s*[:\s]*€?\s*([\d.,]+)\s*€",
        r"€\s*([\d]{1,4}[.,]\d{2})",
    ]
    total_paid = 0.0
    for pat in amount_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            candidate = round(parse_it_float(m.group(1).replace(".", "")), 2)
            if candidate > 0:
                total_paid = candidate
                break

    if total_paid <= 0 and not notice_number:
        return None

    if not notice_number:
        # Fallback deterministico su anno + scadenza/importo
        clean_due = due_date.replace("/", "")
        notice_number = f"TARI_{year}_{clean_due or int(total_paid * 100)}"

    # Identifica rata / periodo
    rata_m = re.search(r"(Rata\s+\d+|Unica\s+Soluzione|Saldo|Acconto)", text, re.IGNORECASE)
    rata_label = rata_m.group(1).title() if rata_m else "Avviso di pagamento"
    period = f"TARI {year} – {rata_label}"

    return {
        "noticeNumber": notice_number[:50],
        "issueDate": issue_date[:20],
        "dueDate": due_date[:20],
        "year": year,
        "period": period[:80],
        "supplier": "AcegasApsAmga (TARI)",
        "totalPaid": total_paid,
        "paid": False,
        "source": "gmail-pdf",
        "note": f"Estratto automaticamente da Gmail ({msg_date[:16]})".strip() if msg_date else "Estratto automaticamente da Gmail",
    }


def extract_tari_bills_from_gmail(
    mail: Optional[imaplib.IMAP4_SSL],
) -> Dict[bytes, List[Dict[str, Any]]]:
    if not mail:
        return {}
    tari_by_msg: Dict[bytes, List[Dict[str, Any]]] = {}
    search_criteria = '(OR FROM "tassa_rifiuti@acegasapsamga.it" SUBJECT "Avviso di pagamento TARI")'

    try:
        status, _ = mail.select("INBOX")
        if status != "OK":
            return {}
        status, data = mail.search(None, search_criteria)
        if status != "OK" or not data or not data[0]:
            print("Nessun avviso TARI trovato nella INBOX.")
            return {}
        msg_ids = data[0].split()[-15:]
        print(f"Trovate {len(msg_ids)} email TARI AcegasApsAmga nella INBOX.")
        for msg_id in msg_ids:
            _, msg_data = mail.fetch(msg_id, "(RFC822)")
            if not msg_data or not isinstance(msg_data[0], tuple):
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            subj = str(msg.get("Subject", ""))
            msg_date = str(msg.get("Date", ""))
            msg_tari: List[Dict[str, Any]] = []
            for part in msg.walk():
                filename = (part.get_filename() or "").lower()
                content_type = (part.get_content_type() or "").lower()
                if not (filename.endswith(".pdf") or content_type == "application/pdf"):
                    continue
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                print(f"Elaborazione PDF TARI: {filename or 'avviso.pdf'}")
                parsed = parse_tari_pdf_bytes(payload, subj, msg_date)
                if parsed:
                    msg_tari.append(parsed)
            if msg_tari:
                tari_by_msg[msg_id] = msg_tari
    except Exception as exc:
        print(f"Nota lettura TARI dalla INBOX: {exc}")

    return tari_by_msg


def _load_firebase_config() -> Dict[str, str]:
    return {
        "projectId": os.environ.get("FIREBASE_PROJECT_ID", "spiritual-bearing-sq7xb"),
        "databaseId": os.environ.get(
            "FIRESTORE_DATABASE_ID",
            "ai-studio-30a168e3-8158-474f-b9f2-f717d7220314",
        ),
        "apiKey": os.environ.get("FIREBASE_API_KEY", ""),
        "ownerUid": os.environ.get("OWNER_UID", "rXdhFrSuqzaYf8SYVbmQulPqg7m1"),
    }


def _to_firestore_value(v: Any) -> Dict[str, Any]:
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, (int, float)):
        return {"doubleValue": float(v)}
    if v is None:
        return {"nullValue": None}
    return {"stringValue": str(v)}


def firestore_commit_doc(
    fb_cfg: Dict[str, str],
    collection: str,
    raw_doc_id: str,
    fields_dict: Dict[str, Any],
) -> bool:
    doc_id = re.sub(r"[^a-zA-Z0-9_-]", "", raw_doc_id)[:128]
    if not doc_id:
        return False

    project_id = fb_cfg["projectId"]
    database_id = fb_cfg["databaseId"]
    api_key = fb_cfg["apiKey"]
    id_token = os.environ.get("FIREBASE_ID_TOKEN", "").strip()

    commit_url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        f"/databases/{database_id}/documents:commit"
    )
    if api_key and not id_token:
        commit_url = f"{commit_url}?{urllib.parse.urlencode({'key': api_key})}"

    doc_name = f"projects/{project_id}/databases/{database_id}/documents/{collection}/{doc_id}"
    fs_fields = {k: _to_firestore_value(v) for k, v in fields_dict.items()}

    body = {
        "writes": [
            {
                "update": {
                    "name": doc_name,
                    "fields": fs_fields,
                },
                "updateTransforms": [
                    {
                        "fieldPath": "createdAt",
                        "setToServerValue": "REQUEST_TIME",
                    }
                ],
            }
        ]
    }
    headers = {"Content-Type": "application/json"}
    if id_token:
        headers["Authorization"] = f"Bearer {id_token}"

    req = urllib.request.Request(
        commit_url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        if exc.code in (401, 403):
            print(
                f"Scrittura Firestore bloccata ({exc.code}) su {collection}/{doc_id}: "
                "autenticazione proprietario richiesta dalle Firestore Rules. "
                "L'email NON verrà eliminata.",
                file=sys.stderr,
            )
        else:
            print(f"Errore HTTP Firestore {exc.code} su {collection}/{doc_id}: {err_body}")
        return False
    except Exception as exc:
        print(f"Errore scrittura Firestore {collection}/{doc_id}: {exc}")
        return False


def save_readings_json(new_readings: List[Dict[str, Any]], output_path: Path = Path("data/consumi.json")) -> bool:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    by_date: Dict[str, Dict[str, Any]] = {}
    if output_path.exists():
        try:
            existing = json.loads(output_path.read_text(encoding="utf-8"))
            for item in existing.get("readings", []):
                d = str(item.get("date", ""))
                if d:
                    by_date[d] = item
        except Exception as exc:
            print(f"Nota lettura {output_path} esistente: {exc}")

    for r in new_readings:
        d = str(r.get("date", ""))
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            continue
        by_date[d] = {
            "date": d,
            "f1Kwh": round(float(r.get("f1Kwh", 0.0)), 2),
            "f2Kwh": round(float(r.get("f2Kwh", 0.0)), 2),
            "f3Kwh": round(float(r.get("f3Kwh", 0.0)), 2),
            "totalKwh": round(float(r.get("totalKwh", 0.0)), 2),
            "peakKw": round(float(r.get("peakKw", 0.0)), 2),
            "source": "e-distribuzione-api",
        }

    sorted_readings = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)
    payload = {
        "pod": POD_CODE,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(sorted_readings),
        "readings": sorted_readings,
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Scritto {output_path} ({len(sorted_readings)} giorni totali).")
    return True


def save_bills_json(
    new_elec: List[Dict[str, Any]],
    new_tari: List[Dict[str, Any]],
    output_path: Path = Path("data/bollette.json"),
) -> bool:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    elec_by_inv: Dict[str, Dict[str, Any]] = {}
    tari_by_notice: Dict[str, Dict[str, Any]] = {}
    if output_path.exists():
        try:
            existing = json.loads(output_path.read_text(encoding="utf-8"))
            for b in existing.get("electricityBills", []):
                inv = str(b.get("invoiceNumber", "")).strip()
                if inv:
                    elec_by_inv[inv] = b
            for t in existing.get("tariBills", []):
                notice = str(t.get("noticeNumber", "")).strip()
                if notice:
                    tari_by_notice[notice] = t
        except Exception as exc:
            print(f"Nota lettura {output_path} esistente: {exc}")

    for b in new_elec:
        inv = str(b.get("invoiceNumber", "")).strip()
        if inv:
            elec_by_inv[inv] = b
    for t in new_tari:
        notice = str(t.get("noticeNumber", "")).strip()
        if notice:
            tari_by_notice[notice] = t

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "electricityBills": sorted(
            elec_by_inv.values(),
            key=lambda x: str(x.get("sortKey", "")),
            reverse=True,
        ),
        "tariBills": sorted(
            tari_by_notice.values(),
            key=lambda x: (int(x.get("year", 0)), str(x.get("noticeNumber", ""))),
            reverse=True,
        ),
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"Scritto {output_path} ({len(payload['electricityBills'])} luce, {len(payload['tariBills'])} TARI)."
    )
    return True


def main() -> None:
    fb_cfg = _load_firebase_config()
    owner_id = fb_cfg["ownerUid"]
    has_firebase_token = bool(os.environ.get("FIREBASE_ID_TOKEN", "").strip())
    print(f"Controllo Gmail (solo INBOX) per curve di carico, bollette Edison e TARI (POD {POD_CODE})...")
    readings_by_msg, mail = extract_csvs_from_gmail()

    try:
        # 1. Estrai eventuali nuove bollette PDF Edison e TARI solo dalla INBOX (mai dal Cestino)
        bills_by_msg = extract_edison_bills_from_gmail(mail)
        tari_by_msg = extract_tari_bills_from_gmail(mail)

        verified_msgs_to_delete: List[bytes] = []

        # 2. Salva letture e-distribuzione in data/consumi.json (e su Firestore se FIREBASE_ID_TOKEN presente)
        all_new_readings = [r for items in readings_by_msg.values() for r in items]
        if all_new_readings and save_readings_json(all_new_readings):
            if has_firebase_token:
                for msg_id, msg_readings in readings_by_msg.items():
                    all_ok = True
                    for r in msg_readings:
                        date_str = str(r.get("date", ""))
                        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
                            all_ok = False
                            continue
                        total_kwh = round(float(r.get("totalKwh", 0.0)), 2)
                        doc_id = f"day_{date_str.replace('-', '')}"
                        fields = {
                            "ownerId": owner_id,
                            "date": date_str,
                            "f1Kwh": round(float(r.get("f1Kwh", 0.0)), 2),
                            "f2Kwh": round(float(r.get("f2Kwh", 0.0)), 2),
                            "f3Kwh": round(float(r.get("f3Kwh", 0.0)), 2),
                            "totalKwh": total_kwh,
                            "peakKw": round(float(r.get("peakKw", 0.0)), 2),
                            "estimatedCostEur": round(total_kwh * TARIFF_EUR_PER_KWH, 2),
                            "source": "e-distribuzione-api",
                        }
                        if not firestore_commit_doc(fb_cfg, f"users/{owner_id}/energyReadings", doc_id, fields):
                            all_ok = False
                            break
                    if all_ok:
                        verified_msgs_to_delete.append(msg_id)
            else:
                verified_msgs_to_delete.extend(readings_by_msg.keys())

        # 3. Salva bollette (Luce + TARI) in data/bollette.json (e su Firestore se FIREBASE_ID_TOKEN presente)
        all_new_elec = [b for items in bills_by_msg.values() for b in items]
        all_new_tari = [t for items in tari_by_msg.values() for t in items]
        if (all_new_elec or all_new_tari) and save_bills_json(all_new_elec, all_new_tari):
            if has_firebase_token:
                for msg_id, msg_bills in bills_by_msg.items():
                    all_ok = True
                    for b in msg_bills:
                        inv = str(b.get("invoiceNumber", "")).strip()
                        if not inv:
                            all_ok = False
                            continue
                        doc_id = f"edison_{re.sub(r'[^a-zA-Z0-9_-]', '', inv)}"
                        if not firestore_commit_doc(fb_cfg, f"users/{owner_id}/electricityBills", doc_id, {"ownerId": owner_id, **b}):
                            all_ok = False
                            break
                    if all_ok:
                        verified_msgs_to_delete.append(msg_id)

                for msg_id, msg_tari in tari_by_msg.items():
                    all_ok = True
                    for t in msg_tari:
                        notice = str(t.get("noticeNumber", "")).strip()
                        if not notice:
                            all_ok = False
                            continue
                        doc_id = f"tari_{re.sub(r'[^a-zA-Z0-9_-]', '', notice)}"
                        if not firestore_commit_doc(fb_cfg, f"users/{owner_id}/tariBills", doc_id, {"ownerId": owner_id, **t}):
                            all_ok = False
                            break
                    if all_ok:
                        verified_msgs_to_delete.append(msg_id)
            else:
                verified_msgs_to_delete.extend(bills_by_msg.keys())
                verified_msgs_to_delete.extend(tari_by_msg.keys())

        # 4. Elimina dalla INBOX solo le email i cui dati sono stati salvati con successo
        if verified_msgs_to_delete:
            delete_processed_emails(mail, list(set(verified_msgs_to_delete)))
        else:
            print("Nessuna nuova email da eliminare dalla INBOX.")
            if mail:
                try:
                    mail.logout()
                except Exception:
                    pass
    except Exception:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Errore sync Gmail e-distribuzione: {exc}", file=sys.stderr)
        sys.exit(1)
