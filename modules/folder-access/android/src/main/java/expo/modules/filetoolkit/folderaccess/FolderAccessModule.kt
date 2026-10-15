package expo.modules.filetoolkit.folderaccess

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.util.UUID

class RenameRequest : Record {
    /** Absolute path of the item. */
    @Field val uri: String = ""
    @Field val name: String = ""
    @Field val target: String = ""
    /** Kept on the temporary name (a file's extension) so the item keeps its type while staged. */
    @Field val stageSuffix: String = ""
}

class RenameOptions : Record {
    /** The chosen folder (iOS opens its access scope; unused on Android). */
    @Field val treeUri: String = ""
    /** Echoed in progress events so each screen only follows its own work. */
    @Field val task: String = ""
    @Field val noun: String = "item"
    @Field val plural: String = "items"
    @Field val items: List<RenameRequest> = emptyList()
}

/** Shared folder access for the rename tools: permission, browsing, listing and safe renaming. */
class FolderAccessModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Storage.worker)

    private val ctx: Context get() = appContext.reactContext ?: error("React context not available")

    override fun definition() = ModuleDefinition {
        Name("FTFolderAccess")
        Events("onRenameProgress")

        Function("hasAllFilesAccess") { Storage.hasAccess() }

        /** Opens this app's "All files access" page in Settings; check again when the app comes back. */
        Function("requestAllFilesAccess") {
            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                ctx.startActivity(intent)
            } catch (e: Exception) {
                ctx.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }

        AsyncFunction("storageRoots") { promise: Promise ->
            run(promise) {
                Storage.requireAccess()
                Storage.roots(ctx).map { (dir, name) -> mapOf("path" to dir.path, "name" to name) }
            }
        }

        /** Visible subfolders of [path], sorted by name (naturally), each with whether it has subfolders of its own. */
        AsyncFunction("listDirectories") { path: String, promise: Promise ->
            run(promise) {
                Storage.children(File(path))
                    .filter { it.isDirectory && !it.name.startsWith(".") }
                    .sortedWith(compareBy(Storage.naturalOrder) { it.name })
                    .map { dir ->
                        mapOf(
                            "path" to dir.path,
                            "name" to dir.name,
                            "hasSubfolders" to Storage.hasVisible(dir, foldersOnly = true),
                        )
                    }
            }
        }

        /** Visible files and subfolders of [path]: folders first, then files, each by name. */
        AsyncFunction("listEntries") { path: String, promise: Promise ->
            run(promise) {
                Storage.children(File(path))
                    .filter { !it.name.startsWith(".") }
                    .sortedWith(compareBy<File> { !it.isDirectory }.thenBy(Storage.naturalOrder) { it.name })
                    .map { f ->
                        mapOf(
                            "path" to f.path,
                            "name" to f.name,
                            "isDirectory" to f.isDirectory,
                            "size" to (if (f.isDirectory) 0.0 else f.length().toDouble()),
                            "hasEntries" to (f.isDirectory && Storage.hasVisible(f, foldersOnly = false)),
                        )
                    }
            }
        }

        AsyncFunction("listFolder") { path: String, promise: Promise ->
            run(promise) {
                val root = File(path)
                mapOf(
                    "rootName" to root.name,
                    "children" to Storage.children(root).map { child ->
                        mapOf("uri" to child.path, "name" to child.name, "isDirectory" to child.isDirectory)
                    },
                )
            }
        }

        AsyncFunction("renameDocuments") { opts: RenameOptions, promise: Promise ->
            run(promise) {
                Storage.requireAccess()
                renameAll(opts)
            }
        }

        OnDestroy { scope.cancel() }
    }

    private fun run(promise: Promise, block: () -> Any?) {
        scope.launch {
            try {
                promise.resolve(block())
            } catch (e: Throwable) {
                promise.reject("E_FOLDER", e.message ?: e.javaClass.simpleName, e)
            }
        }
    }

    private class Item(var file: File, val original: String, val target: String, val stageSuffix: String)

    private fun move(file: File, name: String): File {
        val destination = File(file.parentFile, name)
        if (destination.exists() || !file.renameTo(destination)) throw IOException("Rename was rejected")
        return destination
    }

    /**
     * Renames in two passes: every item first moves to a unique temporary name, then to its target,
     * so items can swap names (a→b, b→a) without colliding. If staging fails, staged items are put back.
     * Returns the message shown to the user.
     */
    private fun renameAll(o: RenameOptions): String {
        val entries = o.items.map { Item(File(it.uri), it.name, it.target, it.stageSuffix) }
        val staged = ArrayList<Item>()
        try {
            for (entry in entries) {
                val temporaryName = "FT_TMP_" + UUID.randomUUID().toString().replace("-", "") + entry.stageSuffix
                entry.file = move(entry.file, temporaryName)
                staged += entry
                progress(o.task, "Preparing ${o.plural}", staged.size, entries.size)
            }
        } catch (error: Exception) {
            for (entry in staged) {
                runCatching { entry.file = move(entry.file, entry.original) }
            }
            return "Rename stopped before completion. Some ${o.plural} may need a rescan."
        }

        var renamed = 0
        var failed = 0
        var completed = 0
        progress(o.task, "Renaming ${o.plural}", 0, staged.size)
        for (entry in staged) {
            try {
                entry.file = move(entry.file, entry.target)
                renamed++
            } catch (error: Exception) {
                failed++
                runCatching { entry.file = move(entry.file, entry.original) }
            }
            progress(o.task, "Renaming ${o.plural}", ++completed, staged.size)
        }
        if (failed == 0) return "Renamed $renamed ${if (renamed == 1) o.noun else o.plural}."
        return "Renamed $renamed; $failed could not be renamed. Review the refreshed list."
    }

    private fun progress(task: String, stage: String, done: Int, total: Int) {
        sendEvent("onRenameProgress", mapOf("task" to task, "stage" to stage, "done" to done, "total" to total))
    }
}
