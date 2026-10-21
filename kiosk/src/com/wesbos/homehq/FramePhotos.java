package com.wesbos.homehq;

import android.net.Uri;
import android.os.Environment;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;

/**
 * The photos the Frameo app has received, for the page's Photos tab. Frameo keeps them in
 * /sdcard/frameo_files/media; names carry no reliable extension, so a file counts as a photo by its first bytes
 * (JPEG, PNG, WebP), which also skips videos. Reading it needs READ_EXTERNAL_STORAGE.
 */
final class FramePhotos {
  static final String DIR = "frameo_files/media";
  private static final int MAX = 2000;

  private FramePhotos() {}

  /** file:// URLs, newest first, as a JSON array. */
  static String list() {
    List<File> found = new ArrayList<>();
    collect(new File(Environment.getExternalStorageDirectory(), DIR), found, 2);
    Collections.sort(found, new Comparator<File>() {
      @Override public int compare(File a, File b) { return Long.compare(b.lastModified(), a.lastModified()); }
    });
    // A photo sent twice is saved twice under new names: keep the newest copy only.
    Set<String> seen = new HashSet<>();
    JSONArray out = new JSONArray();
    for (File f : found) {
      if (out.length() >= MAX) break;
      if (seen.add(signature(f))) out.put(Uri.fromFile(f).toString());
    }
    return out.toString();
  }

  /** Size plus a hash of the first 4 KB: equal for copies of one photo, different for different photos. */
  private static String signature(File f) {
    byte[] b = new byte[4096];
    int n = 0;
    try (InputStream in = new FileInputStream(f)) {
      n = Math.max(0, in.read(b));
    } catch (IOException e) {
      return f.getPath();
    }
    return f.length() + ":" + Arrays.hashCode(Arrays.copyOf(b, n));
  }

  private static void collect(File dir, List<File> out, int depth) {
    File[] files = dir.listFiles();
    if (files == null) return;
    for (File f : files) {
      if (f.isDirectory()) { if (depth > 0) collect(f, out, depth - 1); }
      else if (f.length() > 10 * 1024 && isImage(f)) out.add(f);
    }
  }

  private static boolean isImage(File f) {
    byte[] b = new byte[12];
    try (InputStream in = new FileInputStream(f)) {
      if (in.read(b) < 12) return false;
    } catch (IOException e) {
      return false;
    }
    if ((b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8) return true;                       // JPEG
    if ((b[0] & 0xff) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return true;     // PNG
    return b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P';
  }
}
