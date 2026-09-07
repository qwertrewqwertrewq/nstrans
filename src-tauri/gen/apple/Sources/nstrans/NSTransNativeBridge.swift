import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers
import Vision

private struct OCRBox: Codable {
    let x0: Double
    let y0: Double
    let x1: Double
    let y1: Double
}

private struct OCRRegion: Codable {
    let id: String
    let source: String
    let translated: String
    let confidence: Double
    let box: OCRBox
    let fontFamily: String
}

private struct OCROutput: Codable {
    let regions: [OCRRegion]
    let error: String?
}

private struct CameraDevice: Codable {
    let id: String
    let label: String
    let vendorId: Int
    let productId: Int
    let connected: Bool
}

private final class IOSCameraBridge: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let shared = IOSCameraBridge()

    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "xyz.nstrans.capture", qos: .userInitiated)
    private let stateQueue = DispatchQueue(label: "xyz.nstrans.capture.state")
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private var latestJPEG: Data?
    private var latestWidth = 0
    private var latestHeight = 0
    private var latestTimestamp: UInt64 = 0
    private var lastEncodedAt: CFTimeInterval = 0

    func devicesJSON() -> String {
        guard #available(iOS 17.0, *) else {
            return json(["devices": [], "error": "外接 UVC 采集卡需要 iPadOS 17 或更高版本"])
        }
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external], mediaType: .video, position: .unspecified
        ).devices.map {
            CameraDevice(id: $0.uniqueID, label: $0.localizedName, vendorId: 0, productId: 0, connected: $0.isConnected)
        }
        return json(["devices": encodableArray(devices)])
    }

    func open(deviceID: String) -> String {
        guard #available(iOS 17.0, *) else {
            return json(["available": false, "width": 0, "height": 0, "label": "", "error": "外接 UVC 采集卡需要 iPadOS 17 或更高版本"])
        }
        guard ensureCameraPermission() else {
            return json(["available": false, "width": 0, "height": 0, "label": "", "error": "相机权限未授权"])
        }
        let device = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external], mediaType: .video, position: .unspecified
        ).devices.first { $0.uniqueID == deviceID }
        guard let device else {
            return json(["available": false, "width": 0, "height": 0, "label": "", "error": "USB UVC 设备已断开"])
        }
        do {
            let input = try AVCaptureDeviceInput(device: device)
            session.stopRunning()
            session.beginConfiguration()
            session.inputs.forEach(session.removeInput)
            session.outputs.forEach(session.removeOutput)
            if session.canSetSessionPreset(.hd1920x1080) { session.sessionPreset = .hd1920x1080 }
            guard session.canAddInput(input) else { throw BridgeError.message("采集卡输入格式不可用") }
            session.addInput(input)
            let output = AVCaptureVideoDataOutput()
            output.alwaysDiscardsLateVideoFrames = true
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.setSampleBufferDelegate(self, queue: captureQueue)
            guard session.canAddOutput(output) else { throw BridgeError.message("采集卡视频输出不可用") }
            session.addOutput(output)
            session.commitConfiguration()
            stateQueue.sync {
                latestJPEG = nil
                latestWidth = 0
                latestHeight = 0
                latestTimestamp = 0
            }
            captureQueue.async { [session] in session.startRunning() }
            let dimensions = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
            return json([
                "available": true,
                "width": Int(dimensions.width),
                "height": Int(dimensions.height),
                "label": device.localizedName,
                "error": NSNull()
            ])
        } catch {
            if session.isRunning { session.stopRunning() }
            return json(["available": false, "width": 0, "height": 0, "label": device.localizedName, "error": error.localizedDescription])
        }
    }

    func close() -> String {
        session.stopRunning()
        stateQueue.sync { latestJPEG = nil }
        return "{}"
    }

    func frameJSON() -> String {
        let snapshot = stateQueue.sync { (latestJPEG, latestWidth, latestHeight, latestTimestamp) }
        guard let data = snapshot.0 else { return json(["error": "正在等待采集卡画面"]) }
        return json([
            "imageBase64": data.base64EncodedString(),
            "width": snapshot.1,
            "height": snapshot.2,
            "timestamp": snapshot.3
        ])
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard now - lastEncodedAt >= 0.1, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastEncodedAt = now
        autoreleasepool {
            let image = CIImage(cvPixelBuffer: pixelBuffer)
            guard let cgImage = imageContext.createCGImage(image, from: image.extent),
                  let destinationData = CFDataCreateMutable(nil, 0),
                  let destination = CGImageDestinationCreateWithData(destinationData, "public.jpeg" as CFString, 1, nil) else { return }
            CGImageDestinationAddImage(destination, cgImage, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { return }
            let data = destinationData as Data
            let width = CVPixelBufferGetWidth(pixelBuffer)
            let height = CVPixelBufferGetHeight(pixelBuffer)
            let timestamp = UInt64(Date().timeIntervalSince1970 * 1000)
            stateQueue.sync {
                latestJPEG = data
                latestWidth = width
                latestHeight = height
                latestTimestamp = timestamp
            }
        }
    }

    private func ensureCameraPermission() -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined:
            let semaphore = DispatchSemaphore(value: 0)
            var allowed = false
            AVCaptureDevice.requestAccess(for: .video) { granted in allowed = granted; semaphore.signal() }
            _ = semaphore.wait(timeout: .now() + 30)
            return allowed
        default: return false
        }
    }
}

