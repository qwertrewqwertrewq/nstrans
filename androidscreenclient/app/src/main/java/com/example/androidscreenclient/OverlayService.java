package com.example.androidscreenclient;

import android.app.Service;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** Receives NSTrans subtitle layers and keeps them above the vendor HDMI app. */
public final class OverlayService extends Service {
    private static final String TAG = "NSTransTvClient";
    static final String ACTION_SUBTITLE_UPDATE = "com.example.androidscreenclient.SUBTITLE_UPDATE";
    static final String ACTION_SUBTITLE_CLEAR = "com.example.androidscreenclient.SUBTITLE_CLEAR";
    static final String ACTION_SYNC_SUBTITLE = "com.example.androidscreenclient.SYNC_SUBTITLE";
    static final String ACTION_ENABLE_EXTERNAL = "com.example.androidscreenclient.ENABLE_EXTERNAL";
    static final String ACTION_DISABLE_EXTERNAL = "com.example.androidscreenclient.DISABLE_EXTERNAL";
    static final String EXTRA_PAYLOAD = "payload";
    static final String PREFERENCES = "nstrans-tv";
    static final String PREFERENCE_EXTERNAL_OVERLAY = "external-overlay-enabled";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int RECEIVER_PORT = 38471;
    private static final int DISCOVERY_PORT = 38472;
    private static final int MAX_BODY_BYTES = 12 * 1024 * 1024;
    private static final int NOTIFICATION_ID = 38471;
    private static final String NOTIFICATION_CHANNEL = "nstrans-tv-overlay";

    private volatile boolean running;
    private volatile String sessionToken;
    private WindowManager windowManager;
    private SubtitleOverlayView overlayView;
    private Thread serverThread;
    private Thread announcementThread;
    private ServerSocket serverSocket;
    private String receiverId;
    private volatile String lastPayload;

    @Override
    public void onCreate() {
        super.onCreate();
        SharedPreferences preferences = getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        receiverId = preferences.getString("receiver-id", null);
        if (receiverId == null) {
            receiverId = UUID.randomUUID().toString();
            preferences.edit().putString("receiver-id", receiverId).apply();
        }
        refreshOverlayMode();
        startReceiver();
    }

