package com.movibe.myapp;

import android.Manifest;
import android.app.Activity;
import android.app.RecoverableSecurityException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.os.StatFs;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "PhoneManager")
public class PhoneManagerPlugin extends Plugin {

    private static final String PREFS_NAME = "movibe_phone_manager_prefs";
    private static final String KEY_SAF_TREES = "saf_tree_uris";
    private static final String KEY_SAF_FILES = "saf_file_uris";
    private static final long DUPLICATE_MAX_FILE_BYTES = 350L * 1024L * 1024L;
    private static final int MAX_DIRECT_SCAN_FILES = 25000;
    private static final int MAX_DIRECT_SCAN_DEPTH = 10;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService pdfThumbExecutor = Executors.newFixedThreadPool(2);
    private ActivityResultLauncher<Intent> safTreeLauncher;
    private ActivityResultLauncher<Intent> safFilesLauncher;
    private ActivityResultLauncher<IntentSenderRequest> deleteConsentLauncher;
    private ActivityResultLauncher<Intent> allFilesAccessLauncher;
    private ActivityResultLauncher<String[]> legacyStoragePermLauncher;
    private String pendingSafCallId;
    private String pendingSafFilesCallId;
    private String pendingConsentCallId;
    private String pendingAllFilesCallId;
    private Runnable pendingConsentRetry;
    private Boolean lastKnownAllFilesGranted;

