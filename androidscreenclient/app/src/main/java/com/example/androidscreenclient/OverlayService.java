package com.example.androidscreenclient;

import android.app.Service;
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
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int RECEIVER_PORT = 38471;
    private static final int DISCOVERY_PORT = 38472;
    private static final int MAX_BODY_BYTES = 12 * 1024 * 1024;

    private volatile boolean running;
    private volatile String sessionToken;
    private WindowManager windowManager;
    private SubtitleOverlayView overlayView;
    private Thread serverThread;
    private Thread announcementThread;
    private ServerSocket serverSocket;
    private String receiverId;

    @Override
    public void onCreate() {
        super.onCreate();
        SharedPreferences preferences = getSharedPreferences("nstrans-tv", Context.MODE_PRIVATE);
        receiverId = preferences.getString("receiver-id", null);
        if (receiverId == null) {
            receiverId = UUID.randomUUID().toString();
            preferences.edit().putString("receiver-id", receiverId).apply();
        }
        showOverlay();
        startReceiver();
    }

    private void showOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW is not granted; receiver remains visible but cannot draw subtitles");
            return;
        }
        overlayView = new SubtitleOverlayView(this);
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.LEFT;
        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            windowManager.addView(overlayView, params);
            Log.i(TAG, "Persistent subtitle overlay attached");
        } catch (RuntimeException error) {
            overlayView = null;
            Log.e(TAG, "Unable to attach persistent overlay", error);
        }
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
                response.put("overlayPermission", Settings.canDrawOverlays(this));
                respond(socket, 200, response);
                Log.i(TAG, "NSTrans controller paired");
            } else if (!authorized(payload)) {
                respond(socket, 403, jsonError("握手令牌无效"));
            } else if ("/overlay".equals(path)) {
                final JSONObject update = payload;
                if (overlayView != null) overlayView.post(new Runnable() {
                    @Override public void run() { overlayView.applyPayload(update); }
                });
                respond(socket, 200, jsonOk());
            } else if ("/clear".equals(path)) {
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
        if (overlayView == null) showOverlay();
        if (!running) startReceiver();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (serverSocket != null) try { serverSocket.close(); } catch (IOException ignored) { }
        if (serverThread != null) serverThread.interrupt();
        if (announcementThread != null) announcementThread.interrupt();
        if (overlayView != null && windowManager != null) {
            windowManager.removeView(overlayView);
            overlayView = null;
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
