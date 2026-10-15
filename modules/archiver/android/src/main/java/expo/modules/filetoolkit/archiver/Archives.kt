package expo.modules.filetoolkit.archiver

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale

/** A wrong or missing password; reported to JS as E_PASSWORD. */
class PasswordException(message: String) : Exception(message)

/** Reports bytes done out of a total, at most every 120 ms (and always at the end). */
class ProgressReporter(private val stage: String, private val total: Long, private val send: (String, Long, Long) -> Unit) {
    private var done = 0L
    private var last = 0L

    fun add(n: Long) {
        done += n
        val now = System.currentTimeMillis()
        if (done >= total || now - last >= 120) {
            last = now
            send(stage, done, total)
        }
    }

    fun start() = send(stage, 0, total)
}

/** Copies [input] to [output], reporting each chunk and calling [check] between chunks (to cancel). */
fun copy(input: InputStream, output: OutputStream, progress: ProgressReporter, check: () -> Unit) {
    val buffer = ByteArray(64 * 1024)
    while (true) {
        check()
        val n = input.read(buffer)
        if (n < 0) break
        output.write(buffer, 0, n)
        progress.add(n.toLong())
    }
}

object Archives {
    fun isZip(file: File): Boolean = file.name.lowercase(Locale.ROOT).endsWith(".zip")

    /** Every volume of a multi-part RAR, first one first: name.part1.rar, name.part2.rar … or name.rar, name.r00 …; else just [file]. */
    fun volumesOf(file: File): List<File> {
        if (isNumberedVolume(file)) return numberedParts(file)
        val dir = file.parentFile ?: return listOf(file)
        val partMatch = Regex("^(.*\\.part)(\\d+)\\.rar$", RegexOption.IGNORE_CASE).find(file.name)
        if (partMatch != null) {
            val prefix = partMatch.groupValues[1]
            val width = partMatch.groupValues[2].length
            val parts = ArrayList<File>()
            var n = 1
            while (true) {
                val part = File(dir, prefix + n.toString().padStart(width, '0') + ".rar")
                if (!part.exists()) break
                parts += part
                n++
            }
            return parts.ifEmpty { listOf(file) }
        }
        if (file.name.lowercase(Locale.ROOT).endsWith(".rar")) {
            val base = file.name.dropLast(4)
            val old = generateSequence(0) { it + 1 }
                .map { File(dir, base + ".r" + it.toString().padStart(2, '0')) }
                .takeWhile { it.exists() }
                .toList()
            return listOf(file) + old
        }
        return listOf(file)
    }

    private val NUMBERED = Regex("^(.*)\\.(0*1)$")

    /** A first byte-split volume: name.zip.001, name.rar.001, name.7z.001 … */
    fun isNumberedVolume(file: File): Boolean = NUMBERED.matches(file.name)

    /** name.zip.001, name.zip.002 … while they exist (the same digit count throughout). */
    fun numberedParts(first: File): List<File> {
        val match = NUMBERED.find(first.name) ?: return listOf(first)
        val dir = first.parentFile ?: return listOf(first)
        val prefix = match.groupValues[1]
        val width = match.groupValues[2].length
        return generateSequence(1) { it + 1 }
            .map { File(dir, "$prefix." + it.toString().padStart(width, '0')) }
            .takeWhile { it.exists() }
            .toList()
    }

    /** All parts of a split ZIP: name.z01, name.z02 … then name.zip. */
    fun zipPartsOf(zip: File): List<File> {
        val dir = zip.parentFile ?: return listOf(zip)
        val base = zip.name.dropLast(4)
        val parts = generateSequence(1) { it + 1 }
            .map { File(dir, base + ".z" + it.toString().padStart(2, '0')) }
            .takeWhile { it.exists() }
            .toList()
        return parts + zip
    }

    /** [dest]/[name] inside [dest] only, so an archive can't write outside it ("zip slip"). */
    fun safeTarget(dest: File, name: String): File {
        val target = File(dest, name.replace('\\', '/').trimStart('/'))
        val root = dest.canonicalPath + File.separator
        if (!(target.canonicalPath + File.separator).startsWith(root)) throw SecurityException("Blocked an unsafe path in the archive: $name")
        return target
    }

    /** Where a file goes when [target] exists: keep both ("name (1).ext"), replace, or skip (null). */
    fun resolveConflict(target: File, conflict: String): File? {
        if (!target.exists()) return target
        return when (conflict) {
            "replace" -> target.apply { delete() }
            "skip" -> null
            else -> uniqueSibling(target)
        }
    }

    /** "name (1).ext", "name (2).ext" … next to [file], the first that is free. */
    fun uniqueSibling(file: File, taken: (File) -> Boolean = { it.exists() }): File {
        if (!taken(file)) return file
        val dot = file.name.lastIndexOf('.')
        val stem = if (dot > 0) file.name.substring(0, dot) else file.name
        val ext = if (dot > 0) file.name.substring(dot) else ""
        var n = 1
        while (true) {
            val candidate = File(file.parentFile, "$stem ($n)$ext")
            if (!taken(candidate)) return candidate
            n++
        }
    }
}
