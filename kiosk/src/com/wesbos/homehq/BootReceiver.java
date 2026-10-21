package com.wesbos.homehq;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;

/**
 * Opens the dashboard when the frame has booted, on top of Frameo (which stays the Home app, so Quitter and the
 * menu's launcher entry still lead back to it). Frameo finishes starting after the boot broadcast and comes to the
 * front, so the dashboard is opened again 20 s and 60 s later; when it is already in front that does nothing. Off with: adb shell am start -n com.wesbos.homehq/.MainActivity
 * --ez autostart false. Android only delivers this to an app that has been opened once since it was installed, and
 * the Denver frame's firmware refuses it ("process is bad"): there the kiosk starts at boot as the Home app instead.
 */
public final class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
    if (!context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE).getBoolean(MainActivity.PREF_AUTOSTART, true)) return;
    Log.i(MainActivity.TAG, "Boot: starting the dashboard now, in 20 s and in 60 s");
    Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    context.startActivity(open);
    AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    int[] delays = {20, 60};
    for (int i = 0; i < delays.length; i++) {
      PendingIntent later = PendingIntent.getActivity(context, i + 1, open, PendingIntent.FLAG_UPDATE_CURRENT);
      alarms.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delays[i] * 1000L, later);
    }
  }
}
