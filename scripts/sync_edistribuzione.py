"""
Prelievo automatico del CSV "Dettaglio curve di carico" (FORNUTAIT...csv),
bollette Edison/Acqua PDF e avvisi TARI PDF dalla INBOX di Gmail -> Firebase Firestore.
Mittente e-distribuzione: notifichemailped@enel.com | Oggetto: Dettaglio curve di carico
Mittenti bollette: fatturazione@edisonenergia.it, acegasapsamga.it, tassa_rifiuti@acegasapsamga.it
Le email delle bollette NON vengono spostate nel Cestino: vengono solo analizzate e gestite
ignorando senza errori qualsiasi tipo di file o allegato non valido.
"""

import csv
import email
import imaplib
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

POD_CODE = os.environ.get("POD_CODE", "IT001E11251419")
TARIFF_EUR_PER_KWH = float(os.environ.get("TARIFF_EUR_PER_KWH", "0.24"))


def is_valid_pdf_bytes(raw: Optional[bytes]) -> bool:
    """Verifica che il payload inizi con l'intestazione binaria reale %PDF- (scarta HTML/testo/altro)."""
    if not raw or len(raw) < 8:
        return False
    return raw.lstrip().startswith(b"%PDF-")


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
            if part.get_content_maintype() == "multipart":
                continue
            filename = (part.get_filename() or "").strip().lower()
            if not filename:
                continue

            try:
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
            except Exception as exc:
                print(f"Allegato CSV/ZIP '{filename}' ignorato senza errori: {exc}")
                continue

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
            print(f"Eliminate {len(msg_ids)} email e-distribuzione elaborate dalla INBOX (spostate nel Cestino).")
    finally:
        try:
            mail.logout()
        except Exception:
            pass


def parse_edison_pdf_bytes(pdf_bytes: bytes) -> Optional[Dict[str, Any]]:
    if not is_valid_pdf_bytes(pdf_bytes):
        return None
    try:
        from pypdf import PdfReader
    except ImportError:
        print("Modulo pypdf non installato: salto estrazione bollette PDF.")
        return None

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:3])
    except Exception as exc:
        print(f"File Edison ignorato (PDF non leggibile): {exc}")
        return None

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
) -> Dict[bytes, List[tuple[Dict[str, Any], bytes, str]]]:
    if not mail:
        return {}
    mail.select("INBOX")
    bills_by_msg: Dict[bytes, List[tuple[Dict[str, Any], bytes, str]]] = {}
    status, data = mail.search(
        None,
        '(OR FROM "fatturazione@edisonenergia.it" SUBJECT "Fattura Edison Energia")',
    )
    if status != "OK" or not data or not data[0]:
        print("Nessuna bolletta Edison trovata nella INBOX.")
        return {}

    msg_ids = data[0].split()[-15:]
    print(f"Trovate {len(msg_ids)} email di fatturazione Edison Energia nella INBOX.")
    for msg_id in msg_ids:
        try:
            _, msg_data = mail.fetch(msg_id, "(RFC822)")
            if not msg_data or not isinstance(msg_data[0], tuple):
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            msg_bills: List[tuple[Dict[str, Any], bytes, str]] = []
            for part in msg.walk():
                if part.get_content_maintype() == "multipart":
                    continue
                raw_name = (part.get_filename() or "").strip()
                filename = raw_name.lower()
                content_type = (part.get_content_type() or "").lower()
                # Non trattare mai parti HTML/testo anonime come PDF: accetta solo allegati .pdf o application/pdf reali
                if not (filename.endswith(".pdf") or content_type == "application/pdf"):
                    continue
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                if not is_valid_pdf_bytes(payload):
                    print(f"Allegato Edison '{raw_name or content_type}' ignorato (non è un PDF valido).")
                    continue
                safe_name = raw_name or "bolletta_edison.pdf"
                print(f"Elaborazione bolletta PDF Edison: {safe_name}")
                parsed = parse_edison_pdf_bytes(payload)
                if parsed:
                    msg_bills.append((parsed, payload, safe_name))
            if msg_bills:
                bills_by_msg[msg_id] = msg_bills
        except Exception as exc:
            print(f"Email Edison ignorata senza errori: {exc}")
    return bills_by_msg