private enum BridgeError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let value) = self { return value }
        return nil
    }
}

private func json(_ object: Any) -> String {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object),
          let value = String(data: data, encoding: .utf8) else { return "{\"error\":\"无法编码原生结果\"}" }
    return value
}

private func encodableArray<T: Encodable>(_ values: [T]) -> [[String: Any]] {
    guard let data = try? JSONEncoder().encode(values),
          let result = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
    return result
}

private func retainedCString(_ value: String) -> UnsafeMutablePointer<CChar>? { strdup(value) }

private final class IOSModelPickerDelegate: NSObject, UIDocumentPickerDelegate {
    let destination: URL
    let semaphore = DispatchSemaphore(value: 0)
    var result = json(["available": false, "cancelled": false, "error": "模型选择器没有返回结果"])

    init(destination: URL) { self.destination = destination }

    func fail(_ message: String, cancelled: Bool = false) {
        let error: Any = cancelled ? NSNull() : message
        result = json(["available": false, "cancelled": cancelled, "error": error])
        semaphore.signal()
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        fail("", cancelled: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let source = urls.first else { return fail("没有选择模型文件") }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let accessed = source.startAccessingSecurityScopedResource()
            defer { if accessed { source.stopAccessingSecurityScopedResource() } }
            do {
                let files = FileManager.default
                try files.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                if files.fileExists(atPath: destination.path) { try files.removeItem(at: destination) }
                try files.copyItem(at: source, to: destination)
                result = json(["available": true, "cancelled": false, "error": NSNull()])
                semaphore.signal()
            } catch {
                fail("复制模型失败：\(error.localizedDescription)")
            }
        }
    }
}

private var activeModelPicker: IOSModelPickerDelegate?

private func topViewController() -> UIViewController? {
    let root = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .first(where: \.isKeyWindow)?.rootViewController
    var current = root
    while let presented = current?.presentedViewController { current = presented }
    return current
}

