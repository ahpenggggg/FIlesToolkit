package expo.modules.filetoolkit.archiver

import kotlinx.coroutines.CancellationException
import net.lingala.zip4j.ZipFile
import net.lingala.zip4j.exception.ZipException
import net.sf.sevenzipjbinding.ArchiveFormat
import net.sf.sevenzipjbinding.ExtractAskMode
import net.sf.sevenzipjbinding.ExtractOperationResult
import net.sf.sevenzipjbinding.IArchiveExtractCallback
import net.sf.sevenzipjbinding.IArchiveOpenCallback
import net.sf.sevenzipjbinding.IArchiveOpenVolumeCallback
import net.sf.sevenzipjbinding.ICryptoGetTextPassword
import net.sf.sevenzipjbinding.IInArchive
import net.sf.sevenzipjbinding.IInStream
import net.sf.sevenzipjbinding.ISequentialOutStream
import net.sf.sevenzipjbinding.PropID
import net.sf.sevenzipjbinding.SevenZip
import net.sf.sevenzipjbinding.SevenZipException
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

class ArchiveItem(val name: String, val size: Long, val isDirectory: Boolean)

class ArchiveInfo(
    val format: String,
    val items: List<ArchiveItem>,
    /** Some entries are encrypted. */
    val encrypted: Boolean,
    /** Even the list of names is encrypted, so nothing can be read without the password. */
    val needsPassword: Boolean,
    val parts: Int,
)

class ExtractResult(val extracted: Int, val skipped: Int)

/** Reads ZIP archives with zip4j (incl. split and AES) and everything else (RAR 4/5, 7Z, TAR…) with the 7-Zip engine. */
object Extractor {

    fun inspect(file: File, password: String): ArchiveInfo = if (Archives.isZip(file)) inspectZip(file, password) else inspectOther(file, password)

    fun extract(
        file: File,
        dest: File,
        password: String,
        conflict: String,
        progress: (Long) -> ProgressReporter,
        check: () -> Unit,
    ): ExtractResult {
        dest.mkdirs()
        return if (Archives.isZip(file)) extractZip(file, dest, password, conflict, progress, check)
        else extractOther(file, dest, password, conflict, progress, check)
    }

    // ---------- ZIP ----------

    private fun openZip(file: File, password: String) = ZipFile(file, password.takeIf { it.isNotEmpty() }?.toCharArray())

    private fun inspectZip(file: File, password: String): ArchiveInfo = openZip(file, password).use { zip ->
        val headers = zip.fileHeaders
        ArchiveInfo(
            format = "ZIP",
            items = headers.map { ArchiveItem(it.fileName, it.uncompressedSize, it.isDirectory) },
            encrypted = headers.any { it.isEncrypted },
            needsPassword = false,
            parts = if (zip.isSplitArchive) zip.splitZipFiles.size else 1,
        )
    }

    private fun extractZip(
        file: File,
        dest: File,
        password: String,
        conflict: String,
        progress: (Long) -> ProgressReporter,
        check: () -> Unit,
    ): ExtractResult = openZip(file, password).use { zip ->
        val headers = zip.fileHeaders
        if (password.isEmpty() && headers.any { it.isEncrypted }) throw PasswordException("This archive needs a password.")
        val reporter = progress(headers.sumOf { it.uncompressedSize })
        reporter.start()
        var extracted = 0
        var skipped = 0
        for (header in headers) {
            check()
            val target = Archives.safeTarget(dest, header.fileName)
            if (header.isDirectory) {
                target.mkdirs()
                continue
            }
            val out = Archives.resolveConflict(target, conflict)
            if (out == null) {
                skipped++
                reporter.add(header.uncompressedSize)
                continue
            }
            out.parentFile?.mkdirs()
            try {
                zip.getInputStream(header).use { input -> FileOutputStream(out).use { copy(input, it, reporter, check) } }
                if (header.lastModifiedTimeEpoch > 0) out.setLastModified(header.lastModifiedTimeEpoch)
                extracted++
            } catch (e: Throwable) {
                out.delete()
                if (e is ZipException && e.type == ZipException.Type.WRONG_PASSWORD) throw PasswordException("Wrong password.")
                throw e
            }
        }
        ExtractResult(extracted, skipped)
    }

