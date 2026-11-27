"""
my-home — Monitoraggio Automatico Tariffe Luce di Mercato (GitHub Actions)
Workflow: .github/workflows/sync-gmail-consumi-bollette-tariffe.yml

COSA FA QUESTO SCRIPT:
- Legge le tariffe luce fisse pubbliche dai principali fornitori italiani
  (Octopus Energy, ENGIE, Eni Plenitude, E.ON, NeN, Sorgenia, Enel Energia).
- Confronta il costo annuo stimato (su 2300 kWh/anno) rispetto alla tua offerta
  Octopus Fissa 24M in partenza nel 2027 (0.1595 €/kWh + 6.00 €/mese).
- Salva tutti i prezzi rilevati su Firestore (`appMeta/octopusTariff`) per mostrarli in Bollette.
- Se trova un fornitore più conveniente di almeno 5 €/anno, ti invia un avviso sia via Email
  (Gmail SMTP) sia su WhatsApp (CallMeBot), una sola volta per ogni nuova offerta trovata.
"""

import html as html_lib
import json
import os
import re
import smtplib
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional

OCTOPUS_URL = "https://octopusenergy.it/offerta/tariffe"
NEN_CATALOG_API = "https://prod.api.nen.it/subscriptions/catalog?action=S&utility=EE%3BGA&channel=Web&target=Domestico"
MY_LOCKED_RATE = 0.1595  # Octopus Fissa 24M (OCTOFIX24v09)
MY_FIXED_EUR_MONTH = 6.0  # 72 EUR/anno (6 EUR/mese)
ANNUAL_KWH_BENCHMARK = 2300.0
MIN_ANNUAL_SAVING_EUR = 5.0

SUPPLIER_TARGETS: List[Dict[str, Any]] = [
    {
        "supplier": "Octopus Energy",
        "offerName": "Octopus Fissa 12M / 24M",
        "url": "https://octopusenergy.it/offerta/tariffe",
        "defaultFixedEurMonth": 6.0,
    },
    {
        "supplier": "ENGIE",
        "offerName": "Energia PuntoFisso 24M Solo Luce",
        "url": "https://www.engie.it/casa/offerte-luce-gas/energia-puntofisso-24mesi-singleele/",
        "defaultFixedEurMonth": 7.0,
    },
    {
        "supplier": "Eni Plenitude",
        "offerName": "Fixa Time Luce",
        "url": "https://eniplenitude.com/offerta/casa/gas-e-luce/fixa-time",
        "defaultFixedEurMonth": 12.0,
    },
    {
        "supplier": "E.ON Energia",
        "offerName": "LuceClick 24M Verde",
        "url": "https://www.eon-energia.com/luce/casa/offerta-luce-prezzo-fisso-24-mesi.html",
        "defaultFixedEurMonth": 9.09,
    },
    {
        "supplier": "NeN",
        "offerName": "Luce Due 24M (Prezzo Bloccato)",
        "url": "https://nen.it/offerte-e-prezzi/prezzo-bloccato",
        "defaultFixedEurMonth": 9.0,
    },
    {
        "supplier": "Sorgenia",
        "offerName": "Next Energy Luce Casa",
        "url": "https://www.sorgenia.it/offerte-luce-casa",
        "defaultFixedEurMonth": 9.5,
    },
    {
        "supplier": "Enel Energia",
        "offerName": "Enel Fix Web Luce",
        "url": "https://www.enel.it/it-it/offerte-luce/enel-fix-web-luce",
        "defaultFixedEurMonth": 10.0,
    },
]


def fetch_html(url: str, extra_headers: Optional[Dict[str, str]] = None) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        # Alcuni siti protetti da Cloudflare (es. E.ON) bloccano urllib con 403: usa Jina Reader come fallback
        if err.code in (403, 429) and not url.startswith("https://r.jina.ai/"):
            proxy_req = urllib.request.Request(
                f"https://r.jina.ai/{url}",
                headers={"User-Agent": headers["User-Agent"]},
            )
            with urllib.request.urlopen(proxy_req, timeout=25) as resp:
                return resp.read().decode("utf-8", errors="replace")
        raise