def parse_tari_pdf_bytes(
    pdf_bytes: bytes, msg_subject: str = "", msg_date: str = ""
) -> Optional[Dict[str, Any]]:
    if not is_valid_pdf_bytes(pdf_bytes):
        return None
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

    year_m = re.search(r"TARI\s+(20\d{2})", text + " " + msg_subject, re.IGNORECASE)
    if not year_m:
        year_m = re.search(r"Anno(?:\s+d['’]imposta)?\s*[:.]?\s*(20\d{2})", text, re.IGNORECASE)
    if year_m:
        year = int(year_m.group(1))
    elif due_date and "/" in due_date:
        year = int(due_date.split("/")[-1])
    else:
        year = datetime.now(timezone.utc).year

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
        clean_due = due_date.replace("/", "")
        notice_number = f"TARI_{year}_{clean_due or int(total_paid * 100)}"

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
) -> Dict[bytes, List[tuple[Dict[str, Any], bytes, str]]]:
    if not mail:
        return {}
    tari_by_msg: Dict[bytes, List[tuple[Dict[str, Any], bytes, str]]] = {}
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
            msg_tari: List[tuple[Dict[str, Any], bytes, str]] = []
            for part in msg.walk():
                if part.get_content_maintype() == "multipart":
                    continue
                raw_name = (part.get_filename() or "").strip()
                filename = raw_name.lower()
                content_type = (part.get_content_type() or "").lower()
                if not (filename.endswith(".pdf") or content_type == "application/pdf"):
                    continue
                payload = part.get_payload(decode=True)
                if not payload or not is_valid_pdf_bytes(payload):
                    continue
                safe_name = raw_name or "avviso_tari.pdf"
                print(f"Elaborazione PDF TARI: {safe_name}")
                parsed = parse_tari_pdf_bytes(payload, subj, msg_date)
                if parsed:
                    msg_tari.append((parsed, payload, safe_name))
            if msg_tari:
                tari_by_msg[msg_id] = msg_tari
    except Exception as exc:
        print(f"Nota lettura TARI dalla INBOX: {exc}")

    return tari_by_msg


def parse_water_pdf_bytes(
    pdf_bytes: bytes, msg_subject: str = "", msg_date: str = ""
) -> Optional[Dict[str, Any]]:
    if not is_valid_pdf_bytes(pdf_bytes):
        return None
    try:
        from pypdf import PdfReader
    except ImportError:
        return None

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:4])
    except Exception:
        return None

    low = f"{msg_subject}\n{text}".lower()
    if "tari" in low or "tassa rifiuti" in low:
        return None
    if not any(k in low for k in ("servizio idrico", "acquedotto", "fognatura", "depurazione", "mc")):
        return None

    inv_m = re.search(r"(?:Fattura|Bolletta|Documento)\s*(?:n\.?|numero|N°)?\s*[:#]?\s*([A-Z0-9/-]{5,30})", text, re.IGNORECASE)
    if not inv_m:
        return None
    invoice_number = inv_m.group(1).strip()[:40]

    dates = re.findall(r"\b(\d{2}/\d{2}/\d{4})\b", text)
    issue_date = dates[0] if dates else datetime.now(timezone.utc).strftime("%d/%m/%Y")
    year = int(issue_date.split("/")[-1]) if "/" in issue_date else datetime.now(timezone.utc).year

    tot_m = re.search(r"(?:TOTALE\s+DA\s+PAGARE|TOTALE\s+FATTURA|TOTALE\s+BOLLETTA)\s*[:€\s]*([\d.,]+)", text, re.IGNORECASE)
    total_paid = round(parse_it_float(tot_m.group(1).replace(".", "")), 2) if tot_m else 0.0
    if total_paid <= 0:
        return None

    mc_m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:mc|m3|m³)\b", text, re.IGNORECASE)
    cubic_meters = round(parse_it_float(mc_m.group(1)), 1) if mc_m else 0.0

    period_m = re.search(r"(?:Periodo(?:\s+di\s+fatturazione)?|Dal)\s*[:.]?\s*([^\n]{5,60})", text, re.IGNORECASE)
    period = period_m.group(1).strip()[:80] if period_m else f"Periodo {issue_date}"

    return {
        "invoiceNumber": invoice_number,
        "issueDate": issue_date[:20],
        "year": year,
        "period": period,
        "cubicMeters": cubic_meters,
        "fixedCostEur": 0.0,
        "totalPaid": total_paid,
        "note": f"Estratta automaticamente da Gmail ({msg_date[:16]})".strip() if msg_date else "Estratta automaticamente da Gmail",
    }


