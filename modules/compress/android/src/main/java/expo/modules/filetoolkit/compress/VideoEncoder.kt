package expo.modules.filetoolkit.compress

import expo.modules.filetoolkit.medialibrary.MediaItem
import android.content.Context
import android.graphics.Matrix
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.EncoderUtil
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.max
import androidx.media3.common.MediaItem as ExoMediaItem

/** Encoding parameters decided in TypeScript (src/lib/plan.ts) so both platforms behave the same. */
data class EncodeParams(val scale: Float, val fps: Double, val dropFrames: Boolean, val bitrate: Long)

sealed interface EncodeOutcome {
    data class Done(val file: File, val review: String?, val match: Double?) : EncodeOutcome
    data class Skipped(val reason: String) : EncodeOutcome
    data class Failed(val reason: String) : EncodeOutcome
}

@OptIn(UnstableApi::class)
object VideoEncoder {

    data class Info(val width: Int, val height: Int, val rotation: Int, val fps: Double, val videoBitrate: Long, val durationMs: Long)

    /** Normalised low-res SSIM below this means "unsure" → saved as a review copy, original kept. */
    private const val MIN_FRAME_MATCH = 0.75

    // Identity transform: forces a real re-encode (Transformer would otherwise just copy same-codec streams).
    private val forceTranscode = MatrixTransformation { _ -> Matrix() }

    val hevcAvailable: Boolean by lazy {
        runCatching { EncoderUtil.getSupportedEncoders(MimeTypes.VIDEO_H265).isNotEmpty() }.getOrDefault(false)
    }

    suspend fun encode(ctx: Context, item: MediaItem, workDir: File, p: EncodeParams, onProgress: (Float) -> Unit): EncodeOutcome {
        val info = withContext(Dispatchers.IO) { probe(ctx, item) } ?: return EncodeOutcome.Failed("Can't read video")
        val out = File(workDir, "out.mp4").apply { delete() }
        try {
            export(ctx, item, out, if (hevcAvailable) MimeTypes.VIDEO_H265 else MimeTypes.VIDEO_H264, p, onProgress)
        } catch (e: ExportException) {
            out.delete()
            return EncodeOutcome.Failed("Encoder error: ${e.errorCodeName}")
        }
        val saved = item.size - out.length()
        if (out.length() == 0L || saved < MIN_SAVING) {
            out.delete()
            return EncodeOutcome.Skipped("Result only ${mb(saved.coerceAtLeast(0))} smaller (need ≥ 1 MB)")
        }
        val outDur = withContext(Dispatchers.IO) { durationMs(out.absolutePath) }
        if (outDur != null && outDur < info.durationMs - max(1500L, info.durationMs / 100)) {
            out.delete()
            return EncodeOutcome.Failed("Output incomplete (${outDur / 1000}s of ${info.durationMs / 1000}s)")
        }
        val q = withContext(Dispatchers.IO) { frameSimilarity(ctx, item, out, info.durationMs) }
        val review = if (q != null && q < MIN_FRAME_MATCH) {
            "Auto-check unsure (match ${"%.2f".format(q)}) — compare before deleting the original"
        } else null
        return EncodeOutcome.Done(out, review, q)
    }