    private void showOverlay() {
        if (overlayView != null) return;
        if (!externalOverlayEnabled()) return;
        if (!Settings.canDrawOverlays(this)) {
            disableExternalOverlay();
            Log.w(TAG, "SYSTEM_ALERT_WINDOW is not granted; using in-app subtitles");
            return;
        }
        overlayView = new SubtitleOverlayView(this);
        int windowType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_SYSTEM_ALERT;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                windowType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.LEFT;
        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            windowManager.addView(overlayView, params);
            String payload = lastPayload;
            if (payload != null) overlayView.applyPayload(new JSONObject(payload));
            Log.i(TAG, "Persistent subtitle overlay attached");
        } catch (Exception error) {
            overlayView = null;
            disableExternalOverlay();
            Log.e(TAG, "Unable to attach persistent overlay", error);
        }
    }

    private boolean externalOverlayEnabled() {
        return getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .getBoolean(PREFERENCE_EXTERNAL_OVERLAY, false);
    }

    private void disableExternalOverlay() {
        getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
                .putBoolean(PREFERENCE_EXTERNAL_OVERLAY, false).apply();
        removeOverlay();
        stopForeground(true);
    }

    private void removeOverlay() {
        if (overlayView != null && windowManager != null) {
            try { windowManager.removeView(overlayView); } catch (RuntimeException ignored) { }
        }
        overlayView = null;
        windowManager = null;
    }

    private void refreshOverlayMode() {
        if (externalOverlayEnabled() && Settings.canDrawOverlays(this)) {
            startForeground(NOTIFICATION_ID, buildOverlayNotification());
            showOverlay();
        } else {
            removeOverlay();
            stopForeground(true);
        }
    }

    private Notification buildOverlayNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
            NotificationChannel channel = new NotificationChannel(
                    NOTIFICATION_CHANNEL, "NSTrans TV App 外字幕", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("保持局域网字幕接收与 App 外悬浮显示");
            manager.createNotificationChannel(channel);
        }
        Intent openApp = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openApp, pendingFlags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, NOTIFICATION_CHANNEL)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setContentTitle("NSTrans TV App 外字幕运行中")
                .setContentText("点击返回应用，或在应用内切换为仅 App 内字幕")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    private void broadcastSubtitle(String action, String payload) {
        Intent intent = new Intent(action).setPackage(getPackageName());
        if (payload != null) intent.putExtra(EXTRA_PAYLOAD, payload);
        sendBroadcast(intent);
    }

    private void startReceiver() {
        if (running) return;
        running = true;
        serverThread = new Thread(new Runnable() {
            @Override public void run() { runServer(); }
        }, "nstrans-tv-server");
        serverThread.start();
        announcementThread = new Thread(new Runnable() {
            @Override public void run() { runAnnouncements(); }
        }, "nstrans-tv-announcements");
        announcementThread.start();
    }

    private void runServer() {
        try (ServerSocket server = new ServerSocket(RECEIVER_PORT)) {
            serverSocket = server;
            server.setReuseAddress(true);
            Log.i(TAG, "Subtitle receiver listening on " + RECEIVER_PORT);
            while (running) {
                final Socket socket = server.accept();
                new Thread(new Runnable() {
                    @Override public void run() { handle(socket); }
                }, "nstrans-tv-request").start();
            }
        } catch (IOException error) {
            if (running) Log.e(TAG, "Subtitle receiver stopped", error);
        } finally {
            serverSocket = null;
        }
    }

    private void runAnnouncements() {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            while (running) {
                JSONObject message = new JSONObject();
                message.put("protocol", "nstrans-tv-v1");
                message.put("id", receiverId);
                message.put("name", Build.MANUFACTURER + " " + Build.MODEL);
                message.put("port", RECEIVER_PORT);
                byte[] bytes = message.toString().getBytes(UTF8);
                DatagramPacket packet = new DatagramPacket(bytes, bytes.length, InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT);
                socket.send(packet);
                Thread.sleep(2000L);
            }
        } catch (Exception error) {
            if (running) Log.e(TAG, "Discovery announcements stopped", error);
        } finally {
            if (socket != null) socket.close();
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(5000);
            BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] requestParts = requestLine.split(" ");
            String path = requestParts.length > 1 ? requestParts[1] : "";
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(input)) != null && line.length() > 0) {
                int colon = line.indexOf(':');
                if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(Locale.US), line.substring(colon + 1).trim());
            }
            int length = parseLength(headers.get("content-length"));
            if (length < 0 || length > MAX_BODY_BYTES) {
                respond(socket, 413, jsonError("字幕数据过大"));
                return;
            }
            byte[] body = readBody(input, length);
            JSONObject payload = body.length == 0 ? new JSONObject() : new JSONObject(new String(body, UTF8));
            if ("/handshake".equals(path)) {
                sessionToken = UUID.randomUUID().toString();
                JSONObject response = new JSONObject();
                response.put("protocol", "nstrans-tv-v1");
                response.put("name", Build.MANUFACTURER + " " + Build.MODEL);
                response.put("token", sessionToken);
                response.put("inAppSubtitles", true);
                // Legacy NSTrans senders only inspect overlayPermission and reject the receiver
                // when it is false. Since this TV client can always render subtitles in its own
                // Activity, expose the aggregate display capability through the legacy field.
                // Keep the actual Android system-overlay permission in a separate field.
                response.put("overlayPermission", true);
                response.put("systemOverlayPermission", Settings.canDrawOverlays(this));
                response.put("externalOverlayEnabled", externalOverlayEnabled());
                respond(socket, 200, response);
                Log.i(TAG, "NSTrans controller paired");
            } else if (!authorized(payload)) {
                respond(socket, 403, jsonError("握手令牌无效"));
            } else if ("/overlay".equals(path)) {
                final JSONObject update = payload;
                lastPayload = update.toString();
                broadcastSubtitle(ACTION_SUBTITLE_UPDATE, lastPayload);
                if (overlayView != null) overlayView.post(new Runnable() {
                    @Override public void run() { overlayView.applyPayload(update); }
                });
                respond(socket, 200, jsonOk());
            } else if ("/clear".equals(path)) {
                lastPayload = null;
                broadcastSubtitle(ACTION_SUBTITLE_CLEAR, null);
                if (overlayView != null) overlayView.post(new Runnable() {
                    @Override public void run() { overlayView.clearOverlay(); }
                });
                respond(socket, 200, jsonOk());
            } else {
                respond(socket, 404, jsonError("未知接口"));
            }
        } catch (Exception error) {
            Log.w(TAG, "Invalid receiver request", error);
            try { respond(socket, 400, jsonError("请求格式无效")); } catch (Exception ignored) { }
        } finally {
            try { socket.close(); } catch (IOException ignored) { }
        }
    }

    private boolean authorized(JSONObject payload) {
        return sessionToken != null && sessionToken.equals(payload.optString("token", ""));
    }

    private static String readLine(BufferedInputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int value = -1;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.write(value);
            if (line.size() > 8192) throw new IOException("HTTP header line too long");
        }
        return value == -1 && line.size() == 0 ? null : new String(line.toByteArray(), UTF8);
    }

    private static int parseLength(String value) {
        if (value == null) return 0;
        try { return Integer.parseInt(value); } catch (NumberFormatException error) { return -1; }
    }

    private static byte[] readBody(BufferedInputStream input, int length) throws IOException {
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(body, offset, length - offset);
            if (read < 0) throw new IOException("Unexpected end of request body");
            offset += read;
        }
        return body;
    }

    private static void respond(Socket socket, int status, JSONObject body) throws IOException {
        byte[] bytes = body.toString().getBytes(UTF8);
        String reason = status == 200 ? "OK" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 413 ? "Payload Too Large" : "Bad Request";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n";
        BufferedOutputStream output = new BufferedOutputStream(socket.getOutputStream());
        output.write(headers.getBytes(UTF8));
        output.write(bytes);
        output.flush();
    }

    private static JSONObject jsonOk() throws Exception {
        JSONObject value = new JSONObject();
        value.put("ok", true);
        return value;
    }

    private static JSONObject jsonError(String message) throws Exception {
        JSONObject value = new JSONObject();
        value.put("ok", false);
        value.put("error", message);
        return value;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_ENABLE_EXTERNAL.equals(action)) {
            getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
                    .putBoolean(PREFERENCE_EXTERNAL_OVERLAY, true).apply();
            refreshOverlayMode();
        } else if (ACTION_DISABLE_EXTERNAL.equals(action)) {
            disableExternalOverlay();
        } else if (ACTION_SYNC_SUBTITLE.equals(action)) {
            String payload = lastPayload;
            broadcastSubtitle(payload == null ? ACTION_SUBTITLE_CLEAR : ACTION_SUBTITLE_UPDATE, payload);
        } else {
            refreshOverlayMode();
        }
        if (!running) startReceiver();
        return externalOverlayEnabled() ? START_STICKY : START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (serverSocket != null) try { serverSocket.close(); } catch (IOException ignored) { }
        if (serverThread != null) serverThread.interrupt();
        if (announcementThread != null) announcementThread.interrupt();
        removeOverlay();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