def extract_water_bills_from_gmail(
    mail: Optional[imaplib.IMAP4_SSL],
) -> Dict[bytes, List[tuple[Dict[str, Any], bytes, str]]]:
    if not mail:
        return {}
    water_by_msg: Dict[bytes, List[tuple[Dict[str, Any], bytes, str]]] = {}
    try:
        status, _ = mail.select("INBOX")
        if status != "OK":
            return {}
        status, data = mail.search(None, '(OR FROM "acegasapsamga.it" SUBJECT "servizio idrico")')
        if status != "OK" or not data or not data[0]:
            return {}
        msg_ids = data[0].split()[-15:]
        for msg_id in msg_ids:
            _, msg_data = mail.fetch(msg_id, "(RFC822)")
            if not msg_data or not isinstance(msg_data[0], tuple):
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            subj = str(msg.get("Subject", ""))
            msg_date = str(msg.get("Date", ""))
            if "tari" in subj.lower() or "rifiuti" in subj.lower():
                continue
            items: List[tuple[Dict[str, Any], bytes, str]] = []
            for part in msg.walk():
                if part.get_content_maintype() == "multipart":
                    continue
                raw_name = (part.get_filename() or "").strip()
                content_type = (part.get_content_type() or "").lower()
                if not (raw_name.lower().endswith(".pdf") or content_type == "application/pdf"):
                    continue
                payload = part.get_payload(decode=True)
                if not payload or not is_valid_pdf_bytes(payload):
                    continue
                safe_name = raw_name or "bolletta_acqua.pdf"
                parsed = parse_water_pdf_bytes(payload, subj, msg_date)
                if parsed:
                    items.append((parsed, payload, safe_name))
            if items:
                water_by_msg[msg_id] = items
    except Exception as exc:
        print(f"Nota lettura Acqua dalla INBOX: {exc}")
    return water_by_msg


def init_firestore_admin():
    import firebase_admin
    from firebase_admin import auth as fb_auth
    from firebase_admin import credentials, firestore

    sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not sa_raw:
        raise RuntimeError(
            "Secret FIREBASE_SERVICE_ACCOUNT mancante su GitHub. "
            "Scarica la chiave privata JSON da Firebase Console -> gen-lang-client-0721850501 -> Service account."
        )
    sa_dict = json.loads(sa_raw)
    if not firebase_admin._apps:
        cred = credentials.Certificate(sa_dict)
        firebase_admin.initialize_app(cred, {"projectId": sa_dict.get("project_id", "gen-lang-client-0721850501")})

    db_id = os.environ.get(
        "FIRESTORE_DATABASE_ID",
        "ai-studio-30a168e3-8158-474f-b9f2-f717d7220314",
    ).strip()
    db_client = firestore.client(database_id=db_id)

    owner_uid = os.environ.get("OWNER_UID", "").strip()
    if not owner_uid:
        meta_snap = db_client.collection("appMeta").document("owner").get()
        if meta_snap.exists:
            owner_uid = str((meta_snap.to_dict() or {}).get("ownerUid", "")).strip()

    if not owner_uid:
        owner_email = os.environ.get("OWNER_EMAIL", "mauminieri@gmail.com").strip()
        try:
            user_rec = fb_auth.get_user_by_email(owner_email)
            owner_uid = user_rec.uid
            db_client.collection("appMeta").document("owner").set(
                {"ownerUid": owner_uid, "updatedAt": firestore.SERVER_TIMESTAMP}
            )
            print(f"Risolto e salvato ownerUid automatico per {owner_email}: {owner_uid}")
        except Exception as exc:
            raise RuntimeError(
                f"Impossibile determinare ownerUid su gen-lang-client-0721850501 "
                f"(accedi almeno una volta in app con {owner_email}): {exc}"
            ) from exc

    return db_client, firestore, owner_uid


