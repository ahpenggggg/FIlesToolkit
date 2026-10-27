package expo.modules.filetoolkit.compress

import android.content.Context
import android.graphics.ImageFormat
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import expo.modules.filetoolkit.medialibrary.MediaItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * HandBrake's default preset ("Fast 1080p30") with Resolution Limit "720p HD", at RF 26: x264 "fast",
 * Main profile, level 4.0, constant quality RF 26 (a notch finer than the RF 28 first tried), the source frame rate capped at 30 fps, the picture
 * fitted inside 720p keeping its aspect ratio, AAC 160 kbps stereo, MP4.
 */
object HandBrake {
    const val PRESET = "fast"
    const val PROFILE = "main"
    const val LEVEL = 40
    const val RF = 26f
    const val MAX_LONG = 1280
    const val MAX_SHORT = 720
    const val MAX_FPS = 30.0
    const val AUDIO_BITRATE = 160_000
    const val LABEL = "H.264 · RF 26"

    /** The output size: fitted inside 1280×720 (720×1280 for portrait), never enlarged, even sides. */
    fun fit(width: Int, height: Int): Pair<Int, Int> {
        val landscape = width >= height
        val maxW = if (landscape) MAX_LONG else MAX_SHORT
        val maxH = if (landscape) MAX_SHORT else MAX_LONG
        val scale = min(1.0, min(maxW.toDouble() / width, maxH.toDouble() / height))
        return even(width * scale) to even(height * scale)
    }

    private fun even(v: Double): Int {
        val r = v.roundToInt()
        return max(2, r - r % 2)
    }
}

sealed interface EncodeOutcome {
    data class Done(val file: File, val review: String?, val match: Double?, val width: Int, val height: Int) : EncodeOutcome
    data class Skipped(val reason: String) : EncodeOutcome
    data class Failed(val reason: String) : EncodeOutcome
}

/** Problems worth telling the user about, as opposed to bugs. */
class Unsupported(message: String) : Exception(message)

object Transcoder {

    data class Info(
        val width: Int, val height: Int, val rotation: Int, val fps: Double, val videoBitrate: Long, val durationMs: Long,
        val mime: String, val hdr: Boolean,
    )

    /** Normalised low-res SSIM below this means "unsure": saved as a review copy, original kept. */
    private const val MIN_FRAME_MATCH = 0.75
    private const val TIMEOUT_US = 10_000L
    /** Share of the progress bar for the audio pass (it's quick next to the video). */
    private const val AUDIO_PROGRESS = 0.04f

    /** Compresses [item] into [workDir]/out.mp4 and checks the result. */
    suspend fun encode(ctx: Context, item: MediaItem, workDir: File, onProgress: (Float) -> Unit): EncodeOutcome =
        withContext(Dispatchers.Default) {
            val info = probe(ctx, item) ?: return@withContext EncodeOutcome.Failed("Can't read video")
            if (info.hdr) return@withContext EncodeOutcome.Skipped("HDR video isn't supported yet")
            val out = File(workDir, "out.mp4").apply { delete() }
            val (outW, outH) = try {
                transcode(ctx, item, info, workDir, out, onProgress)
            } catch (e: Unsupported) {
                out.delete()
                return@withContext EncodeOutcome.Skipped(e.message ?: "Not supported")
            } catch (e: kotlinx.coroutines.CancellationException) {
                out.delete()
                throw e
            } catch (e: Exception) {
                out.delete()
                return@withContext EncodeOutcome.Failed(e.message ?: e.javaClass.simpleName)
            }
            onProgress(1f)

            val saved = item.size - out.length()
            if (out.length() == 0L || saved < minSavingFor(item.size)) {
                out.delete()
                return@withContext EncodeOutcome.Skipped("Result only ${mb(saved.coerceAtLeast(0))} smaller (need ≥ ${mb(minSavingFor(item.size))})")
            }
            val outDur = durationMs(out.absolutePath)
            if (outDur != null && outDur < info.durationMs - max(1500L, info.durationMs / 100)) {
                out.delete()
                return@withContext EncodeOutcome.Failed("Output incomplete (${outDur / 1000}s of ${info.durationMs / 1000}s)")
            }
            val q = frameSimilarity(ctx, item, out, info.durationMs)
            val review = if (q != null && q < MIN_FRAME_MATCH) {
                "Auto-check unsure (match ${"%.2f".format(q)}) — compare before deleting the original"
            } else null
            EncodeOutcome.Done(out, review, q, outW, outH)
        }

