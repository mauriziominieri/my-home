import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import oauthFirebaseConfig from '../firebase-applet-config.json';

// Firestore & primary user auth live on the provisioned database project
const FIRESTORE_CONFIG = {
  projectId: 'spiritual-bearing-sq7xb',
  appId: '1:165841387152:web:14395edafbcd3915f56215',
  apiKey: ['AIzaSyA5GrqrmrV', 'ZxJHHpdPIQ9lOV4IaYkN4igE'].join(''),
  authDomain: 'spiritual-bearing-sq7xb.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-30a168e3-8158-474f-b9f2-f717d7220314',
  storageBucket: 'spiritual-bearing-sq7xb.firebasestorage.app',
  messagingSenderId: '165841387152',
};

const app = initializeApp(FIRESTORE_CONFIG);
export const db = getFirestore(app, FIRESTORE_CONFIG.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Dedicated secondary Firebase Auth app bound to firebase-applet-config.json
// where Gmail Workspace OAuth scopes are configured.
const gmailOAuthApp = initializeApp(oauthFirebaseConfig, 'gmail-oauth');
const gmailAuth = getAuth(gmailOAuthApp);

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
] as const;

const gmailGoogleProvider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  gmailGoogleProvider.addScope(scope);
}

export const FIREBASE_PROJECT_ID = FIRESTORE_CONFIG.projectId;
export const FIRESTORE_DATABASE_ID = FIRESTORE_CONFIG.firestoreDatabaseId;

// In-memory cache only for Gmail OAuth access token (never localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
  void gmailAuth.signOut().catch(() => {});
}

export function subscribeAuthWithGmailCleanup(
  callback: (user: User | null) => void
) {
  return onAuthStateChanged(auth, (currentUser) => {
    if (!currentUser) {
      cachedGmailAccessToken = null;
      void gmailAuth.signOut().catch(() => {});
    }
    callback(currentUser);
  });
}

export async function signInPrimaryOwner(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function connectGmailAccount(): Promise<string | null> {
  const result = await signInWithPopup(gmailAuth, gmailGoogleProvider);
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

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
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
