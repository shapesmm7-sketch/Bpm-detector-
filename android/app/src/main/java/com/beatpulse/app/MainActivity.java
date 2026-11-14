package com.beatpulse.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioLibraryPlugin.class);
        super.onCreate(savedInstanceState);
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
            AudioLibraryPlugin.applyStoredAppearance(this, this.bridge.getWebView());
        } else {
            AudioLibraryPlugin.applyStoredAppearance(this, null);
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (this.bridge != null) {
            PluginHandle handle = this.bridge.getPlugin("AudioLibrary");
            if (handle != null && handle.getInstance() instanceof AudioLibraryPlugin) {
                ((AudioLibraryPlugin) handle.getInstance()).handleExternalIntent(intent);
            }
        }
    }
}
