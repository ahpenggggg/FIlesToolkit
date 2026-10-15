package expo.modules.filetoolkit.medialibrary

import android.net.Uri
import expo.modules.kotlin.Promise
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Media handed to JS, by id, so every module can find an item again: Duplicates and Compress
 * register what they list, Compress registers the files it creates, and Trash looks both up.
 */
object MediaRegistry {
    private val known = ConcurrentHashMap<String, MediaItem>()
    private val created = ConcurrentHashMap<String, Uri>()

    fun idOf(i: MediaItem) = (if (i.isVideo) "v:" else "i:") + i.id

    fun remember(i: MediaItem) {
        known[idOf(i)] = i
    }

    fun item(id: String): MediaItem? = known[id]

    fun rememberCreated(id: String, uri: Uri) {
        created[id] = uri
    }

    fun created(id: String): Uri? = created[id]

    fun uriOf(id: String): Uri? = known[id]?.uri ?: created[id]

    /** The JS shape of a media item (MediaAsset in index.ts). */
    fun asset(i: MediaItem): Map<String, Any?> = mapOf(
        "id" to idOf(i),
        "uri" to i.uri.toString(),
        "kind" to if (i.isVideo) "video" else "photo",
        "name" to i.name,
        "size" to i.size.toDouble(),
        "width" to i.width,
        "height" to i.height,
        "durationMs" to i.durationMs.toDouble(),
        "dateTaken" to (if (i.dateTaken > 0) i.dateTaken else i.dateModified * 1000).toDouble(),
        "folder" to MediaScanner.displayPath(i.dir),
    )
}

/** Runs [block] off the JS thread and resolves/rejects [promise]; cancelling the returned job rejects with E_CANCELLED. */
fun CoroutineScope.launchFor(promise: Promise, block: suspend CoroutineScope.() -> Any?): Job = launch {
    try {
        promise.resolve(block())
    } catch (e: CancellationException) {
        promise.reject("E_CANCELLED", "Cancelled", null)
    } catch (e: Throwable) {
        promise.reject("E_ENGINE", e.message ?: e.javaClass.simpleName, e)
    }
}
