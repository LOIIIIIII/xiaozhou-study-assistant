import Foundation
import Vision
import AppKit
guard CommandLine.arguments.count == 2,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fputs("无法读取 OCR 图片\n", stderr); exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true
do {
  try VNImageRequestHandler(cgImage: cgImage).perform([request])
  let lines = (request.results ?? []).compactMap { item -> [String: Any]? in
    guard let candidate = item.topCandidates(1).first else { return nil }
    return ["text": candidate.string, "confidence": candidate.confidence,
            "x": item.boundingBox.origin.x, "y": item.boundingBox.origin.y]
  }.sorted { a, b in
    let ay = a["y"] as! CGFloat, by = b["y"] as! CGFloat
    return abs(ay-by) > 0.015 ? ay > by : (a["x"] as! CGFloat) < (b["x"] as! CGFloat)
  }
  let data = try JSONSerialization.data(withJSONObject: lines)
  print(String(data: data, encoding: .utf8)!)
} catch { fputs("OCR 失败\n", stderr); exit(1) }
