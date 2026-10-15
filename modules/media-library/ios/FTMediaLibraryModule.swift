import AVFoundation
import ExpoModulesCore
import Photos

/// Stops a long-running job; shared by Duplicates and Compress.
public final class CancelToken {
  private let lock = NSLock()
  private var flag = false
  public init() {}
  public var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return flag }
  public func cancel() { lock.lock(); flag = true; lock.unlock() }
  public func reset() { lock.lock(); flag = false; lock.unlock() }
}

/// Photo library helpers shared by the media tools.
public enum MediaLibrary {
  /// Assets of the given types, from the chosen albums (deduplicated) or the whole library.
  public static func fetchAssets(albumIds: [String], photos: Bool, videos: Bool) -> [(PHAsset, String)] {
    var types: [Int] = []
    if photos { types.append(PHAssetMediaType.image.rawValue) }
    if videos { types.append(PHAssetMediaType.video.rawValue) }
    let opts = PHFetchOptions()
    opts.predicate = NSPredicate(format: "mediaType IN %@", types)
    opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

    var out: [(PHAsset, String)] = []
    if albumIds.isEmpty {
      PHAsset.fetchAssets(with: opts).enumerateObjects { a, _, _ in out.append((a, "Library")) }
      return out
    }
    var seen = Set<String>()
    let albums = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: albumIds, options: nil)
    albums.enumerateObjects { c, _, _ in
      let title = c.localizedTitle ?? "Album"
      PHAsset.fetchAssets(in: c, options: opts).enumerateObjects { a, _, _ in
        if seen.insert(a.localIdentifier).inserted { out.append((a, title)) }
      }
    }
    return out
  }

  public static func resource(_ a: PHAsset) -> PHAssetResource? {
    let rs = PHAssetResource.assetResources(for: a)
    let primary: PHAssetResourceType = a.mediaType == .video ? .video : .photo
    return rs.first { $0.type == primary } ?? rs.first
  }

  public static func fileSize(_ r: PHAssetResource?) -> Int64 {
    (r?.value(forKey: "fileSize") as? NSNumber)?.int64Value ?? 0
  }

  /// The JS shape of a media item (MediaAsset in index.ts).
  public static func assetMap(_ a: PHAsset, folder: String, res: PHAssetResource?) -> [String: Any] {
    [
      "id": a.localIdentifier,
      "uri": "ph://\(a.localIdentifier)",
      "kind": a.mediaType == .video ? "video" : "photo",
      "name": res?.originalFilename ?? "Untitled",
      "size": Double(fileSize(res)),
      "width": a.pixelWidth,
      "height": a.pixelHeight,
      "durationMs": a.duration * 1000,
      "dateTaken": (a.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
      "folder": folder,
    ]
  }

  public static func avAsset(_ a: PHAsset, network: Bool) -> AVAsset? {
    let opts = PHVideoRequestOptions()
    opts.isNetworkAccessAllowed = network
    opts.deliveryMode = .highQualityFormat
    opts.version = .current
    var result: AVAsset?
    let sem = DispatchSemaphore(value: 0)
    PHImageManager.default().requestAVAsset(forVideo: a, options: opts) { av, _, _ in
      result = av
      sem.signal()
    }
    sem.wait()
    return result
  }

  static func listAlbums() -> [[String: Any]] {
    var out: [[String: Any]] = []
    let imageOpts = PHFetchOptions()
    imageOpts.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
    let videoOpts = PHFetchOptions()
    videoOpts.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.video.rawValue)

    func add(_ c: PHAssetCollection) {
      let p = PHAsset.fetchAssets(in: c, options: imageOpts).count
      let v = PHAsset.fetchAssets(in: c, options: videoOpts).count
      if p + v == 0 { return }
      let title = c.localizedTitle ?? "Album"
      out.append([
        "id": c.localIdentifier, "name": title, "path": title, "depth": 0,
        "photos": p, "videos": v, "totalPhotos": p, "totalVideos": v,
      ])
    }
    let smart: [PHAssetCollectionSubtype] = [
      .smartAlbumVideos, .smartAlbumScreenshots, .smartAlbumSelfPortraits, .smartAlbumScreenRecordings, .smartAlbumBursts,
    ]
    for sub in smart {
      PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: sub, options: nil).enumerateObjects { c, _, _ in add(c) }
    }
    PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil).enumerateObjects { c, _, _ in add(c) }
    return out.sorted { (($0["totalPhotos"] as! Int) + ($0["totalVideos"] as! Int)) > (($1["totalPhotos"] as! Int) + ($1["totalVideos"] as! Int)) }
  }
}

/// Shared photo library access: albums, permission and Recently Deleted.
public class FTMediaLibraryModule: Module {
  private let work = DispatchQueue(label: "filetoolkit.media", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("FTMediaLibrary")

    AsyncFunction("requestPermission") { (promise: Promise) in
      PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
        switch status {
        case .authorized: promise.resolve("granted")
        case .limited: promise.resolve("limited")
        default: promise.resolve("denied")
        }
      }
    }

    AsyncFunction("listFolders") { (promise: Promise) in
      self.work.async { promise.resolve(MediaLibrary.listAlbums()) }
    }

    AsyncFunction("trash") { (ids: [String], promise: Promise) in
      let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
      if assets.count == 0 { promise.resolve(false); return }
      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.deleteAssets(assets)
      }) { ok, _ in promise.resolve(ok) }
    }
  }
}