def save_pdf_to_vault_firestore(
    db_client: Any,
    fb_firestore: Any,
    owner_uid: str,
    file_key: str,
    file_name: str,
    pdf_bytes: bytes,
) -> bool:
    import base64

    MAX_BYTES = 6_000_000
    CHUNK_CHAR_SIZE = 600_000
    clean_key = re.sub(r"[^a-zA-Z0-9_-]", "_", file_key)[:80] or "file_unknown"
    if not pdf_bytes or len(pdf_bytes) > MAX_BYTES:
        print(f"PDF {clean_key} saltato ({len(pdf_bytes)} bytes > limite 6 MB).")
        return False

    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    chunks = [b64[i : i + CHUNK_CHAR_SIZE] for i in range(0, len(b64), CHUNK_CHAR_SIZE)]
    if not chunks or len(chunks) > 16:
        return False

    user_ref = db_client.collection("users").document(owner_uid)
    files_col = user_ref.collection("vaultFiles")
    chunks_col = user_ref.collection("vaultFileChunks")

    meta_snap = files_col.document(clean_key).get()
    prev_chunks = int((meta_snap.to_dict() or {}).get("chunkCount", 0)) if meta_snap.exists else 0

    for start in range(0, len(chunks), 4):
        batch = db_client.batch()
        for offset, chunk_data in enumerate(chunks[start : start + 4]):
            idx = start + offset
            chunk_id = f"{clean_key}_chunk_{idx}"
            batch.set(
                chunks_col.document(chunk_id),
                {
                    "ownerId": owner_uid,
                    "fileKey": clean_key,
                    "chunkIndex": idx,
                    "data": chunk_data,
                    "createdAt": fb_firestore.SERVER_TIMESTAMP,
                },
            )
        batch.commit()

    final_batch = db_client.batch()
    final_batch.set(
        files_col.document(clean_key),
        {
            "ownerId": owner_uid,
            "fileKey": clean_key,
            "fileName": file_name.strip()[:140] or "bolletta.pdf",
            "mimeType": "application/pdf",
            "size": len(pdf_bytes),
            "chunkCount": len(chunks),
            "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        },
    )
    for surplus in range(len(chunks), prev_chunks):
        final_batch.delete(chunks_col.document(f"{clean_key}_chunk_{surplus}"))
    final_batch.commit()
    print(f"Archiviato PDF originale su Firestore Vault: {clean_key} ({len(pdf_bytes)} bytes, {len(chunks)} chunk)")
    return True


def main() -> None:
    db_client, fb_firestore, owner_id = init_firestore_admin()

    # Legge la tariffa reale configurata dall'utente su Firestore
    tariff = TARIFF_EUR_PER_KWH
    try:
        cfg_snap = (
            db_client.collection("users")
            .document(owner_id)
            .collection("homeConfig")
            .document("main")
            .get()
        )
        if cfg_snap.exists:
            raw_tariff = float((cfg_snap.to_dict() or {}).get("tariffEurPerKwh", tariff))
            if 0.05 <= raw_tariff <= 2.0:
                tariff = raw_tariff
    except Exception:
        pass

    print(f"Controllo Gmail (solo INBOX) -> Firestore diretto (POD {POD_CODE}, uid {owner_id})...")
    readings_by_msg, mail = extract_csvs_from_gmail()

    try:
        bills_by_msg = extract_edison_bills_from_gmail(mail)
        water_by_msg = extract_water_bills_from_gmail(mail)
        tari_by_msg = extract_tari_bills_from_gmail(mail)

        verified_msgs_to_delete: List[bytes] = []
        user_ref = db_client.collection("users").document(owner_id)

        # 1. Consumi e-distribuzione -> Firestore energyReadings (ignora i giorni già presenti su DB)
        readings_col = user_ref.collection("energyReadings")
        latest_db_date: Optional[str] = None
        if readings_by_msg:
            try:
                latest_docs = list(
                    readings_col.order_by("date", direction=fb_firestore.Query.DESCENDING)
                    .limit(1)
                    .stream()
                )
                if latest_docs:
                    raw_latest = str((latest_docs[0].to_dict() or {}).get("date", "")).strip()
                    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_latest):
                        latest_db_date = raw_latest
            except Exception as exc:
                print(f"Avviso controllo ultima data consumi su Firestore: {exc}")
            if latest_db_date:
                print(
                    f"Consumi già presenti su Firestore fino al {latest_db_date}: "
                    "verranno inseriti solo i consumi successivi."
                )

        pending_readings_by_date: Dict[str, Dict[str, Any]] = {}
        skipped_existing_count = 0
        for msg_id, msg_readings in readings_by_msg.items():
            valid_items = [
                r for r in msg_readings if re.match(r"^\d{4}-\d{2}-\d{2}$", str(r.get("date", "")))
            ]
            if not valid_items:
                continue
            msg_new_count = 0
            for r in valid_items:
                date_str = str(r["date"])
                if latest_db_date and date_str <= latest_db_date:
                    skipped_existing_count += 1
                    continue
                pending_readings_by_date[date_str] = r
                msg_new_count += 1
            if msg_new_count == 0 and latest_db_date:
                print(
                    f"Email consumi già coperta fino al {latest_db_date}: nessuna scrittura su Firestore."
                )
            verified_msgs_to_delete.append(msg_id)

        if pending_readings_by_date:
            items_to_save = [
                pending_readings_by_date[d] for d in sorted(pending_readings_by_date.keys())
            ]
            for i in range(0, len(items_to_save), 350):
                batch = db_client.batch()
                for r in items_to_save[i : i + 350]:
                    date_str = str(r["date"])
                    total_kwh = round(float(r.get("totalKwh", 0.0)), 2)
                    doc_id = f"day_{date_str.replace('-', '')}"
                    batch.set(
                        readings_col.document(doc_id),
                        {
                            "ownerId": owner_id,
                            "date": date_str,
                            "f1Kwh": round(float(r.get("f1Kwh", 0.0)), 2),
                            "f2Kwh": round(float(r.get("f2Kwh", 0.0)), 2),
                            "f3Kwh": round(float(r.get("f3Kwh", 0.0)), 2),
                            "totalKwh": total_kwh,
                            "peakKw": round(float(r.get("peakKw", 0.0)), 2),
                            "estimatedCostEur": round(total_kwh * tariff, 2),
                            "source": "e-distribuzione-api",
                            "createdAt": fb_firestore.SERVER_TIMESTAMP,
                        },
                    )
                batch.commit()
            extra_note = (
                f" (ignorate {skipped_existing_count} già presenti fino al {latest_db_date})"
                if skipped_existing_count > 0 and latest_db_date
                else ""
            )
            print(f"Salvate {len(items_to_save)} nuove giornate consumi su Firestore{extra_note}.")
        elif skipped_existing_count > 0 and latest_db_date:
            print(
                f"Nessun nuovo consumo dopo il {latest_db_date} "
                f"(ignorate {skipped_existing_count} righe già presenti: 0 scritture Firestore)."
            )

        # 2. Bollette Luce Edison -> Firestore electricityBills + Vault PDF (resta in INBOX, mai nel Cestino; salta se già presente)
        elec_col = user_ref.collection("electricityBills")
        vault_files_col = user_ref.collection("vaultFiles")
        for _msg_id, msg_bills in bills_by_msg.items():
            for b, pdf_bytes, file_name in msg_bills:
                inv = str(b.get("invoiceNumber", "")).strip()
                if not inv:
                    continue
                slug = re.sub(r"[^a-zA-Z0-9_-]", "", inv)
                doc_id = f"edison_{slug}"
                file_key = f"bill_elec_{slug}"
                if elec_col.document(doc_id).get().exists and vault_files_col.document(file_key).get().exists:
                    print(f"Bolletta Luce {inv} già presente su Firestore: salto riscrittura.")
                    continue
                vault_ok = save_pdf_to_vault_firestore(
                    db_client, fb_firestore, owner_id, file_key, file_name, pdf_bytes
                )
                if not vault_ok:
                    continue
                elec_col.document(doc_id).set(
                    {
                        "ownerId": owner_id,
                        "invoiceNumber": inv[:40],
                        "pdfFileKey": file_key,
                        "issueDate": str(b.get("issueDate", ""))[:20],
                        "sortKey": str(b.get("sortKey", ""))[:16],
                        "year": int(b.get("year", datetime.now(timezone.utc).year)),
                        "period": str(b.get("period", ""))[:80],
                        "supplier": str(b.get("supplier", "Edison Energia"))[:80],
                        "offerName": str(b.get("offerName", "EDISON DYNAMIC LUCE"))[:100],
                        "kwh": int(b.get("kwh", 0)),
                        "punText": str(b.get("punText", "—"))[:60],
                        "variableCostPerKwh": float(b.get("variableCostPerKwh", 0.0)),
                        "canoneTv": float(b.get("canoneTv", 0.0)),
                        "electricityOnly": float(b.get("electricityOnly", 0.0)),
                        "totalPaid": float(b.get("totalPaid", 0.0)),
                        "createdAt": fb_firestore.SERVER_TIMESTAMP,
                    }
                )
                print(f"Bolletta Luce {inv} salvata su Firestore (email conservata in INBOX).")

        # 3. Bollette Acqua Acegas -> Firestore waterBills + Vault PDF (resta in INBOX, mai nel Cestino; salta se già presente)
        water_col = user_ref.collection("waterBills")
        for _msg_id, msg_items in water_by_msg.items():
            for w, pdf_bytes, file_name in msg_items:
                inv = str(w.get("invoiceNumber", "")).strip()
                if not inv:
                    continue
                slug = re.sub(r"[^a-zA-Z0-9_-]", "", inv)
                doc_id = f"acegas_{slug}"
                file_key = f"bill_water_{slug}"
                if water_col.document(doc_id).get().exists and vault_files_col.document(file_key).get().exists:
                    print(f"Bolletta Acqua {inv} già presente su Firestore: salto riscrittura.")
                    continue
                vault_ok = save_pdf_to_vault_firestore(
                    db_client, fb_firestore, owner_id, file_key, file_name, pdf_bytes
                )
                if not vault_ok:
                    continue
                water_col.document(doc_id).set(
                    {
                        "ownerId": owner_id,
                        "invoiceNumber": inv[:40],
                        "pdfFileKey": file_key,
                        "issueDate": str(w.get("issueDate", ""))[:20],
                        "year": int(w.get("year", datetime.now(timezone.utc).year)),
                        "period": str(w.get("period", ""))[:80],
                        "cubicMeters": float(w.get("cubicMeters", 0.0)),
                        "fixedCostEur": float(w.get("fixedCostEur", 0.0)),
                        "totalPaid": float(w.get("totalPaid", 0.0)),
                        "note": str(w.get("note", ""))[:240],
                        "createdAt": fb_firestore.SERVER_TIMESTAMP,
                    }
                )
                print(f"Bolletta Acqua {inv} salvata su Firestore (email conservata in INBOX).")

        # 4. Avvisi TARI -> Firestore tariBills + Vault PDF (resta in INBOX, mai nel Cestino; salta se già presente)
        tari_col = user_ref.collection("tariBills")
        for _msg_id, msg_tari in tari_by_msg.items():
            for t, pdf_bytes, file_name in msg_tari:
                notice = str(t.get("noticeNumber", "")).strip()
                if not notice:
                    continue
                slug = re.sub(r"[^a-zA-Z0-9_-]", "", notice)
                doc_id = f"tari_{slug}"
                file_key = f"bill_tari_{slug}"
                if tari_col.document(doc_id).get().exists and vault_files_col.document(file_key).get().exists:
                    print(f"Avviso TARI {notice} già presente su Firestore: salto riscrittura.")
                    continue
                vault_ok = save_pdf_to_vault_firestore(
                    db_client, fb_firestore, owner_id, file_key, file_name, pdf_bytes
                )
                if not vault_ok:
                    continue
                tari_col.document(doc_id).set(
                    {
                        "ownerId": owner_id,
                        "noticeNumber": notice[:50],
                        "pdfFileKey": file_key,
                        "issueDate": str(t.get("issueDate", "—"))[:20],
                        "dueDate": str(t.get("dueDate", "—"))[:20],
                        "year": int(t.get("year", datetime.now(timezone.utc).year)),
                        "period": str(t.get("period", ""))[:80],
                        "supplier": str(t.get("supplier", "AcegasApsAmga (TARI)"))[:80],
                        "totalPaid": float(t.get("totalPaid", 0.0)),
                        "paid": bool(t.get("paid", False)),
                        "source": "gmail-pdf",
                        "note": str(t.get("note", ""))[:240],
                        "createdAt": fb_firestore.SERVER_TIMESTAMP,
                    }
                )
                print(f"Avviso TARI {notice} salvato su Firestore (email conservata in INBOX).")

        # 5. Sposta nel Cestino solo le email CSV e-distribuzione salvate (le bollette restano SEMPRE in INBOX)
        if verified_msgs_to_delete:
            delete_processed_emails(mail, list(set(verified_msgs_to_delete)))
        else:
            print("Nessuna email CSV e-distribuzione da spostare (le bollette restano sempre in INBOX).")
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