    /** Decode → scale → x264 → MP4, with the audio re-encoded first. Returns the output size. */
    private suspend fun transcode(ctx: Context, item: MediaItem, info: Info, workDir: File, out: File, onProgress: (Float) -> Unit): Pair<Int, Int> {
        val audioFile = File(workDir, "audio.tmp").apply { delete() }
        val audio = try {
            AudioTrack.prepare(ctx, item, audioFile) { onProgress(it * AUDIO_PROGRESS) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            throw Unsupported("Couldn't read the audio (${e.message})")
        }

        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var encoder: X264? = null
        var muxer: MediaMuxer? = null
        var muxerStarted = false
        try {
            extractor.setDataSource(ctx, item.uri, null)
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
            } ?: throw Unsupported("No video track")
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            val srcW = format.getInteger(MediaFormat.KEY_WIDTH)
            val srcH = format.getInteger(MediaFormat.KEY_HEIGHT)
            val (outW, outH) = HandBrake.fit(srcW, srcH)
            // HandBrake's "peak 30": keep the source frame rate unless it's above 30.
            val outFps = min(info.fps, HandBrake.MAX_FPS)
            val dropFrames = info.fps > HandBrake.MAX_FPS + 0.5
            val frameIntervalUs = (1_000_000 / HandBrake.MAX_FPS).toLong()

            val standard = if (format.containsKey(MediaFormat.KEY_COLOR_STANDARD)) format.getInteger(MediaFormat.KEY_COLOR_STANDARD) else 0
            val colorMatrix = when (standard) {
                MediaFormat.COLOR_STANDARD_BT709 -> 1
                MediaFormat.COLOR_STANDARD_BT601_PAL, MediaFormat.COLOR_STANDARD_BT601_NTSC -> 2
                else -> if (srcH >= 720 || srcW >= 1280) 1 else 0
            }
            val fullRange = format.containsKey(MediaFormat.KEY_COLOR_RANGE) &&
                format.getInteger(MediaFormat.KEY_COLOR_RANGE) == MediaFormat.COLOR_RANGE_FULL

            val enc = X264(outW, outH, (outFps * 1000).roundToInt(), 1000, HandBrake.RF, HandBrake.PRESET, HandBrake.PROFILE, HandBrake.LEVEL, colorMatrix, fullRange)
                .also { encoder = it }
            val (sps, pps) = enc.headers()

            val dec = MediaCodec.createDecoderByType(mime).also { decoder = it }
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            dec.configure(format, null, null, 0)
            dec.start()

            val mux = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4).also { muxer = it }
            if (info.rotation != 0) mux.setOrientationHint(info.rotation)
            val videoFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, outW, outH).apply {
                setByteBuffer("csd-0", ByteBuffer.wrap(sps))
                setByteBuffer("csd-1", ByteBuffer.wrap(pps))
            }
            val videoTrack = mux.addTrack(videoFormat)
            val audioTrack = audio?.let { mux.addTrack(it.format) }
            mux.start()
            muxerStarted = true
            val audioWriter = audio?.let { AudioWriter(it, audioFile, mux, audioTrack!!) }

