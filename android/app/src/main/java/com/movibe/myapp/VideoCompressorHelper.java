package com.movibe.myapp;

import android.content.Context;
import android.graphics.SurfaceTexture;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.net.Uri;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLExt;
import android.opengl.EGLSurface;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.Matrix;
import android.view.Surface;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * Offline H.264/AAC video transcoder for Android 7+ (API 24+) using MediaExtractor,
 * MediaCodec Surface-to-Surface EGL scaling, and MediaMuxer.
 */
public class VideoCompressorHelper {

    public interface ProgressCallback {
        void onProgress(int percent);
    }

    public static void compressVideo(
        Context ctx,
        Uri inputUri,
        File outputFile,
        int maxDimension,
        int targetBitrateBps,
        ProgressCallback callback
    ) throws Exception {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        int srcWidth = 1280;
        int srcHeight = 720;
        int rotation = 0;
        long durationUs = 0L;
        try {
            mmr.setDataSource(ctx, inputUri);
            String wStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String hStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            String rStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            String dStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (wStr != null) srcWidth = Math.max(16, Integer.parseInt(wStr));
            if (hStr != null) srcHeight = Math.max(16, Integer.parseInt(hStr));
            if (rStr != null) rotation = Integer.parseInt(rStr);
            if (dStr != null) durationUs = Math.max(0L, Long.parseLong(dStr) * 1000L);
        } finally {
            try {
                mmr.release();
            } catch (Exception ignored) {}
        }

        // Compute target dimensions keeping aspect ratio and multiple-of-16 alignment for encoder compatibility
        int targetW = srcWidth;
        int targetH = srcHeight;
        int longest = Math.max(srcWidth, srcHeight);
        if (maxDimension > 0 && longest > maxDimension) {
            double scale = (double) maxDimension / (double) longest;
            targetW = Math.max(16, ((int) Math.round((srcWidth * scale) / 16.0)) * 16);
            targetH = Math.max(16, ((int) Math.round((srcHeight * scale) / 16.0)) * 16);
        } else {
            targetW = Math.max(16, (srcWidth / 2) * 2);
            targetH = Math.max(16, (srcHeight / 2) * 2);
        }

        MediaExtractor videoExtractor = new MediaExtractor();
        MediaExtractor audioExtractor = new MediaExtractor();
        MediaCodec decoder = null;
        MediaCodec encoder = null;
        MediaMuxer muxer = null;
        CodecOutputSurface outputSurface = null;
        CodecInputSurface inputSurface = null;

        try {
            videoExtractor.setDataSource(ctx, inputUri, null);
            int videoTrackIndex = -1;
            MediaFormat inputVideoFormat = null;
            for (int i = 0; i < videoExtractor.getTrackCount(); i++) {
                MediaFormat fmt = videoExtractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) {
                    videoTrackIndex = i;
                    inputVideoFormat = fmt;
                    break;
                }
            }
            if (videoTrackIndex < 0 || inputVideoFormat == null) {
                throw new IllegalStateException("No video track found in selected file.");
            }
            if (durationUs <= 0L && inputVideoFormat.containsKey(MediaFormat.KEY_DURATION)) {
                durationUs = inputVideoFormat.getLong(MediaFormat.KEY_DURATION);
            }
            videoExtractor.selectTrack(videoTrackIndex);

            audioExtractor.setDataSource(ctx, inputUri, null);
            int audioTrackIndex = -1;
            MediaFormat inputAudioFormat = null;
            for (int i = 0; i < audioExtractor.getTrackCount(); i++) {
                MediaFormat fmt = audioExtractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    audioTrackIndex = i;
                    inputAudioFormat = fmt;
                    break;
                }
            }
            if (audioTrackIndex >= 0) {
                audioExtractor.selectTrack(audioTrackIndex);
            }

            int frameRate = inputVideoFormat.containsKey(MediaFormat.KEY_FRAME_RATE)
                ? inputVideoFormat.getInteger(MediaFormat.KEY_FRAME_RATE)
                : 30;
            if (frameRate <= 0 || frameRate > 120) frameRate = 30;

