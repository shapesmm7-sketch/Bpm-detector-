package com.beatpulse.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

public class MusicPlaybackService extends Service {

    public static final String CHANNEL_ID = "beatpulse_music_playback";
    public static final int NOTIFICATION_ID = 4401;

    public static final String ACTION_PLAY_QUEUE = "com.beatpulse.app.action.PLAY_QUEUE";
    public static final String ACTION_PLAY_PAUSE = "com.beatpulse.app.action.PLAY_PAUSE";
    public static final String ACTION_PAUSE = "com.beatpulse.app.action.PAUSE";
    public static final String ACTION_RESUME = "com.beatpulse.app.action.RESUME";
    public static final String ACTION_NEXT = "com.beatpulse.app.action.NEXT";
    public static final String ACTION_PREVIOUS = "com.beatpulse.app.action.PREVIOUS";
    public static final String ACTION_SEEK = "com.beatpulse.app.action.SEEK";
    public static final String ACTION_UPDATE_SETTINGS = "com.beatpulse.app.action.UPDATE_SETTINGS";
    public static final String ACTION_STOP = "com.beatpulse.app.action.STOP";

    public static final String EXTRA_SEEK_MS = "seekMs";
    public static final String EXTRA_OPEN_SECTION = "beatpulse_open_section";

    public static class TrackMeta {
        public String id;
        public String title;
        public String displayName;
        public String artist;
        public String album;
        public long durationMs;
        public long size;
        public String mimeType;
        public String uri;
    }

    public interface StateListener {
        void onPlaybackStateChanged(JSObject state);
    }

    private static final Object STATE_LOCK = new Object();
    private static List<TrackMeta> sharedQueue = new ArrayList<>();
    private static int sharedStartIndex = 0;
    private static boolean sharedShuffle = false;
    private static String sharedRepeatMode = "all";
    private static float sharedVolume = 1.0f;
    private static boolean sharedMuted = false;
    private static volatile MusicPlaybackService activeInstance;
    private static volatile StateListener stateListener;
    private static volatile JSObject lastSnapshot;

    public static void setQueueAndSettings(
        List<TrackMeta> queue,
        int index,
        boolean shuffle,
        String repeatMode,
        float volume,
        boolean muted
    ) {
        synchronized (STATE_LOCK) {
            sharedQueue = queue != null ? new ArrayList<>(queue) : new ArrayList<>();
            sharedStartIndex = Math.max(0, Math.min(index, Math.max(0, sharedQueue.size() - 1)));
            sharedShuffle = shuffle;
            sharedRepeatMode = (repeatMode != null && !repeatMode.isEmpty()) ? repeatMode : "all";
            sharedVolume = Math.max(0f, Math.min(1f, volume));
            sharedMuted = muted;
        }
    }

    public static void updateSettingsOnly(boolean shuffle, String repeatMode, float volume, boolean muted) {
        synchronized (STATE_LOCK) {
            sharedShuffle = shuffle;
            if (repeatMode != null && !repeatMode.isEmpty()) {
                sharedRepeatMode = repeatMode;
            }
            sharedVolume = Math.max(0f, Math.min(1f, volume));
            sharedMuted = muted;
        }
    }

    public static void updateQueueListOnly(List<TrackMeta> queue) {
        synchronized (STATE_LOCK) {
            if (queue == null) return;
            String activeId = null;
            if (sharedStartIndex >= 0 && sharedStartIndex < sharedQueue.size()) {
                activeId = sharedQueue.get(sharedStartIndex).id;
            }
            sharedQueue = new ArrayList<>(queue);
            if (activeId != null) {
                for (int i = 0; i < sharedQueue.size(); i++) {
                    if (activeId.equals(sharedQueue.get(i).id)) {
                        sharedStartIndex = i;
                        break;
                    }
                }
            }
        }
        MusicPlaybackService svc = activeInstance;
        if (svc != null) {
            svc.syncQueueFromShared();
        }
    }

    public static void setStateListener(StateListener listener) {
        stateListener = listener;
        MusicPlaybackService svc = activeInstance;
        if (listener != null && svc != null) {
            listener.onPlaybackStateChanged(svc.buildSnapshot());
        } else if (listener != null && lastSnapshot != null) {
            listener.onPlaybackStateChanged(lastSnapshot);
        }
    }