    private suspend fun export(ctx: Context, item: MediaItem, out: File, mime: String, p: EncodeParams, onProgress: (Float) -> Unit) =
        withContext(Dispatchers.Main) {
            val done = CompletableDeferred<ExportResult>()
            val transformer = Transformer.Builder(ctx)
                .setVideoMimeType(mime)
                .setEncoderFactory(
                    DefaultEncoderFactory.Builder(ctx)
                        .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(p.bitrate.toInt()).build())
                        .setEnableFallback(true)
                        .build(),
                )
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        done.complete(exportResult)
                    }

                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                        done.completeExceptionally(exportException)
                    }
                })
                .build()

            val effects = mutableListOf<Effect>(forceTranscode)
            if (p.scale < 0.999f) {
                // A plain scale factor is orientation-agnostic: correct for portrait/rotated videos.
                effects += ScaleAndRotateTransformation.Builder().setScale(p.scale, p.scale).build()
            }
            if (p.dropFrames && p.fps > 0) {
                effects += FrameDropEffect.createDefaultFrameDropEffect(p.fps.toFloat())
            }
            val edited = EditedMediaItem.Builder(ExoMediaItem.fromUri(item.uri))
                .setEffects(Effects(emptyList(), effects))
                .build()
            transformer.start(edited, out.absolutePath)

            val holder = ProgressHolder()
            val poll = launch {
                while (isActive) {
                    if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress / 100f)
                    delay(400)
                }
            }
            try {
                done.await().also { onProgress(1f) }
            } catch (e: CancellationException) {
                transformer.cancel()
                throw e
            } finally {
                poll.cancel()
            }
        }

    fun probe(ctx: Context, item: MediaItem): Info? = runCatching {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(ctx, item.uri, null)
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (!mime.startsWith("video/")) continue
                val w = f.getInteger(MediaFormat.KEY_WIDTH)
                val h = f.getInteger(MediaFormat.KEY_HEIGHT)
                val fps = runCatching { f.getInteger(MediaFormat.KEY_FRAME_RATE).toDouble() }
                    .recoverCatching { f.getFloat(MediaFormat.KEY_FRAME_RATE).toDouble() }
                    .getOrDefault(30.0)
                    .let { if (it <= 0 || it > 240) 30.0 else it }
                val rotation = if (f.containsKey(MediaFormat.KEY_ROTATION)) f.getInteger(MediaFormat.KEY_ROTATION) else rotationOf(ctx, item)
                val durMs = if (f.containsKey(MediaFormat.KEY_DURATION)) f.getLong(MediaFormat.KEY_DURATION) / 1000 else item.durationMs
                val dur = if (durMs > 0) durMs else item.durationMs
                val br = if (f.containsKey(MediaFormat.KEY_BIT_RATE)) f.getInteger(MediaFormat.KEY_BIT_RATE).toLong() else 0L
                val vbr: Long = if (br > 0) br else if (dur > 0) ((item.size * 8 * 1000.0 / dur) - 192_000).toLong().coerceAtLeast(0L) else 0L
                return@runCatching Info(w, h, ((rotation % 360) + 360) % 360, fps, vbr, dur)
            }
            null
        } finally {
            ex.release()
        }
    }.getOrNull()

    private fun rotationOf(ctx: Context, item: MediaItem): Int = runCatching {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(ctx, item.uri)
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        } finally {
            r.release()
        }
    }.getOrDefault(0)

    /**
     * Sanity check that the output shows the same picture: 5 points, each compared with the original at
     * t and up to ±1 s (downloads often carry a start offset), small and brightness-normalised. Median score.
     */
    private fun frameSimilarity(ctx: Context, item: MediaItem, out: File, durMs: Long): Double? {
        val a = MediaMetadataRetriever()
        val b = MediaMetadataRetriever()
        try {
            a.setDataSource(ctx, item.uri)
            b.setDataSource(out.absolutePath)
            val scores = ArrayList<Double>()
            for (p in doubleArrayOf(0.1, 0.3, 0.5, 0.7, 0.9)) {
                val t = (durMs * 1000 * p).toLong()
                val fb = b.getScaledFrameAtTime(t, MediaMetadataRetriever.OPTION_CLOSEST, 160, 160) ?: continue
                var best = -1.0
                for (dt in longArrayOf(0L, -250_000L, 250_000L, -500_000L, 500_000L, -1_000_000L, 1_000_000L)) {
                    val fa = a.getScaledFrameAtTime((t + dt).coerceAtLeast(0L), MediaMetadataRetriever.OPTION_CLOSEST, 160, 160) ?: continue
                    best = max(best, Quality.ssimNormalized(fa, fb))
                    fa.recycle()
                    if (best >= 0.95) break
                }
                fb.recycle()
                if (best >= 0) scores += best
            }
            return if (scores.isEmpty()) null else scores.sorted()[scores.size / 2]
        } catch (e: Exception) {
            return null
        } finally {
            runCatching { a.release() }
            runCatching { b.release() }
        }
    }

    private fun durationMs(path: String): Long? {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(path)
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        } catch (e: Exception) {
            null
        } finally {
            runCatching { r.release() }
        }
    }
}