    // ---------- RAR, 7Z and others (7-Zip engine) ----------

    /** Opens [file] with 7-Zip, asking for further volumes (name.part2.rar …) by name. */
    private class Opened(val archive: IInArchive, val callback: VolumeCallback, val parts: Int) : AutoCloseable {
        override fun close() {
            runCatching { archive.close() }
            callback.close()
        }
    }

    /**
     * Feeds 7-Zip the archive's volumes and password. [joinedName] is set for byte-split sets
     * (name.zip.001 …), which arrive already joined: 7-Zip is told the joined name ("name.zip") and
     * gets no extra volumes, so it reads the archive inside rather than splitting it again.
     */
    private class VolumeCallback(private val first: File, private val password: String, private val joinedName: String? = null) :
        IArchiveOpenVolumeCallback, IArchiveOpenCallback, ICryptoGetTextPassword {
        private val files = ArrayList<java.io.Closeable>()
        private var current = first.path
        /** 7-Zip asked for a password, so the archive's names are encrypted. */
        var askedForPassword = false

        override fun getProperty(propID: PropID): Any? = if (propID == PropID.NAME) (joinedName ?: current) else null

        override fun getStream(filename: String): IInStream? {
            if (joinedName != null) return null
            val f = File(filename).let { if (it.isAbsolute) it else File(first.parentFile, filename) }
            if (!f.exists()) return null
            current = f.path
            val raf = RandomAccessFile(f, "r")
            files += raf
            return RandomAccessFileInStream(raf)
        }

        override fun setTotal(files: Long?, bytes: Long?) {}
        override fun setCompleted(files: Long?, bytes: Long?) {}

        override fun cryptoGetTextPassword(): String {
            askedForPassword = true
            return password
        }

        /** Closes [stream] along with the archive. */
        fun adopt(stream: java.io.Closeable) {
            files += stream
        }

        fun close() = files.forEach { runCatching { it.close() } }
    }

    private fun openOther(file: File, password: String): Opened {
        // name.zip.001, .002 …: the parts are one archive cut into pieces, read back to back.
        val numbered = Archives.isNumberedVolume(file)
        val callback = VolumeCallback(file, password, if (numbered) File(file.parentFile, file.name.substringBeforeLast('.')).path else null)
        try {
            val parts = Archives.volumesOf(file)
            val stream = if (numbered) {
                ConcatInStream(parts).also(callback::adopt)
            } else {
                callback.getStream(file.path) ?: throw java.io.FileNotFoundException(file.path)
            }
            return Opened(SevenZip.openInArchive(null, stream, callback), callback, parts.size)
        } catch (e: SevenZipException) {
            callback.close()
            if (callback.askedForPassword) throw PasswordException(if (password.isEmpty()) "This archive needs a password." else "Wrong password.")
            throw IllegalStateException("This file isn't an archive FileToolkit can open, or it is damaged.")
        } catch (e: Throwable) {
            callback.close()
            // UnsatisfiedLinkError and friends: the 7-Zip engine couldn't load on this phone.
            if (e is LinkageError || e.cause is LinkageError) throw UnsupportedOperationException("RAR and 7Z archives can't be opened on this phone.")
            throw e
        }
    }

    private fun items(archive: IInArchive): List<ArchiveItem> = (0 until archive.numberOfItems).map { i ->
        val dir = archive.getProperty(i, PropID.IS_FOLDER) as? Boolean ?: false
        ArchiveItem(archive.getStringProperty(i, PropID.PATH) ?: "", if (dir) 0 else (archive.getProperty(i, PropID.SIZE) as? Long ?: 0L), dir)
    }

    private fun inspectOther(file: File, password: String): ArchiveInfo {
        val opened = try {
            openOther(file, password)
        } catch (e: PasswordException) {
            // name.7z.001 is a 7Z: name the format after the extension before the part number.
            val ext = if (Archives.isNumberedVolume(file)) File(file.nameWithoutExtension).extension else file.extension
            return ArchiveInfo(ext.uppercase().ifEmpty { "Archive" }, emptyList(), encrypted = true, needsPassword = true, parts = Archives.volumesOf(file).size)
        }
        opened.use {
            val archive = it.archive
            val encrypted = (0 until archive.numberOfItems).any { i -> archive.getProperty(i, PropID.ENCRYPTED) == true }
            return ArchiveInfo(formatLabel(archive.archiveFormat), items(archive), encrypted, needsPassword = false, parts = it.parts)
        }
    }

