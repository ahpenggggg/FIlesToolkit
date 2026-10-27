package expo.modules.filetoolkit.compress

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.util.Size
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.filetoolkit.medialibrary.FolderFilter
import expo.modules.filetoolkit.medialibrary.MediaRegistry
import expo.modules.filetoolkit.medialibrary.MediaScanner
import expo.modules.filetoolkit.medialibrary.launchFor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File

class ListVideosOptions : Record {
    @Field val folderIds: List<String> = emptyList()
    @Field val includeSubfolders: Boolean = true
    @Field val minSize: Double = 5.0 * 1048576
}

class CompressOptions : Record {
    @Field val id: String = ""
    /** Shown in the notification, e.g. "2 of 5". */
    @Field val label: String = ""
}

class RenameItem : Record {
    @Field val id: String = ""
    @Field val name: String = ""
}

/** Compress video: lists large videos, re-encodes them and saves the result next to the library. */
class CompressModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var work: Job? = null

    private val ctx: Context get() = appContext.reactContext ?: error("React context not available")

    override fun definition() = ModuleDefinition {
        Name("FTCompress")
        Events("onCompressProgress")

        /** Starts the foreground service for a batch, so it keeps going in the background. */
        Function("beginSession") { text: String -> CompressService.start(ctx, text) }

        Function("endSession") { CompressService.stop(ctx) }

        /** A small cached JPEG of the video's system thumbnail (cheap to scroll through). */
        AsyncFunction("thumbnail") { id: String, size: Int, promise: Promise ->
            scope.launchFor(promise) { thumbnail(id, size) }
        }

        AsyncFunction("listVideos") { opts: ListVideosOptions, promise: Promise ->
            scope.launchFor(promise) { listVideos(opts) }
        }

        AsyncFunction("compressVideo") { opts: CompressOptions, promise: Promise ->
            work = scope.launchFor(promise) { compress(opts) }
        }

        Function("cancel") { work?.cancel() }

        AsyncFunction("finalizeNames") { items: List<RenameItem>, promise: Promise ->
            scope.launchFor(promise) {
                withContext(Dispatchers.IO) {
                    for (it in items) MediaRegistry.created(it.id)?.let { uri -> MediaWriter.rename(ctx, uri, it.name) }
                }
                null
            }
        }

        OnDestroy { scope.cancel() }
    }

    private suspend fun listVideos(o: ListVideosOptions): List<Map<String, Any?>> {
        val items = withContext(Dispatchers.IO) {
            MediaScanner.query(ctx, photos = false, videos = true, filter = FolderFilter(o.folderIds.toSet(), o.includeSubfolders))
        }.filter { it.size >= o.minSize }.sortedByDescending { it.size }
        items.forEach(MediaRegistry::remember)
        val gate = Semaphore(4)
        return coroutineScope {
            items.map { item ->
                async(Dispatchers.IO) {
                    gate.withPermit {
                        val info = Transcoder.probe(ctx, item)
                        MediaRegistry.asset(item) + mapOf(
                            "readable" to (info != null),
                            "fps" to (info?.fps ?: 0.0),
                            "videoBitrate" to (info?.videoBitrate ?: 0L).toDouble(),
                            "rotation" to (info?.rotation ?: 0),
                            "codedWidth" to (info?.width ?: item.width),
                            "codedHeight" to (info?.height ?: item.height),
                            "probedDurationMs" to (info?.durationMs ?: item.durationMs).toDouble(),
                            "videoCodec" to info?.mime,
                            "hdr" to (info?.hdr ?: false),
                            "cloudOnly" to false,
                        )
                    }
                }
            }.awaitAll()
        }
    }

    private suspend fun compress(o: CompressOptions): Map<String, Any?> {
        val item = MediaRegistry.item(o.id) ?: return mapOf("status" to "failed", "reason" to "Video not found — refresh the list")
        val workDir = File(ctx.cacheDir, "compress").apply { mkdirs() }
        var shown = -1
        CompressService.update(ctx, notificationText(o, item.name), -1)
        val outcome = Transcoder.encode(ctx, item, workDir) { p ->
            val percent = (p * 100).toInt()
            if (percent != shown) {
                shown = percent
                sendEvent("onCompressProgress", mapOf("id" to o.id, "progress" to p.toDouble()))
                CompressService.update(ctx, notificationText(o, item.name), percent)
            }
        }
        return when (outcome) {
            is EncodeOutcome.Skipped -> mapOf("status" to "skipped", "reason" to outcome.reason)
            is EncodeOutcome.Failed -> mapOf("status" to "failed", "reason" to outcome.reason)
            is EncodeOutcome.Done -> try {
                val newSize = outcome.file.length()
                val uri = withContext(Dispatchers.IO) {
                    MediaWriter.insertCompressed(
                        ctx, item, outcome.file, "video/mp4", "mp4",
                        nameSuffix = if (outcome.review != null) "_compressed" else "",
                    )
                }
                val newId = "v:" + ContentUris.parseId(uri)
                MediaRegistry.rememberCreated(newId, uri)
                mapOf(
                    "status" to "compressed",
                    "newId" to newId,
                    "newSize" to newSize.toDouble(),
                    "review" to outcome.review,
                    "match" to outcome.match,
                    "codec" to HandBrake.LABEL,
                    "width" to outcome.width,
                    "height" to outcome.height,
                    "savedTo" to MediaWriter.COMPRESSED_FOLDER,
                    "finalName" to MediaWriter.finalName(item, "mp4"),
                )
            } catch (e: Exception) {
                mapOf("status" to "failed", "reason" to "Couldn't save: ${e.message}")
            } finally {
                outcome.file.delete()
            }
        }
    }

    private fun notificationText(o: CompressOptions, name: String) = if (o.label.isEmpty()) name else "${o.label} · $name"

    private val thumbGate = Semaphore(2)

    private suspend fun thumbnail(id: String, size: Int): String? = thumbGate.withPermit {
        withContext(Dispatchers.IO) {
            val item = MediaRegistry.item(id) ?: return@withContext null
            val dir = File(ctx.cacheDir, "thumbs").apply { mkdirs() }
            val file = File(dir, "${id.replace(':', '_')}_${item.dateModified}_$size.jpg")
            if (!file.exists()) {
                val bmp = runCatching { ctx.contentResolver.loadThumbnail(item.uri, Size(size, size), null) }.getOrNull()
                    ?: return@withContext null
                file.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
                bmp.recycle()
            }
            Uri.fromFile(file).toString()
        }
    }
}
