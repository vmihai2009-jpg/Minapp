// Core Audio per-app volume helper for smtc.ps1. Precompiled to app/skinvol.dll by build.sh (mcs -target:library).
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace SkinVol {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr audioSessionGuid, int streamFlags, out IntPtr sessionControl);
    int GetSimpleAudioVolume(IntPtr audioSessionGuid, int streamFlags, out IntPtr audioVolume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    int GetGroupingParam(out Guid grouping);
    int SetGroupingParam(ref Guid grouping, ref Guid context);
    int RegisterAudioSessionNotification(IntPtr events);
    int UnregisterAudioSessionNotification(IntPtr events);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid context);
    int GetMasterVolume(out float level);
    int SetMute(bool mute, ref Guid context);
    int GetMute(out bool mute);
  }

  public static class AppVolume {
    // level < 0 reads; level 0..1 writes. Returns the volume (0..100) of the first match, or -1.
    public static double Run(string processName, double level) {
      double result = -1;
      IAudioSessionEnumerator sessions = null;
      object mgrObj = null;
      try {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice dev;
        if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return -1;      // eRender, eMultimedia
        Guid iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
        dev.Activate(ref iid, 23, IntPtr.Zero, out mgrObj);                  // CLSCTX_ALL
        IAudioSessionManager2 mgr = (IAudioSessionManager2)mgrObj;
        if (mgr.GetSessionEnumerator(out sessions) != 0) return -1;
        int count; sessions.GetCount(out count);
        for (int i = 0; i < count; i++) {
          IAudioSessionControl2 ctl;
          if (sessions.GetSession(i, out ctl) != 0) continue;
          try {
            uint pid; ctl.GetProcessId(out pid);
            if (pid == 0) continue;
            string name;
            try { name = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
            if (!string.Equals(name, processName, StringComparison.OrdinalIgnoreCase)) continue;
            ISimpleAudioVolume vol = (ISimpleAudioVolume)ctl;
            Guid ctx = Guid.Empty;
            if (level >= 0) { vol.SetMasterVolume((float)Math.Max(0.0, Math.Min(1.0, level)), ref ctx); }
            float cur; vol.GetMasterVolume(out cur);
            if (result < 0) result = Math.Round(cur * 100.0);
          } finally { Marshal.ReleaseComObject(ctl); }
        }
      } catch { return -1; }
      finally {
        if (sessions != null) Marshal.ReleaseComObject(sessions);
        if (mgrObj != null) Marshal.ReleaseComObject(mgrObj);
      }
      return result;
    }
  }
}
