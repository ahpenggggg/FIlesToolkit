import AVFoundation
import Foundation
import FileToolkitMediaLibrary

struct EncodeError: Error, CustomStringConvertible {
  let description: String
}

/// HEVC re-encode with AVAssetReader → AVAssetWriter.
/// A single AVVideoComposition does rotation (renders upright), downscaling, the fps cap
/// (frameDuration) and HDR→SDR tone-mapping (BT.709 colour properties). Audio is copied untouched
/// when possible, otherwise re-encoded to AAC 128 kbps.
enum IOSVideoEncoder {

  static func encode(
    asset: AVAsset,
    to out: URL,
    scale: Double,
    fps: Double,
    dropFrames: Bool,
    bitrate: Int,
    token: CancelToken,
    progress: @escaping (Double) -> Void
  ) throws -> String {
    try? FileManager.default.removeItem(at: out)
    guard let vTrack = asset.tracks(withMediaType: .video).first else { throw EncodeError(description: "No video track") }
    let duration = asset.duration.seconds
    guard duration > 0 else { throw EncodeError(description: "Unknown duration") }

    // ---- video composition: upright, scaled, fps-capped, SDR ----
    let t = vTrack.preferredTransform
    let display = CGRect(origin: .zero, size: vTrack.naturalSize).applying(t)
    let dw = abs(display.width), dh = abs(display.height)
    let ow = even(dw * scale), oh = even(dh * scale)
    let sx = CGFloat(ow) / dw, sy = CGFloat(oh) / dh

    let comp = AVMutableVideoComposition()
    comp.renderSize = CGSize(width: ow, height: oh)
    let nativeFrame = vTrack.minFrameDuration
    if dropFrames && fps > 0 {
      comp.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps.rounded()))
    } else if nativeFrame.isValid && nativeFrame.seconds > 0 {
      comp.frameDuration = nativeFrame
    } else {
      let nominal = vTrack.nominalFrameRate > 0 ? vTrack.nominalFrameRate : 30
      comp.frameDuration = CMTime(value: 1, timescale: CMTimeScale(nominal.rounded()))
    }
    comp.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    comp.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    comp.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: vTrack)
    let upright = t
      .concatenating(CGAffineTransform(translationX: -display.origin.x, y: -display.origin.y))
      .concatenating(CGAffineTransform(scaleX: sx, y: sy))
    layer.setTransform(upright, at: .zero)
    instruction.layerInstructions = [layer]
    comp.instructions = [instruction]

    // ---- reader ----
    let reader = try AVAssetReader(asset: asset)
    let vOut = AVAssetReaderVideoCompositionOutput(
      videoTracks: [vTrack],
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
    )
    vOut.videoComposition = comp
    vOut.alwaysCopiesSampleData = false
    guard reader.canAdd(vOut) else { throw EncodeError(description: "Can't read video frames") }
    reader.add(vOut)

    // ---- writer ----
    let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let outFps = 1.0 / comp.frameDuration.seconds
    func videoSettings(_ codec: AVVideoCodecType) -> [String: Any] {
      [
        AVVideoCodecKey: codec,
        AVVideoWidthKey: ow,
        AVVideoHeightKey: oh,
        AVVideoColorPropertiesKey: [
          AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
          AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
          AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: bitrate,
          AVVideoExpectedSourceFrameRateKey: Int(outFps.rounded()),
          AVVideoMaxKeyFrameIntervalDurationKey: 2,
        ],
      ]
    }
    var codecName = "HEVC"
    var settings = videoSettings(.hevc)
    if !writer.canApply(outputSettings: settings, forMediaType: .video) {
      settings = videoSettings(.h264)
      codecName = "H.264"
    }
    let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    vIn.expectsMediaDataInRealTime = false
    guard writer.canAdd(vIn) else { throw EncodeError(description: "Encoder rejected settings") }
    writer.add(vIn)

    // ---- audio: passthrough, else AAC ----
    var aOut: AVAssetReaderTrackOutput?
    var aIn: AVAssetWriterInput?
    if let aTrack = asset.tracks(withMediaType: .audio).first {
      let hint = aTrack.formatDescriptions.first.map { $0 as! CMFormatDescription }
      let passIn = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: hint)
      let passOut = AVAssetReaderTrackOutput(track: aTrack, outputSettings: nil)
      if writer.canAdd(passIn) && reader.canAdd(passOut) {
        writer.add(passIn); reader.add(passOut)
        aIn = passIn; aOut = passOut
      } else {
        let pcmOut = AVAssetReaderTrackOutput(track: aTrack, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
        let aacIn = AVAssetWriterInput(mediaType: .audio, outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVNumberOfChannelsKey: 2,
          AVSampleRateKey: 44_100,
          AVEncoderBitRateKey: 128_000,
        ])
        if writer.canAdd(aacIn) && reader.canAdd(pcmOut) {
          writer.add(aacIn); reader.add(pcmOut)
          aIn = aacIn; aOut = pcmOut
        }
      }
    }
    aIn?.expectsMediaDataInRealTime = false

    guard reader.startReading() else { throw EncodeError(description: reader.error?.localizedDescription ?? "Reader failed") }
    guard writer.startWriting() else { throw EncodeError(description: writer.error?.localizedDescription ?? "Writer failed") }
    writer.startSession(atSourceTime: .zero)

    let group = DispatchGroup()
    let videoQueue = DispatchQueue(label: "filetoolkit.encode.video")
    let audioQueue = DispatchQueue(label: "filetoolkit.encode.audio")
    var lastReport = Date.distantPast

    group.enter()
    vIn.requestMediaDataWhenReady(on: videoQueue) {
      while vIn.isReadyForMoreMediaData {
        if token.isCancelled { vIn.markAsFinished(); group.leave(); return }
        guard let sample = vOut.copyNextSampleBuffer() else { vIn.markAsFinished(); group.leave(); return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        if !vIn.append(sample) { group.leave(); return }
        if Date().timeIntervalSince(lastReport) > 0.4 {
          lastReport = Date()
          progress(min(0.99, max(0, pts / duration)))
        }
      }
    }

    if let aIn = aIn, let aOut = aOut {
      group.enter()
      aIn.requestMediaDataWhenReady(on: audioQueue) {
        while aIn.isReadyForMoreMediaData {
          if token.isCancelled { aIn.markAsFinished(); group.leave(); return }
          guard let sample = aOut.copyNextSampleBuffer() else { aIn.markAsFinished(); group.leave(); return }
          if !aIn.append(sample) { group.leave(); return }
        }
      }
    }

    group.wait()

    if token.isCancelled {
      reader.cancelReading()
      writer.cancelWriting()
      try? FileManager.default.removeItem(at: out)
      throw EncodeError(description: "Cancelled")
    }
    if reader.status == .failed {
      writer.cancelWriting()
      throw EncodeError(description: reader.error?.localizedDescription ?? "Reading failed")
    }

    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    done.wait()
    guard writer.status == .completed else {
      throw EncodeError(description: writer.error?.localizedDescription ?? "Writing failed")
    }
    progress(1)
    return codecName
  }

  private static func even(_ v: CGFloat) -> Int {
    let r = Int(v.rounded())
    return max(2, r - (r % 2))
  }
}
