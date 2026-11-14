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
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
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

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
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
    private String pendingCallId;
    private String pendingPermissionType = "audio";
    private File lastTempAudioFile;
    private File lastPlayerAudioFile;
    private File lastPlayerVideoFile;
    private File lastExternalMediaFile;
    private final Object pendingMediaLock = new Object();
    private JSObject pendingExternalMedia;
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
                    } else {
                        loadAudioFiles(savedCall, true);
                    }
                } else {
                    String deniedMsg = "video".equals(permType)
                        ? "Allow video access to see videos"
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
                    } else {
                        result.put("songs", new JSArray());
                    }
                    savedCall.resolve(result);
                    bridge.releaseCall(savedCall);
                }
            }
        );

        if (getActivity() != null) {
            handleExternalIntent(getActivity().getIntent());
        }
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
                    ? "BeatPulse set as default player!"
                    : "Choose 'Always' next time to set BeatPulse as default.";
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
                    // Check if file:// URI points to a directly readable local file
                    if ("file".equals(scheme) && data.getPath() != null) {
                        File directFile = new File(data.getPath());
                        if (directFile.exists() && directFile.canRead()) {
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
                                        File directFile = new File(candidate);
                                        if (directFile.exists() && directFile.canRead()) {
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
                        Toast.makeText(getContext(), "Unable to open media file in BeatPulse", Toast.LENGTH_SHORT).show()
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
        String rawTheme = call.getString("theme", "dark");
        String theme = ("light".equals(rawTheme) || "system".equals(rawTheme)) ? rawTheme : "dark";

        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences("beatpulse_prefs", Context.MODE_PRIVATE);
        prefs.edit().putString("app_theme", theme).apply();

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
        String theme = prefs.getString("app_theme", "dark");
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

    @PluginMethod
    public void prepareMediaFile(PluginCall call) {
        String uriString = call.getString("uri");
        String mediaKind = call.getString("mediaKind", "audio");
        String defaultExt = "video".equals(mediaKind) ? ".mp4" : ".mp3";
        String displayName = call.getString("displayName", "media" + defaultExt);

        if (uriString == null || uriString.isEmpty()) {
            call.reject("Missing media URI");
            return;
        }

        executor.execute(() -> {
            try {
                Uri contentUri = Uri.parse(uriString);
                ContentResolver resolver = getContext().getContentResolver();

                // Fast path: if MediaStore exposes a directly readable filesystem path, stream from it with zero copy.
                String directPath = null;
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
                                File directFile = new File(candidate);
                                if (directFile.exists() && directFile.canRead()) {
                                    directPath = directFile.getAbsolutePath();
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {
                    directPath = null;
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
                if ("video".equals(mediaKind)) {
                    if (lastPlayerVideoFile != null && lastPlayerVideoFile.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        lastPlayerVideoFile.delete();
                    }
                } else {
                    if (lastPlayerAudioFile != null && lastPlayerAudioFile.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        lastPlayerAudioFile.delete();
                    }
                }

                File outFile = new File(
                    cacheDir,
                    "beatpulse_player_" + mediaKind + "_" + System.currentTimeMillis() + ext
                );
                if ("video".equals(mediaKind)) {
                    lastPlayerVideoFile = outFile;
                } else {
                    lastPlayerAudioFile = outFile;
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
                    values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/BeatPulse");
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
                        dlValues.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/BeatPulse");
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
                    savedDisplayPath = (savedToDownloads ? "Download/BeatPulse/" : "Music/BeatPulse/") + finalFileName;
                } else {
                    boolean hasWritePerm = ContextCompat.checkSelfPermission(
                        getContext(),
                        Manifest.permission.WRITE_EXTERNAL_STORAGE
                    ) == PackageManager.PERMISSION_GRANTED;

                    File targetDir;
                    if (hasWritePerm) {
                        targetDir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                            "BeatPulse"
                        );
                        savedDisplayPath = "Music/BeatPulse/" + finalFileName;
                    } else {
                        File appMusicDir = getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                        targetDir = new File(appMusicDir != null ? appMusicDir : getContext().getFilesDir(), "BeatPulse");
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

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
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
