package expo.modules.filetoolkit.duplicates

import expo.modules.filetoolkit.medialibrary.MediaItem
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Base64
import android.util.Size
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Fingerprint of a single image / video frame:
 *  - [phash]: 256-bit DCT perceptual hash (structure, grayscale)
 *  - [color]: 8x8 RGB thumbnail, 192 bytes (colour layout)
 *
 * Both are scored on a *calibrated* scale where 0% ≈ two unrelated images and 100% = identical,
 * and the final score is the LOWER of the two — an item must match in structure AND colour.
 */
class FrameFeature(val phash: LongArray, val color: ByteArray) {

    /** Structure similarity. Unrelated images differ in ~128 of 256 bits, so map 0..128 bits → 100%..0%. */
    fun structure(o: FrameFeature): Double {
        var d = 0
        for (i in phash.indices) d += java.lang.Long.bitCount(phash[i] xor o.phash[i])
        return max(0.0, 1.0 - d / 128.0)
    }

    /** Colour similarity. Mean absolute RGB difference: 0 → 100%, ≥48 (of 255) → 0%. */
    fun colour(o: FrameFeature): Double {
        var sum = 0
        for (i in color.indices) sum += abs((color[i].toInt() and 0xFF) - (o.color[i].toInt() and 0xFF))
        val mad = sum.toDouble() / color.size
        return max(0.0, 1.0 - mad / 48.0)
    }

    fun similarity(o: FrameFeature): Double = min(structure(o), colour(o))

    fun encode(): String =
        phash.joinToString(".") { java.lang.Long.toHexString(it) } + ":" + Base64.encodeToString(color, Base64.NO_WRAP)

    companion object {
        fun decode(s: String): FrameFeature? = runCatching {
            val (p, c) = s.split(':', limit = 2)
            val longs = p.split('.').map { java.lang.Long.parseUnsignedLong(it, 16) }.toLongArray()
            val bytes = Base64.decode(c, Base64.NO_WRAP)
            if (longs.size != 4 || bytes.size != 192) null else FrameFeature(longs, bytes)
        }.getOrNull()
    }
}

object PerceptualHash {
    private const val N = 64   // downsample size
    private const val K = 16   // keep 16x16 lowest DCT frequencies → 256 bits
    private val cosTable = Array(K) { u -> DoubleArray(N) { x -> cos((2 * x + 1) * u * PI / (2 * N)) } }

    /** Returns null for near-uniform images (black pocket shots, blank screens) whose fingerprint is meaningless. */
    fun feature(source: Bitmap): FrameFeature? {
        val soft = if (source.config == Bitmap.Config.HARDWARE) source.copy(Bitmap.Config.ARGB_8888, false) else source
        try {
            // ---- structure ----
            val small = Bitmap.createScaledBitmap(soft, N, N, true)
            val px = IntArray(N * N)
            small.getPixels(px, 0, N, 0, 0, N, N)
            if (small !== soft) small.recycle()

            val g = DoubleArray(N * N) { i ->
                val c = px[i]
                0.299 * ((c shr 16) and 0xFF) + 0.587 * ((c shr 8) and 0xFF) + 0.114 * (c and 0xFF)
            }
            val mean = g.average()
            val std = sqrt(g.sumOf { (it - mean) * (it - mean) } / g.size)
            if (std < 6.0) return null

            val tmp = Array(K) { DoubleArray(N) }
            for (u in 0 until K) for (y in 0 until N) {
                var s = 0.0
                val row = y * N
                val cu = cosTable[u]
                for (x in 0 until N) s += cu[x] * g[row + x]
                tmp[u][y] = s
            }
            val d = DoubleArray(K * K)
            for (u in 0 until K) for (v in 0 until K) {
                var s = 0.0
                val cv = cosTable[v]
                val tu = tmp[u]
                for (y in 0 until N) s += cv[y] * tu[y]
                d[v * K + u] = s
            }
            val median = d.copyOfRange(1, K * K).sorted()[(K * K - 1) / 2] // ignore DC term
            val bits = LongArray(K * K / 64)
            for (i in 0 until K * K) if (d[i] > median) bits[i / 64] = bits[i / 64] or (1L shl (i % 64))

            // ---- colour ----
            val tiny = Bitmap.createScaledBitmap(soft, 8, 8, true)
            val cp = IntArray(64)
            tiny.getPixels(cp, 0, 8, 0, 0, 8, 8)
            if (tiny !== soft) tiny.recycle()
            val color = ByteArray(192)
            for (i in 0 until 64) {
                color[i * 3] = ((cp[i] shr 16) and 0xFF).toByte()
                color[i * 3 + 1] = ((cp[i] shr 8) and 0xFF).toByte()
                color[i * 3 + 2] = (cp[i] and 0xFF).toByte()
            }
            return FrameFeature(bits, color)
        } finally {
            if (soft !== source) soft.recycle()
        }
    }
}

