package com.beatpulse.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

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
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AudioLibrary")
public class AudioLibraryPlugin extends Plugin {

    private ActivityResultLauncher<String> permissionLauncher;
    private String pendingCallId;
    private File lastTempAudioFile;
    private final Map<String, File> pendingExports = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        permissionLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            isGranted -> {
                PluginCall savedCall = pendingCallId != null ? bridge.getSavedCall(pendingCallId) : null;
                pendingCallId = null;
                if (savedCall == null) {
                    return;
                }

                if (Boolean.TRUE.equals(isGranted)) {
                    loadAudioFiles(savedCall, true);
                } else {
                    if (getActivity() != null) {
                        getActivity().runOnUiThread(() ->
                            Toast.makeText(getContext(), "Allow audio access to see songs", Toast.LENGTH_SHORT).show()
                        );
                    }
                    JSObject result = new JSObject();
                    result.put("granted", false);
                    result.put("songs", new JSArray());
                    savedCall.resolve(result);
                    bridge.releaseCall(savedCall);
                }
            }
        );
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
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Audio.Media.DISPLAY_NAME, finalFileName);
                    values.put(MediaStore.Audio.Media.MIME_TYPE, mimeType != null ? mimeType : "audio/wav");
                    values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/BeatPulse");
                    values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
                    values.put(MediaStore.Audio.Media.IS_PENDING, 1);

                    Uri itemUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
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
                    completed.put(MediaStore.Audio.Media.IS_PENDING, 0);
                    resolver.update(itemUri, completed, null, null);

                    savedUri = itemUri.toString();
                    savedDisplayPath = "Music/BeatPulse/" + finalFileName;
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
        for (File f : pendingExports.values()) {
            if (f != null && f.exists()) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        pendingExports.clear();
        executor.shutdownNow();
    }
}
