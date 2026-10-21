package com.wesbos.homehq;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;

/**
 * Full-screen kiosk WebView for the Home HQ wall tablet.
 * - Immersive mode hides the status + navigation bars (true 1280x800).
 * - Controls: hold two fingers still on the screen for 1.5s, or one finger on the empty bottom
 *   of the left rail (below the tabs) for 3s, for launcher/settings/Wi-Fi/reload. Touch events are logged (tag HomeHQ).
 * - Denver frame build: the dashboard is the bundled page in assets/ (see ../page).
 * - Screen sleep: after SLEEP minutes without a touch the backlight goes off (through root) behind a
 *   black cover; the touchscreen stays on, so a tap wakes it and is not passed to the page.
 *   Change the delay with --ei sleep_minutes N (0 = never).
 * - Offline: a failed page load shows a native screen instead of WebView's error page (which
 *   prints the full URL, including any token in it). With no Wi-Fi it offers Wi-Fi settings.
 * - Remote debugging is OFF unless launched with the debug extra (every app on this device
 *   gets root, so the devtools socket should only exist while actively debugging):
 *     adb shell am start -n com.wesbos.homehq/.MainActivity --ez debug true
 * - Launch with a URL: adb shell am start -a android.intent.action.VIEW -d <url> -n com.wesbos.homehq/.MainActivity
 * - Over-the-air page updates: the menu item "Update dashboard" (or the page's Settings sheet) downloads the files listed in
 *   <update_url>/manifest.json into files/page/ and loads them instead of the bundled ones. Set the address with
 *     adb shell am start -n com.wesbos.homehq/.MainActivity --es update_url http://<laptop>:8099
 * - Set the saved URL, used on every later launch: adb shell am start -n com.wesbos.homehq/.MainActivity --es url <url>
 * - Offer the kiosk as a Home app (--ez home false undoes it), then pick it:
 *     adb shell am start -n com.wesbos.homehq/.MainActivity --ez home true
 *     adb shell cmd package set-home-activity com.wesbos.homehq/.Home
 */
public class MainActivity extends Activity {
  static final String TAG = "HomeHQ";
  static final String DEFAULT_URL = "file:///android_asset/index.html";
  static final String PREFS = "kiosk";
  static final String PREF_URL = "url";
  static final long EXIT_HOLD_MS = 1500;
  static final long RETRY_MS = 5000;
  static final float EXIT_SLOP_PX = 120;
  // Second way in, in case the panel drops a finger: hold one finger on the empty bottom of the rail,
  // which no view uses (the page long-presses light tiles, so a spot inside the content would clash).
  static final long HOLD_MS = 3000;
  static final float HOLD_SLOP_PX = 40;
  static final float HOLD_RIGHT = 80, HOLD_TOP = 360;
  static final String PREF_SLEEP = "sleep_minutes";
  static final String PREF_UPDATE_URL = "update_url";
  static final int DEFAULT_SLEEP_MINUTES = 5;

  private WebView web;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final int[] exitIds = new int[2];
  private final float[] exitX = new float[2];
  private final float[] exitY = new float[2];
  private boolean exitArmed;
  private boolean holdArmed;
  private View cover;
  private boolean dark;
  private boolean swallowTouch;
  private String backlight;
  private String savedLevel;
  private float holdX, holdY;
  private String retryUrl;
  private volatile String currentUrl = "";
  private boolean pageFailed;
  private LinearLayout offline;
  private TextView offlineTitle, offlineText;

  private final Runnable retry = new Runnable() {
    @Override
    public void run() {
      if (retryUrl != null) web.loadUrl(retryUrl);
    }
  };

  private final Runnable showControls = new Runnable() {
    @Override
    public void run() {
      exitArmed = false;
      Log.i(TAG, "Opening controls");
      // The menu is its own window, so taps on it never reach dispatchTouchEvent: no sleep while open.
      handler.removeCallbacks(goDark);
      new AlertDialog.Builder(MainActivity.this)
          .setTitle("Home HQ")
          .setItems(new String[] {"Ouvrir le lanceur", "Paramètres Android", "Paramètres Wi-Fi", "Recharger le tableau de bord", "Mettre à jour le tableau de bord"},
              (dialog, which) -> {
                if (which == 0) openLauncher();
                else if (which == 1) startActivity(new Intent(Settings.ACTION_SETTINGS));
                else if (which == 2) openWifiSettings();
                else if (which == 3) web.reload();
                else runUpdate();
              })
          .setNegativeButton("Retour au tableau de bord", null)
          .setOnDismissListener(d -> scheduleSleep())
          .show();
    }
  };

