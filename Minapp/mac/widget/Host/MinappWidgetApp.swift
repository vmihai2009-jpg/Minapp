import SwiftUI
import WidgetKit

/// A tiny background app. macOS only offers widgets that ship inside an app, so this is the app. It also keeps the
/// widget fresh: whenever Minapp changes song or play state it asks WidgetKit to redraw, and it quits by itself
/// when Minapp has gone quiet.
@main
struct MinappWidgetApp: App {
    @NSApplicationDelegateAdaptor(Agent.self) var agent
    var body: some Scene {
        Settings { EmptyView() }
    }
}

final class Agent: NSObject, NSApplicationDelegate {
    private var timer: Timer?
    private var last: NowPlayingState?
    private var lastSeen = Date()
    private var tickCount = 0

    func applicationDidFinishLaunching(_ n: Notification) {
        WidgetCenter.shared.reloadAllTimelines()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        // Opened by hand (not by Minapp): show a note instead of vanishing.
        if !ProcessInfo.processInfo.arguments.contains("-background"), NSWorkspace.shared.runningApplications.contains(where: { $0.bundleIdentifier == "com.minapp.player" }) == false {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.explain() }
        }
    }

    private func explain() {
        let a = NSAlert()
        a.messageText = "Minapp widget is installed"
        a.informativeText = "Right-click the desktop, choose Edit Widgets, and add Minapp. Open Minapp and play something to see it."
        a.runModal()
        NSApp.terminate(nil)
    }

    private func tick() {
        Task { await check() }
    }

    private func check() async {
        let s = await Shared.readState()
        if s.isLive { lastSeen = Date() }
        let changed = last == nil
            || last?.id != s.id || last?.title != s.title || last?.playing != s.playing
            || last?.status != s.status || last?.isLive != s.isLive
        tickCount += 1
        // bars move constantly while playing: ask WidgetKit for a redraw every few seconds
        let barsMoved = s.playing && s.bars != last?.bars && tickCount % 2 == 0
        let periodic = s.playing && tickCount % 10 == 0
        if changed || periodic { WidgetCenter.shared.reloadAllTimelines() }
        last = s
        if Date().timeIntervalSince(lastSeen) > 45 { // Minapp closed
            WidgetCenter.shared.reloadAllTimelines()
            NSApp.terminate(nil)
        }
    }
}
