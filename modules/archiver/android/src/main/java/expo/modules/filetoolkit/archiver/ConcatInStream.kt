package expo.modules.filetoolkit.archiver

import net.sf.sevenzipjbinding.IInStream
import net.sf.sevenzipjbinding.ISeekableStream
import net.sf.sevenzipjbinding.SevenZipException
import java.io.File
import java.io.RandomAccessFile

/**
 * Byte-split volumes (name.zip.001, name.zip.002 …, as written by 7-Zip, WinRAR's splitter and
 * others) read as the single archive they were cut from.
 */
class ConcatInStream(files: List<File>) : IInStream {
    private val parts = files.map { RandomAccessFile(it, "r") }
    private val starts = LongArray(parts.size)
    private val total: Long
    private var position = 0L

    init {
        var offset = 0L
        parts.forEachIndexed { i, part ->
            starts[i] = offset
            offset += part.length()
        }
        total = offset
    }

    override fun seek(offset: Long, seekOrigin: Int): Long {
        position = when (seekOrigin) {
            ISeekableStream.SEEK_SET -> offset
            ISeekableStream.SEEK_CUR -> position + offset
            ISeekableStream.SEEK_END -> total + offset
            else -> throw SevenZipException("Unknown seek origin $seekOrigin")
        }
        return position
    }

    override fun read(data: ByteArray): Int {
        if (position >= total || data.isEmpty()) return 0
        // The last part whose start is at or before the position holds it.
        var i = parts.size - 1
        while (i > 0 && starts[i] > position) i--
        val part = parts[i]
        val local = position - starts[i]
        part.seek(local)
        val n = part.read(data, 0, minOf(data.size.toLong(), part.length() - local).toInt())
        if (n <= 0) return 0
        position += n
        return n
    }

    override fun close() {
        parts.forEach { runCatching { it.close() } }
    }
}
