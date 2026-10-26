import AppKit
import AVFoundation
import ApplicationServices
import Darwin

/// 网页只有在前台才能收到 keydown。这个程序在后台收全局按键，播放同一套 wav。
/// 按键不会被吃掉，也只用来挑音频，不写入文件。
final class KeySound {
    private var players: [String: AVAudioPlayer] = [:]
    private var globalMonitor: Any?
    private var localMonitor: Any?

    func load(audioDir: URL) -> [String] {
        var missing: [String] = []
        for name in Self.expectedNames {
            let url = audioDir.appendingPathComponent(name).appendingPathExtension("wav")
            do {
                let player = try AVAudioPlayer(contentsOf: url)
                player.prepareToPlay()
                players[name] = player
            } catch {
                missing.append("\(name).wav（\(error.localizedDescription)）")
            }
        }
        return missing
    }

    func installMonitors() -> Bool {
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.play(event)
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.play(event)
            return event
        }
        return globalMonitor != nil
    }

    private func play(_ event: NSEvent) {
        if event.isARepeat { return }
        guard let name = Self.keyNames[event.keyCode], let player = players[name] else { return }
        if player.isPlaying {
            player.pause()
        }
        player.currentTime = 0
        player.play()
    }

    /// 与 keyboard/index.html 的 keyCode 范围一致：A–Z、0–9、四个方向键。
    /// 这里用 Mac 物理键码，这样页面不在前台时也能对上同一批键。
    private static let keyNames: [UInt16: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X",
        8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R",
        16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6",
        23: "5", 25: "9", 26: "7", 28: "8", 29: "0", 31: "O", 32: "U",
        34: "I", 35: "P", 37: "L", 38: "J", 40: "K", 45: "N", 46: "M",
        123: "LEFT", 124: "RIGHT", 125: "DOWN", 126: "UP",
    ]

    static func unmappedNames() -> [String] {
        let mapped = Set(keyNames.values)
        return expectedNames.filter { !mapped.contains($0) }
    }

    static var expectedNames: [String] {
        var names = ["LEFT", "UP", "RIGHT", "DOWN"]
        names += (0...9).map(String.init)
        let a = Int(UnicodeScalar("A").value)
        let z = Int(UnicodeScalar("Z").value)
        names += (a...z).compactMap { UnicodeScalar($0).map(String.init) }
        return names
    }
}

private var signalSources: [DispatchSourceSignal] = []

private func installQuitSignals() {
    for sig in [SIGINT, SIGTERM] {
        signal(sig, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        source.setEventHandler {
            exit(0)
        }
        source.resume()
        signalSources.append(source)
    }
}

private func accessibilityGranted() -> Bool {
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [prompt: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

private func fail(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(1)
}

let arguments = Array(CommandLine.arguments.dropFirst())
let selfTest = arguments.contains("--self-test")
let rootPath = arguments.first { !$0.hasPrefix("-") } ?? FileManager.default.currentDirectoryPath
let audioDir = URL(fileURLWithPath: rootPath).appendingPathComponent("keyboard/audios", isDirectory: true)

var isDir: ObjCBool = false
if !FileManager.default.fileExists(atPath: audioDir.path, isDirectory: &isDir) || !isDir.boolValue {
    fail("找不到音频目录：\(audioDir.path)")
}

let keySound = KeySound()
let missing = keySound.load(audioDir: audioDir)
if !missing.isEmpty {
    fail("这些读音没加载成功：\n" + missing.joined(separator: "\n"))
}

if selfTest {
    let loaded = Set(KeySound.expectedNames)
    if loaded.count != 40 {
        fail("读音数量应为 40，实际 \(loaded.count)")
    }
    let unmapped = KeySound.unmappedNames()
    if !unmapped.isEmpty {
        fail("这些键没有对应读音：\(unmapped.joined(separator: "、"))")
    }
    fputs("已加载 40 个读音\n", stderr)
    exit(0)
}

if !accessibilityGranted() {
    fail("""
    还不能在后台听按键。请打开「系统设置 → 隐私与安全性 → 辅助功能」，
    允许正在运行本程序的「终端」（从 Cursor 里启动则允许 Cursor）。
    如果允许之后仍然没有声音，再到「输入监控」里同样打开，然后重新运行。
    """)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
installQuitSignals()
if !keySound.installMonitors() {
    fail("全局按键监听没有建起来。请确认辅助功能里已经允许终端或 Cursor，然后重新运行。")
}

fputs("后台读音已开。现在可以切到其他软件打字，结束请按 Ctrl+C。\n", stderr)
app.run()