/** Fingerprint of one item: 1 frame for a photo, several sampled frames for a video. null = unusable frame. */
class Signature(val frames: List<FrameFeature?>) {

    val usable: Boolean get() = frames.any { it != null }

    /**
     * @param floor photos only: if structure alone is already below this, skip the colour check and return early
     * (the result is then just "below floor", which is all the caller needs).
     */
    fun similarity(other: Signature, floor: Double = 0.0): Double {
        if (frames.size == 1 && other.frames.size == 1) {
            val a = frames[0] ?: return 0.0
            val b = other.frames[0] ?: return 0.0
            val s = a.structure(b)
            return if (s < floor) s else min(s, a.colour(b))
        }
        val scores = ArrayList<Double>(frames.size)
        for (i in 0 until min(frames.size, other.frames.size)) {
            val a = frames[i] ?: continue
            val b = other.frames[i] ?: continue
            scores += a.similarity(b)
        }
        val required = if (frames.size > 1 && other.frames.size > 1) 2 else 1
        if (scores.size < required) return 0.0
        // Videos: one badly mismatched frame drags the score down, so an intro shared by two different clips can't carry it.
        return min(scores.average(), scores.min() + 0.10)
    }

    fun encode(): String = frames.joinToString(",") { it?.encode() ?: "-" }

    companion object {
        fun decode(s: String): Signature? = runCatching {
            val frames = s.split(',').map { if (it == "-") null else FrameFeature.decode(it) ?: error("bad frame") }
            Signature(frames)
        }.getOrNull()
    }
}

object Hasher {
    private val VIDEO_POSITIONS = doubleArrayOf(0.15, 0.35, 0.50, 0.65, 0.85)

    fun signature(context: Context, item: MediaItem): Signature? = try {
        if (item.isVideo) video(context, item) else image(context, item)
    } catch (e: Exception) {
        null
    }

    private fun image(context: Context, item: MediaItem): Signature {
        val bmp = context.contentResolver.loadThumbnail(item.uri, Size(256, 256), null)
        val f = PerceptualHash.feature(bmp)
        bmp.recycle()
        return Signature(listOf(f))
    }

    private fun video(context: Context, item: MediaItem): Signature {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(context, item.uri)
            val durMs = item.durationMs.takeIf { it > 0 }
                ?: r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                ?: 0L
            val times = if (durMs > 0) VIDEO_POSITIONS.map { (durMs * 1000 * it).toLong() } else listOf(0L)
            val frames = times.map { t ->
                r.getScaledFrameAtTime(t, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 192, 192)?.let { f ->
                    PerceptualHash.feature(f).also { f.recycle() }
                }
            }
            return Signature(frames)
        } finally {
            runCatching { r.release() }
        }
    }
}

/** On-disk cache so rescans only hash new or changed files. */
class HashCache(private val file: File) {
    private val map = ConcurrentHashMap<String, String>()

    fun key(item: MediaItem) = "${item.id}:${item.dateModified}:${item.size}"

    fun load() {
        if (!file.exists()) return
        file.forEachLine { line ->
            val tab = line.indexOf('\t')
            if (tab > 0) map[line.substring(0, tab)] = line.substring(tab + 1)
        }
    }

    fun get(item: MediaItem): Signature? = map[key(item)]?.let(Signature::decode)

    fun put(item: MediaItem, sig: Signature) {
        map[key(item)] = sig.encode()
    }

    /** Drop entries not in [validKeys] (call only after a full-library scan). */
    fun prune(validKeys: Set<String>) {
        map.keys.retainAll(validKeys)
    }

    fun save() {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.bufferedWriter().use { w -> for ((k, v) in map) { w.write(k); w.write('\t'.code); w.write(v); w.newLine() } }
        tmp.renameTo(file)
    }
}
