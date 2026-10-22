import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Reuse existing app instance if already initialized
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Google Drive read-only scope for Excel workbooks
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.setCustomParameters({
  prompt: 'select_account',
});

// Cache the Google Drive OAuth access token strictly in memory
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken || '');
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export class UnauthorizedDomainError extends Error {
  domain: string;
  projectId: string;
  settingsUrl: string;

  constructor(domain: string, projectId: string) {
    super(
      `Domain "${domain}" is not authorized in Firebase Authentication for project "${projectId}".`
    );
    this.name = 'UnauthorizedDomainError';
    this.domain = domain;
    this.projectId = projectId;
    this.settingsUrl = `https://console.firebase.google.com/project/${projectId}/authentication/settings`;
  }
}

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
    }
    return { user: result.user, accessToken: cachedAccessToken || '' };
  } catch (error: any) {
    console.error('Google Sign In error:', error);
    if (
      error?.code === 'auth/unauthorized-domain' ||
      String(error?.message).includes('auth/unauthorized-domain')
    ) {
      const currentDomain =
        typeof window !== 'undefined' && window.location?.hostname
          ? window.location.hostname
          : 'current domain';
      const projectId = firebaseConfig.projectId;
      throw new UnauthorizedDomainError(currentDomain, projectId);
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const setAccessTokenInMemory = (token: string | null) => {
  cachedAccessToken = token;
};

export const logout = async (): Promise<void> => {
  try {
    await signOut(auth);
  } finally {
    cachedAccessToken = null;
  }
};
