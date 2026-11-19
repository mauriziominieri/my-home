import { useState } from 'react';
import { Check, Copy, Download, Globe, KeyRound, RefreshCw, Terminal } from 'lucide-react';
import { HomeSystemConfig } from '../types/home';

interface IntegrationViewProps {
  config: HomeSystemConfig;
  syncIntervalHours: number;
  onUpdateConfig: (patch: Partial<HomeSystemConfig>) => Promise<void>;
  onSyncFromGithubJson: (jsonUrl: string) => Promise<number>;
}

const DEFAULT_JSON_URL = 'https://mauriziominieri.github.io/my-home/data/consumi.json';

export function IntegrationView({
  config,
  syncIntervalHours,
  onUpdateConfig,
  onSyncFromGithubJson,
}: IntegrationViewProps) {
  const [podCode, setPodCode] = useState(config.podCode);
  const [tariff, setTariff] = useState(String(config.tariffEurPerKwh));
  const [jsonUrl, setJsonUrl] = useState(DEFAULT_JSON_URL);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncingJson, setSyncingJson] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const appUrl = window.location.origin;
  const cronExpr =
    syncIntervalHours === 24
      ? '0 7 * * *'
      : `0 */${syncIntervalHours} * * *`;

  const githubPagesHtml = `<!-- File: index.html nella repository my-home -->
<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Home — Maurizio Minieri</title>
    <style>
      html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; background: #020617; }
    </style>
  </head>
  <body>
    <iframe src="${appUrl}" title="My Home Domotica & Energia" allow="clipboard-write"></iframe>
  </body>
</html>`;

  const githubActionYaml = `# File: .github/workflows/sync-edistribuzione.yml
name: Sync automatico e-distribuzione
on:
  schedule:
    - cron: '${cronExpr}' # Ogni ${syncIntervalHours} ore
  workflow_dispatch:

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install requests
      - name: Estrai consumi reali e-distribuzione
        env:
          EDIST_USER: \${{ secrets.EDIST_USER }}
          EDIST_PASS: \${{ secrets.EDIST_PASS }}
          POD_CODE: "${config.podCode}"
        run: python scripts/sync_edistribuzione.py
      - name: Salva data/consumi.json nel repository
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/consumi.json
          git diff --staged --quiet || git commit -m "Aggiornamento consumi e-distribuzione"
          git push`;

  const pythonScript = `import json, os, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import requests

POD_CODE = os.environ.get("POD_CODE", "${config.podCode}")
OUTPUT_FILE = Path("data/consumi.json")

def fetch_readings(days_back=31):
    username = os.environ["EDIST_USER"]
    password = os.environ["EDIST_PASS"]
    session = requests.Session()
    url = "https://private.e-distribuzione.it/PortaleClienti/s/sfsites/aura"
    session.post(url, data={
        "message": json.dumps({"actions": [{"id": "1;a", "descriptor": "apex://LoginController/ACTION$login", "callingDescriptor": "UNKNOWN", "params": {"username": username, "password": password, "startUrl": "/PortaleClienti/s/"}}]}),
        "aura.context": json.dumps({"mode": "PROD", "fwuid": "", "app": "siteforce:loginApp2"}),
        "aura.pageURI": "/PortaleClienti/s/login/",
        "aura.token": "null",
    }, timeout=30).raise_for_status()
    end_dt = datetime.now(timezone.utc).date()
    start_dt = end_dt - timedelta(days=days_back)
    resp = session.post(url, data={
        "message": json.dumps({"actions": [{"id": "2;a", "descriptor": "apex://MisureController/ACTION$getMisureGiornaliere", "callingDescriptor": "UNKNOWN", "params": {"pod": POD_CODE, "dataInizio": start_dt.strftime("%d/%m/%Y"), "dataFine": end_dt.strftime("%d/%m/%Y")}}]}),
        "aura.context": json.dumps({"mode": "PROD", "fwuid": "", "app": "siteforce:communityApp"}),
        "aura.pageURI": "/PortaleClienti/s/le-tue-misure",
        "aura.token": "null",
    }, timeout=30)
    resp.raise_for_status()
    rows = resp.json().get("actions", [{}])[0].get("returnValue") or []
    out = []
    for row in rows:
        raw_date = str(row.get("data") or row.get("date") or "").strip()
        iso = f"{raw_date[6:10]}-{raw_date[3:5]}-{raw_date[0:2]}" if "/" in raw_date else raw_date[:10]
        f1, f2, f3 = round(float(row.get("f1", 0) or 0), 2), round(float(row.get("f2", 0) or 0), 2), round(float(row.get("f3", 0) or 0), 2)
        tot = round(float(row.get("totale", f1 + f2 + f3) or (f1 + f2 + f3)), 2)
        out.append({"date": iso, "f1Kwh": f1, "f2Kwh": f2, "f3Kwh": f3, "totalKwh": tot, "peakKw": min(6.0, round(float(row.get("piccoKw", 0) or 0), 2))})
    return out

if __name__ == "__main__":
    existing = {}
    if OUTPUT_FILE.exists():
        for r in json.loads(OUTPUT_FILE.read_text()).get("readings", []):
            existing[r["date"]] = r
    for r in fetch_readings():
        existing[r["date"]] = r
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps({"pod": POD_CODE, "updatedAt": datetime.now(timezone.utc).isoformat(), "readings": sorted(existing.values(), key=lambda x: x["date"])}, indent=2))
`;

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    const parsedTariff = Number.parseFloat(tariff.replace(',', '.'));
    if (!Number.isFinite(parsedTariff) || parsedTariff < 0.05 || parsedTariff > 2) return;
    setSaving(true);
    try {
      await onUpdateConfig({
        podCode: podCode.trim().slice(0, 32) || 'IT001E11251419',
        tariffEurPerKwh: Math.round(parsedTariff * 1000) / 1000,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncJson() {
    setSyncingJson(true);
    setSyncMessage(null);
    try {
      const count = await onSyncFromGithubJson(jsonUrl.trim());
      setSyncMessage(`Sincronizzati ${count} giorni reali da GitHub nel database Firestore.`);
    } catch (err) {
      setSyncMessage(
        err instanceof Error
          ? err.message
          : 'Impossibile leggere il file JSON da GitHub. Verifica che il workflow abbia già creato data/consumi.json.'
      );
    } finally {
      setSyncingJson(false);
    }
  }

  function copySnippet(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1800);
  }

  function downloadFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">
          Integrazione GitHub Pages & Sync Automatico (Zero Service Account)
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          GitHub Actions salva i tuoi consumi reali in <span className="font-mono text-sky-400">data/consumi.json</span> usando solo <span className="font-mono text-slate-200">EDIST_USER</span> e <span className="font-mono text-slate-200">EDIST_PASS</span>.
        </p>
      </div>

      {/* Live Sync from GitHub JSON */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Sincronizza da GitHub (`data/consumi.json`)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Una volta avviato il workflow su GitHub, importa automaticamente i tuoi kWh reali nel database Firestore.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={jsonUrl}
            onChange={(e) => setJsonUrl(e.target.value)}
            className="flex-1 min-w-[260px] px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-sky-500"
          />
          <button
            type="button"
            disabled={syncingJson}
            onClick={handleSyncJson}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingJson ? 'animate-spin' : ''}`} />
            {syncingJson ? 'Sincronizzazione...' : 'Carica da GitHub'}
          </button>
        </div>

        {syncMessage && (
          <p className="text-xs text-slate-300">{syncMessage}</p>
        )}
      </div>

      {/* POD & Tariff Settings */}
      <form
        onSubmit={handleSaveSettings}
        className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Parametri Fornitura Elettrica (6 kW)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Utilizzati per il calcolo dei costi e per lo script di estrazione automatica.
            </p>
          </div>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              Salvato
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">
              Codice POD (e-distribuzione)
            </label>
            <input
              type="text"
              value={podCode}
              onChange={(e) => setPodCode(e.target.value)}
              maxLength={32}
              className="w-full px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">
              Tariffa media (€/kWh)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.05"
              max="2.00"
              value={tariff}
              onChange={(e) => setTariff(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors"
          >
            Salva parametri fornitura
          </button>
        </div>
      </form>

      {/* Step 1: Only 2 GitHub Secrets */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              1. Aggiungi solo 2 Secrets nella tua repository GitHub `my-home`
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Vai su <span className="font-mono text-slate-200">Settings → Secrets and variables → Actions → New repository secret</span>:
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-800 text-xs border border-slate-800 rounded-lg bg-slate-950/60">
          <div className="p-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-sky-400">EDIST_USER</span>
            <span className="text-slate-400">Email del tuo account Area Clienti e-distribuzione</span>
          </div>
          <div className="p-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-sky-400">EDIST_PASS</span>
            <span className="text-slate-400">Password del tuo account Area Clienti e-distribuzione</span>
          </div>
        </div>
      </div>

      {/* Step 2: Workflow + Python download */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Terminal className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                2. Carica i 2 file nella repository `my-home`
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Metti <span className="font-mono text-slate-200">sync_edistribuzione.py</span> in <span className="font-mono text-slate-200">scripts/</span> e <span className="font-mono text-slate-200">sync-edistribuzione.yml</span> in <span className="font-mono text-slate-200">.github/workflows/</span>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => downloadFile('sync_edistribuzione.py', pythonScript)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              Scarica Python
            </button>
            <button
              type="button"
              onClick={() => downloadFile('sync-edistribuzione.yml', githubActionYaml)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              Scarica YAML
            </button>
            <button
              type="button"
              onClick={() => copySnippet('gh-action', githubActionYaml)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg"
            >
              {copiedId === 'gh-action' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copiato
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copia YAML
                </>
              )}
            </button>
          </div>
        </div>

        <pre className="bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">
          {githubActionYaml}
        </pre>
      </div>

      {/* Step 3: GitHub Pages Embed */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Globe className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                3. Pubblica su mauriziominieri.github.io/my-home
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Metti questo <span className="font-mono text-slate-200">index.html</span> nella root della repository <span className="font-mono text-slate-200">my-home</span> e attiva GitHub Pages.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => copySnippet('gh-pages', githubPagesHtml)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg shrink-0"
          >
            {copiedId === 'gh-pages' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copiato
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copia HTML
              </>
            )}
          </button>
        </div>

        <pre className="bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">
          {githubPagesHtml}
        </pre>
      </div>
    </div>
  );
}
