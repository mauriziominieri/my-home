"""
Prelievo automatico consumi giornalieri da e-distribuzione -> data/consumi.json.
Eseguito periodicamente da GitHub Actions per il POD IT001E11251419 (6 kW).

Secrets GitHub richiesti (solo 2):
  - EDIST_USER: Email account Area Clienti e-distribuzione
  - EDIST_PASS: Password account Area Clienti e-distribuzione
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import requests

POD_CODE = os.environ.get("POD_CODE", "IT001E11251419")
OUTPUT_FILE = Path("data/consumi.json")


def fetch_edistribuzione_daily_readings(days_back: int = 31) -> List[Dict[str, Any]]:
    username = os.environ.get("EDIST_USER", "").strip()
    password = os.environ.get("EDIST_PASS", "").strip()
    if not username or not password:
        raise RuntimeError("Secrets EDIST_USER / EDIST_PASS mancanti su GitHub.")

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
        }
    )

    login_url = "https://private.e-distribuzione.it/PortaleClienti/s/sfsites/aura"
    login_payload = {
        "message": json.dumps(
            {
                "actions": [
                    {
                        "id": "1;a",
                        "descriptor": "apex://LoginController/ACTION$login",
                        "callingDescriptor": "UNKNOWN",
                        "params": {
                            "username": username,
                            "password": password,
                            "startUrl": "/PortaleClienti/s/",
                        },
                    }
                ]
            }
        ),
        "aura.context": json.dumps({"mode": "PROD", "fwuid": "", "app": "siteforce:loginApp2"}),
        "aura.pageURI": "/PortaleClienti/s/login/",
        "aura.token": "null",
    }

    resp = session.post(login_url, data=login_payload, timeout=30)
    resp.raise_for_status()

    end_dt = datetime.now(timezone.utc).date()
    start_dt = end_dt - timedelta(days=days_back)

    measures_payload = {
        "message": json.dumps(
            {
                "actions": [
                    {
                        "id": "2;a",
                        "descriptor": "apex://MisureController/ACTION$getMisureGiornaliere",
                        "callingDescriptor": "UNKNOWN",
                        "params": {
                            "pod": POD_CODE,
                            "dataInizio": start_dt.strftime("%d/%m/%Y"),
                            "dataFine": end_dt.strftime("%d/%m/%Y"),
                        },
                    }
                ]
            }
        ),
        "aura.context": json.dumps({"mode": "PROD", "fwuid": "", "app": "siteforce:communityApp"}),
        "aura.pageURI": "/PortaleClienti/s/le-tue-misure",
        "aura.token": "null",
    }

    m_resp = session.post(login_url, data=measures_payload, timeout=30)
    m_resp.raise_for_status()
    raw_json = m_resp.json()

    actions = raw_json.get("actions", [])
    if not actions or actions[0].get("state") != "SUCCESS":
        raise RuntimeError(f"Risposta e-distribuzione non valida: {json.dumps(raw_json)[:400]}")

    rows = actions[0].get("returnValue") or []
    parsed: List[Dict[str, Any]] = []
    for row in rows:
        raw_date = str(row.get("data") or row.get("date") or "").strip()
        if "/" in raw_date:
            dd, mm, yyyy = raw_date.split("/")
            iso_date = f"{yyyy}-{mm.zfill(2)}-{dd.zfill(2)}"
        else:
            iso_date = raw_date[:10]

        if len(iso_date) != 10:
            continue

        f1 = round(float(row.get("f1", 0) or 0), 2)
        f2 = round(float(row.get("f2", 0) or 0), 2)
        f3 = round(float(row.get("f3", 0) or 0), 2)
        tot = round(float(row.get("totale", f1 + f2 + f3) or (f1 + f2 + f3)), 2)
        peak = round(float(row.get("piccoKw", 0) or 0), 2)

        parsed.append(
            {
                "date": iso_date,
                "f1Kwh": f1,
                "f2Kwh": f2,
                "f3Kwh": f3,
                "totalKwh": tot,
                "peakKw": min(6.0, peak),
            }
        )

    return parsed


def main() -> None:
    print(f"Avvio sync e-distribuzione per POD {POD_CODE}...")
    new_readings = fetch_edistribuzione_daily_readings(days_back=31)

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
    print(f"Salvati {len(merged)} giorni totali in {OUTPUT_FILE}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Errore sync e-distribuzione: {exc}", file=sys.stderr)
        sys.exit(1)
