import AVFoundation
import ExpoModulesCore
import FileToolkitMediaLibrary
import Photos
import UIKit

struct ScanOptions: Record {
  @Field var folderIds: [String] = []
  @Field var includeSubfolders: Bool = true
  @Field var threshold: Double = 0.8
  @Field var photos: Bool = true
  @Field var videos: Bool = true
}

private struct ScanCancelled: Error {}

/// Duplicates: fingerprints photos and videos and groups the ones that look alike.
public class FTDuplicatesModule: Module {
  private let token = CancelToken()
  private let work = DispatchQueue(label: "filetoolkit.duplicates", qos: .userInitiated)
  private var lastProgress = Date.distantPast

  public func definition() -> ModuleDefinition {
    Name("FTDuplicates")
    Events("onScanProgress")

    AsyncFunction("scanDuplicates") { (opts: ScanOptions, promise: Promise) in
      self.token.reset()
      self.work.async {
        do { promise.resolve(try self.scan(opts)) } catch { self.reject(promise, error) }
      }
    }

    Function("cancel") { self.token.cancel() }
  }

  private func reject(_ promise: Promise, _ error: Error) {
    if token.isCancelled || error is ScanCancelled {
      promise.reject("E_CANCELLED", "Cancelled")
    } else {
      promise.reject("E_ENGINE", String(describing: error))
    }
  }

  private func scan(_ o: ScanOptions) throws -> [[String: Any]] {
    progress("Reading photo library…", 0, 0)
    let cacheURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("hashes_v2_ios.tsv")
    let cache = HashCache(url: cacheURL)
    cache.load()
    defer { cache.save() }

    let assets = MediaLibrary.fetchAssets(albumIds: o.folderIds, photos: o.photos, videos: o.videos)
    let total = assets.count
    var entries: [(ScanItem, Signature)] = []
    var keys = Set<String>()
    let lock = NSLock()
    var done = 0
    progress("Analyzing", 0, total)

    DispatchQueue.concurrentPerform(iterations: total) { i in
      if token.isCancelled { return }
      let (a, folder) = assets[i]
      let key = "\(a.localIdentifier)|\(a.modificationDate?.timeIntervalSince1970 ?? 0)"
      let sig = cache.get(key) ?? fingerprint(a)
      if let s = sig { cache.put(key, s) }
      let res = MediaLibrary.resource(a)
      let item = ScanItem(
        id: a.localIdentifier, isVideo: a.mediaType == .video, width: a.pixelWidth, height: a.pixelHeight,
        size: MediaLibrary.fileSize(res), date: (a.creationDate?.timeIntervalSince1970 ?? 0) * 1000, durationMs: a.duration * 1000,
        info: MediaLibrary.assetMap(a, folder: folder, res: res)
      )
      lock.lock()
      keys.insert(key)
      if let s = sig { entries.append((item, s)) }
      done += 1
      let d = done
      lock.unlock()
      if d % 20 == 0 || d == total { progress("Analyzing", d, total) }
    }
    if token.isCancelled { throw ScanCancelled() }
    if o.photos && o.videos && o.folderIds.isEmpty { cache.prune(keep: keys) }

    progress("Comparing", 0, entries.count)
    let groups = DuplicateFinder.find(entries, threshold: o.threshold) { d, t in self.progress("Comparing", d, t) }
    return groups.map { g in
      [
        "id": g.members[0].item.id,
        "members": g.members.map { m -> [String: Any] in
          var info = m.item.info
          info["similarity"] = m.similarity
          return info
        },
      ]
    }
  }

  private func fingerprint(_ a: PHAsset) -> Signature? {
    if a.mediaType == .video {
      guard let av = MediaLibrary.avAsset(a, network: false) else { return nil }
      let gen = AVAssetImageGenerator(asset: av)
      gen.appliesPreferredTrackTransform = true
      gen.maximumSize = CGSize(width: 192, height: 192)
      gen.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
      gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
      let dur = av.duration.seconds
      guard dur > 0 else { return nil }
      let frames: [FrameFeature?] = [0.15, 0.35, 0.50, 0.65, 0.85].map { p in
        let t = CMTime(seconds: dur * p, preferredTimescale: 600)
        guard let img = try? gen.copyCGImage(at: t, actualTime: nil) else { return nil }
        return PerceptualHash.feature(img)
      }
      return Signature(frames: frames)
    }
    let opts = PHImageRequestOptions()
    opts.isSynchronous = true
    opts.deliveryMode = .highQualityFormat
    opts.resizeMode = .fast
    opts.isNetworkAccessAllowed = true // small derivative only, fine for iCloud photos
    var cg: CGImage?
    PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: 256, height: 256), contentMode: .aspectFit, options: opts) { img, _ in
      cg = img?.cgImage
    }
    guard let image = cg else { return nil }
    return Signature(frames: [PerceptualHash.feature(image)])
  }

  private func progress(_ stage: String, _ done: Int, _ total: Int) {
    let now = Date()
    if done != total && now.timeIntervalSince(lastProgress) < 0.15 { return }
    lastProgress = now
    sendEvent("onScanProgress", ["stage": stage, "done": done, "total": total])
  }
}