private typealias FreeStringFunction = @convention(c) (UnsafeMutablePointer<CChar>?) -> Void
private typealias VisionOCRFunction = @convention(c) (UnsafePointer<UInt8>?, Int) -> UnsafeMutablePointer<CChar>?
private typealias NoArgumentJSONFunction = @convention(c) () -> UnsafeMutablePointer<CChar>?
private typealias OpenUSBFunction = @convention(c) (UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?
private typealias PickModelFunction = @convention(c) (UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?

@_silgen_name("nstrans_register_ios_bridge")
private func nstransRegisterIOSBridge(
    _ freeString: FreeStringFunction,
    _ visionOCR: VisionOCRFunction,
    _ usbDevices: NoArgumentJSONFunction,
    _ usbOpen: OpenUSBFunction,
    _ usbClose: NoArgumentJSONFunction,
    _ usbFrame: NoArgumentJSONFunction,
    _ pickModel: PickModelFunction
)

@_cdecl("nstrans_install_bridge")
public func nstransInstallBridge() {
    nstransRegisterIOSBridge(
        nstransFreeString,
        nstransVisionOCRJSON,
        nstransUSBDevicesJSON,
        nstransUSBOpenJSON,
        nstransUSBCloseJSON,
        nstransUSBFrameJSON,
        nstransPickModelJSON
    )
}

@_cdecl("nstrans_free_string")
public func nstransFreeString(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }

@_cdecl("nstrans_ios_pick_model_json")
public func nstransPickModelJSON(_ destination: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let destination else { return retainedCString(json(["available": false, "cancelled": false, "error": "模型保存路径为空"])) }
    let delegate = IOSModelPickerDelegate(destination: URL(fileURLWithPath: String(cString: destination)))
    DispatchQueue.main.async {
        guard let presenter = topViewController() else { return delegate.fail("无法显示系统文件选择器") }
        activeModelPicker = delegate
        let gguf = UTType(filenameExtension: "gguf") ?? .data
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [gguf], asCopy: true)
        picker.allowsMultipleSelection = false
        picker.delegate = delegate
        presenter.present(picker, animated: true)
    }
    delegate.semaphore.wait()
    DispatchQueue.main.async { activeModelPicker = nil }
    return retainedCString(delegate.result)
}

@_cdecl("nstrans_vision_ocr_json")
public func nstransVisionOCRJSON(_ bytes: UnsafePointer<UInt8>?, _ count: Int) -> UnsafeMutablePointer<CChar>? {
    guard let bytes, count > 0 else { return retainedCString("{\"regions\":[],\"error\":\"OCR 图像为空\"}") }
    return autoreleasepool {
        let data = Data(bytes: bytes, count: count)
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return retainedCString("{\"regions\":[],\"error\":\"无法读取 OCR 图像\"}")
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ja-JP", "en-US"]
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.009
        do {
            try VNImageRequestHandler(cgImage: image).perform([request])
            let width = Double(image.width)
            let height = Double(image.height)
            let regions = (request.results ?? []).enumerated().compactMap { index, observation -> OCRRegion? in
                guard let candidate = observation.topCandidates(1).first else { return nil }
                let box = observation.boundingBox
                return OCRRegion(
                    id: "vision-ios-\(index)", source: candidate.string, translated: "",
                    confidence: Double(candidate.confidence * 100),
                    box: OCRBox(x0: box.minX * width, y0: (1 - box.maxY) * height,
                                x1: box.maxX * width, y1: (1 - box.minY) * height),
                    fontFamily: "sans"
                )
            }
            let encoded = try JSONEncoder().encode(OCROutput(regions: regions, error: nil))
            return retainedCString(String(data: encoded, encoding: .utf8) ?? "{\"regions\":[]}")
        } catch {
            let output = OCROutput(regions: [], error: "Apple Vision OCR 失败：\(error.localizedDescription)")
            let encoded = try? JSONEncoder().encode(output)
            return retainedCString(encoded.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"regions\":[]}")
        }
    }
}

@_cdecl("nstrans_usb_devices_json")
public func nstransUSBDevicesJSON() -> UnsafeMutablePointer<CChar>? {
    retainedCString(IOSCameraBridge.shared.devicesJSON())
}

@_cdecl("nstrans_usb_open_json")
public func nstransUSBOpenJSON(_ deviceID: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    retainedCString(IOSCameraBridge.shared.open(deviceID: deviceID.map(String.init(cString:)) ?? ""))
}

@_cdecl("nstrans_usb_close_json")
public func nstransUSBCloseJSON() -> UnsafeMutablePointer<CChar>? {
    retainedCString(IOSCameraBridge.shared.close())
}

@_cdecl("nstrans_usb_frame_json")
public func nstransUSBFrameJSON() -> UnsafeMutablePointer<CChar>? {
    retainedCString(IOSCameraBridge.shared.frameJSON())
}
