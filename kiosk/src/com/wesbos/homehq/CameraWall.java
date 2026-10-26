package com.wesbos.homehq;

import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.VideoView;

/**
 * The Caméras tab's videos: a page cannot play RTSP, so each camera gets Android's own player (VideoView, hardware
 * H.264) laid over the rectangle the page reserves for it, up to four (the 2x2 grid). The players sit above the page,
 * so this class also draws each camera's name and state and catches taps, which it hands to the page as
 * window.camTap(slot) (the page then makes that camera full screen or goes back to the grid). Moving a playing
 * camera to a new rectangle keeps its stream. Everything stops while the screen sleeps or the app is in the background
 * and comes back from the same requests; a failed or ended stream retries every 10 s.
 */
final class CameraWall {
  private static final String TAG = MainActivity.TAG;
  private static final long RETRY_MS = 10000;
  static final int SLOTS = 4;

  private final WebView web;
  private final Handler handler;
  private final Slot[] slots = new Slot[SLOTS];
  private boolean paused;

  CameraWall(FrameLayout root, WebView web, Handler handler, int index) {
    this.web = web;
    this.handler = handler;
    for (int i = 0; i < SLOTS; i++) {
      slots[i] = new Slot(i, root);
      // Above the page, below the offline screen and the sleep cover, which still black them out.
      root.addView(slots[i].box, index + i, new FrameLayout.LayoutParams(0, 0));
    }
  }

  /** The rectangle is in the page's CSS pixels; pageWidth (1280) converts them to the screen's. */
  void play(int slot, String name, String url, float x, float y, float w, float h, float pageWidth) {
    if (slot < 0 || slot >= SLOTS) return;
    Slot s = slots[slot];
    float k = web.getWidth() / (pageWidth > 0 ? pageWidth : 1280f);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.round(w * k), Math.round(h * k));
    lp.leftMargin = Math.round(x * k);
    lp.topMargin = Math.round(y * k);
    s.box.setLayoutParams(lp);
    s.name = name;
    if (url.equals(s.url) && s.video != null) return; // same camera, new place: keep the stream
    s.url = url;
    if (!paused) s.start();
  }

  /** One slot, or all of them with -1. */
  void stop(int slot) {
    for (Slot s : slots) if (slot < 0 || s.index == slot) { s.url = null; s.release(); }
  }

  /** Screen asleep or app in the background: stop decoding, keep the requests. */
  void pause() {
    paused = true;
    for (Slot s : slots) s.release();
  }

  void resume() {
    paused = false;
    for (Slot s : slots) if (s.url != null) s.start();
  }

  private final class Slot {
    final int index;
    final FrameLayout box;
    final TextView label;
    VideoView video;
    String url, name = "";

    final Runnable retry = new Runnable() {
      @Override
      public void run() { start(); }
    };

    Slot(int index, FrameLayout root) {
      this.index = index;
      box = new FrameLayout(root.getContext());
      box.setBackgroundColor(Color.BLACK);
      box.setVisibility(View.GONE);
      box.setOnClickListener(v -> web.evaluateJavascript("window.camTap && camTap(" + index + ")", null));
      label = new TextView(root.getContext());
      label.setTextColor(Color.WHITE);
      label.setTextSize(TypedValue.COMPLEX_UNIT_PX, 22);
      label.setShadowLayer(4, 0, 1, Color.BLACK);
      label.setPadding(18, 10, 18, 12);
    }

    void start() {
      handler.removeCallbacks(retry);
      if (url == null || paused) return;
      release();
      box.setVisibility(View.VISIBLE);
      video = new VideoView(box.getContext());
      video.setFocusable(false);
      // VideoView keeps the stream's aspect ratio; centred, with black bars in the box.
      box.addView(video, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER));
      box.addView(label, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.START));
      video.setOnPreparedListener(mp -> label.setText(name));
      video.setOnErrorListener((mp, what, extra) -> {
        Log.w(TAG, "Camera " + name + " stream error " + what + "/" + extra);
        label.setText(name + " · flux indisponible, nouvel essai…");
        dropVideo();
        handler.postDelayed(retry, RETRY_MS);
        return true; // no system "Can't play this video" dialog
      });
      video.setOnCompletionListener(mp -> handler.postDelayed(retry, RETRY_MS));
      label.setText(name + " · connexion…");
      video.setVideoURI(Uri.parse(url));
      video.start();
    }

    /** Stops the player but keeps the box and its label (an error shows on black). */
    void dropVideo() {
      if (video != null) {
        video.stopPlayback();
        box.removeView(video);
        video = null;
      }
    }

    void release() {
      handler.removeCallbacks(retry);
      dropVideo();
      box.removeView(label);
      box.setVisibility(View.GONE);
    }
  }
}