            MediaFormat encFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, targetW, targetH);
            encFormat.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            encFormat.setInteger(MediaFormat.KEY_BIT_RATE, Math.max(350_000, targetBitrateBps));
            encFormat.setInteger(MediaFormat.KEY_FRAME_RATE, frameRate);
            encFormat.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2);

            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
            encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            inputSurface = new CodecInputSurface(encoder.createInputSurface());
            encoder.start();

            inputSurface.makeCurrent();
            outputSurface = new CodecOutputSurface(targetW, targetH);

            String inMime = inputVideoFormat.getString(MediaFormat.KEY_MIME);
            if (inMime == null) throw new IllegalStateException("Missing input video MIME type.");
            decoder = MediaCodec.createDecoderByType(inMime);
            decoder.configure(inputVideoFormat, outputSurface.getSurface(), null, 0);
            decoder.start();

            muxer = new MediaMuxer(outputFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            if (rotation != 0) {
                muxer.setOrientationHint(rotation);
            }

            int muxVideoTrack = -1;
            int muxAudioTrack = -1;
            if (inputAudioFormat != null) {
                try {
                    muxAudioTrack = muxer.addTrack(inputAudioFormat);
                } catch (Exception ignored) {
                    muxAudioTrack = -1;
                }
            }
            boolean muxerStarted = false;

            MediaCodec.BufferInfo decInfo = new MediaCodec.BufferInfo();
            MediaCodec.BufferInfo encInfo = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean decoderDone = false;
            boolean encoderDone = false;
            int lastReportedPct = 0;

            while (!encoderDone) {
                if (!inputDone) {
                    int inIdx = decoder.dequeueInputBuffer(10_000);
                    if (inIdx >= 0) {
                        ByteBuffer buf = decoder.getInputBuffer(inIdx);
                        if (buf != null) {
                            int sampleSize = videoExtractor.readSampleData(buf, 0);
                            if (sampleSize < 0) {
                                decoder.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                inputDone = true;
                            } else {
                                long pts = videoExtractor.getSampleTime();
                                decoder.queueInputBuffer(inIdx, 0, sampleSize, pts, 0);
                                videoExtractor.advance();
                            }
                        }
                    }
                }

                boolean decoderOutputAvailable = !decoderDone;
                boolean encoderOutputAvailable = true;

                while (decoderOutputAvailable || encoderOutputAvailable) {
                    int encStatus = encoder.dequeueOutputBuffer(encInfo, 5_000);
                    if (encStatus == MediaCodec.INFO_TRY_AGAIN_LATER) {
                        encoderOutputAvailable = false;
                    } else if (encStatus == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (muxerStarted) throw new IllegalStateException("Encoder output format changed twice.");
                        muxVideoTrack = muxer.addTrack(encoder.getOutputFormat());
                        muxer.start();
                        muxerStarted = true;
                    } else if (encStatus >= 0) {
                        ByteBuffer encodedData = encoder.getOutputBuffer(encStatus);
                        if (encodedData != null) {
                            if ((encInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                                encInfo.size = 0;
                            }
                            if (encInfo.size > 0 && muxerStarted && muxVideoTrack >= 0) {
                                encodedData.position(encInfo.offset);
                                encodedData.limit(encInfo.offset + encInfo.size);
                                muxer.writeSampleData(muxVideoTrack, encodedData, encInfo);
                                if (durationUs > 0L && callback != null) {
                                    int pct = Math.min(92, Math.max(lastReportedPct, (int) ((encInfo.presentationTimeUs * 92L) / durationUs)));
                                    if (pct > lastReportedPct) {
                                        lastReportedPct = pct;
                                        callback.onProgress(pct);
                                    }
                                }
                            }
                        }
                        boolean eos = (encInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                        encoder.releaseOutputBuffer(encStatus, false);
                        if (eos) {
                            encoderDone = true;
                            break;
                        }
                    }

                    if (!decoderDone && encStatus == MediaCodec.INFO_TRY_AGAIN_LATER) {
                        int decStatus = decoder.dequeueOutputBuffer(decInfo, 5_000);
                        if (decStatus == MediaCodec.INFO_TRY_AGAIN_LATER) {
                            decoderOutputAvailable = false;
                        } else if (decStatus >= 0) {
                            boolean render = decInfo.size > 0;
                            decoder.releaseOutputBuffer(decStatus, render);
                            if (render) {
                                outputSurface.awaitNewImage();
                                outputSurface.drawImage();
                                inputSurface.setPresentationTime(decInfo.presentationTimeUs * 1000L);
                                inputSurface.swapBuffers();
                            }
                            if ((decInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                                decoderDone = true;
                                encoder.signalEndOfInputStream();
                            }
                        }
                    } else {
                        decoderOutputAvailable = false;
                    }
                }
            }

            // Copy audio track into muxer cleanly
            if (muxerStarted && muxAudioTrack >= 0) {
                ByteBuffer audioBuf = ByteBuffer.allocateDirect(262144);
                MediaCodec.BufferInfo audioInfo = new MediaCodec.BufferInfo();
                while (true) {
                    int size = audioExtractor.readSampleData(audioBuf, 0);
                    if (size < 0) break;
                    audioInfo.offset = 0;
                    audioInfo.size = size;
                    audioInfo.presentationTimeUs = Math.max(0L, audioExtractor.getSampleTime());
                    int sampleFlags = audioExtractor.getSampleFlags();
                    int muxFlags = 0;
                    if ((sampleFlags & MediaExtractor.SAMPLE_FLAG_SYNC) != 0) {
                        muxFlags |= MediaCodec.BUFFER_FLAG_KEY_FRAME;
                    }
                    audioInfo.flags = muxFlags;
                    muxer.writeSampleData(muxAudioTrack, audioBuf, audioInfo);
                    audioExtractor.advance();
                }
            }

            if (callback != null) {
                callback.onProgress(100);
            }
        } finally {
            try { if (outputSurface != null) outputSurface.release(); } catch (Exception ignored) {}
            try { if (inputSurface != null) inputSurface.release(); } catch (Exception ignored) {}
            try { if (decoder != null) { decoder.stop(); decoder.release(); } } catch (Exception ignored) {}
            try { if (encoder != null) { encoder.stop(); encoder.release(); } } catch (Exception ignored) {}
            try { if (muxer != null) { muxer.stop(); muxer.release(); } } catch (Exception ignored) {}
            try { videoExtractor.release(); } catch (Exception ignored) {}
            try { audioExtractor.release(); } catch (Exception ignored) {}
        }
    }

    private static class CodecInputSurface {
        private EGLDisplay eglDisplay = EGL14.EGL_NO_DISPLAY;
        private EGLContext eglContext = EGL14.EGL_NO_CONTEXT;
        private EGLSurface eglSurface = EGL14.EGL_NO_SURFACE;
        private Surface surface;

        CodecInputSurface(Surface surface) {
            this.surface = surface;
            eglSetup();
        }

        private void eglSetup() {
            eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
            int[] version = new int[2];
            if (!EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) {
                throw new RuntimeException("Unable to initialize EGL14");
            }
            int[] attribList = {
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                0x3142, 1, // EGL_RECORDABLE_ANDROID
                EGL14.EGL_NONE
            };
            EGLConfig[] configs = new EGLConfig[1];
            int[] numConfigs = new int[1];
            EGL14.eglChooseConfig(eglDisplay, attribList, 0, configs, 0, configs.length, numConfigs, 0);
            int[] contextAttribs = { EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE };
            eglContext = EGL14.eglCreateContext(eglDisplay, configs[0], EGL14.EGL_NO_CONTEXT, contextAttribs, 0);
            int[] surfaceAttribs = { EGL14.EGL_NONE };
            eglSurface = EGL14.eglCreateWindowSurface(eglDisplay, configs[0], surface, surfaceAttribs, 0);
        }

        void makeCurrent() {
            EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext);
        }

        void swapBuffers() {
            EGL14.eglSwapBuffers(eglDisplay, eglSurface);
        }

        void setPresentationTime(long nsecs) {
            EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, nsecs);
        }

        void release() {
            if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
                EGL14.eglDestroySurface(eglDisplay, eglSurface);
                EGL14.eglDestroyContext(eglDisplay, eglContext);
                EGL14.eglReleaseThread();
                EGL14.eglTerminate(eglDisplay);
            }
            if (surface != null) {
                surface.release();
            }
            eglDisplay = EGL14.EGL_NO_DISPLAY;
            eglContext = EGL14.EGL_NO_CONTEXT;
            eglSurface = EGL14.EGL_NO_SURFACE;
            surface = null;
        }
    }

    private static class CodecOutputSurface implements SurfaceTexture.OnFrameAvailableListener {
        private static final String VERTEX_SHADER =
            "uniform mat4 uMVPMatrix;\n" +
            "uniform mat4 uSTMatrix;\n" +
            "attribute vec4 aPosition;\n" +
            "attribute vec4 aTextureCoord;\n" +
            "varying vec2 vTextureCoord;\n" +
            "void main() {\n" +
            "  gl_Position = uMVPMatrix * aPosition;\n" +
            "  vTextureCoord = (uSTMatrix * aTextureCoord).xy;\n" +
            "}\n";

        private static final String FRAGMENT_SHADER =
            "#extension GL_OES_EGL_image_external : require\n" +
            "precision mediump float;\n" +
            "varying vec2 vTextureCoord;\n" +
            "uniform samplerExternalOES sTexture;\n" +
            "void main() {\n" +
            "  gl_FragColor = texture2D(sTexture, vTextureCoord);\n" +
            "}\n";

        private static final float[] TRIANGLE_VERTICES = {
            -1.0f, -1.0f, 0.0f, 0.0f, 0.0f,
             1.0f, -1.0f, 0.0f, 1.0f, 0.0f,
            -1.0f,  1.0f, 0.0f, 0.0f, 1.0f,
             1.0f,  1.0f, 0.0f, 1.0f, 1.0f,
        };

        private final FloatBuffer triangleVertices;
        private final float[] mvpMatrix = new float[16];
        private final float[] stMatrix = new float[16];
        private final int program;
        private final int textureId;
        private final int mvpHandle;
        private final int stHandle;
        private final int posHandle;
        private final int texHandle;
        private SurfaceTexture surfaceTexture;
        private Surface surface;
        private final Object frameSyncObject = new Object();
        private boolean frameAvailable = false;

        CodecOutputSurface(int width, int height) {
            triangleVertices = ByteBuffer.allocateDirect(TRIANGLE_VERTICES.length * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer();
            triangleVertices.put(TRIANGLE_VERTICES).position(0);
            Matrix.setIdentityM(mvpMatrix, 0);
            Matrix.setIdentityM(stMatrix, 0);

            int vs = loadShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER);
            int fs = loadShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER);
            program = GLES20.glCreateProgram();
            GLES20.glAttachShader(program, vs);
            GLES20.glAttachShader(program, fs);
            GLES20.glLinkProgram(program);

            posHandle = GLES20.glGetAttribLocation(program, "aPosition");
            texHandle = GLES20.glGetAttribLocation(program, "aTextureCoord");
            mvpHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix");
            stHandle = GLES20.glGetUniformLocation(program, "uSTMatrix");

            int[] textures = new int[1];
            GLES20.glGenTextures(1, textures, 0);
            textureId = textures[0];
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
            GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);

            GLES20.glViewport(0, 0, width, height);
            surfaceTexture = new SurfaceTexture(textureId);
            surfaceTexture.setOnFrameAvailableListener(this);
            surface = new Surface(surfaceTexture);
        }

        private static int loadShader(int type, String src) {
            int shader = GLES20.glCreateShader(type);
            GLES20.glShaderSource(shader, src);
            GLES20.glCompileShader(shader);
            return shader;
        }

        Surface getSurface() {
            return surface;
        }

        @Override
        public void onFrameAvailable(SurfaceTexture st) {
            synchronized (frameSyncObject) {
                frameAvailable = true;
                frameSyncObject.notifyAll();
            }
        }

        void awaitNewImage() {
            synchronized (frameSyncObject) {
                while (!frameAvailable) {
                    try {
                        frameSyncObject.wait(2500);
                        if (!frameAvailable) break;
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
                frameAvailable = false;
            }
            surfaceTexture.updateTexImage();
            surfaceTexture.getTransformMatrix(stMatrix);
        }

        void drawImage() {
            GLES20.glUseProgram(program);
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);

            triangleVertices.position(0);
            GLES20.glVertexAttribPointer(posHandle, 3, GLES20.GL_FLOAT, false, 20, triangleVertices);
            GLES20.glEnableVertexAttribArray(posHandle);

            triangleVertices.position(3);
            GLES20.glVertexAttribPointer(texHandle, 2, GLES20.GL_FLOAT, false, 20, triangleVertices);
            GLES20.glEnableVertexAttribArray(texHandle);

            GLES20.glUniformMatrix4fv(mvpHandle, 1, false, mvpMatrix, 0);
            GLES20.glUniformMatrix4fv(stHandle, 1, false, stMatrix, 0);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        }

        void release() {
            if (surface != null) {
                surface.release();
                surface = null;
            }
            if (surfaceTexture != null) {
                surfaceTexture.release();
                surfaceTexture = null;
            }
        }
    }
}
