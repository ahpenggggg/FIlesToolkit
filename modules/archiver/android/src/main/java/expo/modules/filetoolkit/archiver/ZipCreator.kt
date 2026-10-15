package expo.modules.filetoolkit.archiver

import net.lingala.zip4j.io.outputstream.SplitOutputStream
import net.lingala.zip4j.io.outputstream.ZipOutputStream
import net.lingala.zip4j.model.Zip4jConfig
import net.lingala.zip4j.model.ZipModel
import net.lingala.zip4j.model.ZipParameters
import net.lingala.zip4j.model.enums.AesKeyStrength
import net.lingala.zip4j.model.enums.CompressionLevel
import net.lingala.zip4j.model.enums.CompressionMethod
import net.lingala.zip4j.model.enums.EncryptionMethod
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets

/** One entry to write: a file's data, or a folder (file = null). */
private class Entry(val file: File?, val name: String)

object ZipCreator {
    /**
     * Zips [items] (files, and folders with everything inside) into [dir]/[name].zip — or name (1).zip
     * if taken. With [splitSize] > 0 the archive is written as standard split parts name.z01,
     * name.z02 … name.zip, which WinRAR, 7-Zip and WinZip open. A non-empty [password] encrypts
     * every file with AES-256. On failure or cancel, partial output is removed.
     */
    fun create(
        items: List<File>,
        dir: File,
        name: String,
        level: String,
        password: String,
        splitSize: Long,
        progress: (Long) -> ProgressReporter,
        check: () -> Unit,
    ): List<File> {
        val entries = collect(items)
        val reporter = progress(entries.sumOf { it.file?.length() ?: 0L })
        // The name is free only if no part of a previous split archive uses it either.
        val out = Archives.uniqueSibling(File(dir, "$name.zip")) { candidate -> Archives.zipPartsOf(candidate).any { it.exists() } }
        val pwd = password.takeIf { it.isNotEmpty() }?.toCharArray()
        reporter.start()
        try {
            val stream = if (splitSize > 0) {
                val model = ZipModel().apply {
                    isSplitArchive = true
                    splitLength = splitSize
                    zipFile = out
                }
                ZipOutputStream(SplitOutputStream(out, splitSize), pwd, Zip4jConfig(StandardCharsets.UTF_8, 4096, true), model)
            } else {
                ZipOutputStream(FileOutputStream(out), pwd, StandardCharsets.UTF_8)
            }
            stream.use { zip ->
                for (entry in entries) {
                    check()
                    zip.putNextEntry(parameters(entry, level, pwd != null))
                    entry.file?.inputStream()?.use { copy(it, zip, reporter, check) }
                    zip.closeEntry()
                }
            }
        } catch (e: Throwable) {
            Archives.zipPartsOf(out).forEach { it.delete() }
            throw e
        }
        return Archives.zipPartsOf(out)
    }

    private fun parameters(entry: Entry, level: String, encrypt: Boolean) = ZipParameters().apply {
        fileNameInZip = entry.name
        if (entry.file == null || level == "store") {
            compressionMethod = CompressionMethod.STORE
        } else {
            compressionMethod = CompressionMethod.DEFLATE
            compressionLevel = when (level) {
                "fast" -> CompressionLevel.FASTEST
                "max" -> CompressionLevel.MAXIMUM
                else -> CompressionLevel.NORMAL
            }
        }
        entry.file?.let {
            entrySize = it.length()
            lastModifiedFileTime = it.lastModified()
        }
        // Folders carry no data, so they are never encrypted.
        if (encrypt && entry.file != null) {
            isEncryptFiles = true
            encryptionMethod = EncryptionMethod.AES
            aesKeyStrength = AesKeyStrength.KEY_STRENGTH_256
        }
    }

    /** Files and folders in archive order; folders end with "/". Top-level names that clash get " (2)". */
    private fun collect(items: List<File>): List<Entry> {
        val out = ArrayList<Entry>()
        val tops = HashSet<String>()
        for (item in items) {
            var top = item.name
            var n = 2
            while (!tops.add(top.lowercase())) top = suffixed(item.name, n++)
            if (item.isDirectory) {
                val visited = HashSet<String>()
                item.walkTopDown()
                    .onEnter { visited.add(it.canonicalPath) }
                    .sortedBy { it.path }
                    .forEach { f ->
                        val rel = f.relativeTo(item).invariantSeparatorsPath
                        val path = if (rel.isEmpty()) top else "$top/$rel"
                        out += if (f.isDirectory) Entry(null, "$path/") else Entry(f, path)
                    }
            } else {
                out += Entry(item, top)
            }
        }
        return out
    }

    private fun suffixed(name: String, n: Int): String {
        val dot = name.lastIndexOf('.')
        return if (dot > 0) "${name.substring(0, dot)} ($n)${name.substring(dot)}" else "$name ($n)"
    }
}
