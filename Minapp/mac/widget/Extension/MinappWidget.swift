import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Buttons (run inside the widget; they send a command to Minapp)

struct MinappCommandIntent: AppIntent {
    static var title: LocalizedStringResource = "Control Minapp"
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Command") var command: String

    init() {}
    init(_ command: String) { self.command = command }

    func perform() async throws -> some IntentResult {
        await Shared.send(command)
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// MARK: - Timeline

struct NowEntry: TimelineEntry {
    let date: Date
    let state: NowPlayingState
    var frame: NSImage? = nil
    var stale = false
    var frameData: Data? = nil
}

/// tiny diagnostic log next to the cached frame: when the system calls us and what came back
func wlog(_ m: String) {
    guard let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("widget.log") else { return }
    let line = "\(Date().formatted(.iso8601)) \(m)\n"
    if let h = try? FileHandle(forWritingTo: d) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() } else { try? Data(line.utf8).write(to: d) }
}

enum Fonts {
    static let registered: Bool = {
        for n in ["MinappLED", "MinappLEDGhost"] {
            if let u = Bundle.main.url(forResource: n, withExtension: "ttf") { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
        }
        return true
    }()
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> NowEntry { NowEntry(date: .now, state: sample) }
    func getSnapshot(in context: Context, completion: @escaping (NowEntry) -> Void) {
        if context.isPreview { return completion(NowEntry(date: .now, state: sample)) }
        Task { completion(await load()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<NowEntry>) -> Void) {
        // never block: every network call has a short timeout and falls back to "not playing", so the widget cannot end up blank
        Task {
            let t = Date()
            let e = await load()
            wlog("getTimeline \(context.family.rawValue) took \(Int(Date().timeIntervalSince(t) * 1000)) ms live=\(e.state.isLive) playing=\(e.state.playing) frame=\(e.frame != nil) stale=\(e.stale)")
            guard e.state.playing, !e.stale else {
                return completion(Timeline(entries: [e], policy: .after(.now.addingTimeInterval(20))))
            }
            // one fetch, no waiting: one entry per second (the clock is drawn per entry from the same picture)
            let t0 = Date.now
            let entries = (0..<4).map { i in NowEntry(date: t0.addingTimeInterval(Double(i) * 15), state: e.state, frame: e.frame, frameData: nil) }
            completion(Timeline(entries: entries, policy: .after(t0.addingTimeInterval(60))))
        }
    }
    private func load() async -> NowEntry {
        async let st = Shared.readState()
        async let fr = Shared.readFrame()
        let state = await st
        let data = await fr
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("last-frame.png")
        if state.isLive, let data, let cache { try? data.write(to: cache) }
        if state.isLive { return NowEntry(date: .now, state: state, frame: data.flatMap { NSImage(data: $0) }, frameData: data) }
        // Minapp closed or the Mac just woke: keep the last picture, dimmed by the view, instead of going blank
        let old = cache.flatMap { try? Data(contentsOf: $0) }.flatMap { NSImage(data: $0) }
        return NowEntry(date: .now, state: state, frame: old, stale: old != nil)
    }
    private var sample: NowPlayingState {
        var s = NowPlayingState()
        s.status = "playing"; s.title = "Song title"; s.artist = "Artist"; s.id = "x"
        s.duration = 215; s.position = 60; s.playing = true
        s.bars = [30, 55, 80, 65, 90, 50, 70, 40, 60, 35, 25, 15]
        s.updated = Date().timeIntervalSince1970
        return s
    }
}

extension Image {
    /// desktop widgets drop to accented/monochrome rendering when the desktop is idle or unfocused, which flattens pictures to white
    @ViewBuilder func widgetFull() -> some View {
        if #available(macOS 15.0, *) { self.widgetAccentedRenderingMode(.fullColor) } else { self }
    }
}

/// the skin's thin 9x13 seven-segment digits, drawn one skin pixel at a time
func drawDigit(_ ctx: inout GraphicsContext, _ n: Int, x: CGFloat, y: CGFloat, k: CGFloat) {
    //           top    upper-left upper-right middle lower-left lower-right bottom
    let seg: [[Bool]] = [
        [true, true, true, false, true, true, true], [false, false, true, false, false, true, false],
        [true, false, true, true, true, false, true], [true, false, true, true, false, true, true],
        [false, true, true, true, false, true, false], [true, true, false, true, false, true, true],
        [true, true, false, true, true, true, true], [true, false, true, false, false, true, false],
        [true, true, true, true, true, true, true], [true, true, true, true, false, true, true]]
    let on = seg[max(0, min(9, n))]
    let c = GraphicsContext.Shading.color(Color(red: 0.30, green: 0.96, blue: 0.38))
    func px(_ rx: CGFloat, _ ry: CGFloat, _ rw: CGFloat, _ rh: CGFloat) { ctx.fill(Path(CGRect(x: x + rx * k, y: y + ry * k, width: rw * k, height: rh * k)), with: c) }
    if on[0] { px(1, 0, 7, 1) }; if on[3] { px(1, 6, 7, 1) }; if on[6] { px(1, 12, 7, 1) }
    if on[1] { px(0, 0, 1, 7) }; if on[4] { px(0, 6, 1, 7) }
    if on[2] { px(8, 0, 1, 7) }; if on[5] { px(8, 6, 1, 7) }
}

// MARK: - Look (the Minapp window: steel-blue bevel, black LCD, green LED)

enum Skin {
    static let panel = Color(red: 0.20, green: 0.25, blue: 0.33)
    static let panelHi = Color(red: 0.42, green: 0.50, blue: 0.62)
    static let panelLo = Color(red: 0.10, green: 0.13, blue: 0.19)
    static let titleA = Color(red: 0.16, green: 0.22, blue: 0.33)
    static let titleB = Color(red: 0.32, green: 0.40, blue: 0.54)
    static let lcd = Color.black
    static let led = Color(red: 0.25, green: 1.0, blue: 0.35)
    static let ledDim = Color(red: 0.25, green: 1.0, blue: 0.35).opacity(0.55)
    static let button = Color(red: 0.74, green: 0.82, blue: 0.82)
    static let gold = Color(red: 0.85, green: 0.74, blue: 0.45)
    static func led(_ size: CGFloat) -> Font { .system(size: size, weight: .bold, design: .monospaced) }
}

struct Bevel: ViewModifier {
    var raised = true
    func body(content: Content) -> some View {
        content.overlay(
            RoundedRectangle(cornerRadius: 2)
                .strokeBorder(LinearGradient(colors: raised ? [Skin.panelHi, Skin.panelLo] : [Skin.panelLo, Skin.panelHi], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1.5)
        )
    }
}

struct Bars: View {
    let values: [Int]
    var body: some View {
        GeometryReader { g in
            let n = 12
            let gap: CGFloat = 2
            let w = (g.size.width - gap * CGFloat(n - 1)) / CGFloat(n)
            let seg = 3.0, segGap = 1.0
            let rows = max(1, Int(g.size.height / (seg + segGap)))
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(0..<n, id: \.self) { i in
                    let v = i < values.count ? values[i] : 0
                    let lit = Int(Double(rows) * Double(v) / 100.0)
                    VStack(spacing: segGap) {
                        ForEach(0..<rows, id: \.self) { r in
                            let level = rows - 1 - r          // 0 = bottom
                            let frac = Double(level) / Double(rows)
                            Rectangle()
                                .fill(level < lit ? (frac > 0.8 ? Color.red : frac > 0.55 ? Color.yellow : Skin.led) : Skin.led.opacity(0.07))
                                .frame(width: w, height: seg)
                        }
                    }
                }
            }
        }
    }
}

struct RetroButton: View {
    let symbol: String
    let command: String
    var body: some View {
        Button(intent: MinappCommandIntent(command)) {
            Image(systemName: symbol).font(.system(size: 13, weight: .black)).foregroundStyle(.black.opacity(0.85))
                .frame(maxWidth: .infinity, minHeight: 24)
                .background(LinearGradient(colors: [Skin.button, Skin.button.opacity(0.75)], startPoint: .top, endPoint: .bottom))
                .modifier(Bevel())
        }.buttonStyle(.plain)
    }
}

// MARK: - Views

struct MinappWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: NowEntry

    private var s: NowPlayingState { entry.state }
    private var live: Bool { s.updated > 0 && Date().timeIntervalSince1970 - s.updated < 20 && !s.title.isEmpty }
    private var start: Date { Date(timeIntervalSince1970: s.updated).addingTimeInterval(-s.position) }
    private var range: ClosedRange<Date>? { s.duration > 0 ? start...start.addingTimeInterval(s.duration) : nil }
    private var small: Bool { family == .systemSmall }
    private let _f = Fonts.registered

    var body: some View {
        if let img = entry.frame { frameView(img).opacity(entry.stale ? 0.45 : 1).overlay(alignment: .bottom) { if entry.stale { Text("MINAPP IS NOT PLAYING").font(Skin.led(8)).foregroundStyle(Skin.led).padding(2).background(Skin.lcd) } } } else { drawn }
    }

    /// the real player picture: whole window for medium, the clock + visualizer corner for small
    private func frameView(_ img: NSImage) -> some View {
        GeometryReader { g in
            if small {
                // square layout: the real LCD, title line and transport buttons cut from the skin and stacked
                let w = g.size.width - 12
                let k1 = w / 102, k2 = w / 156, k3 = w / 118
                VStack(spacing: 5) {
                    ZStack(alignment: .topLeading) {
                        piece(img, x: 6, y: 15, w: 102, h: 52, k: k1)
                        liveClock(x: 47 - 6, y: 24 - 15, w: 56, h: 17, k: k1)
                    }
                    piece(img, x: 109, y: 22, w: 156, h: 17, k: k2)
                    ZStack(alignment: .topLeading) {
                        piece(img, x: 14, y: 84, w: 118, h: 26, k: k3)
                        hit("previous", 2, 2, 23, k3); hit("playpause", 25, 2, 23, k3); hit("playpause", 48, 2, 23, k3); hit("next", 94, 2, 22, k3)
                    }
                }
                .padding(6).frame(width: g.size.width, height: g.size.height)
                .background(Skin.panel)
            } else {
                let k = min(g.size.width / 275, g.size.height / 116)
                ZStack(alignment: .topLeading) {
                    Image(nsImage: img).resizable().interpolation(.none).widgetFull().frame(width: 275 * k, height: 116 * k)
                    liveClock(x: 47, y: 24, w: 56, h: 17, k: k)
                    hit("previous", 16, 88, 23, k); hit("playpause", 39, 88, 23, k); hit("playpause", 62, 88, 23, k); hit("next", 108, 88, 22, k)
                }.frame(width: g.size.width, height: g.size.height)
            }
        }
    }
    /// a cut-out of the skin picture, scaled without smoothing
    private func piece(_ img: NSImage, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, k: CGFloat) -> some View {
        Image(nsImage: img).resizable().interpolation(.none).widgetFull()
            .frame(width: 275 * k, height: 116 * k)
            .offset(x: -x * k, y: -y * k)
            .frame(width: w * k, height: h * k, alignment: .topLeading).clipped()
    }
    /// the picture's clock is a still from a moment ago: draw the skin's own LED digits (MinappLED fonts) for this entry's time
    @ViewBuilder private func liveClock(x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, k: CGFloat) -> some View {
        if live, !entry.stale {
            let pos = s.position + (s.playing ? max(0, entry.date.timeIntervalSince1970 - s.updated) : 0)
            let t = Int(min(pos, 5999))
            let lead = t / 60 < 10          // the system's timer prints m:ss; add the skin's leading zero
            let txt = String(format: "%02d:%02d", t / 60, t % 60)
            let ghost = Color(red: 24 / 255, green: 33 / 255, blue: 41 / 255), lit = Color(red: 0, green: 248 / 255, blue: 0)
            // black patch at (x, y) over the old digits; the skin's digits start 1 pt right and 2 pt below the patch corner
            ZStack(alignment: .topLeading) {
                Skin.lcd
                ZStack(alignment: .leading) {
                    Text("88:88").font(.custom("MinappLEDGhost", fixedSize: 13 * k)).foregroundColor(ghost)
                    if let range, s.playing {
                        // ticked by the system between pictures: no reload budget, no fade
                        HStack(spacing: 0) {
                            if lead { Text("0").font(.custom("MinappLED", fixedSize: 13 * k)).foregroundColor(lit) }
                            Text(timerInterval: range, countsDown: false, showsHours: false).font(.custom("MinappLED", fixedSize: 13 * k)).foregroundColor(lit).monospacedDigit().lineLimit(1)
                        }.fixedSize()
                    } else {
                        Text(txt).font(.custom("MinappLED", fixedSize: 13 * k)).foregroundColor(lit)
                    }
                }
                .fixedSize().offset(x: 1 * k, y: 2 * k)
            }
            .frame(width: w * k, height: h * k, alignment: .topLeading).clipped()
            .offset(x: x * k, y: y * k).allowsHitTesting(false)
        }
    }
    private func hit(_ cmd: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ k: CGFloat) -> some View {
        Button(intent: MinappCommandIntent(cmd)) { Color.clear.frame(width: w * k, height: 18 * k).contentShape(Rectangle()) }
            .buttonStyle(.plain).offset(x: x * k, y: y * k)
    }

    private var drawn: some View {
        VStack(spacing: 0) {
            HStack {
                Text("MINAPP").font(.system(size: 9, weight: .heavy, design: .monospaced)).foregroundStyle(.white.opacity(0.9)).tracking(3)
                    .frame(maxWidth: .infinity)
            }
            .frame(height: 14)
            .background(LinearGradient(colors: [Skin.titleA, Skin.titleB, Skin.titleA], startPoint: .leading, endPoint: .trailing))
            VStack(spacing: 5) {
                if small {
                    timeAndBars.frame(maxHeight: .infinity)
                    titleStrip
                } else {
                    HStack(spacing: 5) {
                        timeAndBars.frame(maxWidth: .infinity)
                        VStack(spacing: 4) { titleStrip; Spacer(minLength: 0) }.frame(maxWidth: .infinity)
                    }.frame(maxHeight: .infinity)
                }
                seek
                HStack(spacing: 4) {
                    RetroButton(symbol: "backward.end.fill", command: "previous")
                    RetroButton(symbol: s.playing ? "pause.fill" : "play.fill", command: "playpause")
                    RetroButton(symbol: "forward.end.fill", command: "next")
                }
            }.padding(5)
        }
        .background(Skin.panel)
        .modifier(Bevel())
    }

    /// the app's left LCD: big time with the spectrum under it
    private var timeAndBars: some View {
        VStack(alignment: .leading, spacing: 3) {
            if live {
                timeText
                Bars(values: s.bars).frame(maxHeight: .infinity)
            } else {
                Text("--:--").font(Skin.led(small ? 22 : 28)).foregroundStyle(Skin.ledDim)
                Spacer(minLength: 0)
            }
        }
        .padding(5).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Skin.lcd).modifier(Bevel(raised: false))
    }

