package com.beatpulse.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.util.Size;
import android.view.View;
import android.view.Window;
import android.webkit.MimeTypeMap;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AudioLibrary")
public class AudioLibraryPlugin extends Plugin {

    private static final String PROBE_AUDIO_FILENAME = "beatpulse_default_setup_probe.mp3";
    private static final String PROBE_VIDEO_FILENAME = "beatpulse_default_setup_probe.mp4";

    private ActivityResultLauncher<String> permissionLauncher;
    private ActivityResultLauncher<String> notificationPermissionLauncher;
    private boolean hasRequestedNotifications = false;
    private String pendingCallId;
    private String pendingPermissionType = "audio";
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

        MusicPlaybackService.setStateListener(state ->
            notifyListeners("musicPlaybackStateChanged", state)
        );

        if (getActivity() != null) {
            handleExternalIntent(getActivity().getIntent());
            handleNavigationIntent(getActivity().getIntent());
        }
    }

    public void handleNavigationIntent(Intent intent) {
        if (intent == null) return;
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
                MediaStore.Audio.Media.MIME_TYPE
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

                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("title", title != null && !title.isEmpty() ? title : (displayName != null ? displayName : "Unknown Track"));
                        item.put("displayName", displayName != null ? displayName : (title != null ? title : "audio_track"));
                        item.put("artist", artist != null && !"<unknown>".equalsIgnoreCase(artist) ? artist : "Unknown Artist");
                        item.put("album", album != null ? album : "");
                        item.put("durationMs", durationMs);
                        item.put("size", size);
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
                MediaStore.Video.Media.RESOLUTION
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

                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);

                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("title", title != null && !title.isEmpty() ? title : (displayName != null ? displayName : "Video"));
                        item.put("displayName", displayName != null ? displayName : (title != null ? title : "video.mp4"));
                        item.put("durationMs", durationMs);
                        item.put("size", size);
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
                MediaStore.Images.Media.MIME_TYPE
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

                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);

                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("title", title != null && !title.isEmpty() ? title : (displayName != null ? displayName : "Image"));
                        item.put("displayName", displayName != null ? displayName : (title != null ? title : "image.jpg"));
                        item.put("width", width);
                        item.put("height", height);
                        item.put("size", size);
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
                        retriever.setDataSource(getContext(), contentUri);
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
                    try (InputStream in = resolver.openInputStream(contentUri)) {
                        if (in != null) {
                            BitmapFactory.Options opts = new BitmapFactory.Options();
                            opts.inSampleSize = 4;
                            bitmap = BitmapFactory.decodeStream(in, null, opts);
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

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        MusicPlaybackService.setStateListener(null);
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
    }
}
