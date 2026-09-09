package com.example.androidscreenclient;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.Base64;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Draws either a transparent PNG layer or normalized text regions. */
final class SubtitleOverlayView extends View {
    private final Paint background = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final List<Region> regions = new ArrayList<>();
    private Bitmap bitmap;
    private int canvasWidth = 1920;
    private int canvasHeight = 1080;
    private float opacity = 0.92f;
    private float fontScale = 1f;
    private long receivedAt;

    SubtitleOverlayView(Context context) {
        super(context);
        setBackgroundColor(Color.TRANSPARENT);
        text.setColor(Color.WHITE);
        text.setTypeface(Typeface.create("sans", Typeface.BOLD));
        text.setTextAlign(Paint.Align.CENTER);
        text.setShadowLayer(3f, 1f, 1f, Color.BLACK);
    }

    void applyPayload(JSONObject payload) {
        clearBitmap();
        regions.clear();
        canvasWidth = Math.max(1, payload.optInt("canvasWidth", 1920));
        canvasHeight = Math.max(1, payload.optInt("canvasHeight", 1080));
        JSONObject settings = payload.optJSONObject("settings");
        if (settings != null) {
            opacity = Math.max(0f, Math.min(1f, (float) settings.optDouble("opacity", 92d) / 100f));
            fontScale = Math.max(0.5f, Math.min(2f, (float) settings.optDouble("fontScale", 1d)));
        }
        if ("image".equals(payload.optString("mode"))) {
            String encoded = payload.optString("imageData", "");
            try {
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            } catch (RuntimeException ignored) { bitmap = null; }
        } else {
            JSONArray values = payload.optJSONArray("regions");
            if (values != null) for (int index = 0; index < values.length(); index++) {
                JSONObject value = values.optJSONObject(index);
                if (value != null && value.optString("text", "").length() > 0) regions.add(Region.from(value));
            }
        }
        receivedAt = System.currentTimeMillis();
        setVisibility(bitmap == null && regions.isEmpty() ? INVISIBLE : VISIBLE);
        invalidate();
    }

    void clearOverlay() {
        regions.clear();
        clearBitmap();
        setVisibility(INVISIBLE);
        invalidate();
    }

    private void clearBitmap() {
        if (bitmap != null) bitmap.recycle();
        bitmap = null;
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (bitmap != null) {
            canvas.drawBitmap(bitmap, null, new Rect(0, 0, getWidth(), getHeight()), null);
            return;
        }
        float sx = getWidth() / (float) canvasWidth;
        float sy = getHeight() / (float) canvasHeight;
        boolean animate = false;
        for (Region region : regions) {
            RectF box = new RectF(region.x0 * sx, region.y0 * sy, region.x1 * sx, region.y1 * sy);
            float textSize = Math.max(12f, box.height() * 0.82f * fontScale);
            text.setTextSize(textSize);
            text.setTypeface(Typeface.create("serif".equals(region.fontFamily) ? "serif" : "sans", Typeface.BOLD));
            background.setColor(Color.argb(Math.round(255f * opacity), 7, 10, 16));
            canvas.drawRect(box, background);
            float baseline = box.centerY() - (text.ascent() + text.descent()) / 2f;
            float measured = text.measureText(region.value);
            canvas.save();
            canvas.clipRect(box);
            float center = box.centerX();
            if (measured > box.width() && region.durationMs > 0) {
                animate = true;
                float phase = Math.min(1f, (System.currentTimeMillis() - receivedAt) / (float) region.durationMs);
                float travel = measured - box.width();
                float moving = phase < 0.12f ? 0f : phase > 0.88f ? travel : travel * ((phase - 0.12f) / 0.76f);
                center = box.left + measured / 2f - moving;
            }
            canvas.drawText(region.value, center, baseline, text);
            canvas.restore();
        }
        if (animate && System.currentTimeMillis() - receivedAt < 15000L) postInvalidateDelayed(16L);
    }

    @Override protected void onDetachedFromWindow() {
        clearBitmap();
        super.onDetachedFromWindow();
    }

    private static final class Region {
        final float x0, y0, x1, y1;
        final String value;
        final long durationMs;
        final String fontFamily;

        Region(float x0, float y0, float x1, float y1, String value, long durationMs, String fontFamily) {
            this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
            this.value = value; this.durationMs = durationMs; this.fontFamily = fontFamily;
        }

        static Region from(JSONObject value) {
            return new Region(
                    (float) value.optDouble("x0"), (float) value.optDouble("y0"),
                    (float) value.optDouble("x1"), (float) value.optDouble("y1"),
                    value.optString("text", ""), value.optLong("durationMs", 0L), value.optString("fontFamily", "sans"));
        }
    }
}
