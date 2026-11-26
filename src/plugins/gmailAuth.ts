import { registerPlugin } from '@capacitor/core';

export interface NativeGmailAuthResult {
  accessToken: string;
  email: string;
  grantedScopes: string[];
}

export interface NativeGmailSilentAuthResult extends NativeGmailAuthResult {
  needsReauth: boolean;
}

interface GmailAuthPluginInterface {
  authorizeGmail(options?: {
    scopes?: string[];
    loginHint?: string;
  }): Promise<NativeGmailAuthResult>;
  authorizeSilent(options: {
    email: string;
    scopes?: string[];
  }): Promise<NativeGmailSilentAuthResult>;
  getSavedAccounts(): Promise<{
    emails: string[];
  }>;
  removeSavedAccount(options: {
    email: string;
  }): Promise<{ removed: boolean }>;
  clearCachedToken(options: {
    token: string;
    email?: string;
  }): Promise<{ cleared: boolean }>;
  getSigningInfo(): Promise<{
    packageName: string;
    sha1: string;
  }>;
}

export const GmailAuth = registerPlugin<GmailAuthPluginInterface>('GmailAuth');
