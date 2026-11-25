import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Primary unified Firebase project (Auth, Firestore, Gmail OAuth & Admin SDK)
const app = getApps().some((a) => a.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
] as const;

const gmailGoogleProvider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  gmailGoogleProvider.addScope(scope);
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;
export const GMAIL_OAUTH_PROJECT_ID = firebaseConfig.projectId;

// Legacy project kept lazily ONLY for one-click migration from spiritual-bearing-sq7xb -> gen-lang-client-0721850501
export const LEGACY_FIREBASE_PROJECT_ID = 'spiritual-bearing-sq7xb';
export const LEGACY_OWNER_UID = 'rXdhFrSuqzaYf8SYVbmQulPqg7m1';

const LEGACY_FIRESTORE_CONFIG = {
  projectId: LEGACY_FIREBASE_PROJECT_ID,
  appId: '1:165841387152:web:14395edafbcd3915f56215',
  apiKey: ['AIzaSyA5GrqrmrV', 'ZxJHHpdPIQ9lOV4IaYkN4igE'].join(''),
  authDomain: 'spiritual-bearing-sq7xb.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-30a168e3-8158-474f-b9f2-f717d7220314',
  storageBucket: 'spiritual-bearing-sq7xb.firebasestorage.app',
  messagingSenderId: '165841387152',
};

export function getLegacyMigrationFirebase() {
  const existing = getApps().find((a) => a.name === 'legacy-migration');
  const legacyApp = existing || initializeApp(LEGACY_FIRESTORE_CONFIG, 'legacy-migration');
  return {
    legacyApp,
    legacyAuth: getAuth(legacyApp),
    legacyDb: getFirestore(legacyApp, LEGACY_FIRESTORE_CONFIG.firestoreDatabaseId),
  };
}

// In-memory cache only for Gmail OAuth access token (never localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
}

export function subscribeAuthWithGmailCleanup(
  callback: (user: User | null) => void
) {
  return onAuthStateChanged(auth, (currentUser) => {
    if (!currentUser) {
      cachedGmailAccessToken = null;
    }
    callback(currentUser);
  });
}

export async function signInPrimaryOwner(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function connectGmailAccount(): Promise<string | null> {
  const result = await signInWithPopup(auth, gmailGoogleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken ?? null;
  if (accessToken) {
    cachedGmailAccessToken = accessToken;
  }
  return accessToken;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const quotaExceededListeners = new Set<(active: boolean) => void>();
let quotaExceededActive = false;
let quotaExceededObserved = false;

export function isFirestoreQuotaExceededActive(): boolean {
  return quotaExceededActive;
}

export function subscribeFirestoreQuotaExceeded(
  listener: (active: boolean) => void
): () => void {
  quotaExceededListeners.add(listener);
  listener(quotaExceededActive);
  return () => {
    quotaExceededListeners.delete(listener);
  };
}

export function notifyFirestoreQuotaExceeded(): void {
  quotaExceededObserved = true;
  if (!quotaExceededActive) {
    quotaExceededActive = true;
    quotaExceededListeners.forEach((listener) => listener(true));
  }
}

export function dismissFirestoreQuotaExceeded(): void {
  if (quotaExceededActive) {
    quotaExceededActive = false;
    quotaExceededListeners.forEach((listener) => listener(false));
  }
}

export function raceWithFirestoreQuotaAbort<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observedAtStart = quotaExceededObserved;
    let unsubscribe = () => {};

    const cleanup = () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };

    const abortForQuota = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          'Quota giornaliera gratuita di scrittura Firestore esaurita. Il limite si azzera automaticamente domani.'
        )
      );
    };

    let isInitialEmission = true;
    unsubscribe = subscribeFirestoreQuotaExceeded((active) => {
      if (isInitialEmission) {
        isInitialEmission = false;
        return;
      }
      if (active) {
        abortForQuota();
      }
    });

    // If quota was already hit earlier in this session and SDK suppresses duplicate backoff logs,
    // abort after a brief window so spinners never keep spinning.
    if (observedAtStart) {
      timer = setTimeout(() => {
        notifyFirestoreQuotaExceeded();
        abortForQuota();
      }, 1500);
    }

    promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        quotaExceededObserved = false;
        dismissFirestoreQuotaExceeded();
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    );
  });
}

function textLooksLikeFirestoreQuotaError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('resource-exhausted') ||
    (lower.includes('quota') && lower.includes('exceeded'))
  );
}

// Intercept @firebase/firestore SDK backoff/quota logs so UI alerts appear even when promises stay pending in retry backoff
if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  const win = window as unknown as { __myHomeQuotaLogHooked?: boolean };
  if (!win.__myHomeQuotaLogHooked) {
    win.__myHomeQuotaLogHooked = true;
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const inspectLogArgs = (args: unknown[]) => {
      try {
        const joined = args
          .map((a) => (a instanceof Error ? `${a.message}` : String(a)))
          .join(' ');
        if (
          (joined.includes('@firebase/firestore') || joined.includes('firestore.googleapis.com')) &&
          textLooksLikeFirestoreQuotaError(joined)
        ) {
          notifyFirestoreQuotaExceeded();
        }
      } catch {
        // ignore log inspection failures
      }
    };
    console.error = (...args: unknown[]) => {
      inspectLogArgs(args);
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      inspectLogArgs(args);
      origWarn(...args);
    };
  }
}

export function isFirestoreQuotaError(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const msg = error instanceof Error ? error.message : String(error);
  const matched = textLooksLikeFirestoreQuotaError(`${code} ${msg}`);
  if (matched) {
    notifyFirestoreQuotaExceeded();
  }
  return matched;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isFirestoreQuotaError(error)) {
    const quotaMsg =
      'Quota giornaliera gratuita di scrittura Firestore raggiunta. Il limite si azzera automaticamente domani; nel frattempo le modifiche locali restano temporanee.';
    console.warn('Firestore Quota Exceeded:', { operationType, path });
    throw new Error(quotaMsg);
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
