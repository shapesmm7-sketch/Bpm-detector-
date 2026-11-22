package com.movibe.myapp;

import android.Manifest;
import android.app.Activity;
import android.app.RecoverableSecurityException;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.media.MediaRecorder;
import android.media.MediaScannerConnection;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;
import android.util.Base64;
import android.util.Size;
import android.view.View;
import android.view.Window;
import android.webkit.MimeTypeMap;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "AudioLibrary")
public class AudioLibraryPlugin extends Plugin {

    private static final String PROBE_AUDIO_FILENAME = "beatpulse_default_setup_probe.mp3";
    private static final String PROBE_VIDEO_FILENAME = "beatpulse_default_setup_probe.mp4";

    private static final String EXTRA_SHORTCUT_TRACK_URI = "movibe_shortcut_track_uri";
    private static final String EXTRA_SHORTCUT_TRACK_TITLE = "movibe_shortcut_track_title";
    private static final String EXTRA_SHORTCUT_TRACK_ARTIST = "movibe_shortcut_track_artist";
    private static final String EXTRA_SHORTCUT_TRACK_DISPLAY_NAME = "movibe_shortcut_track_display_name";
    private static final String EXTRA_SHORTCUT_TRACK_ID = "movibe_shortcut_track_id";

    private ActivityResultLauncher<String> permissionLauncher;
    private ActivityResultLauncher<String> notificationPermissionLauncher;
    private ActivityResultLauncher<IntentSenderRequest> mediaConsentLauncher;
    private ActivityResultLauncher<Intent> folderPickerLauncher;
    private ActivityResultLauncher<String[]> recordPermissionsLauncher;
    private boolean hasRequestedNotifications = false;
    private String pendingCallId;
    private String pendingPermissionType = "audio";
    private String pendingConsentCallId;
    private Runnable pendingConsentAction;
    private String pendingConsentMode = "delete";
    private String pendingFolderCallId;
    private String pendingRecordCallId;
    private String pendingRecordAction = "start";
    private File lastTempAudioFile;
    private File lastPlayerAudioFile;
    private File lastPlayerVideoFile;
    private File lastExternalMediaFile;
    private final Object pendingMediaLock = new Object();
    private JSObject pendingExternalMedia;
    private String pendingOpenSection;
    private final Map<String, File> pendingExports = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService thumbExecutor = Executors.newFixedThreadPool(3);
    private final ScheduledExecutorService expiryScheduler = Executors.newSingleThreadScheduledExecutor();

    // Voice & Call Recorder state
    private static final String PREF_AUTO_CALL_REC = "movibe_auto_call_recording";
    private static final String PREF_AUTO_CALL_SPEAKERPHONE = "movibe_auto_call_speakerphone";
    private static final String PREF_CALL_DISAPPEAR_MS = "movibe_call_disappear_ms";
    private static final String PREF_CALL_EXPIRY_ENTRIES = "movibe_call_expiry_entries";
    private final Object recorderLock = new Object();
    private final Object expiryLock = new Object();
    private MediaRecorder activeRecorder;
    private File activeRecordingFile;
    private String activeRecordingMode = "voice";
    private String activeRecordingTitle = "";
    private boolean isRecordingAudio = false;
    private boolean isRecordingPaused = false;
    private boolean isAutoCallRecordingActive = false;
    private boolean autoCallSpeakerphone = true;
    private long callDisappearAfterMs = 0L;
    private boolean autoCallStartedThisRecording = false;
    private long recordingStartElapsedMs = 0L;
    private long recordingPausedAtMs = 0L;
    private long recordingPausedAccumulatedMs = 0L;
    private boolean savedSpeakerphoneRestore = false;
    private boolean prevSpeakerphoneState = false;
    private int prevAudioMode = AudioManager.MODE_NORMAL;
    private int lastTelephonyState = TelephonyManager.CALL_STATE_IDLE;
    private TelephonyManager telephonyManager;
    private Object activeTelephonyCallback;
    @SuppressWarnings("deprecation")
    private PhoneStateListener legacyPhoneStateListener;

    @Override
    public void load() {
        permissionLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            isGranted -> {
                PluginCall savedCall = pendingCallId != null ? bridge.getSavedCall(pendingCallId) : null;
                String permType = pendingPermissionType != null ? pendingPermissionType : "audio";
                pendingCallId = null;
                pendingPermissionType = "audio";
                if (savedCall == null) {
                    return;
                }

                if (Boolean.TRUE.equals(isGranted)) {
                    if ("video".equals(permType)) {
                        loadVideoFiles(savedCall, true);
                    } else if ("image".equals(permType)) {
                        loadImageFiles(savedCall, true);
                    } else {
                        loadAudioFiles(savedCall, true);
                    }
                } else {
                    String deniedMsg = "video".equals(permType)
                        ? "Allow video access to see videos"
                        : "image".equals(permType)
                        ? "Allow photos access to see images"
                        : "Allow audio access to see songs";
                    if (getActivity() != null) {
                        getActivity().runOnUiThread(() ->
                            Toast.makeText(getContext(), deniedMsg, Toast.LENGTH_SHORT).show()
                        );
                    }
                    JSObject result = new JSObject();
                    result.put("granted", false);
                    if ("video".equals(permType)) {
                        result.put("videos", new JSArray());
                    } else if ("image".equals(permType)) {
                        result.put("images", new JSArray());
                    } else {
                        result.put("songs", new JSArray());
                    }
                    savedCall.resolve(result);
                    bridge.releaseCall(savedCall);
                }
            }
        );

        notificationPermissionLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            isGranted -> {
                // Notification permission result handled cleanly without interrupting playback
            }
        );

        mediaConsentLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall savedCall = pendingConsentCallId != null ? bridge.getSavedCall(pendingConsentCallId) : null;
                Runnable action = pendingConsentAction;
                String mode = pendingConsentMode;
                pendingConsentCallId = null;
                pendingConsentAction = null;
                pendingConsentMode = "delete";

                if (result != null && result.getResultCode() == Activity.RESULT_OK && action != null) {
                    executor.execute(action);
                } else if (savedCall != null) {
                    JSObject cancelledRes = new JSObject();
                    if ("rename".equals(mode)) {
                        cancelledRes.put("renamed", false);
                    } else if ("move".equals(mode)) {
                        cancelledRes.put("success", false);
                    } else {
                        cancelledRes.put("deleted", false);
                    }
                    cancelledRes.put("cancelled", true);
                    savedCall.resolve(cancelledRes);
                    bridge.releaseCall(savedCall);
                }
            }
        );

        folderPickerLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall savedCall = pendingFolderCallId != null ? bridge.getSavedCall(pendingFolderCallId) : null;
                pendingFolderCallId = null;
                if (savedCall == null) return;

                Intent data = result != null ? result.getData() : null;
                Uri treeUri = (result != null && result.getResultCode() == Activity.RESULT_OK && data != null)
                    ? data.getData()
                    : null;
                if (treeUri == null) {
                    JSObject cancelledRes = new JSObject();
                    cancelledRes.put("success", false);
                    cancelledRes.put("cancelled", true);
                    savedCall.resolve(cancelledRes);
                    bridge.releaseCall(savedCall);
                    return;
                }

                try {
                    int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    if (flags != 0) {
                        getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);
                    }
                } catch (Exception ignored) {
                    // non-persistable grants are still valid for this immediate copy/move
                }

                executor.execute(() -> {
                    executeMoveOrCopyIntoTreeUri(savedCall, treeUri);
                    bridge.releaseCall(savedCall);
                });
            }
        );

        recordPermissionsLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            grants -> {
                PluginCall savedCall = pendingRecordCallId != null ? bridge.getSavedCall(pendingRecordCallId) : null;
                String action = pendingRecordAction != null ? pendingRecordAction : "start";
                pendingRecordCallId = null;
                pendingRecordAction = "start";
                if (savedCall == null) return;

                boolean micGranted = grants != null && Boolean.TRUE.equals(grants.get(Manifest.permission.RECORD_AUDIO));
                if (!micGranted) {
                    micGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                }
                if (!micGranted) {
                    savedCall.reject("Microphone permission is required for recording.");
                    bridge.releaseCall(savedCall);
                    return;
                }

                if ("auto_call".equals(action) || "call_settings".equals(action)) {
                    boolean phoneGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
                    if (!phoneGranted) {
                        savedCall.reject("Phone permission is required for automatic call recording.");
                        bridge.releaseCall(savedCall);
                        return;
                    }
                    if ("call_settings".equals(action)) {
                        applyCallRecorderSettingsInternal(savedCall, true);
                    } else {
                        applyAutoCallRecordingState(savedCall, true);
                    }
                    bridge.releaseCall(savedCall);
                } else {
                    startRecordingWithPermissions(savedCall);
                    bridge.releaseCall(savedCall);
                }
            }
        );

        MusicPlaybackService.setStateListener(state ->
            notifyListeners("musicPlaybackStateChanged", state)
        );

        SharedPreferences recPrefs = getContext().getSharedPreferences("movibe_prefs", Context.MODE_PRIVATE);
        autoCallSpeakerphone = recPrefs.getBoolean(PREF_AUTO_CALL_SPEAKERPHONE, true);
        callDisappearAfterMs = Math.max(0L, recPrefs.getLong(PREF_CALL_DISAPPEAR_MS, 0L));
        if (recPrefs.getBoolean(PREF_AUTO_CALL_REC, false)
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
            isAutoCallRecordingActive = true;
            registerCallStateMonitor();
        }
        expiryScheduler.scheduleWithFixedDelay(
            () -> purgeExpiredCallRecordingsInternal(true),
            2L,
            30L,
            TimeUnit.SECONDS
        );

        if (getActivity() != null) {
            handleExternalIntent(getActivity().getIntent());
            handleNavigationIntent(getActivity().getIntent());
        }
    }

    public void handleNavigationIntent(Intent intent) {
        if (intent == null) return;
        String shortcutUri = intent.getStringExtra(EXTRA_SHORTCUT_TRACK_URI);
        if (shortcutUri != null && !shortcutUri.isEmpty()) {
            String scTitle = intent.getStringExtra(EXTRA_SHORTCUT_TRACK_TITLE);
            String scArtist = intent.getStringExtra(EXTRA_SHORTCUT_TRACK_ARTIST);
            String scDisplay = intent.getStringExtra(EXTRA_SHORTCUT_TRACK_DISPLAY_NAME);
            intent.removeExtra(EXTRA_SHORTCUT_TRACK_URI);

            JSObject mediaPayload = new JSObject();
            mediaPayload.put("requestId", UUID.randomUUID().toString());
            mediaPayload.put("mediaKind", "audio");
            mediaPayload.put("title", scTitle != null && !scTitle.isEmpty() ? scTitle : "Audio Track");
            mediaPayload.put("displayName", scDisplay != null && !scDisplay.isEmpty() ? scDisplay : (scTitle != null ? scTitle : "track.mp3"));
            mediaPayload.put("mimeType", "audio/*");
            mediaPayload.put("size", 0);
            mediaPayload.put("durationMs", 0);
            mediaPayload.put("uri", shortcutUri);
            mediaPayload.put("localUrl", shortcutUri);
            if (scArtist != null) mediaPayload.put("artist", scArtist);

            synchronized (pendingMediaLock) {
                pendingExternalMedia = mediaPayload;
            }
            notifyListeners("externalMediaOpened", mediaPayload);
        }

        String targetSection = intent.getStringExtra(MusicPlaybackService.EXTRA_OPEN_SECTION);
        if (targetSection == null || targetSection.isEmpty()) return;
        intent.removeExtra(MusicPlaybackService.EXTRA_OPEN_SECTION);

        synchronized (pendingMediaLock) {
            pendingOpenSection = targetSection;
        }
        JSObject payload = new JSObject();
        payload.put("section", targetSection);
        notifyListeners("openSectionRequested", payload);
    }

    @PluginMethod
    public void consumePendingOpenSection(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (pendingMediaLock) {
            result.put("section", pendingOpenSection);
            pendingOpenSection = null;
        }
        call.resolve(result);
    }

    public void handleExternalIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        if (intent.getBooleanExtra("beatpulse_handled", false)) {
            return;
        }
        Uri data = intent.getData();
        if (data == null) {
            return;
        }
        intent.putExtra("beatpulse_handled", true);

        String uriString = data.toString();
        if (uriString.contains("beatpulse_default_setup_probe")) {
            JSObject status = buildDefaultPlayerStatus();
            notifyListeners("defaultPlayerStatusChanged", status);
            if (getActivity() != null) {
                boolean audioSet = status.optBoolean("isAudioDefault", false);
                boolean videoSet = status.optBoolean("isVideoDefault", false);
                String msg = (audioSet || videoSet)
                    ? "Mo Vibe set as default player!"
                    : "Choose 'Always' next time to set Mo Vibe as default.";
                getActivity().runOnUiThread(() ->
                    Toast.makeText(getContext(), msg, Toast.LENGTH_SHORT).show()
                );
            }
            return;
        }

        final String intentMime = intent.getType();
        executor.execute(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                String resolvedMime = intentMime;
                if (resolvedMime == null || resolvedMime.isEmpty() || "*/*".equals(resolvedMime)) {
                    resolvedMime = resolver.getType(data);
                }

                String displayName = null;
                long size = 0;
                String scheme = data.getScheme() != null ? data.getScheme().toLowerCase(Locale.US) : "";

                if ("content".equals(scheme)) {
                    try (Cursor cursor = resolver.query(
                        data,
                        new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
                        null,
                        null,
                        null
                    )) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                            if (nameIdx >= 0) {
                                displayName = cursor.getString(nameIdx);
                            }
                            if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                                size = cursor.getLong(sizeIdx);
                            }
                        }
                    } catch (Exception ignored) {
                        // fallback below
                    }
                }

                if (displayName == null || displayName.isEmpty()) {
                    String lastSeg = data.getLastPathSegment();
                    if (lastSeg != null && !lastSeg.isEmpty()) {
                        int slash = lastSeg.lastIndexOf('/');
                        displayName = slash >= 0 ? lastSeg.substring(slash + 1) : lastSeg;
                    }
                }

                String ext = extractExtension(displayName, uriString, resolvedMime);
                if (resolvedMime == null || resolvedMime.isEmpty() || "*/*".equals(resolvedMime)) {
                    resolvedMime = inferMimeFromExtension(ext);
                }

                String mediaKind = determineMediaKind(resolvedMime, ext);
                if (mediaKind == null) {
                    return;
                }

                if (displayName == null || displayName.isEmpty()) {
                    displayName = "video".equals(mediaKind) ? "external_video" + ext : "external_audio" + ext;
                }

                String title = displayName;
                int dotIdx = title.lastIndexOf('.');
                if (dotIdx > 0) {
                    title = title.substring(0, dotIdx);
                }

                String filePath = null;
                String localUrl;

                if ("http".equals(scheme) || "https".equals(scheme)) {
                    localUrl = uriString;
                } else {
                    // Check if file:// URI points to a directly readable local file without URL-unsafe characters
                    if ("file".equals(scheme) && data.getPath() != null) {
                        String rawPath = data.getPath();
                        boolean hasUnsafeUrlChars = rawPath.contains("#") || rawPath.contains("?") || rawPath.contains("%");
                        File directFile = new File(rawPath);
                        if (!hasUnsafeUrlChars && directFile.exists() && directFile.canRead()) {
                            filePath = directFile.getAbsolutePath();
                            if (size <= 0) {
                                size = directFile.length();
                            }
                        }
                    }

                    // Check MediaStore DATA column for content:// URIs
                    if (filePath == null && "content".equals(scheme)) {
                        try (Cursor pathCursor = resolver.query(
                            data,
                            new String[] { MediaStore.MediaColumns.DATA },
                            null,
                            null,
                            null
                        )) {
                            if (pathCursor != null && pathCursor.moveToFirst()) {
                                int dataIdx = pathCursor.getColumnIndex(MediaStore.MediaColumns.DATA);
                                if (dataIdx >= 0) {
                                    String candidate = pathCursor.getString(dataIdx);
                                    if (candidate != null && !candidate.isEmpty()) {
                                        boolean hasUnsafeUrlChars = candidate.contains("#") || candidate.contains("?") || candidate.contains("%");
                                        File directFile = new File(candidate);
                                        if (!hasUnsafeUrlChars && directFile.exists() && directFile.canRead()) {
                                            filePath = directFile.getAbsolutePath();
                                            if (size <= 0) {
                                                size = directFile.length();
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (Exception ignored) {
                            filePath = null;
                        }
                    }

                    // Fallback: copy stream into local cache while temporary content URI grant is active
                    if (filePath == null) {
                        if (lastExternalMediaFile != null && lastExternalMediaFile.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            lastExternalMediaFile.delete();
                        }
                        String safeExt = (ext != null && !ext.isEmpty()) ? ext : ("video".equals(mediaKind) ? ".mp4" : ".mp3");
                        File outFile = new File(
                            getContext().getCacheDir(),
                            "beatpulse_external_" + mediaKind + "_" + System.currentTimeMillis() + safeExt
                        );
                        lastExternalMediaFile = outFile;

                        try (InputStream in = resolver.openInputStream(data);
                             FileOutputStream out = new FileOutputStream(outFile)) {
                            if (in == null) {
                                return;
                            }
                            byte[] buf = new byte[131072];
                            int len;
                            long totalWritten = 0;
                            while ((len = in.read(buf)) != -1) {
                                out.write(buf, 0, len);
                                totalWritten += len;
                            }
                            out.flush();
                            if (size <= 0) {
                                size = totalWritten;
                            }
                        }
                        filePath = outFile.getAbsolutePath();
                    }

                    localUrl = bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + filePath;
                }

                long durationMs = 0;
                String resolution = "";
                if (filePath != null) {
                    MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                    try {
                        mmr.setDataSource(filePath);
                        String durStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                        if (durStr != null) {
                            durationMs = Long.parseLong(durStr);
                        }
                        if ("video".equals(mediaKind)) {
                            String vw = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
                            String vh = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                            if (vw != null && vh != null) {
                                resolution = vw + "x" + vh;
                            }
                        }
                    } catch (Exception ignored) {
                        // ignore metadata extraction errors
                    } finally {
                        try {
                            mmr.release();
                        } catch (Exception ignored) {
                            // ignore
                        }
                    }
                }

                JSObject payload = new JSObject();
                payload.put("requestId", UUID.randomUUID().toString());
                payload.put("mediaKind", mediaKind);
                payload.put("title", title);
                payload.put("displayName", displayName);
                payload.put("mimeType", resolvedMime != null ? resolvedMime : ("video".equals(mediaKind) ? "video/*" : "audio/*"));
                payload.put("size", size);
                payload.put("durationMs", durationMs);
                payload.put("resolution", resolution);
                payload.put("uri", uriString);
                if (filePath != null) {
                    payload.put("filePath", filePath);
                }
                payload.put("localUrl", localUrl);

                synchronized (pendingMediaLock) {
                    pendingExternalMedia = payload;
                }
                notifyListeners("externalMediaOpened", payload);
            } catch (Exception e) {
                if (getActivity() != null) {
                    getActivity().runOnUiThread(() ->
                        Toast.makeText(getContext(), "Unable to open media file in Mo Vibe", Toast.LENGTH_SHORT).show()
                    );
                }
            }
        });
    }

    @PluginMethod
    public void consumePendingExternalMedia(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (pendingMediaLock) {
            result.put("media", pendingExternalMedia);
            pendingExternalMedia = null;
        }
        call.resolve(result);
    }

    @PluginMethod
    public void getDefaultPlayerStatus(PluginCall call) {
        call.resolve(buildDefaultPlayerStatus());
    }

    @PluginMethod
    public void setAsDefaultPlayer(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity unavailable");
            return;
        }

        String requestedType = call.getString("mediaType", "auto");
        DefaultResolution audioRes = resolveMediaDefault("audio/mpeg", PROBE_AUDIO_FILENAME);
        DefaultResolution videoRes = resolveMediaDefault("video/mp4", PROBE_VIDEO_FILENAME);

        String target;
        DefaultResolution targetRes;

        if ("audio".equals(requestedType)) {
            target = "audio";
            targetRes = audioRes;
        } else if ("video".equals(requestedType)) {
            target = "video";
            targetRes = videoRes;
        } else {
            if (!audioRes.isDefault) {
                target = "audio";
                targetRes = audioRes;
            } else if (!videoRes.isDefault) {
                target = "video";
                targetRes = videoRes;
            } else {
                JSObject already = buildDefaultPlayerStatus(audioRes, videoRes);
                already.put("action", "already_default");
                already.put("target", "both");
                call.resolve(already);
                return;
            }
        }

        if (targetRes.isDefault) {
            JSObject already = buildDefaultPlayerStatus(audioRes, videoRes);
            already.put("action", "already_default");
            already.put("target", target);
            call.resolve(already);
            return;
        }

        // If another app is already locked as the default handler, open its App Info so the user can tap Clear defaults
        if (targetRes.otherPackage != null && !targetRes.otherPackage.isEmpty()) {
            boolean opened = openAppDetailsSettingsInternal(targetRes.otherPackage);
            if (!opened) {
                openManageDefaultAppsInternal();
            }
            JSObject res = buildDefaultPlayerStatus(audioRes, videoRes);
            res.put("action", "opened_clear_defaults");
            res.put("target", target);
            res.put("lockedApp", targetRes.otherAppName != null ? targetRes.otherAppName : targetRes.otherPackage);
            res.put("lockedPackage", targetRes.otherPackage);
            call.resolve(res);
            return;
        }

        // No default set yet: launch raw ACTION_VIEW on probe media so Android shows "Open with BeatPulse -> Always"
        try {
            boolean isVideo = "video".equals(target);
            File probeFile = ensureProbeFile(
                isVideo ? PROBE_VIDEO_FILENAME : PROBE_AUDIO_FILENAME,
                isVideo
            );
            Uri probeUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                probeFile
            );
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            viewIntent.setDataAndType(probeUri, isVideo ? "video/mp4" : "audio/mpeg");
            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(viewIntent);

            JSObject res = buildDefaultPlayerStatus(audioRes, videoRes);
            res.put("action", "prompted_chooser");
            res.put("target", target);
            call.resolve(res);
        } catch (Exception e) {
            openManageDefaultAppsInternal();
            JSObject res = buildDefaultPlayerStatus(audioRes, videoRes);
            res.put("action", "opened_settings");
            res.put("target", target);
            call.resolve(res);
        }
    }

    @PluginMethod
    public void openDefaultAppsSettings(PluginCall call) {
        String pkg = call.getString("packageName");
        boolean opened;
        if (pkg != null && !pkg.isEmpty()) {
            opened = openAppDetailsSettingsInternal(pkg);
        } else {
            opened = openManageDefaultAppsInternal();
        }
        JSObject res = new JSObject();
        res.put("opened", opened);
        call.resolve(res);
    }

    @PluginMethod
    public void setAppAppearance(PluginCall call) {
        String rawTheme = call.getString("theme", "light");
        String theme = ("dark".equals(rawTheme) || "system".equals(rawTheme)) ? rawTheme : "light";

        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences("beatpulse_prefs", Context.MODE_PRIVATE);
        prefs.edit().putString("app_theme_v2", theme).apply();

        boolean isDark = resolveIsDarkTheme(ctx, theme);
        Activity activity = getActivity();
        WebView webView = bridge != null ? bridge.getWebView() : null;

        if (activity != null) {
            activity.runOnUiThread(() -> applyNativeAppearance(activity, webView, isDark));
        }

        JSObject res = new JSObject();
        res.put("applied", true);
        res.put("theme", theme);
        res.put("isDark", isDark);
        call.resolve(res);
    }

    public static void applyStoredAppearance(Activity activity, WebView webView) {
        if (activity == null) return;
        SharedPreferences prefs = activity.getSharedPreferences("beatpulse_prefs", Context.MODE_PRIVATE);
        String theme = prefs.getString("app_theme_v2", "light");
        boolean isDark = resolveIsDarkTheme(activity, theme);
        activity.runOnUiThread(() -> applyNativeAppearance(activity, webView, isDark));
    }

    private static boolean resolveIsDarkTheme(Context context, String theme) {
        if ("light".equals(theme)) {
            return false;
        }
        if ("system".equals(theme)) {
            int nightFlags = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return nightFlags == Configuration.UI_MODE_NIGHT_YES;
        }
        return true;
    }

    @SuppressWarnings("deprecation")
    private static void applyNativeAppearance(Activity activity, WebView webView, boolean isDark) {
        Window window = activity.getWindow();
        if (window != null) {
            View decorView = window.getDecorView();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
            if (controller != null) {
                controller.setAppearanceLightStatusBars(!isDark);
                controller.setAppearanceLightNavigationBars(!isDark);
            }
            if (Build.VERSION.SDK_INT < 35) {
                window.setStatusBarColor(isDark ? 0xFF020617 : 0xFFF8FAFC);
                window.setNavigationBarColor(isDark ? 0xFF0F172A : 0xFFFFFFFF);
            }
        }
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                settings.setAlgorithmicDarkeningAllowed(false);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                settings.setForceDark(WebSettings.FORCE_DARK_OFF);
            }
        }
    }

    private static class DefaultResolution {
        boolean isDefault;
        String otherPackage;
        String otherAppName;
    }

    private JSObject buildDefaultPlayerStatus() {
        DefaultResolution audioRes = resolveMediaDefault("audio/mpeg", PROBE_AUDIO_FILENAME);
        DefaultResolution videoRes = resolveMediaDefault("video/mp4", PROBE_VIDEO_FILENAME);
        return buildDefaultPlayerStatus(audioRes, videoRes);
    }

    private JSObject buildDefaultPlayerStatus(DefaultResolution audioRes, DefaultResolution videoRes) {
        JSObject status = new JSObject();
        status.put("supported", true);
        status.put("isAudioDefault", audioRes.isDefault);
        status.put("isVideoDefault", videoRes.isDefault);
        status.put("audioDefaultApp", audioRes.otherAppName);
        status.put("audioDefaultPkg", audioRes.otherPackage);
        status.put("videoDefaultApp", videoRes.otherAppName);
        status.put("videoDefaultPkg", videoRes.otherPackage);
        return status;
    }

    private DefaultResolution resolveMediaDefault(String mimeType, String probeFileName) {
        DefaultResolution result = new DefaultResolution();
        try {
            PackageManager pm = getContext().getPackageManager();
            String myPkg = getContext().getPackageName();
            File probeFile = ensureProbeFile(probeFileName, mimeType.startsWith("video/"));
            Uri probeUri = FileProvider.getUriForFile(getContext(), myPkg + ".fileprovider", probeFile);

            Intent queryIntent = new Intent(Intent.ACTION_VIEW);
            queryIntent.setDataAndType(probeUri, mimeType);
            queryIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            ResolveInfo ri = pm.resolveActivity(queryIntent, PackageManager.MATCH_DEFAULT_ONLY);
            if (ri != null && ri.activityInfo != null) {
                ActivityInfo ai = ri.activityInfo;
                if (myPkg.equals(ai.packageName)) {
                    result.isDefault = true;
                } else if (!isSystemResolver(ai)) {
                    result.otherPackage = ai.packageName;
                    CharSequence label = ri.loadLabel(pm);
                    result.otherAppName = label != null ? label.toString() : ai.packageName;
                }
            }
        } catch (Exception ignored) {
            // Leave defaults as false/null if package resolution is restricted
        }
        return result;
    }

    private boolean isSystemResolver(ActivityInfo ai) {
        if (ai == null) return true;
        String pkg = ai.packageName != null ? ai.packageName.toLowerCase(Locale.US) : "";
        String cls = ai.name != null ? ai.name.toLowerCase(Locale.US) : "";
        return "android".equals(pkg)
            || cls.contains("resolveractivity")
            || cls.contains("chooseractivity")
            || pkg.contains("resolver")
            || pkg.contains("intentresolver");
    }

    private File ensureProbeFile(String fileName, boolean isVideo) {
        File file = new File(getContext().getCacheDir(), fileName);
        if (file.exists() && file.length() > 0) {
            return file;
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            if (isVideo) {
                byte[] mp4Header = new byte[] {
                    0x00, 0x00, 0x00, 0x14, 'f', 't', 'y', 'p',
                    'i', 's', 'o', 'm', 0x00, 0x00, 0x00, 0x01,
                    'i', 's', 'o', 'm'
                };
                out.write(mp4Header);
            } else {
                byte[] mp3Frame = new byte[417];
                mp3Frame[0] = (byte) 0xFF;
                mp3Frame[1] = (byte) 0xFB;
                mp3Frame[2] = (byte) 0x90;
                mp3Frame[3] = 0x00;
                out.write(mp3Frame);
            }
            out.flush();
        } catch (Exception ignored) {
            // ignore write error
        }
        return file;
    }

    private boolean openAppDetailsSettingsInternal(String packageName) {
        if (getActivity() == null) return false;
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + packageName));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private boolean openManageDefaultAppsInternal() {
        if (getActivity() == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                return true;
            } catch (ActivityNotFoundException ignored) {
                // fallback below
            }
        }
        return openAppDetailsSettingsInternal(getContext().getPackageName());
    }

    private String extractExtension(String displayName, String uriString, String mimeType) {
        String candidate = displayName != null && !displayName.isEmpty() ? displayName : uriString;
        if (candidate != null) {
            int qIdx = candidate.indexOf('?');
            if (qIdx >= 0) {
                candidate = candidate.substring(0, qIdx);
            }
            int dotIdx = candidate.lastIndexOf('.');
            if (dotIdx >= 0 && dotIdx < candidate.length() - 1) {
                String rawExt = candidate.substring(dotIdx).replaceAll("[^a-zA-Z0-9.]", "").toLowerCase(Locale.US);
                if (rawExt.length() >= 2 && rawExt.length() <= 6) {
                    return rawExt;
                }
            }
        }
        if (mimeType != null && !mimeType.isEmpty()) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType.toLowerCase(Locale.US));
            if (ext != null && !ext.isEmpty()) {
                return "." + ext.toLowerCase(Locale.US);
            }
        }
        return "";
    }

    private String inferMimeFromExtension(String ext) {
        if (ext == null || ext.isEmpty()) return "";
        String clean = ext.startsWith(".") ? ext.substring(1).toLowerCase(Locale.US) : ext.toLowerCase(Locale.US);
        String mapped = MimeTypeMap.getSingleton().getMimeTypeFromExtension(clean);
        if (mapped != null && !mapped.isEmpty()) {
            return mapped;
        }
        switch (clean) {
            case "mp3": return "audio/mpeg";
            case "wav": return "audio/wav";
            case "flac": return "audio/flac";
            case "m4a": return "audio/mp4";
            case "aac": return "audio/aac";
            case "ogg":
            case "opus": return "audio/ogg";
            case "mp4":
            case "m4v": return "video/mp4";
            case "mkv": return "video/x-matroska";
            case "webm": return "video/webm";
            case "mov": return "video/quicktime";
            case "avi": return "video/x-msvideo";
            case "3gp": return "video/3gpp";
            default: return "";
        }
    }

    private String determineMediaKind(String mimeType, String ext) {
        String mime = mimeType != null ? mimeType.toLowerCase(Locale.US) : "";
        if (mime.startsWith("video/") || "application/mp4".equals(mime)) {
            return "video";
        }
        if (mime.startsWith("audio/") || "application/ogg".equals(mime) || "application/x-flac".equals(mime)) {
            return "audio";
        }
        String e = ext != null ? ext.toLowerCase(Locale.US) : "";
        if (".mp4".equals(e) || ".mkv".equals(e) || ".webm".equals(e) || ".mov".equals(e)
            || ".m4v".equals(e) || ".avi".equals(e) || ".3gp".equals(e) || ".ts".equals(e) || ".flv".equals(e)) {
            return "video";
        }
        if (".mp3".equals(e) || ".wav".equals(e) || ".flac".equals(e) || ".m4a".equals(e)
            || ".aac".equals(e) || ".ogg".equals(e) || ".opus".equals(e) || ".wma".equals(e) || ".aiff".equals(e)) {
            return "audio";
        }
        return null;
    }

    @PluginMethod
    public void getAllAudioFiles(PluginCall call) {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? Manifest.permission.READ_MEDIA_AUDIO
            : Manifest.permission.READ_EXTERNAL_STORAGE;

        if (ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED) {
            loadAudioFiles(call, false);
        } else {
            if (getActivity() == null) {
                call.reject("Activity unavailable");
                return;
            }
            if (pendingCallId != null) {
                PluginCall previous = bridge.getSavedCall(pendingCallId);
                if (previous != null) {
                    bridge.releaseCall(previous);
                }
            }
            bridge.saveCall(call);
            pendingCallId = call.getCallbackId();
            pendingPermissionType = "audio";
            getActivity().runOnUiThread(() -> permissionLauncher.launch(permission));
        }
    }

    @PluginMethod
    public void getAllVideoFiles(PluginCall call) {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? Manifest.permission.READ_MEDIA_VIDEO
            : Manifest.permission.READ_EXTERNAL_STORAGE;

        if (ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED) {
            loadVideoFiles(call, false);
        } else {
            if (getActivity() == null) {
                call.reject("Activity unavailable");
                return;
            }
            if (pendingCallId != null) {
                PluginCall previous = bridge.getSavedCall(pendingCallId);
                if (previous != null) {
                    bridge.releaseCall(previous);
                }
            }
            bridge.saveCall(call);
            pendingCallId = call.getCallbackId();
            pendingPermissionType = "video";
            getActivity().runOnUiThread(() -> permissionLauncher.launch(permission));
        }
    }

    @PluginMethod
    public void getAllImageFiles(PluginCall call) {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? Manifest.permission.READ_MEDIA_IMAGES
            : Manifest.permission.READ_EXTERNAL_STORAGE;

        if (ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED) {
            loadImageFiles(call, false);
        } else {
            if (getActivity() == null) {
                call.reject("Activity unavailable");
                return;
            }
            if (pendingCallId != null) {
                PluginCall previous = bridge.getSavedCall(pendingCallId);
                if (previous != null) {
                    bridge.releaseCall(previous);
                }
            }
            bridge.saveCall(call);
            pendingCallId = call.getCallbackId();
            pendingPermissionType = "image";
            getActivity().runOnUiThread(() -> permissionLauncher.launch(permission));
        }
    }

    private void loadAudioFiles(PluginCall call, boolean releaseAfter) {
        executor.execute(() -> {
            purgeExpiredCallRecordingsInternal(false);
            JSArray songs = new JSArray();
            ContentResolver contentResolver = getContext().getContentResolver();

            Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String[] projection = new String[] {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DATE_MODIFIED
            };

            String sortOrder = MediaStore.Audio.Media.DATE_ADDED + " DESC";

            try (Cursor cursor = contentResolver.query(collection, projection, null, null, sortOrder)) {
                if (cursor != null) {
                    int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                    int displayNameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                    int artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                    int albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                    int durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                    int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
                    int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                    int modCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_MODIFIED);

                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(idCol);
                        long size = cursor.getLong(sizeCol);
                        if (size <= 0) {
                            continue;
                        }

                        String title = cursor.getString(titleCol);
                        String displayName = cursor.getString(displayNameCol);
                        String artist = cursor.getString(artistCol);
                        String album = cursor.getString(albumCol);
                        long durationMs = cursor.getLong(durationCol);
                        String mimeType = cursor.getString(mimeCol);
                        long dateModifiedMs = modCol >= 0 ? cursor.getLong(modCol) * 1000L : 0L;

                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("title", title != null && !title.isEmpty() ? title : (displayName != null ? displayName : "Unknown Track"));
                        item.put("displayName", displayName != null ? displayName : (title != null ? title : "audio_track"));
                        item.put("artist", artist != null && !"<unknown>".equalsIgnoreCase(artist) ? artist : "Unknown Artist");
                        item.put("album", album != null ? album : "");
                        item.put("durationMs", durationMs);
                        item.put("size", size);
                        item.put("dateModified", dateModifiedMs);
                        item.put("mimeType", mimeType != null ? mimeType : "audio/*");
                        item.put("uri", contentUri.toString());

                        songs.put(item);
                    }
                }

                JSObject result = new JSObject();
                result.put("granted", true);
                result.put("songs", songs);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to query MediaStore audio files: " + e.getMessage(), e);
            } finally {
                if (releaseAfter) {
                    bridge.releaseCall(call);
                }
            }
        });
    }

    @PluginMethod
    public void prepareAudioFile(PluginCall call) {
        String uriString = call.getString("uri");
        String displayName = call.getString("displayName", "track.mp3");

        if (uriString == null || uriString.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }

        executor.execute(() -> {
            try {
                Uri contentUri = Uri.parse(uriString);
                ContentResolver resolver = getContext().getContentResolver();

                String ext = ".mp3";
                if (displayName != null) {
                    int dotIdx = displayName.lastIndexOf('.');
                    if (dotIdx >= 0 && dotIdx < displayName.length() - 1) {
                        ext = displayName.substring(dotIdx).replaceAll("[^a-zA-Z0-9.]", "");
                    }
                }

                File cacheDir = getContext().getCacheDir();
                if (lastTempAudioFile != null && lastTempAudioFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    lastTempAudioFile.delete();
                }

                File outFile = new File(cacheDir, "beatpulse_active_track_" + System.currentTimeMillis() + ext);
                lastTempAudioFile = outFile;
                try (InputStream in = resolver.openInputStream(contentUri);
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    if (in == null) {
                        call.reject("Unable to open audio stream");
                        return;
                    }
                    byte[] buffer = new byte[65536];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                    }
                    out.flush();
                }

                String filePath = outFile.getAbsolutePath();
                String localUrl = bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + filePath;
                JSObject result = new JSObject();
                result.put("filePath", filePath);
                result.put("localUrl", localUrl);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to read audio file: " + e.getMessage(), e);
            }
        });
    }

    private void loadVideoFiles(PluginCall call, boolean releaseAfter) {
        executor.execute(() -> {
            JSArray videos = new JSArray();
            ContentResolver contentResolver = getContext().getContentResolver();

            Uri collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
            String[] projection = new String[] {
                MediaStore.Video.Media._ID,
                MediaStore.Video.Media.TITLE,
                MediaStore.Video.Media.DISPLAY_NAME,
                MediaStore.Video.Media.DURATION,
                MediaStore.Video.Media.SIZE,
                MediaStore.Video.Media.MIME_TYPE,
                MediaStore.Video.Media.RESOLUTION,
                MediaStore.Video.Media.DATE_MODIFIED
            };

            String sortOrder = MediaStore.Video.Media.DATE_ADDED + " DESC";

            try (Cursor cursor = contentResolver.query(collection, projection, null, null, sortOrder)) {
                if (cursor != null) {
                    int idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID);
                    int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.TITLE);
                    int displayNameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME);
                    int durationCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION);
                    int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE);
                    int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.MIME_TYPE);
                    int resCol = cursor.getColumnIndex(MediaStore.Video.Media.RESOLUTION);
                    int modCol = cursor.getColumnIndex(MediaStore.Video.Media.DATE_MODIFIED);

                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(idCol);
                        long size = cursor.getLong(sizeCol);
                        if (size <= 0) {
                            continue;
                        }

                        String title = cursor.getString(titleCol);
                        String displayName = cursor.getString(displayNameCol);
                        long durationMs = cursor.getLong(durationCol);
                        String mimeType = cursor.getString(mimeCol);
                        String resolution = resCol >= 0 ? cursor.getString(resCol) : "";
                        long dateModifiedMs = modCol >= 0 ? cursor.getLong(modCol) * 1000L : 0L;

                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);

                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("title", title != null && !title.isEmpty() ? title : (displayName != null ? displayName : "Video"));
                        item.put("displayName", displayName != null ? displayName : (title != null ? title : "video.mp4"));
                        item.put("durationMs", durationMs);
                        item.put("size", size);
                        item.put("dateModified", dateModifiedMs);
                        item.put("mimeType", mimeType != null ? mimeType : "video/*");
                        item.put("resolution", resolution != null ? resolution : "");
                        item.put("uri", contentUri.toString());

                        videos.put(item);
                    }
                }

                JSObject result = new JSObject();
                result.put("granted", true);
                result.put("videos", videos);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to query MediaStore video files: " + e.getMessage(), e);
            } finally {
                if (releaseAfter) {
                    bridge.releaseCall(call);
                }
            }
        });
    }

    private void loadImageFiles(PluginCall call, boolean releaseAfter) {
        executor.execute(() -> {
            JSArray images = new JSArray();
            ContentResolver contentResolver = getContext().getContentResolver();

            Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            String[] projection = new String[] {
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.TITLE,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.WIDTH,
                MediaStore.Images.Media.HEIGHT,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.DATE_MODIFIED
            };

            String sortOrder = MediaStore.Images.Media.DATE_ADDED + " DESC";

            try (Cursor cursor = contentResolver.query(collection, projection, null, null, sortOrder)) {
                if (cursor != null) {
                    int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.TITLE);
                    int displayNameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                    int widthCol = cursor.getColumnIndex(MediaStore.Images.Media.WIDTH);
                    int heightCol = cursor.getColumnIndex(MediaStore.Images.Media.HEIGHT);
                    int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE);
                    int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
                    int modCol = cursor.getColumnIndex(MediaStore.Images.Media.DATE_MODIFIED);

                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(idCol);
                        long size = cursor.getLong(sizeCol);
                        if (size <= 0) {
                            continue;
                        }

                        String title = cursor.getString(titleCol);
                        String displayName = cursor.getString(displayNameCol);
                        int width = widthCol >= 0 ? cursor.getInt(widthCol) : 0;
                        int height = heightCol >= 0 ? cursor.getInt(heightCol) : 0;
                        String mimeType = cursor.getString(mimeCol);
                        long dateModifiedMs = modCol >= 0 ? cursor.getLong(modCol) * 1000L : 0L;

                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);

                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("title", title != null && !title.isEmpty() ? title : (displayName != null ? displayName : "Image"));
                        item.put("displayName", displayName != null ? displayName : (title != null ? title : "image.jpg"));
                        item.put("width", width);
                        item.put("height", height);
                        item.put("size", size);
                        item.put("dateModified", dateModifiedMs);
                        item.put("mimeType", mimeType != null ? mimeType : "image/*");
                        item.put("uri", contentUri.toString());

                        images.put(item);
                    }
                }

                JSObject result = new JSObject();
                result.put("granted", true);
                result.put("images", images);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to query MediaStore image files: " + e.getMessage(), e);
            } finally {
                if (releaseAfter) {
                    bridge.releaseCall(call);
                }
            }
        });
    }

    @PluginMethod
    public void prepareMediaFile(PluginCall call) {
        String uriString = call.getString("uri");
        String mediaKind = call.getString("mediaKind", "audio");
        boolean keepAlive = Boolean.TRUE.equals(call.getBoolean("keepAlive", false));
        boolean forceCopy = Boolean.TRUE.equals(call.getBoolean("forceCopy", false));
        String defaultExt = "video".equals(mediaKind) ? ".mp4" : "image".equals(mediaKind) ? ".jpg" : ".mp3";
        String displayName = call.getString("displayName", "media" + defaultExt);

        if (uriString == null || uriString.isEmpty()) {
            call.reject("Missing media URI");
            return;
        }

        executor.execute(() -> {
            try {
                Uri contentUri = Uri.parse(uriString);
                ContentResolver resolver = getContext().getContentResolver();

                // Fast path: if MediaStore exposes a directly readable filesystem path without #, ?, or % URL delimiters
                String directPath = null;
                if (!forceCopy) {
                    try (Cursor pathCursor = resolver.query(
                        contentUri,
                        new String[] { MediaStore.MediaColumns.DATA },
                        null,
                        null,
                        null
                    )) {
                        if (pathCursor != null && pathCursor.moveToFirst()) {
                            int dataIdx = pathCursor.getColumnIndex(MediaStore.MediaColumns.DATA);
                            if (dataIdx >= 0) {
                                String candidate = pathCursor.getString(dataIdx);
                                if (candidate != null && !candidate.isEmpty()) {
                                    boolean hasUnsafeUrlChars = candidate.contains("#") || candidate.contains("?") || candidate.contains("%");
                                    File directFile = new File(candidate);
                                    if (!hasUnsafeUrlChars && directFile.exists() && directFile.canRead()) {
                                        directPath = directFile.getAbsolutePath();
                                    }
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        directPath = null;
                    }
                }

                if (directPath != null) {
                    String localUrl = bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + directPath;
                    JSObject result = new JSObject();
                    result.put("filePath", directPath);
                    result.put("localUrl", localUrl);
                    call.resolve(result);
                    return;
                }

                // Scoped storage fallback: copy stream into dedicated temp cache slot.
                String ext = defaultExt;
                if (displayName != null) {
                    int dotIdx = displayName.lastIndexOf('.');
                    if (dotIdx >= 0 && dotIdx < displayName.length() - 1) {
                        String cleaned = displayName.substring(dotIdx).replaceAll("[^a-zA-Z0-9.]", "");
                        if (!cleaned.isEmpty()) {
                            ext = cleaned;
                        }
                    }
                }

                File cacheDir = getContext().getCacheDir();
                if (!keepAlive) {
                    if ("video".equals(mediaKind)) {
                        if (lastPlayerVideoFile != null && lastPlayerVideoFile.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            lastPlayerVideoFile.delete();
                        }
                    } else if ("audio".equals(mediaKind)) {
                        if (lastPlayerAudioFile != null && lastPlayerAudioFile.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            lastPlayerAudioFile.delete();
                        }
                    }
                }

                File outFile = new File(
                    cacheDir,
                    "beatpulse_player_" + mediaKind + "_" + System.currentTimeMillis() + ext
                );
                if (!keepAlive) {
                    if ("video".equals(mediaKind)) {
                        lastPlayerVideoFile = outFile;
                    } else if ("audio".equals(mediaKind)) {
                        lastPlayerAudioFile = outFile;
                    }
                }

                try (InputStream in = resolver.openInputStream(contentUri);
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    if (in == null) {
                        call.reject("Unable to open media stream");
                        return;
                    }
                    byte[] buffer = new byte[131072];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                    }
                    out.flush();
                }

                String filePath = outFile.getAbsolutePath();
                String localUrl = bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + filePath;
                JSObject result = new JSObject();
                result.put("filePath", filePath);
                result.put("localUrl", localUrl);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to prepare media file: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getAudioThumbnail(PluginCall call) {
        String id = call.getString("id", "");
        String uriString = call.getString("uri", "");
        String title = call.getString("title", "Audio Track");
        String artist = call.getString("artist", "Unknown Artist");

        thumbExecutor.execute(() -> {
            try {
                AudioArtworkHelper.ArtworkResult art = AudioArtworkHelper.getOrCreateAudioArtwork(
                    getContext(),
                    id,
                    uriString,
                    title,
                    artist
                );
                JSObject res = new JSObject();
                if (art.filePath != null && !art.filePath.isEmpty()) {
                    res.put("filePath", art.filePath);
                    res.put("localUrl", bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + art.filePath);
                } else {
                    res.put("localUrl", "");
                }
                res.put("hasEmbeddedArt", art.hasEmbeddedArt);
                call.resolve(res);
            } catch (Exception e) {
                JSObject empty = new JSObject();
                empty.put("localUrl", "");
                empty.put("hasEmbeddedArt", false);
                call.resolve(empty);
            }
        });
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasRequestedNotifications) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                hasRequestedNotifications = true;
                if (getActivity() != null && notificationPermissionLauncher != null) {
                    getActivity().runOnUiThread(() ->
                        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    );
                }
            }
        }
    }

    private List<MusicPlaybackService.TrackMeta> parseTrackQueue(JSArray arr) {
        List<MusicPlaybackService.TrackMeta> list = new ArrayList<>();
        if (arr == null) return list;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject obj = arr.optJSONObject(i);
            if (obj == null) continue;
            MusicPlaybackService.TrackMeta tm = new MusicPlaybackService.TrackMeta();
            tm.id = obj.optString("id", "");
            tm.title = obj.optString("title", "");
            tm.displayName = obj.optString("displayName", "");
            tm.artist = obj.optString("artist", "Unknown Artist");
            tm.album = obj.optString("album", "");
            tm.durationMs = Math.max(0L, obj.optLong("durationMs", 0L));
            tm.size = Math.max(0L, obj.optLong("size", 0L));
            tm.mimeType = obj.optString("mimeType", "audio/*");
            tm.uri = obj.optString("uri", "");
            if (!tm.uri.isEmpty()) {
                list.add(tm);
            }
        }
        return list;
    }

    private void sendMusicServiceCommand(String action, long seekMs, boolean startForegroundIfIdle) {
        boolean serviceHasTrack = MusicPlaybackService.getCurrentSnapshot().optBoolean("hasTrack", false);
        if (!startForegroundIfIdle && !serviceHasTrack) {
            return;
        }
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(action);
        if (seekMs >= 0L) {
            intent.putExtra(MusicPlaybackService.EXTRA_SEEK_MS, seekMs);
        }
        ContextCompat.startForegroundService(getContext(), intent);
    }

    @PluginMethod
    public void startMusicPlayback(PluginCall call) {
        JSArray songsJson = call.getArray("songs");
        int startIndex = call.getInt("startIndex", 0);
        boolean isShuffle = Boolean.TRUE.equals(call.getBoolean("isShuffle", false));
        String repeatMode = call.getString("repeatMode", "all");
        Double volumeObj = call.getDouble("volume", 1.0);
        boolean isMuted = Boolean.TRUE.equals(call.getBoolean("isMuted", false));
        Double speedObj = call.getDouble("playbackSpeed", 1.0);

        List<MusicPlaybackService.TrackMeta> queue = parseTrackQueue(songsJson);
        if (queue.isEmpty()) {
            call.reject("No playable tracks in queue");
            return;
        }

        requestNotificationPermissionIfNeeded();
        float vol = volumeObj != null ? volumeObj.floatValue() : 1.0f;
        float speed = speedObj != null ? speedObj.floatValue() : 1.0f;
        MusicPlaybackService.setQueueAndSettings(queue, startIndex, isShuffle, repeatMode, vol, isMuted, speed);
        sendMusicServiceCommand(MusicPlaybackService.ACTION_PLAY_QUEUE, -1L, true);
        call.resolve();
    }

    @PluginMethod
    public void toggleMusicPlayPause(PluginCall call) {
        sendMusicServiceCommand(MusicPlaybackService.ACTION_PLAY_PAUSE, -1L, false);
        call.resolve();
    }

    @PluginMethod
    public void pauseMusicPlayback(PluginCall call) {
        sendMusicServiceCommand(MusicPlaybackService.ACTION_PAUSE, -1L, false);
        call.resolve();
    }

    @PluginMethod
    public void resumeMusicPlayback(PluginCall call) {
        requestNotificationPermissionIfNeeded();
        sendMusicServiceCommand(MusicPlaybackService.ACTION_RESUME, -1L, false);
        call.resolve();
    }

    @PluginMethod
    public void stepMusicTrack(PluginCall call) {
        int direction = call.getInt("direction", 1);
        sendMusicServiceCommand(
            direction < 0 ? MusicPlaybackService.ACTION_PREVIOUS : MusicPlaybackService.ACTION_NEXT,
            -1L,
            false
        );
        call.resolve();
    }

    @PluginMethod
    public void seekMusicPlayback(PluginCall call) {
        Double posObj = call.getDouble("positionMs", 0.0);
        long posMs = posObj != null ? Math.max(0L, Math.round(posObj)) : 0L;
        sendMusicServiceCommand(MusicPlaybackService.ACTION_SEEK, posMs, false);
        call.resolve();
    }

    @PluginMethod
    public void updateMusicSettings(PluginCall call) {
        boolean isShuffle = Boolean.TRUE.equals(call.getBoolean("isShuffle", false));
        String repeatMode = call.getString("repeatMode", "all");
        Double volumeObj = call.getDouble("volume", 1.0);
        boolean isMuted = Boolean.TRUE.equals(call.getBoolean("isMuted", false));
        Double speedObj = call.getDouble("playbackSpeed", 1.0);
        float vol = volumeObj != null ? volumeObj.floatValue() : 1.0f;
        float speed = speedObj != null ? speedObj.floatValue() : 1.0f;

        MusicPlaybackService.updateSettingsOnly(isShuffle, repeatMode, vol, isMuted, speed);
        sendMusicServiceCommand(MusicPlaybackService.ACTION_UPDATE_SETTINGS, -1L, false);
        call.resolve();
    }

    @PluginMethod
    public void updateMusicQueue(PluginCall call) {
        JSArray songsJson = call.getArray("songs");
        List<MusicPlaybackService.TrackMeta> queue = parseTrackQueue(songsJson);
        MusicPlaybackService.updateQueueListOnly(queue);
        call.resolve();
    }

    @PluginMethod
    public void stopMusicPlayback(PluginCall call) {
        sendMusicServiceCommand(MusicPlaybackService.ACTION_STOP, -1L, false);
        call.resolve();
    }

    @PluginMethod
    public void getMusicPlaybackState(PluginCall call) {
        call.resolve(MusicPlaybackService.getCurrentSnapshot());
    }

    @PluginMethod
    public void getVideoThumbnail(PluginCall call) {
        String id = call.getString("id", "");
        String uriString = call.getString("uri");

        if (uriString == null || uriString.isEmpty()) {
            JSObject empty = new JSObject();
            empty.put("localUrl", "");
            call.resolve(empty);
            return;
        }

        final String safeId = (id != null && !id.isEmpty() ? id : String.valueOf(uriString.hashCode()))
            .replaceAll("[^a-zA-Z0-9_-]", "_");

        thumbExecutor.execute(() -> {
            Bitmap bitmap = null;
            Bitmap scaled = null;
            try {
                File thumbDir = new File(getContext().getCacheDir(), "video_thumbs");
                if (!thumbDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    thumbDir.mkdirs();
                }

                File thumbFile = new File(thumbDir, "v_" + safeId + ".jpg");
                if (thumbFile.exists() && thumbFile.length() > 0) {
                    String path = thumbFile.getAbsolutePath();
                    JSObject cached = new JSObject();
                    cached.put("filePath", path);
                    cached.put("localUrl", bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + path);
                    call.resolve(cached);
                    return;
                }

                Uri contentUri = Uri.parse(uriString);
                ContentResolver resolver = getContext().getContentResolver();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        bitmap = resolver.loadThumbnail(contentUri, new Size(400, 240), null);
                    } catch (Exception ignored) {
                        bitmap = null;
                    }
                }

                if (bitmap == null) {
                    MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                    try {
                        if ("file".equals(contentUri.getScheme()) && contentUri.getPath() != null) {
                            retriever.setDataSource(contentUri.getPath());
                        } else {
                            retriever.setDataSource(getContext(), contentUri);
                        }
                        bitmap = retriever.getFrameAtTime(1000000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                        if (bitmap == null) {
                            bitmap = retriever.getFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                        }
                    } catch (Exception ignored) {
                        bitmap = null;
                    } finally {
                        try {
                            retriever.release();
                        } catch (Exception ignored) {
                            // ignore release error
                        }
                    }
                }

                if (bitmap == null) {
                    JSObject empty = new JSObject();
                    empty.put("localUrl", "");
                    call.resolve(empty);
                    return;
                }

                int w = bitmap.getWidth();
                int h = bitmap.getHeight();
                Bitmap toSave = bitmap;
                if (w > 400 || h > 400) {
                    float scale = Math.min(400f / w, 400f / h);
                    int targetW = Math.max(1, Math.round(w * scale));
                    int targetH = Math.max(1, Math.round(h * scale));
                    scaled = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true);
                    toSave = scaled;
                }

                File tmpFile = new File(thumbDir, "v_" + safeId + "_" + System.nanoTime() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmpFile)) {
                    toSave.compress(Bitmap.CompressFormat.JPEG, 78, out);
                    out.flush();
                }
                if (!tmpFile.renameTo(thumbFile)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpFile.delete();
                }

                String filePath = thumbFile.getAbsolutePath();
                JSObject result = new JSObject();
                result.put("filePath", filePath);
                result.put("localUrl", bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + filePath);
                call.resolve(result);
            } catch (Exception e) {
                JSObject empty = new JSObject();
                empty.put("localUrl", "");
                call.resolve(empty);
            } finally {
                if (scaled != null && scaled != bitmap && !scaled.isRecycled()) {
                    scaled.recycle();
                }
                if (bitmap != null && !bitmap.isRecycled()) {
                    bitmap.recycle();
                }
            }
        });
    }

    @PluginMethod
    public void getImageThumbnail(PluginCall call) {
        String id = call.getString("id", "");
        String uriString = call.getString("uri");

        if (uriString == null || uriString.isEmpty()) {
            JSObject empty = new JSObject();
            empty.put("localUrl", "");
            call.resolve(empty);
            return;
        }

        final String safeId = (id != null && !id.isEmpty() ? id : String.valueOf(uriString.hashCode()))
            .replaceAll("[^a-zA-Z0-9_-]", "_");

        thumbExecutor.execute(() -> {
            Bitmap bitmap = null;
            Bitmap scaled = null;
            try {
                File thumbDir = new File(getContext().getCacheDir(), "image_thumbs");
                if (!thumbDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    thumbDir.mkdirs();
                }

                File thumbFile = new File(thumbDir, "img_" + safeId + ".jpg");
                if (thumbFile.exists() && thumbFile.length() > 0) {
                    String path = thumbFile.getAbsolutePath();
                    JSObject cached = new JSObject();
                    cached.put("filePath", path);
                    cached.put("localUrl", bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + path);
                    call.resolve(cached);
                    return;
                }

                Uri contentUri = Uri.parse(uriString);
                ContentResolver resolver = getContext().getContentResolver();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        bitmap = resolver.loadThumbnail(contentUri, new Size(360, 360), null);
                    } catch (Exception ignored) {
                        bitmap = null;
                    }
                }

                if (bitmap == null) {
                    try {
                        BitmapFactory.Options bounds = new BitmapFactory.Options();
                        bounds.inJustDecodeBounds = true;
                        try (InputStream bIn = "file".equals(contentUri.getScheme()) && contentUri.getPath() != null
                            ? new FileInputStream(new File(contentUri.getPath()))
                            : resolver.openInputStream(contentUri)) {
                            if (bIn != null) {
                                BitmapFactory.decodeStream(bIn, null, bounds);
                            }
                        }
                        int sample = 1;
                        int maxSide = Math.max(bounds.outWidth, bounds.outHeight);
                        while (maxSide > 0 && (maxSide / sample) > 720) {
                            sample *= 2;
                        }
                        BitmapFactory.Options opts = new BitmapFactory.Options();
                        opts.inSampleSize = Math.max(1, sample);
                        try (InputStream in = "file".equals(contentUri.getScheme()) && contentUri.getPath() != null
                            ? new FileInputStream(new File(contentUri.getPath()))
                            : resolver.openInputStream(contentUri)) {
                            if (in != null) {
                                bitmap = BitmapFactory.decodeStream(in, null, opts);
                            }
                        }
                    } catch (Exception ignored) {
                        bitmap = null;
                    }
                }

                if (bitmap == null) {
                    JSObject empty = new JSObject();
                    empty.put("localUrl", "");
                    call.resolve(empty);
                    return;
                }

                int w = bitmap.getWidth();
                int h = bitmap.getHeight();
                Bitmap toSave = bitmap;
                if (w > 360 || h > 360) {
                    float scale = Math.min(360f / w, 360f / h);
                    int targetW = Math.max(1, Math.round(w * scale));
                    int targetH = Math.max(1, Math.round(h * scale));
                    scaled = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true);
                    toSave = scaled;
                }

                File tmpFile = new File(thumbDir, "img_" + safeId + "_" + System.nanoTime() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmpFile)) {
                    toSave.compress(Bitmap.CompressFormat.JPEG, 78, out);
                    out.flush();
                }
                if (!tmpFile.renameTo(thumbFile)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpFile.delete();
                }

                String filePath = thumbFile.getAbsolutePath();
                JSObject result = new JSObject();
                result.put("filePath", filePath);
                result.put("localUrl", bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + filePath);
                call.resolve(result);
            } catch (Exception e) {
                JSObject empty = new JSObject();
                empty.put("localUrl", "");
                call.resolve(empty);
            } finally {
                if (scaled != null && scaled != bitmap && !scaled.isRecycled()) {
                    scaled.recycle();
                }
                if (bitmap != null && !bitmap.isRecycled()) {
                    bitmap.recycle();
                }
            }
        });
    }

    @PluginMethod
    public void trimVideoLossless(PluginCall call) {
        String uriString = call.getString("uri");
        String displayName = call.getString("displayName", "video.mp4");
        String rawTitle = call.getString("title", "");
        Double startMsObj = call.getDouble("startMs", 0.0);
        Double endMsObj = call.getDouble("endMs", 0.0);

        if (uriString == null || uriString.isEmpty()) {
            call.reject("Missing video URI");
            return;
        }

        long startUs = Math.max(0L, Math.round((startMsObj != null ? startMsObj : 0.0) * 1000.0));
        long endUs = Math.max(0L, Math.round((endMsObj != null ? endMsObj : 0.0) * 1000.0));
        if (endUs <= startUs + 50_000L) {
            call.reject("Selected trim duration is too short.");
            return;
        }

        executor.execute(() -> {
            File tempOut = null;
            try {
                Uri sourceUri = Uri.parse(uriString);
                tempOut = new File(
                    getContext().getCacheDir(),
                    "beatpulse_trim_" + System.currentTimeMillis() + ".mp4"
                );

                RemuxResult remux = remuxVideoSegmentLossless(getContext(), sourceUri, startUs, endUs, tempOut);

                String baseTitle = sanitizeFileBaseName(rawTitle, displayName, "MoVibe_Video");
                String outFileName = baseTitle + "_trimmed_" + (System.currentTimeMillis() % 100000) + ".mp4";
                String outTitle = baseTitle + " (Trimmed)";

                SavedVideoInfo saved = saveVideoToMediaStore(
                    tempOut,
                    outFileName,
                    outTitle,
                    remux.durationMs,
                    remux.resolution
                );

                if (getActivity() != null) {
                    final String toastPath = saved.displayPath;
                    getActivity().runOnUiThread(() ->
                        Toast.makeText(getContext(), "Saved trimmed video to " + toastPath, Toast.LENGTH_LONG).show()
                    );
                }

                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("displayPath", saved.displayPath);
                result.put("video", saved.toVideoTrackJson());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not trim video losslessly: " + e.getMessage(), e);
            } finally {
                if (tempOut != null && tempOut.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempOut.delete();
                }
            }
        });
    }

    @PluginMethod
    public void splitVideoLossless(PluginCall call) {
        String uriString = call.getString("uri");
        String displayName = call.getString("displayName", "video.mp4");
        String rawTitle = call.getString("title", "");
        Double splitMsObj = call.getDouble("splitMs", 0.0);
        String keepPart = call.getString("keepPart", "both");

        if (uriString == null || uriString.isEmpty()) {
            call.reject("Missing video URI");
            return;
        }

        long requestedSplitUs = Math.max(0L, Math.round((splitMsObj != null ? splitMsObj : 0.0) * 1000.0));

        executor.execute(() -> {
            File tempPart1 = null;
            File tempPart2 = null;
            try {
                Uri sourceUri = Uri.parse(uriString);
                long[] metaInfo = inspectVideoDurationAndCutSyncUs(getContext(), sourceUri, requestedSplitUs);
                long totalDurationUs = metaInfo[0];
                long cutUs = metaInfo[1];

                if (totalDurationUs <= 200_000L) {
                    throw new IllegalArgumentException("Video is too short to split.");
                }
                if (cutUs <= 100_000L || cutUs >= totalDurationUs - 100_000L) {
                    cutUs = Math.max(150_000L, Math.min(totalDurationUs - 150_000L, requestedSplitUs));
                }

                String baseTitle = sanitizeFileBaseName(rawTitle, displayName, "MoVibe_Video");
                long tag = System.currentTimeMillis() % 100000;
                JSArray videosArr = new JSArray();
                JSArray pathsArr = new JSArray();

                if ("both".equals(keepPart) || "part1".equals(keepPart)) {
                    tempPart1 = new File(
                        getContext().getCacheDir(),
                        "beatpulse_split1_" + System.currentTimeMillis() + ".mp4"
                    );
                    RemuxResult r1 = remuxVideoSegmentLossless(
                        getContext(),
                        sourceUri,
                        0L,
                        Math.max(100_000L, cutUs - 1_000L),
                        tempPart1
                    );
                    SavedVideoInfo s1 = saveVideoToMediaStore(
                        tempPart1,
                        baseTitle + "_part1_" + tag + ".mp4",
                        baseTitle + " (Part 1)",
                        r1.durationMs,
                        r1.resolution
                    );
                    videosArr.put(s1.toVideoTrackJson());
                    pathsArr.put(s1.displayPath);
                }

                if ("both".equals(keepPart) || "part2".equals(keepPart)) {
                    tempPart2 = new File(
                        getContext().getCacheDir(),
                        "beatpulse_split2_" + System.currentTimeMillis() + ".mp4"
                    );
                    RemuxResult r2 = remuxVideoSegmentLossless(
                        getContext(),
                        sourceUri,
                        cutUs,
                        totalDurationUs + 1_000_000L,
                        tempPart2
                    );
                    SavedVideoInfo s2 = saveVideoToMediaStore(
                        tempPart2,
                        baseTitle + "_part2_" + tag + ".mp4",
                        baseTitle + " (Part 2)",
                        r2.durationMs,
                        r2.resolution
                    );
                    videosArr.put(s2.toVideoTrackJson());
                    pathsArr.put(s2.displayPath);
                }

                if (getActivity() != null) {
                    int count = videosArr.length();
                    String msg = count > 1
                        ? "Split into 2 original-quality clips in Movies/Mo Vibe/"
                        : "Saved split clip in Movies/Mo Vibe/";
                    getActivity().runOnUiThread(() ->
                        Toast.makeText(getContext(), msg, Toast.LENGTH_LONG).show()
                    );
                }

                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("videos", videosArr);
                result.put("displayPaths", pathsArr);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not split video losslessly: " + e.getMessage(), e);
            } finally {
                if (tempPart1 != null && tempPart1.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempPart1.delete();
                }
                if (tempPart2 != null && tempPart2.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempPart2.delete();
                }
            }
        });
    }

    @PluginMethod
    public void exportVideoSegmentsLossless(PluginCall call) {
        String uriString = call.getString("uri");
        String displayName = call.getString("displayName", "video.mp4");
        String rawTitle = call.getString("title", "");
        JSArray segmentsJson = call.getArray("segments");

        if (uriString == null || uriString.isEmpty()) {
            call.reject("Missing video URI");
            return;
        }
        if (segmentsJson == null || segmentsJson.length() == 0) {
            call.reject("Keep at least one video segment before saving.");
            return;
        }

        List<long[]> segmentsUs = new ArrayList<>();
        for (int i = 0; i < segmentsJson.length(); i++) {
            JSONObject obj = segmentsJson.optJSONObject(i);
            if (obj == null) continue;
            long startUs = Math.max(0L, Math.round(obj.optDouble("startMs", 0.0) * 1000.0));
            long endUs = Math.max(0L, Math.round(obj.optDouble("endMs", 0.0) * 1000.0));
            if (endUs > startUs + 50_000L) {
                segmentsUs.add(new long[] { startUs, endUs });
            }
        }

        if (segmentsUs.isEmpty()) {
            call.reject("Selected video segments are too short.");
            return;
        }

        executor.execute(() -> {
            File tempOut = null;
            try {
                Uri sourceUri = Uri.parse(uriString);
                tempOut = new File(
                    getContext().getCacheDir(),
                    "beatpulse_edited_" + System.currentTimeMillis() + ".mp4"
                );

                RemuxResult remux = segmentsUs.size() == 1
                    ? remuxVideoSegmentLossless(
                        getContext(),
                        sourceUri,
                        segmentsUs.get(0)[0],
                        segmentsUs.get(0)[1],
                        tempOut
                    )
                    : remuxMultipleSegmentsLossless(
                        getContext(),
                        sourceUri,
                        segmentsUs,
                        tempOut
                    );

                String baseTitle = sanitizeFileBaseName(rawTitle, displayName, "MoVibe_Video");
                String outFileName = baseTitle + "_edited_" + (System.currentTimeMillis() % 100000) + ".mp4";
                String outTitle = baseTitle + " (Edited)";

                SavedVideoInfo saved = saveVideoToMediaStore(
                    tempOut,
                    outFileName,
                    outTitle,
                    remux.durationMs,
                    remux.resolution
                );

                if (getActivity() != null) {
                    final String toastPath = saved.displayPath;
                    getActivity().runOnUiThread(() ->
                        Toast.makeText(getContext(), "Saved edited video to " + toastPath, Toast.LENGTH_LONG).show()
                    );
                }

                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("displayPath", saved.displayPath);
                result.put("video", saved.toVideoTrackJson());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not export edited video losslessly: " + e.getMessage(), e);
            } finally {
                if (tempOut != null && tempOut.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempOut.delete();
                }
            }
        });
    }

    private static class RemuxResult {
        long durationMs;
        String resolution;
    }

    private static class SavedVideoInfo {
        String id;
        String title;
        String displayName;
        long durationMs;
        long size;
        String resolution;
        String uri;
        String displayPath;

        JSObject toVideoTrackJson() {
            JSObject obj = new JSObject();
            obj.put("id", id);
            obj.put("title", title);
            obj.put("displayName", displayName);
            obj.put("durationMs", durationMs);
            obj.put("size", size);
            obj.put("mimeType", "video/mp4");
            obj.put("resolution", resolution != null ? resolution : "");
            obj.put("uri", uri);
            return obj;
        }
    }

    private static String sanitizeFileBaseName(String title, String displayName, String fallback) {
        String raw = (title != null && !title.trim().isEmpty()) ? title : displayName;
        if (raw == null || raw.trim().isEmpty()) {
            return fallback;
        }
        int dot = raw.lastIndexOf('.');
        if (dot > 0) {
            raw = raw.substring(0, dot);
        }
        String cleaned = raw.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return cleaned.isEmpty() ? fallback : cleaned;
    }

    private static void configureExtractorDataSource(
        Context context,
        MediaExtractor extractor,
        Uri sourceUri
    ) throws Exception {
        try {
            extractor.setDataSource(context, sourceUri, null);
            return;
        } catch (Exception firstErr) {
            String scheme = sourceUri.getScheme() != null ? sourceUri.getScheme().toLowerCase(Locale.US) : "";
            if ("file".equals(scheme) && sourceUri.getPath() != null) {
                extractor.setDataSource(sourceUri.getPath());
                return;
            }
            try (ParcelFileDescriptor pfd = context.getContentResolver().openFileDescriptor(sourceUri, "r")) {
                if (pfd != null) {
                    extractor.setDataSource(pfd.getFileDescriptor());
                    return;
                }
            } catch (Exception ignored) {
                // rethrow first error below
            }
            throw firstErr;
        }
    }

    private static long[] inspectVideoDurationAndCutSyncUs(
        Context context,
        Uri sourceUri,
        long targetSplitUs
    ) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        try {
            configureExtractorDataSource(context, extractor, sourceUri);
            int videoTrackIdx = -1;
            long maxDurationUs = 0L;
            int trackCount = extractor.getTrackCount();
            for (int i = 0; i < trackCount; i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (fmt.containsKey(MediaFormat.KEY_DURATION)) {
                    long d = fmt.getLong(MediaFormat.KEY_DURATION);
                    if (d > maxDurationUs) {
                        maxDurationUs = d;
                    }
                }
                if (videoTrackIdx < 0 && mime != null && mime.startsWith("video/")) {
                    videoTrackIdx = i;
                }
            }

            long cutSyncUs = targetSplitUs;
            if (videoTrackIdx >= 0) {
                extractor.selectTrack(videoTrackIdx);
                extractor.seekTo(targetSplitUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                long sampleTime = extractor.getSampleTime();
                if (sampleTime > 0L) {
                    cutSyncUs = sampleTime;
                }
            }

            if (maxDurationUs <= 0L) {
                MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                try {
                    retriever.setDataSource(context, sourceUri);
                    String durStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                    if (durStr != null) {
                        maxDurationUs = Long.parseLong(durStr) * 1000L;
                    }
                } catch (Exception ignored) {
                    // ignore
                } finally {
                    try {
                        retriever.release();
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            }

            return new long[] { maxDurationUs, cutSyncUs };
        } finally {
            extractor.release();
        }
    }

    private static RemuxResult remuxVideoSegmentLossless(
        Context context,
        Uri sourceUri,
        long requestedStartUs,
        long requestedEndUs,
        File outFile
    ) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        boolean muxerStarted = false;

        try {
            configureExtractorDataSource(context, extractor, sourceUri);

            int trackCount = extractor.getTrackCount();
            int videoTrackIdx = -1;
            int maxInputSize = 2 * 1024 * 1024;
            int rotationDegrees = 0;
            String resolution = "";

            for (int i = 0; i < trackCount; i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null) continue;
                if (fmt.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    int sz = fmt.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE);
                    if (sz > maxInputSize) {
                        maxInputSize = sz;
                    }
                }
                if (videoTrackIdx < 0 && mime.startsWith("video/")) {
                    videoTrackIdx = i;
                    if (fmt.containsKey(MediaFormat.KEY_WIDTH) && fmt.containsKey(MediaFormat.KEY_HEIGHT)) {
                        resolution = fmt.getInteger(MediaFormat.KEY_WIDTH) + "×" + fmt.getInteger(MediaFormat.KEY_HEIGHT);
                    }
                    if (fmt.containsKey(MediaFormat.KEY_ROTATION)) {
                        rotationDegrees = fmt.getInteger(MediaFormat.KEY_ROTATION);
                    }
                }
            }

            if (rotationDegrees == 0) {
                MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                try {
                    retriever.setDataSource(context, sourceUri);
                    String rotStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
                    if (rotStr != null) {
                        rotationDegrees = Integer.parseInt(rotStr);
                    }
                    if (resolution.isEmpty()) {
                        String wStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
                        String hStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                        if (wStr != null && hStr != null) {
                            resolution = wStr + "×" + hStr;
                        }
                    }
                } catch (Exception ignored) {
                    // ignore metadata errors
                } finally {
                    try {
                        retriever.release();
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            }

            // Snap start to exact video keyframe so output clip has zero corrupted frames
            long actualStartUs = Math.max(0L, requestedStartUs);
            if (videoTrackIdx >= 0) {
                extractor.selectTrack(videoTrackIdx);
                extractor.seekTo(actualStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                long syncTime = extractor.getSampleTime();
                if (syncTime >= 0L) {
                    actualStartUs = syncTime;
                }
                extractor.unselectTrack(videoTrackIdx);
            }

            long effectiveEndUs = requestedEndUs;
            if (effectiveEndUs > 0L && effectiveEndUs <= actualStartUs) {
                effectiveEndUs = actualStartUs + 250_000L;
            }

            muxer = new MediaMuxer(outFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            if (rotationDegrees == 90 || rotationDegrees == 180 || rotationDegrees == 270) {
                muxer.setOrientationHint(rotationDegrees);
            }

            Map<Integer, Integer> trackIndexMap = new HashMap<>();
            Map<Integer, Boolean> trackDone = new HashMap<>();
            Map<Integer, Long> lastWrittenPts = new HashMap<>();

            for (int i = 0; i < trackCount; i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && (mime.startsWith("video/") || mime.startsWith("audio/"))) {
                    try {
                        int dstTrack = muxer.addTrack(fmt);
                        trackIndexMap.put(i, dstTrack);
                        trackDone.put(i, false);
                        extractor.selectTrack(i);
                    } catch (Exception ignored) {
                        // Skip unsupported auxiliary stream track
                    }
                }
            }

            if (trackIndexMap.isEmpty()) {
                throw new IllegalStateException("No compatible video or audio streams found for MP4 muxing.");
            }

            muxer.start();
            muxerStarted = true;

            extractor.seekTo(actualStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);

            ByteBuffer dstBuf = ByteBuffer.allocateDirect(Math.max(2 * 1024 * 1024, maxInputSize));
            MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
            boolean seenVideoKeyframe = (videoTrackIdx < 0 || !trackIndexMap.containsKey(videoTrackIdx));
            long maxAdjPtsUs = 0L;

            while (true) {
                int srcTrack = extractor.getSampleTrackIndex();
                if (srcTrack < 0) {
                    break;
                }

                Integer dstTrack = trackIndexMap.get(srcTrack);
                if (dstTrack == null || Boolean.TRUE.equals(trackDone.get(srcTrack))) {
                    extractor.advance();
                    continue;
                }

                long sampleTimeUs = extractor.getSampleTime();
                if (sampleTimeUs < 0L) {
                    break;
                }

                if (effectiveEndUs > 0L && sampleTimeUs > effectiveEndUs) {
                    trackDone.put(srcTrack, true);
                    boolean allDone = true;
                    for (Boolean done : trackDone.values()) {
                        if (!Boolean.TRUE.equals(done)) {
                            allDone = false;
                            break;
                        }
                    }
                    if (allDone) {
                        break;
                    }
                    extractor.advance();
                    continue;
                }

                if (sampleTimeUs < actualStartUs) {
                    extractor.advance();
                    continue;
                }

                int sampleFlags = extractor.getSampleFlags();
                boolean isSync = (sampleFlags & MediaExtractor.SAMPLE_FLAG_SYNC) != 0;

                if (srcTrack == videoTrackIdx && !seenVideoKeyframe) {
                    if (!isSync) {
                        extractor.advance();
                        continue;
                    }
                    seenVideoKeyframe = true;
                } else if (!seenVideoKeyframe) {
                    // Wait until first video keyframe is anchored before writing audio
                    extractor.advance();
                    continue;
                }

                dstBuf.clear();
                int sampleSize = extractor.readSampleData(dstBuf, 0);
                if (sampleSize < 0) {
                    trackDone.put(srcTrack, true);
                    extractor.advance();
                    continue;
                }

                long adjPts = Math.max(0L, sampleTimeUs - actualStartUs);
                Long prevPts = lastWrittenPts.get(srcTrack);
                if (prevPts != null && adjPts <= prevPts) {
                    adjPts = prevPts + 1L;
                }
                lastWrittenPts.put(srcTrack, adjPts);
                if (adjPts > maxAdjPtsUs) {
                    maxAdjPtsUs = adjPts;
                }

                bufferInfo.offset = 0;
                bufferInfo.size = sampleSize;
                bufferInfo.presentationTimeUs = adjPts;
                bufferInfo.flags = isSync ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;

                muxer.writeSampleData(dstTrack, dstBuf, bufferInfo);
                extractor.advance();
            }

            RemuxResult res = new RemuxResult();
            res.durationMs = Math.max(100L, maxAdjPtsUs / 1000L);
            res.resolution = resolution;
            return res;
        } finally {
            if (muxer != null) {
                try {
                    if (muxerStarted) {
                        muxer.stop();
                    }
                } catch (Exception ignored) {
                    // ignore stop errors on aborted streams
                }
                try {
                    muxer.release();
                } catch (Exception ignored) {
                    // ignore release error
                }
            }
            extractor.release();
        }
    }

    private static RemuxResult remuxMultipleSegmentsLossless(
        Context context,
        Uri sourceUri,
        List<long[]> segmentsUs,
        File outFile
    ) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        boolean muxerStarted = false;

        try {
            configureExtractorDataSource(context, extractor, sourceUri);

            int trackCount = extractor.getTrackCount();
            int videoTrackIdx = -1;
            int maxInputSize = 2 * 1024 * 1024;
            int rotationDegrees = 0;
            String resolution = "";

            for (int i = 0; i < trackCount; i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null) continue;
                if (fmt.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    int sz = fmt.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE);
                    if (sz > maxInputSize) {
                        maxInputSize = sz;
                    }
                }
                if (videoTrackIdx < 0 && mime.startsWith("video/")) {
                    videoTrackIdx = i;
                    if (fmt.containsKey(MediaFormat.KEY_WIDTH) && fmt.containsKey(MediaFormat.KEY_HEIGHT)) {
                        resolution = fmt.getInteger(MediaFormat.KEY_WIDTH) + "×" + fmt.getInteger(MediaFormat.KEY_HEIGHT);
                    }
                    if (fmt.containsKey(MediaFormat.KEY_ROTATION)) {
                        rotationDegrees = fmt.getInteger(MediaFormat.KEY_ROTATION);
                    }
                }
            }

            if (rotationDegrees == 0) {
                MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                try {
                    retriever.setDataSource(context, sourceUri);
                    String rotStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
                    if (rotStr != null) {
                        rotationDegrees = Integer.parseInt(rotStr);
                    }
                    if (resolution.isEmpty()) {
                        String wStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
                        String hStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                        if (wStr != null && hStr != null) {
                            resolution = wStr + "×" + hStr;
                        }
                    }
                } catch (Exception ignored) {
                    // ignore metadata errors
                } finally {
                    try {
                        retriever.release();
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            }

            muxer = new MediaMuxer(outFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            if (rotationDegrees == 90 || rotationDegrees == 180 || rotationDegrees == 270) {
                muxer.setOrientationHint(rotationDegrees);
            }

            Map<Integer, Integer> trackIndexMap = new HashMap<>();
            for (int i = 0; i < trackCount; i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && (mime.startsWith("video/") || mime.startsWith("audio/"))) {
                    try {
                        int dstTrack = muxer.addTrack(fmt);
                        trackIndexMap.put(i, dstTrack);
                        extractor.selectTrack(i);
                    } catch (Exception ignored) {
                        // skip unsupported auxiliary track
                    }
                }
            }

            if (trackIndexMap.isEmpty()) {
                throw new IllegalStateException("No compatible video or audio streams found for MP4 muxing.");
            }

            muxer.start();
            muxerStarted = true;

            ByteBuffer dstBuf = ByteBuffer.allocateDirect(Math.max(2 * 1024 * 1024, maxInputSize));
            MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
            Map<Integer, Long> lastWrittenPts = new HashMap<>();
            long timelineOffsetUs = 0L;
            long maxWrittenPtsUs = 0L;

            for (long[] seg : segmentsUs) {
                long reqStartUs = Math.max(0L, seg[0]);
                long reqEndUs = Math.max(reqStartUs + 50_000L, seg[1]);

                long actualStartUs = reqStartUs;
                if (videoTrackIdx >= 0 && trackIndexMap.containsKey(videoTrackIdx)) {
                    for (Integer tid : trackIndexMap.keySet()) {
                        extractor.unselectTrack(tid);
                    }
                    extractor.selectTrack(videoTrackIdx);
                    extractor.seekTo(reqStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                    long syncTime = extractor.getSampleTime();
                    if (syncTime >= 0L) {
                        actualStartUs = syncTime;
                    }
                    for (Integer tid : trackIndexMap.keySet()) {
                        extractor.selectTrack(tid);
                    }
                }

                extractor.seekTo(actualStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);

                Map<Integer, Boolean> trackDone = new HashMap<>();
                for (Integer tid : trackIndexMap.keySet()) {
                    trackDone.put(tid, false);
                }

                boolean seenVideoKeyframe = (videoTrackIdx < 0 || !trackIndexMap.containsKey(videoTrackIdx));
                long segMaxPtsUs = timelineOffsetUs;

                while (true) {
                    int srcTrack = extractor.getSampleTrackIndex();
                    if (srcTrack < 0) {
                        break;
                    }

                    Integer dstTrack = trackIndexMap.get(srcTrack);
                    if (dstTrack == null || Boolean.TRUE.equals(trackDone.get(srcTrack))) {
                        extractor.advance();
                        continue;
                    }

                    long sampleTimeUs = extractor.getSampleTime();
                    if (sampleTimeUs < 0L) {
                        break;
                    }

                    if (sampleTimeUs > reqEndUs) {
                        trackDone.put(srcTrack, true);
                        boolean allDone = true;
                        for (Boolean done : trackDone.values()) {
                            if (!Boolean.TRUE.equals(done)) {
                                allDone = false;
                                break;
                            }
                        }
                        if (allDone) {
                            break;
                        }
                        extractor.advance();
                        continue;
                    }

                    if (sampleTimeUs < actualStartUs) {
                        extractor.advance();
                        continue;
                    }

                    int sampleFlags = extractor.getSampleFlags();
                    boolean isSync = (sampleFlags & MediaExtractor.SAMPLE_FLAG_SYNC) != 0;

                    if (srcTrack == videoTrackIdx && !seenVideoKeyframe) {
                        if (!isSync) {
                            extractor.advance();
                            continue;
                        }
                        seenVideoKeyframe = true;
                    } else if (!seenVideoKeyframe) {
                        extractor.advance();
                        continue;
                    }

                    dstBuf.clear();
                    int sampleSize = extractor.readSampleData(dstBuf, 0);
                    if (sampleSize < 0) {
                        trackDone.put(srcTrack, true);
                        extractor.advance();
                        continue;
                    }

                    long adjPts = timelineOffsetUs + Math.max(0L, sampleTimeUs - actualStartUs);
                    Long prevPts = lastWrittenPts.get(srcTrack);
                    if (prevPts != null && adjPts <= prevPts) {
                        adjPts = prevPts + 1L;
                    }
                    lastWrittenPts.put(srcTrack, adjPts);
                    if (adjPts > segMaxPtsUs) {
                        segMaxPtsUs = adjPts;
                    }
                    if (adjPts > maxWrittenPtsUs) {
                        maxWrittenPtsUs = adjPts;
                    }

                    bufferInfo.offset = 0;
                    bufferInfo.size = sampleSize;
                    bufferInfo.presentationTimeUs = adjPts;
                    bufferInfo.flags = isSync ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;

                    muxer.writeSampleData(dstTrack, dstBuf, bufferInfo);
                    extractor.advance();
                }

                timelineOffsetUs = segMaxPtsUs + 33_333L;
            }

            RemuxResult res = new RemuxResult();
            res.durationMs = Math.max(100L, maxWrittenPtsUs / 1000L);
            res.resolution = resolution;
            return res;
        } finally {
            if (muxer != null) {
                try {
                    if (muxerStarted) {
                        muxer.stop();
                    }
                } catch (Exception ignored) {
                    // ignore stop error
                }
                try {
                    muxer.release();
                } catch (Exception ignored) {
                    // ignore release error
                }
            }
            extractor.release();
        }
    }

    private SavedVideoInfo saveVideoToMediaStore(
        File sourceFile,
        String finalFileName,
        String title,
        long durationMs,
        String resolution
    ) throws Exception {
        long fileSize = sourceFile.length();
        String savedUri;
        String savedDisplayPath;
        String mediaId = "vid-" + System.currentTimeMillis();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DISPLAY_NAME, finalFileName);
            values.put(MediaStore.Video.Media.TITLE, title);
            values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
            values.put(MediaStore.Video.Media.DURATION, durationMs);
            values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Mo Vibe");
            values.put(MediaStore.Video.Media.IS_PENDING, 1);

            Uri itemUri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
            if (itemUri == null) {
                throw new IllegalStateException("MediaStore could not create video file");
            }

            try (InputStream in = new FileInputStream(sourceFile);
                 OutputStream out = resolver.openOutputStream(itemUri)) {
                if (out == null) {
                    throw new IllegalStateException("Could not open MediaStore video output stream");
                }
                byte[] buf = new byte[131072];
                int len;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                }
                out.flush();
            }

            ContentValues completed = new ContentValues();
            completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(itemUri, completed, null, null);

            savedUri = itemUri.toString();
            String lastSeg = itemUri.getLastPathSegment();
            if (lastSeg != null && !lastSeg.isEmpty()) {
                mediaId = lastSeg;
            }
            savedDisplayPath = "Movies/Mo Vibe/" + finalFileName;
        } else {
            boolean hasWritePerm = ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED;

            File targetDir;
            if (hasWritePerm) {
                targetDir = new File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES),
                    "Mo Vibe"
                );
                savedDisplayPath = "Movies/Mo Vibe/" + finalFileName;
            } else {
                File appMoviesDir = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                targetDir = new File(appMoviesDir != null ? appMoviesDir : getContext().getFilesDir(), "Mo Vibe");
                savedDisplayPath = targetDir.getAbsolutePath() + "/" + finalFileName;
            }

            if (!targetDir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                targetDir.mkdirs();
            }

            File outFile = new File(targetDir, finalFileName);
            try (InputStream in = new FileInputStream(sourceFile);
                 OutputStream out = new FileOutputStream(outFile)) {
                byte[] buf = new byte[131072];
                int len;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                }
                out.flush();
            }

            savedUri = Uri.fromFile(outFile).toString();
            MediaScannerConnection.scanFile(
                getContext(),
                new String[] { outFile.getAbsolutePath() },
                new String[] { "video/mp4" },
                null
            );
        }

        SavedVideoInfo info = new SavedVideoInfo();
        info.id = mediaId;
        info.title = title;
        info.displayName = finalFileName;
        info.durationMs = durationMs;
        info.size = fileSize;
        info.resolution = resolution;
        info.uri = savedUri;
        info.displayPath = savedDisplayPath;
        return info;
    }

    @PluginMethod
    public void beginAudioExport(PluginCall call) {
        executor.execute(() -> {
            try {
                String exportId = UUID.randomUUID().toString();
                File tempFile = new File(getContext().getCacheDir(), "beatpulse_export_" + exportId + ".tmp");
                if (tempFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                }
                pendingExports.put(exportId, tempFile);
                JSObject result = new JSObject();
                result.put("exportId", exportId);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to initialize audio export: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void appendAudioExportChunk(PluginCall call) {
        String exportId = call.getString("exportId");
        String base64Chunk = call.getString("base64Chunk");
        if (exportId == null || base64Chunk == null) {
            call.reject("Missing export chunk parameters");
            return;
        }
        File tempFile = pendingExports.get(exportId);
        if (tempFile == null) {
            call.reject("Export session not found");
            return;
        }

        executor.execute(() -> {
            try {
                byte[] decoded = Base64.decode(base64Chunk, Base64.DEFAULT);
                try (FileOutputStream out = new FileOutputStream(tempFile, true)) {
                    out.write(decoded);
                    out.flush();
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to write audio export chunk: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void finishAudioExport(PluginCall call) {
        String exportId = call.getString("exportId");
        String rawFileName = call.getString("fileName", "shifted_track.wav");
        String mimeType = call.getString("mimeType", "audio/wav");

        if (exportId == null) {
            call.reject("Missing exportId");
            return;
        }
        File tempFile = pendingExports.remove(exportId);
        if (tempFile == null || !tempFile.exists()) {
            call.reject("Export file buffer not found");
            return;
        }

        String safeFileName = (rawFileName != null ? rawFileName : "shifted_track.wav")
            .replaceAll("[\\\\/:*?\"<>|]", "_")
            .trim();
        if (safeFileName.isEmpty()) {
            safeFileName = "shifted_track.wav";
        }
        final String finalFileName = safeFileName;

        executor.execute(() -> {
            try {
                String savedDisplayPath;
                String savedUri = "";

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    String resolvedMime = mimeType != null ? mimeType : "audio/wav";
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Audio.Media.DISPLAY_NAME, finalFileName);
                    values.put(MediaStore.Audio.Media.MIME_TYPE, resolvedMime);
                    values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Mo Vibe");
                    values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
                    values.put(MediaStore.Audio.Media.IS_PENDING, 1);

                    Uri itemUri = null;
                    boolean savedToDownloads = false;
                    try {
                        itemUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
                    } catch (IllegalArgumentException ignored) {
                        itemUri = null;
                    }

                    if (itemUri == null) {
                        ContentValues dlValues = new ContentValues();
                        dlValues.put(MediaStore.Downloads.DISPLAY_NAME, finalFileName);
                        dlValues.put(MediaStore.Downloads.MIME_TYPE, resolvedMime);
                        dlValues.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Mo Vibe");
                        dlValues.put(MediaStore.Downloads.IS_PENDING, 1);
                        itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, dlValues);
                        savedToDownloads = true;
                    }

                    if (itemUri == null) {
                        throw new IllegalStateException("MediaStore could not create destination file");
                    }

                    try (InputStream in = new FileInputStream(tempFile);
                         OutputStream out = resolver.openOutputStream(itemUri)) {
                        if (out == null) {
                            throw new IllegalStateException("Could not open MediaStore output stream");
                        }
                        byte[] buf = new byte[65536];
                        int len;
                        while ((len = in.read(buf)) != -1) {
                            out.write(buf, 0, len);
                        }
                        out.flush();
                    }

                    ContentValues completed = new ContentValues();
                    completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    resolver.update(itemUri, completed, null, null);

                    savedUri = itemUri.toString();
                    savedDisplayPath = (savedToDownloads ? "Download/Mo Vibe/" : "Music/Mo Vibe/") + finalFileName;
                } else {
                    boolean hasWritePerm = ContextCompat.checkSelfPermission(
                        getContext(),
                        Manifest.permission.WRITE_EXTERNAL_STORAGE
                    ) == PackageManager.PERMISSION_GRANTED;

                    File targetDir;
                    if (hasWritePerm) {
                        targetDir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                            "Mo Vibe"
                        );
                        savedDisplayPath = "Music/Mo Vibe/" + finalFileName;
                    } else {
                        File appMusicDir = getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                        targetDir = new File(appMusicDir != null ? appMusicDir : getContext().getFilesDir(), "Mo Vibe");
                        savedDisplayPath = targetDir.getAbsolutePath() + "/" + finalFileName;
                    }

                    if (!targetDir.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        targetDir.mkdirs();
                    }

                    File outFile = new File(targetDir, finalFileName);
                    try (InputStream in = new FileInputStream(tempFile);
                         OutputStream out = new FileOutputStream(outFile)) {
                        byte[] buf = new byte[65536];
                        int len;
                        while ((len = in.read(buf)) != -1) {
                            out.write(buf, 0, len);
                        }
                        out.flush();
                    }

                    savedUri = Uri.fromFile(outFile).toString();
                    MediaScannerConnection.scanFile(
                        getContext(),
                        new String[] { outFile.getAbsolutePath() },
                        new String[] { mimeType != null ? mimeType : "audio/wav" },
                        null
                    );
                }

                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();

                if (getActivity() != null) {
                    getActivity().runOnUiThread(() ->
                        Toast.makeText(getContext(), "Saved to " + savedDisplayPath, Toast.LENGTH_LONG).show()
                    );
                }

                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("displayPath", savedDisplayPath);
                result.put("uri", savedUri);
                call.resolve(result);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
                call.reject("Failed to save exported audio: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void cancelAudioExport(PluginCall call) {
        String exportId = call.getString("exportId");
        if (exportId != null) {
            File tempFile = pendingExports.remove(exportId);
            if (tempFile != null && tempFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void finishVideoExport(PluginCall call) {
        String exportId = call.getString("exportId");
        String rawFileName = call.getString("fileName", "beatpulse_edited.mp4");
        String mimeType = call.getString("mimeType", "video/mp4");
        String rawTitle = call.getString("title", "Mo Vibe Edited Video");
        Double durationMsObj = call.getDouble("durationMs", 0.0);
        String resolution = call.getString("resolution", "");

        if (exportId == null) {
            call.reject("Missing exportId");
            return;
        }
        File tempFile = pendingExports.remove(exportId);
        if (tempFile == null || !tempFile.exists()) {
            call.reject("Export file buffer not found");
            return;
        }

        String safeFileName = (rawFileName != null ? rawFileName : "beatpulse_edited.mp4")
            .replaceAll("[\\\\/:*?\"<>|]", "_")
            .trim();
        if (safeFileName.isEmpty()) {
            safeFileName = "beatpulse_edited.mp4";
        }
        final String finalFileName = safeFileName;
        final String resolvedMime = (mimeType != null && !mimeType.isEmpty()) ? mimeType : "video/mp4";
        final long durationMs = Math.max(100L, Math.round(durationMsObj != null ? durationMsObj : 0.0));

        executor.execute(() -> {
            try {
                SavedVideoInfo saved = saveVideoToMediaStoreWithMime(
                    tempFile,
                    finalFileName,
                    rawTitle != null && !rawTitle.isEmpty() ? rawTitle : finalFileName,
                    durationMs,
                    resolution,
                    resolvedMime
                );

                if (getActivity() != null) {
                    final String toastPath = saved.displayPath;
                    getActivity().runOnUiThread(() ->
                        Toast.makeText(getContext(), "Saved video to " + toastPath, Toast.LENGTH_LONG).show()
                    );
                }

                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("displayPath", saved.displayPath);
                result.put("video", saved.toVideoTrackJson());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to save exported video: " + e.getMessage(), e);
            } finally {
                if (tempFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                }
            }
        });
    }

    private SavedVideoInfo saveVideoToMediaStoreWithMime(
        File sourceFile,
        String finalFileName,
        String title,
        long durationMs,
        String resolution,
        String mimeType
    ) throws Exception {
        long fileSize = sourceFile.length();
        String savedUri;
        String savedDisplayPath;
        String mediaId = "vid-" + System.currentTimeMillis();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DISPLAY_NAME, finalFileName);
            values.put(MediaStore.Video.Media.TITLE, title);
            values.put(MediaStore.Video.Media.MIME_TYPE, mimeType);
            values.put(MediaStore.Video.Media.DURATION, durationMs);
            values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Mo Vibe");
            values.put(MediaStore.Video.Media.IS_PENDING, 1);

            Uri itemUri = null;
            boolean savedToDownloads = false;
            try {
                itemUri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
            } catch (IllegalArgumentException ignored) {
                itemUri = null;
            }

            if (itemUri == null) {
                ContentValues dlValues = new ContentValues();
                dlValues.put(MediaStore.Downloads.DISPLAY_NAME, finalFileName);
                dlValues.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                dlValues.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Mo Vibe");
                dlValues.put(MediaStore.Downloads.IS_PENDING, 1);
                itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, dlValues);
                savedToDownloads = true;
            }

            if (itemUri == null) {
                throw new IllegalStateException("MediaStore could not create video destination file");
            }

            try (InputStream in = new FileInputStream(sourceFile);
                 OutputStream out = resolver.openOutputStream(itemUri)) {
                if (out == null) {
                    throw new IllegalStateException("Could not open MediaStore video output stream");
                }
                byte[] buf = new byte[131072];
                int len;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                }
                out.flush();
            }

            ContentValues completed = new ContentValues();
            completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(itemUri, completed, null, null);

            savedUri = itemUri.toString();
            String lastSeg = itemUri.getLastPathSegment();
            if (lastSeg != null && !lastSeg.isEmpty()) {
                mediaId = lastSeg;
            }
            savedDisplayPath = (savedToDownloads ? "Download/Mo Vibe/" : "Movies/Mo Vibe/") + finalFileName;
        } else {
            File targetDir = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES),
                "Mo Vibe"
            );
            savedDisplayPath = "Movies/Mo Vibe/" + finalFileName;
            if (!targetDir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                targetDir.mkdirs();
            }
            File outFile = new File(targetDir, finalFileName);
            try (InputStream in = new FileInputStream(sourceFile);
                 OutputStream out = new FileOutputStream(outFile)) {
                byte[] buf = new byte[131072];
                int len;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                }
                out.flush();
            }
            savedUri = Uri.fromFile(outFile).toString();
            MediaScannerConnection.scanFile(
                getContext(),
                new String[] { outFile.getAbsolutePath() },
                new String[] { mimeType },
                null
            );
        }

        SavedVideoInfo info = new SavedVideoInfo();
        info.id = mediaId;
        info.title = title;
        info.displayName = finalFileName;
        info.durationMs = durationMs;
        info.size = fileSize;
        info.resolution = resolution;
        info.uri = savedUri;
        info.displayPath = savedDisplayPath;
        return info;
    }

    @PluginMethod
    public void getAudioDetails(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String displayName = call.getString("displayName", "");
        if (uriStr == null || uriStr.isEmpty()) {
            call.resolve(new JSObject());
            return;
        }
        executor.execute(() -> {
            JSObject out = new JSObject();
            Uri uri = Uri.parse(uriStr);
            ContentResolver resolver = getContext().getContentResolver();

            MediaMetadataRetriever mmr = new MediaMetadataRetriever();
            try {
                try {
                    mmr.setDataSource(getContext(), uri);
                } catch (Exception ignored) {
                    try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r")) {
                        if (pfd != null) mmr.setDataSource(pfd.getFileDescriptor());
                    }
                }
                String br = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
                if (br != null) {
                    long bps = Long.parseLong(br.trim());
                    out.put("bitrateKbps", Math.round(bps / 1000.0));
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    String sr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE);
                    if (sr != null) out.put("sampleRateHz", Integer.parseInt(sr.trim()));
                }
                String title = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
                String artist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
                String album = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
                String dur = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                String mime = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE);
                if (title != null && !title.isEmpty()) out.put("title", title);
                if (artist != null && !artist.isEmpty()) out.put("artist", artist);
                if (album != null && !album.isEmpty()) out.put("album", album);
                if (dur != null) out.put("durationMs", Long.parseLong(dur.trim()));
                if (mime != null && !mime.isEmpty()) out.put("mimeType", mime);
            } catch (Exception ignored) {
                // ignore partial metadata error
            } finally {
                try { mmr.release(); } catch (Exception ignored) {}
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && "content".equals(uri.getScheme())) {
                try (Cursor c = resolver.query(
                    uri,
                    new String[] { MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.MIME_TYPE },
                    null, null, null
                )) {
                    if (c != null && c.moveToFirst()) {
                        int rp = c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH);
                        int sz = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
                        int mt = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
                        if (rp >= 0 && c.getString(rp) != null) out.put("folderPath", c.getString(rp));
                        if (sz >= 0 && !c.isNull(sz)) out.put("size", c.getLong(sz));
                        if (mt >= 0 && c.getString(mt) != null) out.put("mimeType", c.getString(mt));
                    }
                } catch (Exception ignored) {}
            } else if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
                File f = new File(uri.getPath());
                if (f.getParentFile() != null) out.put("folderPath", f.getParentFile().getName());
                out.put("size", f.length());
            }
            if (!out.has("folderPath") && displayName != null) {
                out.put("folderPath", "Phone Storage");
            }
            call.resolve(out);
        });
    }

    @PluginMethod
    public void setAsRingtone(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String title = call.getString("title", "Mo Vibe Ringtone");
        String displayName = call.getString("displayName", "ringtone.mp3");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(getContext())) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {}
            JSObject res = new JSObject();
            res.put("status", "permission_required");
            res.put("message", "Allow 'Modify system settings' for Mo Vibe, then tap Set as ringtone again.");
            call.resolve(res);
            return;
        }

        executor.execute(() -> {
            try {
                Uri srcUri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();
                Uri ringtoneUri = null;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    String safeName = sanitizeOutputFileName(
                        (title != null && !title.isEmpty() ? title : "ringtone"),
                        extractExtWithDot(displayName, ".mp3")
                    );
                    String mime = inferMimeFromExtension(extractExtWithDot(safeName, ".mp3"));
                    if (mime.isEmpty()) mime = "audio/mpeg";
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Audio.Media.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Audio.Media.TITLE, title);
                    values.put(MediaStore.Audio.Media.MIME_TYPE, mime);
                    values.put(MediaStore.Audio.Media.IS_RINGTONE, 1);
                    values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_RINGTONES + "/Mo Vibe");
                    values.put(MediaStore.Audio.Media.IS_PENDING, 1);

                    ringtoneUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
                    if (ringtoneUri != null) {
                        try (InputStream in = openUriInputStream(resolver, srcUri);
                             OutputStream out = resolver.openOutputStream(ringtoneUri)) {
                            if (in == null || out == null) throw new IllegalStateException("Stream unavailable");
                            byte[] buf = new byte[65536];
                            int len;
                            while ((len = in.read(buf)) != -1) out.write(buf, 0, len);
                            out.flush();
                        }
                        ContentValues done = new ContentValues();
                        done.put(MediaStore.Audio.Media.IS_PENDING, 0);
                        done.put(MediaStore.Audio.Media.IS_RINGTONE, 1);
                        resolver.update(ringtoneUri, done, null, null);
                    }
                } else {
                    ringtoneUri = srcUri;
                }

                if (ringtoneUri == null) ringtoneUri = srcUri;
                RingtoneManager.setActualDefaultRingtoneUri(getContext(), RingtoneManager.TYPE_RINGTONE, ringtoneUri);
                JSObject res = new JSObject();
                res.put("status", "set");
                res.put("message", "\"" + title + "\" set as phone ringtone.");
                call.resolve(res);
            } catch (Exception e) {
                JSObject res = new JSObject();
                res.put("status", "failed");
                res.put("message", "Could not set ringtone: " + e.getMessage());
                call.resolve(res);
            }
        });
    }

    @PluginMethod
    public void shareAudioFile(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String title = call.getString("title", "Audio Track");
        String displayName = call.getString("displayName", "audio.mp3");
        String mimeType = call.getString("mimeType", "audio/*");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }
        executor.execute(() -> {
            try {
                Uri srcUri = Uri.parse(uriStr);
                Uri shareUri = srcUri;
                if ("file".equals(srcUri.getScheme()) && srcUri.getPath() != null) {
                    File f = new File(srcUri.getPath());
                    shareUri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        f
                    );
                }
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType != null && !mimeType.isEmpty() ? mimeType : "audio/*");
                shareIntent.putExtra(Intent.EXTRA_STREAM, shareUri);
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, title != null && !title.isEmpty() ? title : displayName);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, "Share \"" + title + "\"");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);

                JSObject res = new JSObject();
                res.put("shared", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not share audio: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void deleteAudioFile(PluginCall call) {
        String uriStr = call.getString("uri", "");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }
        Uri targetUri = Uri.parse(uriStr);
        ContentResolver resolver = getContext().getContentResolver();

        if ("file".equals(targetUri.getScheme()) && targetUri.getPath() != null) {
            File f = new File(targetUri.getPath());
            boolean deleted = !f.exists() || f.delete();
            JSObject res = new JSObject();
            res.put("deleted", deleted);
            call.resolve(res);
            return;
        }

        executor.execute(() -> {
            try {
                int rows = resolver.delete(targetUri, null, null);
                JSObject res = new JSObject();
                res.put("deleted", rows > 0);
                call.resolve(res);
            } catch (SecurityException secEx) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && getActivity() != null) {
                    bridge.saveCall(call);
                    pendingConsentCallId = call.getCallbackId();
                    pendingConsentMode = "delete";
                    pendingConsentAction = () -> {
                        JSObject done = new JSObject();
                        done.put("deleted", true);
                        call.resolve(done);
                        bridge.releaseCall(call);
                    };
                    IntentSender sender = MediaStore.createDeleteRequest(
                        resolver,
                        Collections.singletonList(targetUri)
                    ).getIntentSender();
                    getActivity().runOnUiThread(() ->
                        mediaConsentLauncher.launch(new IntentSenderRequest.Builder(sender).build())
                    );
                } else {
                    call.reject("Cannot delete protected audio file: " + secEx.getMessage(), secEx);
                }
            } catch (Exception e) {
                call.reject("Failed to delete audio: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void renameAudioFile(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String newTitle = call.getString("newTitle", "").trim();
        String newDisplayName = call.getString("newDisplayName", "").trim();
        String newArtist = call.getString("newArtist", null);
        String newAlbum = call.getString("newAlbum", null);
        if (uriStr == null || uriStr.isEmpty() || newTitle.isEmpty()) {
            call.reject("Missing audio URI or title");
            return;
        }
        Uri targetUri = Uri.parse(uriStr);
        ContentResolver resolver = getContext().getContentResolver();
        String finalDisplay = !newDisplayName.isEmpty() ? newDisplayName : newTitle;

        Runnable performUpdate = () -> {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Audio.Media.TITLE, newTitle);
            cv.put(MediaStore.Audio.Media.DISPLAY_NAME, finalDisplay);
            if (newArtist != null) cv.put(MediaStore.Audio.Media.ARTIST, newArtist);
            if (newAlbum != null) cv.put(MediaStore.Audio.Media.ALBUM, newAlbum);
            resolver.update(targetUri, cv, null, null);
        };

        executor.execute(() -> {
            try {
                if ("file".equals(targetUri.getScheme()) && targetUri.getPath() != null) {
                    File oldFile = new File(targetUri.getPath());
                    File newFile = new File(oldFile.getParentFile(), finalDisplay);
                    if (oldFile.exists() && !oldFile.getName().equals(finalDisplay)) {
                        //noinspection ResultOfMethodCallIgnored
                        oldFile.renameTo(newFile);
                    }
                    JSObject res = new JSObject();
                    res.put("renamed", true);
                    res.put("title", newTitle);
                    res.put("displayName", finalDisplay);
                    if (newArtist != null) res.put("artist", newArtist);
                    if (newAlbum != null) res.put("album", newAlbum);
                    call.resolve(res);
                    return;
                }

                performUpdate.run();
                JSObject res = new JSObject();
                res.put("renamed", true);
                res.put("title", newTitle);
                res.put("displayName", finalDisplay);
                if (newArtist != null) res.put("artist", newArtist);
                if (newAlbum != null) res.put("album", newAlbum);
                call.resolve(res);
            } catch (SecurityException secEx) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && getActivity() != null) {
                    bridge.saveCall(call);
                    pendingConsentCallId = call.getCallbackId();
                    pendingConsentMode = "rename";
                    pendingConsentAction = () -> {
                        try {
                            performUpdate.run();
                            JSObject done = new JSObject();
                            done.put("renamed", true);
                            done.put("title", newTitle);
                            done.put("displayName", finalDisplay);
                            if (newArtist != null) done.put("artist", newArtist);
                            if (newAlbum != null) done.put("album", newAlbum);
                            call.resolve(done);
                        } catch (Exception ex) {
                            call.reject("Rename failed: " + ex.getMessage(), ex);
                        } finally {
                            bridge.releaseCall(call);
                        }
                    };
                    IntentSender sender = MediaStore.createWriteRequest(
                        resolver,
                        Collections.singletonList(targetUri)
                    ).getIntentSender();
                    getActivity().runOnUiThread(() ->
                        mediaConsentLauncher.launch(new IntentSenderRequest.Builder(sender).build())
                    );
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && secEx instanceof RecoverableSecurityException && getActivity() != null) {
                    bridge.saveCall(call);
                    pendingConsentCallId = call.getCallbackId();
                    pendingConsentMode = "rename";
                    pendingConsentAction = () -> {
                        try {
                            performUpdate.run();
                            JSObject done = new JSObject();
                            done.put("renamed", true);
                            done.put("title", newTitle);
                            done.put("displayName", finalDisplay);
                            call.resolve(done);
                        } catch (Exception ex) {
                            call.reject("Rename failed: " + ex.getMessage(), ex);
                        } finally {
                            bridge.releaseCall(call);
                        }
                    };
                    IntentSender sender = ((RecoverableSecurityException) secEx).getUserAction().getActionIntent().getIntentSender();
                    getActivity().runOnUiThread(() ->
                        mediaConsentLauncher.launch(new IntentSenderRequest.Builder(sender).build())
                    );
                } else {
                    call.reject("Permission required to edit this song: " + secEx.getMessage(), secEx);
                }
            } catch (Exception e) {
                call.reject("Rename failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getPhoneFolders(PluginCall call) {
        executor.execute(() -> {
            try {
                TreeSet<String> sortedFolders = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);

                String[] standardDefaults = new String[] {
                    "Music/Mo Vibe",
                    "Music",
                    "Download",
                    "Download/Mo Vibe",
                    "Documents",
                    "Recordings",
                    "Podcasts",
                    "Audiobooks",
                    "Ringtones",
                    "Alarms",
                    "Notifications",
                    "DCIM",
                    "Pictures",
                    "Movies"
                };
                Collections.addAll(sortedFolders, standardDefaults);

                File storageRoot = Environment.getExternalStorageDirectory();
                if (storageRoot != null && storageRoot.exists()) {
                    collectStorageFolders(storageRoot, "", 0, 3, sortedFolders, 400);
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    Uri filesUri = MediaStore.Files.getContentUri("external");
                    String[] proj = new String[] { MediaStore.MediaColumns.RELATIVE_PATH };
                    try (Cursor cursor = resolver.query(filesUri, proj, null, null, null)) {
                        if (cursor != null) {
                            int relCol = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH);
                            while (cursor.moveToNext() && sortedFolders.size() < 500) {
                                if (relCol >= 0) {
                                    String rel = cursor.getString(relCol);
                                    if (rel != null) {
                                        String cleaned = rel.replaceAll("^/+|/+$", "").trim();
                                        if (!cleaned.isEmpty() && !cleaned.startsWith("Android/data") && !cleaned.startsWith("Android/obb")) {
                                            sortedFolders.add(cleaned);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        // Ignore MediaStore query restriction on older ROMs
                    }
                }

                Set<String> ordered = new LinkedHashSet<>();
                if (sortedFolders.contains("Music/Mo Vibe")) {
                    ordered.add("Music/Mo Vibe");
                }
                for (String f : sortedFolders) {
                    ordered.add(f);
                }

                JSArray arr = new JSArray();
                for (String folder : ordered) {
                    arr.put(folder);
                }
                JSObject res = new JSObject();
                res.put("folders", arr);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not list phone folders: " + e.getMessage(), e);
            }
        });
    }

    private void collectStorageFolders(
        File dir,
        String prefix,
        int depth,
        int maxDepth,
        Set<String> out,
        int limit
    ) {
        if (depth > maxDepth || out.size() >= limit) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (out.size() >= limit) break;
            if (child == null || !child.isDirectory()) continue;
            String name = child.getName();
            if (name == null || name.isEmpty() || name.startsWith(".")) continue;
            if (depth == 0 && ("Android".equalsIgnoreCase(name) || "lost+found".equalsIgnoreCase(name))) {
                continue;
            }
            String rel = prefix.isEmpty() ? name : (prefix + "/" + name);
            out.add(rel);
            if (depth + 1 <= maxDepth) {
                collectStorageFolders(child, rel, depth + 1, maxDepth, out, limit);
            }
        }
    }

    @PluginMethod
    public void pickFolderAndMoveOrCopyAudioFile(PluginCall call) {
        String uriStr = call.getString("uri", "");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }
        String initialFolder = call.getString("initialFolder", "");
        launchFolderPickerForCall(call, initialFolder);
    }

    private void launchFolderPickerForCall(PluginCall call, String initialRelPath) {
        bridge.saveCall(call);
        pendingFolderCallId = call.getCallbackId();

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && initialRelPath != null && !initialRelPath.trim().isEmpty()) {
            String cleaned = initialRelPath.trim().replaceAll("^/+|/+$", "");
            try {
                Uri hintUri = DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents",
                    "primary:" + cleaned
                );
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, hintUri);
            } catch (Exception ignored) {
                // ignore invalid initial URI hints
            }
        }

        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> folderPickerLauncher.launch(intent));
        } else {
            folderPickerLauncher.launch(intent);
        }
    }

    private void executeMoveOrCopyIntoTreeUri(PluginCall call, Uri treeUri) {
        String uriStr = call.getString("uri", "");
        String displayName = call.getString("displayName", "audio.mp3");
        String title = call.getString("title", displayName);
        String artist = call.getString("artist", "Unknown Artist");
        String album = call.getString("album", "");
        long durationMs = call.getInt("durationMs", 0);
        String mimeType = call.getString("mimeType", "audio/mpeg");
        String mode = call.getString("mode", "copy");

        try {
            Uri srcUri = Uri.parse(uriStr);
            ContentResolver resolver = getContext().getContentResolver();
            String resolvedMime = (mimeType != null && !mimeType.isEmpty() && !"audio/*".equals(mimeType))
                ? mimeType
                : inferMimeFromExtension(extractExtWithDot(displayName, ".mp3"));
            if (resolvedMime.isEmpty()) resolvedMime = "audio/mpeg";

            String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
            Uri destUri = DocumentsContract.createDocument(resolver, parentDocUri, resolvedMime, displayName);
            if (destUri == null) {
                throw new IllegalStateException("Could not create file in chosen folder");
            }

            long outSize = 0;
            try (InputStream in = openUriInputStream(resolver, srcUri);
                 OutputStream out = resolver.openOutputStream(destUri)) {
                if (in == null || out == null) throw new IllegalStateException("Could not copy audio stream");
                byte[] buf = new byte[65536];
                int len;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                    outSize += len;
                }
                out.flush();
            }

            if ("move".equals(mode)) {
                try {
                    if ("file".equals(srcUri.getScheme()) && srcUri.getPath() != null) {
                        //noinspection ResultOfMethodCallIgnored
                        new File(srcUri.getPath()).delete();
                    } else {
                        resolver.delete(srcUri, null, null);
                    }
                } catch (SecurityException ignored) {
                    // Copied safely; original delete may require user consent on scoped storage
                }
            }

            String friendlyFolder = treeDocId != null ? treeDocId.replaceFirst("^primary:", "") : "Selected Folder";
            if (friendlyFolder.isEmpty()) friendlyFolder = "Phone Storage";

            JSObject song = new JSObject();
            String newId = destUri.getLastPathSegment() != null ? destUri.getLastPathSegment() : String.valueOf(System.currentTimeMillis());
            song.put("id", newId);
            song.put("title", title);
            song.put("displayName", displayName);
            song.put("artist", artist);
            song.put("album", album);
            song.put("durationMs", durationMs);
            song.put("size", outSize);
            song.put("mimeType", resolvedMime);
            song.put("uri", destUri.toString());

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("newUri", destUri.toString());
            res.put("displayPath", friendlyFolder + "/" + displayName);
            res.put("song", song);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Could not " + mode + " audio to chosen folder: " + e.getMessage(), e);
        }
    }

    private boolean isMediaAudioRelativePathAllowed(String relPath) {
        if (relPath == null || relPath.isEmpty()) return false;
        String lower = relPath.toLowerCase(Locale.US);
        return lower.equals("music") || lower.startsWith("music/")
            || lower.equals("alarms") || lower.startsWith("alarms/")
            || lower.equals("audiobooks") || lower.startsWith("audiobooks/")
            || lower.equals("notifications") || lower.startsWith("notifications/")
            || lower.equals("podcasts") || lower.startsWith("podcasts/")
            || lower.equals("recordings") || lower.startsWith("recordings/")
            || lower.equals("ringtones") || lower.startsWith("ringtones/");
    }

    @PluginMethod
    public void moveOrCopyAudioFile(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String displayName = call.getString("displayName", "audio.mp3");
        String title = call.getString("title", displayName);
        String artist = call.getString("artist", "Unknown Artist");
        String album = call.getString("album", "");
        long durationMs = call.getInt("durationMs", 0);
        String mimeType = call.getString("mimeType", "audio/mpeg");
        String targetFolder = call.getString("targetFolder", "Music/Mo Vibe");
        String mode = call.getString("mode", "copy");

        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }

        executor.execute(() -> {
            try {
                Uri srcUri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();
                String resolvedMime = (mimeType != null && !mimeType.isEmpty() && !"audio/*".equals(mimeType))
                    ? mimeType
                    : inferMimeFromExtension(extractExtWithDot(displayName, ".mp3"));
                if (resolvedMime.isEmpty()) resolvedMime = "audio/mpeg";

                String relPath = (targetFolder != null && !targetFolder.trim().isEmpty())
                    ? targetFolder.trim().replaceAll("^/+|/+$", "")
                    : "Music/Mo Vibe";
                String relLower = relPath.toLowerCase(Locale.US);

                Uri newUri = null;
                long outSize = 0;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    boolean isDownloads = relLower.equals("download") || relLower.startsWith("download/") || relLower.equals("downloads") || relLower.startsWith("downloads/");
                    boolean isDocuments = relLower.equals("documents") || relLower.startsWith("documents/");
                    boolean isAudioAllowed = isMediaAudioRelativePathAllowed(relPath);
                    boolean isVideoMime = resolvedMime != null && resolvedMime.startsWith("video/");
                    boolean isVideoAllowed = relLower.equals("movies") || relLower.startsWith("movies/") || relLower.equals("dcim") || relLower.startsWith("dcim/");

                    if (isDownloads || isDocuments || isAudioAllowed || (isVideoMime && isVideoAllowed)) {
                        Uri destCollection = isDownloads
                            ? MediaStore.Downloads.EXTERNAL_CONTENT_URI
                            : isDocuments
                            ? MediaStore.Files.getContentUri("external")
                            : (isVideoMime && isVideoAllowed)
                            ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                            : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;

                        if (isDownloads && relLower.startsWith("downloads")) {
                            relPath = "Download" + relPath.substring("downloads".length());
                        }

                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
                        cv.put(MediaStore.MediaColumns.MIME_TYPE, resolvedMime);
                        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, relPath);
                        cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
                        if (destCollection.equals(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI)) {
                            cv.put(MediaStore.Audio.Media.TITLE, title);
                            cv.put(MediaStore.Audio.Media.ARTIST, artist);
                            cv.put(MediaStore.Audio.Media.ALBUM, album);
                            if (durationMs > 0) cv.put(MediaStore.Audio.Media.DURATION, durationMs);
                        } else if (destCollection.equals(MediaStore.Video.Media.EXTERNAL_CONTENT_URI)) {
                            cv.put(MediaStore.Video.Media.TITLE, title);
                            if (durationMs > 0) cv.put(MediaStore.Video.Media.DURATION, durationMs);
                        }
                        newUri = resolver.insert(destCollection, cv);
                        if (newUri != null) {
                            try (InputStream in = openUriInputStream(resolver, srcUri);
                                 OutputStream out = resolver.openOutputStream(newUri)) {
                                if (in == null || out == null) throw new IllegalStateException("Could not copy file stream");
                                byte[] buf = new byte[65536];
                                int len;
                                while ((len = in.read(buf)) != -1) {
                                    out.write(buf, 0, len);
                                    outSize += len;
                                }
                                out.flush();
                            }

                            ContentValues done = new ContentValues();
                            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                            resolver.update(newUri, done, null, null);
                        }
                    }

                    // For any other phone folder (e.g. DCIM, Movies, Pictures, custom root folders),
                    // try direct File write first; if Scoped Storage blocks direct write, prompt SAF folder grant cleanly.
                    if (newUri == null) {
                        boolean wroteDirect = false;
                        try {
                            File dir = new File(Environment.getExternalStorageDirectory(), relPath);
                            if (dir.exists() || dir.mkdirs()) {
                                File outFile = new File(dir, displayName);
                                try (InputStream in = openUriInputStream(resolver, srcUri);
                                     OutputStream out = new FileOutputStream(outFile)) {
                                    if (in != null) {
                                        byte[] buf = new byte[65536];
                                        int len;
                                        while ((len = in.read(buf)) != -1) {
                                            out.write(buf, 0, len);
                                            outSize += len;
                                        }
                                        out.flush();
                                        newUri = Uri.fromFile(outFile);
                                        MediaScannerConnection.scanFile(getContext(), new String[] { outFile.getAbsolutePath() }, new String[] { resolvedMime }, null);
                                        wroteDirect = true;
                                    }
                                }
                            }
                        } catch (Exception ignoredDirect) {
                            wroteDirect = false;
                        }

                        if (!wroteDirect) {
                            launchFolderPickerForCall(call, relPath);
                            return;
                        }
                    }
                } else {
                    File dir = new File(Environment.getExternalStorageDirectory(), relPath);
                    if (!dir.exists()) //noinspection ResultOfMethodCallIgnored
                        dir.mkdirs();
                    File outFile = new File(dir, displayName);
                    try (InputStream in = openUriInputStream(resolver, srcUri);
                         OutputStream out = new FileOutputStream(outFile)) {
                        if (in == null) throw new IllegalStateException("Could not open source file");
                        byte[] buf = new byte[65536];
                        int len;
                        while ((len = in.read(buf)) != -1) {
                            out.write(buf, 0, len);
                            outSize += len;
                        }
                        out.flush();
                    }
                    newUri = Uri.fromFile(outFile);
                    MediaScannerConnection.scanFile(getContext(), new String[] { outFile.getAbsolutePath() }, new String[] { resolvedMime }, null);
                }

                if ("move".equals(mode)) {
                    try {
                        if ("file".equals(srcUri.getScheme()) && srcUri.getPath() != null) {
                            //noinspection ResultOfMethodCallIgnored
                            new File(srcUri.getPath()).delete();
                        } else {
                            resolver.delete(srcUri, null, null);
                        }
                    } catch (SecurityException ignored) {
                        // Copied safely; original delete may require user consent on scoped storage
                    }
                }

                JSObject song = new JSObject();
                String newId = newUri.getLastPathSegment() != null ? newUri.getLastPathSegment() : String.valueOf(System.currentTimeMillis());
                song.put("id", newId);
                song.put("title", title);
                song.put("displayName", displayName);
                song.put("artist", artist);
                song.put("album", album);
                song.put("durationMs", durationMs);
                song.put("size", outSize);
                song.put("mimeType", resolvedMime);
                song.put("uri", newUri.toString());

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("newUri", newUri.toString());
                res.put("displayPath", relPath + "/" + displayName);
                res.put("song", song);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not " + mode + " audio: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void moveToSecureFolder(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String title = call.getString("title", "Audio Track");
        String displayName = call.getString("displayName", "audio.mp3");
        String mimeType = call.getString("mimeType", "audio/*");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }
        executor.execute(() -> {
            try {
                Uri srcUri = Uri.parse(uriStr);
                Uri shareUri = srcUri;
                if ("file".equals(srcUri.getScheme()) && srcUri.getPath() != null) {
                    File f = new File(srcUri.getPath());
                    shareUri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        f
                    );
                }

                String resolvedMime = (mimeType != null && !mimeType.isEmpty()) ? mimeType : "audio/*";
                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType(resolvedMime);
                sendIntent.putExtra(Intent.EXTRA_STREAM, shareUri);
                sendIntent.putExtra(Intent.EXTRA_SUBJECT, (title != null && !title.isEmpty()) ? title : displayName);
                sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                PackageManager pm = getContext().getPackageManager();
                List<ResolveInfo> candidates = pm.queryIntentActivities(sendIntent, PackageManager.MATCH_DEFAULT_ONLY);
                ResolveInfo secureMatch = null;
                if (candidates != null) {
                    for (ResolveInfo info : candidates) {
                        if (info == null || info.activityInfo == null) continue;
                        String pkg = info.activityInfo.packageName != null
                            ? info.activityInfo.packageName.toLowerCase(Locale.US)
                            : "";
                        String label = info.loadLabel(pm) != null
                            ? info.loadLabel(pm).toString().toLowerCase(Locale.US)
                            : "";
                        if (pkg.contains("securefolder")
                            || pkg.contains("knox.foldercontainer")
                            || label.contains("secure folder")
                            || label.contains("private space")) {
                            secureMatch = info;
                            break;
                        }
                    }
                }

                if (secureMatch != null) {
                    Intent targeted = new Intent(sendIntent);
                    targeted.setClassName(secureMatch.activityInfo.packageName, secureMatch.activityInfo.name);
                    getContext().startActivity(targeted);
                    JSObject res = new JSObject();
                    res.put("launched", true);
                    res.put("usedSystemSecureFolder", true);
                    res.put("message", "Opened Secure Folder to store \"" + ((title != null && !title.isEmpty()) ? title : displayName) + "\".");
                    call.resolve(res);
                    return;
                }

                Intent chooser = Intent.createChooser(sendIntent, "Move \"" + ((title != null && !title.isEmpty()) ? title : displayName) + "\" to Secure folder");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);

                JSObject res = new JSObject();
                res.put("launched", true);
                res.put("usedSystemSecureFolder", false);
                res.put("message", "Choose Secure folder / Private space from the Android sheet.");
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not open Android Secure Folder: " + e.getMessage(), e);
            }
        });
    }


    @PluginMethod
    public void pinAudioShortcut(PluginCall call) {
        String id = call.getString("id", "");
        String uriStr = call.getString("uri", "");
        String title = call.getString("title", "Audio Track");
        String artist = call.getString("artist", "");
        String displayName = call.getString("displayName", title);

        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }
        Context ctx = getContext();
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(ctx)) {
            JSObject res = new JSObject();
            res.put("pinned", false);
            res.put("supported", false);
            call.resolve(res);
            return;
        }
        executor.execute(() -> {
            try {
                Bitmap artBmp = AudioArtworkHelper.loadBitmapForNotification(ctx, id, uriStr, title, artist);
                IconCompat icon = artBmp != null
                    ? IconCompat.createWithBitmap(artBmp)
                    : IconCompat.createWithResource(ctx, R.mipmap.ic_launcher);

                Intent launchIntent = new Intent(ctx, MainActivity.class);
                launchIntent.setAction(Intent.ACTION_VIEW);
                launchIntent.putExtra(MusicPlaybackService.EXTRA_OPEN_SECTION, "audio");
                launchIntent.putExtra(EXTRA_SHORTCUT_TRACK_ID, id);
                launchIntent.putExtra(EXTRA_SHORTCUT_TRACK_URI, uriStr);
                launchIntent.putExtra(EXTRA_SHORTCUT_TRACK_TITLE, title);
                launchIntent.putExtra(EXTRA_SHORTCUT_TRACK_ARTIST, artist);
                launchIntent.putExtra(EXTRA_SHORTCUT_TRACK_DISPLAY_NAME, displayName);

                String scId = "movibe_track_" + (id != null && !id.isEmpty() ? id : Math.abs(uriStr.hashCode()));
                ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(ctx, scId)
                    .setShortLabel(title != null && !title.isEmpty() ? title : "Play Song")
                    .setLongLabel(title + (artist != null && !artist.isEmpty() ? " - " + artist : ""))
                    .setIcon(icon)
                    .setIntent(launchIntent)
                    .build();

                boolean ok = ShortcutManagerCompat.requestPinShortcut(ctx, shortcut, null);
                JSObject res = new JSObject();
                res.put("pinned", ok);
                res.put("supported", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not pin shortcut: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void extractVideoAudio(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String rawTitle = call.getString("title", "Extracted Audio");
        boolean setAsRingtone = Boolean.TRUE.equals(call.getBoolean("setAsRingtone", false));
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing video URI");
            return;
        }

        if (setAsRingtone && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(getContext())) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {}
            JSObject res = new JSObject();
            res.put("status", "permission_required");
            res.put("saved", false);
            res.put("message", "Allow 'Modify system settings' for Mo Vibe, then tap Set as ringtone again.");
            call.resolve(res);
            return;
        }

        executor.execute(() -> {
            File tempOutFile = null;
            MediaExtractor extractor = null;
            MediaMuxer muxer = null;
            try {
                Context ctx = getContext();
                ContentResolver resolver = ctx.getContentResolver();
                Uri srcUri = Uri.parse(uriStr);

                extractor = new MediaExtractor();
                if ("file".equals(srcUri.getScheme()) && srcUri.getPath() != null) {
                    extractor.setDataSource(srcUri.getPath());
                } else {
                    extractor.setDataSource(ctx, srcUri, null);
                }

                int audioTrackIndex = -1;
                MediaFormat audioFormat = null;
                String audioMime = "";
                for (int i = 0; i < extractor.getTrackCount(); i++) {
                    MediaFormat fmt = extractor.getTrackFormat(i);
                    String mime = fmt.getString(MediaFormat.KEY_MIME);
                    if (mime != null && mime.startsWith("audio/")) {
                        audioTrackIndex = i;
                        audioFormat = fmt;
                        audioMime = mime.toLowerCase(Locale.US);
                        break;
                    }
                }

                if (audioTrackIndex < 0 || audioFormat == null) {
                    JSObject res = new JSObject();
                    res.put("status", "failed");
                    res.put("saved", false);
                    res.put("message", "This video does not contain an audio track.");
                    call.resolve(res);
                    return;
                }

                boolean isWebmAudio = audioMime.contains("opus") || audioMime.contains("vorbis");
                String ext = isWebmAudio ? ".webm" : ".m4a";
                String outMime = isWebmAudio ? "audio/webm" : "audio/mp4";
                int muxerFmt = isWebmAudio
                    ? MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM
                    : MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4;

                tempOutFile = File.createTempFile("movibe_ext_audio_", ext, ctx.getCacheDir());
                muxer = new MediaMuxer(tempOutFile.getAbsolutePath(), muxerFmt);
                int outTrack = muxer.addTrack(audioFormat);
                muxer.start();

                extractor.selectTrack(audioTrackIndex);
                ByteBuffer buffer = ByteBuffer.allocate(512 * 1024);
                MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
                while (true) {
                    int sampleSize = extractor.readSampleData(buffer, 0);
                    if (sampleSize < 0) break;
                    bufferInfo.offset = 0;
                    bufferInfo.size = sampleSize;
                    bufferInfo.presentationTimeUs = Math.max(0L, extractor.getSampleTime());
                    bufferInfo.flags = extractor.getSampleFlags();
                    muxer.writeSampleData(outTrack, buffer, bufferInfo);
                    extractor.advance();
                }

                muxer.stop();
                muxer.release();
                muxer = null;
                extractor.release();
                extractor = null;

                String safeTitle = (rawTitle != null && !rawTitle.trim().isEmpty())
                    ? rawTitle.trim()
                    : "Extracted Audio";
                String finalFileName = sanitizeOutputFileName(safeTitle, ext);
                String targetRelDir = setAsRingtone
                    ? (Environment.DIRECTORY_RINGTONES + "/Mo Vibe")
                    : (Environment.DIRECTORY_MUSIC + "/Mo Vibe");

                Uri savedUri = null;
                String displayPath = targetRelDir + "/" + finalFileName;
                long outSize = tempOutFile.length();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Audio.Media.DISPLAY_NAME, finalFileName);
                    values.put(MediaStore.Audio.Media.TITLE, safeTitle);
                    values.put(MediaStore.Audio.Media.MIME_TYPE, outMime);
                    values.put(MediaStore.Audio.Media.RELATIVE_PATH, targetRelDir);
                    values.put(MediaStore.Audio.Media.IS_PENDING, 1);
                    if (setAsRingtone) {
                        values.put(MediaStore.Audio.Media.IS_RINGTONE, 1);
                    } else {
                        values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
                    }

                    savedUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
                    if (savedUri == null) throw new IllegalStateException("Could not create destination audio file");

                    try (InputStream in = new FileInputStream(tempOutFile);
                         OutputStream out = resolver.openOutputStream(savedUri)) {
                        if (out == null) throw new IllegalStateException("Output stream unavailable");
                        byte[] buf = new byte[65536];
                        int len;
                        while ((len = in.read(buf)) != -1) out.write(buf, 0, len);
                        out.flush();
                    }

                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Audio.Media.IS_PENDING, 0);
                    if (setAsRingtone) done.put(MediaStore.Audio.Media.IS_RINGTONE, 1);
                    resolver.update(savedUri, done, null, null);
                } else {
                    File baseDir = Environment.getExternalStoragePublicDirectory(
                        setAsRingtone ? Environment.DIRECTORY_RINGTONES : Environment.DIRECTORY_MUSIC
                    );
                    File destDir = new File(baseDir, "Mo Vibe");
                    if (!destDir.exists()) //noinspection ResultOfMethodCallIgnored
                        destDir.mkdirs();
                    File destFile = new File(destDir, finalFileName);
                    try (InputStream in = new FileInputStream(tempOutFile);
                         OutputStream out = new FileOutputStream(destFile)) {
                        byte[] buf = new byte[65536];
                        int len;
                        while ((len = in.read(buf)) != -1) out.write(buf, 0, len);
                        out.flush();
                    }
                    savedUri = Uri.fromFile(destFile);
                    MediaScannerConnection.scanFile(ctx, new String[] { destFile.getAbsolutePath() }, new String[] { outMime }, null);
                }

                if (setAsRingtone) {
                    RingtoneManager.setActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE, savedUri);
                    JSObject res = new JSObject();
                    res.put("status", "set");
                    res.put("saved", true);
                    res.put("uri", savedUri.toString());
                    res.put("displayPath", displayPath);
                    res.put("message", "\"" + safeTitle + "\" set as phone ringtone.");
                    call.resolve(res);
                } else {
                    JSObject res = new JSObject();
                    res.put("status", "saved");
                    res.put("saved", true);
                    res.put("uri", savedUri.toString());
                    res.put("displayPath", displayPath);
                    res.put("size", outSize);
                    res.put("mimeType", outMime);
                    res.put("message", "Saved audio to " + displayPath);
                    call.resolve(res);
                }
            } catch (Exception e) {
                JSObject res = new JSObject();
                res.put("status", "failed");
                res.put("saved", false);
                res.put("message", "Audio extraction failed: " + e.getMessage());
                call.resolve(res);
            } finally {
                if (muxer != null) {
                    try { muxer.release(); } catch (Exception ignored) {}
                }
                if (extractor != null) {
                    try { extractor.release(); } catch (Exception ignored) {}
                }
                if (tempOutFile != null && tempOutFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempOutFile.delete();
                }
            }
        });
    }

    @PluginMethod
    public void startAudioRecording(PluginCall call) {
        String mode = call.getString("mode", "voice");
        boolean micGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        boolean needPhone = "call".equals(mode)
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED;

        if (!micGranted || needPhone) {
            bridge.saveCall(call);
            pendingRecordCallId = call.getCallbackId();
            pendingRecordAction = "start";
            List<String> perms = new ArrayList<>();
            if (!micGranted) perms.add(Manifest.permission.RECORD_AUDIO);
            if (needPhone) perms.add(Manifest.permission.READ_PHONE_STATE);
            recordPermissionsLauncher.launch(perms.toArray(new String[0]));
            return;
        }
        startRecordingWithPermissions(call);
    }

    private void startRecordingWithPermissions(PluginCall call) {
        String mode = call.getString("mode", "voice");
        if (!"call".equals(mode)) mode = "voice";
        String customTitle = call.getString("title", "").trim();
        boolean speakerphone = Boolean.TRUE.equals(call.getBoolean("speakerphone", false));

        try {
            synchronized (recorderLock) {
                if (isRecordingAudio) {
                    call.reject("A recording is already in progress.");
                    return;
                }
                startMediaRecorderLocked(mode, customTitle, speakerphone, false);
            }
            JSObject res = new JSObject();
            res.put("recording", true);
            res.put("mode", mode);
            res.put("startedAt", System.currentTimeMillis());
            call.resolve(res);
            emitRecordingStateEvent("started", null, null);
        } catch (Exception e) {
            cleanupActiveRecorderLocked();
            call.reject("Could not start recording: " + e.getMessage(), e);
        }
    }

    private void startMediaRecorderLocked(String mode, String title, boolean speakerphone, boolean fromAutoCall) throws Exception {
        Context ctx = getContext();
        String defaultTitle = "call".equals(mode)
            ? ("Call Recording " + android.text.format.DateFormat.format("yyyy-MM-dd HH-mm-ss", System.currentTimeMillis()))
            : ("Voice Recording " + android.text.format.DateFormat.format("yyyy-MM-dd HH-mm-ss", System.currentTimeMillis()));
        String resolvedTitle = (title != null && !title.isEmpty()) ? title : defaultTitle;

        File outFile = File.createTempFile("movibe_rec_", ".m4a", ctx.getCacheDir());
        if (outFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            outFile.delete();
        }

        if ("call".equals(mode) && speakerphone) {
            try {
                AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    prevAudioMode = am.getMode();
                    prevSpeakerphoneState = am.isSpeakerphoneOn();
                    savedSpeakerphoneRestore = true;
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    am.setSpeakerphoneOn(true);
                }
            } catch (Exception ignored) {
                savedSpeakerphoneRestore = false;
            }
        }

        int[] audioSources = "call".equals(mode)
            ? new int[] {
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                MediaRecorder.AudioSource.MIC
            }
            : new int[] {
                MediaRecorder.AudioSource.MIC,
                MediaRecorder.AudioSource.DEFAULT
            };

        MediaRecorder startedRecorder = null;
        Exception lastErr = null;
        for (int src : audioSources) {
            MediaRecorder mr = null;
            try {
                mr = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? new MediaRecorder(ctx)
                    : new MediaRecorder();
                mr.setAudioSource(src);
                mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                mr.setAudioSamplingRate(44100);
                mr.setAudioEncodingBitRate(192000);
                mr.setAudioChannels(1);
                mr.setOutputFile(outFile.getAbsolutePath());
                mr.prepare();
                mr.start();
                startedRecorder = mr;
                break;
            } catch (Exception err) {
                lastErr = err;
                if (mr != null) {
                    try { mr.reset(); } catch (Exception ignored) {}
                    try { mr.release(); } catch (Exception ignored) {}
                }
            }
        }

        if (startedRecorder == null) {
            throw (lastErr != null ? lastErr : new IllegalStateException("Microphone unavailable"));
        }

        activeRecorder = startedRecorder;
        activeRecordingFile = outFile;
        activeRecordingMode = mode;
        activeRecordingTitle = resolvedTitle;
        isRecordingAudio = true;
        isRecordingPaused = false;
        autoCallStartedThisRecording = fromAutoCall;
        recordingStartElapsedMs = SystemClock.elapsedRealtime();
        recordingPausedAtMs = 0L;
        recordingPausedAccumulatedMs = 0L;
    }

    @PluginMethod
    public void pauseAudioRecording(PluginCall call) {
        synchronized (recorderLock) {
            if (!isRecordingAudio || activeRecorder == null) {
                call.reject("No active recording to pause.");
                return;
            }
            if (!isRecordingPaused) {
                try {
                    activeRecorder.pause();
                    isRecordingPaused = true;
                    recordingPausedAtMs = SystemClock.elapsedRealtime();
                } catch (Exception e) {
                    call.reject("Could not pause recording: " + e.getMessage(), e);
                    return;
                }
            }
        }
        JSObject res = new JSObject();
        res.put("paused", true);
        call.resolve(res);
        emitRecordingStateEvent("paused", null, null);
    }

    @PluginMethod
    public void resumeAudioRecording(PluginCall call) {
        synchronized (recorderLock) {
            if (!isRecordingAudio || activeRecorder == null) {
                call.reject("No active recording to resume.");
                return;
            }
            if (isRecordingPaused) {
                try {
                    activeRecorder.resume();
                    if (recordingPausedAtMs > 0) {
                        recordingPausedAccumulatedMs += Math.max(0L, SystemClock.elapsedRealtime() - recordingPausedAtMs);
                    }
                    recordingPausedAtMs = 0L;
                    isRecordingPaused = false;
                } catch (Exception e) {
                    call.reject("Could not resume recording: " + e.getMessage(), e);
                    return;
                }
            }
        }
        JSObject res = new JSObject();
        res.put("paused", false);
        call.resolve(res);
        emitRecordingStateEvent("resumed", null, null);
    }

    @PluginMethod
    public void getRecordingStatus(PluginCall call) {
        JSObject res = buildRecordingStatusObject();
        call.resolve(res);
    }

    private JSObject buildRecordingStatusObject() {
        JSObject res = new JSObject();
        synchronized (recorderLock) {
            long elapsed = 0L;
            int amplitude = 0;
            if (isRecordingAudio) {
                long refNow = isRecordingPaused && recordingPausedAtMs > 0
                    ? recordingPausedAtMs
                    : SystemClock.elapsedRealtime();
                elapsed = Math.max(0L, refNow - recordingStartElapsedMs - recordingPausedAccumulatedMs);
                if (!isRecordingPaused && activeRecorder != null) {
                    try {
                        int rawAmp = activeRecorder.getMaxAmplitude();
                        amplitude = Math.min(100, Math.max(0, Math.round((rawAmp / 32767f) * 100f)));
                    } catch (Exception ignored) {
                        amplitude = 0;
                    }
                }
            }
            res.put("isRecording", isRecordingAudio);
            res.put("isPaused", isRecordingPaused);
            res.put("mode", activeRecordingMode);
            res.put("title", activeRecordingTitle);
            res.put("elapsedMs", elapsed);
            res.put("amplitude", amplitude);
            res.put("autoCallRecording", isAutoCallRecordingActive);
            res.put("speakerphone", autoCallSpeakerphone);
            res.put("disappearAfterMs", callDisappearAfterMs);
            res.put("callState", callStateLabel(lastTelephonyState));
        }
        return res;
    }

    private String callStateLabel(int state) {
        switch (state) {
            case TelephonyManager.CALL_STATE_RINGING:
                return "ringing";
            case TelephonyManager.CALL_STATE_OFFHOOK:
                return "in_call";
            default:
                return "idle";
        }
    }

    @PluginMethod
    public void stopAudioRecording(PluginCall call) {
        boolean discard = Boolean.TRUE.equals(call.getBoolean("discard", false));
        String overrideTitle = call.getString("customTitle", "").trim();

        executor.execute(() -> {
            JSObject result = stopAndSaveRecordingInternal(discard, overrideTitle);
            if (result.has("error")) {
                call.reject(result.getString("error"));
            } else {
                call.resolve(result);
            }
        });
    }

    private JSObject stopAndSaveRecordingInternal(boolean discard, String overrideTitle) {
        MediaRecorder rec;
        File tempFile;
        String mode;
        String title;
        long durationMs;

        synchronized (recorderLock) {
            rec = activeRecorder;
            tempFile = activeRecordingFile;
            mode = activeRecordingMode;
            title = (overrideTitle != null && !overrideTitle.isEmpty()) ? overrideTitle : activeRecordingTitle;
            long refNow = isRecordingPaused && recordingPausedAtMs > 0
                ? recordingPausedAtMs
                : SystemClock.elapsedRealtime();
            durationMs = isRecordingAudio
                ? Math.max(0L, refNow - recordingStartElapsedMs - recordingPausedAccumulatedMs)
                : 0L;

            activeRecorder = null;
            activeRecordingFile = null;
            isRecordingAudio = false;
            isRecordingPaused = false;
            autoCallStartedThisRecording = false;
            recordingStartElapsedMs = 0L;
            recordingPausedAtMs = 0L;
            recordingPausedAccumulatedMs = 0L;
        }

        restoreAudioManagerAfterCallLocked();

        if (rec != null) {
            try { rec.stop(); } catch (Exception ignored) {}
            try { rec.reset(); } catch (Exception ignored) {}
            try { rec.release(); } catch (Exception ignored) {}
        }

        if (discard || tempFile == null || !tempFile.exists() || tempFile.length() == 0) {
            if (tempFile != null && tempFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
            }
            JSObject res = new JSObject();
            res.put("saved", false);
            res.put("discarded", true);
            emitRecordingStateEvent("discarded", null, null);
            return res;
        }

        try {
            Context ctx = getContext();
            ContentResolver resolver = ctx.getContentResolver();
            String safeTitle = (title != null && !title.isEmpty())
                ? title
                : ("call".equals(mode) ? "Call Recording" : "Voice Recording");
            String finalFileName = sanitizeOutputFileName(safeTitle, ".m4a");
            String folderSub = "call".equals(mode) ? "Mo Vibe/Call Recordings" : "Mo Vibe/Voice Recordings";
            String artistLabel = "call".equals(mode) ? "Call Recording" : "Voice Recording";
            String albumLabel = "call".equals(mode) ? "Mo Vibe Calls" : "Mo Vibe Voice Notes";

            Uri savedUri;
            String displayPath = "Music/" + folderSub + "/" + finalFileName;
            long sizeBytes = tempFile.length();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Audio.Media.DISPLAY_NAME, finalFileName);
                values.put(MediaStore.Audio.Media.TITLE, safeTitle);
                values.put(MediaStore.Audio.Media.ARTIST, artistLabel);
                values.put(MediaStore.Audio.Media.ALBUM, albumLabel);
                values.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4");
                values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
                if (durationMs > 0) values.put(MediaStore.Audio.Media.DURATION, durationMs);
                values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/" + folderSub);
                values.put(MediaStore.Audio.Media.IS_PENDING, 1);

                savedUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
                if (savedUri == null) throw new IllegalStateException("Could not save recording to Music folder");

                try (InputStream in = new FileInputStream(tempFile);
                     OutputStream out = resolver.openOutputStream(savedUri)) {
                    if (out == null) throw new IllegalStateException("Output stream unavailable");
                    byte[] buf = new byte[65536];
                    int len;
                    while ((len = in.read(buf)) != -1) out.write(buf, 0, len);
                    out.flush();
                }

                ContentValues done = new ContentValues();
                done.put(MediaStore.Audio.Media.IS_PENDING, 0);
                resolver.update(savedUri, done, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), folderSub);
                if (!dir.exists()) //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                File destFile = new File(dir, finalFileName);
                try (InputStream in = new FileInputStream(tempFile);
                     OutputStream out = new FileOutputStream(destFile)) {
                    byte[] buf = new byte[65536];
                    int len;
                    while ((len = in.read(buf)) != -1) out.write(buf, 0, len);
                    out.flush();
                }
                savedUri = Uri.fromFile(destFile);
                MediaScannerConnection.scanFile(ctx, new String[] { destFile.getAbsolutePath() }, new String[] { "audio/mp4" }, null);
            }

            long durFinal = durationMs;
            if (durFinal <= 0) {
                try {
                    MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                    mmr.setDataSource(ctx, savedUri);
                    String dStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                    if (dStr != null) durFinal = Long.parseLong(dStr);
                    mmr.release();
                } catch (Exception ignored) {}
            }

            long nowMs = System.currentTimeMillis();
            long expiresAtMs = ("call".equals(mode) && callDisappearAfterMs > 0L)
                ? (nowMs + callDisappearAfterMs)
                : 0L;

            JSObject song = new JSObject();
            String recId = savedUri.getLastPathSegment() != null ? savedUri.getLastPathSegment() : String.valueOf(nowMs);
            song.put("id", recId);
            song.put("title", safeTitle);
            song.put("displayName", finalFileName);
            song.put("artist", artistLabel);
            song.put("album", albumLabel);
            song.put("durationMs", durFinal);
            song.put("size", sizeBytes);
            song.put("mimeType", "audio/mp4");
            song.put("uri", savedUri.toString());

            if ("call".equals(mode)) {
                trackCallExpiryEntry(recId, savedUri.toString(), safeTitle, nowMs, expiresAtMs);
            }

            JSObject res = new JSObject();
            res.put("saved", true);
            res.put("displayPath", displayPath);
            res.put("uri", savedUri.toString());
            if (expiresAtMs > 0L) {
                res.put("expiresAt", expiresAtMs);
            }
            res.put("song", song);
            emitRecordingStateEvent("saved", displayPath, song);
            return res;
        } catch (Exception e) {
            JSObject errRes = new JSObject();
            errRes.put("saved", false);
            errRes.put("error", "Could not save recording: " + e.getMessage());
            return errRes;
        } finally {
            if (tempFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
            }
        }
    }

    private void cleanupActiveRecorderLocked() {
        synchronized (recorderLock) {
            if (activeRecorder != null) {
                try { activeRecorder.stop(); } catch (Exception ignored) {}
                try { activeRecorder.reset(); } catch (Exception ignored) {}
                try { activeRecorder.release(); } catch (Exception ignored) {}
                activeRecorder = null;
            }
            if (activeRecordingFile != null && activeRecordingFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                activeRecordingFile.delete();
            }
            activeRecordingFile = null;
            isRecordingAudio = false;
            isRecordingPaused = false;
            autoCallStartedThisRecording = false;
        }
        restoreAudioManagerAfterCallLocked();
    }

    private void restoreAudioManagerAfterCallLocked() {
        if (!savedSpeakerphoneRestore) return;
        savedSpeakerphoneRestore = false;
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setSpeakerphoneOn(prevSpeakerphoneState);
                am.setMode(prevAudioMode);
            }
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void setAutoCallRecording(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Boolean speakerOpt = call.getBoolean("speakerphone");
        if (speakerOpt != null) {
            autoCallSpeakerphone = speakerOpt;
            getContext().getSharedPreferences("movibe_prefs", Context.MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_AUTO_CALL_SPEAKERPHONE, autoCallSpeakerphone)
                .apply();
        }
        if (enabled) {
            boolean micGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            boolean phoneGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
            if (!micGranted || !phoneGranted) {
                bridge.saveCall(call);
                pendingRecordCallId = call.getCallbackId();
                pendingRecordAction = "auto_call";
                List<String> perms = new ArrayList<>();
                if (!micGranted) perms.add(Manifest.permission.RECORD_AUDIO);
                if (!phoneGranted) perms.add(Manifest.permission.READ_PHONE_STATE);
                recordPermissionsLauncher.launch(perms.toArray(new String[0]));
                return;
            }
        }
        applyAutoCallRecordingState(call, enabled);
    }

    private void applyAutoCallRecordingState(PluginCall call, boolean enabled) {
        getContext().getSharedPreferences("movibe_prefs", Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_AUTO_CALL_REC, enabled)
            .apply();
        isAutoCallRecordingActive = enabled;
        if (enabled) {
            registerCallStateMonitor();
        } else {
            unregisterCallStateMonitor();
        }
        JSObject res = new JSObject();
        res.put("autoCallRecording", enabled);
        res.put("speakerphone", autoCallSpeakerphone);
        call.resolve(res);
        emitRecordingStateEvent(enabled ? "auto_call_enabled" : "auto_call_disabled", null, null);
    }

    @PluginMethod
    public void getCallRecorderSettings(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences("movibe_prefs", Context.MODE_PRIVATE);
        int trackedCount = 0;
        synchronized (expiryLock) {
            try {
                JSONArray arr = new JSONArray(prefs.getString(PREF_CALL_EXPIRY_ENTRIES, "[]"));
                trackedCount = arr.length();
            } catch (Exception ignored) {
                trackedCount = 0;
            }
        }
        JSObject res = new JSObject();
        res.put("autoCallRecording", isAutoCallRecordingActive);
        res.put("speakerphone", autoCallSpeakerphone);
        res.put("disappearAfterMs", callDisappearAfterMs);
        res.put("trackedCount", trackedCount);
        call.resolve(res);
    }

    @PluginMethod
    public void setCallRecorderSettings(PluginCall call) {
        Boolean autoOpt = call.getBoolean("autoCallRecording");
        if (Boolean.TRUE.equals(autoOpt)) {
            boolean micGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            boolean phoneGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
            if (!micGranted || !phoneGranted) {
                bridge.saveCall(call);
                pendingRecordCallId = call.getCallbackId();
                pendingRecordAction = "call_settings";
                List<String> perms = new ArrayList<>();
                if (!micGranted) perms.add(Manifest.permission.RECORD_AUDIO);
                if (!phoneGranted) perms.add(Manifest.permission.READ_PHONE_STATE);
                recordPermissionsLauncher.launch(perms.toArray(new String[0]));
                return;
            }
        }
        applyCallRecorderSettingsInternal(call, false);
    }

    private void applyCallRecorderSettingsInternal(PluginCall call, boolean forceAutoTrue) {
        SharedPreferences prefs = getContext().getSharedPreferences("movibe_prefs", Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = prefs.edit();

        Boolean autoOpt = forceAutoTrue ? Boolean.TRUE : call.getBoolean("autoCallRecording");
        if (autoOpt != null) {
            isAutoCallRecordingActive = autoOpt;
            ed.putBoolean(PREF_AUTO_CALL_REC, isAutoCallRecordingActive);
            if (isAutoCallRecordingActive) {
                registerCallStateMonitor();
            } else {
                unregisterCallStateMonitor();
            }
        }

        Boolean speakerOpt = call.getBoolean("speakerphone");
        if (speakerOpt != null) {
            autoCallSpeakerphone = speakerOpt;
            ed.putBoolean(PREF_AUTO_CALL_SPEAKERPHONE, autoCallSpeakerphone);
        }

        if (call.hasOption("disappearAfterMs")) {
            Double rawMs = call.getDouble("disappearAfterMs", 0.0);
            callDisappearAfterMs = rawMs != null ? Math.max(0L, Math.round(rawMs)) : 0L;
            ed.putLong(PREF_CALL_DISAPPEAR_MS, callDisappearAfterMs);
        }

        ed.apply();

        boolean applyToExisting = Boolean.TRUE.equals(call.getBoolean("applyToExisting", false));
        int trackedCount = 0;
        synchronized (expiryLock) {
            try {
                JSONArray arr = new JSONArray(prefs.getString(PREF_CALL_EXPIRY_ENTRIES, "[]"));
                if (applyToExisting) {
                    long now = System.currentTimeMillis();
                    JSONArray updated = new JSONArray();
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject obj = arr.optJSONObject(i);
                        if (obj == null) continue;
                        long created = obj.optLong("createdAt", now);
                        obj.put("expiresAt", callDisappearAfterMs <= 0L ? 0L : Math.max(now + 1500L, created + callDisappearAfterMs));
                        updated.put(obj);
                    }
                    arr = updated;
                    prefs.edit().putString(PREF_CALL_EXPIRY_ENTRIES, arr.toString()).apply();
                }
                trackedCount = arr.length();
            } catch (Exception ignored) {
                trackedCount = 0;
            }
        }

        JSObject res = new JSObject();
        res.put("autoCallRecording", isAutoCallRecordingActive);
        res.put("speakerphone", autoCallSpeakerphone);
        res.put("disappearAfterMs", callDisappearAfterMs);
        res.put("trackedCount", trackedCount);
        call.resolve(res);
        emitRecordingStateEvent("settings_updated", null, null);
    }

    @PluginMethod
    public void purgeExpiredCallRecordings(PluginCall call) {
        executor.execute(() -> {
            List<String> removed = purgeExpiredCallRecordingsInternal(true);
            JSArray idsArr = new JSArray();
            for (String id : removed) {
                idsArr.put(id);
            }
            JSObject res = new JSObject();
            res.put("removedIds", idsArr);
            res.put("removedCount", removed.size());
            call.resolve(res);
        });
    }

    private void trackCallExpiryEntry(String id, String uri, String title, long createdAt, long expiresAt) {
        synchronized (expiryLock) {
            try {
                SharedPreferences prefs = getContext().getSharedPreferences("movibe_prefs", Context.MODE_PRIVATE);
                JSONArray arr = new JSONArray(prefs.getString(PREF_CALL_EXPIRY_ENTRIES, "[]"));
                JSONArray next = new JSONArray();
                JSONObject entry = new JSONObject();
                entry.put("id", id);
                entry.put("uri", uri);
                entry.put("title", title);
                entry.put("createdAt", createdAt);
                entry.put("expiresAt", expiresAt);
                next.put(entry);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject existing = arr.optJSONObject(i);
                    if (existing != null && !id.equals(existing.optString("id"))) {
                        next.put(existing);
                    }
                }
                prefs.edit().putString(PREF_CALL_EXPIRY_ENTRIES, next.toString()).apply();
            } catch (Exception ignored) {}
        }
    }

    private List<String> purgeExpiredCallRecordingsInternal(boolean emitEvent) {
        List<String> removedIds = new ArrayList<>();
        synchronized (expiryLock) {
            try {
                SharedPreferences prefs = getContext().getSharedPreferences("movibe_prefs", Context.MODE_PRIVATE);
                String raw = prefs.getString(PREF_CALL_EXPIRY_ENTRIES, "[]");
                JSONArray arr = new JSONArray(raw);
                if (arr.length() == 0) {
                    return removedIds;
                }
                long now = System.currentTimeMillis();
                JSONArray remaining = new JSONArray();
                ContentResolver resolver = getContext().getContentResolver();
                boolean changed = false;

                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.optJSONObject(i);
                    if (obj == null) continue;
                    long expiresAt = obj.optLong("expiresAt", 0L);
                    String id = obj.optString("id", "");
                    String uriStr = obj.optString("uri", "");
                    if (expiresAt > 0L && now >= expiresAt) {
                        changed = true;
                        try {
                            if (!uriStr.isEmpty()) {
                                Uri targetUri = Uri.parse(uriStr);
                                if ("file".equals(targetUri.getScheme()) && targetUri.getPath() != null) {
                                    File f = new File(targetUri.getPath());
                                    if (f.exists()) {
                                        //noinspection ResultOfMethodCallIgnored
                                        f.delete();
                                    }
                                } else {
                                    resolver.delete(targetUri, null, null);
                                }
                            }
                        } catch (Exception ignored) {
                            // Even if file already removed externally, drop tracking entry
                        }
                        if (!id.isEmpty()) {
                            removedIds.add(id);
                        }
                    } else {
                        remaining.put(obj);
                    }
                }

                if (changed) {
                    prefs.edit().putString(PREF_CALL_EXPIRY_ENTRIES, remaining.toString()).apply();
                }
            } catch (Exception ignored) {}
        }

        if (emitEvent && !removedIds.isEmpty()) {
            JSObject payload = buildRecordingStatusObject();
            payload.put("event", "expired_cleaned");
            JSArray idsArr = new JSArray();
            for (String id : removedIds) idsArr.put(id);
            payload.put("removedIds", idsArr);
            notifyListeners("recordingStateChanged", payload);
        }
        return removedIds;
    }

    private void onPhoneCallStateChanged(int state) {
        lastTelephonyState = state;
        if (!isAutoCallRecordingActive) return;
        if (state == TelephonyManager.CALL_STATE_OFFHOOK) {
            synchronized (recorderLock) {
                if (!isRecordingAudio) {
                    try {
                        startMediaRecorderLocked("call", "", autoCallSpeakerphone, true);
                        emitRecordingStateEvent("started", null, null);
                    } catch (Exception ignored) {
                        cleanupActiveRecorderLocked();
                    }
                }
            }
        } else if (state == TelephonyManager.CALL_STATE_IDLE) {
            boolean shouldStopAuto;
            synchronized (recorderLock) {
                shouldStopAuto = isRecordingAudio && autoCallStartedThisRecording;
            }
            if (shouldStopAuto) {
                executor.execute(() -> stopAndSaveRecordingInternal(false, ""));
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void registerCallStateMonitor() {
        try {
            unregisterCallStateMonitor();
            TelephonyManager tm = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return;
            telephonyManager = tm;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                class CallStateCb extends TelephonyCallback implements TelephonyCallback.CallStateListener {
                    @Override
                    public void onCallStateChanged(int state) {
                        onPhoneCallStateChanged(state);
                    }
                }
                CallStateCb cb = new CallStateCb();
                activeTelephonyCallback = cb;
                tm.registerTelephonyCallback(ContextCompat.getMainExecutor(getContext()), cb);
            } else {
                PhoneStateListener listener = new PhoneStateListener() {
                    @Override
                    public void onCallStateChanged(int state, String phoneNumber) {
                        onPhoneCallStateChanged(state);
                    }
                };
                legacyPhoneStateListener = listener;
                tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE);
            }
        } catch (Exception ignored) {
            // Device may restrict telephony state callbacks without permission
        }
    }

    @SuppressWarnings("deprecation")
    private void unregisterCallStateMonitor() {
        try {
            if (telephonyManager == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && activeTelephonyCallback instanceof TelephonyCallback) {
                telephonyManager.unregisterTelephonyCallback((TelephonyCallback) activeTelephonyCallback);
                activeTelephonyCallback = null;
            } else if (legacyPhoneStateListener != null) {
                telephonyManager.listen(legacyPhoneStateListener, PhoneStateListener.LISTEN_NONE);
                legacyPhoneStateListener = null;
            }
        } catch (Exception ignored) {}
    }

    private void emitRecordingStateEvent(String eventType, String displayPath, JSObject song) {
        JSObject payload = buildRecordingStatusObject();
        payload.put("event", eventType);
        if (displayPath != null) payload.put("displayPath", displayPath);
        if (song != null) payload.put("song", song);
        notifyListeners("recordingStateChanged", payload);
    }

    private InputStream openUriInputStream(ContentResolver resolver, Uri uri) throws Exception {
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            return new FileInputStream(new File(uri.getPath()));
        }
        return resolver.openInputStream(uri);
    }

    private String extractExtWithDot(String fileName, String fallback) {
        if (fileName == null) return fallback;
        int dot = fileName.lastIndexOf('.');
        if (dot >= 0 && dot < fileName.length() - 1) {
            return fileName.substring(dot).toLowerCase(Locale.US);
        }
        return fallback;
    }

    private String sanitizeOutputFileName(String baseName, String extWithDot) {
        String safeBase = (baseName != null ? baseName : "audio")
            .replaceAll("[\\\\/:*?\"<>|]", "_")
            .trim();
        if (safeBase.isEmpty()) {
            safeBase = "audio";
        }
        String ext = (extWithDot != null && extWithDot.startsWith(".")) ? extWithDot : ".mp3";
        if (safeBase.toLowerCase(Locale.US).endsWith(ext.toLowerCase(Locale.US))) {
            return safeBase;
        }
        return safeBase + ext;
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        MusicPlaybackService.setStateListener(null);
        unregisterCallStateMonitor();
        cleanupActiveRecorderLocked();
        if (lastTempAudioFile != null && lastTempAudioFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            lastTempAudioFile.delete();
        }
        if (lastPlayerAudioFile != null && lastPlayerAudioFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            lastPlayerAudioFile.delete();
        }
        if (lastPlayerVideoFile != null && lastPlayerVideoFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            lastPlayerVideoFile.delete();
        }
        if (lastExternalMediaFile != null && lastExternalMediaFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            lastExternalMediaFile.delete();
        }
        for (File f : pendingExports.values()) {
            if (f != null && f.exists()) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        pendingExports.clear();
        executor.shutdownNow();
        thumbExecutor.shutdownNow();
        expiryScheduler.shutdownNow();
    }
}
