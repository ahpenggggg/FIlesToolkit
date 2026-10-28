package expo.modules.filetoolkit.cleaner

import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import expo.modules.filetoolkit.folderaccess.Storage
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import java.io.File

class CleanRequest : Record {
    /** Absolute path, as the scan returned it. */
    @Field val path: String = ""
    /** Why it can go (Kind.key); checked again before deleting. */
    @Field val kind: String = ""
}

/** For opening a file in another app so it can be checked before cleaning. */
class CleanerFileProvider : FileProvider()

/** System cleaner: finds leftover and stuck files on shared storage and deletes the ones chosen. */
class CleanerModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var work: Job? = null

    private val ctx: Context get() = appContext.reactContext ?: error("React context not available")

    override fun definition() = ModuleDefinition {
        Name("FTCleaner")
        Events("onCleanerProgress")

        AsyncFunction("scan") { kinds: List<String>, promise: Promise ->
            work = launchFor(promise) {
                Storage.requireAccess()
                var lastSent = 0L
                Cleaner(ctx) { ensureActive() }
                    .scan(kinds.map(Kind::of).toSet()) { folders ->
                        val now = System.currentTimeMillis()
                        if (now - lastSent >= 200) {
                            lastSent = now
                            progress("Scanning · $folders folders", 0, 0)
                        }
                    }
                    .map { found ->
                        mapOf(
                            "path" to found.file.path,
                            "name" to found.file.name,
                            "kind" to found.kind.key,
                            "isDirectory" to found.file.isDirectory,
                            "size" to found.size.toDouble(),
                            "files" to found.files,
                            "modified" to found.file.lastModified().toDouble(),
                        )
                    }
            }
        }

        /** The biggest files inside a folder (up to 300), and how many there are in all. */
        AsyncFunction("contents") { path: String, promise: Promise ->
            launchFor(promise) {
                Storage.requireAccess()
                val (total, items) = Cleaner(ctx) { ensureActive() }.contents(File(path), limit = 300)
                mapOf("total" to total, "items" to items.map { (name, size) -> mapOf("name" to name, "size" to size.toDouble()) })
            }
        }

        /** Opens a file in another app (with a chooser) so its contents can be checked. */
        AsyncFunction("open") { path: String ->
            val file = File(path)
            if (!file.isFile) throw IllegalStateException("This file is no longer there.")
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.cleaner.files", file)
            val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"
            val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            ctx.startActivity(Intent.createChooser(view, "Open with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }

        AsyncFunction("clean") { items: List<CleanRequest>, promise: Promise ->
            work = launchFor(promise) {
                Storage.requireAccess()
                progress("Cleaning", 0, items.size.toLong())
                val outcome = Cleaner(ctx) { ensureActive() }.clean(items.map { File(it.path) to Kind.of(it.kind) }) { done ->
                    progress("Cleaning", done.toLong(), items.size.toLong())
                }
                // Let the media library forget what was removed.
                if (outcome.cleaned.isNotEmpty()) MediaScannerConnection.scanFile(ctx, outcome.cleaned.toTypedArray(), null, null)
                mapOf("cleaned" to outcome.cleaned, "failed" to outcome.failed, "freed" to outcome.freed.toDouble())
            }
        }

        /** Stops scan or clean (its promise rejects with E_CANCELLED); what was already deleted stays deleted. */
        Function("cancel") { work?.cancel() }

        OnDestroy { scope.cancel() }
    }

    private fun progress(stage: String, done: Long, total: Long) {
        sendEvent("onCleanerProgress", mapOf("stage" to stage, "done" to done.toDouble(), "total" to total.toDouble()))
    }

    private fun launchFor(promise: Promise, block: suspend CoroutineScope.() -> Any?): Job = scope.launch {
        try {
            promise.resolve(block())
        } catch (e: CancellationException) {
            promise.reject("E_CANCELLED", "Cancelled", null)
        } catch (e: Throwable) {
            promise.reject("E_CLEANER", e.message ?: e.javaClass.simpleName, e)
        }
    }
}
