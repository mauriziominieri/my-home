import JSZip from 'jszip';
import { BillRecord, TariBillRecord, WaterBillRecord } from '../types/home';
import { ParsedReadingInput, parseEDistribuzioneCsv } from './edistribuzioneCsv';
import {
  extractPdfTextFromBytes,
  parseEdisonPdfText,
  parseGenericElectricityPdfText,
  parseGenericWaterPdfText,
  parseTariPdfText,
} from './billImporter';
import {
  getElectricityBillFileKey,
  getTariBillFileKey,
  getWaterBillFileKey,
} from './documentVault';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailAuthExpiredError extends Error {
  constructor(message = 'Sessione Gmail scaduta: autorizza di nuovo l’accesso.') {
    super(message);
    this.name = 'GmailAuthExpiredError';
  }
}

export interface GmailProcessedMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  summary: string;
}

export interface GmailPdfAttachment {
  key: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface GmailScanResult {
  readings: ParsedReadingInput[];
  electricityBills: BillRecord[];
  waterBills: Omit<WaterBillRecord, 'id'>[];
  tariBills: Omit<TariBillRecord, 'id'>[];
  pdfAttachments: GmailPdfAttachment[];
  processedMessages: GmailProcessedMessage[];
}

interface GmailMessagePart {
  filename?: string;
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: {
    attachmentId?: string;
    data?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
}

interface GmailMessageResponse {
  id: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
}

function decodeBase64UrlToBytes(b64Url: string): Uint8Array {
  const b64 = b64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBytesUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function getHeader(part: GmailMessagePart | undefined, name: string): string {
  const target = name.toLowerCase();
  const h = part?.headers?.find((item) => item.name?.toLowerCase() === target);
  return h?.value || '';
}

function collectAttachments(
  part: GmailMessagePart | undefined,
  out: { filename: string; mimeType: string; attachmentId?: string; data?: string }[] = []
) {
  if (!part) return out;
  const filename = (part.filename || '').trim();
  const mimeType = (part.mimeType || '').toLowerCase();
  if (filename && (part.body?.attachmentId || part.body?.data)) {
    out.push({
      filename,
      mimeType,
      attachmentId: part.body.attachmentId,
      data: part.body.data,
    });
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      collectAttachments(child, out);
    }
  }
  return out;
}

async function gmailFetchJson<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new GmailAuthExpiredError();
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${errText.slice(0, 180)}`);
  }
  return (await res.json()) as T;
}

/**
 * Scans strictly Gmail INBOX (never Trash) for e-distribuzione load curves,
 * electricity PDFs (Edison, Octopus...), Acegas Water PDFs, and TARI PDFs,
 * saving each original PDF bytes locally at zero AI credit cost.
 */
export async function scanGmailInbox(accessToken: string): Promise<GmailScanResult> {
  const query =
    'in:inbox (from:notifichemailped@enel.com OR subject:"Dettaglio curve di carico" OR from:fatturazione@edisonenergia.it OR subject:"Fattura Edison Energia" OR from:octopusenergy.it OR subject:"Octopus Energy" OR from:tassa_rifiuti@acegasapsamga.it OR from:acegasapsamga.it OR subject:"Avviso di pagamento TARI")';

  const listUrl = `${GMAIL_API_BASE}/messages?labelIds=INBOX&maxResults=20&q=${encodeURIComponent(query)}`;
  const listResp = await gmailFetchJson<{ messages?: { id: string }[] }>(
    listUrl,
    accessToken
  );

  const messageRefs = listResp.messages || [];
  if (messageRefs.length === 0) {
    return {
      readings: [],
      electricityBills: [],
      waterBills: [],
      tariBills: [],
      pdfAttachments: [],
      processedMessages: [],
    };
  }

  const readingsByDate = new Map<string, ParsedReadingInput>();
  const elecByInvoice = new Map<string, BillRecord>();
  const waterByInvoice = new Map<string, Omit<WaterBillRecord, 'id'>>();
  const tariByNotice = new Map<string, Omit<TariBillRecord, 'id'>>();
  const pdfByKey = new Map<string, GmailPdfAttachment>();
  const processedMessages: GmailProcessedMessage[] = [];

  for (const ref of messageRefs) {
    const msg = await gmailFetchJson<GmailMessageResponse>(
      `${GMAIL_API_BASE}/messages/${encodeURIComponent(ref.id)}?format=full`,
      accessToken
    );

    // Extra safety check: skip if somehow in Trash or not in INBOX
    if (msg.labelIds?.includes('TRASH') || !msg.labelIds?.includes('INBOX')) {
      continue;
    }

    const subject = getHeader(msg.payload, 'Subject') || '(senza oggetto)';
    const from = getHeader(msg.payload, 'From');
    const date = getHeader(msg.payload, 'Date');
    const attachments = collectAttachments(msg.payload);

    let msgReadingsCount = 0;
    let msgElecCount = 0;
    let msgWaterCount = 0;
    let msgTariCount = 0;

    for (const att of attachments) {
      const lowerName = att.filename.toLowerCase();
      const isCsv = lowerName.endsWith('.csv') || att.mimeType.includes('csv');
      const isZip = lowerName.endsWith('.zip') || att.mimeType.includes('zip');
      const isPdf = lowerName.endsWith('.pdf') || att.mimeType === 'application/pdf';

      if (!isCsv && !isZip && !isPdf) continue;

      let rawData = att.data || '';
      if (!rawData && att.attachmentId) {
        const attRes = await gmailFetchJson<{ data?: string }>(
          `${GMAIL_API_BASE}/messages/${encodeURIComponent(msg.id)}/attachments/${encodeURIComponent(att.attachmentId)}`,
          accessToken
        );
        rawData = attRes.data || '';
      }
      if (!rawData) continue;

      const bytes = decodeBase64UrlToBytes(rawData);

      if (isCsv) {
        const parsed = parseEDistribuzioneCsv(decodeBytesUtf8(bytes));
        for (const r of parsed) {
          readingsByDate.set(r.date, r);
          msgReadingsCount++;
        }
      } else if (isZip) {
        try {
          const zip = await JSZip.loadAsync(bytes);
          for (const [entryName, entry] of Object.entries(zip.files)) {
            if (!entry.dir && entryName.toLowerCase().endsWith('.csv')) {
              const csvText = await entry.async('string');
              const parsed = parseEDistribuzioneCsv(csvText);
              for (const r of parsed) {
                readingsByDate.set(r.date, r);
                msgReadingsCount++;
              }
            }
          }
        } catch (err) {
          console.warn('Errore lettura allegato ZIP Gmail:', err);
        }
      } else if (isPdf) {
        try {
          const pdfText = await extractPdfTextFromBytes(bytes.slice(), 4);
          const hay = `${from}\n${subject}\n${lowerName}\n${pdfText.slice(0, 3500)}`.toLowerCase();
          const safeFileName = att.filename || 'bolletta.pdf';

          const isTariCandidate =
            from.toLowerCase().includes('tassa_rifiuti') ||
            hay.includes('avviso di pagamento tari') ||
            hay.includes('tassa rifiuti') ||
            hay.includes('tassa sui rifiuti') ||
            (hay.includes('acegasapsamga') && hay.includes('tari'));

          const isWaterCandidate =
            !isTariCandidate &&
            (hay.includes('servizio idrico') ||
              hay.includes('acquedotto') ||
              hay.includes('fognatura') ||
              hay.includes('depurazione') ||
              (hay.includes('acegas') && !hay.includes('kwh')));

          const isElectricityCandidate =
            !isTariCandidate &&
            !isWaterCandidate &&
            (hay.includes('edison') ||
              hay.includes('octopus') ||
              hay.includes('enel') ||
              hay.includes('energia elettrica') ||
              hay.includes('kwh'));

          if (isElectricityCandidate) {
            const edisonBill = parseEdisonPdfText(pdfText);
            const bill =
              edisonBill ||
              (() => {
                const generic = parseGenericElectricityPdfText(pdfText, safeFileName);
                return generic.confidence !== 'manuale' ? generic.bill : null;
              })();
            if (bill) {
              elecByInvoice.set(bill.invoiceNumber, bill);
              pdfByKey.set(getElectricityBillFileKey(bill.invoiceNumber), {
                key: getElectricityBillFileKey(bill.invoiceNumber),
                bytes,
                fileName: safeFileName,
                mimeType: 'application/pdf',
              });
              msgElecCount++;
            }
          } else if (isWaterCandidate) {
            const parsedWater = parseGenericWaterPdfText(pdfText, safeFileName);
            if (parsedWater.confidence !== 'manuale') {
              waterByInvoice.set(parsedWater.bill.invoiceNumber, parsedWater.bill);
              pdfByKey.set(getWaterBillFileKey(parsedWater.bill.invoiceNumber), {
                key: getWaterBillFileKey(parsedWater.bill.invoiceNumber),
                bytes,
                fileName: safeFileName,
                mimeType: 'application/pdf',
              });
              msgWaterCount++;
            }
          } else if (isTariCandidate) {
            const tari = parseTariPdfText(pdfText, subject, date);
            if (tari) {
              tariByNotice.set(tari.noticeNumber, tari);
              pdfByKey.set(getTariBillFileKey(tari.noticeNumber), {
                key: getTariBillFileKey(tari.noticeNumber),
                bytes,
                fileName: safeFileName,
                mimeType: 'application/pdf',
              });
              msgTariCount++;
            }
          }
        } catch (err) {
          console.warn('Errore lettura allegato PDF Gmail:', err);
        }
      }
    }

    if (msgReadingsCount > 0 || msgElecCount > 0 || msgWaterCount > 0 || msgTariCount > 0) {
      const parts: string[] = [];
      if (msgReadingsCount > 0) parts.push(`${msgReadingsCount} giorni consumi`);
      if (msgElecCount > 0) parts.push(`${msgElecCount} bolletta luce`);
      if (msgWaterCount > 0) parts.push(`${msgWaterCount} bolletta acqua`);
      if (msgTariCount > 0) parts.push(`${msgTariCount} avviso TARI`);
      processedMessages.push({
        id: msg.id,
        subject,
        from,
        date,
        summary: parts.join(', '),
      });
    }
  }

  return {
    readings: Array.from(readingsByDate.values()),
    electricityBills: Array.from(elecByInvoice.values()),
    waterBills: Array.from(waterByInvoice.values()),
    tariBills: Array.from(tariByNotice.values()),
    pdfAttachments: Array.from(pdfByKey.values()),
    processedMessages,
  };
}

/**
 * Moves processed Gmail messages to Trash (NEVER permanent delete).
 * MUST ONLY be invoked after explicit user confirmation in UI.
 */
export async function trashGmailMessages(
  accessToken: string,
  messageIds: string[]
): Promise<number> {
  let trashed = 0;
  for (const id of messageIds) {
    await gmailFetchJson(
      `${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}/trash`,
      accessToken,
      { method: 'POST' }
    );
    trashed++;
  }
  return trashed;
}
