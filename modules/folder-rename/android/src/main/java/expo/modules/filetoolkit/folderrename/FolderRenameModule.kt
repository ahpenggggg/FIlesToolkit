package expo.modules.filetoolkit.folderrename

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.filetoolkit.folderaccess.Storage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.util.Locale

/** Folder rename: counts the photos and videos inside each child folder of a chosen folder. */
class FolderRenameModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Storage.worker)

    override fun definition() = ModuleDefinition {
        Name("FTFolderRename")
        Events("onScanProgress")

        AsyncFunction("scanChildFolders") { path: String, promise: Promise ->
            scope.launch {
                try {
                    promise.resolve(scanTree(File(path)))
                } catch (e: Throwable) {
                    promise.reject("E_FOLDER", e.message ?: e.javaClass.simpleName, e)
                }
            }
        }

        OnDestroy { scope.cancel() }
    }

    private fun scanTree(root: File): Map<String, Any?> {
        val otherNames = HashSet<String>()
        val childFolders = ArrayList<File>()
        for (child in Storage.children(root)) {
            if (!child.isDirectory) otherNames += child.name.lowercase(Locale.ROOT)
            else childFolders += child
        }
        val entries = ArrayList<Entry>()
        childFolders.forEachIndexed { index, child ->
            val entry = Entry(child.path, child.name)
            countMedia(child, entry, HashSet())
            entries += entry
            sendEvent("onScanProgress", mapOf("stage" to "Scanning folders", "done" to index + 1, "total" to childFolders.size))
        }
        entries.sortBy { it.name.lowercase(Locale.ROOT) }
        return mapOf(
            "rootName" to root.name,
            "otherNames" to otherNames.toList(),
            "entries" to entries.map { mapOf("uri" to it.path, "name" to it.name, "videos" to it.videos, "photos" to it.photos) },
        )
    }

    /** Counts media in [directory] and everything below it; the visited set guards against link loops. */
    private fun countMedia(directory: File, entry: Entry, visited: MutableSet<String>) {
        if (!visited.add(directory.canonicalPath)) return
        for (child in Storage.children(directory)) {
            if (child.isDirectory) {
                countMedia(child, entry, visited)
            } else {
                val extension = extensionOf(child.name)
                if (extension in VIDEO_EXTENSIONS) entry.videos++
                else if (extension in PHOTO_EXTENSIONS) entry.photos++
            }
        }
    }

    private fun extensionOf(name: String): String {
        val dot = name.lastIndexOf('.')
        return if (dot < 0 || dot == name.length - 1) "" else name.substring(dot + 1).lowercase(Locale.ROOT)
    }

    private class Entry(val path: String, val name: String) {
        var videos = 0
        var photos = 0
    }

    companion object {
        private val PHOTO_EXTENSIONS = setOf(
            "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "bmp", "tif", "tiff", "dng", "raw", "avif",
        )
        private val VIDEO_EXTENSIONS = setOf(
            "mp4", "mov", "mkv", "avi", "wmv", "flv", "webm", "m4v", "3gp", "mpg", "mpeg", "ts", "mts", "m2ts", "vob",
        )
    }
}
