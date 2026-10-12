import Foundation

/// What Minapp (the Electron player) serves over loopback HTTP.
struct NowPlayingState: Codable, Equatable {
    var status: String = "closed"
    var title: String = ""
    var artist: String = ""
    var id: String = ""
    var source: String = "spotify"
    var duration: Double = 0
    var position: Double = 0
    var playing: Bool = false
    var bars: [Int] = []     // 12 spectrum values 0-100, empty when nothing plays
    var updated: Double = 0   // unix seconds of the write; a silent file means Minapp is closed

    init() {}
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "closed"
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        artist = try c.decodeIfPresent(String.self, forKey: .artist) ?? ""
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "spotify"
        duration = try c.decodeIfPresent(Double.self, forKey: .duration) ?? 0
        position = try c.decodeIfPresent(Double.self, forKey: .position) ?? 0
        playing = try c.decodeIfPresent(Bool.self, forKey: .playing) ?? false
        bars = try c.decodeIfPresent([Int].self, forKey: .bars) ?? []
        updated = try c.decodeIfPresent(Double.self, forKey: .updated) ?? 0
    }
    enum K: String, CodingKey { case status, title, artist, id, source, duration, position, playing, bars, updated }

    /// Minapp rewrites the file every few seconds while it runs.
    var isLive: Bool { Date().timeIntervalSince1970 - updated < 20 }
    var hasTrack: Bool { !title.isEmpty && isLive }
}

enum Shared {
    /// Minapp serves on loopback only; the shared secret is baked into both bundles at build time (see README).
    static let base = "http://127.0.0.1:47831"
    static var secret: String { Bundle.main.object(forInfoDictionaryKey: "MinappSecret") as? String ?? "" }

    private static func request(_ path: String, method: String) async -> (Data?, Bool) {
        guard let url = URL(string: base + path) else { return (nil, false) }
        var r = URLRequest(url: url, timeoutInterval: 2)
        r.httpMethod = method
        r.setValue(secret, forHTTPHeaderField: "X-Minapp-Token")
        guard let (d, resp) = try? await URLSession.shared.data(for: r) else { return (nil, false) }
        return (d, ((resp as? HTTPURLResponse)?.statusCode ?? 0) < 300)
    }

    static func readState() async -> NowPlayingState {
        let (d, ok) = await request("/state", method: "GET")
        guard ok, let d, let s = try? JSONDecoder().decode(NowPlayingState.self, from: d) else { return NowPlayingState() }
        return s
    }

    /// PNG of the real player window (404 when it is hidden or Minapp is old).
    static func readFrame() async -> Data? {
        let (d, ok) = await request("/frame", method: "GET")
        return ok ? d : nil
    }

    static func send(_ command: String) async {
        _ = await request("/cmd?c=" + command, method: "POST")
    }
}