    private fun extractOther(
        file: File,
        dest: File,
        password: String,
        conflict: String,
        progress: (Long) -> ProgressReporter,
        check: () -> Unit,
    ): ExtractResult {
        openOther(file, password).use { opened ->
            val archive = opened.archive
            val encrypted = (0 until archive.numberOfItems).any { i -> archive.getProperty(i, PropID.ENCRYPTED) == true }
            if (encrypted && password.isEmpty()) throw PasswordException("This archive needs a password.")
            val reporter = progress(items(archive).sumOf { it.size })
            reporter.start()
            val callback = ExtractCallback(archive, dest, conflict, password, reporter, check)
            try {
                archive.extract(null, false, callback)
            } catch (e: SevenZipException) {
                callback.closeCurrent(delete = true)
                if (callback.cancelled) throw CancellationException("Cancelled")
                throw e
            }
            val failure = callback.failure
            if (failure != null) {
                if (failure == ExtractOperationResult.WRONG_PASSWORD ||
                    (callback.failedEncrypted && (failure == ExtractOperationResult.DATAERROR || failure == ExtractOperationResult.CRCERROR))
                ) throw PasswordException("Wrong password.")
                throw IllegalStateException("Some files couldn't be extracted (${failure.name.lowercase().replace('_', ' ')}).")
            }
            return ExtractResult(callback.extracted, callback.skipped)
        }
    }

    /** Writes each entry 7-Zip hands over, applying the conflict rule and reporting progress. */
    private class ExtractCallback(
        private val archive: IInArchive,
        private val dest: File,
        private val conflict: String,
        private val password: String,
        private val reporter: ProgressReporter,
        private val check: () -> Unit,
    ) : IArchiveExtractCallback, ICryptoGetTextPassword {
        var extracted = 0
        var skipped = 0
        var failure: ExtractOperationResult? = null
        var failedEncrypted = false
        var cancelled = false
        private var out: FileOutputStream? = null
        private var outFile: File? = null
        private var outEncrypted = false
        private var completed = 0L

        override fun getStream(index: Int, mode: ExtractAskMode): ISequentialOutStream? {
            guard()
            if (mode != ExtractAskMode.EXTRACT) return null
            val path = archive.getStringProperty(index, PropID.PATH) ?: return null
            val target = Archives.safeTarget(dest, path)
            if (archive.getProperty(index, PropID.IS_FOLDER) == true) {
                target.mkdirs()
                return null
            }
            val file = Archives.resolveConflict(target, conflict)
            if (file == null) {
                skipped++
                return null
            }
            file.parentFile?.mkdirs()
            outFile = file
            outEncrypted = archive.getProperty(index, PropID.ENCRYPTED) == true
            val stream = FileOutputStream(file)
            out = stream
            return ISequentialOutStream { data ->
                stream.write(data)
                data.size
            }
        }

        override fun prepareOperation(mode: ExtractAskMode) {}

        override fun setOperationResult(result: ExtractOperationResult) {
            val file = outFile
            if (result == ExtractOperationResult.OK) {
                closeCurrent(delete = false)
                if (file != null) extracted++
            } else {
                closeCurrent(delete = true)
                if (failure == null) {
                    failure = result
                    failedEncrypted = outEncrypted
                }
            }
        }

        fun closeCurrent(delete: Boolean) {
            runCatching { out?.close() }
            if (delete) outFile?.delete()
            out = null
            outFile = null
        }

        override fun setTotal(total: Long) {}

        override fun setCompleted(complete: Long) {
            guard()
            reporter.add(complete - completed)
            completed = complete
        }

        override fun cryptoGetTextPassword(): String = password

        /** Cancelling throws through 7-Zip as its own exception type. */
        private fun guard() {
            try {
                check()
            } catch (e: CancellationException) {
                cancelled = true
                throw SevenZipException("Cancelled")
            }
        }
    }

    private fun formatLabel(format: ArchiveFormat?): String = when (format) {
        ArchiveFormat.SEVEN_ZIP -> "7Z"
        null -> "Archive"
        else -> format.name.replace('_', ' ')
    }
}
