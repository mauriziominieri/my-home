"""
my-home — Sync automatico Gmail INBOX 24/7 -> Firebase Firestore
(Eseguito ogni 10 minuti tramite GitHub Actions: .github/workflows/sync-gmail-consumi-bollette-tariffe.yml)

COSA FA QUESTO SCRIPT:
1. CONSUMI GIORNALIERI kWh (e-distribuzione):
   - Cerca in INBOX le email "Dettaglio curve di carico" (mittenti: notifichemailped@enel.com,
     e-distribuzione.it, e-distribuzione.com) con allegati .csv o .zip.
   - Calcola le fasce ARERA (F1, F2, F3), totale kWh e picco kW e salva i giorni mancanti
     su Firestore (`energyReadings`).
   - Sposta nel Cestino SOLO le email "Dettaglio curve di carico" già salvate.

2. BOLLETTE LUCE, ACQUA E TARI (MULTI-FORMATO):
   - Cerca in INBOX le email di bollette:
       • Luce (Edison Energia, Octopus Energy, Enel, Plenitude, ENGIE, ecc.)
       • Acqua (AcegasApsAmga / Servizio Idrico)
       • TARI / Tassa Rifiuti (AcegasApsAmga / Comune)
   - Supporta QUALSIASI formato inviino i fornitori:
       • Allegati PDF originali (inclusi dentro archivi .zip)
       • Allegati CSV / TSV, XML (FatturaPA), TXT, JSON, HTML (anche dentro .zip)
       • Testo/HTML del corpo email se il fornitore non allega file
     Se la bolletta arriva in formato non-PDF (es. CSV/XML/TXT/email), genera comunque
     un PDF riepilogativo leggibile e lo archivia nel Vault Firestore (`vaultFiles`), così
     risulta subito apribile e scaricabile nella sezione Bollette dell'app.
   - Le email delle bollette NON vengono MAI spostate nel Cestino.

3. AVVISI IMMEDIATI EMAIL + WHATSAPP:
   - Ogni volta che viene importata almeno una NUOVA bolletta (Luce, Acqua o TARI),
     invia subito una notifica riepilogativa sia via Email (Gmail SMTP) sia su WhatsApp
     (CallMeBot, usando i secrets CALLMEBOT_PHONE / CALLMEBOT_API_KEY o la config in app).

4. CONVIENE LASCIARLO ATTIVO INSIEME A `apps-script/sync_consumi_edistribuzione.js`? SÌ (consigliato):
   - Nessun conflitto né duplicati sui consumi kWh: entrambi controllano le sole date più
     recenti dell'ultima già salvata su `energyReadings`; il primo che legge l'email dalla
     INBOX salva i dati e la sposta nel Cestino, mentre l'altro non trova nulla (0 scritture).
   - Lasciarli entrambi attivi offre doppia sicurezza sui consumi giornalieri (Apps Script
     è più puntuale ogni 10 min e non usa App Password IMAP, mentre questo script su GitHub
     Actions funge da backup per i kWh ed è indispensabile per bollette, Vault PDF e avvisi;
     su repository GitHub pubblico i minuti di GitHub Actions sono gratuiti e illimitati).
"""

import csv
import email
import html as html_lib
import imaplib
import io
import json
import os
import re
import smtplib
import sys
import textwrap
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from email.header import decode_header
from email.message import EmailMessage
from typing import Any, Dict, List, Optional, Tuple

POD_CODE = os.environ.get("POD_CODE", "IT001E11251419")
TARIFF_EUR_PER_KWH = float(os.environ.get("TARIFF_EUR_PER_KWH", "0.24"))

IT_MONTHS_SHORT: Dict[str, str] = {
    "GEN": "01", "GENNAIO": "01",
    "FEB": "02", "FEBBRAIO": "02",
    "MAR": "03", "MARZO": "03",
    "APR": "04", "APRILE": "04",
    "MAG": "05", "MAGGIO": "05",
    "GIU": "06", "GIUGNO": "06",
    "LUG": "07", "LUGLIO": "07",
    "AGO": "08", "AGOSTO": "08",
    "SET": "09", "SETTEMBRE": "09",
    "OTT": "10", "OTTOBRE": "10",
    "NOV": "11", "NOVEMBRE": "11",
    "DIC": "12", "DICEMBRE": "12",
}

IT_MONTHS_DISPLAY = [
    "Gen", "Feb", "Mar", "Apr", "Mag", "Giu",
    "Lug", "Ago", "Set", "Ott", "Nov", "Dic",
]


def is_valid_pdf_bytes(raw: Optional[bytes]) -> bool:
    """Verifica che il payload inizi con l'intestazione binaria reale %PDF- (scarta HTML/testo/altro)."""
    if not raw or len(raw) < 8:
        return False
    return raw.lstrip().startswith(b"%PDF-")


def decode_mime_header(raw_val: Optional[str]) -> str:
    if not raw_val:
        return ""
    parts: List[str] = []
    for chunk, charset in decode_header(raw_val):
        if isinstance(chunk, bytes):
            enc = charset or "utf-8"
            try:
                parts.append(chunk.decode(enc, errors="replace"))
            except LookupError:
                parts.append(chunk.decode("utf-8", errors="replace"))
        else:
            parts.append(str(chunk))
    return "".join(parts).strip()


def decode_text_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def clean_html_to_text(raw_html: str) -> str:
    txt = re.sub(r"<script[^>]*>.*?</script>", " ", raw_html, flags=re.IGNORECASE | re.DOTALL)
    txt = re.sub(r"<style[^>]*>.*?</style>", " ", txt, flags=re.IGNORECASE | re.DOTALL)
    txt = re.sub(r"<(?:br|p|div|tr|li|h\d)[^>]*>", "\n", txt, flags=re.IGNORECASE)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = html_lib.unescape(txt)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in txt.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def extract_xml_text(raw_xml: str) -> str:
    """Estrae campi leggibili da XML generici e da FatturaPA elettronica."""
    # Rimuove eventuali byte non XML (es. busta .p7m semplice) prima della prima '<'
    first_lt = raw_xml.find("<")
    last_gt = raw_xml.rfind(">")
    candidate = raw_xml[first_lt : last_gt + 1] if first_lt != -1 and last_gt > first_lt else raw_xml
    try:
        root = ET.fromstring(candidate)
    except ET.ParseError:
        stripped = re.sub(r"<[^>]+>", " ", candidate)
        return re.sub(r"\s+", " ", html_lib.unescape(stripped)).strip()

    lines: List[str] = []
    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        val = (elem.text or "").strip()
        if not val:
            continue
        low_tag = tag.lower()
        if low_tag in (
            "numero",
            "data",
            "importototaledocumento",
            "denominazione",
            "descrizione",
            "quantita",
            "unitamisura",
            "prezzototale",
            "datascadenzapagamento",
            "datainizioperiodo",
            "datafineperiodo",
            "importopagamento",
            "causale",
        ):
            lines.append(f"{tag}: {val}")
        else:
            lines.append(val)
    return "\n".join(lines)


