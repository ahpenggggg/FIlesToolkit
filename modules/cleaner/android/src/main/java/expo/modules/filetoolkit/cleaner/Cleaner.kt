package expo.modules.filetoolkit.cleaner

import android.content.Context
import expo.modules.filetoolkit.folderaccess.Storage
import java.io.File

class Found(val file: File, val kind: Kind, val size: Long, val files: Int)

class CleanOutcome(val cleaned: List<String>, val failed: Int, val freed: Long)

/** Finds what can be cleaned on every storage volume, and removes what was chosen after checking it again. */
class Cleaner(private val ctx: Context, private val check: () -> Unit) {

    private val now = System.currentTimeMillis()

    /** [onFolder] gets the number of folders read so far. */
    fun scan(kinds: Set<Kind>, onFolder: (Int) -> Unit): List<Found> {
        val found = ArrayList<Found>()
        var folders = 0

        /** Returns whether [dir] holds any file at any depth. */
        fun walk(dir: File, rel: String, inHidden: Boolean): Boolean {
            check()
            onFolder(++folders)
            // Unreadable: treated as holding files, so it's never taken for empty.
            val entries = dir.listFiles() ?: return true
            val mark = found.size
            var hasFiles = false
            for (f in entries) {
                if (Rules.isLink(f)) {
                    hasFiles = true
                    continue
                }
                val childRel = if (rel.isEmpty()) f.name else "$rel/${f.name}"
                if (f.isDirectory) {
                    if (Rules.isAppArea(childRel)) {
                        hasFiles = true
                        continue
                    }
                    if (walk(f, childRel, inHidden || f.name.startsWith("."))) hasFiles = true
                } else {
                    hasFiles = true
                    val kind = Rules.fileKind(f, inHidden, now)
                    if (kind != null && kind in kinds) found += Found(f, kind, f.length(), 1)
                }
            }
            if (!hasFiles && Kind.EMPTY_FOLDER in kinds && Rules.mayRemoveEmptyFolder(dir, rel, inHidden, now)) {
                // Only the topmost empty folder is listed: removing it removes the empty ones inside.
                while (found.size > mark) found.removeAt(found.size - 1)
                found += Found(dir, Kind.EMPTY_FOLDER, 0, 0)
            }
            return hasFiles
        }

        for ((root, _) in Storage.roots(ctx)) {
            walk(root, "", inHidden = false)
            // Android/data and Android/obb can't be read by any app since Android 11; Android/media can.
            if (Kind.ORPHAN_APP in kinds) {
                for (dir in File(root, "Android/media").listFiles().orEmpty()) {
                    check()
                    if (!dir.isDirectory || Rules.isLink(dir) || !Rules.isOrphanApp(ctx, "Android/media/${dir.name}")) continue
                    val (size, files) = measure(dir)
                    found += Found(dir, Kind.ORPHAN_APP, size, files)
                }
            }
        }
        return found
    }

    /** Total bytes and number of files inside [dir]. */
    private fun measure(dir: File): Pair<Long, Int> {
        var size = 0L
        var files = 0
        fun visit(d: File) {
            check()
            for (f in d.listFiles().orEmpty()) {
                if (Rules.isLink(f)) continue
                if (f.isDirectory) visit(f)
                else {
                    size += f.length()
                    files++
                }
            }
        }
        visit(dir)
        return size to files
    }

    /** Every file inside [dir] with its path below it, biggest first: what a folder holds, for checking it. */
    fun contents(dir: File, limit: Int): Pair<Int, List<Pair<String, Long>>> {
        val all = ArrayList<Pair<String, Long>>()
        fun visit(d: File, prefix: String) {
            check()
            for (f in d.listFiles().orEmpty()) {
                if (Rules.isLink(f)) continue
                if (f.isDirectory) visit(f, "$prefix${f.name}/") else all += "$prefix${f.name}" to f.length()
            }
        }
        visit(dir, "")
        return all.size to all.sortedByDescending { it.second }.take(limit)
    }

    /**
     * Removes each item that still qualifies as [Kind] says. Items that changed since the scan, or sit
     * outside every storage volume, are left alone and counted as failed.
     */
    fun clean(items: List<Pair<File, Kind>>, onItem: (Int) -> Unit): CleanOutcome {
        val roots = Storage.roots(ctx).map { it.first.path }
        val cleaned = ArrayList<String>()
        var failed = 0
        var freed = 0L
        items.forEachIndexed { i, (file, kind) ->
            check()
            val root = roots.firstOrNull { file.path.startsWith("$it/") }
            if (root != null && !Rules.isLink(file) && stillQualifies(file, file.path.substring(root.length + 1), kind)) {
                freed += remove(file)
                if (file.exists()) failed++ else cleaned += file.path
            } else {
                failed++
            }
            onItem(i + 1)
        }
        return CleanOutcome(cleaned, failed, freed)
    }

    private fun stillQualifies(file: File, rel: String, kind: Kind): Boolean {
        val inHidden = Rules.inHiddenFolder(rel)
        return when (kind) {
            Kind.ORPHAN_APP -> file.isDirectory && Rules.isOrphanApp(ctx, rel)
            Kind.EMPTY_FOLDER -> file.isDirectory && Rules.mayRemoveEmptyFolder(file, rel, inHidden, now) && Rules.hasNoFiles(file)
            else -> file.isFile && !Rules.isAppArea(rel) && Rules.fileKind(file, inHidden, now) == kind
        }
    }

    /** Deletes [file] (a folder with everything inside); returns the bytes freed. */
    private fun remove(file: File): Long {
        var freed = 0L
        if (file.isDirectory && !Rules.isLink(file)) {
            for (f in file.listFiles().orEmpty()) {
                check()
                freed += remove(f)
            }
        }
        val size = if (file.isFile) file.length() else 0L
        if (file.delete()) freed += size
        return freed
    }
}
