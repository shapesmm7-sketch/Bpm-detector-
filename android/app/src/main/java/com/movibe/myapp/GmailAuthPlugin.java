package com.movibe.myapp;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "GmailAuth")
public class GmailAuthPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<Intent> accountPickerLauncher;
    private ActivityResultLauncher<IntentSenderRequest> authConsentLauncher;
    private String pendingCallId;
    private String pendingSelectedEmail;
    private List<Scope> pendingScopes;

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

                if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    rejectAndClear(saved, "Gmail permission consent was cancelled.");
                    return;
                }

                try {
                    Activity activity = getActivity();
                    if (activity == null) {
                        rejectAndClear(saved, "Android activity unavailable.");
                        return;
                    }
                    AuthorizationResult authResult = Identity.getAuthorizationClient(activity)
                        .getAuthorizationResultFromIntent(result.getData());
                    resolveAuthorizationResult(saved, authResult);
                } catch (Exception e) {
                    rejectAndClear(saved, "Google Play authorization failed: " + e.getMessage());
                }
            }
        );
    }

    @PluginMethod
    public void authorizeGmail(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity unavailable.");
            return;
        }

        List<Scope> scopes = new ArrayList<>();
        JSArray reqScopes = call.getArray("scopes");
        if (reqScopes != null) {
            for (int i = 0; i < reqScopes.length(); i++) {
                String s = reqScopes.optString(i, "").trim();
                if (!s.isEmpty()) {
                    scopes.add(new Scope(s));
                }
            }
        }
        if (scopes.isEmpty()) {
            scopes.add(new Scope("https://www.googleapis.com/auth/gmail.modify"));
            scopes.add(new Scope("https://www.googleapis.com/auth/userinfo.email"));
        }

        String loginHint = call.getString("loginHint", "");
        bridge.saveCall(call);
        pendingCallId = call.getCallbackId();
        pendingScopes = scopes;

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
                        authConsentLauncher.launch(
                            new IntentSenderRequest.Builder(pi.getIntentSender()).build()
                        );
                    } else {
                        rejectAndClear(saved, "Gmail consent dialog unavailable.");
                    }
                } else {
                    resolveAuthorizationResult(saved, authResult);
                }
            })
            .addOnFailureListener(activity, e ->
                rejectAndClear(saved, "Google Play authorization failed: " + e.getMessage())
            );
    }

    private void resolveAuthorizationResult(PluginCall saved, AuthorizationResult authResult) {
        String accessToken = authResult != null ? authResult.getAccessToken() : null;
        if (accessToken == null || accessToken.isEmpty()) {
            rejectAndClear(saved, "Google Play Services did not return a Gmail access token.");
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

        pendingCallId = null;
        pendingSelectedEmail = null;
        pendingScopes = null;
        saved.resolve(res);
        bridge.releaseCall(saved);
    }

    private void rejectAndClear(PluginCall saved, String message) {
        pendingCallId = null;
        pendingSelectedEmail = null;
        pendingScopes = null;
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