def clean_visible_text(raw_html: str) -> str:
    text = re.sub(r"<script[^>]*>.*?</script>", " ", raw_html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text)


def _extract_fixed_from_text(text: str) -> List[float]:
    results: List[float] = []
    for pat in (
        r"(\d{1,2}(?:[.,]\d{1,2})?)\s*€\s*/\s*mese",
        r"(\d{2,3}(?:[.,]\d{1,2})?)\s*€\s*/\s*(?:POD\s*/\s*)?anno",
    ):
        for m in re.findall(pat, text, re.IGNORECASE):
            try:
                val = float(m.replace(",", "."))
                if "anno" in pat:
                    if 36.0 <= val <= 240.0:
                        val = round(val / 12.0, 2)
                    else:
                        continue
                if 3.0 <= val <= 20.0:
                    results.append(val)
            except ValueError:
                continue
    return results


def extract_rate_and_fixed(raw_html: str, default_fixed: float) -> tuple[Optional[float], float]:
    # Estrae prezzi €/kWh sia dal markup HTML sia dal testo pulito
    visible = clean_visible_text(raw_html)

    # Se la pagina mostra esplicitamente sia Monorario che F1/F2/F3 (es. ENGIE), preferisci il valore Monorario
    monorario_match = re.search(
        r"Monorari[oa].{0,160}?(0[.,]\d{3,5})\s*(?:€|&euro;|EUR)\s*/\s*kWh",
        visible,
        re.IGNORECASE,
    )
    rate: Optional[float] = None
    rate_span: Optional[tuple[int, int]] = None
    if monorario_match:
        try:
            mval = float(monorario_match.group(1).replace(",", "."))
            if 0.06 <= mval <= 0.40:
                rate = mval
                rate_span = monorario_match.span(1)
        except ValueError:
            rate = None

    if rate is None:
        visible_candidates: List[tuple[float, tuple[int, int]]] = []
        for m in re.finditer(r"(0[.,]\d{3,5})\s*(?:€|&euro;|EUR)\s*/\s*kWh", visible, re.IGNORECASE):
            try:
                val = float(m.group(1).replace(",", "."))
                if 0.06 <= val <= 0.40:
                    visible_candidates.append((val, m.span(1)))
            except ValueError:
                continue
        if visible_candidates:
            rate, rate_span = min(visible_candidates, key=lambda x: x[0])
        else:
            raw_candidates: List[float] = []
            for raw in re.findall(r"(0[.,]\d{3,5})\s*(?:€|&euro;|EUR)\s*/\s*kWh", raw_html, re.IGNORECASE):
                try:
                    val = float(raw.replace(",", "."))
                    if 0.06 <= val <= 0.40:
                        raw_candidates.append(val)
                except ValueError:
                    continue
            rate = min(raw_candidates) if raw_candidates else None

    fixed_candidates: List[float] = []
    if rate_span is not None:
        local_window = visible[max(0, rate_span[0] - 250) : min(len(visible), rate_span[1] + 350)]
        fixed_candidates = _extract_fixed_from_text(local_window)
    if not fixed_candidates:
        fixed_candidates = _extract_fixed_from_text(visible)

    fixed = min(fixed_candidates) if fixed_candidates else default_fixed
    return rate, round(fixed, 2)