    /// the app's green title line
    private var titleStrip: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(live ? s.title.uppercased() : "MINAPP NOT PLAYING").font(Skin.led(small ? 9 : 11)).foregroundStyle(Skin.led).lineLimit(1)
            if !small && live { Text(s.artist.uppercased()).font(Skin.led(9)).foregroundStyle(Skin.ledDim).lineLimit(1) }
        }
        .padding(.horizontal, 5).padding(.vertical, 3).frame(maxWidth: .infinity, alignment: .leading)
        .background(Skin.lcd).modifier(Bevel(raised: false))
    }

    @ViewBuilder private var seek: some View {
        if live, let range, s.playing {
            ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.linear).tint(Skin.gold).frame(height: 6)
        } else if live, s.duration > 0 {
            ProgressView(value: min(s.position, s.duration), total: s.duration).progressViewStyle(.linear).tint(Skin.gold).frame(height: 6)
        }
    }

    @ViewBuilder private var timeText: some View {
        let size: CGFloat = small ? 22 : 28
        if let range, s.playing {
            Text(timerInterval: range, countsDown: false).font(Skin.led(size)).foregroundStyle(Skin.led).monospacedDigit()
        } else {
            let n = Int(max(0, s.position))
            Text(String(format: "%d:%02d", n / 60, n % 60)).font(Skin.led(size)).foregroundStyle(Skin.ledDim)
        }
    }
}

struct MinappWidget: Widget {
    let kind = "MinappNowPlaying"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            MinappWidgetView(entry: entry).transaction { $0.animation = nil }.contentTransition(.identity).containerBackground(Skin.panelLo, for: .widget)
        }
        .configurationDisplayName("Minapp")
        .description("What Minapp is playing, with play, pause, next and previous.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

@main
struct MinappWidgetBundle: WidgetBundle {
    var body: some Widget { MinappWidget() }
}
