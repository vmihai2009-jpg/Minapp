import Foundation

/// What Minapp (the Electron player) writes to the shared App Group container, and where.
struct NowPlayingState: Codable, Equatable {
    var status: String = "closed"
    var title: String = ""
    var artist: String = ""
    var id: String = ""
    var source: String = "spotify"
    var duration: Double = 0
    var position: Double = 0
    var playing: Bool = false
    var updated: Double = 0   // unix seconds of the write; a silent file means Minapp is closed

    /// Minapp rewrites the file every few seconds while it runs.
    var isLive: Bool { Date().timeIntervalSince1970 - updated < 20 }
    var hasTrack: Bool { !title.isEmpty && isLive }
}

enum Shared {
    /// "<TEAMID>.com.minapp.widget", filled in from the build's signing team (see Info.plist).
    static var groupID: String {
        Bundle.main.object(forInfoDictionaryKey: "MinappAppGroup") as? String ?? "com.minapp.widget"
    }
    static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)
    }
    static var stateURL: URL? { container?.appendingPathComponent("state.json") }
    static var commandsDir: URL? { container?.appendingPathComponent("commands", isDirectory: true) }

    static func readState() -> NowPlayingState {
        guard let url = stateURL, let data = try? Data(contentsOf: url),
              let s = try? JSONDecoder().decode(NowPlayingState.self, from: data) else { return NowPlayingState() }
        return s
    }

    /// Drops a command file for Minapp to pick up (it polls the folder).
    static func send(_ command: String) {
        guard let dir = commandsDir else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = String(format: "%013.0f-%@.json", Date().timeIntervalSince1970 * 1000, UUID().uuidString)
        let body = try? JSONSerialization.data(withJSONObject: ["command": command])
        try? body?.write(to: dir.appendingPathComponent(name), options: .atomic)
    }
}