def build_summary_pdf_bytes(title: str, lines: List[str]) -> bytes:
    """
    Genera un PDF valido (%PDF-1.4) leggibile da qualsiasi viewer e da pypdf/pdfjs,
    usato quando il fornitore invia una bolletta in formato non-PDF (CSV/XML/TXT/Email).
    """

    def _pdf_safe(s: str) -> str:
        s = (
            s.replace("€", "EUR")
            .replace("–", "-")
            .replace("—", "-")
            .replace("’", "'")
            .replace("‘", "'")
            .replace("“", '"')
            .replace("”", '"')
            .replace("³", "3")
        )
        encoded = s.encode("cp1252", errors="replace").decode("cp1252", errors="replace")
        return encoded.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    wrapped: List[str] = []
    for ln in lines:
        clean_ln = re.sub(r"\s+", " ", str(ln or "")).strip()
        if not clean_ln:
            wrapped.append("")
            continue
        wrapped.extend(textwrap.wrap(clean_ln, width=88, break_long_words=True, break_on_hyphens=False))

    lines_per_page = 46
    pages_lines: List[List[str]] = [
        wrapped[i : i + lines_per_page] for i in range(0, max(1, len(wrapped)), lines_per_page)
    ]

    # Oggetti PDF: 1=Catalog, 2=Pages, 3=Font, poi per ogni pagina (Page + Content)
    objects: List[bytes] = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    page_ids = [4 + idx * 2 for idx in range(len(pages_lines))]
    kids_str = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects.append(f"2 0 obj\n<< /Type /Pages /Kids [{kids_str}] /Count {len(page_ids)} >>\nendobj\n".encode("ascii"))
    objects.append(b"3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n")

    for p_idx, p_lines in enumerate(pages_lines):
        page_obj_id = 4 + p_idx * 2
        content_obj_id = page_obj_id + 1
        stream_cmds: List[str] = ["BT", "/F1 13 Tf", "42 795 Td"]
        if p_idx == 0:
            stream_cmds.append(f"({_pdf_safe(title[:90])}) Tj")
            stream_cmds.append("0 -22 Td")
            stream_cmds.append("/F1 9.5 Tf")
        else:
            stream_cmds.append("/F1 9.5 Tf")
            stream_cmds.append(f"({_pdf_safe(title[:70])} (pag. {p_idx + 1})) Tj")
            stream_cmds.append("0 -20 Td")

        for ln in p_lines:
            stream_cmds.append(f"({_pdf_safe(ln)}) Tj")
            stream_cmds.append("0 -15 Td")
        stream_cmds.append("ET")
        stream_bytes = "\n".join(stream_cmds).encode("cp1252", errors="replace")

        objects.append(
            f"{page_obj_id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_obj_id} 0 R >>\nendobj\n".encode("ascii")
        )
        objects.append(
            f"{content_obj_id} 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
            + stream_bytes
            + b"\nendstream\nendobj\n"
        )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: List[int] = [0]
    for obj in objects:
        offsets.append(len(out))
        out.extend(obj)

    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    out.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    )
    return bytes(out)


def parse_it_float(raw: Optional[str]) -> float:
    if not raw:
        return 0.0
    cleaned = str(raw).strip().replace('"', "").replace("€", "").replace(" ", "")
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        val = float(cleaned)
        return val if val >= 0 else 0.0
    except ValueError:
        return 0.0