def scrape_nen(target: Dict[str, Any]) -> Dict[str, Any]:
    raw_json = fetch_html(
        NEN_CATALOG_API,
        extra_headers={
            "Accept": "application/json",
            "Origin": "https://nen.it",
            "Referer": "https://nen.it/",
        },
    )
    catalog = json.loads(raw_json)
    ee_fixed = [
        item.get("baseOffer", {})
        for item in catalog
        if item.get("utility") == "EE" and item.get("baseOffer", {}).get("fixedPrice")
    ]
    # Confronto omogeneo: preferisci Luce Due 24M (senza penali), altrimenti Luce Dieci 120M
    chosen = next((o for o in ee_fixed if o.get("duration") == 24), None) or (ee_fixed[0] if ee_fixed else None)
    if not chosen:
        raise ValueError("Nessuna offerta luce a prezzo fisso trovata nel catalogo NeN")

    rate = round(float(str(chosen["fixedPrice"]).replace(",", ".")), 4)
    pcv_year = float(str(chosen.get("pcv") or chosen.get("fixedAnnualCost") or "108").replace(",", "."))
    fixed = round(pcv_year / 12.0, 2)
    est_annual = round(rate * ANNUAL_KWH_BENCHMARK + fixed * 12.0, 2)

    offer_ten = next((o for o in ee_fixed if o.get("duration") == 120), None)
    offer_name = target["offerName"]
    if offer_ten and offer_ten.get("fixedPrice"):
        ten_rate = float(str(offer_ten["fixedPrice"]).replace(",", "."))
        offer_name = f"Luce Due 24M (Dieci 10A: {ten_rate:.3f} €/kWh)"

    return {
        "supplier": target["supplier"],
        "offerName": offer_name,
        "rateEurKwh": rate,
        "fixedEurMonth": fixed,
        "estAnnualEur": est_annual,
        "url": target["url"],
        "status": "ok",
    }


def scrape_supplier(target: Dict[str, Any]) -> Dict[str, Any]:
    try:
        if target["supplier"] == "NeN":
            return scrape_nen(target)
        raw_html = fetch_html(target["url"])
        rate, fixed = extract_rate_and_fixed(raw_html, float(target["defaultFixedEurMonth"]))
        if rate is None:
            return {
                "supplier": target["supplier"],
                "offerName": target["offerName"],
                "rateEurKwh": None,
                "fixedEurMonth": fixed,
                "estAnnualEur": None,
                "url": target["url"],
                "status": "unavailable",
            }
        est_annual = round(rate * ANNUAL_KWH_BENCHMARK + fixed * 12.0, 2)
        return {
            "supplier": target["supplier"],
            "offerName": target["offerName"],
            "rateEurKwh": round(rate, 4),
            "fixedEurMonth": fixed,
            "estAnnualEur": est_annual,
            "url": target["url"],
            "status": "ok",
        }
    except Exception as exc:
        print(f"Impossibile leggere {target['supplier']}: {exc}")
        return {
            "supplier": target["supplier"],
            "offerName": target["offerName"],
            "rateEurKwh": None,
            "fixedEurMonth": float(target["defaultFixedEurMonth"]),
            "estAnnualEur": None,
            "url": target["url"],
            "status": "unavailable",
        }


def send_alert_email(best_offer: Dict[str, Any], my_annual: float) -> None:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        print("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti: impossibile inviare email.")
        return

    est_saving = round(my_annual - float(best_offer["estAnnualEur"]), 2)
    msg = EmailMessage()
    msg["Subject"] = (
        f"⚡ Offerta luce migliore trovata: {best_offer['supplier']} a "
        f"{best_offer['rateEurKwh']:.4f} €/kWh (-{est_saving:.0f} €/anno)"
    )
    msg["From"] = gmail_user
    msg["To"] = gmail_user
    msg.set_content(
        f"Ciao Maurizio,\n\n"
        f"Il monitor automatico ha rilevato una tariffa luce più conveniente rispetto al tuo contratto attuale!\n\n"
        f"- Migliore offerta rilevata: {best_offer['supplier']} — {best_offer['offerName']}\n"
        f"- Prezzo energia: {best_offer['rateEurKwh']:.4f} €/kWh (fisso {best_offer['fixedEurMonth']:.2f} €/mese)\n"
        f"- Stima annua su {int(ANNUAL_KWH_BENCHMARK)} kWh: {best_offer['estAnnualEur']:.2f} €/anno\n\n"
        f"- Tua offerta attuale (Octopus Fissa 24M): {MY_LOCKED_RATE:.4f} €/kWh "
        f"(fisso {MY_FIXED_EUR_MONTH:.2f} €/mese -> {my_annual:.2f} €/anno)\n"
        f"- Risparmio annuo stimato: ~{est_saving:.2f} €/anno\n\n"
        f"Verifica i dettagli e le CTE ufficiali qui:\n"
        f"{best_offer['url']}\n"
    )

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(gmail_user, gmail_pass)
        smtp.send_message(msg)
    print(f"Email di avviso inviata a {gmail_user} per {best_offer['supplier']}.")


