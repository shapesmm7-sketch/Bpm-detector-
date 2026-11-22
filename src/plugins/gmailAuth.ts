import { registerPlugin } from '@capacitor/core';

export interface NativeGmailAuthResult {
  accessToken: string;
  email: string;
  grantedScopes: string[];
}

interface GmailAuthPluginInterface {
  authorizeGmail(options?: {
    scopes?: string[];
    loginHint?: string;
  }): Promise<NativeGmailAuthResult>;
  clearCachedToken(options: {
    token: string;
  }): Promise<{ cleared: boolean }>;
}

export const GmailAuth = registerPlugin<GmailAuthPluginInterface>('GmailAuth');
