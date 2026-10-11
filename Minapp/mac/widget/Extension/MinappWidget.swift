import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Buttons (run inside the widget; they drop a command for Minapp)

struct MinappCommandIntent: AppIntent {
    static var title: LocalizedStringResource = "Control Minapp"
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Command") var command: String

    init() {}
    init(_ command: String) { self.command = command }

    func perform() async throws -> some IntentResult {
        Shared.send(command)
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// MARK: - Timeline

struct NowEntry: TimelineEntry {
    let date: Date
    let state: NowPlayingState
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> NowEntry {
        NowEntry(date: .now, state: sample)
    }
    func getSnapshot(in context: Context, completion: @escaping (NowEntry) -> Void) {
        completion(context.isPreview ? NowEntry(date: .now, state: sample) : NowEntry(date: .now, state: Shared.readState()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<NowEntry>) -> Void) {
        let s = Shared.readState()
        // second entry flips to "Minapp isn't running" if the file goes silent
        let entries = [NowEntry(date: .now, state: s), NowEntry(date: .now.addingTimeInterval(25), state: s)]
        completion(Timeline(entries: entries, policy: .after(.now.addingTimeInterval(60))))
    }
    private var sample: NowPlayingState {
        NowPlayingState(status: "playing", title: "Song title", artist: "Artist", id: "x", duration: 215, position: 60, playing: true, updated: Date().timeIntervalSince1970)
    }
}

// MARK: - Views

struct MinappWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: NowEntry

    private var s: NowPlayingState { entry.state }
    private var live: Bool { s.updated > 0 && entry.date.timeIntervalSince1970 - s.updated < 20 && !s.title.isEmpty }
    private var start: Date { Date(timeIntervalSince1970: s.updated - 0).addingTimeInterval(-s.position) }
    private var range: ClosedRange<Date>? {
        s.duration > 0 ? start...start.addingTimeInterval(s.duration) : nil
    }

    var body: some View {
        if live {
            VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(s.title).font(.headline).lineLimit(family == .systemSmall ? 2 : 1)
                    Text(s.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                progress
                controls
            }
        } else {
            VStack(spacing: 6) {
                Image(systemName: "music.note").font(.title2)
                Text("Minapp isn't playing").font(.footnote).multilineTextAlignment(.center)
                Text("Open Minapp and start a song").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private var progress: some View {
        if let range, s.playing {
            VStack(spacing: 2) {
                ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                    .progressViewStyle(.linear)
                if family != .systemSmall {
                    HStack {
                        Text(timerInterval: range, countsDown: false).monospacedDigit()
                        Spacer()
                        Text(format(s.duration)).monospacedDigit()
                    }.font(.caption2).foregroundStyle(.secondary)
                }
            }
        } else if s.duration > 0 {
            VStack(spacing: 2) {
                ProgressView(value: min(s.position, s.duration), total: s.duration).progressViewStyle(.linear)
                if family != .systemSmall {
                    HStack {
                        Text(format(s.position)).monospacedDigit()
                        Spacer()
                        Text(format(s.duration)).monospacedDigit()
                    }.font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var controls: some View {
        HStack(spacing: family == .systemSmall ? 14 : 28) {
            Spacer(minLength: 0)
            button("backward.fill", "previous")
            button(s.playing ? "pause.fill" : "play.fill", "playpause", big: true)
            button("forward.fill", "next")
            Spacer(minLength: 0)
        }
    }

    private func button(_ symbol: String, _ command: String, big: Bool = false) -> some View {
        Button(intent: MinappCommandIntent(command)) {
            Image(systemName: symbol).font(big ? .title2 : .body)
        }.buttonStyle(.plain)
    }

    private func format(_ t: Double) -> String {
        let n = Int(max(0, t)); return String(format: "%d:%02d", n / 60, n % 60)
    }
}

struct MinappWidget: Widget {
    let kind = "MinappNowPlaying"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            MinappWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Minapp")
        .description("What Minapp is playing, with play, pause, next and previous.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct MinappWidgetBundle: WidgetBundle {
    var body: some Widget { MinappWidget() }
}