    @Override
    public void load() {
        lastKnownAllFilesGranted = hasAllFilesAccess();

        allFilesAccessLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall saved = pendingAllFilesCallId != null ? bridge.getSavedCall(pendingAllFilesCallId) : null;
                pendingAllFilesCallId = null;
                boolean granted = hasAllFilesAccess();
                emitAllFilesAccessChangeIfNeeded(granted);
                if (saved != null) {
                    JSObject res = buildAllFilesAccessPayload(granted, true, false);
                    saved.resolve(res);
                    bridge.releaseCall(saved);
                }
            }
        );

        legacyStoragePermLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            permissions -> {
                PluginCall saved = pendingAllFilesCallId != null ? bridge.getSavedCall(pendingAllFilesCallId) : null;
                pendingAllFilesCallId = null;
                boolean granted = hasAllFilesAccess();
                emitAllFilesAccessChangeIfNeeded(granted);
                if (saved != null) {
                    JSObject res = buildAllFilesAccessPayload(granted, false, false);
                    saved.resolve(res);
                    bridge.releaseCall(saved);
                }
            }
        );

        safTreeLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall saved = pendingSafCallId != null ? bridge.getSavedCall(pendingSafCallId) : null;
                pendingSafCallId = null;
                if (saved == null) return;

                Intent data = result != null ? result.getData() : null;
                Uri treeUri = (result != null && result.getResultCode() == Activity.RESULT_OK && data != null)
                    ? data.getData()
                    : null;
                if (treeUri == null) {
                    JSObject res = new JSObject();
                    res.put("granted", false);
                    res.put("cancelled", true);
                    saved.resolve(res);
                    bridge.releaseCall(saved);
                    return;
                }

                try {
                    int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    if (flags != 0) {
                        getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);
                    }
                } catch (Exception ignored) {}

                String label = treeUri.getLastPathSegment() != null ? treeUri.getLastPathSegment() : "Folder";
                saveSafTreeUri(treeUri.toString(), label);

                JSObject res = new JSObject();
                res.put("granted", true);
                res.put("treeUri", treeUri.toString());
                res.put("label", label);
                saved.resolve(res);
                bridge.releaseCall(saved);
            }
        );

        safFilesLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall saved = pendingSafFilesCallId != null ? bridge.getSavedCall(pendingSafFilesCallId) : null;
                pendingSafFilesCallId = null;
                if (saved == null) return;

                Intent data = result != null ? result.getData() : null;
                if (result == null || result.getResultCode() != Activity.RESULT_OK || data == null) {
                    JSObject res = new JSObject();
                    res.put("addedCount", 0);
                    res.put("cancelled", true);
                    saved.resolve(res);
                    bridge.releaseCall(saved);
                    return;
                }

                List<Uri> picked = new ArrayList<>();
                if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri u = clip.getItemAt(i).getUri();
                        if (u != null) picked.add(u);
                    }
                } else if (data.getData() != null) {
                    picked.add(data.getData());
                }

                int takeFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                if (takeFlags == 0) takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
                for (Uri u : picked) {
                    try {
                        getContext().getContentResolver().takePersistableUriPermission(u, takeFlags);
                    } catch (Exception ignored) {}
                    saveSafFileUri(u.toString());
                }

                JSObject res = new JSObject();
                res.put("addedCount", picked.size());
                saved.resolve(res);
                bridge.releaseCall(saved);
            }
        );

        deleteConsentLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall saved = pendingConsentCallId != null ? bridge.getSavedCall(pendingConsentCallId) : null;
                Runnable retry = pendingConsentRetry;
                pendingConsentCallId = null;
                pendingConsentRetry = null;

                if (result != null && result.getResultCode() == Activity.RESULT_OK && retry != null) {
                    executor.execute(retry);
                } else if (saved != null) {
                    JSObject res = new JSObject();
                    res.put("deletedCount", 0);
                    res.put("cancelled", true);
                    saved.resolve(res);
                    bridge.releaseCall(saved);
                }
            }
        );
    }

    private void saveSafTreeUri(String uriStr, String label) {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(prefs.getString(KEY_SAF_TREES, "[]"));
            JSONArray next = new JSONArray();
            JSONObject obj = new JSONObject();
            obj.put("uri", uriStr);
            obj.put("label", label);
            next.put(obj);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject existing = arr.optJSONObject(i);
                if (existing != null && !uriStr.equals(existing.optString("uri"))) {
                    next.put(existing);
                }
            }
            prefs.edit().putString(KEY_SAF_TREES, next.toString()).apply();
        } catch (Exception ignored) {}
    }

    private JSONArray getSavedSafTreeUris() {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            return new JSONArray(prefs.getString(KEY_SAF_TREES, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void saveSafFileUri(String uriStr) {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(prefs.getString(KEY_SAF_FILES, "[]"));
            JSONArray next = new JSONArray();
            next.put(uriStr);
            for (int i = 0; i < arr.length(); i++) {
                String existing = arr.optString(i, "");
                if (!existing.isEmpty() && !uriStr.equals(existing)) {
                    next.put(existing);
                }
            }
            prefs.edit().putString(KEY_SAF_FILES, next.toString()).apply();
        } catch (Exception ignored) {}
    }

    private JSONArray getSavedSafFileUris() {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            return new JSONArray(prefs.getString(KEY_SAF_FILES, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        emitAllFilesAccessChangeIfNeeded(hasAllFilesAccess());
    }

    private void emitAllFilesAccessChangeIfNeeded(boolean nowGranted) {
        if (lastKnownAllFilesGranted == null || lastKnownAllFilesGranted != nowGranted) {
            lastKnownAllFilesGranted = nowGranted;
            JSObject ev = new JSObject();
            ev.put("granted", nowGranted);
            ev.put("hasMediaRead", hasStorageReadPermission());
            ev.put("sdkInt", Build.VERSION.SDK_INT);
            notifyListeners("allFilesAccessChanged", ev, true);
        }
    }

    private JSObject buildAllFilesAccessPayload(boolean granted, boolean openedSettings, boolean alreadyGranted) {
        JSObject res = new JSObject();
        res.put("granted", granted);
        res.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R);
        res.put("hasMediaRead", hasStorageReadPermission());
        res.put("sdkInt", Build.VERSION.SDK_INT);
        res.put("openedSettings", openedSettings);
        res.put("alreadyGranted", alreadyGranted);
        return res;
    }

    private boolean hasAllFilesAccess() {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        boolean readOk = ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            boolean writeOk = ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            return readOk && writeOk;
        }
        return readOk;
    }

    private boolean hasStorageReadPermission() {
        if (hasAllFilesAccess()) {
            return true;
        }
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            boolean imgs = ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
            boolean vids = ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED;
            boolean aud = ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED;
            return imgs || vids || aud;
        }
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void getAllFilesAccessStatus(PluginCall call) {
        boolean granted = hasAllFilesAccess();
        lastKnownAllFilesGranted = granted;
        call.resolve(buildAllFilesAccessPayload(granted, false, false));
    }

    @PluginMethod
    public void requestAllFilesAccess(PluginCall call) {
        if (hasAllFilesAccess()) {
            call.resolve(buildAllFilesAccessPayload(true, false, true));
            return;
        }

        Activity activity = getActivity();
        Context ctx = getContext();
        if (activity == null) {
            call.resolve(buildAllFilesAccessPayload(false, false, false));
            return;
        }

        if (pendingAllFilesCallId != null) {
            PluginCall prev = bridge.getSavedCall(pendingAllFilesCallId);
            if (prev != null) {
                prev.resolve(buildAllFilesAccessPayload(hasAllFilesAccess(), false, false));
                bridge.releaseCall(prev);
            }
            pendingAllFilesCallId = null;
        }

        bridge.saveCall(call);
        pendingAllFilesCallId = call.getCallbackId();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.fromParts("package", ctx.getPackageName(), null)
                    );
                    allFilesAccessLauncher.launch(intent);
                } catch (Exception firstErr) {
                    try {
                        Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                        allFilesAccessLauncher.launch(fallback);
                    } catch (Exception secondErr) {
                        try {
                            Intent appDetails = new Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", ctx.getPackageName(), null)
                            );
                            allFilesAccessLauncher.launch(appDetails);
                        } catch (Exception thirdErr) {
                            PluginCall saved = pendingAllFilesCallId != null ? bridge.getSavedCall(pendingAllFilesCallId) : null;
                            pendingAllFilesCallId = null;
                            if (saved != null) {
                                saved.resolve(buildAllFilesAccessPayload(false, false, false));
                                bridge.releaseCall(saved);
                            }
                        }
                    }
                }
            });
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                    legacyStoragePermLauncher.launch(new String[] {
                        Manifest.permission.READ_EXTERNAL_STORAGE,
                        Manifest.permission.WRITE_EXTERNAL_STORAGE
                    });
                } else {
                    legacyStoragePermLauncher.launch(new String[] {
                        Manifest.permission.READ_EXTERNAL_STORAGE
                    });
                }
            } catch (Exception e) {
                PluginCall saved = pendingAllFilesCallId != null ? bridge.getSavedCall(pendingAllFilesCallId) : null;
                pendingAllFilesCallId = null;
                if (saved != null) {
                    saved.resolve(buildAllFilesAccessPayload(hasAllFilesAccess(), false, false));
                    bridge.releaseCall(saved);
                }
            }
        });
    }

    private List<File> getAccessibleVolumeRoots(Context ctx) {
        List<File> roots = new ArrayList<>();
        Set<String> seenCanonical = new HashSet<>();

        File primary = Environment.getExternalStorageDirectory();
        if (primary != null && primary.exists() && primary.isDirectory() && primary.canRead()) {
            try {
                String canon = primary.getCanonicalPath();
                if (seenCanonical.add(canon)) {
                    roots.add(primary);
                }
            } catch (Exception ignored) {}
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                StorageManager sm = (StorageManager) ctx.getSystemService(Context.STORAGE_SERVICE);
                if (sm != null) {
                    for (StorageVolume vol : sm.getStorageVolumes()) {
                        File dir = vol.getDirectory();
                        if (dir != null && dir.exists() && dir.isDirectory() && dir.canRead()) {
                            String canon = dir.getCanonicalPath();
                            if (seenCanonical.add(canon)) {
                                roots.add(dir);
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        try {
            File[] extAppDirs = ContextCompat.getExternalFilesDirs(ctx, null);
            if (extAppDirs != null) {
                for (File appDir : extAppDirs) {
                    if (appDir == null) continue;
                    String full = appDir.getAbsolutePath();
                    int androidIdx = full.indexOf("/Android/");
                    if (androidIdx <= 0) continue;
                    File volRoot = new File(full.substring(0, androidIdx));
                    if (volRoot.exists() && volRoot.isDirectory() && volRoot.canRead()) {
                        String canon = volRoot.getCanonicalPath();
                        if (seenCanonical.add(canon)) {
                            roots.add(volRoot);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        return roots;
    }

    private boolean shouldSkipScanDirectory(File dir) {
        if (dir == null) return true;
        String name = dir.getName();
        if (".thumbnails".equalsIgnoreCase(name)) return true;
        String norm = dir.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.US);
        // Never scan app-private data/obb directories or protected WhatsApp database/backup stores
        if (norm.endsWith("/android/data") || norm.contains("/android/data/")) return true;
        if (norm.endsWith("/android/obb") || norm.contains("/android/obb/")) return true;
        if (norm.endsWith("/whatsapp/databases") || norm.contains("/whatsapp/databases/")) return true;
        if (norm.endsWith("/whatsapp business/databases") || norm.contains("/whatsapp business/databases/")) return true;
        if (norm.endsWith("/whatsapp/backups") || norm.contains("/whatsapp/backups/")) return true;
        if (norm.endsWith("/whatsapp business/backups") || norm.contains("/whatsapp business/backups/")) return true;
        return false;
    }

    private boolean isWithinSharedStorageRoots(File target) {
        if (target == null) return false;
        try {
            String targetCanon = target.getCanonicalPath();
            for (File root : getAccessibleVolumeRoots(getContext())) {
                String rootCanon = root.getCanonicalPath();
                if (targetCanon.equals(rootCanon) || targetCanon.startsWith(rootCanon + File.separator)) {
                    return true;
                }
            }
            File appExt = getContext().getExternalFilesDir(null);
            if (appExt != null) {
                String appCanon = appExt.getCanonicalPath();
                if (targetCanon.equals(appCanon) || targetCanon.startsWith(appCanon + File.separator)) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    @PluginMethod
    public void getStorageSummary(PluginCall call) {
        executor.execute(() -> {
            try {
                Context ctx = getContext();
                ContentResolver resolver = ctx.getContentResolver();
                boolean allFilesGranted = hasAllFilesAccess();

                StatFs primaryStat = new StatFs(Environment.getDataDirectory().getPath());
                long totalBytes = primaryStat.getTotalBytes();
                long availableBytes = primaryStat.getAvailableBytes();

                List<File> volumeRoots = getAccessibleVolumeRoots(ctx);
                File primaryRoot = Environment.getExternalStorageDirectory();
                String primaryCanon = primaryRoot != null ? primaryRoot.getCanonicalPath() : "";
                Set<String> countedStatSignatures = new HashSet<>();
                countedStatSignatures.add(totalBytes + ":" + availableBytes);
                for (File volRoot : volumeRoots) {
                    try {
                        String volCanon = volRoot.getCanonicalPath();
                        if (volCanon.equals(primaryCanon)) continue;
                        StatFs extraStat = new StatFs(volRoot.getAbsolutePath());
                        long extraTotal = extraStat.getTotalBytes();
                        long extraAvail = extraStat.getAvailableBytes();
                        String sig = extraTotal + ":" + extraAvail;
                        if (extraTotal > 0L && countedStatSignatures.add(sig)) {
                            totalBytes += extraTotal;
                            availableBytes += extraAvail;
                        }
                    } catch (Exception ignored) {}
                }
                long usedBytes = Math.max(0L, totalBytes - availableBytes);

                long imgBytes = 0L; int imgCount = 0;
                long vidBytes = 0L; int vidCount = 0;
                long audBytes = 0L; int audCount = 0;
                long docBytes = 0L; int docCount = 0;
                long dlBytes = 0L; int dlCount = 0;
                long otherBytes = 0L; int otherCount = 0;

                List<JSObject> recentList = new ArrayList<>();
                Set<Long> countedIds = new HashSet<>();
                Set<String> countedCanonicalPaths = new HashSet<>();

                if (allFilesGranted) {
                    List<FileScanRecord> directRecords = new ArrayList<>();
                    Set<String> visitedDirs = new HashSet<>();
                    for (File volRoot : volumeRoots) {
                        scanSharedVolumeRecursive(
                            volRoot,
                            0,
                            MAX_DIRECT_SCAN_DEPTH,
                            directRecords,
                            countedCanonicalPaths,
                            visitedDirs,
                            MAX_DIRECT_SCAN_FILES,
                            false
                        );
                    }
                    Collections.sort(directRecords, (a, b) -> Long.compare(b.dateModified, a.dateModified));
                    for (FileScanRecord rec : directRecords) {
                        if ("images".equals(rec.category)) {
                            imgBytes += rec.size;
                            imgCount++;
                        } else if ("videos".equals(rec.category)) {
                            vidBytes += rec.size;
                            vidCount++;
                        } else if ("audio".equals(rec.category)) {
                            audBytes += rec.size;
                            audCount++;
                        } else if ("documents".equals(rec.category)) {
                            docBytes += rec.size;
                            docCount++;
                        } else if ("downloads".equals(rec.category)) {
                            dlBytes += rec.size;
                            dlCount++;
                        } else {
                            otherBytes += rec.size;
                            otherCount++;
                        }
                        if (recentList.size() < 24) {
                            recentList.add(buildMediaItemObj(
                                rec.id, rec.name, rec.uri, rec.path, rec.size, rec.dateModified, rec.mimeType, rec.category
                            ));
                        }
                    }
                }

                if (!allFilesGranted) {
                    // MediaStore fallback when All Files Access is not granted
                    // Images
                    try (Cursor c = resolver.query(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        new String[] { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.MIME_TYPE },
                        null, null, MediaStore.MediaColumns.DATE_MODIFIED + " DESC"
                    )) {
                        if (c != null) {
                            int idIdx = c.getColumnIndex(MediaStore.MediaColumns._ID);
                            int nameIdx = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                            int sizeIdx = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
                            int dateIdx = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED);
                            int mimeIdx = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
                            while (c.moveToNext()) {
                                long sz = sizeIdx >= 0 ? Math.max(0L, c.getLong(sizeIdx)) : 0L;
                                if (sz <= 0L) continue;
                                long id = idIdx >= 0 ? c.getLong(idIdx) : -1L;
                                if (id > 0) countedIds.add(id);
                                imgBytes += sz;
                                imgCount++;
                                if (recentList.size() < 20) {
                                    recentList.add(buildMediaItemObj(
                                        String.valueOf(id),
                                        nameIdx >= 0 ? c.getString(nameIdx) : "Image",
                                        ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString(),
                                        "",
                                        sz,
                                        (dateIdx >= 0 ? c.getLong(dateIdx) * 1000L : 0L),
                                        mimeIdx >= 0 ? c.getString(mimeIdx) : "image/*",
                                        "images"
                                    ));
                                }
                            }
                        }
                    } catch (Exception ignored) {}

                    // Videos
                    try (Cursor c = resolver.query(
                        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                        new String[] { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.MIME_TYPE },
                        null, null, MediaStore.MediaColumns.DATE_MODIFIED + " DESC"
                    )) {
                        if (c != null) {
                            int idIdx = c.getColumnIndex(MediaStore.MediaColumns._ID);
                            int nameIdx = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                            int sizeIdx = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
                            int dateIdx = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED);
                            int mimeIdx = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
                            while (c.moveToNext()) {
                                long sz = sizeIdx >= 0 ? Math.max(0L, c.getLong(sizeIdx)) : 0L;
                                if (sz <= 0L) continue;
                                long id = idIdx >= 0 ? c.getLong(idIdx) : -1L;
                                if (id > 0) countedIds.add(id);
                                vidBytes += sz;
                                vidCount++;
                                if (recentList.size() < 30) {
                                    recentList.add(buildMediaItemObj(
                                        String.valueOf(id),
                                        nameIdx >= 0 ? c.getString(nameIdx) : "Video",
                                        ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id).toString(),
                                        "",
                                        sz,
                                        (dateIdx >= 0 ? c.getLong(dateIdx) * 1000L : 0L),
                                        mimeIdx >= 0 ? c.getString(mimeIdx) : "video/*",
                                        "videos"
                                    ));
                                }
                            }
                        }
                    } catch (Exception ignored) {}

                    // Audio
                    try (Cursor c = resolver.query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        new String[] { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.MIME_TYPE },
                        null, null, MediaStore.MediaColumns.DATE_MODIFIED + " DESC"
                    )) {
                        if (c != null) {
                            int idIdx = c.getColumnIndex(MediaStore.MediaColumns._ID);
                            int nameIdx = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                            int sizeIdx = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
                            int dateIdx = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED);
                            int mimeIdx = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
                            while (c.moveToNext()) {
                                long sz = sizeIdx >= 0 ? Math.max(0L, c.getLong(sizeIdx)) : 0L;
                                if (sz <= 0L) continue;
                                long id = idIdx >= 0 ? c.getLong(idIdx) : -1L;
                                if (id > 0) countedIds.add(id);
                                audBytes += sz;
                                audCount++;
                                if (recentList.size() < 40) {
                                    recentList.add(buildMediaItemObj(
                                        String.valueOf(id),
                                        nameIdx >= 0 ? c.getString(nameIdx) : "Audio",
                                        ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id).toString(),
                                        "",
                                        sz,
                                        (dateIdx >= 0 ? c.getLong(dateIdx) * 1000L : 0L),
                                        mimeIdx >= 0 ? c.getString(mimeIdx) : "audio/*",
                                        "audio"
                                    ));
                                }
                            }
                        }
                    } catch (Exception ignored) {}

                    // Documents, Downloads & Other accessible files via MediaStore.Files
                    try {
                        Uri filesUri = MediaStore.Files.getContentUri("external");
                        List<String> cols = new ArrayList<>(Arrays.asList(
                            MediaStore.Files.FileColumns._ID,
                            MediaStore.Files.FileColumns.DISPLAY_NAME,
                            MediaStore.Files.FileColumns.SIZE,
                            MediaStore.Files.FileColumns.DATE_MODIFIED,
                            MediaStore.Files.FileColumns.MIME_TYPE,
                            MediaStore.Files.FileColumns.DATA
                        ));
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            cols.add(MediaStore.MediaColumns.RELATIVE_PATH);
                        }
                        try (Cursor c = resolver.query(
                            filesUri,
                            cols.toArray(new String[0]),
                            MediaStore.Files.FileColumns.SIZE + " > 0",
                            null,
                            MediaStore.Files.FileColumns.DATE_MODIFIED + " DESC"
                        )) {
                            if (c != null) {
                                int idIdx = c.getColumnIndex(MediaStore.Files.FileColumns._ID);
                                int nameIdx = c.getColumnIndex(MediaStore.Files.FileColumns.DISPLAY_NAME);
                                int sizeIdx = c.getColumnIndex(MediaStore.Files.FileColumns.SIZE);
                                int dateIdx = c.getColumnIndex(MediaStore.Files.FileColumns.DATE_MODIFIED);
                                int mimeIdx = c.getColumnIndex(MediaStore.Files.FileColumns.MIME_TYPE);
                                int dataIdx = c.getColumnIndex(MediaStore.Files.FileColumns.DATA);
                                int relIdx = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                                    ? c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
                                    : -1;

                                while (c.moveToNext()) {
                                    long id = idIdx >= 0 ? c.getLong(idIdx) : -1L;
                                    if (id > 0 && countedIds.contains(id)) continue;
                                    long sz = sizeIdx >= 0 ? Math.max(0L, c.getLong(sizeIdx)) : 0L;
                                    if (sz <= 0L) continue;
                                    String name = nameIdx >= 0 ? c.getString(nameIdx) : "";
                                    String mime = mimeIdx >= 0 ? c.getString(mimeIdx) : "";
                                    String dataPath = dataIdx >= 0 ? c.getString(dataIdx) : "";
                                    String relPath = relIdx >= 0 ? c.getString(relIdx) : "";
                                    String folderLower = ((relPath != null ? relPath : "") + " " + (dataPath != null ? dataPath : "")).toLowerCase(Locale.US);
                                    String cat = classifyFileCategory(name, mime, folderLower);
                                    if ("downloads".equals(cat)) {
                                        dlBytes += sz;
                                        dlCount++;
                                    } else if ("documents".equals(cat)) {
                                        docBytes += sz;
                                        docCount++;
                                    } else if ("images".equals(cat)) {
                                        imgBytes += sz;
                                        imgCount++;
                                    } else if ("videos".equals(cat)) {
                                        vidBytes += sz;
                                        vidCount++;
                                    } else if ("audio".equals(cat)) {
                                        audBytes += sz;
                                        audCount++;
                                    } else {
                                        otherBytes += sz;
                                        otherCount++;
                                    }
                                    if (recentList.size() < 50 && name != null && !name.isEmpty()) {
                                        Uri itemUri = ContentUris.withAppendedId(filesUri, id);
                                        recentList.add(buildMediaItemObj(
                                            String.valueOf(id),
                                            name,
                                            itemUri.toString(),
                                            relPath != null && !relPath.isEmpty() ? relPath : (dataPath != null ? dataPath : ""),
                                            sz,
                                            (dateIdx >= 0 ? c.getLong(dateIdx) * 1000L : 0L),
                                            mime != null ? mime : "application/octet-stream",
                                            cat
                                        ));
                                    }
                                }
                            }
                        }
                    } catch (Exception ignored) {}
                }

                // Sort recent files by date desc and cap at 12
                Collections.sort(recentList, (a, b) -> Long.compare(
                    b.optLong("dateModified", 0L),
                    a.optLong("dateModified", 0L)
                ));
                JSArray recentArr = new JSArray();
                for (int i = 0; i < Math.min(12, recentList.size()); i++) {
                    recentArr.put(recentList.get(i));
                }

                JSObject categories = new JSObject();
                categories.put("images", makeCategoryObj(imgBytes, imgCount));
                categories.put("videos", makeCategoryObj(vidBytes, vidCount));
                categories.put("audio", makeCategoryObj(audBytes, audCount));
                categories.put("documents", makeCategoryObj(docBytes, docCount));
                categories.put("downloads", makeCategoryObj(dlBytes, dlCount));
                categories.put("other", makeCategoryObj(otherBytes, otherCount));

                JSArray safArr = new JSArray();
                JSONArray savedSaf = getSavedSafTreeUris();
                for (int i = 0; i < savedSaf.length(); i++) {
                    JSONObject o = savedSaf.optJSONObject(i);
                    if (o != null) {
                        JSObject entry = new JSObject();
                        entry.put("uri", o.optString("uri"));
                        entry.put("label", o.optString("label"));
                        safArr.put(entry);
                    }
                }

                JSObject res = new JSObject();
                res.put("totalBytes", totalBytes);
                res.put("availableBytes", availableBytes);
                res.put("usedBytes", usedBytes);
                res.put("hasStoragePermission", hasStorageReadPermission());
                res.put("hasAllFilesAccess", allFilesGranted);
                res.put("sdkInt", Build.VERSION.SDK_INT);
                res.put("categories", categories);
                res.put("recentFiles", recentArr);
                res.put("safTrees", safArr);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not read storage summary: " + e.getMessage(), e);
            }
        });
    }

    private JSObject makeCategoryObj(long bytes, int count) {
        JSObject obj = new JSObject();
        obj.put("bytes", bytes);
        obj.put("count", count);
        return obj;
    }

    private JSObject buildMediaItemObj(
        String id, String name, String uri, String path,
        long size, long dateModified, String mimeType, String category
    ) {
        JSObject item = new JSObject();
        item.put("id", id);
        item.put("name", name != null ? name : "File");
        item.put("uri", uri);
        item.put("path", path != null ? path : "");
        item.put("size", size);
        item.put("dateModified", dateModified);
        item.put("mimeType", mimeType != null ? mimeType : "application/octet-stream");
        item.put("category", category);
        return item;
    }

    private String classifyFileCategory(String name, String mime, String folderLower) {
        String lowerName = name != null ? name.toLowerCase(Locale.US) : "";
        String lowerMime = mime != null ? mime.toLowerCase(Locale.US) : "";
        if (lowerMime.startsWith("image/") || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png") || lowerName.endsWith(".webp") || lowerName.endsWith(".heic") || lowerName.endsWith(".gif")) {
            return "images";
        }
        if (lowerMime.startsWith("video/") || lowerName.endsWith(".mp4") || lowerName.endsWith(".mkv") || lowerName.endsWith(".mov") || lowerName.endsWith(".webm") || lowerName.endsWith(".3gp") || lowerName.endsWith(".avi")) {
            return "videos";
        }
        if (lowerMime.startsWith("audio/") || lowerName.endsWith(".mp3") || lowerName.endsWith(".wav") || lowerName.endsWith(".m4a") || lowerName.endsWith(".flac") || lowerName.endsWith(".aac") || lowerName.endsWith(".ogg") || lowerName.endsWith(".opus")) {
            return "audio";
        }
        if (lowerMime.contains("pdf") || lowerMime.contains("word") || lowerMime.contains("text") || lowerMime.contains("spreadsheet") || lowerMime.contains("presentation") || lowerMime.contains("opendocument") || lowerMime.contains("ms-excel") || lowerMime.contains("ms-powerpoint") || lowerMime.contains("msword") || lowerMime.contains("epub")
            || lowerName.endsWith(".pdf") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx") || lowerName.endsWith(".txt") || lowerName.endsWith(".csv") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx") || lowerName.endsWith(".rtf") || lowerName.endsWith(".odt") || lowerName.endsWith(".ods") || lowerName.endsWith(".odp") || lowerName.endsWith(".epub") || lowerName.endsWith(".md") || lowerName.endsWith(".json") || lowerName.endsWith(".xml")) {
            return "documents";
        }
        if (folderLower.contains("/download") || folderLower.contains("download/")) {
            return "downloads";
        }
        return "other";
    }

    private static class FileScanRecord {
        String id;
        String name;
        String uri;
        String path;
        long size;
        long dateModified;
        String mimeType;
        String category;
    }

    private List<FileScanRecord> collectAccessibleMediaRecords() {
        List<FileScanRecord> list = new ArrayList<>();
        Set<String> seenUris = new HashSet<>();
        Set<String> seenCanonicalPaths = new HashSet<>();
        Context ctx = getContext();
        ContentResolver resolver = ctx.getContentResolver();
        boolean allFilesGranted = hasAllFilesAccess();

        if (allFilesGranted) {
            Set<String> visitedDirs = new HashSet<>();
            for (File volRoot : getAccessibleVolumeRoots(ctx)) {
                scanSharedVolumeRecursive(
                    volRoot,
                    0,
                    MAX_DIRECT_SCAN_DEPTH,
                    list,
                    seenCanonicalPaths,
                    visitedDirs,
                    MAX_DIRECT_SCAN_FILES,
                    false
                );
            }
            for (FileScanRecord rec : list) {
                if (rec.uri != null) seenUris.add(rec.uri);
            }
        }

        List<Uri> collectionList = new ArrayList<>(Arrays.asList(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            MediaStore.Files.getContentUri("external")
        ));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            collectionList.add(MediaStore.Downloads.EXTERNAL_CONTENT_URI);
        }
        Uri[] collections = collectionList.toArray(new Uri[0]);

        for (int cIdx = 0; cIdx < collections.length; cIdx++) {
            Uri col = collections[cIdx];
            List<String> proj = new ArrayList<>(Arrays.asList(
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.DATE_MODIFIED,
                MediaStore.MediaColumns.MIME_TYPE,
                MediaStore.MediaColumns.DATA
            ));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                proj.add(MediaStore.MediaColumns.RELATIVE_PATH);
            }
            try (Cursor c = resolver.query(col, proj.toArray(new String[0]), MediaStore.MediaColumns.SIZE + " > 0", null, MediaStore.MediaColumns.SIZE + " DESC")) {
                if (c == null) continue;
                int idCol = c.getColumnIndex(MediaStore.MediaColumns._ID);
                int nameCol = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                int sizeCol = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
                int dateCol = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED);
                int mimeCol = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
                int dataCol = c.getColumnIndex(MediaStore.MediaColumns.DATA);
                int relCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH) : -1;

                while (c.moveToNext()) {
                    long id = idCol >= 0 ? c.getLong(idCol) : -1L;
                    long sz = sizeCol >= 0 ? c.getLong(sizeCol) : 0L;
                    if (id <= 0 || sz <= 0L) continue;
                    Uri itemUri = ContentUris.withAppendedId(col, id);
                    String uriStr = itemUri.toString();
                    String name = nameCol >= 0 ? c.getString(nameCol) : "";
                    if (name == null || name.isEmpty()) continue;

                    String dataPath = dataCol >= 0 ? c.getString(dataCol) : "";
                    String relPath = relCol >= 0 ? c.getString(relCol) : "";
                    if (isRestrictedScanPath(dataPath) || isRestrictedScanPath(relPath)) continue;

                    String canonKey = null;
                    if (dataPath != null && !dataPath.isEmpty()) {
                        try {
                            canonKey = new File(dataPath).getCanonicalPath();
                        } catch (Exception e) {
                            canonKey = dataPath;
                        }
                    }

                    if (seenUris.contains(uriStr)) continue;
                    if (canonKey != null && seenCanonicalPaths.contains(canonKey)) continue;
                    seenUris.add(uriStr);
                    if (canonKey != null) seenCanonicalPaths.add(canonKey);

                    String mime = mimeCol >= 0 ? c.getString(mimeCol) : "";
                    String folderLower = ((relPath != null ? relPath : "") + " " + (dataPath != null ? dataPath : "")).toLowerCase(Locale.US);
                    String cat = cIdx == 0 ? "images" : cIdx == 1 ? "videos" : cIdx == 2 ? "audio" : classifyFileCategory(name, mime, folderLower);

                    FileScanRecord rec = new FileScanRecord();
                    rec.id = cIdx + "-" + id;
                    rec.name = name;
                    rec.uri = uriStr;
                    rec.path = (dataPath != null && !dataPath.isEmpty()) ? dataPath : ((relPath != null && !relPath.isEmpty()) ? relPath : "");
                    rec.size = sz;
                    rec.dateModified = dateCol >= 0 ? c.getLong(dateCol) * 1000L : 0L;
                    rec.mimeType = mime != null ? mime : "application/octet-stream";
                    rec.category = cat;
                    list.add(rec);
                }
            } catch (Exception ignored) {}
        }

        // Scan readable public Documents & Downloads directories directly when direct full scan wasn't run
        if (!allFilesGranted) {
            File docsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
            if (docsDir != null && docsDir.exists() && docsDir.isDirectory() && docsDir.canRead()) {
                scanDirFilesRecursive(docsDir, 0, 3, list, seenCanonicalPaths, false);
            }
            File dlDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (dlDir != null && dlDir.exists() && dlDir.isDirectory() && dlDir.canRead()) {
                scanDirFilesRecursive(dlDir, 0, 2, list, seenCanonicalPaths, false);
            }
        }

        // Include persisted SAF trees granted by user as fallback for restricted folders
        JSONArray safArr = getSavedSafTreeUris();
        for (int i = 0; i < safArr.length(); i++) {
            JSONObject obj = safArr.optJSONObject(i);
            if (obj == null) continue;
            String treeStr = obj.optString("uri", "");
            if (!treeStr.isEmpty()) {
                scanSafTreeRecursive(Uri.parse(treeStr), null, 0, 4, list, seenUris, seenCanonicalPaths, false);
            }
        }

        // Include individually picked persisted SAF document URIs
        JSONArray safFiles = getSavedSafFileUris();
        for (int i = 0; i < safFiles.length(); i++) {
            String fileUriStr = safFiles.optString(i, "");
            if (fileUriStr.isEmpty() || seenUris.contains(fileUriStr)) continue;
            Uri fileUri = Uri.parse(fileUriStr);
            try (Cursor fc = resolver.query(
                fileUri,
                new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
                null, null, null
            )) {
                if (fc != null && fc.moveToFirst()) {
                    String name = fc.getString(0);
                    long sz = fc.isNull(1) ? 0L : fc.getLong(1);
                    if (name != null && !name.isEmpty()) {
                        seenUris.add(fileUriStr);
                        String mime = resolver.getType(fileUri);
                        if (mime == null || mime.isEmpty()) mime = guessMimeFromName(name);
                        FileScanRecord rec = new FileScanRecord();
                        rec.id = "saf-doc-" + fileUriStr.hashCode();
                        rec.name = name;
                        rec.uri = fileUriStr;
                        String decodedUriPath = Uri.decode(fileUriStr);
                        rec.path = decodedUriPath != null ? decodedUriPath : "Picked Document";
                        rec.size = Math.max(0L, sz);
                        rec.dateModified = getSafDocLastModified(resolver, fileUri);
                        rec.mimeType = mime;
                        rec.category = classifyFileCategory(name, mime, "documents");
                        list.add(rec);
                    }
                }
            } catch (Exception ignored) {}
        }

        return list;
    }

    private long getSafDocLastModified(ContentResolver resolver, Uri uri) {
        try (Cursor c = resolver.query(uri, new String[] { DocumentsContract.Document.COLUMN_LAST_MODIFIED }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) {
                return c.getLong(0);
            }
        } catch (Exception ignored) {}
        return 0L;
    }

    @PluginMethod
    public void findDuplicates(PluginCall call) {
        executor.execute(() -> {
            try {
                List<FileScanRecord> all = collectAccessibleMediaRecords();
                Map<Long, List<FileScanRecord>> bySize = new HashMap<>();
                for (FileScanRecord rec : all) {
                    if (rec.size > DUPLICATE_MAX_FILE_BYTES) continue;
                    bySize.computeIfAbsent(rec.size, k -> new ArrayList<>()).add(rec);
                }

                ContentResolver resolver = getContext().getContentResolver();
                Map<String, List<FileScanRecord>> byHash = new LinkedHashMap<>();

                for (Map.Entry<Long, List<FileScanRecord>> entry : bySize.entrySet()) {
                    if (entry.getValue().size() < 2) continue;
                    for (FileScanRecord rec : entry.getValue()) {
                        String hash = computeSha256(resolver, Uri.parse(rec.uri));
                        if (hash == null) continue;
                        String key = rec.size + ":" + hash;
                        byHash.computeIfAbsent(key, k -> new ArrayList<>()).add(rec);
                    }
                }

                JSArray groups = new JSArray();
                long potentialSavings = 0L;
                for (Map.Entry<String, List<FileScanRecord>> entry : byHash.entrySet()) {
                    List<FileScanRecord> dupes = entry.getValue();
                    if (dupes.size() < 2) continue;
                    // Sort oldest first so first copy is preserved by default
                    Collections.sort(dupes, (a, b) -> Long.compare(a.dateModified, b.dateModified));

                    String[] parts = entry.getKey().split(":", 2);
                    String sha = parts.length > 1 ? parts[1] : "";
                    long wasted = dupes.get(0).size * (dupes.size() - 1L);
                    potentialSavings += wasted;

                    JSArray filesArr = new JSArray();
                    for (FileScanRecord d : dupes) {
                        filesArr.put(buildMediaItemObj(d.id, d.name, d.uri, d.path, d.size, d.dateModified, d.mimeType, d.category));
                    }
                    JSObject grp = new JSObject();
                    grp.put("hash", sha);
                    grp.put("size", dupes.get(0).size);
                    grp.put("category", dupes.get(0).category);
                    grp.put("wastedBytes", wasted);
                    grp.put("files", filesArr);
                    groups.put(grp);
                }

                JSObject res = new JSObject();
                res.put("groups", groups);
                res.put("totalWastedBytes", potentialSavings);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Duplicate scan failed: " + e.getMessage(), e);
            }
        });
    }

    private String computeSha256(ContentResolver resolver, Uri uri) {
        try (InputStream in = openAnyUriStream(resolver, uri)) {
            if (in == null) return null;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) {
                md.update(buf, 0, n);
            }
            byte[] digest = md.digest();
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format(Locale.US, "%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void findLargeFiles(PluginCall call) {
        Double minMbObj = call.getDouble("minSizeBytes", 10.0 * 1024.0 * 1024.0);
        long minBytes = minMbObj != null ? Math.max(0L, Math.round(minMbObj)) : (10L * 1024L * 1024L);
        String filterCat = call.getString("category", "all");

        executor.execute(() -> {
            try {
                List<FileScanRecord> all = collectAccessibleMediaRecords();
                List<FileScanRecord> matched = new ArrayList<>();
                for (FileScanRecord rec : all) {
                    if (rec.size < minBytes) continue;
                    if (!"all".equals(filterCat) && !filterCat.equals(rec.category)) continue;
                    matched.add(rec);
                }
                if (minBytes <= 0L) {
                    Collections.sort(matched, (a, b) -> Long.compare(b.dateModified, a.dateModified));
                } else {
                    Collections.sort(matched, (a, b) -> Long.compare(b.size, a.size));
                }
                int maxItems = minBytes <= 0L ? 1000 : 300;
                JSArray arr = new JSArray();
                long totalBytes = 0L;
                for (int i = 0; i < Math.min(maxItems, matched.size()); i++) {
                    FileScanRecord r = matched.get(i);
                    totalBytes += r.size;
                    arr.put(buildMediaItemObj(r.id, r.name, r.uri, r.path, r.size, r.dateModified, r.mimeType, r.category));
                }
                JSObject res = new JSObject();
                res.put("files", arr);
                res.put("totalBytes", totalBytes);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Large file scan failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void searchFiles(PluginCall call) {
        String rawQuery = call.getString("query", "");
        String queryLower = rawQuery != null ? rawQuery.trim().toLowerCase(Locale.US) : "";
        String category = call.getString("category", "all");
        int maxResults = Math.max(10, Math.min(500, call.getInt("maxResults", 250)));

        if (queryLower.isEmpty()) {
            JSObject empty = new JSObject();
            empty.put("files", new JSArray());
            empty.put("totalMatched", 0);
            call.resolve(empty);
            return;
        }

        executor.execute(() -> {
            try {
                List<FileScanRecord> all = collectAccessibleMediaRecords();
                List<FileScanRecord> matched = new ArrayList<>();
                for (FileScanRecord rec : all) {
                    if (category != null && !"all".equals(category) && !category.equals(rec.category)) continue;
                    String nameLower = rec.name != null ? rec.name.toLowerCase(Locale.US) : "";
                    String pathLower = rec.path != null ? rec.path.toLowerCase(Locale.US) : "";
                    if (nameLower.contains(queryLower) || pathLower.contains(queryLower)) {
                        matched.add(rec);
                    }
                }
                Collections.sort(matched, (a, b) -> {
                    String aName = a.name != null ? a.name.toLowerCase(Locale.US) : "";
                    String bName = b.name != null ? b.name.toLowerCase(Locale.US) : "";
                    boolean aStarts = aName.startsWith(queryLower);
                    boolean bStarts = bName.startsWith(queryLower);
                    if (aStarts != bStarts) return aStarts ? -1 : 1;
                    boolean aContains = aName.contains(queryLower);
                    boolean bContains = bName.contains(queryLower);
                    if (aContains != bContains) return aContains ? -1 : 1;
                    return Long.compare(b.dateModified, a.dateModified);
                });

                JSArray arr = new JSArray();
                for (int i = 0; i < Math.min(maxResults, matched.size()); i++) {
                    FileScanRecord r = matched.get(i);
                    arr.put(buildMediaItemObj(r.id, r.name, r.uri, r.path, r.size, r.dateModified, r.mimeType, r.category));
                }
                JSObject res = new JSObject();
                res.put("files", arr);
                res.put("totalMatched", matched.size());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("File search failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void scanWhatsAppMedia(PluginCall call) {
        executor.execute(() -> {
            try {
                List<FileScanRecord> found = new ArrayList<>();
                Set<String> seenUris = new HashSet<>();
                Set<String> seenPaths = new HashSet<>();

                // 1) Accessible MediaStore / shared storage WhatsApp entries (excluding Databases/Backups)
                List<FileScanRecord> all = collectAccessibleMediaRecords();
                for (FileScanRecord rec : all) {
                    String lowerPath = (rec.path + " " + rec.name).toLowerCase(Locale.US);
                    if (isRestrictedScanPath(rec.path)) continue;
                    if (lowerPath.contains("whatsapp")) {
                        String canon = toCanonicalKey(rec.path);
                        if (seenUris.contains(rec.uri) || (canon != null && seenPaths.contains(canon))) continue;
                        seenUris.add(rec.uri);
                        if (canon != null) seenPaths.add(canon);
                        rec.category = classifyWhatsAppSubcategory(rec);
                        found.add(rec);
                    }
                }

                // 2) Direct WhatsApp Media paths across internal & SD card volumes when permitted
                String[] relWaRoots = new String[] {
                    "WhatsApp/Media",
                    "WhatsApp Business/Media",
                    "Android/media/com.whatsapp/WhatsApp/Media",
                    "Android/media/com.whatsapp.w4b/WhatsApp Business/Media"
                };
                for (File volRoot : getAccessibleVolumeRoots(getContext())) {
                    for (String relRoot : relWaRoots) {
                        File dir = new File(volRoot, relRoot);
                        if (dir.exists() && dir.isDirectory() && dir.canRead() && !shouldSkipScanDirectory(dir)) {
                            scanDirFilesRecursive(dir, 0, 5, found, seenPaths, true);
                        }
                    }
                }

                // 3) User-granted SAF tree URIs that appear to be WhatsApp folders or Android/media fallback
                JSONArray safArr = getSavedSafTreeUris();
                for (int i = 0; i < safArr.length(); i++) {
                    JSONObject obj = safArr.optJSONObject(i);
                    if (obj == null) continue;
                    String treeStr = obj.optString("uri", "");
                    String treeLower = treeStr.toLowerCase(Locale.US);
                    String labelLower = obj.optString("label", "").toLowerCase(Locale.US);
                    if (treeLower.contains("whatsapp") || labelLower.contains("whatsapp")
                        || treeLower.contains("android%2fmedia") || treeLower.contains("android/media") || labelLower.contains("media")) {
                        scanSafTreeRecursive(Uri.parse(treeStr), null, 0, 5, found, seenUris, seenPaths, true);
                    }
                }

                Collections.sort(found, (a, b) -> Long.compare(b.dateModified, a.dateModified));

                long totalBytes = 0L;
                JSArray arr = new JSArray();
                for (FileScanRecord rec : found) {
                    totalBytes += rec.size;
                    arr.put(buildMediaItemObj(rec.id, rec.name, rec.uri, rec.path, rec.size, rec.dateModified, rec.mimeType, rec.category));
                }

                JSObject res = new JSObject();
                res.put("files", arr);
                res.put("totalBytes", totalBytes);
                res.put("requiresSafHint", found.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("WhatsApp media scan failed: " + e.getMessage(), e);
            }
        });
    }

    private String classifyWhatsAppSubcategory(FileScanRecord rec) {
        String p = (rec.path + "/" + rec.name).toLowerCase(Locale.US);
        if (p.contains("/sent") || p.contains("sent/") || p.contains("forwarded")) return "forwarded";
        if (p.contains("voice note") || rec.name.toLowerCase(Locale.US).endsWith(".opus") || p.contains("ptt")) return "voice_notes";
        if (rec.mimeType.startsWith("image/") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".png") || p.endsWith(".webp")) return "images";
        if (rec.mimeType.startsWith("video/") || p.endsWith(".mp4") || p.endsWith(".3gp")) return "videos";
        return "documents";
    }

    @PluginMethod
    public void scanDownloads(PluginCall call) {
        executor.execute(() -> {
            try {
                List<FileScanRecord> all = collectAccessibleMediaRecords();
                List<FileScanRecord> downloads = new ArrayList<>();
                Set<String> seen = new HashSet<>();

                for (FileScanRecord rec : all) {
                    String pLower = rec.path != null ? rec.path.toLowerCase(Locale.US) : "";
                    String uLower = rec.uri != null ? Uri.decode(rec.uri).toLowerCase(Locale.US) : "";
                    if (pLower.contains("/download") || pLower.startsWith("download") || uLower.contains("download")) {
                        String canon = toCanonicalKey(rec.path);
                        if (canon != null) {
                            if (seen.contains(canon)) continue;
                            seen.add(canon);
                        }
                        if (seen.contains(rec.uri)) continue;
                        seen.add(rec.uri);
                        rec.category = classifyDownloadKind(rec.name, rec.mimeType, rec.dateModified);
                        downloads.add(rec);
                    }
                }

                int maxDepth = hasAllFilesAccess() ? 6 : 2;
                Set<File> dlCandidates = new LinkedHashSet<>();
                File primaryDl = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (primaryDl != null) dlCandidates.add(primaryDl);
                for (File volRoot : getAccessibleVolumeRoots(getContext())) {
                    dlCandidates.add(new File(volRoot, Environment.DIRECTORY_DOWNLOADS));
                }
                for (File dlDir : dlCandidates) {
                    if (dlDir != null && dlDir.exists() && dlDir.isDirectory() && dlDir.canRead()) {
                        List<FileScanRecord> rawDl = new ArrayList<>();
                        scanDirFilesRecursive(dlDir, 0, maxDepth, rawDl, seen, false);
                        for (FileScanRecord r : rawDl) {
                            r.category = classifyDownloadKind(r.name, r.mimeType, r.dateModified);
                            downloads.add(r);
                        }
                    }
                }

                Collections.sort(downloads, (a, b) -> Long.compare(b.dateModified, a.dateModified));

                long totalBytes = 0L;
                JSArray arr = new JSArray();
                for (FileScanRecord r : downloads) {
                    totalBytes += r.size;
                    arr.put(buildMediaItemObj(r.id, r.name, r.uri, r.path, r.size, r.dateModified, r.mimeType, r.category));
                }
                JSObject res = new JSObject();
                res.put("files", arr);
                res.put("totalBytes", totalBytes);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Downloads scan failed: " + e.getMessage(), e);
            }
        });
    }

    private String classifyDownloadKind(String name, String mime, long dateModifiedMs) {
        String lower = name != null ? name.toLowerCase(Locale.US) : "";
        if (lower.endsWith(".apk") || lower.endsWith(".apks") || lower.endsWith(".xapk")) return "apk";
        if (lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z") || lower.endsWith(".tar") || lower.endsWith(".gz")) return "archive";
        if (lower.endsWith(".pdf") || (mime != null && mime.toLowerCase(Locale.US).contains("pdf"))) return "pdf";
        long thirtyDaysAgo = System.currentTimeMillis() - (30L * 24L * 60L * 60L * 1000L);
        if (dateModifiedMs > 0 && dateModifiedMs < thirtyDaysAgo) return "old";
        return "other";
    }

    @PluginMethod
    public void compressImage(PluginCall call) {
        String uriStr = call.getString("uri", "");
        int quality = Math.max(10, Math.min(98, call.getInt("quality", 78)));
        int maxDimension = Math.max(0, call.getInt("maxDimension", 1920));
        boolean overwriteOriginal = Boolean.TRUE.equals(call.getBoolean("overwriteOriginal", false));

        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing image URI.");
            return;
        }

        executor.execute(() -> {
            try {
                Context ctx = getContext();
                ContentResolver resolver = ctx.getContentResolver();
                Uri srcUri = Uri.parse(uriStr);

                long originalSize = getUriByteSize(resolver, srcUri);
                String srcName = getUriDisplayName(resolver, srcUri, "photo.jpg");
                String baseName = srcName.replaceAll("\\.[^/.]+$", "");
                String outFileName = baseName + "_compressed.jpg";

                BitmapFactory.Options boundsOpts = new BitmapFactory.Options();
                boundsOpts.inJustDecodeBounds = true;
                try (InputStream in1 = openAnyUriStream(resolver, srcUri)) {
                    if (in1 == null) throw new IllegalStateException("Cannot read image file.");
                    BitmapFactory.decodeStream(in1, null, boundsOpts);
                }

                int srcW = Math.max(1, boundsOpts.outWidth);
                int srcH = Math.max(1, boundsOpts.outHeight);
                int sampleSize = 1;
                if (maxDimension > 0) {
                    int maxSide = Math.max(srcW, srcH);
                    while ((maxSide / sampleSize) > maxDimension * 2) {
                        sampleSize *= 2;
                    }
                }

                BitmapFactory.Options decOpts = new BitmapFactory.Options();
                decOpts.inSampleSize = sampleSize;
                Bitmap bitmap;
                try (InputStream in2 = openAnyUriStream(resolver, srcUri)) {
                    if (in2 == null) throw new IllegalStateException("Cannot decode image stream.");
                    bitmap = BitmapFactory.decodeStream(in2, null, decOpts);
                }
                if (bitmap == null) {
                    throw new IllegalStateException("Unsupported or corrupted image file.");
                }

                Bitmap scaled = bitmap;
                int bw = bitmap.getWidth();
                int bh = bitmap.getHeight();
                if (maxDimension > 0 && Math.max(bw, bh) > maxDimension) {
                    double ratio = (double) maxDimension / (double) Math.max(bw, bh);
                    int nw = Math.max(1, (int) Math.round(bw * ratio));
                    int nh = Math.max(1, (int) Math.round(bh * ratio));
                    scaled = Bitmap.createScaledBitmap(bitmap, nw, nh, true);
                    if (scaled != bitmap) {
                        bitmap.recycle();
                    }
                }

                File tempOut = File.createTempFile("movibe_img_", ".jpg", ctx.getCacheDir());
                try {
                    try (FileOutputStream fos = new FileOutputStream(tempOut)) {
                        scaled.compress(Bitmap.CompressFormat.JPEG, quality, fos);
                        fos.flush();
                    }
                    int outW = scaled.getWidth();
                    int outH = scaled.getHeight();
                    scaled.recycle();

                    Uri savedUri;
                    String displayPath;
                    if (overwriteOriginal && "content".equals(srcUri.getScheme())) {
                        try (InputStream inCopy = new FileInputStream(tempOut);
                             OutputStream outOrig = resolver.openOutputStream(srcUri, "wt")) {
                            if (outOrig == null) throw new IllegalStateException("Original file is not writable.");
                            copyStream(inCopy, outOrig);
                            savedUri = srcUri;
                            displayPath = srcName;
                        }
                    } else {
                        savedUri = saveFileToMediaStoreImages(ctx, tempOut, outFileName);
                        displayPath = "Pictures/Mo Vibe Compressed/" + outFileName;
                    }

                    JSObject res = new JSObject();
                    res.put("saved", true);
                    res.put("uri", savedUri.toString());
                    res.put("displayPath", displayPath);
                    res.put("originalSize", originalSize);
                    res.put("compressedSize", tempOut.length());
                    res.put("width", outW);
                    res.put("height", outH);
                    call.resolve(res);
                } finally {
                    if (tempOut.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        tempOut.delete();
                    }
                }
            } catch (Exception e) {
                call.reject("Image compression failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void compressVideo(PluginCall call) {
        String uriStr = call.getString("uri", "");
        int maxDimension = Math.max(240, call.getInt("maxDimension", 1280));
        int bitrateKbps = Math.max(350, call.getInt("bitrateKbps", 2000));

        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing video URI.");
            return;
        }

        executor.execute(() -> {
            File tempOut = null;
            try {
                Context ctx = getContext();
                ContentResolver resolver = ctx.getContentResolver();
                Uri srcUri = Uri.parse(uriStr);
                long originalSize = getUriByteSize(resolver, srcUri);
                String srcName = getUriDisplayName(resolver, srcUri, "video.mp4");
                String baseName = srcName.replaceAll("\\.[^/.]+$", "");
                String outName = baseName + "_" + maxDimension + "p_compressed.mp4";

                tempOut = File.createTempFile("movibe_vid_comp_", ".mp4", ctx.getCacheDir());
                VideoCompressorHelper.compressVideo(
                    ctx,
                    srcUri,
                    tempOut,
                    maxDimension,
                    bitrateKbps * 1000,
                    pct -> {
                        JSObject prog = new JSObject();
                        prog.put("percent", pct);
                        notifyListeners("videoCompressProgress", prog);
                    }
                );

                Uri savedUri = saveFileToMediaStoreVideos(ctx, tempOut, outName);
                JSObject res = new JSObject();
                res.put("saved", true);
                res.put("uri", savedUri.toString());
                res.put("displayPath", "Movies/Mo Vibe Compressed/" + outName);
                res.put("originalSize", originalSize);
                res.put("compressedSize", tempOut.length());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Video compression failed: " + e.getMessage(), e);
            } finally {
                if (tempOut != null && tempOut.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempOut.delete();
                }
            }
        });
    }

    @PluginMethod
    public void getStorageRoots(PluginCall call) {
        try {
            Context ctx = getContext();
            JSArray roots = new JSArray();
            Set<String> addedCanon = new HashSet<>();

            File primary = Environment.getExternalStorageDirectory();
            if (primary != null) {
                try {
                    addedCanon.add(primary.getCanonicalPath());
                } catch (Exception e) {
                    addedCanon.add(primary.getAbsolutePath());
                }
                JSObject internal = new JSObject();
                internal.put("id", "internal");
                internal.put("label", "Internal Storage");
                internal.put("type", "file");
                internal.put("path", primary.getAbsolutePath());
                internal.put("writable", primary.canWrite());
                roots.put(internal);
            }

            // Detect removable SD Card / additional shared volumes via StorageManager & external dirs
            int sdCounter = 1;
            for (File volRoot : getAccessibleVolumeRoots(ctx)) {
                String canon;
                try {
                    canon = volRoot.getCanonicalPath();
                } catch (Exception e) {
                    canon = volRoot.getAbsolutePath();
                }
                if (addedCanon.contains(canon)) continue;
                addedCanon.add(canon);

                JSObject sd = new JSObject();
                sd.put("id", "sdcard-" + sdCounter++);
                sd.put("label", "SD Card (" + volRoot.getName() + ")");
                sd.put("type", "file");
                sd.put("path", volRoot.getAbsolutePath());
                sd.put("writable", volRoot.canWrite());
                roots.put(sd);
            }

            // Fallback app-scoped external storage entry if removable volume root isn't directly readable yet
            File[] extAppDirs = ContextCompat.getExternalFilesDirs(ctx, null);
            if (extAppDirs != null) {
                for (int i = 1; i < extAppDirs.length; i++) {
                    File appDir = extAppDirs[i];
                    if (appDir == null) continue;
                    String full = appDir.getAbsolutePath();
                    int androidIdx = full.indexOf("/Android/");
                    String rootPath = androidIdx > 0 ? full.substring(0, androidIdx) : full;
                    File rootDir = new File(rootPath);
                    String canon;
                    try {
                        canon = rootDir.getCanonicalPath();
                    } catch (Exception e) {
                        canon = rootDir.getAbsolutePath();
                    }
                    if (addedCanon.contains(canon)) continue;
                    addedCanon.add(canon);
                    JSObject sd = new JSObject();
                    sd.put("id", "sdcard-" + sdCounter++);
                    sd.put("label", "SD Card (" + rootDir.getName() + ")");
                    sd.put("type", "file");
                    sd.put("path", rootDir.canRead() ? rootDir.getAbsolutePath() : appDir.getAbsolutePath());
                    sd.put("writable", rootDir.canWrite());
                    roots.put(sd);
                }
            }

            // Persisted SAF document tree roots (fallback for Android-restricted folders)
            JSONArray safArr = getSavedSafTreeUris();
            for (int i = 0; i < safArr.length(); i++) {
                JSONObject o = safArr.optJSONObject(i);
                if (o == null) continue;
                JSObject saf = new JSObject();
                saf.put("id", "saf-" + i);
                saf.put("label", "SAF: " + o.optString("label", "Folder"));
                saf.put("type", "saf");
                saf.put("treeUri", o.optString("uri"));
                saf.put("writable", true);
                roots.put(saf);
            }

            JSObject res = new JSObject();
            res.put("roots", roots);
            res.put("hasAllFilesAccess", hasAllFilesAccess());
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Could not read storage roots: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void listDirectory(PluginCall call) {
        String path = call.getString("path", "");
        String treeUriStr = call.getString("treeUri", "");
        String docUriStr = call.getString("documentUri", "");

        executor.execute(() -> {
            try {
                JSArray items = new JSArray();
                String currentLabel = "";
                String parentPath = "";

                if (treeUriStr != null && !treeUriStr.isEmpty()) {
                    Uri treeUri = Uri.parse(treeUriStr);
                    Uri targetDocUri = (docUriStr != null && !docUriStr.isEmpty())
                        ? Uri.parse(docUriStr)
                        : DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
                    currentLabel = treeUri.getLastPathSegment() != null ? treeUri.getLastPathSegment() : "SAF Folder";
                    Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                        treeUri,
                        DocumentsContract.getDocumentId(targetDocUri)
                    );
                    try (Cursor c = getContext().getContentResolver().query(
                        childrenUri,
                        new String[] {
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE,
                            DocumentsContract.Document.COLUMN_SIZE,
                            DocumentsContract.Document.COLUMN_LAST_MODIFIED
                        },
                        null, null, null
                    )) {
                        if (c != null) {
                            while (c.moveToNext()) {
                                String docId = c.getString(0);
                                if (isRestrictedScanPath(docId)) continue;
                                String name = c.getString(1);
                                String mime = c.getString(2);
                                long sz = c.getLong(3);
                                long mod = c.getLong(4);
                                boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                                Uri childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                                JSObject obj = new JSObject();
                                obj.put("id", docId);
                                obj.put("name", name != null ? name : "Item");
                                obj.put("uri", childUri.toString());
                                obj.put("path", childUri.toString());
                                obj.put("isDirectory", isDir);
                                obj.put("size", isDir ? 0L : sz);
                                obj.put("dateModified", mod);
                                obj.put("mimeType", mime != null ? mime : "application/octet-stream");
                                obj.put("category", isDir ? "folder" : classifyFileCategory(name, mime, ""));
                                items.put(obj);
                            }
                        }
                    }
                } else {
                    File targetDir = (path != null && !path.isEmpty())
                        ? new File(path)
                        : Environment.getExternalStorageDirectory();
                    if (!isWithinSharedStorageRoots(targetDir)) {
                        call.reject("Directory is outside accessible shared storage.");
                        return;
                    }
                    currentLabel = targetDir.getAbsolutePath();
                    File parentFile = targetDir.getParentFile();
                    if (parentFile != null && isWithinSharedStorageRoots(parentFile)) {
                        parentPath = parentFile.getAbsolutePath();
                    }
                    if (!shouldSkipScanDirectory(targetDir)) {
                        File[] files = targetDir.listFiles();
                        if (files != null) {
                            for (File f : files) {
                                if (f.isDirectory() && shouldSkipScanDirectory(f)) continue;
                                boolean isDir = f.isDirectory();
                                String mime = isDir ? "inode/directory" : guessMimeFromName(f.getName());
                                JSObject obj = new JSObject();
                                obj.put("id", String.valueOf(f.getAbsolutePath().hashCode()));
                                obj.put("name", f.getName());
                                obj.put("uri", Uri.fromFile(f).toString());
                                obj.put("path", f.getAbsolutePath());
                                obj.put("isDirectory", isDir);
                                obj.put("size", isDir ? 0L : f.length());
                                obj.put("dateModified", f.lastModified());
                                obj.put("mimeType", mime);
                                obj.put("category", isDir ? "folder" : classifyFileCategory(f.getName(), mime, f.getAbsolutePath().toLowerCase(Locale.US)));
                                items.put(obj);
                            }
                        }
                    }
                }

                JSObject res = new JSObject();
                res.put("items", items);
                res.put("currentPath", currentLabel);
                res.put("parentPath", parentPath);
                res.put("emptyNote", items.length() == 0 && !hasAllFilesAccess() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && (treeUriStr == null || treeUriStr.isEmpty()));
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not list folder: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void requestSafFolderAccess(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity unavailable.");
            return;
        }
        String preset = call.getString("preset", "default");
        String initialPath = call.getString("initialPath", "");

        bridge.saveCall(call);
        pendingSafCallId = call.getCallbackId();
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String targetRel = resolveInitialSafRelativePath(preset, initialPath);
            if (targetRel != null && !targetRel.isEmpty()) {
                try {
                    Uri initialUri = DocumentsContract.buildDocumentUri(
                        "com.android.externalstorage.documents",
                        "primary:" + targetRel
                    );
                    intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri);
                } catch (Exception ignored) {}
            }
        }

        getActivity().runOnUiThread(() -> safTreeLauncher.launch(intent));
    }

    @PluginMethod
    public void requestSafDocumentFiles(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity unavailable.");
            return;
        }
        String preset = call.getString("preset", "documents");
        bridge.saveCall(call);
        pendingSafFilesCallId = call.getCallbackId();

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        if (!"downloads".equals(preset)) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                "application/pdf",
                "text/*",
                "text/csv",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-powerpoint",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "application/vnd.oasis.opendocument.text",
                "application/vnd.oasis.opendocument.spreadsheet",
                "application/vnd.oasis.opendocument.presentation",
                "application/rtf",
                "application/epub+zip",
                "application/json",
                "application/xml",
                "application/zip"
            });
        }
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                String startDir = "downloads".equals(preset)
                    ? Environment.DIRECTORY_DOWNLOADS
                    : Environment.DIRECTORY_DOCUMENTS;
                Uri initialUri = DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents",
                    "primary:" + startDir
                );
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri);
            } catch (Exception ignored) {}
        }

        getActivity().runOnUiThread(() -> safFilesLauncher.launch(intent));
    }

    @PluginMethod
    public void getPdfThumbnail(PluginCall call) {
        String id = call.getString("id", "");
        String uriStr = call.getString("uri", "");
        if (uriStr == null || uriStr.isEmpty()) {
            JSObject empty = new JSObject();
            empty.put("localUrl", "");
            call.resolve(empty);
            return;
        }

        String safeId = (id != null && !id.isEmpty() ? id : String.valueOf(uriStr.hashCode()))
            .replaceAll("[^a-zA-Z0-9_-]", "_");

        pdfThumbExecutor.execute(() -> {
            ParcelFileDescriptor pfd = null;
            PdfRenderer renderer = null;
            PdfRenderer.Page page = null;
            Bitmap bitmap = null;
            try {
                File thumbDir = new File(getContext().getCacheDir(), "pdf_thumbs");
                if (!thumbDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    thumbDir.mkdirs();
                }
                File thumbFile = new File(thumbDir, "pdf_" + safeId + ".jpg");
                if (thumbFile.exists() && thumbFile.length() > 0) {
                    String path = thumbFile.getAbsolutePath();
                    JSObject cached = new JSObject();
                    cached.put("filePath", path);
                    cached.put("localUrl", bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + path);
                    call.resolve(cached);
                    return;
                }

                Uri uri = Uri.parse(uriStr);
                if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
                    File f = new File(uri.getPath());
                    if (f.exists() && f.canRead()) {
                        pfd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
                    }
                } else {
                    pfd = getContext().getContentResolver().openFileDescriptor(uri, "r");
                }

                if (pfd == null) {
                    JSObject empty = new JSObject();
                    empty.put("localUrl", "");
                    call.resolve(empty);
                    return;
                }

                renderer = new PdfRenderer(pfd);
                if (renderer.getPageCount() <= 0) {
                    JSObject empty = new JSObject();
                    empty.put("localUrl", "");
                    call.resolve(empty);
                    return;
                }

                page = renderer.openPage(0);
                int pw = Math.max(1, page.getWidth());
                int ph = Math.max(1, page.getHeight());
                int targetW = 240;
                int targetH = Math.max(160, Math.min(360, Math.round((float) ph * targetW / (float) pw)));

                bitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bitmap);
                canvas.drawColor(Color.WHITE);
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

                File tmpFile = new File(thumbDir, "pdf_" + safeId + "_" + System.nanoTime() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmpFile)) {
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out);
                    out.flush();
                }
                if (!tmpFile.renameTo(thumbFile)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpFile.delete();
                }

                String filePath = thumbFile.getAbsolutePath();
                JSObject res = new JSObject();
                res.put("filePath", filePath);
                res.put("localUrl", bridge.getLocalUrl() + Bridge.CAPACITOR_FILE_START + filePath);
                call.resolve(res);
            } catch (Exception e) {
                JSObject empty = new JSObject();
                empty.put("localUrl", "");
                call.resolve(empty);
            } finally {
                try {
                    if (page != null) page.close();
                } catch (Exception ignored) {}
                try {
                    if (renderer != null) renderer.close();
                } catch (Exception ignored) {}
                try {
                    if (pfd != null) pfd.close();
                } catch (Exception ignored) {}
                if (bitmap != null && !bitmap.isRecycled()) {
                    bitmap.recycle();
                }
            }
        });
    }

    private String resolveInitialSafRelativePath(String preset, String explicitRelPath) {
        if (explicitRelPath != null && !explicitRelPath.trim().isEmpty()) {
            return explicitRelPath.trim().replaceAll("^/+", "");
        }
        File extRoot = Environment.getExternalStorageDirectory();
        if ("whatsapp".equals(preset)) {
            String[] candidates = new String[] {
                "Android/media/com.whatsapp/WhatsApp/Media",
                "WhatsApp/Media",
                "Android/media/com.whatsapp.w4b/WhatsApp Business/Media",
                "WhatsApp Business/Media",
                "Android/media/com.whatsapp/WhatsApp",
                "Android/media/com.whatsapp",
                "Android/media/com.whatsapp.w4b",
                "Android/media"
            };
            for (String rel : candidates) {
                File dir = new File(extRoot, rel);
                if (dir.exists() && dir.isDirectory()) {
                    return rel;
                }
            }
            PackageManager pm = getContext().getPackageManager();
            if (isPackageInstalled(pm, "com.whatsapp")) {
                return "Android/media/com.whatsapp/WhatsApp/Media";
            }
            if (isPackageInstalled(pm, "com.whatsapp.w4b")) {
                return "Android/media/com.whatsapp.w4b/WhatsApp Business/Media";
            }
            File mediaDir = new File(extRoot, "Android/media");
            if (mediaDir.exists()) {
                return "Android/media";
            }
        }
        return Environment.DIRECTORY_DOCUMENTS;
    }

    private boolean isPackageInstalled(PackageManager pm, String packageName) {
        try {
            pm.getPackageInfo(packageName, 0);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @PluginMethod
    public void createFolder(PluginCall call) {
        String parentPath = call.getString("parentPath", "");
        String treeUriStr = call.getString("treeUri", "");
        String parentDocUriStr = call.getString("documentUri", "");
        String name = call.getString("name", "").trim();

        if (name.isEmpty() || name.contains("/") || name.contains("\\") || "..".equals(name)) {
            call.reject("Invalid folder name.");
            return;
        }

        executor.execute(() -> {
            try {
                if (treeUriStr != null && !treeUriStr.isEmpty()) {
                    Uri treeUri = Uri.parse(treeUriStr);
                    Uri parentUri = (parentDocUriStr != null && !parentDocUriStr.isEmpty())
                        ? Uri.parse(parentDocUriStr)
                        : DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
                    Uri created = DocumentsContract.createDocument(
                        getContext().getContentResolver(),
                        parentUri,
                        DocumentsContract.Document.MIME_TYPE_DIR,
                        name
                    );
                    if (created == null) throw new IllegalStateException("Could not create folder via SAF.");
                    JSObject res = new JSObject();
                    res.put("created", true);
                    res.put("path", created.toString());
                    call.resolve(res);
                } else {
                    File base = (parentPath != null && !parentPath.isEmpty())
                        ? new File(parentPath)
                        : Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
                    if (!isWithinSharedStorageRoots(base) || shouldSkipScanDirectory(base)) {
                        call.reject("Cannot create folder in this protected directory.");
                        return;
                    }
                    File newDir = new File(base, name);
                    if (newDir.exists()) {
                        call.reject("A folder or file with that name already exists.");
                        return;
                    }
                    if (!newDir.mkdirs()) {
                        throw new IllegalStateException("Directory creation denied here. Allow All Files Access or open the folder via SAF.");
                    }
                    MediaScannerConnection.scanFile(getContext(), new String[] { newDir.getAbsolutePath() }, null, null);
                    JSObject res = new JSObject();
                    res.put("created", true);
                    res.put("path", newDir.getAbsolutePath());
                    call.resolve(res);
                }
            } catch (Exception e) {
                call.reject("Create folder failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void renameFileItem(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String pathStr = call.getString("path", "");
        String newName = call.getString("newName", "").trim();

        if (newName.isEmpty() || newName.contains("/") || newName.contains("\\") || ".".equals(newName) || "..".equals(newName)) {
            call.reject("Invalid file name.");
            return;
        }

        executor.execute(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                File directSrc = resolveDirectFileFromParams(uriStr, pathStr);
                if (directSrc != null && directSrc.exists()) {
                    if (!isWithinSharedStorageRoots(directSrc) || shouldSkipScanDirectory(directSrc)) {
                        call.reject("Cannot rename protected or out-of-scope item.");
                        return;
                    }
                    File parentDir = directSrc.getParentFile();
                    if (parentDir == null) {
                        call.reject("Invalid source parent folder.");
                        return;
                    }
                    File dst = new File(parentDir, newName);
                    if (dst.exists()) {
                        call.reject("An item named \"" + newName + "\" already exists.");
                        return;
                    }
                    String oldAbs = directSrc.getAbsolutePath();
                    if (directSrc.renameTo(dst)) {
                        MediaScannerConnection.scanFile(getContext(), new String[] { oldAbs, dst.getAbsolutePath() }, null, null);
                        JSObject res = new JSObject();
                        res.put("renamed", true);
                        res.put("newPath", dst.getAbsolutePath());
                        res.put("newUri", Uri.fromFile(dst).toString());
                        call.resolve(res);
                        return;
                    }
                }
                if (uriStr != null && uriStr.startsWith("content://")) {
                    Uri u = Uri.parse(uriStr);
                    if (DocumentsContract.isDocumentUri(getContext(), u)) {
                        Uri renamed = DocumentsContract.renameDocument(resolver, u, newName);
                        if (renamed != null) {
                            JSObject res = new JSObject();
                            res.put("renamed", true);
                            res.put("newUri", renamed.toString());
                            res.put("newPath", renamed.toString());
                            call.resolve(res);
                            return;
                        }
                    }
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, newName);
                    int updated = resolver.update(u, cv, null, null);
                    if (updated > 0) {
                        JSObject res = new JSObject();
                        res.put("renamed", true);
                        res.put("newUri", uriStr);
                        res.put("newPath", uriStr);
                        call.resolve(res);
                        return;
                    }
                }
                call.reject("Could not rename this item. Allow All Files Access or grant SAF folder access.");
            } catch (Exception e) {
                call.reject("Rename failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void copyOrMoveFileItems(PluginCall call) {
        JSArray items = call.getArray("items");
        String targetPath = call.getString("targetPath", "");
        String targetTreeUriStr = call.getString("targetTreeUri", "");
        String targetDocUriStr = call.getString("targetDocumentUri", "");
        String mode = call.getString("mode", "copy");

        if (items == null || items.length() == 0) {
            call.reject("No items selected.");
            return;
        }

        executor.execute(() -> {
            try {
                Context ctx = getContext();
                ContentResolver resolver = ctx.getContentResolver();
                int count = 0;

                File destDir = null;
                if (targetTreeUriStr == null || targetTreeUriStr.isEmpty()) {
                    destDir = (targetPath != null && !targetPath.isEmpty())
                        ? new File(targetPath)
                        : Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!isWithinSharedStorageRoots(destDir) || shouldSkipScanDirectory(destDir)) {
                        call.reject("Destination folder is outside accessible shared storage.");
                        return;
                    }
                    if (!destDir.exists() && !destDir.mkdirs()) {
                        call.reject("Could not create destination folder.");
                        return;
                    }
                }

                for (int i = 0; i < items.length(); i++) {
                    JSONObject obj = items.optJSONObject(i);
                    if (obj == null) continue;
                    String uriStr = obj.optString("uri", "");
                    String pathStr = obj.optString("path", "");
                    String name = obj.optString("name", "file_" + i);
                    String mime = obj.optString("mimeType", guessMimeFromName(name));
                    Uri srcUri = Uri.parse(uriStr);
                    File directSrc = resolveDirectFileFromParams(uriStr, pathStr);

                    if (targetTreeUriStr != null && !targetTreeUriStr.isEmpty()) {
                        Uri treeUri = Uri.parse(targetTreeUriStr);
                        Uri parentUri = (targetDocUriStr != null && !targetDocUriStr.isEmpty())
                            ? Uri.parse(targetDocUriStr)
                            : DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
                        if (directSrc != null && directSrc.isDirectory()) {
                            if (shouldSkipScanDirectory(directSrc)) continue;
                            int copiedSub = copyDirectoryToSafRecursive(resolver, directSrc, parentUri);
                            if (copiedSub > 0) {
                                count++;
                                if ("move".equals(mode)) {
                                    deleteRecursively(directSrc);
                                    MediaScannerConnection.scanFile(ctx, new String[] { directSrc.getAbsolutePath() }, null, null);
                                }
                            }
                        } else {
                            Uri created = DocumentsContract.createDocument(resolver, parentUri, mime, name);
                            if (created != null) {
                                boolean copied = false;
                                try (InputStream in = openAnyUriStream(resolver, srcUri);
                                     OutputStream out = resolver.openOutputStream(created)) {
                                    if (in != null && out != null) {
                                        copyStream(in, out);
                                        copied = true;
                                        count++;
                                    }
                                }
                                if (copied && "move".equals(mode)) {
                                    tryDeleteSingleUriOrFile(resolver, uriStr, pathStr);
                                }
                            }
                        }
                    } else if (destDir != null) {
                        if (directSrc != null && directSrc.exists()) {
                            if (!isWithinSharedStorageRoots(directSrc) || shouldSkipScanDirectory(directSrc)) {
                                continue;
                            }
                            String srcCanon = directSrc.getCanonicalPath();
                            String destDirCanon = destDir.getCanonicalPath();
                            if (directSrc.isDirectory() && (destDirCanon.equals(srcCanon) || destDirCanon.startsWith(srcCanon + File.separator))) {
                                throw new IllegalStateException("Cannot " + mode + " a folder into itself.");
                            }

                            File destTarget = new File(destDir, name);
                            String destCanon = destTarget.getCanonicalPath();
                            if (srcCanon.equals(destCanon)) {
                                if ("move".equals(mode)) {
                                    count++;
                                    continue;
                                }
                                destTarget = resolveNonCollidingFile(destDir, name);
                            } else if (destTarget.exists()) {
                                destTarget = resolveNonCollidingFile(destDir, name);
                            }

                            if ("move".equals(mode) && directSrc.renameTo(destTarget)) {
                                MediaScannerConnection.scanFile(ctx, new String[] { srcCanon, destTarget.getAbsolutePath() }, null, null);
                                count++;
                                continue;
                            }

                            if (directSrc.isDirectory()) {
                                copyDirectoryRecursive(directSrc, destTarget);
                                MediaScannerConnection.scanFile(ctx, new String[] { destTarget.getAbsolutePath() }, null, null);
                                if ("move".equals(mode)) {
                                    deleteRecursively(directSrc);
                                    MediaScannerConnection.scanFile(ctx, new String[] { srcCanon }, null, null);
                                }
                                count++;
                            } else {
                                try (InputStream in = new FileInputStream(directSrc);
                                     OutputStream out = new FileOutputStream(destTarget)) {
                                    copyStream(in, out);
                                    MediaScannerConnection.scanFile(ctx, new String[] { destTarget.getAbsolutePath() }, null, null);
                                    count++;
                                }
                                if ("move".equals(mode)) {
                                    if (deleteRecursively(directSrc)) {
                                        MediaScannerConnection.scanFile(ctx, new String[] { srcCanon }, null, null);
                                    }
                                }
                            }
                        } else {
                            File destFile = resolveNonCollidingFile(destDir, name);
                            boolean copied = false;
                            try (InputStream in = openAnyUriStream(resolver, srcUri);
                                 OutputStream out = new FileOutputStream(destFile)) {
                                if (in != null) {
                                    copyStream(in, out);
                                    copied = true;
                                    count++;
                                    MediaScannerConnection.scanFile(ctx, new String[] { destFile.getAbsolutePath() }, null, null);
                                }
                            }
                            if (copied && "move".equals(mode)) {
                                tryDeleteSingleUriOrFile(resolver, uriStr, pathStr);
                            }
                        }
                    }
                }
                JSObject res = new JSObject();
                res.put("processedCount", count);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Operation failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void deleteFileItems(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("No items selected for deletion.");
            return;
        }
        executor.execute(() -> executeDeleteItems(call, items));
    }

    private void executeDeleteItems(PluginCall call, JSArray items) {
        ContentResolver resolver = getContext().getContentResolver();
        List<Uri> consentUris = new ArrayList<>();
        int deleted = 0;

        for (int i = 0; i < items.length(); i++) {
            JSONObject obj = items.optJSONObject(i);
            if (obj == null) continue;
            String uriStr = obj.optString("uri", "");
            String pathStr = obj.optString("path", "");
            try {
                if (tryDeleteSingleUriOrFile(resolver, uriStr, pathStr)) {
                    deleted++;
                }
            } catch (SecurityException sec) {
                if (uriStr.startsWith("content://")) {
                    consentUris.add(Uri.parse(uriStr));
                }
            }
        }

        if (!consentUris.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && getActivity() != null) {
            bridge.saveCall(call);
            pendingConsentCallId = call.getCallbackId();
            int finalDeletedSoFar = deleted;
            pendingConsentRetry = () -> {
                JSObject done = new JSObject();
                done.put("deletedCount", finalDeletedSoFar + consentUris.size());
                call.resolve(done);
                bridge.releaseCall(call);
            };
            IntentSender sender = MediaStore.createDeleteRequest(resolver, consentUris).getIntentSender();
            getActivity().runOnUiThread(() ->
                deleteConsentLauncher.launch(new IntentSenderRequest.Builder(sender).build())
            );
            return;
        }

        JSObject res = new JSObject();
        res.put("deletedCount", deleted);
        call.resolve(res);
    }

    private boolean tryDeleteSingleUriOrFile(ContentResolver resolver, String uriStr, String pathStr) {
        File directFile = resolveDirectFileFromParams(uriStr, pathStr);
        if (directFile != null && directFile.exists()) {
            if (!isWithinSharedStorageRoots(directFile) || shouldSkipScanDirectory(directFile)) {
                return false;
            }
            String abs = directFile.getAbsolutePath();
            if (deleteRecursively(directFile)) {
                MediaScannerConnection.scanFile(getContext(), new String[] { abs }, null, null);
                return true;
            }
        }
        if (uriStr != null && uriStr.startsWith("content://")) {
            Uri u = Uri.parse(uriStr);
            if (DocumentsContract.isDocumentUri(getContext(), u)) {
                try {
                    return DocumentsContract.deleteDocument(resolver, u);
                } catch (Exception e) {
                    return resolver.delete(u, null, null) > 0;
                }
            }
            return resolver.delete(u, null, null) > 0;
        }
        return false;
    }

    private boolean deleteRecursively(File f) {
        if (f == null || !f.exists()) return true;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        return f.delete();
    }

    @PluginMethod
    public void shareFileItem(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String mimeType = call.getString("mimeType", "*/*");
        String title = call.getString("title", "Share File");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing file URI.");
            return;
        }
        try {
            Context ctx = getContext();
            Uri targetUri = resolveShareableUri(ctx, uriStr);
            Intent sendIntent = new Intent(Intent.ACTION_SEND);
            sendIntent.setType(mimeType);
            sendIntent.putExtra(Intent.EXTRA_STREAM, targetUri);
            sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(sendIntent, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(chooser);
            JSObject res = new JSObject();
            res.put("shared", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Share failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openFileItem(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String mimeType = call.getString("mimeType", "*/*");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing file URI.");
            return;
        }
        try {
            Context ctx = getContext();
            Uri targetUri = resolveShareableUri(ctx, uriStr);
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            viewIntent.setDataAndType(targetUri, mimeType);
            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(viewIntent);
            JSObject res = new JSObject();
            res.put("opened", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("No app found to open this file type: " + e.getMessage(), e);
        }
    }

    private Uri resolveShareableUri(Context ctx, String uriStr) {
        Uri parsed = Uri.parse(uriStr);
        if ("file".equals(parsed.getScheme()) && parsed.getPath() != null) {
            File f = new File(parsed.getPath());
            return FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
        }
        return parsed;
    }

    @PluginMethod
    public void compressToZip(PluginCall call) {
        JSArray items = call.getArray("items");
        String archiveName = call.getString("archiveName", "MoVibe_Archive.zip").trim();
        if (items == null || items.length() == 0) {
            call.reject("Select at least one file to compress.");
            return;
        }
        if (!archiveName.toLowerCase(Locale.US).endsWith(".zip")) {
            archiveName += ".zip";
        }
        final String finalZipName = archiveName.replaceAll("[\\\\/:*?\"<>|]", "_");

        executor.execute(() -> {
            File tempZip = null;
            try {
                Context ctx = getContext();
                ContentResolver resolver = ctx.getContentResolver();
                tempZip = File.createTempFile("movibe_zip_", ".zip", ctx.getCacheDir());
                try (ZipOutputStream zos = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(tempZip)))) {
                    Set<String> usedNames = new HashSet<>();
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject obj = items.optJSONObject(i);
                        if (obj == null) continue;
                        String uriStr = obj.optString("uri", "");
                        String name = obj.optString("name", "file_" + i);
                        String entryName = ensureUniqueZipEntryName(name, usedNames);
                        try (InputStream in = openAnyUriStream(resolver, Uri.parse(uriStr))) {
                            if (in == null) continue;
                            zos.putNextEntry(new ZipEntry(entryName));
                            copyStream(in, zos);
                            zos.closeEntry();
                        }
                    }
                }

                Uri savedUri = saveFileToMediaStoreDownloads(ctx, tempZip, finalZipName, "application/zip", "Mo Vibe Archives");
                JSObject res = new JSObject();
                res.put("saved", true);
                res.put("uri", savedUri.toString());
                res.put("displayPath", "Download/Mo Vibe Archives/" + finalZipName);
                res.put("size", tempZip.length());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("ZIP compression failed: " + e.getMessage(), e);
            } finally {
                if (tempZip != null && tempZip.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempZip.delete();
                }
            }
        });
    }

    private String ensureUniqueZipEntryName(String name, Set<String> usedNames) {
        String safe = name.replaceAll("^[\\\\/]+", "");
        if (!usedNames.contains(safe)) {
            usedNames.add(safe);
            return safe;
        }
        int dot = safe.lastIndexOf('.');
        String base = dot > 0 ? safe.substring(0, dot) : safe;
        String ext = dot > 0 ? safe.substring(dot) : "";
        int idx = 2;
        while (usedNames.contains(base + "_" + idx + ext)) idx++;
        String out = base + "_" + idx + ext;
        usedNames.add(out);
        return out;
    }

    @PluginMethod
    public void extractZipArchive(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String folderName = call.getString("folderName", "Extracted_Archive").trim().replaceAll("[\\\\/:*?\"<>|]", "_");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing ZIP file URI.");
            return;
        }

        executor.execute(() -> {
            try {
                Context ctx = getContext();
                ContentResolver resolver = ctx.getContentResolver();
                File dlRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File extractBase = new File(new File(dlRoot, "Mo Vibe Extracted"), folderName);
                if (!extractBase.exists() && !extractBase.mkdirs()) {
                    extractBase = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), folderName);
                    //noinspection ResultOfMethodCallIgnored
                    extractBase.mkdirs();
                }
                String canonicalBase = extractBase.getCanonicalPath();
                int extractedCount = 0;

                try (InputStream rawIn = openAnyUriStream(resolver, Uri.parse(uriStr));
                     ZipInputStream zis = new ZipInputStream(new BufferedInputStream(rawIn))) {
                    ZipEntry entry;
                    while ((entry = zis.getNextEntry()) != null) {
                        File outFile = new File(extractBase, entry.getName());
                        String canonicalOut = outFile.getCanonicalPath();
                        // Strict Zip-Slip traversal guard
                        if (!canonicalOut.startsWith(canonicalBase + File.separator)) {
                            throw new SecurityException("Blocked unsafe ZIP entry path: " + entry.getName());
                        }
                        if (entry.isDirectory()) {
                            //noinspection ResultOfMethodCallIgnored
                            outFile.mkdirs();
                        } else {
                            File parent = outFile.getParentFile();
                            if (parent != null && !parent.exists()) {
                                //noinspection ResultOfMethodCallIgnored
                                parent.mkdirs();
                            }
                            try (OutputStream fos = new FileOutputStream(outFile)) {
                                copyStream(zis, fos);
                            }
                            extractedCount++;
                        }
                        zis.closeEntry();
                    }
                }

                MediaScannerConnection.scanFile(ctx, new String[] { extractBase.getAbsolutePath() }, null, null);
                JSObject res = new JSObject();
                res.put("extracted", true);
                res.put("extractedCount", extractedCount);
                res.put("outputPath", extractBase.getAbsolutePath());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("ZIP extraction failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getPrivacyOverview(PluginCall call) {
        try {
            Context ctx = getContext();
            JSObject perms = new JSObject();
            perms.put("microphone", ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
            perms.put("phoneState", ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED);
            perms.put("camera", ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED);
            perms.put("location", ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perms.put("notifications", ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
            } else {
                perms.put("notifications", true);
            }
            perms.put("mediaStorage", hasStorageReadPermission());
            perms.put("allFilesAccess", hasAllFilesAccess());

            PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            StatFs statFs = new StatFs(Environment.getDataDirectory().getPath());

            boolean hasClipboardItem = false;
            String clipboardMime = "";
            try {
                ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null && cm.hasPrimaryClip()) {
                    hasClipboardItem = true;
                    if (cm.getPrimaryClipDescription() != null && cm.getPrimaryClipDescription().getMimeTypeCount() > 0) {
                        clipboardMime = cm.getPrimaryClipDescription().getMimeType(0);
                    }
                }
            } catch (Exception ignored) {}

            JSObject res = new JSObject();
            res.put("permissions", perms);
            res.put("packageName", ctx.getPackageName());
            res.put("versionName", pInfo.versionName != null ? pInfo.versionName : "1.0");
            res.put("androidVersion", Build.VERSION.RELEASE);
            res.put("sdkInt", Build.VERSION.SDK_INT);
            res.put("totalStorageBytes", statFs.getTotalBytes());
            res.put("availableStorageBytes", statFs.getAvailableBytes());
            res.put("hasClipboardItem", hasClipboardItem);
            res.put("clipboardMime", clipboardMime);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Could not read privacy status: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void clearClipboard(PluginCall call) {
        try {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    cm.clearPrimaryClip();
                } else {
                    cm.setPrimaryClip(ClipData.newPlainText("", ""));
                }
            }
            JSObject res = new JSObject();
            res.put("cleared", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Could not clear clipboard: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openPrivacySetting(PluginCall call) {
        String target = call.getString("target", "app_details");
        Context ctx = getContext();
        Intent intent;
        try {
            if ("all_files_access".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                intent = new Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.fromParts("package", ctx.getPackageName(), null)
                );
            } else if ("privacy_dashboard".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                intent = new Intent("android.settings.PRIVACY_SETTINGS");
            } else if ("notifications".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            } else if ("all_apps".equals(target)) {
                intent = new Intent(Settings.ACTION_MANAGE_ALL_APPLICATIONS_SETTINGS);
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.getPackageName(), null));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject res = new JSObject();
            res.put("opened", true);
            call.resolve(res);
        } catch (Exception e) {
            try {
                Intent fallback = ("all_files_access".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                    ? new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.getPackageName(), null));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                JSObject res = new JSObject();
                res.put("opened", true);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Could not open Android settings: " + ex.getMessage(), ex);
            }
        }
    }

    // --- Internal Helper Utilities ---

    private boolean isRestrictedScanPath(String path) {
        if (path == null || path.isEmpty()) return false;
        String norm = path.replace('\\', '/').toLowerCase(Locale.US);
        return norm.contains("/android/data/")
            || norm.endsWith("/android/data")
            || norm.contains("android/data/")
            || norm.contains("/android/obb/")
            || norm.endsWith("/android/obb")
            || norm.contains("android/obb/")
            || norm.contains("/whatsapp/databases")
            || norm.contains("/whatsapp business/databases")
            || norm.contains("/whatsapp/backups")
            || norm.contains("/whatsapp business/backups");
    }

    private String toCanonicalKey(String path) {
        if (path == null || path.isEmpty() || path.startsWith("content://")) return null;
        try {
            return new File(path).getCanonicalPath();
        } catch (Exception e) {
            return path;
        }
    }

    private File resolveDirectFileFromParams(String uriStr, String pathStr) {
        if (pathStr != null && !pathStr.isEmpty() && !pathStr.startsWith("content://") && !pathStr.startsWith("file://")) {
            return new File(pathStr);
        }
        if (uriStr != null && uriStr.startsWith("file://")) {
            String p = Uri.parse(uriStr).getPath();
            if (p != null && !p.isEmpty()) {
                return new File(p);
            }
        }
        return null;
    }

    private File resolveNonCollidingFile(File dir, String originalName) {
        File candidate = new File(dir, originalName);
        if (!candidate.exists()) return candidate;
        int dot = originalName.lastIndexOf('.');
        String base = dot > 0 ? originalName.substring(0, dot) : originalName;
        String ext = dot > 0 ? originalName.substring(dot) : "";
        int counter = 2;
        while (candidate.exists() && counter < 1000) {
            candidate = new File(dir, base + " (" + counter + ")" + ext);
            counter++;
        }
        return candidate;
    }

    private void copyDirectoryRecursive(File srcDir, File destDir) throws Exception {
        if (srcDir == null || !srcDir.isDirectory() || shouldSkipScanDirectory(srcDir)) return;
        if (!destDir.exists() && !destDir.mkdirs()) {
            throw new IllegalStateException("Cannot create destination folder: " + destDir.getName());
        }
        File[] children = srcDir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) {
                if (!shouldSkipScanDirectory(child)) {
                    copyDirectoryRecursive(child, new File(destDir, child.getName()));
                }
            } else if (child.isFile()) {
                File outFile = new File(destDir, child.getName());
                try (InputStream in = new FileInputStream(child);
                     OutputStream out = new FileOutputStream(outFile)) {
                    copyStream(in, out);
                }
            }
        }
    }

    private int copyDirectoryToSafRecursive(ContentResolver resolver, File srcDir, Uri parentDocUri) throws Exception {
        if (srcDir == null || !srcDir.isDirectory() || shouldSkipScanDirectory(srcDir)) return 0;
        Uri createdDir = DocumentsContract.createDocument(
            resolver,
            parentDocUri,
            DocumentsContract.Document.MIME_TYPE_DIR,
            srcDir.getName()
        );
        if (createdDir == null) return 0;
        int copiedCount = 1;
        File[] children = srcDir.listFiles();
        if (children == null) return copiedCount;
        for (File child : children) {
            if (child.isDirectory()) {
                copiedCount += copyDirectoryToSafRecursive(resolver, child, createdDir);
            } else if (child.isFile()) {
                String mime = guessMimeFromName(child.getName());
                Uri createdFile = DocumentsContract.createDocument(resolver, createdDir, mime, child.getName());
                if (createdFile != null) {
                    try (InputStream in = new FileInputStream(child);
                         OutputStream out = resolver.openOutputStream(createdFile)) {
                        if (in != null && out != null) {
                            copyStream(in, out);
                            copiedCount++;
                        }
                    }
                }
            }
        }
        return copiedCount;
    }

    private void scanSharedVolumeRecursive(
        File dir,
        int depth,
        int maxDepth,
        List<FileScanRecord> out,
        Set<String> seenCanonicalPaths,
        Set<String> visitedDirs,
        int maxFiles,
        boolean whatsappClassify
    ) {
        if (depth > maxDepth || dir == null || !dir.isDirectory() || out.size() >= maxFiles) return;
        if (shouldSkipScanDirectory(dir)) return;

        String canonDir;
        try {
            canonDir = dir.getCanonicalPath();
        } catch (Exception e) {
            canonDir = dir.getAbsolutePath();
        }
        if (!visitedDirs.add(canonDir)) return;

        File[] children = dir.listFiles();
        if (children == null) return;
        for (File f : children) {
            if (out.size() >= maxFiles) return;
            if (f.isDirectory()) {
                scanSharedVolumeRecursive(f, depth + 1, maxDepth, out, seenCanonicalPaths, visitedDirs, maxFiles, whatsappClassify);
            } else if (f.isFile() && f.length() > 0L) {
                String canonFile;
                try {
                    canonFile = f.getCanonicalPath();
                } catch (Exception e) {
                    canonFile = f.getAbsolutePath();
                }
                if (seenCanonicalPaths.contains(canonFile)) continue;
                seenCanonicalPaths.add(canonFile);
                String absPath = f.getAbsolutePath();
                FileScanRecord rec = new FileScanRecord();
                rec.id = "fs-" + canonFile.hashCode();
                rec.name = f.getName();
                rec.uri = Uri.fromFile(f).toString();
                rec.path = absPath;
                rec.size = f.length();
                rec.dateModified = f.lastModified();
                rec.mimeType = guessMimeFromName(f.getName());
                rec.category = whatsappClassify
                    ? classifyWhatsAppSubcategory(rec)
                    : classifyFileCategory(f.getName(), rec.mimeType, absPath.toLowerCase(Locale.US));
                out.add(rec);
            }
        }
    }

    private void scanDirFilesRecursive(File dir, int depth, int maxDepth, List<FileScanRecord> out, Set<String> seen, boolean whatsappClassify) {
        if (depth > maxDepth || dir == null || !dir.isDirectory() || shouldSkipScanDirectory(dir)) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File f : children) {
            if (f.isDirectory()) {
                scanDirFilesRecursive(f, depth + 1, maxDepth, out, seen, whatsappClassify);
            } else if (f.isFile() && f.length() > 0L) {
                String path = f.getAbsolutePath();
                String canon = toCanonicalKey(path);
                if (seen.contains(path) || (canon != null && seen.contains(canon))) continue;
                seen.add(path);
                if (canon != null) seen.add(canon);
                FileScanRecord rec = new FileScanRecord();
                rec.id = "fs-" + path.hashCode();
                rec.name = f.getName();
                rec.uri = Uri.fromFile(f).toString();
                rec.path = path;
                rec.size = f.length();
                rec.dateModified = f.lastModified();
                rec.mimeType = guessMimeFromName(f.getName());
                rec.category = whatsappClassify ? classifyWhatsAppSubcategory(rec) : classifyFileCategory(f.getName(), rec.mimeType, path.toLowerCase(Locale.US));
                out.add(rec);
            }
        }
    }

    private void scanSafTreeRecursive(Uri treeUri, String parentDocId, int depth, int maxDepth, List<FileScanRecord> out, Set<String> seenUris, Set<String> seenCanonicalPaths, boolean whatsappClassify) {
        if (depth > maxDepth) return;
        String docId = parentDocId != null ? parentDocId : DocumentsContract.getTreeDocumentId(treeUri);
        if (isRestrictedScanPath(docId)) return;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        try (Cursor c = getContext().getContentResolver().query(
            childrenUri,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
            },
            null, null, null
        )) {
            if (c == null) return;
            while (c.moveToNext()) {
                String childDocId = c.getString(0);
                if (isRestrictedScanPath(childDocId)) continue;
                String name = c.getString(1);
                String mime = c.getString(2);
                long sz = c.getLong(3);
                long mod = c.getLong(4);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    scanSafTreeRecursive(treeUri, childDocId, depth + 1, maxDepth, out, seenUris, seenCanonicalPaths, whatsappClassify);
                } else if (sz > 0L) {
                    Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);
                    String uriStr = docUri.toString();
                    String primaryAbs = null;
                    if (childDocId != null && childDocId.startsWith("primary:")) {
                        primaryAbs = toCanonicalKey(Environment.getExternalStorageDirectory().getAbsolutePath() + "/" + childDocId.substring(8));
                    }
                    if (seenUris.contains(uriStr) || (primaryAbs != null && seenCanonicalPaths.contains(primaryAbs))) continue;
                    seenUris.add(uriStr);
                    if (primaryAbs != null) seenCanonicalPaths.add(primaryAbs);
                    FileScanRecord rec = new FileScanRecord();
                    rec.id = childDocId;
                    rec.name = name != null ? name : "Media";
                    rec.uri = uriStr;
                    rec.path = primaryAbs != null ? primaryAbs : childDocId;
                    rec.size = sz;
                    rec.dateModified = mod;
                    rec.mimeType = mime != null ? mime : "application/octet-stream";
                    rec.category = whatsappClassify ? classifyWhatsAppSubcategory(rec) : classifyFileCategory(rec.name, rec.mimeType, childDocId.toLowerCase(Locale.US));
                    out.add(rec);
                }
            }
        } catch (Exception ignored) {}
    }

    private InputStream openAnyUriStream(ContentResolver resolver, Uri uri) throws Exception {
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            return new FileInputStream(new File(uri.getPath()));
        }
        return resolver.openInputStream(uri);
    }

    private long getUriByteSize(ContentResolver resolver, Uri uri) {
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            return new File(uri.getPath()).length();
        }
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return Math.max(0L, c.getLong(0));
            }
        } catch (Exception ignored) {}
        return 0L;
    }

    private String getUriDisplayName(ContentResolver resolver, Uri uri, String fallback) {
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            return new File(uri.getPath()).getName();
        }
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    private void copyStream(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[65536];
        int len;
        while ((len = in.read(buf)) != -1) {
            out.write(buf, 0, len);
        }
        out.flush();
    }

    private String guessMimeFromName(String name) {
        if (name == null) return "application/octet-stream";
        int dot = name.lastIndexOf('.');
        if (dot >= 0 && dot < name.length() - 1) {
            String ext = name.substring(dot + 1).toLowerCase(Locale.US);
            String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (m != null) return m;
        }
        return "application/octet-stream";
    }

    private Uri saveFileToMediaStoreImages(Context ctx, File srcFile, String fileName) throws Exception {
        ContentResolver resolver = ctx.getContentResolver();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Mo Vibe Compressed");
            cv.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new IllegalStateException("Could not create MediaStore image entry.");
            try (InputStream in = new FileInputStream(srcFile); OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("Cannot write compressed image.");
                copyStream(in, out);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Mo Vibe Compressed");
        if (!dir.exists()) //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        File dest = new File(dir, fileName);
        try (InputStream in = new FileInputStream(srcFile); OutputStream out = new FileOutputStream(dest)) {
            copyStream(in, out);
        }
        MediaScannerConnection.scanFile(ctx, new String[] { dest.getAbsolutePath() }, new String[] { "image/jpeg" }, null);
        return Uri.fromFile(dest);
    }

    private Uri saveFileToMediaStoreVideos(Context ctx, File srcFile, String fileName) throws Exception {
        ContentResolver resolver = ctx.getContentResolver();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Video.Media.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
            cv.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Mo Vibe Compressed");
            cv.put(MediaStore.Video.Media.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new IllegalStateException("Could not create MediaStore video entry.");
            try (InputStream in = new FileInputStream(srcFile); OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("Cannot write compressed video.");
                copyStream(in, out);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Video.Media.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "Mo Vibe Compressed");
        if (!dir.exists()) //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        File dest = new File(dir, fileName);
        try (InputStream in = new FileInputStream(srcFile); OutputStream out = new FileOutputStream(dest)) {
            copyStream(in, out);
        }
        MediaScannerConnection.scanFile(ctx, new String[] { dest.getAbsolutePath() }, new String[] { "video/mp4" }, null);
        return Uri.fromFile(dest);
    }

    private Uri saveFileToMediaStoreDownloads(Context ctx, File srcFile, String fileName, String mimeType, String subFolder) throws Exception {
        ContentResolver resolver = ctx.getContentResolver();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + subFolder);
            cv.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new IllegalStateException("Could not create archive in Downloads.");
            try (InputStream in = new FileInputStream(srcFile); OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("Cannot write archive file.");
                copyStream(in, out);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), subFolder);
        if (!dir.exists()) //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        File dest = new File(dir, fileName);
        try (InputStream in = new FileInputStream(srcFile); OutputStream out = new FileOutputStream(dest)) {
            copyStream(in, out);
        }
        MediaScannerConnection.scanFile(ctx, new String[] { dest.getAbsolutePath() }, new String[] { mimeType }, null);
        return Uri.fromFile(dest);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        executor.shutdownNow();
        pdfThumbExecutor.shutdownNow();
    }
}
