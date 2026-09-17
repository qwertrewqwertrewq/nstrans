package com.example.androidscreenclient;

import android.app.Activity;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.AudioManager;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.media.tv.TvView;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Android 6 HDMI input proof of concept.
 *
 * The video is rendered by the platform TvView. The TextView is a regular
 * application layer above it, proving that arbitrary UI can be composited
 * over the HDMI signal when the device exposes HDMI through TV Input Framework.
 */
public final class MainActivity extends Activity {
    private static final String TAG = "HdmiOverlayTest";

    private FrameLayout root;
    private TvView tvView;
    private TestPatternView testPattern;
    private SubtitleOverlayView subtitleView;
    private TextView status;
    private Button overlayModeButton;
    private boolean subtitleReceiverRegistered;
    private boolean overlayPermissionRequestPending;
    private AudioManager audioManager;
    private boolean ownsAudioFocus;
    private final List<TvInputInfo> hdmiInputs = new ArrayList<>();
    private int selectedInput = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        enterImmersiveMode();
        createUi();
        startService(new Intent(this, OverlayService.class));
        discoverAndTune();
    }

    private void createUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        testPattern = new TestPatternView(this);
        root.addView(testPattern, matchParent());

        tvView = new TvView(this);
        tvView.setBackgroundColor(Color.TRANSPARENT);
        tvView.setCallback(new TvView.TvInputCallback() {
            @Override
            public void onVideoAvailable(String inputId) {
                testPattern.setVisibility(View.GONE);
                requestHdmiAudioFocus();
                setStatus("HDMI 画面已连接  •  声音" + (ownsAudioFocus ? "已启用" : "焦点获取失败") + "  •  " + inputId, false);
                Log.i(TAG, "Video available: " + inputId);
            }

            @Override
            public void onVideoUnavailable(String inputId, int reason) {
                testPattern.setVisibility(View.VISIBLE);
                setStatus("HDMI 暂无画面（reason=" + reason + "）\n" + inputId, true);
                Log.w(TAG, "Video unavailable: " + inputId + ", reason=" + reason);
            }

            @Override
            public void onConnectionFailed(String inputId) {
                testPattern.setVisibility(View.VISIBLE);
                setStatus("无法连接 HDMI 输入\n" + inputId, true);
                Log.e(TAG, "Connection failed: " + inputId);
            }

            @Override
            public void onDisconnected(String inputId) {
                testPattern.setVisibility(View.VISIBLE);
                setStatus("HDMI 输入已断开\n" + inputId, true);
                Log.w(TAG, "Disconnected: " + inputId);
            }
        });
        root.addView(tvView, matchParent());

        subtitleView = new SubtitleOverlayView(this);
        root.addView(subtitleView, matchParent());

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(15);
        status.setPadding(dp(14), dp(8), dp(14), dp(8));
        status.setBackgroundColor(0x99000000);
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusParams.gravity = Gravity.BOTTOM | Gravity.LEFT;
        statusParams.leftMargin = dp(20);
        statusParams.bottomMargin = dp(18);
        root.addView(status, statusParams);

        overlayModeButton = new Button(this);
        overlayModeButton.setTextSize(15);
        overlayModeButton.setFocusable(true);
        overlayModeButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { toggleExternalOverlay(); }
        });
        FrameLayout.LayoutParams buttonParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.gravity = Gravity.BOTTOM | Gravity.RIGHT;
        buttonParams.rightMargin = dp(20);
        buttonParams.bottomMargin = dp(18);
        root.addView(overlayModeButton, buttonParams);

        setContentView(root);
        updateOverlayModeUi();
    }

    private final BroadcastReceiver subtitleReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (OverlayService.ACTION_SUBTITLE_CLEAR.equals(intent.getAction())) {
                subtitleView.clearOverlay();
                return;
            }
            if (!OverlayService.ACTION_SUBTITLE_UPDATE.equals(intent.getAction())) return;
            String payload = intent.getStringExtra(OverlayService.EXTRA_PAYLOAD);
            if (payload == null) return;
            try {
                subtitleView.applyPayload(new JSONObject(payload));
            } catch (Exception error) {
                Log.w(TAG, "Invalid in-app subtitle payload", error);
            }
        }
    };

    private boolean externalOverlayEnabled() {
        return externalOverlayRequested() && Settings.canDrawOverlays(this);
    }

    private boolean externalOverlayRequested() {
        return getSharedPreferences(OverlayService.PREFERENCES, Context.MODE_PRIVATE)
                .getBoolean(OverlayService.PREFERENCE_EXTERNAL_OVERLAY, false);
    }

    private void updateOverlayModeUi() {
        boolean external = externalOverlayEnabled();
        subtitleView.setPresentationEnabled(!external);
        overlayModeButton.setText(external ? "切换为仅 App 内字幕" : "尝试启用 App 外字幕");
        overlayModeButton.setContentDescription(external ? "关闭 App 外悬浮字幕" : "申请悬浮窗权限并启用 App 外字幕");
    }

    private void toggleExternalOverlay() {
        if (externalOverlayEnabled()) {
            getSharedPreferences(OverlayService.PREFERENCES, Context.MODE_PRIVATE).edit()
                    .putBoolean(OverlayService.PREFERENCE_EXTERNAL_OVERLAY, false).apply();
            startService(new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_DISABLE_EXTERNAL));
            updateOverlayModeUi();
            setStatus("已切换为仅 App 内字幕；系统悬浮窗授权仍保留，可随时重新启用", false);
            return;
        }
        if (Settings.canDrawOverlays(this)) {
            enableExternalOverlay();
            return;
        }
        overlayPermissionRequestPending = true;
        try {
            Intent permission = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivity(permission);
            setStatus("请在系统页面允许 NSTrans TV 显示在其他应用上；返回后会自动启用", true);
        } catch (RuntimeException error) {
            overlayPermissionRequestPending = false;
            setStatus("此设备无法打开悬浮窗授权页面；字幕继续仅在 App 内显示", true);
            Log.w(TAG, "Overlay permission settings are unavailable", error);
        }
    }

    private void enableExternalOverlay() {
        getSharedPreferences(OverlayService.PREFERENCES, Context.MODE_PRIVATE).edit()
                .putBoolean(OverlayService.PREFERENCE_EXTERNAL_OVERLAY, true).apply();
        startService(new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_ENABLE_EXTERNAL));
        updateOverlayModeUi();
        setStatus("App 外字幕已启用；现在可以切换到其他 HDMI 应用", false);
    }

    private void discoverAndTune() {
        TvInputManager manager = (TvInputManager) getSystemService(Context.TV_INPUT_SERVICE);
        hdmiInputs.clear();
        if (manager != null) {
            List<TvInputInfo> allInputs = manager.getTvInputList();
            Log.i(TAG, "TV inputs found: " + allInputs.size());
            for (TvInputInfo input : allInputs) {
                Log.i(TAG, "Input id=" + input.getId() + ", type=" + input.getType()
                        + ", passthrough=" + input.isPassthroughInput());
                if (input.getType() == TvInputInfo.TYPE_HDMI || input.isPassthroughInput()) {
                    hdmiInputs.add(input);
                }
            }
        }

        if (hdmiInputs.isEmpty()) {
            testPattern.setVisibility(View.VISIBLE);
            setStatus("未发现系统 HDMI 输入\nTV Input Framework 未注册 HDMI；叠加层本身工作正常", true);
            return;
        }
        selectedInput = 0;
        tuneSelectedInput();
    }

    private void tuneSelectedInput() {
        TvInputInfo input = hdmiInputs.get(selectedInput);
        Uri passthroughUri = TvContract.buildChannelUriForPassthroughInput(input.getId());
        testPattern.setVisibility(View.VISIBLE);
        setStatus("正在连接 HDMI " + (selectedInput + 1) + "/" + hdmiInputs.size()
                + "\n" + input.getId(), true);
        Log.i(TAG, "Tuning " + passthroughUri);
        requestHdmiAudioFocus();
        tvView.setStreamVolume(ownsAudioFocus ? 1.0f : 0.0f);
        tvView.tune(input.getId(), passthroughUri);
    }

    private final AudioManager.OnAudioFocusChangeListener audioFocusListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override
        public void onAudioFocusChange(final int focusChange) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    ownsAudioFocus = focusChange == AudioManager.AUDIOFOCUS_GAIN;
                    if (tvView != null) tvView.setStreamVolume(ownsAudioFocus ? 1.0f : 0.0f);
                    Log.i(TAG, "HDMI audio focus changed: " + focusChange + ", enabled=" + ownsAudioFocus);
                }
            });
        }
    };

    @SuppressWarnings("deprecation")
    private void requestHdmiAudioFocus() {
        if (audioManager == null) return;
        int result = audioManager.requestAudioFocus(
                audioFocusListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN);
        ownsAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        if (tvView != null) tvView.setStreamVolume(ownsAudioFocus ? 1.0f : 0.0f);
        Log.i(TAG, "HDMI audio focus request: " + result + ", musicVolume="
                + audioManager.getStreamVolume(AudioManager.STREAM_MUSIC));
    }

    @SuppressWarnings("deprecation")
    private void abandonHdmiAudioFocus() {
        if (audioManager != null && ownsAudioFocus) audioManager.abandonAudioFocus(audioFocusListener);
        ownsAudioFocus = false;
        if (tvView != null) tvView.setStreamVolume(0.0f);
    }

    private void selectNextInput() {
        if (hdmiInputs.isEmpty()) {
            discoverAndTune();
            return;
        }
        selectedInput = (selectedInput + 1) % hdmiInputs.size();
        tvView.reset();
        tuneSelectedInput();
    }

    private void setStatus(String message, boolean persistent) {
        status.setText(message + "\n字幕接收端口：38471  •  确定键：切换输入  •  菜单键：显示/隐藏设置");
        status.setVisibility(View.VISIBLE);
        status.removeCallbacks(hideStatus);
        if (!persistent) {
            status.postDelayed(hideStatus, 5000);
        }
    }

    private final Runnable hideStatus = new Runnable() {
        @Override
        public void run() {
            status.setVisibility(View.GONE);
        }
    };

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            selectNextInput();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            int next = overlayModeButton.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE;
            overlayModeButton.setVisibility(next);
            status.setVisibility(next);
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (overlayPermissionRequestPending) {
            overlayPermissionRequestPending = false;
            if (Settings.canDrawOverlays(this)) enableExternalOverlay();
            else setStatus("未授予悬浮窗权限；字幕继续仅在 App 内显示", false);
        } else if (!Settings.canDrawOverlays(this) && externalOverlayRequested()) {
            getSharedPreferences(OverlayService.PREFERENCES, Context.MODE_PRIVATE).edit()
                    .putBoolean(OverlayService.PREFERENCE_EXTERNAL_OVERLAY, false).apply();
            startService(new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_DISABLE_EXTERNAL));
        }
        updateOverlayModeUi();
        if (selectedInput >= 0) requestHdmiAudioFocus();
    }

    @Override
    protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter();
        filter.addAction(OverlayService.ACTION_SUBTITLE_UPDATE);
        filter.addAction(OverlayService.ACTION_SUBTITLE_CLEAR);
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerReceiver(subtitleReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(subtitleReceiver, filter);
        }
        subtitleReceiverRegistered = true;
        startService(new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_SYNC_SUBTITLE));
    }

    @Override
    protected void onStop() {
        if (subtitleReceiverRegistered) {
            unregisterReceiver(subtitleReceiver);
            subtitleReceiverRegistered = false;
        }
        if (!externalOverlayRequested()) stopService(new Intent(this, OverlayService.class));
        super.onStop();
    }

    @Override
    protected void onPause() {
        abandonHdmiAudioFocus();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        abandonHdmiAudioFocus();
        tvView.reset();
        super.onDestroy();
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** Visible fallback proving the app and overlay work even without HDMI access. */
    private static final class TestPatternView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final int[] colors = {
                0xffeeeeee, 0xffffff00, 0xff00ffff, 0xff00ff00,
                0xffff00ff, 0xffff0000, 0xff0000ff, 0xff202020
        };

        TestPatternView(Context context) {
            super(context);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int width = getWidth();
            int barWidth = Math.max(1, width / colors.length);
            for (int i = 0; i < colors.length; i++) {
                paint.setColor(colors[i]);
                int right = i == colors.length - 1 ? width : (i + 1) * barWidth;
                canvas.drawRect(new Rect(i * barWidth, 0, right, getHeight()), paint);
            }
        }
    }
}
