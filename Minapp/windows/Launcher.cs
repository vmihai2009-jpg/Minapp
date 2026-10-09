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
[assembly: AssemblyVersion("1.4.0.0")]

static class Launcher {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

  static int Main() {
    string dir = AppDomain.CurrentDomain.BaseDirectory;
    string engine = Path.Combine(dir, "runtime", "Minapp.exe");
    string webamp = Path.Combine(dir, "app", "node_modules", "webamp", "built", "webamp.bundle.min.js");
    string app = Path.Combine(dir, "app");
    try {
      if (File.Exists(engine) && File.Exists(webamp)) {
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
      return 0;
    } catch (Exception e) {
      MessageBoxW(IntPtr.Zero, "Minapp could not start:\n" + e.Message, "Minapp", 0x10);
      return 1;
    }
  }
}
