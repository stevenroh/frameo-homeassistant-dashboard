package com.wesbos.homehq;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Over-the-air dashboard files. update() reads <base>/manifest.json ({"version": "...", "files": ["index.html", ...]}),
 * downloads every file into a temp folder and only then swaps it in as files/page/, so a failed or partial download
 * leaves the running copy alone. The page folder is flat: file names have no slashes.
 */
final class PageUpdater {
  static final String DIR = "page";
  static final String VERSION_FILE = ".version";
  private static final int MAX_FILE = 8 * 1024 * 1024;
  private static final int MAX_FILES = 64;

  private PageUpdater() {}

  static File pageDir(File filesDir) { return new File(filesDir, DIR); }

  /** The updated entry page, or null when the bundled one should be used. */
  static File entry(File filesDir) {
    File f = new File(pageDir(filesDir), "index.html");
    return f.isFile() && f.length() > 0 ? f : null;
  }

  static String version(File filesDir) {
    File f = new File(pageDir(filesDir), VERSION_FILE);
    if (!f.isFile()) return "built-in";
    try {
      return new String(read(new java.io.FileInputStream(f), 256), Charset.forName("UTF-8")).trim();
    } catch (IOException e) {
      return "built-in";
    }
  }

  static void reset(File filesDir) { deleteTree(pageDir(filesDir)); }

  static boolean safeName(String n) { return n != null && n.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}"); }

  /** Returns the new version. Throws with a short message the user can read on a toast. */
  static String update(File filesDir, String baseUrl, android.content.res.AssetManager assets) throws IOException {
    String base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    JSONObject manifest;
    try {
      manifest = new JSONObject(new String(fetch(base + "manifest.json", 256 * 1024), Charset.forName("UTF-8")));
    } catch (JSONException e) {
      throw new IOException("manifest.json is not valid");
    }
    JSONArray files = manifest.optJSONArray("files");
    if (files == null || files.length() == 0 || files.length() > MAX_FILES) throw new IOException("manifest has no files");
    String version = manifest.optString("version", "unknown");
    boolean hasIndex = false;
    File tmp = new File(filesDir, DIR + ".tmp");
    deleteTree(tmp);
    if (!tmp.mkdirs()) throw new IOException("cannot create temp folder");
    try {
      for (int i = 0; i < files.length(); i++) {
        String name = files.optString(i, null);
        if (!safeName(name)) throw new IOException("bad file name in manifest");
        byte[] data = fetch(base + name, MAX_FILE);
        if (data.length == 0) throw new IOException(name + " is empty");
        write(new File(tmp, name), data);
        if (name.equals("index.html")) hasIndex = true;
      }
      if (!hasIndex) throw new IOException("manifest has no index.html");
      // config.js (the token) may stay on the frame: keep the one already in use, else the one bundled in the APK.
      File cfg = new File(tmp, "config.js");
      if (!cfg.exists()) {
        File prev = new File(pageDir(filesDir), "config.js");
        if (prev.isFile()) write(cfg, read(new java.io.FileInputStream(prev), MAX_FILE));
        else write(cfg, read(assets.open("config.js"), MAX_FILE));
      }
      write(new File(tmp, VERSION_FILE), version.getBytes(Charset.forName("UTF-8")));
      File old = new File(filesDir, DIR + ".old");
      deleteTree(old);
      File cur = pageDir(filesDir);
      if (cur.exists() && !cur.renameTo(old)) throw new IOException("cannot replace the current page");
      if (!tmp.renameTo(cur)) {
        old.renameTo(cur); // put the running copy back
        throw new IOException("cannot install the update");
      }
      deleteTree(old);
    } finally {
      deleteTree(tmp);
    }
    return version;
  }

  private static byte[] fetch(String url, int max) throws IOException {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(8000);
    c.setReadTimeout(15000);
    c.setUseCaches(false);
    try {
      if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode() + " for " + url.substring(url.lastIndexOf('/') + 1));
      return read(c.getInputStream(), max);
    } finally {
      c.disconnect();
    }
  }

  private static byte[] read(InputStream in, int max) throws IOException {
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[16384];
      int n;
      while ((n = in.read(buf)) > 0) {
        out.write(buf, 0, n);
        if (out.size() > max) throw new IOException("file too large");
      }
      return out.toByteArray();
    } finally {
      in.close();
    }
  }

  private static void write(File f, byte[] data) throws IOException {
    OutputStream o = new FileOutputStream(f);
    try {
      o.write(data);
    } finally {
      o.close();
    }
  }

  private static void deleteTree(File f) {
    if (!f.exists()) return;
    File[] kids = f.listFiles();
    if (kids != null) for (File k : kids) deleteTree(k);
    f.delete();
  }
}