    public static JSObject getCurrentSnapshot() {
        MusicPlaybackService svc = activeInstance;
        if (svc != null) {
            return svc.buildSnapshot();
        }
        if (lastSnapshot != null) {
            return lastSnapshot;
        }
        JSObject empty = new JSObject();
        empty.put("hasTrack", false);
        empty.put("isPlaying", false);
        empty.put("isLoading", false);
        empty.put("positionMs", 0);
        empty.put("durationMs", 0);
        return empty;
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService prepareExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();
    private final AtomicLong loadGeneration = new AtomicLong(0);
    private final Random random = new Random();

    private MediaSession mediaSession;
    private MediaPlayer mediaPlayer;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private NotificationManager notificationManager;

    private List<TrackMeta> queue = new ArrayList<>();
    private int currentIndex = -1;
    private TrackMeta currentTrack = null;
    private Bitmap currentArtwork = null;
    private String currentArtworkTrackId = null;

    private boolean isPlaying = false;
    private boolean isPreparing = false;
    private boolean isDucked = false;
    private boolean resumeOnFocusGain = false;
    private boolean hasAudioFocus = false;
    private long currentDurationMs = 0L;
    private long lastKnownPositionMs = 0L;

    private boolean isShuffle = false;
    private String repeatMode = "all";
    private float volume = 1.0f;
    private boolean isMuted = false;
    private boolean receiverRegistered = false;

    private final Runnable progressTickRunnable = new Runnable() {
        @Override
        public void run() {
            if (mediaPlayer != null && isPlaying) {
                try {
                    lastKnownPositionMs = Math.max(0L, mediaPlayer.getCurrentPosition());
                    if (currentDurationMs <= 0L) {
                        int d = mediaPlayer.getDuration();
                        if (d > 0) currentDurationMs = d;
                    }
                    notifyJsState();
                } catch (Exception ignored) {
                    // ignore transient position query failure
                }
                mainHandler.postDelayed(this, 300L);
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange -> {
        mainHandler.post(() -> {
            switch (focusChange) {
                case AudioManager.AUDIOFOCUS_LOSS:
                    hasAudioFocus = false;
                    resumeOnFocusGain = false;
                    isDucked = false;
                    pauseInternal(false);
                    break;
                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                    if (isPlaying) {
                        resumeOnFocusGain = true;
                        pauseInternal(false);
                    }
                    break;
                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                    isDucked = true;
                    applyEffectiveVolume();
                    break;
                case AudioManager.AUDIOFOCUS_GAIN:
                    hasAudioFocus = true;
                    isDucked = false;
                    applyEffectiveVolume();
                    if (resumeOnFocusGain) {
                        resumeOnFocusGain = false;
                        resumeInternal();
                    }
                    break;
            }
        });
    };

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                mainHandler.post(() -> {
                    resumeOnFocusGain = false;
                    pauseInternal(false);
                });
            }
        }
    };

    private final MediaSession.Callback mediaSessionCallback = new MediaSession.Callback() {
        @Override
        public void onPlay() {
            mainHandler.post(() -> resumeInternal());
        }

        @Override
        public void onPause() {
            mainHandler.post(() -> pauseInternal(false));
        }

        @Override
        public void onSkipToNext() {
            mainHandler.post(() -> stepTrack(1, true));
        }

        @Override
        public void onSkipToPrevious() {
            mainHandler.post(() -> stepTrack(-1, true));
        }

        @Override
        public void onSeekTo(long pos) {
            mainHandler.post(() -> seekToInternal(pos));
        }

        @Override
        public void onStop() {
            mainHandler.post(() -> stopPlaybackAndService());
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        createNotificationChannel();
        initMediaSession();

        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            ContextCompat.registerReceiver(this, noisyReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
            receiverRegistered = true;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureForegroundImmediate();

        String action = intent != null ? intent.getAction() : null;
        if (action == null) {
            return START_NOT_STICKY;
        }

        switch (action) {
            case ACTION_PLAY_QUEUE: {
                syncQueueFromShared();
                int targetIdx;
                synchronized (STATE_LOCK) {
                    targetIdx = sharedStartIndex;
                    isShuffle = sharedShuffle;
                    repeatMode = sharedRepeatMode;
                    volume = sharedVolume;
                    isMuted = sharedMuted;
                }
                loadAndPlayIndex(targetIdx, true);
                break;
            }
            case ACTION_PLAY_PAUSE: {
                if (isPlaying) {
                    pauseInternal(false);
                } else {
                    resumeInternal();
                }
                break;
            }
            case ACTION_PAUSE: {
                pauseInternal(false);
                break;
            }
            case ACTION_RESUME: {
                resumeInternal();
                break;
            }
            case ACTION_NEXT: {
                stepTrack(1, true);
                break;
            }
            case ACTION_PREVIOUS: {
                stepTrack(-1, true);
                break;
            }
            case ACTION_SEEK: {
                long seekMs = intent != null ? intent.getLongExtra(EXTRA_SEEK_MS, 0L) : 0L;
                seekToInternal(seekMs);
                break;
            }
            case ACTION_UPDATE_SETTINGS: {
                synchronized (STATE_LOCK) {
                    isShuffle = sharedShuffle;
                    repeatMode = sharedRepeatMode;
                    volume = sharedVolume;
                    isMuted = sharedMuted;
                }
                applyEffectiveVolume();
                notifyJsState();
                break;
            }
            case ACTION_STOP: {
                stopPlaybackAndService();
                break;
            }
        }

        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        activeInstance = null;
        mainHandler.removeCallbacks(progressTickRunnable);
        loadGeneration.incrementAndGet();

        if (receiverRegistered) {
            try {
                unregisterReceiver(noisyReceiver);
            } catch (Exception ignored) {
                // ignore
            }
            receiverRegistered = false;
        }

        releaseMediaPlayer();
        abandonAudioFocus();

        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }

        prepareExecutor.shutdownNow();
        artExecutor.shutdownNow();
        super.onDestroy();
    }

    private void syncQueueFromShared() {
        synchronized (STATE_LOCK) {
            this.queue = new ArrayList<>(sharedQueue);
            if (currentTrack != null) {
                for (int i = 0; i < this.queue.size(); i++) {
                    if (currentTrack.id != null && currentTrack.id.equals(this.queue.get(i).id)) {
                        this.currentIndex = i;
                        break;
                    }
                }
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && notificationManager != null) {
            NotificationChannel existing = notificationManager.getNotificationChannel(CHANNEL_ID);
            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Music Playback",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Persistent controls for background music playback");
                channel.setShowBadge(false);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        if (mediaSession != null) return;
        mediaSession = new MediaSession(this, "MoVibeMusicSession");
        mediaSession.setCallback(mediaSessionCallback, mainHandler);
        mediaSession.setSessionActivity(createOpenAudioPlayerIntent());
        mediaSession.setActive(true);
    }

    private PendingIntent createOpenAudioPlayerIntent() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_MAIN);
        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        launchIntent.putExtra(EXTRA_OPEN_SECTION, "audio");
        return PendingIntent.getActivity(
            this,
            100,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent createServiceActionIntent(String action, int requestCode) {
        Intent svcIntent = new Intent(this, MusicPlaybackService.class);
        svcIntent.setAction(action);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return PendingIntent.getForegroundService(
                this,
                requestCode,
                svcIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }
        return PendingIntent.getService(
            this,
            requestCode,
            svcIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void ensureForegroundImmediate() {
        initMediaSession();
        createNotificationChannel();
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
        } catch (Exception ignored) {
            // fallback handled on metadata update
        }
    }

    private boolean requestAudioFocus() {
        if (audioManager == null) return true;
        if (hasAudioFocus) return true;

        int res;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(false)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
                .build();
            res = audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            //noinspection deprecation
            res = audioManager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
        }

        hasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        return hasAudioFocus;
    }

    private void abandonAudioFocus() {
        hasAudioFocus = false;
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            //noinspection deprecation
            audioManager.abandonAudioFocus(focusChangeListener);
        }
    }

    private void loadAndPlayIndex(int index, boolean autoPlay) {
        if (queue.isEmpty()) {
            syncQueueFromShared();
        }
        if (queue.isEmpty()) {
            stopPlaybackAndService();
            return;
        }

        int safeIndex = Math.max(0, Math.min(index, queue.size() - 1));
        TrackMeta target = queue.get(safeIndex);

        currentIndex = safeIndex;
        synchronized (STATE_LOCK) {
            sharedStartIndex = safeIndex;
        }
        currentTrack = target;
        currentDurationMs = Math.max(0L, target.durationMs);
        lastKnownPositionMs = 0L;
        isPreparing = true;
        isPlaying = false;
        mainHandler.removeCallbacks(progressTickRunnable);

        if (!target.id.equals(currentArtworkTrackId)) {
            currentArtwork = null;
            currentArtworkTrackId = target.id;
            loadArtworkAsync(target);
        }

        updateMediaSessionMetadata();
        updateMediaSessionState();
        postOrUpdateNotification(true);
        notifyJsState();

        final long gen = loadGeneration.incrementAndGet();
        final TrackMeta loadTarget = target;

        prepareExecutor.execute(() -> {
            MediaPlayer nextMp = new MediaPlayer();
            try {
                nextMp.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
                nextMp.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                );

                Uri uri = Uri.parse(loadTarget.uri);
                boolean dataSet = false;
                try {
                    nextMp.setDataSource(getApplicationContext(), uri);
                    dataSet = true;
                } catch (Exception ignoredDirect) {
                    ContentResolver resolver = getContentResolver();
                    try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r")) {
                        if (pfd != null) {
                            nextMp.setDataSource(pfd.getFileDescriptor());
                            dataSet = true;
                        }
                    } catch (Exception ignoredPfd) {
                        dataSet = false;
                    }
                }

                if (!dataSet) {
                    throw new IllegalStateException("Could not open audio stream");
                }

                nextMp.prepare();

                mainHandler.post(() -> {
                    if (gen != loadGeneration.get() || activeInstance == null) {
                        try { nextMp.release(); } catch (Exception ignored) {}
                        return;
                    }

                    releaseMediaPlayer();
                    mediaPlayer = nextMp;
                    isPreparing = false;

                    int mpDur = nextMp.getDuration();
                    if (mpDur > 0) {
                        currentDurationMs = mpDur;
                    }
                    lastKnownPositionMs = 0L;
                    applyEffectiveVolume();

                    nextMp.setOnCompletionListener(mp -> handleTrackCompleted());
                    nextMp.setOnErrorListener((mp, what, extra) -> {
                        isPlaying = false;
                        isPreparing = false;
                        mainHandler.removeCallbacks(progressTickRunnable);
                        updateMediaSessionState();
                        postOrUpdateNotification(false);
                        notifyJsStateWithError("Could not play \"" + (currentTrack != null ? currentTrack.title : "track") + "\".");
                        return true;
                    });

                    if (autoPlay && requestAudioFocus()) {
                        try {
                            nextMp.start();
                            isPlaying = true;
                            mainHandler.post(progressTickRunnable);
                        } catch (Exception e) {
                            isPlaying = false;
                        }
                    }

                    updateMediaSessionMetadata();
                    updateMediaSessionState();
                    postOrUpdateNotification(isPlaying);
                    notifyJsState();
                });
            } catch (Exception err) {
                try { nextMp.release(); } catch (Exception ignored) {}
                mainHandler.post(() -> {
                    if (gen != loadGeneration.get()) return;
                    isPreparing = false;
                    isPlaying = false;
                    updateMediaSessionState();
                    postOrUpdateNotification(false);
                    notifyJsStateWithError("Could not play \"" + loadTarget.title + "\".");
                });
            }
        });
    }

