import Foundation
import Vision
import ImageIO

struct OCRBox: Codable { let x0: Double; let y0: Double; let x1: Double; let y1: Double }
struct OCRRegion: Codable {
    let id: String
    let source: String
    let translated: String
    let confidence: Double
    let box: OCRBox
    let fontFamily: String
}
struct OCROutput: Codable { let regions: [OCRRegion]; let error: String? }

@main
struct YomiLensVisionOCR {
    static func main() {
        if CommandLine.arguments.contains("--status") { print("{\"available\":true}"); return }
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            emit(.init(regions: [], error: "无法读取 OCR 图像")); return
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ja-JP", "en-US"]
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.012
        do {
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
            let width = Double(image.width), height = Double(image.height)
            let regions = (request.results ?? []).enumerated().compactMap { index, observation -> OCRRegion? in
                guard let candidate = observation.topCandidates(1).first else { return nil }
                let b = observation.boundingBox
                return OCRRegion(
                    id: "vision-\(index)", source: candidate.string, translated: "", confidence: Double(candidate.confidence * 100),
                    box: .init(x0: b.minX * width, y0: (1 - b.maxY) * height, x1: b.maxX * width, y1: (1 - b.minY) * height),
                    fontFamily: "sans"
                )
            }
            emit(.init(regions: regions, error: nil))
        } catch { emit(.init(regions: [], error: "Vision OCR 失败：\(error.localizedDescription)")) }
    }

    static func emit(_ output: OCROutput) {
        let data = try! JSONEncoder().encode(output)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
