"""
Prelievo automatico del CSV "Dettaglio curve di carico" di e-distribuzione da Gmail -> data/consumi.json.
Mittente: notifichemailped@enel.com | Oggetto: Dettaglio curve di carico
Supporta nativamente il formato quartorario (96 colonne 00:00-00:15 ... 23:45-00:00)
calcolando automaticamente fasce ARERA F1/F2/F3, totale giornaliero kWh e picco kW.
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
from pathlib import Path
from typing import Any, Dict, List, Optional

POD_CODE = os.environ.get("POD_CODE", "IT001E11251419")
OUTPUT_FILE = Path("data/consumi.json")


def parse_it_float(raw: Optional[str]) -> float:
    if not raw:
        return 0.0
    cleaned = raw.strip().replace('"', "").replace(" ", "").replace(",", ".")
    try:
        val = float(cleaned)
        return val if val >= 0 else 0.0
    except ValueError:
        return 0.0


def normalize_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    cleaned = raw.strip().replace('"', "")
    if re.match(r"^\d{4}-\d{2}-\d{2}$", cleaned):
        return cleaned
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", cleaned)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def get_arera_band(iso_date: str, hour: int) -> str:
    """Calcola fascia ARERA (F1, F2, F3) in base al giorno della settimana e all'ora (0-23)."""
    dt = datetime.strptime(iso_date, "%Y-%m-%d")
    weekday = dt.weekday()  # 0=Lun .. 5=Sab, 6=Dom
    if weekday == 6:
        return "F3"
    if weekday == 5:
        return "F2" if 7 <= hour < 23 else "F3"
    # Lun - Ven
    if 8 <= hour < 19:
        return "F1"
    if (7 <= hour < 8) or (19 <= hour < 23):
        return "F2"
    return "F3"


def parse_csv_content(text: str) -> List[Dict[str, Any]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return []

    header_idx = 0
    for idx, ln in enumerate(lines[:20]):
        low = ln.lower()
        if "giorno" in low or "data" in low or "00:00" in low or "00:15" in low:
            header_idx = idx
            break

    delimiter = ";" if ";" in lines[header_idx] else ","
    reader = csv.reader(lines[header_idx:], delimiter=delimiter)
    headers = [h.strip().replace('"', "") for h in next(reader, [])]
    headers_low = [h.lower() for h in headers]

    # Rileva colonne quartorarie (es. "00:00 - 00:15", "00:15", "00:00-00:15")
    quarter_cols: List[tuple[int, int]] = []
    for i, h in enumerate(headers):
        m = re.search(r"(\d{2}):(\d{2})", h)
        if m:
            hour = int(m.group(1))
            if 0 <= hour <= 23:
                quarter_cols.append((i, hour))

    date_idx = 0
    for i, h in enumerate(headers_low):
        if "giorno" in h or "data" in h or "date" in h:
            date_idx = i
            break

    results: List[Dict[str, Any]] = []

    # Caso 1: Formato "Dettaglio curve di carico" (96 colonne quartorarie per riga)
    if len(quarter_cols) >= 24:
        for row in reader:
            if len(row) <= date_idx:
                continue
            iso = normalize_date(row[date_idx])
            if not iso:
                continue

            f1 = 0.0
            f2 = 0.0
            f3 = 0.0
            max_quarter_kwh = 0.0

            for col_idx, hour in quarter_cols:
                if col_idx >= len(row):
                    continue
                val = parse_it_float(row[col_idx])
                if val > max_quarter_kwh:
                    max_quarter_kwh = val
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
            # Potenza media sul quarto d'ora = kWh_15min * 4
            peak_kw = round(min(6.0, max_quarter_kwh * 4.0), 2)

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
        return results

    # Caso 2: Formato classico con colonne F1, F2, F3 o Totale
    def find_col(keywords: List[str]) -> int:
        for i, h in enumerate(headers_low):
            if any(k in h for k in keywords):
                return i
        return -1

    f1_idx = find_col(["f1"])
    f2_idx = find_col(["f2"])
    f3_idx = find_col(["f3"])
    tot_idx = find_col(["tot", "kwh", "consumo", "energia"])
    peak_idx = find_col(["picco", "potenza", "kw"])

    for row in reader:
        if len(row) <= date_idx:
            continue
        iso = normalize_date(row[date_idx])
        if not iso:
            continue
        f1 = round(parse_it_float(row[f1_idx]), 2) if f1_idx != -1 and len(row) > f1_idx else 0.0
        f2 = round(parse_it_float(row[f2_idx]), 2) if f2_idx != -1 and len(row) > f2_idx else 0.0
        f3 = round(parse_it_float(row[f3_idx]), 2) if f3_idx != -1 and len(row) > f3_idx else 0.0
        tot = round(f1 + f2 + f3, 2)
        if tot == 0.0 and tot_idx != -1 and len(row) > tot_idx:
            tot = round(parse_it_float(row[tot_idx]), 2)
            f3 = tot
        peak = round(min(6.0, parse_it_float(row[peak_idx])), 2) if peak_idx != -1 and len(row) > peak_idx else 0.0
        results.append(
            {
                "date": iso,
                "f1Kwh": f1,
                "f2Kwh": f2,
                "f3Kwh": f3,
                "totalKwh": tot,
                "peakKw": peak,
            }
        )

    return results


def extract_csvs_from_gmail() -> List[Dict[str, Any]]:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        raise RuntimeError("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti su GitHub.")

    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(gmail_user, gmail_pass)
    mail.select("INBOX")

    # Cerca email da notifichemailped@enel.com o con oggetto "Dettaglio curve di carico"
    status, data = mail.search(
        None,
        '(OR FROM "notifichemailped@enel.com" SUBJECT "Dettaglio curve di carico")',
    )
    if status != "OK" or not data or not data[0]:
        mail.logout()
        print("Nessuna email 'Dettaglio curve di carico' trovata nella INBOX.")
        return []

    msg_ids = data[0].split()[-15:]
    print(f"Trovate {len(msg_ids)} email di e-distribuzione / Enel.")
    all_readings: List[Dict[str, Any]] = []

    for msg_id in msg_ids:
        _, msg_data = mail.fetch(msg_id, "(RFC822)")
        if not msg_data or not isinstance(msg_data[0], tuple):
            continue
        msg = email.message_from_bytes(msg_data[0][1])

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
                all_readings.extend(parse_csv_content(text))
            elif filename.endswith(".zip"):
                print(f"Elaborazione allegato ZIP: {filename}")
                with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                    for name in zf.namelist():
                        if name.lower().endswith(".csv"):
                            text = zf.read(name).decode("utf-8-sig", errors="replace")
                            all_readings.extend(parse_csv_content(text))

    mail.logout()
    return all_readings


def main() -> None:
    print(f"Controllo Gmail per 'Dettaglio curve di carico' (POD {POD_CODE})...")
    new_readings = extract_csvs_from_gmail()

    existing_by_date: Dict[str, Dict[str, Any]] = {}
    if OUTPUT_FILE.exists():
        try:
            old_data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
            for item in old_data.get("readings", []):
                if "date" in item:
                    existing_by_date[item["date"]] = item
        except Exception:
            pass

    for item in new_readings:
        existing_by_date[item["date"]] = item

    merged = sorted(existing_by_date.values(), key=lambda x: x["date"])

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "pod": POD_CODE,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "readings": merged,
    }
    OUTPUT_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Completato: {len(new_readings)} giorni estratti da Gmail, {len(merged)} giorni totali salvati.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Errore sync Gmail e-distribuzione: {exc}", file=sys.stderr)
        sys.exit(1)