    private void loadArtworkAsync(TrackMeta track) {
        final String targetId = track.id;
        artExecutor.execute(() -> {
            Bitmap bmp = AudioArtworkHelper.loadBitmapForNotification(
                getApplicationContext(),
                track.id,
                track.uri,
                track.title,
                track.artist
            );
            mainHandler.post(() -> {
                if (activeInstance == null || currentTrack == null || !targetId.equals(currentTrack.id)) {
                    return;
                }
                currentArtwork = bmp;
                currentArtworkTrackId = targetId;
                updateMediaSessionMetadata();
                postOrUpdateNotification(isPlaying);
            });
        });
    }

    private void resumeInternal() {
        if (currentTrack == null) {
            syncQueueFromShared();
            if (!queue.isEmpty()) {
                loadAndPlayIndex(currentIndex >= 0 ? currentIndex : 0, true);
            }
            return;
        }
        if (mediaPlayer == null) {
            if (!isPreparing) {
                loadAndPlayIndex(Math.max(0, currentIndex), true);
            }
            return;
        }
        if (requestAudioFocus()) {
            try {
                if (!mediaPlayer.isPlaying()) {
                    mediaPlayer.start();
                }
                isPlaying = true;
                applyEffectiveVolume();
                mainHandler.removeCallbacks(progressTickRunnable);
                mainHandler.post(progressTickRunnable);
                updateMediaSessionState();
                postOrUpdateNotification(true);
                notifyJsState();
            } catch (Exception ignored) {
                isPlaying = false;
            }
        }
    }

