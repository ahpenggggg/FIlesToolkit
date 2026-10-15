import ExpoModulesCore
import FileToolkitFolderAccess

private let photoExtensions: Set<String> = [
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "bmp", "tif", "tiff", "dng", "raw", "avif",
]
private let videoExtensions: Set<String> = [
  "mp4", "mov", "mkv", "avi", "wmv", "flv", "webm", "m4v", "3gp", "mpg", "mpeg", "ts", "mts", "m2ts", "vob",
]

/// Folder rename: counts the photos and videos inside each child folder of a picked folder.
public class FTFolderRenameModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FTFolderRename")
    Events("onScanProgress")

    AsyncFunction("scanChildFolders") { (treeUri: String, promise: Promise) in
      PickedFolder.worker.async {
        do {
          promise.resolve(try PickedFolder.withAccess(treeUri) { root in try self.scanTree(root) })
        } catch {
          promise.reject("E_FOLDER", String(describing: error))
        }
      }
    }
  }

  private func scanTree(_ root: URL) throws -> [String: Any] {
    var otherNames = Set<String>()
    var childFolders: [(url: URL, name: String)] = []
    for child in try PickedFolder.children(of: root) {
      if child.isDirectory { childFolders.append((child.url, child.name)) } else { otherNames.insert(child.name.lowercased()) }
    }
    var entries: [(uri: String, name: String, videos: Int, photos: Int)] = []
    for (index, child) in childFolders.enumerated() {
      var videos = 0
      var photos = 0
      var visited = Set<String>()
      try countMedia(child.url, &videos, &photos, &visited)
      entries.append((child.url.absoluteString, child.name, videos, photos))
      sendEvent("onScanProgress", ["stage": "Scanning folders", "done": index + 1, "total": childFolders.count])
    }
    entries.sort { $0.name.lowercased() < $1.name.lowercased() }
    return [
      "rootName": root.lastPathComponent,
      "otherNames": Array(otherNames),
      "entries": entries.map { ["uri": $0.uri, "name": $0.name, "videos": $0.videos, "photos": $0.photos] },
    ]
  }

  private func extensionOf(_ name: String) -> String {
    guard let dot = name.lastIndex(of: "."), name.index(after: dot) != name.endIndex else { return "" }
    return name[name.index(after: dot)...].lowercased()
  }

  /// Counts media in [directory] and everything below it.
  private func countMedia(_ directory: URL, _ videos: inout Int, _ photos: inout Int, _ visited: inout Set<String>) throws {
    if !visited.insert(directory.standardizedFileURL.path).inserted { return }
    for child in try PickedFolder.children(of: directory) {
      if child.isDirectory {
        try countMedia(child.url, &videos, &photos, &visited)
      } else {
        let ext = extensionOf(child.name)
        if videoExtensions.contains(ext) { videos += 1 } else if photoExtensions.contains(ext) { photos += 1 }
      }
    }
  }
}
