import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

struct RenameRequest: Record {
  @Field var uri: String = ""
  @Field var name: String = ""
  @Field var target: String = ""
  /// Kept on the temporary name (a file's extension) so the item keeps its type while staged.
  @Field var stageSuffix: String = ""
}

struct RenameOptions: Record {
  /// The picked folder the items live in; its access scope is opened for the rename.
  @Field var treeUri: String = ""
  /// Echoed in progress events so each screen only follows its own work.
  @Field var task: String = ""
  @Field var noun: String = "item"
  @Field var plural: String = "items"
  @Field var items: [RenameRequest] = []
}

public struct FolderAccessError: Error, CustomStringConvertible {
  public let description: String
  public init(_ description: String) { self.description = description }
}

/// A folder picked in the Files app, kept as a bookmark ("bookmark:<base64>") so access survives relaunches.
public enum PickedFolder {
  /// One queue for every folder read and rename, so scans and renames never overlap.
  public static let worker = DispatchQueue(label: "filetoolkit.folders", qos: .userInitiated)

  /// Resolves [treeUri] and runs [body] while the folder's security scope is open.
  public static func withAccess<T>(_ treeUri: String, _ body: (URL) throws -> T) throws -> T {
    guard treeUri.hasPrefix("bookmark:"), let data = Data(base64Encoded: String(treeUri.dropFirst("bookmark:".count))) else {
      throw FolderAccessError("Folder access needs attention")
    }
    var stale = false
    let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    let open = url.startAccessingSecurityScopedResource()
    defer { if open { url.stopAccessingSecurityScopedResource() } }
    return try body(url)
  }

  /// Everything directly inside [directory].
  public static func children(of directory: URL) throws -> [(url: URL, name: String, isDirectory: Bool)] {
    try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey], options: [])
      .map { url in
        let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
        return (url, url.lastPathComponent, isDirectory == true)
      }
  }
}

private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
  let done: (URL?) -> Void
  init(done: @escaping (URL?) -> Void) { self.done = done }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    done(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    done(nil)
  }
}

/// Shared folder access: pick a folder (access kept across launches), list it, and rename its items safely.
public class FTFolderAccessModule: Module {
  private var picker: PickerDelegate?

  public func definition() -> ModuleDefinition {
    Name("FTFolderAccess")
    Events("onRenameProgress")

    AsyncFunction("pickFolder") { (promise: Promise) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("E_NO_ACTIVITY", "No screen to show the folder picker")
        return
      }
      let controller = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
      controller.allowsMultipleSelection = false
      let delegate = PickerDelegate { [weak self] url in
        self?.picker = nil
        guard let url else { promise.resolve(nil); return }
        let open = url.startAccessingSecurityScopedResource()
        defer { if open { url.stopAccessingSecurityScopedResource() } }
        do {
          let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
          promise.resolve(["uri": "bookmark:" + bookmark.base64EncodedString(), "persisted": true])
        } catch {
          promise.reject("E_PICKER", "Folder access could not be saved. Choose it again to continue.")
        }
      }
      self.picker = delegate
      controller.delegate = delegate
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)

    AsyncFunction("listFolder") { (treeUri: String, promise: Promise) in
      PickedFolder.worker.async {
        do {
          let result: [String: Any] = try PickedFolder.withAccess(treeUri) { root in
            [
              "rootName": root.lastPathComponent,
              "children": try PickedFolder.children(of: root).map { child in
                ["uri": child.url.absoluteString, "name": child.name, "isDirectory": child.isDirectory]
              },
            ]
          }
          promise.resolve(result)
        } catch {
          promise.reject("E_FOLDER", String(describing: error))
        }
      }
    }

    AsyncFunction("renameDocuments") { (opts: RenameOptions, promise: Promise) in
      PickedFolder.worker.async {
        do {
          promise.resolve(try PickedFolder.withAccess(opts.treeUri) { _ in self.renameAll(opts) })
        } catch {
          promise.reject("E_FOLDER", String(describing: error))
        }
      }
    }
  }

  private final class Item {
    var url: URL
    let original: String
    let target: String
    let stageSuffix: String
    init(url: URL, original: String, target: String, stageSuffix: String) {
      self.url = url
      self.original = original
      self.target = target
      self.stageSuffix = stageSuffix
    }
  }

  private func move(_ url: URL, to name: String) throws -> URL {
    let destination = url.deletingLastPathComponent().appendingPathComponent(name)
    try FileManager.default.moveItem(at: url, to: destination)
    return destination
  }

  /// Renames in two passes: every item first moves to a unique temporary name, then to its target,
  /// so items can swap names without colliding. If staging fails, staged items are put back.
  private func renameAll(_ o: RenameOptions) -> String {
    let entries = o.items.compactMap { r in
      URL(string: r.uri).map { Item(url: $0, original: r.name, target: r.target, stageSuffix: r.stageSuffix) }
    }
    var staged: [Item] = []
    do {
      if entries.count != o.items.count { throw FolderAccessError("An item could not be staged for renaming") }
      for entry in entries {
        let temporaryName = "FT_TMP_" + UUID().uuidString.replacingOccurrences(of: "-", with: "") + entry.stageSuffix
        entry.url = try move(entry.url, to: temporaryName)
        staged.append(entry)
        progress(o.task, "Preparing \(o.plural)", staged.count, entries.count)
      }
    } catch {
      for entry in staged {
        if let restored = try? move(entry.url, to: entry.original) { entry.url = restored }
      }
      return "Rename stopped before completion. Some \(o.plural) may need a rescan."
    }

    var renamed = 0
    var failed = 0
    var completed = 0
    progress(o.task, "Renaming \(o.plural)", 0, staged.count)
    for entry in staged {
      do {
        entry.url = try move(entry.url, to: entry.target)
        renamed += 1
      } catch {
        failed += 1
        if let restored = try? move(entry.url, to: entry.original) { entry.url = restored }
      }
      completed += 1
      progress(o.task, "Renaming \(o.plural)", completed, staged.count)
    }
    if failed == 0 { return "Renamed \(renamed) \(renamed == 1 ? o.noun : o.plural)." }
    return "Renamed \(renamed); \(failed) could not be renamed. Review the refreshed list."
  }

  private func progress(_ task: String, _ stage: String, _ done: Int, _ total: Int) {
    sendEvent("onRenameProgress", ["task": task, "stage": stage, "done": done, "total": total])
  }
}