    private void pauseInternal(boolean updateFocus) {
        mainHandler.removeCallbacks(progressTickRunnable);
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    lastKnownPositionMs = Math.max(0L, mediaPlayer.getCurrentPosition());
                    mediaPlayer.pause();
                }
            } catch (Exception ignored) {
                // ignore
            }
        }
        isPlaying = false;
        if (updateFocus) {
            abandonAudioFocus();
        }
        updateMediaSessionState();
        postOrUpdateNotification(false);
        notifyJsState();
    }

    private void seekToInternal(long targetMs) {
        long clamped = Math.max(0L, currentDurationMs > 0 ? Math.min(currentDurationMs, targetMs) : targetMs);
        lastKnownPositionMs = clamped;
        if (mediaPlayer != null && !isPreparing) {
            try {
                mediaPlayer.seekTo((int) clamped);
            } catch (Exception ignored) {
                // ignore seek error
            }
        }
        updateMediaSessionState();
        notifyJsState();
    }

    private void stepTrack(int direction, boolean userInitiated) {
        if (queue.isEmpty()) {
            syncQueueFromShared();
        }
        if (queue.isEmpty()) return;

        if (isShuffle && queue.size() > 1) {
            int nextIdx = currentIndex;
            int guard = 0;
            while (nextIdx == currentIndex && guard < 8) {
                nextIdx = random.nextInt(queue.size());
                guard++;
            }
            if (nextIdx == currentIndex) {
                nextIdx = (currentIndex + 1) % queue.size();
            }
            loadAndPlayIndex(nextIdx, true);
            return;
        }

        int base = currentIndex >= 0 ? currentIndex : 0;
        int nextIdx = (base + direction + queue.size()) % queue.size();
        if (!userInitiated && direction > 0 && base >= queue.size() - 1 && "off".equals(repeatMode)) {
            pauseInternal(true);
            seekToInternal(0L);
            return;
        }
        loadAndPlayIndex(nextIdx, true);
    }

    private void handleTrackCompleted() {
        mainHandler.removeCallbacks(progressTickRunnable);
        if (currentTrack == null || queue.isEmpty()) {
            isPlaying = false;
            updateMediaSessionState();
            postOrUpdateNotification(false);
            notifyJsState();
            return;
        }

        if ("one".equals(repeatMode) && mediaPlayer != null) {
            try {
                mediaPlayer.seekTo(0);
                mediaPlayer.start();
                lastKnownPositionMs = 0L;
                isPlaying = true;
                mainHandler.post(progressTickRunnable);
                updateMediaSessionState();
                postOrUpdateNotification(true);
                notifyJsState();
                return;
            } catch (Exception ignored) {
                // fall through
            }
        }

        if (isShuffle && queue.size() > 1) {
            stepTrack(1, false);
            return;
        }

        if (currentIndex >= 0 && currentIndex < queue.size() - 1) {
            loadAndPlayIndex(currentIndex + 1, true);
        } else if ("all".equals(repeatMode)) {
            loadAndPlayIndex(0, true);
        } else {
            isPlaying = false;
            lastKnownPositionMs = 0L;
            if (mediaPlayer != null) {
                try {
                    mediaPlayer.seekTo(0);
                } catch (Exception ignored) {}
            }
            updateMediaSessionState();
            postOrUpdateNotification(false);
            notifyJsState();
        }
    }

    private void stopPlaybackAndService() {
        mainHandler.removeCallbacks(progressTickRunnable);
        loadGeneration.incrementAndGet();
        isPlaying = false;
        isPreparing = false;
        releaseMediaPlayer();
        abandonAudioFocus();
        currentTrack = null;
        currentIndex = -1;
        lastKnownPositionMs = 0L;
        currentDurationMs = 0L;

        if (mediaSession != null) {
            mediaSession.setPlaybackState(
                new PlaybackState.Builder()
                    .setState(PlaybackState.STATE_STOPPED, 0L, 0f)
                    .setActions(0L)
                    .build()
            );
            mediaSession.setActive(false);
        }

        lastSnapshot = buildSnapshot();
        if (stateListener != null) {
            stateListener.onPlaybackStateChanged(lastSnapshot);
        }

        stopForeground(STOP_FOREGROUND_REMOVE);
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
        stopSelf();
    }

    private void releaseMediaPlayer() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
            } catch (Exception ignored) {}
            try {
                mediaPlayer.reset();
            } catch (Exception ignored) {}
            try {
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
    }

    private void applyEffectiveVolume() {
        if (mediaPlayer == null) return;
        float base = isMuted ? 0f : volume;
        float effective = isDucked ? (base * 0.25f) : base;
        effective = Math.max(0f, Math.min(1f, effective));
        try {
            mediaPlayer.setVolume(effective, effective);
        } catch (Exception ignored) {
            // ignore
        }
    }

    private void updateMediaSessionMetadata() {
        if (mediaSession == null || currentTrack == null) return;

        Bitmap artwork = currentArtwork;
        if (artwork == null || artwork.isRecycled()) {
            artwork = AudioArtworkHelper.createGeneratedArtwork(
                currentTrack.title,
                currentTrack.artist,
                currentTrack.id
            );
        }

        MediaMetadata.Builder builder = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, currentTrack.title != null && !currentTrack.title.isEmpty() ? currentTrack.title : currentTrack.displayName)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, currentTrack.artist != null && !currentTrack.artist.isEmpty() ? currentTrack.artist : "Unknown Artist")
            .putString(MediaMetadata.METADATA_KEY_ALBUM, currentTrack.album != null ? currentTrack.album : "")
            .putLong(MediaMetadata.METADATA_KEY_DURATION, Math.max(0L, currentDurationMs))
            .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork)
            .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork);

        mediaSession.setMetadata(builder.build());
    }

    private void updateMediaSessionState() {
        if (mediaSession == null) return;

        int state;
        if (isPreparing) {
            state = PlaybackState.STATE_BUFFERING;
        } else if (isPlaying) {
            state = PlaybackState.STATE_PLAYING;
        } else if (currentTrack != null) {
            state = PlaybackState.STATE_PAUSED;
        } else {
            state = PlaybackState.STATE_STOPPED;
        }

        long actions = PlaybackState.ACTION_PLAY
            | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_PREVIOUS
            | PlaybackState.ACTION_SKIP_TO_NEXT
            | PlaybackState.ACTION_SEEK_TO
            | PlaybackState.ACTION_STOP;

        PlaybackState pbState = new PlaybackState.Builder()
            .setActions(actions)
            .setState(state, Math.max(0L, lastKnownPositionMs), isPlaying ? 1.0f : 0.0f)
            .build();

        mediaSession.setPlaybackState(pbState);
        if (!mediaSession.isActive() && currentTrack != null) {
            mediaSession.setActive(true);
        }
    }

    private Notification buildNotification() {
        String title = currentTrack != null
            ? (currentTrack.title != null && !currentTrack.title.isEmpty() ? currentTrack.title : currentTrack.displayName)
            : "Mo Vibe Music";
        String artist = currentTrack != null
            ? (currentTrack.artist != null && !currentTrack.artist.isEmpty() ? currentTrack.artist : "Unknown Artist")
            : "Ready to play";

        Bitmap largeIcon = (currentArtwork != null && !currentArtwork.isRecycled())
            ? currentArtwork
            : (currentTrack != null
                ? AudioArtworkHelper.createGeneratedArtwork(currentTrack.title, currentTrack.artist, currentTrack.id)
                : AudioArtworkHelper.createGeneratedArtwork("Mo Vibe", "Music", "movibe"));

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        Notification.Action prevAction = new Notification.Action.Builder(
            Icon.createWithResource(this, R.drawable.ic_media_previous),
            "Previous",
            createServiceActionIntent(ACTION_PREVIOUS, 101)
        ).build();

        Notification.Action playPauseAction = new Notification.Action.Builder(
            Icon.createWithResource(this, isPlaying ? R.drawable.ic_media_pause : R.drawable.ic_media_play),
            isPlaying ? "Pause" : "Play",
            createServiceActionIntent(ACTION_PLAY_PAUSE, 102)
        ).build();

        Notification.Action nextAction = new Notification.Action.Builder(
            Icon.createWithResource(this, R.drawable.ic_media_next),
            "Next",
            createServiceActionIntent(ACTION_NEXT, 103)
        ).build();

        Notification.MediaStyle style = new Notification.MediaStyle()
            .setShowActionsInCompactView(0, 1, 2);
        if (mediaSession != null) {
            style.setMediaSession(mediaSession.getSessionToken());
        }

        builder
            .setSmallIcon(R.drawable.ic_stat_music)
            .setLargeIcon(largeIcon)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(createOpenAudioPlayerIntent())
            .setDeleteIntent(createServiceActionIntent(ACTION_STOP, 104))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(isPlaying)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .setStyle(style);

        return builder.build();
    }

    private void postOrUpdateNotification(boolean promoteForeground) {
        Notification notification = buildNotification();
        if (promoteForeground) {
            try {
                startForeground(NOTIFICATION_ID, notification);
                return;
            } catch (Exception ignored) {
                // fallback to direct notify below
            }
        } else {
            try {
                stopForeground(STOP_FOREGROUND_DETACH);
            } catch (Exception ignored) {
                // ignore
            }
        }
        if (notificationManager != null) {
            try {
                notificationManager.notify(NOTIFICATION_ID, notification);
            } catch (SecurityException ignored) {
                // POST_NOTIFICATIONS denied on Android 13+; playback still continues safely
            } catch (Exception ignored) {
                // ignore
            }
        }
    }

    private JSObject buildSnapshot() {
        JSObject obj = new JSObject();
        obj.put("hasTrack", currentTrack != null);
        obj.put("trackId", currentTrack != null ? currentTrack.id : "");
        obj.put("trackUri", currentTrack != null ? currentTrack.uri : "");
        obj.put("title", currentTrack != null ? currentTrack.title : "");
        obj.put("displayName", currentTrack != null ? currentTrack.displayName : "");
        obj.put("artist", currentTrack != null ? currentTrack.artist : "");
        obj.put("album", currentTrack != null ? currentTrack.album : "");
        obj.put("isPlaying", isPlaying);
        obj.put("isLoading", isPreparing);
        obj.put("positionMs", Math.max(0L, lastKnownPositionMs));
        obj.put("durationMs", Math.max(0L, currentDurationMs));
        obj.put("isShuffle", isShuffle);
        obj.put("repeatMode", repeatMode);
        return obj;
    }

    private void notifyJsState() {
        JSObject snap = buildSnapshot();
        lastSnapshot = snap;
        if (stateListener != null) {
            stateListener.onPlaybackStateChanged(snap);
        }
    }

    private void notifyJsStateWithError(String errorMsg) {
        JSObject snap = buildSnapshot();
        snap.put("error", errorMsg);
        lastSnapshot = snap;
        if (stateListener != null) {
            stateListener.onPlaybackStateChanged(snap);
        }
    }
}
