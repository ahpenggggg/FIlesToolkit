package expo.modules.filetoolkit.archiver

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

class CreateOptions : Record {
    /** Files and folders to put in the ZIP (absolute paths). */
    @Field val items: List<String> = emptyList()
    /** Folder to save the ZIP in. */
    @Field val folder: String = ""
    /** File name without ".zip". */
    @Field val name: String = ""
    /** store | fast | normal | max */
    @Field val level: String = "normal"
    /** Empty = no password; otherwise AES-256. */
    @Field val password: String = ""
    /** Bytes per part; 0 = one file. */
    @Field val splitSize: Double = 0.0
}

class ExtractOptions : Record {
    @Field val archive: String = ""
    /** Folder to extract into (or to make the new folder in). */
    @Field val destination: String = ""
    /** Non-empty: extract into a new folder of this name inside destination ("name (1)" if taken). */
    @Field val newFolder: String = ""
    @Field val password: String = ""
    /** keep (both) | replace | skip */
    @Field val conflict: String = "keep"
}

/** Archives: create ZIPs (password, split parts) and list or extract ZIP, RAR, 7Z and more. */
class ArchiverModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var work: Job? = null

    override fun definition() = ModuleDefinition {
        Name("FTArchiver")
        Events("onArchiveProgress")

        AsyncFunction("inspect") { path: String, password: String, promise: Promise ->
            launchFor(promise) {
                Storage.requireAccess()
                val info = Extractor.inspect(File(path), password)
                mapOf(
                    "format" to info.format,
                    "parts" to info.parts,
                    "encrypted" to info.encrypted,
                    "needsPassword" to info.needsPassword,
                    "fileCount" to info.items.count { !it.isDirectory },
                    "totalSize" to info.items.sumOf { it.size }.toDouble(),
                    // Enough to preview; big archives aren't sent over in full.
                    "items" to info.items.take(500).map { mapOf("name" to it.name, "size" to it.size.toDouble(), "isDirectory" to it.isDirectory) },
                )
            }
        }

        AsyncFunction("create") { o: CreateOptions, promise: Promise ->
            work = launchFor(promise) {
                Storage.requireAccess()
                val parts = ZipCreator.create(
                    items = o.items.map(::File),
                    dir = File(o.folder),
                    name = o.name,
                    level = o.level,
                    password = o.password,
                    splitSize = o.splitSize.toLong(),
                    progress = { total -> ProgressReporter("Adding files", total, ::progress) },
                    check = { ensureActive() },
                )
                val zip = parts.last()
                mapOf("path" to zip.path, "name" to zip.name, "parts" to parts.size, "size" to parts.sumOf { it.length() }.toDouble())
            }
        }

        AsyncFunction("extract") { o: ExtractOptions, promise: Promise ->
            work = launchFor(promise) {
                Storage.requireAccess()
                val base = File(o.destination)
                val dest = if (o.newFolder.isEmpty()) base else Archives.uniqueSibling(File(base, o.newFolder))
                val created = !dest.exists()
                val result = try {
                    Extractor.extract(
                        file = File(o.archive),
                        dest = dest,
                        password = o.password,
                        conflict = o.conflict,
                        progress = { total -> ProgressReporter("Extracting", total, ::progress) },
                        check = { ensureActive() },
                    )
                } catch (e: Throwable) {
                    // A folder made for this extraction goes again rather than staying half-filled.
                    if (created) dest.deleteRecursively()
                    throw e
                }
                mapOf("extracted" to result.extracted, "skipped" to result.skipped, "destination" to dest.path)
            }
        }

        Function("cancel") { work?.cancel() }

        OnDestroy { scope.cancel() }
    }

    private fun progress(stage: String, done: Long, total: Long) {
        sendEvent("onArchiveProgress", mapOf("stage" to stage, "done" to done.toDouble(), "total" to total.toDouble()))
    }

    private fun launchFor(promise: Promise, block: suspend CoroutineScope.() -> Any?): Job = scope.launch {
        try {
            promise.resolve(block())
        } catch (e: CancellationException) {
            promise.reject("E_CANCELLED", "Cancelled", null)
        } catch (e: PasswordException) {
            promise.reject("E_PASSWORD", e.message, e)
        } catch (e: Throwable) {
            promise.reject("E_ARCHIVE", e.message ?: e.javaClass.simpleName, e)
        }
    }
}
