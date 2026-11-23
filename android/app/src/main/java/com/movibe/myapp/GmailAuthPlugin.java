package com.movibe.myapp;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.text.TextUtils;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthException;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "GmailAuth")
public class GmailAuthPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<Intent> accountPickerLauncher;
    private ActivityResultLauncher<IntentSenderRequest> authConsentLauncher;
    private ActivityResultLauncher<Intent> legacyConsentLauncher;
    private String pendingCallId;
    private String pendingSelectedEmail;
    private List<Scope> pendingScopes;
    private List<String> pendingScopeStrings;
    private long consentPromptStartedAtMs = 0L;
    private boolean attemptedLegacyFallback = false;

    @Override
    public void load() {
        accountPickerLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall saved = pendingCallId != null ? bridge.getSavedCall(pendingCallId) : null;
                if (saved == null) return;

                Intent data = result != null ? result.getData() : null;
                if (result == null || result.getResultCode() != Activity.RESULT_OK || data == null) {
                    rejectAndClear(saved, "Google account selection was cancelled.");
                    return;
                }

                String accountName = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
                if (accountName == null || accountName.trim().isEmpty()) {
                    rejectAndClear(saved, "No Google account was selected.");
                    return;
                }

                pendingSelectedEmail = accountName.trim();
                requestPlayAuthorization(saved, pendingSelectedEmail, pendingScopes);
            }
        );

        authConsentLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall saved = pendingCallId != null ? bridge.getSavedCall(pendingCallId) : null;
                if (saved == null) return;

                Activity activity = getActivity();
                if (result != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    try {
                        if (activity == null) {
                            rejectAndClear(saved, "Android activity unavailable.");
                            return;
                        }
                        AuthorizationResult authResult = Identity.getAuthorizationClient(activity)
                            .getAuthorizationResultFromIntent(result.getData());
                        resolveAuthorizationResult(saved, authResult);
                        return;
                    } catch (Exception e) {
                        if (!attemptedLegacyFallback && pendingSelectedEmail != null) {
                            attemptedLegacyFallback = true;
                            tryLegacyGoogleAuthUtil(saved, pendingSelectedEmail, pendingScopeStrings, e.getMessage());
                            return;
                        }
                        rejectAndClear(saved, buildDetailedAuthError("Google Play authorization failed: " + e.getMessage()));
                        return;
                    }
                }

                // Inspect intent even when resultCode != RESULT_OK to surface Play Services ApiException codes
                String apiDetail = null;
                if (activity != null && result != null && result.getData() != null) {
                    try {
                        AuthorizationResult maybeResult = Identity.getAuthorizationClient(activity)
                            .getAuthorizationResultFromIntent(result.getData());
                        if (maybeResult != null && maybeResult.getAccessToken() != null && !maybeResult.getAccessToken().isEmpty()) {
                            resolveAuthorizationResult(saved, maybeResult);
                            return;
                        }
                    } catch (ApiException apiEx) {
                        apiDetail = "Status " + apiEx.getStatusCode() + ": " + apiEx.getMessage();
                    } catch (Exception ex) {
                        apiDetail = ex.getMessage();
                    }
                }

                long elapsed = consentPromptStartedAtMs > 0L ? (System.currentTimeMillis() - consentPromptStartedAtMs) : 0L;
                // If Play Services returned a failure detail or auto-dismissed immediately (< 2.5s), try GoogleAuthUtil fallback
                if (!attemptedLegacyFallback && pendingSelectedEmail != null && (apiDetail != null || elapsed < 2500L)) {
                    attemptedLegacyFallback = true;
                    tryLegacyGoogleAuthUtil(saved, pendingSelectedEmail, pendingScopeStrings, apiDetail);
                    return;
                }

                rejectAndClear(saved, buildDetailedAuthError(
                    apiDetail != null
                        ? "Google sign-in consent failed (" + apiDetail + ")."
                        : "Gmail permission consent was cancelled."
                ));
            }
        );

        legacyConsentLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall saved = pendingCallId != null ? bridge.getSavedCall(pendingCallId) : null;
                if (saved == null) return;

                if (result != null && result.getResultCode() == Activity.RESULT_OK && pendingSelectedEmail != null) {
                    tryLegacyGoogleAuthUtil(saved, pendingSelectedEmail, pendingScopeStrings, null);
                    return;
                }

                rejectAndClear(saved, buildDetailedAuthError("Gmail permission consent was cancelled."));
            }
        );
    }

    @PluginMethod
    public void getSigningInfo(PluginCall call) {
        Context ctx = getContext();
        JSObject res = new JSObject();
        res.put("packageName", ctx.getPackageName());
        res.put("sha1", getInstalledSigningSha1(ctx));
        call.resolve(res);
    }

    @PluginMethod
    public void authorizeGmail(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity unavailable.");
            return;
        }

        if (pendingCallId != null) {
            PluginCall prev = bridge.getSavedCall(pendingCallId);
            if (prev != null) {
                bridge.releaseCall(prev);
            }
            pendingCallId = null;
        }

        List<Scope> scopes = new ArrayList<>();
        List<String> scopeStrings = new ArrayList<>();
        JSArray reqScopes = call.getArray("scopes");
        if (reqScopes != null) {
            for (int i = 0; i < reqScopes.length(); i++) {
                String s = reqScopes.optString(i, "").trim();
                if (!s.isEmpty()) {
                    scopes.add(new Scope(s));
                    scopeStrings.add(s);
                }
            }
        }
        if (scopes.isEmpty()) {
            String s1 = "https://www.googleapis.com/auth/gmail.modify";
            String s2 = "https://www.googleapis.com/auth/userinfo.email";
            scopes.add(new Scope(s1));
            scopes.add(new Scope(s2));
            scopeStrings.add(s1);
            scopeStrings.add(s2);
        }

        String loginHint = call.getString("loginHint", "");
        bridge.saveCall(call);
        pendingCallId = call.getCallbackId();
        pendingScopes = scopes;
        pendingScopeStrings = scopeStrings;
        attemptedLegacyFallback = false;
        consentPromptStartedAtMs = 0L;

        if (loginHint != null && !loginHint.trim().isEmpty()) {
            pendingSelectedEmail = loginHint.trim();
            requestPlayAuthorization(call, pendingSelectedEmail, scopes);
            return;
        }

        pendingSelectedEmail = null;
        Intent chooseIntent = AccountManager.newChooseAccountIntent(
            null,
            null,
            new String[] { "com.google" },
            null,
            null,
            null,
            null
        );
        activity.runOnUiThread(() -> accountPickerLauncher.launch(chooseIntent));
    }

    private void requestPlayAuthorization(PluginCall saved, String email, List<Scope> scopes) {
        Activity activity = getActivity();
        if (activity == null) {
            rejectAndClear(saved, "Android activity unavailable.");
            return;
        }

        AuthorizationRequest.Builder builder = AuthorizationRequest.builder()
            .setRequestedScopes(scopes);
        if (email != null && !email.isEmpty()) {
            builder.setAccount(new Account(email, "com.google"));
        }

        Identity.getAuthorizationClient(activity)
            .authorize(builder.build())
            .addOnSuccessListener(activity, authResult -> {
                if (authResult.hasResolution()) {
                    PendingIntent pi = authResult.getPendingIntent();
                    if (pi != null) {
                        consentPromptStartedAtMs = System.currentTimeMillis();
                        authConsentLauncher.launch(
                            new IntentSenderRequest.Builder(pi.getIntentSender()).build()
                        );
                    } else if (!attemptedLegacyFallback && email != null) {
                        attemptedLegacyFallback = true;
                        tryLegacyGoogleAuthUtil(saved, email, pendingScopeStrings, "Consent dialog unavailable.");
                    } else {
                        rejectAndClear(saved, buildDetailedAuthError("Gmail consent dialog unavailable."));
                    }
                } else {
                    resolveAuthorizationResult(saved, authResult);
                }
            })
            .addOnFailureListener(activity, e -> {
                if (!attemptedLegacyFallback && email != null) {
                    attemptedLegacyFallback = true;
                    tryLegacyGoogleAuthUtil(saved, email, pendingScopeStrings, e.getMessage());
                    return;
                }
                rejectAndClear(saved, buildDetailedAuthError("Google Play authorization failed: " + e.getMessage()));
            });
    }

    private void tryLegacyGoogleAuthUtil(
        PluginCall saved,
        String email,
        List<String> scopeStrings,
        String previousReason
    ) {
        if (email == null || email.isEmpty() || scopeStrings == null || scopeStrings.isEmpty()) {
            rejectAndClear(saved, buildDetailedAuthError(previousReason != null ? previousReason : "Gmail authorization could not be completed."));
            return;
        }

        final String oauthScope = "oauth2:" + TextUtils.join(" ", scopeStrings);
        executor.execute(() -> {
            try {
                String token = GoogleAuthUtil.getToken(
                    getContext(),
                    new Account(email, "com.google"),
                    oauthScope
                );
                if (token == null || token.isEmpty()) {
                    rejectAndClear(saved, buildDetailedAuthError("Google did not return a Gmail access token."));
                    return;
                }

                JSArray grantedArr = new JSArray();
                for (String s : scopeStrings) {
                    grantedArr.put(s);
                }
                JSObject res = new JSObject();
                res.put("accessToken", token);
                res.put("email", email);
                res.put("grantedScopes", grantedArr);

                clearPendingState();
                saved.resolve(res);
                bridge.releaseCall(saved);
            } catch (UserRecoverableAuthException recoverableEx) {
                Intent recoverIntent = recoverableEx.getIntent();
                Activity activity = getActivity();
                if (recoverIntent != null && activity != null) {
                    activity.runOnUiThread(() -> legacyConsentLauncher.launch(recoverIntent));
                } else {
                    rejectAndClear(saved, buildDetailedAuthError(recoverableEx.getMessage()));
                }
            } catch (GoogleAuthException authEx) {
                rejectAndClear(saved, buildDetailedAuthError("Google Auth rejected request: " + authEx.getMessage()));
            } catch (Exception e) {
                String base = previousReason != null && !previousReason.isEmpty() ? previousReason + " / " : "";
                rejectAndClear(saved, buildDetailedAuthError(base + e.getMessage()));
            }
        });
    }

    private void resolveAuthorizationResult(PluginCall saved, AuthorizationResult authResult) {
        String accessToken = authResult != null ? authResult.getAccessToken() : null;
        if (accessToken == null || accessToken.isEmpty()) {
            rejectAndClear(saved, buildDetailedAuthError("Google Play Services did not return a Gmail access token."));
            return;
        }

        JSArray grantedArr = new JSArray();
        if (authResult.getGrantedScopes() != null) {
            for (String s : authResult.getGrantedScopes()) {
                grantedArr.put(s);
            }
        }

        JSObject res = new JSObject();
        res.put("accessToken", accessToken);
        res.put("email", pendingSelectedEmail != null ? pendingSelectedEmail : "");
        res.put("grantedScopes", grantedArr);

        clearPendingState();
        saved.resolve(res);
        bridge.releaseCall(saved);
    }

    private String buildDetailedAuthError(String baseMessage) {
        String sha1 = getInstalledSigningSha1(getContext());
        String pkg = getContext().getPackageName();
        StringBuilder sb = new StringBuilder(baseMessage != null ? baseMessage : "Google Sign-In failed.");
        if (!sha1.isEmpty()) {
            sb.append(" [Installed APK -> Package: ").append(pkg)
              .append(", SHA-1: ").append(sha1)
              .append(". Confirm this exact SHA-1 is saved on your Android OAuth Client in Google Cloud project 'mo-vibe', and your Gmail address is added under OAuth consent screen -> Test users.]");
        }
        return sb.toString();
    }

    private static String getInstalledSigningSha1(Context ctx) {
        try {
            PackageManager pm = ctx.getPackageManager();
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo pi = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                if (pi.signingInfo == null) return "";
                sigs = pi.signingInfo.hasMultipleSigners()
                    ? pi.signingInfo.getApkContentsSigners()
                    : pi.signingInfo.getSigningCertificateHistory();
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo pi = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNATURES);
                @SuppressWarnings("deprecation")
                Signature[] legacySigs = pi.signatures;
                sigs = legacySigs;
            }
            if (sigs == null || sigs.length == 0) return "";
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(sigs[0].toByteArray());
            StringBuilder hex = new StringBuilder(digest.length * 3);
            for (int i = 0; i < digest.length; i++) {
                if (i > 0) hex.append(':');
                hex.append(String.format(Locale.US, "%02X", digest[i]));
            }
            return hex.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private void clearPendingState() {
        pendingCallId = null;
        pendingSelectedEmail = null;
        pendingScopes = null;
        pendingScopeStrings = null;
        consentPromptStartedAtMs = 0L;
        attemptedLegacyFallback = false;
    }

    private void rejectAndClear(PluginCall saved, String message) {
        clearPendingState();
        saved.reject(message);
        bridge.releaseCall(saved);
    }

    @PluginMethod
    public void clearCachedToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token == null || token.trim().isEmpty()) {
            JSObject res = new JSObject();
            res.put("cleared", true);
            call.resolve(res);
            return;
        }
        executor.execute(() -> {
            try {
                GoogleAuthUtil.clearToken(getContext(), token.trim());
                JSObject res = new JSObject();
                res.put("cleared", true);
                call.resolve(res);
            } catch (Exception e) {
                JSObject res = new JSObject();
                res.put("cleared", false);
                call.resolve(res);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        executor.shutdownNow();
    }
}
