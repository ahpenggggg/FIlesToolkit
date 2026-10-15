package expo.modules.filetoolkit.compress

import expo.modules.filetoolkit.medialibrary.MediaItem
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import kotlin.math.min

/** A compressed file is only kept if it is at least this much smaller than the original. */
const val MIN_SAVING: Long = 1L shl 20 // 1 MB

sealed interface Outcome {
    /** [review] non-null = quality check was inconclusive: save as a separate copy and keep the original. */
    data class Compressed(val file: File, val mime: String, val ext: String, val note: String, val review: String? = null) : Outcome
    data class Skipped(val reason: String) : Outcome
    data class Failed(val reason: String) : Outcome
}

fun mb(bytes: Long): String =
    if (bytes >= 1L shl 30) "%.2f GB".format(bytes / 1073741824.0) else "%.1f MB".format(bytes / 1048576.0)

object Quality {
    private const val C1 = 6.5025   // (0.01*255)^2
    private const val C2 = 58.5225  // (0.03*255)^2

    /**
     * Mean SSIM on luminance over 8x8 blocks (1.0 = identical). Processes 8 rows at a time to keep memory low.
     * If sizes differ, compares the overlapping area.
     */
    fun ssim(a: Bitmap, b: Bitmap): Double {
        val w = min(a.width, b.width)
        val h = min(a.height, b.height)
        if (w < 8 || h < 8) return 1.0
        val pa = IntArray(w * 8)
        val pb = IntArray(w * 8)
        var sum = 0.0
        var count = 0
        var y = 0
        while (y + 8 <= h) {
            a.getPixels(pa, 0, w, 0, y, w, 8)
            b.getPixels(pb, 0, w, 0, y, w, 8)
            var x = 0
            while (x + 8 <= w) {
                var sa = 0.0; var sb = 0.0; var saa = 0.0; var sbb = 0.0; var sab = 0.0
                for (yy in 0 until 8) {
                    val row = yy * w + x
                    for (xx in 0 until 8) {
                        val la = luma(pa[row + xx])
                        val lb = luma(pb[row + xx])
                        sa += la; sb += lb; saa += la * la; sbb += lb * lb; sab += la * lb
                    }
                }
                val ma = sa / 64; val mb = sb / 64
                val va = saa / 64 - ma * ma
                val vb = sbb / 64 - mb * mb
                val cov = sab / 64 - ma * mb
                sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
                count++
                x += 8
            }
            y += 8
        }
        return if (count == 0) 1.0 else sum / count
    }

    /**
     * SSIM for small frames, robust to orientation and global tone: rotates [b] if its orientation differs,
     * scales it to [a]'s size, and normalises each frame's luma to the same mean/contrast first.
     */
    fun ssimNormalized(a: Bitmap, b: Bitmap): Double {
        var bb = b
        val flipped = (a.width > a.height) != (b.width > b.height) && a.width != a.height
        if (flipped) {
            bb = Bitmap.createBitmap(b, 0, 0, b.width, b.height, android.graphics.Matrix().apply { postRotate(90f) }, true)
        }
        if (bb.width != a.width || bb.height != a.height) {
            val s = Bitmap.createScaledBitmap(bb, a.width, a.height, true)
            if (bb !== b) bb.recycle()
            bb = s
        }
        val la = normLuma(a)
        val lb = normLuma(bb)
        if (bb !== b) bb.recycle()
        val w = a.width
        val h = a.height
        var sum = 0.0
        var count = 0
        var y = 0
        while (y + 8 <= h) {
            var x = 0
            while (x + 8 <= w) {
                var sa = 0.0; var sb = 0.0; var saa = 0.0; var sbb = 0.0; var sab = 0.0
                for (yy in 0 until 8) for (xx in 0 until 8) {
                    val i = (y + yy) * w + x + xx
                    val pa = la[i]; val pb = lb[i]
                    sa += pa; sb += pb; saa += pa * pa; sbb += pb * pb; sab += pa * pb
                }
                val ma = sa / 64; val mb = sb / 64
                val va = saa / 64 - ma * ma
                val vb = sbb / 64 - mb * mb
                val cov = sab / 64 - ma * mb
                sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
                count++
                x += 8
            }
            y += 8
        }
        return if (count == 0) 1.0 else sum / count
    }

    private fun normLuma(bmp: Bitmap): DoubleArray {
        val px = IntArray(bmp.width * bmp.height)
        bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        val l = DoubleArray(px.size) { luma(px[it]) }
        val mean = l.average()
        var v = 0.0
        for (d in l) v += (d - mean) * (d - mean)
        val std = kotlin.math.sqrt(v / l.size).coerceAtLeast(1.0)
        for (k in l.indices) l[k] = (l[k] - mean) / std * 50.0 + 128.0
        return l
    }

    private fun luma(c: Int): Double =
        0.299 * ((c shr 16) and 0xFF) + 0.587 * ((c shr 8) and 0xFF) + 0.114 * (c and 0xFF)
}

/** Puts compressed output into the shared Download/Compressed folder. */
object MediaWriter {

    /** Where compressed videos go, relative to primary storage. */
    val COMPRESSED_FOLDER = Environment.DIRECTORY_DOWNLOADS + "/Compressed"

    fun finalName(original: MediaItem, ext: String): String =
        original.name.substringBeforeLast('.', original.name) + "." + ext

    fun insertCompressed(ctx: Context, original: MediaItem, file: File, mime: String, ext: String, nameSuffix: String = ""): Uri {
        val name = original.name.substringBeforeLast('.', original.name) + nameSuffix + "." + ext
        val downloads = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        return write(ctx, downloads, "$COMPRESSED_FOLDER/", name, mime, original.dateTaken, file)
    }

    private fun write(ctx: Context, collection: Uri, relPath: String, name: String, mime: String, dateTaken: Long, file: File): Uri {
        val r = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relPath)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
            if (dateTaken > 0) put(MediaStore.MediaColumns.DATE_TAKEN, dateTaken)
        }
        val uri = r.insert(collection, values) ?: error("insert returned null")
        try {
            (r.openOutputStream(uri) ?: error("no output stream")).use { out -> file.inputStream().use { it.copyTo(out) } }
            r.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            return uri
        } catch (e: Exception) {
            runCatching { r.delete(uri, null, null) }
            throw e
        }
    }

    /** After the original is trashed its name is free, so drop the " (1)" suffix MediaStore added. */
    fun rename(ctx: Context, uri: Uri, name: String) {
        runCatching {
            ctx.contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, name) }, null, null)
        }
    }
}
