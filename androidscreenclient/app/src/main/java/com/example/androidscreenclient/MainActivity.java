package com.example.androidscreenclient;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
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
import android.widget.TextView;

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
    private TextView overlay;
    private TextView status;
    private final List<TvInputInfo> hdmiInputs = new ArrayList<>();
    private int selectedInput = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
                setStatus("HDMI 画面已连接  •  " + inputId, false);
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

        overlay = new TextView(this);
        overlay.setText("NSTrans TV · 等待局域网字幕");
        overlay.setTextColor(Color.WHITE);
        overlay.setTextSize(28);
        overlay.setGravity(Gravity.CENTER);
        overlay.setShadowLayer(5f, 2f, 2f, Color.BLACK);
        overlay.setBackgroundColor(0x88000000);
        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(64));
        overlayParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        overlayParams.topMargin = dp(36);
        overlay.setPadding(dp(28), 0, dp(28), 0);
        // Without overlay permission this remains the in-Activity fallback. Once
        // permission is granted, OverlayService owns the single persistent label.
        if (!Settings.canDrawOverlays(this)) {
            root.addView(overlay, overlayParams);
        }

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

        setContentView(root);
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
        tvView.tune(input.getId(), passthroughUri);
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
        status.setText(message + "\n字幕接收端口：38471  •  确定键：切换输入  •  菜单键：显示/隐藏提示");
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
            int next = overlay.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE;
            overlay.setVisibility(next);
            status.setVisibility(next);
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
    }

    @Override
    protected void onDestroy() {
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
