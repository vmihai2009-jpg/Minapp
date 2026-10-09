// Minapp launcher: a tiny no-console, no-admin program that starts the player.
// First run: opens the one-time setup (downloads the player engine), then the player starts.
// Build (any OS with mono):  mcs -target:winexe -win32icon:../app/icon.ico -out:Minapp.exe Launcher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Minapp")]
[assembly: AssemblyProduct("Minapp")]
[assembly: AssemblyDescription("Minapp")]
[assembly: AssemblyCompany("Minapp")]
[assembly: AssemblyVersion("1.6.0.0")]

static class Launcher {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool DeleteFileW(string path);

  // Windows tags downloaded files with a "came from the internet" mark (an NTFS stream named Zone.Identifier).
  // That mark is what triggers the SmartScreen "Windows protected your PC" screen. Once you have chosen to run
  // Minapp, remove the mark from Minapp's own files so it does not ask again.
  static void Unblock(string file) {
    try { DeleteFileW(file + ":Zone.Identifier"); } catch (Exception) { }
  }
  // Desktop + Start menu shortcuts that start the engine directly. The engine file is downloaded by the setup
  // script, so it carries no "came from the internet" mark: starting Minapp from these never shows SmartScreen,
  // even on a freshly unzipped copy whose Minapp.exe is still marked.
  static void MakeShortcut(string lnk, string target, string args, string workDir, string icon) {
    try {
      Type t = Type.GetTypeFromProgID("WScript.Shell");
      object sh = Activator.CreateInstance(t);
      object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
      Type st = sc.GetType();
      st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
      st.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { args });
      st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
      st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { icon + ",0" });
      st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Minapp" });
      st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
    } catch (Exception) { }
  }
  static void EnsureShortcuts(string dir, string engine, string app) {
    try {
      string data = Path.Combine(dir, "data");
      Directory.CreateDirectory(data);
      string marker = Path.Combine(data, ".shortcuts");
      string current = File.Exists(marker) ? File.ReadAllText(marker).Trim() : "";
      string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Minapp.lnk");
      string start = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Minapp.lnk");
      if (current == dir && File.Exists(desktop) && File.Exists(start)) return;
      string icon = Path.Combine(app, "icon.ico");
      MakeShortcut(desktop, engine, "\"" + app + "\"", app, icon);
      MakeShortcut(start, engine, "\"" + app + "\"", app, icon);
      File.WriteAllText(marker, dir);
    } catch (Exception) { }
  }
  static void UnblockFolder(string dir, bool deep) {
    try {
      foreach (string f in Directory.GetFiles(dir)) Unblock(f);
      if (deep) foreach (string d in Directory.GetDirectories(dir)) UnblockFolder(d, true);
    } catch (Exception) { }
  }

  static int Main() {
    string dir = AppDomain.CurrentDomain.BaseDirectory;
    string engine = Path.Combine(dir, "runtime", "Minapp.exe");
    string webamp = Path.Combine(dir, "app", "node_modules", "webamp", "built", "webamp.bundle.min.js");
    string app = Path.Combine(dir, "app");
    try {
      UnblockFolder(dir, false);
      UnblockFolder(app, false);
      Unblock(Assembly.GetExecutingAssembly().Location);
      if (File.Exists(engine) && File.Exists(webamp)) {
        EnsureShortcuts(dir, engine, app);
        ProcessStartInfo run = new ProcessStartInfo(engine, "\"" + app + "\"");
        run.WorkingDirectory = app;
        run.UseShellExecute = false;
        Process.Start(run);
        return 0;
      }
      string setup = Path.Combine(dir, "setup.ps1");
      if (!File.Exists(setup)) { MessageBoxW(IntPtr.Zero, "setup.ps1 is missing. Unzip the whole Minapp folder and run Minapp.exe from inside it.", "Minapp", 0x10); return 1; }
      ProcessStartInfo ps = new ProcessStartInfo("powershell.exe",
        "-NoProfile -ExecutionPolicy Bypass -File \"" + setup + "\"");
      ps.WorkingDirectory = dir;
      ps.UseShellExecute = false;   // a window shows the one-time download progress
      using (Process p = Process.Start(ps)) {
        p.WaitForExit();
        if (p.ExitCode != 0) {
          MessageBoxW(IntPtr.Zero, "Minapp could not finish its first-time setup (it needs internet access to github.com and registry.npmjs.org once).\n\nDetails are in data\\setup.log inside the Minapp folder.", "Minapp", 0x10);
          return p.ExitCode;
        }
      }
      if (File.Exists(engine)) EnsureShortcuts(dir, engine, app);
      return 0;
    } catch (Exception e) {
      MessageBoxW(IntPtr.Zero, "Minapp could not start:\n" + e.Message, "Minapp", 0x10);
      return 1;
    }
  }
}