def normalize_bill_identity(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


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

    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", cleaned)
    if m:
        return _valid_iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", cleaned)
    if m:
        p1, p2, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if prefer_mdy:
            return _valid_iso(y, p1, p2) or _valid_iso(y, p2, p1)
        return _valid_iso(y, p2, p1) or _valid_iso(y, p1, p2)
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
    for ln in lines[:10]:
        if ln.count(";") >= 10:
            delimiter = ";"
            break

    results: List[Dict[str, Any]] = []
    reader = list(csv.reader(lines, delimiter=delimiter))

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

    for row in reader:
        if len(row) < 2:
            continue

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


def imap_search_union(
    mail: imaplib.IMAP4_SSL, queries: List[str], max_results: int = 25
) -> List[bytes]:
    """Esegue più query IMAP semplici in INBOX e restituisce gli ID univoci più recenti."""
    seen: set[bytes] = set()
    ordered: List[bytes] = []
    mail.select("INBOX")
    for q in queries:
        try:
            status, data = mail.search(None, q)
            if status != "OK" or not data or not data[0]:
                continue
            for mid in data[0].split()[-max_results:]:
                if mid not in seen:
                    seen.add(mid)
                    ordered.append(mid)
        except Exception as exc:
            print(f"Nota ricerca IMAP '{q}': {exc}")
    ordered.sort(key=lambda x: int(x) if x.isdigit() else 0)
    return ordered[-max_results:]


def extract_csvs_from_gmail() -> Tuple[Dict[bytes, List[Dict[str, Any]]], Optional[imaplib.IMAP4_SSL]]:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        raise RuntimeError("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti su GitHub.")

    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(gmail_user, gmail_pass)
    mail.select("INBOX")

    msg_ids = imap_search_union(
        mail,
        [
            'FROM "notifichemailped@enel.com"',
            'FROM "e-distribuzione.it"',
            'FROM "e-distribuzione.com"',
            'SUBJECT "Dettaglio curve di carico"',
        ],
        max_results=20,
    )
    if not msg_ids:
        print("Nessuna email 'Dettaglio curve di carico' trovata nella INBOX.")
        return {}, mail

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
            filename = decode_mime_header(part.get_filename()).strip().lower()
            if not filename:
                continue

            try:
                payload = part.get_payload(decode=True)
                if not payload:
                    continue

                if filename.endswith(".csv"):
                    print(f"Elaborazione allegato CSV consumi: {filename}")
                    msg_readings.extend(parse_csv_content(decode_text_bytes(payload)))
                elif filename.endswith(".zip"):
                    print(f"Elaborazione allegato ZIP consumi: {filename}")
                    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                        for name in zf.namelist():
                            if name.lower().endswith(".csv"):
                                msg_readings.extend(parse_csv_content(decode_text_bytes(zf.read(name))))
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
                mail.store(msg_id, "+X-GM-LABELS", "\\Trash")
                mail.store(msg_id, "+FLAGS", "\\Deleted")
            mail.expunge()
            print(f"Eliminate {len(msg_ids)} email e-distribuzione elaborate dalla INBOX (spostate nel Cestino).")
    finally:
        try:
            mail.logout()
        except Exception:
            pass


def _extract_pdf_text_bytes(pdf_bytes: bytes, max_pages: int = 4) -> str:
    if not is_valid_pdf_bytes(pdf_bytes):
        return ""
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join((page.extract_text() or "") for page in reader.pages[:max_pages])
    except Exception:
        return ""


def _parse_text_source_entry(
    raw_bytes: bytes, raw_name: str, content_type: str
) -> Optional[Dict[str, Any]]:
    lower_name = (raw_name or "").lower()
    lower_ct = (content_type or "").lower()

    if lower_name.endswith(".pdf") or lower_ct == "application/pdf":
        if is_valid_pdf_bytes(raw_bytes):
            txt = _extract_pdf_text_bytes(raw_bytes)
            if txt.strip():
                return {
                    "format": "pdf",
                    "file_name": raw_name or "bolletta.pdf",
                    "text": txt,
                    "pdf_bytes": raw_bytes,
                }
        return None

    if lower_name.endswith((".xml", ".p7m")) or "xml" in lower_ct:
        xml_txt = extract_xml_text(decode_text_bytes(raw_bytes))
        if xml_txt.strip():
            return {
                "format": "xml",
                "file_name": raw_name or "fattura.xml",
                "text": xml_txt,
                "pdf_bytes": None,
            }
        return None

    if lower_name.endswith((".csv", ".tsv")) or lower_ct in ("text/csv", "application/csv"):
        csv_txt = decode_text_bytes(raw_bytes)
        if csv_txt.strip():
            return {
                "format": "csv",
                "file_name": raw_name or "bolletta.csv",
                "text": csv_txt,
                "pdf_bytes": None,
            }
        return None

    if lower_name.endswith(".json") or lower_ct == "application/json":
        json_txt = decode_text_bytes(raw_bytes)
        if json_txt.strip():
            return {
                "format": "json",
                "file_name": raw_name or "bolletta.json",
                "text": json_txt,
                "pdf_bytes": None,
            }
        return None

    if lower_name.endswith((".html", ".htm")) or lower_ct == "text/html":
        html_txt = clean_html_to_text(decode_text_bytes(raw_bytes))
        if html_txt.strip():
            return {
                "format": "html",
                "file_name": raw_name or "bolletta.html",
                "text": html_txt,
                "pdf_bytes": None,
            }
        return None

    if lower_name.endswith((".txt", ".log", ".eml")) or lower_ct.startswith("text/plain"):
        plain_txt = decode_text_bytes(raw_bytes)
        if plain_txt.strip():
            return {
                "format": "txt",
                "file_name": raw_name or "bolletta.txt",
                "text": plain_txt,
                "pdf_bytes": None,
            }
        return None

    return None


def collect_bill_sources_from_email(msg: email.message.Message) -> List[Dict[str, Any]]:
    """
    Estrae tutte le sorgenti leggibili da una email bolletta nell'ordine:
    1) Allegati PDF (anche dentro ZIP)
    2) Allegati CSV / XML / TXT / JSON / HTML (anche dentro ZIP)
    3) Corpo testo/HTML della email (fallback se non c'è alcun allegato utile)
    """
    pdf_sources: List[Dict[str, Any]] = []
    other_sources: List[Dict[str, Any]] = []
    plain_bodies: List[str] = []
    html_bodies: List[str] = []

    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        raw_name = decode_mime_header(part.get_filename()).strip()
        lower_name = raw_name.lower()
        ct = (part.get_content_type() or "").lower()
        disp = (part.get_content_disposition() or "").lower()

        try:
            payload = part.get_payload(decode=True)
        except Exception:
            payload = None
        if not payload:
            continue

        if lower_name.endswith(".zip") or ct == "application/zip":
            try:
                with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                    for z_name in zf.namelist():
                        if z_name.endswith("/"):
                            continue
                        z_bytes = zf.read(z_name)
                        entry = _parse_text_source_entry(z_bytes, os.path.basename(z_name), "")
                        if entry:
                            if entry["format"] == "pdf":
                                pdf_sources.append(entry)
                            else:
                                other_sources.append(entry)
            except Exception as exc:
                print(f"ZIP bolletta ignorato ({raw_name}): {exc}")
            continue

        if raw_name or disp == "attachment" or ct == "application/pdf":
            entry = _parse_text_source_entry(payload, raw_name, ct)
            if entry:
                if entry["format"] == "pdf":
                    pdf_sources.append(entry)
                else:
                    other_sources.append(entry)
                continue

        if ct == "text/plain" and not raw_name:
            plain_bodies.append(decode_text_bytes(payload))
        elif ct == "text/html" and not raw_name:
            html_bodies.append(clean_html_to_text(decode_text_bytes(payload)))

    sources = pdf_sources + other_sources
    body_text = "\n".join(b.strip() for b in (plain_bodies or html_bodies) if b.strip())
    if body_text:
        sources.append(
            {
                "format": "email-body",
                "file_name": "corpo_email.txt",
                "text": body_text,
                "pdf_bytes": None,
            }
        )
    return sources


def is_contract_document(text: str, file_name: str, subject: str = "") -> bool:
    hay = f"{file_name}\n{subject}\n{text[:5000]}".lower()
    contract_signal = (
        "contratt" in file_name.lower()
        or bool(
            re.search(
                r"\b(proposta\s+di\s+contratto|contratto\s+di\s+fornitura|modulo\s+di\s+adesione)\b",
                hay,
            )
        )
    )
    bill_signal = bool(
        re.search(
            r"\b(bolletta|fattura|totale\s+da\s+pagare|importo\s+da\s+pagare|consumo\s+fatturato)\b",
            hay,
        )
    )
    return contract_signal and not bill_signal


def extract_sort_key_and_year(text: str, issue_date: str) -> Tuple[int, str, str]:
    dm = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", issue_date.strip())
    im = re.match(r"^(20\d{2})[-/](\d{2})[-/]\d{2}$", issue_date.strip())
    year = int(dm.group(3)) if dm else (int(im.group(1)) if im else datetime.now(timezone.utc).year)
    month = dm.group(2) if dm else (im.group(2) if im else datetime.now(timezone.utc).strftime("%m"))

    m_range = re.search(
        r"\b(GEN(?:NAIO)?|FEB(?:BRAIO)?|MAR(?:ZO)?|APR(?:ILE)?|MAG(?:GIO)?|GIU(?:GNO)?|"
        r"LUG(?:LIO)?|AGO(?:STO)?|SET(?:TEMBRE)?|OTT(?:OBRE)?|NOV(?:EMBRE)?|DIC(?:EMBRE)?)"
        r"\s+(20\d{2})\s*[-–]\s*"
        r"(GEN(?:NAIO)?|FEB(?:BRAIO)?|MAR(?:ZO)?|APR(?:ILE)?|MAG(?:GIO)?|GIU(?:GNO)?|"
        r"LUG(?:LIO)?|AGO(?:STO)?|SET(?:TEMBRE)?|OTT(?:OBRE)?|NOV(?:EMBRE)?|DIC(?:EMBRE)?)"
        r"\s+(20\d{2})\b",
        text,
        re.IGNORECASE,
    )
    if m_range:
        year = int(m_range.group(4))
        month = IT_MONTHS_SHORT.get(m_range.group(3).upper(), month)
        return (
            year,
            f"{year}-{month}",
            f"{m_range.group(1)[:3].title()} {m_range.group(2)} – {m_range.group(3)[:3].title()} {m_range.group(4)}",
        )

    d_range = re.search(
        r"(?:periodo(?:\s+di\s+fatturazione)?|dal)\s*[:.]?\s*(\d{2}/\d{2}/\d{4})\s*(?:al|-|–)\s*(\d{2}/\d{2}/\d{4})",
        text,
        re.IGNORECASE,
    )
    if d_range:
        sp = d_range.group(1).split("/")
        ep = d_range.group(2).split("/")
        if len(sp) == 3 and len(ep) == 3:
            year = int(ep[2])
            month = ep[1]
            s_lbl = f"{IT_MONTHS_DISPLAY[max(0, min(11, int(sp[1]) - 1))]} {sp[2]}"
            e_lbl = f"{IT_MONTHS_DISPLAY[max(0, min(11, int(ep[1]) - 1))]} {ep[2]}"
            return year, f"{year}-{month}", s_lbl if s_lbl == e_lbl else f"{s_lbl} – {e_lbl}"

    single_m = re.search(
        r"(?:mese\s+di|competenza|periodo)\s*[:.]?\s*"
        r"(gen(?:naio)?|feb(?:braio)?|mar(?:zo)?|apr(?:ile)?|mag(?:gio)?|giu(?:gno)?|"
        r"lug(?:lio)?|ago(?:sto)?|set(?:tembre)?|ott(?:obre)?|nov(?:embre)?|dic(?:embre)?)\s+(20\d{2})",
        text,
        re.IGNORECASE,
    )
    if single_m:
        year = int(single_m.group(2))
        month = IT_MONTHS_SHORT.get(single_m.group(1).upper(), month)
        return year, f"{year}-{month}", f"{single_m.group(1)[:3].title()} {year}"

    return year, f"{year}-{month}", f"Fattura {issue_date}" if issue_date and issue_date != "—" else f"Bolletta {year}"


def detect_electricity_supplier(text: str, file_name: str, from_addr: str = "") -> Tuple[str, str]:
    hay = f"{from_addr}\n{file_name}\n{text[:4000]}".lower()
    if "octopus" in hay:
        return "Octopus Energy", "Octopus Fissa 24M"
    if "edison" in hay:
        return "Edison Energia", "EDISON DYNAMIC LUCE"
    if "enel" in hay:
        return "Enel Energia", "Offerta Enel Luce"
    if "plenitude" in hay or "eni " in hay:
        return "Eni Plenitude", "Fixa / Trend Luce"
    if "engie" in hay:
        return "ENGIE", "Energia PuntoFisso"
    if "sorgenia" in hay:
        return "Sorgenia", "Next Energy Luce"
    if "nen.it" in hay or " nen " in hay:
        return "NeN", "Luce Prezzo Bloccato"
    if "a2a" in hay:
        return "A2A Energia", "A2A Luce"
    if "hera" in hay:
        return "Hera Comm", "Hera Luce"
    if "acea" in hay:
        return "Acea Energia", "Acea Luce"
    if "illumia" in hay:
        return "Illumia", "Illumia Luce"
    return "Fornitore Luce", "Offerta Energia Elettrica"


def parse_structured_csv_bill_text(
    text: str, forced_kind: Optional[str] = None, file_name: str = ""
) -> Optional[Dict[str, Any]]:
    """Tenta il parsing di un CSV tabellare (es. fattura;data;periodo;kwh;totale) prima del fallback testuale."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    sep = ";" if lines[0].count(";") >= lines[0].count(",") else ","
    if sep not in lines[0]:
        return None
    try:
        rows = list(csv.reader(lines, delimiter=sep))
    except Exception:
        return None
    if len(rows) < 2:
        return None
    headers = [h.strip().lower().replace('"', "") for h in rows[0]]
    bill_cols = ("fattura", "invoice", "avviso", "totale", "total", "importo", "kwh", "mc", "m3", "tari")
    if not any(any(k in h for k in bill_cols) for h in headers):
        return None

    def _idx(keys: Tuple[str, ...]) -> int:
        for i, h in enumerate(headers):
            if any(k in h for k in keys):
                return i
        return -1

    i_inv = _idx(("fattura", "invoice", "avviso", "numero"))
    i_date = _idx(("data", "emissione", "date"))
    i_period = _idx(("periodo", "period"))
    i_supp = _idx(("fornitore", "supplier", "ente"))
    i_kwh = _idx(("kwh", "consumo"))
    i_mc = _idx(("mc", "m3", "m³", "metri"))
    i_tot = _idx(("totale", "total", "importo"))
    i_tv = _idx(("canone", "tv"))
    i_due = _idx(("scadenza", "due"))
    i_year = _idx(("anno", "year"))

    for cols in rows[1:]:
        if not any(c.strip() for c in cols):
            continue

        def _col(ix: int) -> str:
            return cols[ix].strip() if 0 <= ix < len(cols) else ""

        total_paid = round(parse_it_float(_col(i_tot)), 2) if i_tot >= 0 else 0.0
        if total_paid <= 0:
            continue
        issue_date = _col(i_date) or datetime.now(timezone.utc).strftime("%d/%m/%Y")
        period_val = _col(i_period)
        year, sort_key, derived_period = extract_sort_key_and_year(
            f"periodo {period_val}\n{' '.join(cols)}", issue_date
        )
        if i_year >= 0 and _col(i_year).isdigit():
            year = int(_col(i_year))

        if forced_kind == "tari":
            notice = _col(i_inv) or f"TARI_{year}_{int(total_paid * 100)}"
            return {
                "noticeNumber": notice[:50],
                "issueDate": issue_date[:20],
                "dueDate": (_col(i_due) or issue_date)[:20],
                "year": year,
                "period": (period_val or f"TARI {year} – Avviso CSV")[:80],
                "supplier": (_col(i_supp) or "AcegasApsAmga (TARI)")[:80],
                "totalPaid": total_paid,
                "paid": False,
                "source": "gmail-pdf",
                "note": f"Importata da CSV ({file_name})"[:240],
            }

        if forced_kind == "acqua":
            inv = _col(i_inv) or f"H2O_{year}_{int(total_paid * 100)}"
            return {
                "invoiceNumber": inv[:40],
                "issueDate": issue_date[:20],
                "year": year,
                "period": (period_val or derived_period)[:80],
                "cubicMeters": round(parse_it_float(_col(i_mc)), 1) if i_mc >= 0 else 0.0,
                "fixedCostEur": 0.0,
                "totalPaid": total_paid,
                "note": f"Importata da CSV ({file_name})"[:240],
            }

        canone_tv = round(parse_it_float(_col(i_tv)), 2) if i_tv >= 0 else 0.0
        kwh = int(round(parse_it_float(_col(i_kwh)))) if i_kwh >= 0 else 0
        electricity_only = round(max(0.0, total_paid - canone_tv), 2)
        supplier = _col(i_supp) or detect_electricity_supplier(" ".join(cols), file_name)[0]
        inv = _col(i_inv) or f"IMP_{year}_{int(total_paid * 100)}"
        return {
            "invoiceNumber": inv[:40],
            "issueDate": issue_date[:20],
            "sortKey": sort_key[:16],
            "year": year,
            "period": (period_val or derived_period)[:80],
            "supplier": supplier[:80],
            "offerName": "Importata CSV",
            "kwh": kwh,
            "punText": "—",
            "variableCostPerKwh": round(electricity_only / kwh, 3) if kwh > 0 and electricity_only > 0 else 0.16,
            "canoneTv": canone_tv,
            "electricityOnly": electricity_only,
            "totalPaid": total_paid,
            "note": f"Importata da CSV ({file_name})"[:240],
        }
    return None


def parse_edison_text(text: str) -> Optional[Dict[str, Any]]:
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

    end_m = re.search(r"-\s*([A-Z]{3})\s+(\d{4})", raw_period, re.IGNORECASE)
    if end_m:
        year = int(end_m.group(2))
        mm = IT_MONTHS_SHORT.get(end_m.group(1).upper(), "01")
        sort_key = f"{year}-{mm}"
    else:
        parts = issue_date.split("/")
        year = int(parts[2])
        sort_key = f"{parts[2]}-{parts[1]}"

    kwh_m = re.search(r"(\d+(?:\.\d+)?)\s*kWh\s+0,\d+\s*€/kWh", text)
    if not kwh_m:
        kwh_m = re.search(r"TOTALI\s+(\d+(?:\.\d+)?)\s*kWh", text, re.IGNORECASE)
    kwh = int(round(parse_it_float(kwh_m.group(1)))) if kwh_m else 0

    var_m = re.search(r"\d+\s*kWh\s+(0,\d+)\s*€/kWh", text)
    var_net = parse_it_float(var_m.group(1)) if var_m else 0.0
    variable_cost_incl_vat = round((var_net + 0.0227) * 1.10, 3) if var_net > 0 else 0.0

    tot_m = re.search(r"TOTALE\s+DA\s+PAGARE\s+([\d.,]+)\s*€", text, re.IGNORECASE)
    total_paid = round(parse_it_float(tot_m.group(1)), 2) if tot_m else 0.0

    tv_m = re.search(r"Canone\s+di\s+abbonamento\s+alla\s+televisione[^\n]*?([\d.,]+)\s*€", text, re.IGNORECASE)
    canone_tv = round(parse_it_float(tv_m.group(1)), 2) if tv_m else 0.0

    elec_m = re.search(r"TOTALE\s+BOLLETTA\s+([\d.,]+)\s*€", text, re.IGNORECASE)
    electricity_only = (
        round(parse_it_float(elec_m.group(1)), 2)
        if elec_m
        else round(max(0.0, total_paid - canone_tv), 2)
    )

    puns = re.findall(r"\d{2}/\d{4}\s+(0,\d{4,6})", text)
    pun_vals = [f"{parse_it_float(p):.3f}".replace(".", ",") for p in puns[:2]]
    pun_text = f"{' / '.join(pun_vals)} €" if pun_vals else "—"

    offer_m = re.search(r"Nome\s+Offerta:\s*([^\n]+)", text, re.IGNORECASE)
    offer_name = offer_m.group(1).strip() if offer_m else "EDISON DYNAMIC LUCE"

    return {
        "invoiceNumber": invoice_number[:40],
        "issueDate": issue_date[:20],
        "sortKey": sort_key,
        "year": year,
        "period": raw_period.title().replace(" - ", " – ")[:80],
        "supplier": "Edison Energia",
        "offerName": offer_name[:100],
        "kwh": kwh,
        "punText": pun_text[:60],
        "variableCostPerKwh": variable_cost_incl_vat,
        "canoneTv": canone_tv,
        "electricityOnly": electricity_only,
        "totalPaid": total_paid,
    }


def _extract_doc_number(text: str, extra_labels: Tuple[str, ...]) -> str:
    patterns = [
        rf"(?:{'|'.join(extra_labels)})(?:\s+[a-z0-9]{{2,14}}){{0,3}}\s*(?:n\.?|numero|n°)\s*[:#]?\s*([A-Z0-9/_-]{{4,35}})",
        rf"(?:{'|'.join(extra_labels)})\s*(?:elettronica)?\s*[:#]?\s*([A-Z0-9/_-]{{4,35}})",
        r"\b(?:n°|numero(?:\s+(?:avviso|fattura|documento))?)\s*[:#.]?\s*([A-Z0-9/_-]{4,35})",
        r"(?:^|\n)\s*Numero\s*[:#]\s*([A-Z0-9/_-]{4,35})",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            cand = m.group(1).strip()
            if re.search(r"\d", cand) and not re.match(r"^(20\d{2}|\d{2}/\d{2}/\d{4})$", cand):
                return cand
    return ""


def _extract_issue_date(text: str) -> str:
    issue_m = re.search(
        r"(?:data\s+(?:di\s+)?emissione|emess[oa]\s+il|del)\s*[:.]?\s*(\d{2}/\d{2}/\d{4})",
        text,
        re.IGNORECASE,
    )
    if issue_m:
        return issue_m.group(1)
    iso_m = re.search(r"(?:^|\n|\b)Data\s*[:#]\s*(20\d{2})-(\d{2})-(\d{2})\b", text, re.IGNORECASE)
    if iso_m:
        return f"{iso_m.group(3)}/{iso_m.group(2)}/{iso_m.group(1)}"
    all_dates = re.findall(r"\b(\d{2}/\d{2}/\d{4})\b", text)
    if all_dates:
        return all_dates[0]
    all_iso = re.findall(r"\b(20\d{2})-(\d{2})-(\d{2})\b", text)
    if all_iso:
        return f"{all_iso[0][2]}/{all_iso[0][1]}/{all_iso[0][0]}"
    return datetime.now(timezone.utc).strftime("%d/%m/%Y")


def parse_electricity_bill_text(
    text: str,
    file_name: str,
    source_format: str,
    msg_subject: str = "",
    msg_from: str = "",
    msg_date: str = "",
) -> Optional[Dict[str, Any]]:
    combined = f"{msg_subject}\n{text}".strip()
    if not combined:
        return None
    if is_contract_document(combined, file_name, msg_subject):
        return None

    low = f"{msg_from}\n{msg_subject}\n{file_name}\n{text[:4000]}".lower()
    if "Dettaglio curve di carico".lower() in low or "fornutait" in low:
        return None
    if ("tari" in low or "tassa rifiuti" in low or "servizio idrico" in low or "acquedotto" in low) and "kwh" not in low:
        return None

    # Richiede almeno un chiaro segnale luce (fornitore elettrico oppure kWh / POD / energia elettrica)
    elec_markers = (
        "edison", "octopus", "enel energia", "plenitude", "engie", "sorgenia",
        "a2a energia", "hera comm", "acea energia", "illumia",
        "kwh", "it001e", "energia elettrica", "servizio elettrico", "canone tv", "fornitura luce",
    )
    if not any(m in low for m in elec_markers):
        return None

    if source_format == "csv":
        csv_parsed = parse_structured_csv_bill_text(text, forced_kind="luce", file_name=file_name)
        if csv_parsed:
            return csv_parsed

    if "edison" in low:
        edison = parse_edison_text(text)
        if edison:
            if source_format != "pdf":
                edison["note"] = f"Importata da {source_format.upper()} ({file_name})"[:240]
            return edison

    supplier, default_offer = detect_electricity_supplier(combined, file_name, msg_from)
    invoice_number = _extract_doc_number(combined, ("fattura", "bolletta", "documento", r"codice\s+fattura"))
    issue_date = _extract_issue_date(combined)

    tot_patterns = (
        r"(?:totale\s+da\s+pagare|importo\s+totale\s+da\s+pagare|totale\s+fattura|importo\s+fattura|totale\s+addebito|ImportoTotaleDocumento)\s*[:€\s]*([\d.,]+)",
        r"totale\s*[:€\s]+([\d]{1,4}[.,]\d{2})\s*€?",
        r"€\s*([\d]{1,4}[.,]\d{2})",
    )
    total_paid = 0.0
    for pat in tot_patterns:
        m = re.search(pat, combined, re.IGNORECASE)
        if m:
            cand = round(parse_it_float(m.group(1)), 2)
            if 0 < cand < 20000:
                total_paid = cand
                break

    kwh_patterns = (
        r"(?:energia\s+fatturata|consumo\s+totale|consumo\s+fatturato|totale\s+kwh|energia\s+attiva)\s*[:\s]*([\d.,]+)\s*kWh",
        r"([\d]{1,5}(?:[.,]\d+)?)\s*kWh\b",
    )
    kwh = 0
    for pat in kwh_patterns:
        m = re.search(pat, combined, re.IGNORECASE)
        if m:
            cand = int(round(parse_it_float(m.group(1))))
            if 0 < cand < 50000:
                kwh = cand
                break

    # Scarta email promozionali/informative senza alcun importo né consumo + numero fattura
    if total_paid <= 0:
        return None
    if not invoice_number and kwh <= 0:
        return None

    year, sort_key, period = extract_sort_key_and_year(combined, issue_date)
    if not invoice_number:
        supp_tag = normalize_bill_identity(supplier)[:6].upper() or "LUCE"
        invoice_number = f"{supp_tag}_{sort_key.replace('-', '')}_{int(round(total_paid * 100))}"

    tv_m = re.search(
        r"canone(?:\s+di\s+abbonamento)?(?:\s+alla)?\s*(?:tv|rai|televisione)[^\n\r]{0,60}?([\d]{1,3}[.,]\d{2})\s*€?",
        combined,
        re.IGNORECASE,
    )
    canone_tv = round(parse_it_float(tv_m.group(1)), 2) if tv_m else 0.0
    electricity_only = round(max(0.0, total_paid - canone_tv), 2)

    var_m = re.search(r"(0[.,]\d{3,5})\s*€\s*/\s*kWh", combined, re.IGNORECASE)
    if var_m:
        variable_cost = round(parse_it_float(var_m.group(1)), 3)
    elif kwh > 0 and electricity_only > 0:
        variable_cost = round(electricity_only / kwh, 3)
    else:
        variable_cost = 0.16

    pun_m = re.search(r"\bPUN\b[^\n]{0,30}(0[.,]\d{3,5})", combined, re.IGNORECASE)
    pun_text = f"{parse_it_float(pun_m.group(1)):.3f}".replace(".", ",") + " €" if pun_m else ("Fissa" if "fiss" in low else "—")

    offer_m = re.search(r"(?:nome\s+offerta|offerta|tariffa)\s*[:\-]\s*([^\n]{3,60})", combined, re.IGNORECASE)
    offer_name = offer_m.group(1).strip()[:100] if offer_m else default_offer

    note = f"Importata da {source_format.upper()} ({file_name})"
    if msg_date:
        note += f" · {msg_date[:16]}"

    return {
        "invoiceNumber": invoice_number[:40],
        "issueDate": issue_date[:20],
        "sortKey": sort_key[:16],
        "year": year,
        "period": period[:80],
        "supplier": supplier[:80],
        "offerName": offer_name[:100],
        "kwh": kwh,
        "punText": pun_text[:60],
        "variableCostPerKwh": variable_cost,
        "canoneTv": canone_tv,
        "electricityOnly": electricity_only,
        "totalPaid": total_paid,
        "note": note[:240],
    }


def parse_tari_bill_text(
    text: str,
    file_name: str,
    source_format: str,
    msg_subject: str = "",
    msg_date: str = "",
) -> Optional[Dict[str, Any]]:
    combined = f"{msg_subject}\n{text}".strip()
    if not combined:
        return None
    low = f"{file_name}\n{combined[:5000]}".lower()
    if not any(k in low for k in ("tari", "tassa rifiuti", "tassa sui rifiuti", "tributo rifiuti")):
        return None

    if source_format == "csv":
        csv_parsed = parse_structured_csv_bill_text(text, forced_kind="tari", file_name=file_name)
        if csv_parsed:
            return csv_parsed

    notice_number = _extract_doc_number(combined, (r"avviso(?:\s+di\s+pagamento)?", "documento", r"codice\s+avviso"))

    issue_date = _extract_issue_date(combined)
    due_m = re.search(r"(?:scadenza|entro\s+il|pagare\s+entro\s+il)\s*[:.]?\s*(\d{2}/\d{2}/\d{4})", combined, re.IGNORECASE)
    all_dates = re.findall(r"\b(\d{2}/\d{2}/\d{4})\b", combined)
    due_date = due_m.group(1) if due_m else (all_dates[-1] if all_dates else issue_date)

    year_m = re.search(r"TARI\s+(20\d{2})", combined, re.IGNORECASE) or re.search(
        r"Anno(?:\s+d['’]imposta)?\s*[:.]?\s*(20\d{2})", combined, re.IGNORECASE
    )
    if year_m:
        year = int(year_m.group(1))
    elif "/" in due_date:
        year = int(due_date.split("/")[-1])
    else:
        year = datetime.now(timezone.utc).year

    amount_patterns = (
        r"(?:TOTALE\s+DA\s+PAGARE|IMPORTO\s+DA\s+PAGARE|TOTALE\s+AVVISO|TOTALE\s+DOVUTO|ImportoTotaleDocumento)\s*[:€\s]*([\d.,]+)",
        r"(?:Importo|Totale)\s*[:\s]*€?\s*([\d.,]+)\s*€?",
        r"€\s*([\d]{1,4}[.,]\d{2})",
    )
    total_paid = 0.0
    for pat in amount_patterns:
        m = re.search(pat, combined, re.IGNORECASE)
        if m:
            cand = round(parse_it_float(m.group(1)), 2)
            if 0 < cand < 50000:
                total_paid = cand
                break

    if total_paid <= 0 and not notice_number:
        return None
    if not notice_number:
        clean_due = due_date.replace("/", "")
        notice_number = f"TARI_{year}_{clean_due or int(total_paid * 100)}"

    rata_m = re.search(r"(Rata\s+\d+|Unica\s+Soluzione|Saldo|Acconto)", combined, re.IGNORECASE)
    rata_label = rata_m.group(1).title() if rata_m else "Avviso di pagamento"
    supplier = (
        "AcegasApsAmga (TARI)"
        if "acegas" in low
        else ("Comune di Padova (TARI)" if "comune di padova" in low else "Ente / TARI")
    )
    note = f"Importata da {source_format.upper()} ({file_name})"
    if msg_date:
        note += f" · {msg_date[:16]}"

    return {
        "noticeNumber": notice_number[:50],
        "issueDate": issue_date[:20],
        "dueDate": due_date[:20],
        "year": year,
        "period": f"TARI {year} – {rata_label}"[:80],
        "supplier": supplier[:80],
        "totalPaid": total_paid,
        "paid": False,
        "source": "gmail-pdf",
        "note": note[:240],
    }


def parse_water_bill_text(
    text: str,
    file_name: str,
    source_format: str,
    msg_subject: str = "",
    msg_date: str = "",
) -> Optional[Dict[str, Any]]:
    combined = f"{msg_subject}\n{text}".strip()
    if not combined:
        return None
    low = f"{file_name}\n{combined[:5000]}".lower()
    if "tari" in low or "tassa rifiuti" in low:
        return None
    if not any(k in low for k in ("servizio idrico", "acquedotto", "fognatura", "depurazione", "metri cubi", "m³", " mc", "bolletta acqua")):
        return None

    if source_format == "csv":
        csv_parsed = parse_structured_csv_bill_text(text, forced_kind="acqua", file_name=file_name)
        if csv_parsed:
            return csv_parsed

    invoice_number = _extract_doc_number(combined, ("fattura", "bolletta", "documento"))
    issue_date = _extract_issue_date(combined)
    year, _, derived_period = extract_sort_key_and_year(combined, issue_date)

    tot_m = re.search(
        r"(?:TOTALE\s+DA\s+PAGARE|TOTALE\s+FATTURA|TOTALE\s+BOLLETTA|IMPORTO\s+TOTALE|ImportoTotaleDocumento)\s*[:€\s]*([\d.,]+)",
        combined,
        re.IGNORECASE,
    )
    if not tot_m:
        tot_m = re.search(r"€\s*([\d]{1,4}[.,]\d{2})", combined)
    total_paid = round(parse_it_float(tot_m.group(1)), 2) if tot_m else 0.0
    if total_paid <= 0:
        return None

    mc_m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:mc|m3|m³|metri\s+cubi)\b", combined, re.IGNORECASE)
    cubic_meters = round(parse_it_float(mc_m.group(1)), 1) if mc_m else 0.0

    if not invoice_number:
        invoice_number = f"H2O_{year}_{issue_date.replace('/', '')}_{int(total_paid * 100)}"
    invoice_number = invoice_number[:40]

    note = f"Importata da {source_format.upper()} ({file_name})"
    if msg_date:
        note += f" · {msg_date[:16]}"

    return {
        "invoiceNumber": invoice_number,
        "issueDate": issue_date[:20],
        "year": year,
        "period": derived_period[:80],
        "cubicMeters": cubic_meters,
        "fixedCostEur": 0.0,
        "totalPaid": total_paid,
        "note": note[:240],
    }


def _materialize_bill_pdf(
    source: Dict[str, Any],
    kind_label: str,
    summary_lines: List[str],
    fallback_pdf_name: str,
) -> Tuple[bytes, str]:
    """Restituisce il PDF originale se disponibile, altrimenti genera un PDF riepilogativo dal file/email."""
    if source.get("pdf_bytes") and is_valid_pdf_bytes(source["pdf_bytes"]):
        return source["pdf_bytes"], str(source.get("file_name") or fallback_pdf_name)

    excerpt_lines = [ln.strip() for ln in str(source.get("text", "")).splitlines() if ln.strip()][:35]
    all_lines = summary_lines + ["", "--- ESTRATTO TESTO ORIGINALE ---"] + excerpt_lines
    pdf_bytes = build_summary_pdf_bytes(f"MY HOME - {kind_label.upper()}", all_lines)
    base_name = re.sub(r"\.[^.]+$", "", str(source.get("file_name") or fallback_pdf_name))
    return pdf_bytes, f"{base_name}_riepilogo.pdf"


def extract_bills_from_gmail(
    mail: Optional[imaplib.IMAP4_SSL],
) -> Tuple[
    List[Tuple[Dict[str, Any], bytes, str]],
    List[Tuple[Dict[str, Any], bytes, str]],
    List[Tuple[Dict[str, Any], bytes, str]],
]:
    if not mail:
        return [], [], []

    elec_items: List[Tuple[Dict[str, Any], bytes, str]] = []
    water_items: List[Tuple[Dict[str, Any], bytes, str]] = []
    tari_items: List[Tuple[Dict[str, Any], bytes, str]] = []

    elec_msg_ids = imap_search_union(
        mail,
        [
            'FROM "edisonenergia.it"',
            'FROM "octopusenergy.it"',
            'FROM "enel.com"',
            'FROM "eniplenitude.com"',
            'FROM "engie.it"',
            'FROM "sorgenia.it"',
            'SUBJECT "Fattura Edison"',
            'SUBJECT "Octopus"',
            'SUBJECT "bolletta"',
            'SUBJECT "fattura luce"',
        ],
        max_results=20,
    )
    print(f"Email candidate bolletta Luce in INBOX: {len(elec_msg_ids)}")
    for mid in elec_msg_ids:
        try:
            _, msg_data = mail.fetch(mid, "(RFC822)")
            if not msg_data or not isinstance(msg_data[0], tuple):
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            subj = decode_mime_header(msg.get("Subject"))
            frm = decode_mime_header(msg.get("From"))
            mdate = decode_mime_header(msg.get("Date"))
            if "curve di carico" in subj.lower() or "notifichemailped@enel.com" in frm.lower():
                continue

            for src in collect_bill_sources_from_email(msg):
                parsed = parse_electricity_bill_text(
                    src["text"], src["file_name"], src["format"], subj, frm, mdate
                )
                if parsed:
                    pdf_bytes, out_name = _materialize_bill_pdf(
                        src,
                        "Bolletta Luce",
                        [
                            f"Fornitore: {parsed['supplier']} ({parsed['offerName']})",
                            f"Fattura n.: {parsed['invoiceNumber']} del {parsed['issueDate']}",
                            f"Periodo: {parsed['period']}",
                            f"Consumo: {parsed['kwh']} kWh | Totale: {parsed['totalPaid']:.2f} EUR",
                            f"Sorgente: {src['format'].upper()} ({src['file_name']})",
                            f"Email: {subj} | Da: {frm}",
                        ],
                        "bolletta_luce.pdf",
                    )
                    elec_items.append((parsed, pdf_bytes, out_name))
                    break
        except Exception as exc:
            print(f"Email Luce ignorata senza errori: {exc}")

    water_msg_ids = imap_search_union(
        mail,
        [
            'FROM "acegasapsamga.it"',
            'SUBJECT "servizio idrico"',
            'SUBJECT "bolletta acqua"',
            'SUBJECT "fattura acqua"',
        ],
        max_results=20,
    )
    print(f"Email candidate bolletta Acqua in INBOX: {len(water_msg_ids)}")
    for mid in water_msg_ids:
        try:
            _, msg_data = mail.fetch(mid, "(RFC822)")
            if not msg_data or not isinstance(msg_data[0], tuple):
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            subj = decode_mime_header(msg.get("Subject"))
            frm = decode_mime_header(msg.get("From"))
            mdate = decode_mime_header(msg.get("Date"))
            if "tari" in subj.lower() or "rifiuti" in subj.lower():
                continue

            for src in collect_bill_sources_from_email(msg):
                parsed = parse_water_bill_text(src["text"], src["file_name"], src["format"], subj, mdate)
                if parsed:
                    pdf_bytes, out_name = _materialize_bill_pdf(
                        src,
                        "Bolletta Acqua",
                        [
                            f"Fattura n.: {parsed['invoiceNumber']} del {parsed['issueDate']}",
                            f"Periodo: {parsed['period']}",
                            f"Consumo: {parsed['cubicMeters']:.1f} mc | Totale: {parsed['totalPaid']:.2f} EUR",
                            f"Sorgente: {src['format'].upper()} ({src['file_name']})",
                            f"Email: {subj} | Da: {frm}",
                        ],
                        "bolletta_acqua.pdf",
                    )
                    water_items.append((parsed, pdf_bytes, out_name))
                    break
        except Exception as exc:
            print(f"Email Acqua ignorata senza errori: {exc}")

    tari_msg_ids = imap_search_union(
        mail,
        [
            'FROM "tassa_rifiuti@acegasapsamga.it"',
            'SUBJECT "TARI"',
            'SUBJECT "tassa rifiuti"',
            'SUBJECT "Avviso di pagamento"',
        ],
        max_results=20,
    )
    print(f"Email candidate avvisi TARI in INBOX: {len(tari_msg_ids)}")
    for mid in tari_msg_ids:
        try:
            _, msg_data = mail.fetch(mid, "(RFC822)")
            if not msg_data or not isinstance(msg_data[0], tuple):
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            subj = decode_mime_header(msg.get("Subject"))
            frm = decode_mime_header(msg.get("From"))
            mdate = decode_mime_header(msg.get("Date"))

            for src in collect_bill_sources_from_email(msg):
                parsed = parse_tari_bill_text(src["text"], src["file_name"], src["format"], subj, mdate)
                if parsed:
                    pdf_bytes, out_name = _materialize_bill_pdf(
                        src,
                        "Avviso TARI",
                        [
                            f"Ente: {parsed['supplier']}",
                            f"Avviso n.: {parsed['noticeNumber']} del {parsed['issueDate']}",
                            f"Scadenza: {parsed['dueDate']} | Periodo: {parsed['period']}",
                            f"Totale: {parsed['totalPaid']:.2f} EUR",
                            f"Sorgente: {src['format'].upper()} ({src['file_name']})",
                            f"Email: {subj} | Da: {frm}",
                        ],
                        "avviso_tari.pdf",
                    )
                    tari_items.append((parsed, pdf_bytes, out_name))
                    break
        except Exception as exc:
            print(f"Email TARI ignorata senza errori: {exc}")

    return elec_items, water_items, tari_items


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
    print(f"Archiviato PDF su Firestore Vault: {clean_key} ({len(pdf_bytes)} bytes, {len(chunks)} chunk)")
    return True


def _resolve_notify_channels(db_client: Any, owner_id: str) -> Tuple[str, str]:
    email_to = os.environ.get("REMINDERS_EMAIL_TO", "").strip()
    phone = re.sub(r"[^\d]", "", os.environ.get("CALLMEBOT_PHONE", "").strip())
    if not email_to or not phone:
        try:
            snap = (
                db_client.collection("users")
                .document(owner_id)
                .collection("homeArticles")
                .document("rem_notify_config")
                .get()
            )
            if snap.exists:
                cfg = json.loads(str((snap.to_dict() or {}).get("manualExtractText", "") or "{}"))
                if not email_to and cfg.get("defaultEmail"):
                    email_to = str(cfg["defaultEmail"]).strip()
                if not phone and cfg.get("whatsappPhone"):
                    phone = re.sub(r"[^\d]", "", str(cfg["whatsappPhone"]).strip())
        except Exception as exc:
            print(f"Nota lettura canali notifica da Firestore: {exc}")
    if not email_to:
        email_to = os.environ.get("GMAIL_USER", "").strip()
    return email_to, phone


def notify_newly_imported_bills(
    db_client: Any,
    owner_id: str,
    imported_bills: List[Dict[str, str]],
) -> None:
    if not imported_bills:
        return

    email_to, phone = _resolve_notify_channels(db_client, owner_id)
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    callmebot_key = os.environ.get("CALLMEBOT_API_KEY", "").strip()

    lines_plain = [f"- [{b['kind']}] {b['summary']}" for b in imported_bills]

    if email_to and gmail_user and gmail_pass:
        try:
            msg = EmailMessage()
            msg["Subject"] = (
                f"[My Home] {len(imported_bills)} nuova bolletta importata automaticamente"
                if len(imported_bills) == 1
                else f"[My Home] {len(imported_bills)} nuove bollette importate automaticamente"
            )
            msg["From"] = gmail_user
            msg["To"] = email_to
            msg.set_content(
                "Ciao Maurizio,\n\n"
                "My Home ha rilevato e importato automaticamente nella sezione Bollette:\n\n"
                + "\n".join(lines_plain)
                + "\n\nApri l'app per verificare tutti i dettagli e il PDF:\n"
                + "https://mauriziominieri.github.io/my-home/\n"
            )
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
                smtp.login(gmail_user, gmail_pass)
                smtp.send_message(msg)
            print(f"Email di notifica nuove bollette inviata a {email_to}.")
        except Exception as exc:
            print(f"Avviso invio Email nuove bollette fallito: {exc}")

    if phone and callmebot_key:
        try:
            wa_body = (
                f"*My Home — Nuove bollette importate ({len(imported_bills)})*\n\n"
                + "\n".join(lines_plain)
                + "\n\nhttps://mauriziominieri.github.io/my-home/"
            )
            if len(wa_body) > 1400:
                wa_body = wa_body[:1397] + "..."
            wa_url = (
                "https://api.callmebot.com/whatsapp.php?phone="
                + urllib.parse.quote(phone, safe="")
                + "&text="
                + urllib.parse.quote(wa_body, safe="")
                + "&apikey="
                + urllib.parse.quote(callmebot_key, safe="")
            )
            req = urllib.request.Request(wa_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                status = getattr(resp, "status", 200)
                if 200 <= status < 300:
                    print("Notifica WhatsApp nuove bollette inviata con successo.")
                else:
                    print(f"Errore CallMeBot HTTP {status} su notifica bollette.")
        except Exception as exc:
            print(f"Avviso invio WhatsApp nuove bollette fallito: {exc}")
    else:
        print("Notifica WhatsApp saltata: CALLMEBOT_API_KEY o CALLMEBOT_PHONE non configurati.")


def _load_existing_bill_keys(col_ref: Any, id_field: str) -> set[str]:
    keys: set[str] = set()
    try:
        for doc in col_ref.stream():
            data = doc.to_dict() or {}
            raw_id = str(data.get(id_field, "")).strip()
            pdf_key = str(data.get("pdfFileKey", "")).strip()
            if raw_id:
                keys.add(normalize_bill_identity(raw_id))
            if pdf_key:
                keys.add(pdf_key)
    except Exception as exc:
        print(f"Avviso controllo bollette esistenti ({id_field}): {exc}")
    return keys


def main() -> None:
    db_client, fb_firestore, owner_id = init_firestore_admin()

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
    newly_imported_bills: List[Dict[str, str]] = []

    try:
        elec_items, water_items, tari_items = extract_bills_from_gmail(mail)
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
            for r in valid_items:
                date_str = str(r["date"])
                if latest_db_date and date_str <= latest_db_date:
                    skipped_existing_count += 1
                    continue
                pending_readings_by_date[date_str] = r
            verified_msgs_to_delete.append(msg_id)

        if pending_readings_by_date:
            items_to_save = [pending_readings_by_date[d] for d in sorted(pending_readings_by_date.keys())]
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
            print(f"Salvate {len(items_to_save)} nuove giornate consumi su Firestore.")
        elif skipped_existing_count > 0 and latest_db_date:
            print(
                f"Nessun nuovo consumo dopo il {latest_db_date} "
                f"(ignorate {skipped_existing_count} righe già presenti: 0 scritture Firestore)."
            )

        vault_files_col = user_ref.collection("vaultFiles")

        # 2. Bollette Luce -> Firestore electricityBills + Vault PDF
        if elec_items:
            elec_col = user_ref.collection("electricityBills")
            existing_elec = _load_existing_bill_keys(elec_col, "invoiceNumber")
            for b, pdf_bytes, file_name in elec_items:
                inv = str(b.get("invoiceNumber", "")).strip()
                if not inv:
                    continue
                slug = re.sub(r"[^a-zA-Z0-9_-]", "", inv) or f"L_{int(b.get('totalPaid', 0) * 100)}"
                supplier_slug = normalize_bill_identity(str(b.get("supplier", "luce")))[:12] or "luce"
                doc_prefix = "edison" if "edison" in supplier_slug else supplier_slug
                doc_id = f"{doc_prefix}_{slug}"
                file_key = f"bill_elec_{slug}"

                if (
                    normalize_bill_identity(inv) in existing_elec
                    or file_key in existing_elec
                    or (elec_col.document(doc_id).get().exists and vault_files_col.document(file_key).get().exists)
                ):
                    print(f"Bolletta Luce {inv} già presente su Firestore: salto.")
                    continue

                if not save_pdf_to_vault_firestore(db_client, fb_firestore, owner_id, file_key, file_name, pdf_bytes):
                    continue

                payload: Dict[str, Any] = {
                    "ownerId": owner_id,
                    "invoiceNumber": inv[:40],
                    "pdfFileKey": file_key,
                    "issueDate": str(b.get("issueDate", ""))[:20],
                    "sortKey": str(b.get("sortKey", ""))[:16],
                    "year": int(b.get("year", datetime.now(timezone.utc).year)),
                    "period": str(b.get("period", ""))[:80],
                    "supplier": str(b.get("supplier", "Fornitore Luce"))[:80],
                    "offerName": str(b.get("offerName", "Tariffa Luce"))[:100],
                    "kwh": int(b.get("kwh", 0)),
                    "punText": str(b.get("punText", "—"))[:60],
                    "variableCostPerKwh": float(b.get("variableCostPerKwh", 0.0)),
                    "canoneTv": float(b.get("canoneTv", 0.0)),
                    "electricityOnly": float(b.get("electricityOnly", 0.0)),
                    "totalPaid": float(b.get("totalPaid", 0.0)),
                    "createdAt": fb_firestore.SERVER_TIMESTAMP,
                }
                if b.get("note"):
                    payload["note"] = str(b["note"])[:240]
                elec_col.document(doc_id).set(payload)
                existing_elec.add(normalize_bill_identity(inv))
                existing_elec.add(file_key)
                newly_imported_bills.append(
                    {
                        "kind": "Bolletta Luce",
                        "summary": f"{payload['supplier']} · Fatt. {inv} ({payload['period']}) — {payload['kwh']} kWh · € {payload['totalPaid']:.2f}",
                    }
                )
                print(f"Bolletta Luce {inv} salvata su Firestore (email conservata in INBOX).")

        # 3. Bollette Acqua -> Firestore waterBills + Vault PDF
        if water_items:
            water_col = user_ref.collection("waterBills")
            existing_water = _load_existing_bill_keys(water_col, "invoiceNumber")
            for w, pdf_bytes, file_name in water_items:
                inv = str(w.get("invoiceNumber", "")).strip()
                if not inv:
                    continue
                slug = re.sub(r"[^a-zA-Z0-9_-]", "", inv) or f"W_{int(w.get('totalPaid', 0) * 100)}"
                doc_id = f"acegas_{slug}"
                file_key = f"bill_water_{slug}"

                if (
                    normalize_bill_identity(inv) in existing_water
                    or file_key in existing_water
                    or (water_col.document(doc_id).get().exists and vault_files_col.document(file_key).get().exists)
                ):
                    print(f"Bolletta Acqua {inv} già presente su Firestore: salto.")
                    continue

                if not save_pdf_to_vault_firestore(db_client, fb_firestore, owner_id, file_key, file_name, pdf_bytes):
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
                existing_water.add(normalize_bill_identity(inv))
                existing_water.add(file_key)
                newly_imported_bills.append(
                    {
                        "kind": "Bolletta Acqua",
                        "summary": f"AcegasApsAmga · Fatt. {inv} ({w['period']}) — {float(w.get('cubicMeters', 0.0)):.1f} mc · € {float(w.get('totalPaid', 0.0)):.2f}",
                    }
                )
                print(f"Bolletta Acqua {inv} salvata su Firestore (email conservata in INBOX).")

        # 4. Avvisi TARI -> Firestore tariBills + Vault PDF
        if tari_items:
            tari_col = user_ref.collection("tariBills")
            existing_tari = _load_existing_bill_keys(tari_col, "noticeNumber")
            for t, pdf_bytes, file_name in tari_items:
                notice = str(t.get("noticeNumber", "")).strip()
                if not notice:
                    continue
                slug = re.sub(r"[^a-zA-Z0-9_-]", "", notice) or f"T_{int(t.get('totalPaid', 0) * 100)}"
                doc_id = f"tari_{slug}"
                file_key = f"bill_tari_{slug}"

                if (
                    normalize_bill_identity(notice) in existing_tari
                    or file_key in existing_tari
                    or (tari_col.document(doc_id).get().exists and vault_files_col.document(file_key).get().exists)
                ):
                    print(f"Avviso TARI {notice} già presente su Firestore: salto.")
                    continue

                if not save_pdf_to_vault_firestore(db_client, fb_firestore, owner_id, file_key, file_name, pdf_bytes):
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
                existing_tari.add(normalize_bill_identity(notice))
                existing_tari.add(file_key)
                newly_imported_bills.append(
                    {
                        "kind": "TARI",
                        "summary": f"{t['supplier']} · Avviso {notice} (scad. {t['dueDate']}) — € {float(t.get('totalPaid', 0.0)):.2f}",
                    }
                )
                print(f"Avviso TARI {notice} salvato su Firestore (email conservata in INBOX).")

        # 5. Invia avviso Email + WhatsApp SOLO per le nuove bollette appena importate
        if newly_imported_bills:
            notify_newly_imported_bills(db_client, owner_id, newly_imported_bills)

        # 6. Sposta nel Cestino solo le email CSV e-distribuzione salvate (le bollette restano SEMPRE in INBOX)
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
        print(f"Errore sync Gmail e-distribuzione e bollette: {exc}", file=sys.stderr)
        sys.exit(1)
