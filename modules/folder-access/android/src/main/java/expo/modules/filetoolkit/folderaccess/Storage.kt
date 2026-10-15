package expo.modules.filetoolkit.folderaccess

import android.content.Context
import android.os.Environment
import android.os.storage.StorageManager
import kotlinx.coroutines.asCoroutineDispatcher
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.Executors

/** Direct file access for the rename tools, which need "All files access" (MANAGE_EXTERNAL_STORAGE). */
object Storage {
    /** One worker for every folder read and rename, so scans and renames never overlap. */
    val worker = Executors.newSingleThreadExecutor().asCoroutineDispatcher()

    fun hasAccess(): Boolean = Environment.isExternalStorageManager()

    fun requireAccess() {
        if (!hasAccess()) throw SecurityException("All files access is off. Allow it in Settings to use this tool.")
    }

    /** Internal storage first, then removable volumes such as SD cards. */
    fun roots(ctx: Context): List<Pair<File, String>> {
        val manager = ctx.getSystemService(StorageManager::class.java)
        return manager.storageVolumes.mapNotNull { volume ->
            val dir = volume.directory ?: return@mapNotNull null
            if (!dir.canRead()) return@mapNotNull null
            dir to (if (volume.isPrimary) "Internal storage" else volume.getDescription(ctx))
        }.sortedBy { if (it.first.path == Environment.getExternalStorageDirectory().path) 0 else 1 }
    }

    /**
     * Whether [dir] holds anything visible (or any visible folder): stops at the first match instead
     * of listing the whole folder, which keeps opening big folders quick.
     */
    fun hasVisible(dir: File, foldersOnly: Boolean): Boolean = runCatching {
        Files.newDirectoryStream(dir.toPath()).use { entries ->
            entries.any { p -> !p.fileName.toString().startsWith(".") && (!foldersOnly || Files.isDirectory(p)) }
        }
    }.getOrDefault(false)

    /** Natural order, ignoring case: IMG_2 before IMG_10 (the same order the File names tool uses). */
    val naturalOrder: Comparator<String> = Comparator { a, b ->
        var i = 0
        var j = 0
        while (i < a.length && j < b.length) {
            if (a[i].isDigit() && b[j].isDigit()) {
                val startA = i
                val startB = j
                while (i < a.length && a[i].isDigit()) i++
                while (j < b.length && b[j].isDigit()) j++
                val numA = a.substring(startA, i).trimStart('0').ifEmpty { "0" }
                val numB = b.substring(startB, j).trimStart('0').ifEmpty { "0" }
                if (numA.length != numB.length) return@Comparator numA.length - numB.length
                val compared = numA.compareTo(numB)
                if (compared != 0) return@Comparator compared
            } else {
                val compared = a[i].lowercaseChar().compareTo(b[j].lowercaseChar())
                if (compared != 0) return@Comparator compared
                i++
                j++
            }
        }
        (a.length - i) - (b.length - j)
    }

    /** Everything directly inside [dir]. */
    fun children(dir: File): List<File> {
        requireAccess()
        if (!dir.isDirectory) throw IOException("Folder listing was unavailable")
        return dir.listFiles()?.toList() ?: throw IOException("Folder listing was unavailable")
    }
}