            val packet = ByteBuffer.allocateDirect(outW * outH * 3 / 2 + (1 shl 20))
            val sample = MediaCodec.BufferInfo()
            fun write(p: X264.Packet) {
                audioWriter?.writeUntil(p.ptsUs)
                packet.position(0).limit(p.size)
                sample.set(0, p.size, p.ptsUs, if (p.keyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                mux.writeSampleData(videoTrack, packet, sample)
                packet.clear()
            }

            val decoded = MediaCodec.BufferInfo()
            val durationUs = max(1L, info.durationMs * 1000)
            var inputDone = false
            var outputDone = false
            var lastKept = Long.MIN_VALUE
            while (!outputDone) {
                coroutineContext.ensureActive()
                if (!inputDone) {
                    val i = dec.dequeueInputBuffer(TIMEOUT_US)
                    if (i >= 0) {
                        val size = extractor.readSampleData(dec.getInputBuffer(i)!!, 0)
                        if (size < 0) {
                            dec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            dec.queueInputBuffer(i, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val o = dec.dequeueOutputBuffer(decoded, TIMEOUT_US)
                if (o < 0) continue
                val pts = decoded.presentationTimeUs
                val keep = decoded.size > 0 && (!dropFrames || lastKept == Long.MIN_VALUE || pts - lastKept >= frameIntervalUs - 1000)
                if (keep) {
                    lastKept = pts
                    val image = dec.getOutputImage(o) ?: throw Unsupported("The decoder gave no picture")
                    image.use {
                        if (it.format != ImageFormat.YUV_420_888) throw Unsupported("This video's colour format isn't supported yet")
                        val crop = it.cropRect
                        val (yp, up, vp) = it.planes
                        val w = crop.width() and 1.inv()
                        val h = crop.height() and 1.inv()
                        enc.encode(
                            yp.buffer, crop.top * yp.rowStride + crop.left * yp.pixelStride, yp.rowStride,
                            up.buffer, (crop.top / 2) * up.rowStride + (crop.left / 2) * up.pixelStride,
                            vp.buffer, (crop.top / 2) * vp.rowStride + (crop.left / 2) * vp.pixelStride,
                            up.rowStride, up.pixelStride, w, h, pts, packet,
                        )?.let(::write)
                    }
                    onProgress(AUDIO_PROGRESS + (1 - AUDIO_PROGRESS) * (pts.toFloat() / durationUs).coerceIn(0f, 0.99f))
                }
                dec.releaseOutputBuffer(o, false)
                if (decoded.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
            }
            while (true) {
                coroutineContext.ensureActive()
                write(enc.flush(packet) ?: break)
            }
            audioWriter?.writeUntil(Long.MAX_VALUE)
            mux.stop()
            muxerStarted = false
            return outW to outH
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { encoder?.close() }
            if (muxerStarted) runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
            extractor.release()
            audioFile.delete()
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
                val transfer = if (f.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) f.getInteger(MediaFormat.KEY_COLOR_TRANSFER) else 0
                val hdr = transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer == MediaFormat.COLOR_TRANSFER_HLG
                return@runCatching Info(w, h, ((rotation % 360) + 360) % 360, fps, vbr, dur, mime, hdr)
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

/**
 * The audio, re-encoded to AAC 160 kbps stereo (HandBrake's preset) before the video starts, so the
 * MP4 can be written in one pass. Encoded frames wait in a temp file; [samples] says where each is.
 */
class AudioTrack(val format: MediaFormat, val samples: List<Sample>) {
    data class Sample(val size: Int, val ptsUs: Long, val flags: Int)

    companion object {
        private const val TIMEOUT_US = 10_000L

        /** Null when the video has no audio. */
        suspend fun prepare(ctx: Context, item: MediaItem, file: File, onProgress: (Float) -> Unit): AudioTrack? {
            val ex = MediaExtractor()
            var decoder: MediaCodec? = null
            var sink: AacSink? = null
            try {
                ex.setDataSource(ctx, item.uri, null)
                val track = (0 until ex.trackCount).firstOrNull {
                    ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
                } ?: return null
                ex.selectTrack(track)
                val inFormat = ex.getTrackFormat(track)
                val durationUs = if (inFormat.containsKey(MediaFormat.KEY_DURATION)) max(1L, inFormat.getLong(MediaFormat.KEY_DURATION)) else 1L
                val dec = MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!).also { decoder = it }
                dec.configure(inFormat, null, null, 0)
                dec.start()

                val decoded = MediaCodec.BufferInfo()
                var stereo = ByteArray(0)
                var inputDone = false
                while (true) {
                    coroutineContext.ensureActive()
                    if (!inputDone) {
                        val i = dec.dequeueInputBuffer(TIMEOUT_US)
                        if (i >= 0) {
                            val size = ex.readSampleData(dec.getInputBuffer(i)!!, 0)
                            if (size < 0) {
                                dec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                dec.queueInputBuffer(i, 0, size, ex.sampleTime, 0)
                                ex.advance()
                            }
                        }
                    }
                    val o = dec.dequeueOutputBuffer(decoded, TIMEOUT_US)
                    if (o < 0) continue
                    if (decoded.size > 0) {
                        val pcmFormat = dec.getOutputFormat(o)
                        val rate = pcmFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        val channels = pcmFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        val float = pcmFormat.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            pcmFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                        val s = sink ?: AacSink(rate, decoded.presentationTimeUs, file).also { sink = it }
                        val buf = dec.getOutputBuffer(o)!!
                        buf.position(decoded.offset).limit(decoded.offset + decoded.size)
                        val (pcm, n) = toStereo16(buf, channels, float, stereo)
                        stereo = pcm
                        s.queue(pcm, n)
                        onProgress((decoded.presentationTimeUs.toFloat() / durationUs).coerceIn(0f, 1f))
                    }
                    dec.releaseOutputBuffer(o, false)
                    if (decoded.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
                val s = sink ?: return null
                s.finish()
                return AudioTrack(s.format ?: error("The audio encoder gave no format"), s.samples)
            } finally {
                runCatching { decoder?.stop() }
                runCatching { decoder?.release() }
                sink?.release()
                ex.release()
            }
        }

        /**
         * Decoded PCM → interleaved 16-bit stereo (HandBrake's stereo mixdown): mono is doubled, and
         * more channels fold front left/right with the centre at -3 dB. Returns the buffer and its length.
         */
        private fun toStereo16(src: ByteBuffer, channels: Int, float: Boolean, reuse: ByteArray): Pair<ByteArray, Int> {
            val bytesPerSample = if (float) 4 else 2
            val ch = max(1, channels)
            val frames = src.remaining() / (bytesPerSample * ch)
            val out = if (reuse.size >= frames * 4) reuse else ByteArray(frames * 4)
            val le = src.order(ByteOrder.LITTLE_ENDIAN)
            val base = src.position()
            fun sampleAt(frame: Int, c: Int): Float {
                val idx = base + (frame * ch + c) * bytesPerSample
                return if (float) le.getFloat(idx) else le.getShort(idx) / 32768f
            }
            for (fr in 0 until frames) {
                val l: Float
                val r: Float
                when {
                    ch == 1 -> { l = sampleAt(fr, 0); r = l }
                    ch == 2 -> { l = sampleAt(fr, 0); r = sampleAt(fr, 1) }
                    else -> {
                        val c = sampleAt(fr, 2) * 0.7071f
                        l = sampleAt(fr, 0) + c
                        r = sampleAt(fr, 1) + c
                    }
                }
                val li = (l.coerceIn(-1f, 1f) * 32767).toInt()
                val ri = (r.coerceIn(-1f, 1f) * 32767).toInt()
                val o = fr * 4
                out[o] = li.toByte(); out[o + 1] = (li shr 8).toByte()
                out[o + 2] = ri.toByte(); out[o + 3] = (ri shr 8).toByte()
            }
            return out to frames * 4
        }
    }
}

/** The AAC encoder and the temp file its frames go to. */
private class AacSink(private val sampleRate: Int, private val firstPtsUs: Long, file: File) {
    private val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).apply {
        val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, 2).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, HandBrake.AUDIO_BITRATE)
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
        }
        configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        start()
    }
    private val out = FileOutputStream(file)
    private val info = MediaCodec.BufferInfo()
    private var framesQueued = 0L
    private var done = false
    val samples = ArrayList<AudioTrack.Sample>()
    var format: MediaFormat? = null
        private set

    private fun ptsNow() = firstPtsUs + framesQueued * 1_000_000L / sampleRate

    /** Hands 16-bit stereo PCM to the encoder, split to fit its input buffers. */
    fun queue(pcm: ByteArray, length: Int) {
        var offset = 0
        while (offset < length) {
            val i = codec.dequeueInputBuffer(TIMEOUT_US)
            if (i < 0) {
                drain(0)
                continue
            }
            val buf = codec.getInputBuffer(i)!!
            val n = min(buf.remaining(), length - offset) and 3.inv()
            buf.put(pcm, offset, n)
            codec.queueInputBuffer(i, 0, n, ptsNow(), 0)
            framesQueued += n / 4
            offset += n
            drain(0)
        }
    }

    fun finish() {
        while (true) {
            val i = codec.dequeueInputBuffer(TIMEOUT_US)
            if (i >= 0) {
                codec.queueInputBuffer(i, 0, 0, ptsNow(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                break
            }
            drain(0)
        }
        while (!done) drain(TIMEOUT_US)
        out.close()
    }

    private fun drain(timeoutUs: Long) {
        var wait = timeoutUs
        while (!done) {
            val o = codec.dequeueOutputBuffer(info, wait)
            wait = 0
            if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                format = codec.outputFormat
                continue
            }
            if (o < 0) return
            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) {
                val buf = codec.getOutputBuffer(o)!!
                val bytes = ByteArray(info.size)
                buf.position(info.offset)
                buf.get(bytes)
                out.write(bytes)
                samples += AudioTrack.Sample(info.size, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM.inv())
            }
            codec.releaseOutputBuffer(o, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) done = true
        }
    }

    fun release() {
        runCatching { out.close() }
        runCatching { codec.stop() }
        runCatching { codec.release() }
    }

    private companion object {
        const val TIMEOUT_US = 10_000L
    }
}

/** Feeds the prepared audio into the MP4 alongside the video, in time order. */
private class AudioWriter(private val audio: AudioTrack, file: File, private val muxer: MediaMuxer, private val track: Int) {
    private val input = FileInputStream(file).buffered()
    private var next = 0
    private var buffer = ByteBuffer.allocate(8192)
    private val info = MediaCodec.BufferInfo()

    fun writeUntil(ptsUs: Long) {
        while (next < audio.samples.size && audio.samples[next].ptsUs <= ptsUs) {
            val s = audio.samples[next++]
            if (buffer.capacity() < s.size) buffer = ByteBuffer.allocate(s.size)
            buffer.clear()
            var read = 0
            while (read < s.size) {
                val n = input.read(buffer.array(), read, s.size - read)
                if (n < 0) break
                read += n
            }
            buffer.limit(read)
            info.set(0, read, s.ptsUs, s.flags)
            muxer.writeSampleData(track, buffer, info)
        }
        if (next >= audio.samples.size) runCatching { input.close() }
    }
}
