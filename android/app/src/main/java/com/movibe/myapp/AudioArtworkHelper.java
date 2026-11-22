package com.movibe.myapp;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Size;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public final class AudioArtworkHelper {

    public static class ArtworkResult {
        public String filePath;
        public boolean hasEmbeddedArt;
    }

    private static final int ART_SIZE_PX = 512;

    private static final int[][] PALETTES = new int[][] {
        { 0xFF064E3B, 0xFF10B981, 0xFFA7F3D0 }, // Emerald Mint
        { 0xFF0F172A, 0xFF06B6D4, 0xFF67E8F9 }, // Deep Cyan
        { 0xFF311042, 0xFF8B5CF6, 0xFFDDD6FE }, // Violet Pulse
        { 0xFF3F1D2B, 0xFFEC4899, 0xFFFBCFE8 }, // Rose Magenta
        { 0xFF431407, 0xFFF97316, 0xFFFED7AA }, // Warm Amber
        { 0xFF1E3A8A, 0xFF3B82F6, 0xFFBFDBFE }, // Electric Blue
        { 0xFF134E4A, 0xFF14B8A6, 0xFF99F6E4 }, // Studio Teal
        { 0xFF312E81, 0xFF6366F1, 0xFFC7D2FE }, // Indigo Groove
    };

    private AudioArtworkHelper() {}

    public static ArtworkResult getOrCreateAudioArtwork(
        Context context,
        String id,
        String uriString,
        String title,
        String artist
    ) {
        ArtworkResult result = new ArtworkResult();
        if (context == null) return result;

        String rawKey = (id != null && !id.isEmpty())
            ? id
            : (uriString != null && !uriString.isEmpty() ? String.valueOf(uriString.hashCode()) : String.valueOf((title + "_" + artist).hashCode()));
        String safeId = rawKey.replaceAll("[^a-zA-Z0-9_-]", "_");

        File thumbDir = new File(context.getCacheDir(), "audio_thumbs");
        if (!thumbDir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            thumbDir.mkdirs();
        }

        File embeddedCache = new File(thumbDir, "a_v4_e_" + safeId + ".jpg");
        if (embeddedCache.exists() && embeddedCache.length() > 0) {
            result.filePath = embeddedCache.getAbsolutePath();
            result.hasEmbeddedArt = true;
            return result;
        }

        File generatedCache = new File(thumbDir, "a_v4_g_" + safeId + ".jpg");
        if (generatedCache.exists() && generatedCache.length() > 0) {
            result.filePath = generatedCache.getAbsolutePath();
            result.hasEmbeddedArt = false;
            return result;
        }

        Bitmap extracted = extractEmbeddedBitmap(context, uriString);
        boolean isEmbedded = (extracted != null);
        Bitmap sourceBitmap = isEmbedded
            ? extracted
            : createGeneratedArtwork(title, artist, rawKey);

        Bitmap scaled = null;
        try {
            int w = sourceBitmap.getWidth();
            int h = sourceBitmap.getHeight();
            Bitmap toSave = sourceBitmap;
            if (w > ART_SIZE_PX || h > ART_SIZE_PX) {
                float scale = Math.min((float) ART_SIZE_PX / Math.max(1, w), (float) ART_SIZE_PX / Math.max(1, h));
                int targetW = Math.max(1, Math.round(w * scale));
                int targetH = Math.max(1, Math.round(h * scale));
                scaled = Bitmap.createScaledBitmap(sourceBitmap, targetW, targetH, true);
                toSave = scaled;
            }

            File targetFile = isEmbedded ? embeddedCache : generatedCache;
            File tmpFile = new File(thumbDir, "tmp_" + safeId + "_" + System.nanoTime() + ".jpg");
            try (FileOutputStream out = new FileOutputStream(tmpFile)) {
                toSave.compress(Bitmap.CompressFormat.JPEG, 86, out);
                out.flush();
            }
            if (!tmpFile.renameTo(targetFile)) {
                //noinspection ResultOfMethodCallIgnored
                tmpFile.delete();
            }

            if (targetFile.exists() && targetFile.length() > 0) {
                result.filePath = targetFile.getAbsolutePath();
                result.hasEmbeddedArt = isEmbedded;
            }
        } catch (Exception ignored) {
            // ignore save errors
        } finally {
            if (scaled != null && scaled != sourceBitmap && !scaled.isRecycled()) {
                scaled.recycle();
            }
            if (!sourceBitmap.isRecycled()) {
                sourceBitmap.recycle();
            }
        }

        return result;
    }

    public static Bitmap loadBitmapForNotification(
        Context context,
        String id,
        String uriString,
        String title,
        String artist
    ) {
        ArtworkResult res = getOrCreateAudioArtwork(context, id, uriString, title, artist);
        if (res.filePath != null && !res.filePath.isEmpty()) {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap bmp = BitmapFactory.decodeFile(res.filePath, opts);
            if (bmp != null) {
                return bmp;
            }
        }
        return createGeneratedArtwork(title, artist, id != null ? id : title);
    }

    private static Bitmap extractEmbeddedBitmap(Context context, String uriString) {
        if (uriString == null || uriString.isEmpty()) {
            return null;
        }

        Uri uri = Uri.parse(uriString);
        ContentResolver resolver = context.getContentResolver();

        // 1. Embedded cover picture directly from audio metadata tags (ID3 APIC / MP4 covr / FLAC picture)
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            boolean opened = false;
            try {
                mmr.setDataSource(context, uri);
                opened = true;
            } catch (Exception ignored) {
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                if ("file".equals(scheme) && uri.getPath() != null) {
                    try {
                        mmr.setDataSource(uri.getPath());
                        opened = true;
                    } catch (Exception ignoredInner) {
                        opened = false;
                    }
                }
                if (!opened) {
                    try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r")) {
                        if (pfd != null) {
                            mmr.setDataSource(pfd.getFileDescriptor());
                            opened = true;
                        }
                    } catch (Exception ignoredPfd) {
                        opened = false;
                    }
                }
            }

            if (opened) {
                byte[] art = mmr.getEmbeddedPicture();
                if (art != null && art.length > 0) {
                    Bitmap decoded = decodeScaledByteArray(art, ART_SIZE_PX);
                    if (decoded != null) {
                        return decoded;
                    }
                }
            }
        } catch (Exception ignored) {
            // fallback below
        } finally {
            try {
                mmr.release();
            } catch (Exception ignored) {
                // ignore
            }
        }

        // 2. Android Q+ MediaStore thumbnail loader
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                Bitmap thumb = resolver.loadThumbnail(uri, new Size(ART_SIZE_PX, ART_SIZE_PX), null);
                if (thumb != null) {
                    return thumb;
                }
            } catch (Exception ignored) {
                // ignore
            }
        }

        // 3. Album Art lookup via MediaStore Album ID
        try (Cursor c = resolver.query(
            uri,
            new String[] { MediaStore.Audio.Media.ALBUM_ID },
            null,
            null,
            null
        )) {
            if (c != null && c.moveToFirst()) {
                int col = c.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID);
                if (col >= 0 && !c.isNull(col)) {
                    long albumId = c.getLong(col);
                    if (albumId > 0) {
                        Uri albumArtUri = ContentUris.withAppendedId(
                            Uri.parse("content://media/external/audio/albumart"),
                            albumId
                        );
                        try (InputStream in = resolver.openInputStream(albumArtUri)) {
                            if (in != null) {
                                Bitmap bmp = BitmapFactory.decodeStream(in);
                                if (bmp != null) {
                                    return bmp;
                                }
                            }
                        } catch (Exception ignored) {
                            // try albums content URI thumbnail
                        }

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            try {
                                Uri albumUri = ContentUris.withAppendedId(
                                    MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI,
                                    albumId
                                );
                                Bitmap bmp = resolver.loadThumbnail(albumUri, new Size(ART_SIZE_PX, ART_SIZE_PX), null);
                                if (bmp != null) {
                                    return bmp;
                                }
                            } catch (Exception ignored) {
                                // ignore
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // ignore album lookup errors
        }

        return null;
    }

    private static Bitmap decodeScaledByteArray(byte[] data, int reqSize) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return null;
        }
        int sampleSize = 1;
        while ((bounds.outWidth / sampleSize) > reqSize * 2 || (bounds.outHeight / sampleSize) > reqSize * 2) {
            sampleSize *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sampleSize;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeByteArray(data, 0, data.length, opts);
    }

    public static Bitmap createGeneratedArtwork(String title, String artist, String seedKey) {
        int size = ART_SIZE_PX;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);

        String combinedSeed = (seedKey != null && !seedKey.isEmpty())
            ? seedKey
            : ((title != null ? title : "") + "_" + (artist != null ? artist : ""));
        int hash = combinedSeed != null ? combinedSeed.hashCode() : 0;
        int paletteIdx = Math.abs(hash) % PALETTES.length;
        int[] palette = PALETTES[paletteIdx];

        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setShader(new LinearGradient(
            0f,
            0f,
            size,
            size,
            new int[] { palette[0], 0xFF090D16, palette[1] },
            new float[] { 0f, 0.56f, 1f },
            Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0f, 0f, size, size, bgPaint);

        // Subtle studio radial glow behind vinyl center
        Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        glowPaint.setColor(palette[1]);
        glowPaint.setAlpha(58);
        canvas.drawCircle(size * 0.5f, size * 0.48f, size * 0.34f, glowPaint);

        // Outer vinyl ring & grooves
        float cx = size * 0.5f;
        float cy = size * 0.48f;
        Paint groovePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        groovePaint.setStyle(Paint.Style.STROKE);
        groovePaint.setColor(0xFFFFFFFF);
        groovePaint.setStrokeWidth(2.2f);
        groovePaint.setAlpha(42);
        canvas.drawCircle(cx, cy, size * 0.31f, groovePaint);

        groovePaint.setStrokeWidth(1.5f);
        groovePaint.setAlpha(28);
        canvas.drawCircle(cx, cy, size * 0.25f, groovePaint);

        // Inner center disc
        Paint discPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        discPaint.setColor(0xD90B1220);
        canvas.drawCircle(cx, cy, size * 0.19f, discPaint);

        Paint rimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        rimPaint.setStyle(Paint.Style.STROKE);
        rimPaint.setStrokeWidth(3f);
        rimPaint.setColor(palette[2]);
        rimPaint.setAlpha(185);
        canvas.drawCircle(cx, cy, size * 0.19f, rimPaint);

        // Equalizer bars along bottom
        Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        barPaint.setColor(palette[2]);
        barPaint.setAlpha(170);
        int barCount = 9;
        float barWidth = 10f;
        float gap = 9f;
        float totalW = barCount * barWidth + (barCount - 1) * gap;
        float startX = (size - totalW) * 0.5f;
        float baseY = size * 0.88f;
        for (int i = 0; i < barCount; i++) {
            int hSeed = Math.abs((hash * 31 + i * 97) % 100);
            float barH = 14f + (hSeed / 100f) * 30f;
            float left = startX + i * (barWidth + gap);
            RectF barRect = new RectF(left, baseY - barH, left + barWidth, baseY);
            canvas.drawRoundRect(barRect, 5f, 5f, barPaint);
        }

        // Crisp centered music note icon
        Paint notePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        notePaint.setColor(0xFFFFFFFF);
        notePaint.setStyle(Paint.Style.FILL);
        float s = size / 24f * 0.24f; // scale 24dp path to ~90px centered
        float ox = cx - 12f * s;
        float oy = cy - 12f * s;
        Path notePath = new Path();
        // Classic eighth note stem + head + flag scaled in center disc
        notePath.moveTo(ox + 12f * s, oy + 4f * s);
        notePath.lineTo(ox + 18f * s, oy + 4f * s);
        notePath.lineTo(ox + 18f * s, oy + 8f * s);
        notePath.lineTo(ox + 14.5f * s, oy + 8f * s);
        notePath.lineTo(ox + 14.5f * s, oy + 16.5f * s);
        notePath.lineTo(ox + 12f * s, oy + 16.5f * s);
        notePath.close();
        canvas.drawPath(notePath, notePaint);
        canvas.drawCircle(ox + 10.6f * s, oy + 16.6f * s, 3.6f * s, notePaint);

        return bmp;
    }
}