def _resolve_whatsapp_phone(db_client: Any) -> str:
    env_phone = re.sub(r"[^\d]", "", os.environ.get("CALLMEBOT_PHONE", "").strip())
    if env_phone:
        return env_phone
    if db_client is None:
        return ""
    try:
        owner_snap = db_client.collection("appMeta").document("owner").get()
        owner_uid = (
            str((owner_snap.to_dict() or {}).get("ownerUid", "")).strip()
            if owner_snap.exists
            else ""
        )
        if not owner_uid:
            return ""
        cfg_snap = (
            db_client.collection("users")
            .document(owner_uid)
            .collection("homeArticles")
            .document("rem_notify_config")
            .get()
        )
        if cfg_snap.exists:
            raw_json = str((cfg_snap.to_dict() or {}).get("manualExtractText", "") or "{}")
            cfg = json.loads(raw_json)
            return re.sub(r"[^\d]", "", str(cfg.get("whatsappPhone", "")).strip())
    except Exception as exc:
        print(f"Nota lettura numero WhatsApp da Firestore: {exc}")
    return ""


def send_alert_whatsapp(
    best_offer: Dict[str, Any], my_annual: float, db_client: Any = None
) -> bool:
    api_key = os.environ.get("CALLMEBOT_API_KEY", "").strip()
    phone = _resolve_whatsapp_phone(db_client)
    if not api_key or not phone:
        print(
            "Avviso WhatsApp saltato: imposta CALLMEBOT_API_KEY e CALLMEBOT_PHONE su GitHub Secrets "
            "per ricevere anche le notifiche WhatsApp sulle offerte luce."
        )
        return False

    est_saving = round(my_annual - float(best_offer["estAnnualEur"]), 2)
    wa_body = (
        f"*My Home — Offerta luce migliore trovata*\n\n"
        f"- Fornitore: *{best_offer['supplier']}* ({best_offer['offerName']})\n"
        f"- Prezzo: {best_offer['rateEurKwh']:.4f} €/kWh (+{best_offer['fixedEurMonth']:.2f} €/mese)\n"
        f"- Stima su {int(ANNUAL_KWH_BENCHMARK)} kWh: {best_offer['estAnnualEur']:.2f} €/anno\n"
        f"- Tua Octopus attuale: {MY_LOCKED_RATE:.4f} €/kWh ({my_annual:.2f} €/anno)\n"
        f"- Risparmio stimato: *~{est_saving:.2f} €/anno*\n\n"
        f"{best_offer['url']}"
    )
    if len(wa_body) > 1400:
        wa_body = wa_body[:1397] + "..."

    wa_url = (
        "https://api.callmebot.com/whatsapp.php?phone="
        + urllib.parse.quote(phone, safe="")
        + "&text="
        + urllib.parse.quote(wa_body, safe="")
        + "&apikey="
        + urllib.parse.quote(api_key, safe="")
    )
    req = urllib.request.Request(wa_url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = getattr(resp, "status", 200)
            if 200 <= status < 300:
                print(f"Messaggio WhatsApp inviato per {best_offer['supplier']}.")
                return True
            print(f"Errore CallMeBot HTTP {status} durante invio WhatsApp.")
            return False
    except Exception as exc:
        print(f"Errore invio WhatsApp CallMeBot: {exc}")
        return False


def _get_firestore_client():
    sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not sa_raw:
        return None
    import firebase_admin
    from firebase_admin import credentials, firestore

    sa_dict = json.loads(sa_raw)
    if not firebase_admin._apps:
        cred = credentials.Certificate(sa_dict)
        firebase_admin.initialize_app(
            cred, {"projectId": sa_dict.get("project_id", "gen-lang-client-0721850501")}
        )
    db_id = os.environ.get(
        "FIRESTORE_DATABASE_ID",
        "ai-studio-30a168e3-8158-474f-b9f2-f717d7220314",
    ).strip()
    return firestore.client(database_id=db_id)


def main() -> None:
    db_client = _get_firestore_client()
    state: Dict[str, Any] = {
        "myLockedRate": MY_LOCKED_RATE,
        "myFixedEurMonth": MY_FIXED_EUR_MONTH,
        "currentRate": None,
        "lastAlertedRate": None,
        "lastAlertedKey": None,
        "lastAlertedWhatsappKey": None,
        "competitors": [],
        "bestCompetitor": None,
        "updatedAt": None,
    }
    if db_client is not None:
        try:
            snap = db_client.collection("appMeta").document("octopusTariff").get()
            if snap.exists and isinstance(snap.to_dict(), dict):
                state.update(snap.to_dict() or {})
        except Exception as exc:
            print(f"Nota lettura stato tariffe da Firestore: {exc}")

    competitors = [scrape_supplier(target) for target in SUPPLIER_TARGETS]
    octopus_offer = next((c for c in competitors if c["supplier"] == "Octopus Energy"), None)
    current_rate = octopus_offer["rateEurKwh"] if octopus_offer and octopus_offer["rateEurKwh"] is not None else state.get("currentRate")

    valid_offers = [c for c in competitors if c["status"] == "ok" and c["estAnnualEur"] is not None]
    best_offer = min(valid_offers, key=lambda c: float(c["estAnnualEur"])) if valid_offers else None

    my_annual = round(MY_LOCKED_RATE * ANNUAL_KWH_BENCHMARK + MY_FIXED_EUR_MONTH * 12.0, 2)
    print(f"Tuo costo annuo stimato (Octopus Fissa 24M): {my_annual:.2f} €/anno")
    for c in competitors:
        print(
            f" - {c['supplier']}: "
            + (f"{c['rateEurKwh']:.4f} €/kWh + {c['fixedEurMonth']:.2f} €/m -> {c['estAnnualEur']:.2f} €/anno" if c["status"] == "ok" else "non disponibile")
        )

    state["myLockedRate"] = MY_LOCKED_RATE
    state["myFixedEurMonth"] = MY_FIXED_EUR_MONTH
    state["currentRate"] = current_rate
    state["competitors"] = competitors
    state["bestCompetitor"] = best_offer
    state["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if best_offer and (my_annual - float(best_offer["estAnnualEur"])) >= MIN_ANNUAL_SAVING_EUR:
        alert_key = f"{best_offer['supplier']}|{best_offer['rateEurKwh']}|{best_offer['fixedEurMonth']}"
        if state.get("lastAlertedKey") != alert_key:
            send_alert_email(best_offer, my_annual)
            state["lastAlertedKey"] = alert_key
            if best_offer["supplier"] == "Octopus Energy":
                state["lastAlertedRate"] = best_offer["rateEurKwh"]
        else:
            print(f"Avviso email già inviato per {alert_key}.")

        if state.get("lastAlertedWhatsappKey") != alert_key:
            if send_alert_whatsapp(best_offer, my_annual, db_client=db_client):
                state["lastAlertedWhatsappKey"] = alert_key
        else:
            print(f"Avviso WhatsApp già inviato per {alert_key}.")
    else:
        print("Nessun fornitore batte sensibilmente la tua Octopus Fissa 24M attuale.")

    if db_client is not None:
        db_client.collection("appMeta").document("octopusTariff").set(state)
        print("Stato tariffe mercato salvato su Firestore (appMeta/octopusTariff).")
    else:
        print("FIREBASE_SERVICE_ACCOUNT non impostato: salto scrittura appMeta/octopusTariff.")


if __name__ == "__main__":
    main()
