import Foundation
import Translation

struct TranslationInput: Codable { let texts: [String] }
struct TranslationOutput: Codable { let available: Bool; let translations: [String]?; let error: String? }

@main
struct YomiLensTranslationCLI {
    static func emit(_ output: TranslationOutput, exitCode: Int32 = 0) -> Never {
        let data = try! JSONEncoder().encode(output)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        exit(exitCode)
    }

    static func main() async {
        guard #available(macOS 26.4, *) else {
            emit(.init(available: false, translations: nil, error: "Apple 系统翻译需要 macOS 26.4 或更高版本。"), exitCode: 2)
        }
        let source = Locale.Language(identifier: "ja"), target = Locale.Language(identifier: "zh-Hans")
        let status = await LanguageAvailability(preferredStrategy: .lowLatency).status(from: source, to: target)
        guard status == .installed else {
            emit(.init(available: false, translations: nil, error: "尚未安装日语到简体中文的系统翻译语言包。请先在 macOS 翻译 App 中下载日语和简体中文。"), exitCode: 3)
        }
        if CommandLine.arguments.contains("--status") { emit(.init(available: true, translations: nil, error: nil)) }

        do {
            let input = try JSONDecoder().decode(TranslationInput.self, from: FileHandle.standardInput.readDataToEndOfFile())
            let session = TranslationSession(installedSource: source, target: target, preferredStrategy: .lowLatency)
            let requests = input.texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
            let responses = try await session.translations(from: requests)
            let ordered = responses.sorted { Int($0.clientIdentifier ?? "0")! < Int($1.clientIdentifier ?? "0")! }.map(\.targetText)
            emit(.init(available: true, translations: ordered, error: nil))
        } catch {
            emit(.init(available: false, translations: nil, error: "系统翻译失败：\(error.localizedDescription)"), exitCode: 1)
        }
    }
}
