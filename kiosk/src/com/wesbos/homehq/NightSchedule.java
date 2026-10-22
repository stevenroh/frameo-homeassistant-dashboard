package com.wesbos.homehq;

/**
 * The night window during which the screen stays off, e.g. "22:00" to "07:00" (across midnight) or "13:00" to "14:00".
 * Plain Java, so it can be checked off the device.
 */
final class NightSchedule {
  private NightSchedule() {}

  /** "HH:MM" -> minutes since midnight, or -1 when empty or malformed. */
  static int minutes(String hhmm) {
    if (hhmm == null || !hhmm.matches("\\d{1,2}:\\d{2}")) return -1;
    String[] p = hhmm.split(":");
    int h = Integer.parseInt(p[0]), m = Integer.parseInt(p[1]);
    return h < 24 && m < 60 ? h * 60 + m : -1;
  }

  /** Whether minute-of-day `now` is inside [off, on). Off when either time is missing or both are equal. */
  static boolean inNight(int now, int off, int on) {
    if (off < 0 || on < 0 || off == on) return false;
    return off < on ? now >= off && now < on : now >= off || now < on;
  }
}
