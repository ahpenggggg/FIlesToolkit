import AVFoundation
import ExpoModulesCore
import FileToolkitMediaLibrary
import Photos

struct ListVideosOptions: Record {
  @Field var folderIds: [String] = []
  @Field var includeSubfolders: Bool = true
  @Field var minSize: Double = 5 * 1_048_576
}

struct CompressOptions: Record {
  @Field var id: String = ""
  @Field var scale: Double = 1
  @Field var fps: Double = 0
  @Field var dropFrames: Bool = false
  @Field var bitrate: Double = 2_000_000
}

struct RenameItem: Record {
  @Field var id: String = ""
  @Field var name: String = ""
}

private let minSaving: Int64 = 1_048_576

/// Compress video: lists large videos, re-encodes them to HEVC and saves the result to the library.
public class FTCompressModule: Module {
  private let token = CancelToken()
  private let work = DispatchQueue(label: "filetoolkit.compress", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("FTCompress")
    Events("onCompressProgress")

    // Every device that runs iOS 16.4 has a hardware HEVC encoder.
    Function("hevcSupported") { () -> Bool in true }

    AsyncFunction("listVideos") { (opts: ListVideosOptions, promise: Promise) in
      self.work.async { promise.resolve(self.listVideos(opts)) }
    }

    AsyncFunction("compressVideo") { (opts: CompressOptions, promise: Promise) in
      self.token.reset()
      self.work.async {
        do { promise.resolve(try self.compress(opts)) } catch { self.reject(promise, error) }
      }
    }

    Function("cancel") { self.token.cancel() }

    // iOS keeps the original filename as a resource property; nothing to rename.
    AsyncFunction("finalizeNames") { (_: [RenameItem]) in }
  }

  private func reject(_ promise: Promise, _ error: Error) {
    if token.isCancelled || (error as? EncodeError)?.description == "Cancelled" {
      promise.reject("E_CANCELLED", "Cancelled")
    } else {
      promise.reject("E_ENGINE", String(describing: error))
    }
  }

  private func listVideos(_ o: ListVideosOptions) -> [[String: Any]] {
    let assets = MediaLibrary.fetchAssets(albumIds: o.folderIds, photos: false, videos: true)
    var out: [[String: Any]] = []
    for (a, folder) in assets {
      let res = MediaLibrary.resource(a)
      let size = MediaLibrary.fileSize(res)
      if Double(size) < o.minSize { continue }
      var m = MediaLibrary.assetMap(a, folder: folder, res: res)
      if let av = MediaLibrary.avAsset(a, network: false), let track = av.tracks(withMediaType: .video).first {
        let t = track.preferredTransform
        let angle = Int((atan2(Double(t.b), Double(t.a)) * 180 / Double.pi).rounded())
        m["readable"] = true
        m["fps"] = Double(track.nominalFrameRate)
        m["videoBitrate"] = Double(track.estimatedDataRate)
        m["rotation"] = ((angle % 360) + 360) % 360
        m["codedWidth"] = Int(abs(track.naturalSize.width))
        m["codedHeight"] = Int(abs(track.naturalSize.height))
        m["probedDurationMs"] = av.duration.seconds * 1000
        m["cloudOnly"] = false
      } else {
        m["readable"] = true
        m["fps"] = 0.0
        m["videoBitrate"] = 0.0
        m["rotation"] = 0
        m["codedWidth"] = a.pixelWidth
        m["codedHeight"] = a.pixelHeight
        m["probedDurationMs"] = a.duration * 1000
        m["cloudOnly"] = true
      }
      out.append(m)
    }
    return out.sorted { ($0["size"] as! Double) > ($1["size"] as! Double) }
  }

  private func compress(_ o: CompressOptions) throws -> [String: Any] {
    guard let original = PHAsset.fetchAssets(withLocalIdentifiers: [o.id], options: nil).firstObject else {
      return ["status": "failed", "reason": "Video not found — refresh the list"]
    }
    guard let av = MediaLibrary.avAsset(original, network: false) else {
      return ["status": "skipped", "reason": "Only in iCloud — download it in Photos first"]
    }
    let res = MediaLibrary.resource(original)
    let origSize = MediaLibrary.fileSize(res)
    let baseName = ((res?.originalFilename ?? "video") as NSString).deletingPathExtension
    let out = FileManager.default.temporaryDirectory.appendingPathComponent("filetoolkit_out.mp4")

    let codec: String
    do {
      codec = try IOSVideoEncoder.encode(
        asset: av, to: out, scale: o.scale, fps: o.fps, dropFrames: o.dropFrames, bitrate: Int(o.bitrate), token: token
      ) { p in self.sendEvent("onCompressProgress", ["id": o.id, "progress": p]) }
    } catch let e as EncodeError where e.description == "Cancelled" {
      throw e
    } catch {
      return ["status": "failed", "reason": "Encoder error: \(error)"]
    }

    let newSize = ((try? FileManager.default.attributesOfItem(atPath: out.path)[.size]) as? NSNumber)?.int64Value ?? 0
    if newSize == 0 || origSize - newSize < minSaving {
      try? FileManager.default.removeItem(at: out)
      let saved = max(0, origSize - newSize)
      return ["status": "skipped", "reason": String(format: "Result only %.1f MB smaller (need ≥ 1 MB)", Double(saved) / 1_048_576)]
    }
    let outDur = AVURLAsset(url: out).duration.seconds
    let inDur = av.duration.seconds
    if outDur < inDur - max(1.5, inDur / 100) {
      try? FileManager.default.removeItem(at: out)
      return ["status": "failed", "reason": "Output incomplete (\(Int(outDur))s of \(Int(inDur))s)"]
    }

    // Save into the library with the original's date, location and albums.
    var newId: String?
    let finalName = "\(baseName).mp4"
    do {
      try PHPhotoLibrary.shared().performChangesAndWait {
        let req = PHAssetCreationRequest.forAsset()
        let ro = PHAssetResourceCreationOptions()
        ro.originalFilename = finalName
        ro.shouldMoveFile = true
        req.addResource(with: .video, fileURL: out, options: ro)
        req.creationDate = original.creationDate
        req.location = original.location
        req.isFavorite = original.isFavorite
        if let placeholder = req.placeholderForCreatedAsset {
          newId = placeholder.localIdentifier
          PHAssetCollection.fetchAssetCollectionsContaining(original, with: .album, options: nil).enumerateObjects { album, _, _ in
            PHAssetCollectionChangeRequest(for: album)?.addAssets([placeholder] as NSArray)
          }
        }
      }
    } catch {
      try? FileManager.default.removeItem(at: out)
      return ["status": "failed", "reason": "Couldn't save: \(error.localizedDescription)"]
    }

    return [
      "status": "compressed",
      "newId": newId ?? "",
      "newSize": Double(newSize),
      "review": NSNull(),
      "match": NSNull(),
      "codec": codec,
      "savedTo": NSNull(),
      "finalName": finalName,
    ]
  }
}
