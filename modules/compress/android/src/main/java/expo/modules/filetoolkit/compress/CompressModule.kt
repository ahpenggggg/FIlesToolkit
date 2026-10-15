package expo.modules.filetoolkit.compress

import android.content.ContentUris
import android.content.Context
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
    @Field val scale: Double = 1.0
    @Field val fps: Double = 0.0
    @Field val dropFrames: Boolean = false
    @Field val bitrate: Double = 2_000_000.0
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

        Function("hevcSupported") { VideoEncoder.hevcAvailable }

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
                        val info = VideoEncoder.probe(ctx, item)
                        MediaRegistry.asset(item) + mapOf(
                            "readable" to (info != null),
                            "fps" to (info?.fps ?: 0.0),
                            "videoBitrate" to (info?.videoBitrate ?: 0L).toDouble(),
                            "rotation" to (info?.rotation ?: 0),
                            "codedWidth" to (info?.width ?: item.width),
                            "codedHeight" to (info?.height ?: item.height),
                            "probedDurationMs" to (info?.durationMs ?: item.durationMs).toDouble(),
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
        val params = EncodeParams(o.scale.toFloat(), o.fps, o.dropFrames, o.bitrate.toLong())
        val outcome = VideoEncoder.encode(ctx, item, workDir, params) { p ->
            sendEvent("onCompressProgress", mapOf("id" to o.id, "progress" to p.toDouble()))
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
                    "codec" to if (VideoEncoder.hevcAvailable) "HEVC" else "H.264",
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
}
