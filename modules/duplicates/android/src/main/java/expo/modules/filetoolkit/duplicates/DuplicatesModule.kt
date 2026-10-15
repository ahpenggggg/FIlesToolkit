package expo.modules.filetoolkit.duplicates

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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

class ScanOptions : Record {
    @Field val folderIds: List<String> = emptyList()
    @Field val includeSubfolders: Boolean = true
    @Field val threshold: Double = 0.8
    @Field val photos: Boolean = true
    @Field val videos: Boolean = true
}

/** Duplicates: fingerprints photos and videos and groups the ones that look alike. */
class DuplicatesModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var work: Job? = null

    private val ctx: Context get() = appContext.reactContext ?: error("React context not available")

    override fun definition() = ModuleDefinition {
        Name("FTDuplicates")
        Events("onScanProgress")

        AsyncFunction("scanDuplicates") { opts: ScanOptions, promise: Promise ->
            work = scope.launchFor(promise) { scan(opts) }
        }

        Function("cancel") { work?.cancel() }

        OnDestroy { scope.cancel() }
    }

    private suspend fun scan(o: ScanOptions): List<Map<String, Any?>> {
        val filter = FolderFilter(o.folderIds.toSet(), o.includeSubfolders)
        val cache = HashCache(File(ctx.filesDir, "hashes_v2.tsv"))
        progress("Reading media library…", 0, 0)
        try {
            val items = withContext(Dispatchers.IO) {
                cache.load()
                MediaScanner.query(ctx, o.photos, o.videos, filter)
            }
            items.forEach(MediaRegistry::remember)
            val total = items.size
            val done = AtomicInteger(0)
            progress("Analyzing", 0, total)
            val gate = Semaphore(4)
            val entries = coroutineScope {
                items.map { item ->
                    async(Dispatchers.IO) {
                        gate.withPermit {
                            ensureActive()
                            val sig = cache.get(item) ?: Hasher.signature(ctx, item)?.also { cache.put(item, it) }
                            val d = done.incrementAndGet()
                            if (d % 20 == 0 || d == total) progress("Analyzing", d, total)
                            sig?.let { item to it }
                        }
                    }
                }.awaitAll().filterNotNull()
            }
            if (o.photos && o.videos && o.folderIds.isEmpty()) cache.prune(items.map(cache::key).toSet())

            progress("Comparing", 0, entries.size)
            val groups = DuplicateFinder.find(entries, o.threshold) { d, t -> progress("Comparing", d, t) }
            return groups.map { g ->
                mapOf(
                    "id" to g.id.toString(),
                    "members" to g.members.map { m -> MediaRegistry.asset(m.item) + ("similarity" to m.similarity) },
                )
            }
        } finally {
            withContext(NonCancellable + Dispatchers.IO) { runCatching { cache.save() } }
        }
    }

    private var lastProgress = 0L

    private fun progress(stage: String, done: Int, total: Int) {
        val now = System.currentTimeMillis()
        if (done != total && now - lastProgress < 150) return
        lastProgress = now
        sendEvent("onScanProgress", mapOf("stage" to stage, "done" to done, "total" to total))
    }
}