  private final Runnable holdControls = new Runnable() {
    @Override
    public void run() {
      holdArmed = false;
      Log.i(TAG, "Rail hold: opening controls");
      showControls.run();
    }
  };

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    applyDebugFlag(getIntent());
    applyHomeFlag(getIntent());
    keepNavigationEnabled();
    // Android 6 asks once on the frame; `adb shell pm grant com.wesbos.homehq android.permission.READ_EXTERNAL_STORAGE`
    // grants it without the dialog.
    if (checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] {android.Manifest.permission.READ_EXTERNAL_STORAGE}, 1);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_FULLSCREEN);

    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setUseWideViewPort(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    // The page handles long-press itself (light tiles); keep the WebView's selection popup out of the way.
    web.setLongClickable(false);
    web.setOnLongClickListener(v -> true);
    web.addJavascriptInterface(new Bridge(), "Kiosk");
    // Keep navigation inside the kiosk. When the kiosk starts at boot before Wi-Fi is up, the
    // first load fails and would stay on the error page, so retry failed main-frame loads.
    // The offline screen covers WebView's error page until a load succeeds.
    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageStarted(WebView view, String url, Bitmap icon) {
        pageFailed = false;
        currentUrl = url;
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        if (!pageFailed) offline.setVisibility(View.GONE);
      }

      @Override
      @SuppressWarnings("deprecation")
      public void onReceivedError(WebView view, int code, String desc, String failingUrl) {
        Log.w(TAG, "Load failed (" + desc + "), retrying in " + RETRY_MS + " ms");
        pageFailed = true;
        showOffline();
        retryUrl = failingUrl;
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
      }
    });
    FrameLayout root = new FrameLayout(this);
    root.addView(web);
    root.addView(buildOffline());
    cover = new View(this);
    cover.setBackgroundColor(Color.BLACK);
    cover.setVisibility(View.GONE);
    root.addView(cover);
    backlight = findBacklight();
    applySleepFlag(getIntent());
    applyUpdateUrl(getIntent());
    setContentView(root);

    String url = urlFrom(getIntent());
    web.loadUrl(url != null ? url : startUrl());
  }

  @Override
  protected void onResume() {
    super.onResume();
    NavigationService.setDashboardVisible(true);
    wake();
  }

  @Override
  protected void onPause() {
    cancelExit();
    if (dark) wake();
    // wake() re-arms the timer; nothing may darken the screen while another app is in front.
    handler.removeCallbacks(goDark);
    NavigationService.setDashboardVisible(false);
    super.onPause();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    applyDebugFlag(intent);
    applyHomeFlag(intent);
    applySleepFlag(intent);
    applyUpdateUrl(intent);
    String url = urlFrom(intent);
    if (url != null) {
      handler.removeCallbacks(retry);
      web.loadUrl(url);
    }
  }

  /** A "url" extra is saved for later launches. A VIEW link from another app is shown, not saved. */
  private String urlFrom(Intent intent) {
    String saved = intent.getStringExtra(PREF_URL);
    if (saved == null) return intent.getDataString();
    // The activity is exported, so only save web URLs: never file:, content: or javascript:.
    String scheme = Uri.parse(saved).getScheme();
    if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
      Log.w(TAG, "Ignoring non-web kiosk URL: " + saved);
      return null;
    }
    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_URL, saved).apply();
    Log.i(TAG, "Saved kiosk URL: " + saved);
    return saved;
  }

  /** The saved URL; the bundled page is swapped for the updated copy when one has been downloaded. */
  private String startUrl() {
    String saved = savedUrl();
    File updated = PageUpdater.entry(getFilesDir());
    return DEFAULT_URL.equals(saved) && updated != null ? Uri.fromFile(updated).toString() : saved;
  }

  private String updateUrl() {
    return getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_UPDATE_URL, "");
  }

  private void applyUpdateUrl(Intent intent) {
    String u = intent == null ? null : intent.getStringExtra(PREF_UPDATE_URL);
    if (u == null) return;
    String scheme = Uri.parse(u).getScheme();
    if (u.length() > 0 && !"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
      Log.w(TAG, "Ignoring non-web update URL");
      return;
    }
    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_UPDATE_URL, u).apply();
    Log.i(TAG, "Saved update URL: " + u);
  }

  private void toast(String text) {
    runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
  }

  /** Downloads the manifest's files off the UI thread, then reloads the page from them. */
  private void runUpdate() {
    final String base = updateUrl();
    if (base.length() == 0) {
      toast("No update address set. Use: adb shell am start -n com.wesbos.homehq/.MainActivity --es update_url http://<laptop>:8099");
      return;
    }
    toast("Mise à jour depuis " + base + " ...");
    new Thread(() -> {
      try {
        String version = PageUpdater.update(getFilesDir(), base, getAssets());
        Log.i(TAG, "Updated page to " + version);
        runOnUiThread(() -> {
          handler.removeCallbacks(retry);
          web.loadUrl(startUrl());
          Toast.makeText(this, "Mis à jour : " + version, Toast.LENGTH_LONG).show();
        });
      } catch (Exception e) {
        Log.w(TAG, "Update failed", e);
        toast("Échec de la mise à jour : " + e.getMessage());
      }
    }, "page-update").start();
  }

  private void runReset() {
    PageUpdater.reset(getFilesDir());
    runOnUiThread(() -> {
      handler.removeCallbacks(retry);
      web.loadUrl(startUrl());
      Toast.makeText(this, "Retour au tableau de bord intégré", Toast.LENGTH_LONG).show();
    });
  }

  /** What the page's Settings sheet can do. Only pages loaded from this app's own files may call it. */
  private final class Bridge {
    private boolean own() { return currentUrl.startsWith("file:"); }

    @JavascriptInterface public String version() { return own() ? PageUpdater.version(getFilesDir()) : ""; }
    @JavascriptInterface public String updateUrl() { return own() ? MainActivity.this.updateUrl() : ""; }

    @JavascriptInterface public void setUpdateUrl(String u) {
      if (!own() || u == null || u.length() > 200) return;
      Intent i = new Intent().putExtra(PREF_UPDATE_URL, u.trim());
      applyUpdateUrl(i);
    }

    @JavascriptInterface public String photos() { return own() ? FramePhotos.list() : "[]"; }
    @JavascriptInterface public void update() { if (own()) runUpdate(); }
    @JavascriptInterface public void reset() { if (own()) runReset(); }
  }

  private String savedUrl() {
    return getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_URL, DEFAULT_URL);
  }

  private int dp(float v) {
    return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
  }

  private View buildOffline() {
    offline = new LinearLayout(this);
    offline.setOrientation(LinearLayout.VERTICAL);
    offline.setGravity(Gravity.CENTER);
    offline.setBackgroundColor(Color.rgb(17, 17, 17));
    offline.setVisibility(View.GONE);
    offline.setClickable(true); // keep taps off the error page underneath

    offlineTitle = new TextView(this);
    offlineTitle.setTextColor(Color.WHITE);
    offlineTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 40);
    offlineTitle.setGravity(Gravity.CENTER);
    offline.addView(offlineTitle);

    offlineText = new TextView(this);
    offlineText.setTextColor(Color.rgb(170, 170, 170));
    offlineText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
    offlineText.setGravity(Gravity.CENTER);
    offlineText.setPadding(dp(24), dp(12), dp(24), dp(28));
    offline.addView(offlineText);

    Button wifi = new Button(this);
    wifi.setText("Ouvrir les paramètres Wi-Fi");
    wifi.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
    wifi.setPadding(dp(32), dp(16), dp(32), dp(16));
    wifi.setOnClickListener(v -> openWifiSettings());
    offline.addView(wifi, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    return offline;
  }

  private boolean wifiConnected() {
    ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
    @SuppressWarnings("deprecation")
    NetworkInfo n = cm != null ? cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI) : null;
    return n != null && n.isConnected();
  }

  private void showOffline() {
    if (wifiConnected()) {
      offlineTitle.setText("Tableau de bord injoignable");
      offlineText.setText("Le Wi-Fi est connecté. Nouvel essai toutes les quelques secondes.");
    } else {
      offlineTitle.setText("Se connecter au Wi-Fi ?");
      offlineText.setText("Le cadre n’est pas connecté au Wi-Fi. Le tableau de bord reviendra tout seul dès qu’il le sera.");
    }
    offline.setVisibility(View.VISIBLE);
  }

  private void openWifiSettings() {
    try {
      startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
    } catch (Exception e) {
      Log.w(TAG, "No Wi-Fi settings screen, opening Settings", e);
      startActivity(new Intent(Settings.ACTION_SETTINGS));
    }
  }

  /**
   * Some frames (PF1007L) run a vendor BackgroundManagerService that drops the navigation service
   * after the kiosk is updated or force-stopped, leaving no way back from Settings. If the owner
   * opted in by granting WRITE_SECURE_SETTINGS, put the service back on the enabled list:
   *   adb shell pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS
   */
  private void keepNavigationEnabled() {
    if (checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return;
    String svc = getPackageName() + "/" + NavigationService.class.getName();
    String cur = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
    if (cur != null) {
      ComponentName want = new ComponentName(this, NavigationService.class);
      for (String entry : cur.split(":")) {
        if (want.equals(ComponentName.unflattenFromString(entry))) return;
      }
    }
    String next = cur == null || cur.isEmpty() ? svc : cur + ":" + svc;
    try {
      Settings.Secure.putString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, next);
      Settings.Secure.putString(getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, "1");
      Log.i(TAG, "Re-enabled navigation service");
    } catch (SecurityException e) {
      Log.w(TAG, "Could not re-enable navigation service", e);
    }
  }

  private void openLauncher() {
    Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
    for (ResolveInfo info : getPackageManager().queryIntentActivities(home, 0)) {
      String pkg = info.activityInfo.packageName;
      if (pkg.equals(getPackageName()) || pkg.equals("com.android.settings")) continue;
      startActivity(new Intent(home).setComponent(new ComponentName(pkg, info.activityInfo.name)));
      return;
    }
    startActivity(new Intent(Settings.ACTION_SETTINGS));
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (web != null) web.destroy();
    super.onDestroy();
  }

  /** Remote debugging only when explicitly requested; any normal launch turns it back off. */
  private void applyDebugFlag(Intent intent) {
    boolean debug = intent != null && intent.getBooleanExtra("debug", false);
    WebView.setWebContentsDebuggingEnabled(debug);
    Log.i(TAG, "WebView remote debugging " + (debug ? "ON" : "off"));
  }

  /** Turns the Home alias on or off. The shell can't enable a component of a release app. */
  private void applyHomeFlag(Intent intent) {
    if (intent == null || !intent.hasExtra("home")) return;
    boolean home = intent.getBooleanExtra("home", false);
    getPackageManager().setComponentEnabledSetting(new ComponentName(this, getPackageName() + ".Home"),
        home ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
        PackageManager.DONT_KILL_APP);
    Log.i(TAG, "Home alias " + (home ? "on" : "off"));
  }

  /** Watches for the two-finger exit hold; all touches still go to the page. */
  @Override
  public boolean dispatchTouchEvent(MotionEvent e) {
    int action = e.getActionMasked();
    // While dark, the first touch only wakes the screen; the rest of that gesture is swallowed.
    if (action == MotionEvent.ACTION_DOWN && dark) {
      wake();
      swallowTouch = true;
    }
    if (swallowTouch) {
      if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) swallowTouch = false;
      return true;
    }
    if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) scheduleSleep();
    if (action != MotionEvent.ACTION_MOVE) {
      Log.i(TAG, "touch " + MotionEvent.actionToString(action) + " pointers=" + e.getPointerCount()
          + " x=" + (int) e.getX() + " y=" + (int) e.getY());
    }
    trackRailHold(e, action);
    switch (action) {
      case MotionEvent.ACTION_POINTER_DOWN:
        if (e.getPointerCount() == 2) {
          for (int i = 0; i < 2; i++) {
            exitIds[i] = e.getPointerId(i);
            exitX[i] = e.getX(i);
            exitY[i] = e.getY(i);
          }
          exitArmed = true;
          handler.removeCallbacks(showControls);
          handler.postDelayed(showControls, EXIT_HOLD_MS);
        } else {
          cancelExit(); // 3+ fingers
        }
        break;
      case MotionEvent.ACTION_MOVE:
        if (exitArmed) {
          for (int i = 0; i < 2; i++) {
            int idx = e.findPointerIndex(exitIds[i]);
            if (idx < 0 || Math.hypot(e.getX(idx) - exitX[i], e.getY(idx) - exitY[i]) > EXIT_SLOP_PX) {
              cancelExit();
              break;
            }
          }
        }
        break;
      case MotionEvent.ACTION_POINTER_UP:
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        cancelExit();
        break;
      default:
        break;
    }
    return super.dispatchTouchEvent(e);
  }

  private final Runnable goDark = new Runnable() {
    @Override
    public void run() {
      if (dark) return;
      dark = true;
      cover.setVisibility(View.VISIBLE);
      savedLevel = readBacklight();
      if (backlight != null) {
        rootWrite(backlight + "/brightness", "0");
      } else {
        // No backlight node: dim as far as Android allows instead.
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = 0f;
        getWindow().setAttributes(lp);
      }
      Log.i(TAG, "Screen sleep (backlight was " + savedLevel + ")");
    }
  };

  private void wake() {
    if (dark) {
      dark = false;
      cover.setVisibility(View.GONE);
      if (backlight != null) {
        rootWrite(backlight + "/brightness", savedLevel != null && !"0".equals(savedLevel) ? savedLevel : "204");
      } else {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        getWindow().setAttributes(lp);
      }
      Log.i(TAG, "Screen wake");
    }
    scheduleSleep();
  }

  private int sleepMinutes() {
    return getSharedPreferences(PREFS, MODE_PRIVATE).getInt(PREF_SLEEP, DEFAULT_SLEEP_MINUTES);
  }

  private void scheduleSleep() {
    handler.removeCallbacks(goDark);
    int minutes = sleepMinutes();
    if (minutes > 0) handler.postDelayed(goDark, minutes * 60000L);
  }

  private void applySleepFlag(Intent intent) {
    if (intent == null || !intent.hasExtra(PREF_SLEEP)) return;
    int minutes = Math.max(0, intent.getIntExtra(PREF_SLEEP, DEFAULT_SLEEP_MINUTES));
    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt(PREF_SLEEP, minutes).apply();
    Log.i(TAG, "Screen sleep after " + minutes + " min");
    scheduleSleep();
  }

  private static String findBacklight() {
    java.io.File[] dirs = new java.io.File("/sys/class/backlight").listFiles();
    if (dirs == null) return null;
    for (java.io.File d : dirs) {
      if (new java.io.File(d, "brightness").canRead()) return d.getPath();
    }
    return null;
  }

  private String readBacklight() {
    if (backlight == null) return null;
    try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(backlight + "/brightness"))) {
      return r.readLine().trim();
    } catch (java.io.IOException | NullPointerException ex) {
      return null;
    }
  }

  // One thread, so an "off" and the "on" right after it reach the backlight in order.
  private static final java.util.concurrent.ExecutorService ROOT = java.util.concurrent.Executors.newSingleThreadExecutor();

  /** The backlight node is owned by system, so writes go through the frame's shipped su. */
  private static void rootWrite(final String path, final String value) {
    ROOT.execute(() -> {
      try {
        Process p = Runtime.getRuntime().exec(new String[] {"su", "-c", "echo " + value + " > " + path});
        p.waitFor();
      } catch (Exception ex) {
        Log.w(TAG, "Backlight write failed: " + ex);
      }
    });
  }

  /** One finger held still on the empty bottom of the rail for HOLD_MS opens the controls. */
  private void trackRailHold(MotionEvent e, int action) {
    switch (action) {
      case MotionEvent.ACTION_DOWN:
        if (e.getX() < HOLD_RIGHT && e.getY() > HOLD_TOP) {
          holdArmed = true;
          holdX = e.getX();
          holdY = e.getY();
          handler.removeCallbacks(holdControls);
          handler.postDelayed(holdControls, HOLD_MS);
        }
        break;
      case MotionEvent.ACTION_MOVE:
        if (holdArmed && Math.hypot(e.getX() - holdX, e.getY() - holdY) > HOLD_SLOP_PX) cancelHold();
        break;
      case MotionEvent.ACTION_POINTER_DOWN: // a second finger belongs to the two-finger hold
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        cancelHold();
        break;
      default:
        break;
    }
  }

  private void cancelHold() {
    holdArmed = false;
    handler.removeCallbacks(holdControls);
  }

  private void cancelExit() {
    if (!exitArmed) return;
    exitArmed = false;
    handler.removeCallbacks(showControls);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemUi();
  }

  private void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }

  @Override
  public void onBackPressed() {
    if (web.canGoBack()) web.goBack();
  }
}
