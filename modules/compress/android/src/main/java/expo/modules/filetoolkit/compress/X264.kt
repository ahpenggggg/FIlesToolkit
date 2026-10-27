package expo.modules.filetoolkit.compress

import java.nio.ByteBuffer

/** x264 through JNI (src/main/cpp/x264_bridge.c). One instance encodes one video. */
class X264(width: Int, height: Int, fpsNum: Int, fpsDen: Int, crf: Float, preset: String, profile: String, level: Int, colorMatrix: Int, fullRange: Boolean) :
    AutoCloseable {
    private var handle = nativeOpen(width, height, fpsNum, fpsDen, crf, preset, profile, level, colorMatrix, fullRange)

    init {
        check(handle != 0L) { "Couldn't start the H.264 encoder" }
    }

    /** SPS and PPS with start codes: the MP4 track's csd-0 and csd-1. */
    fun headers(): Pair<ByteArray, ByteArray> {
        val h = nativeHeaders(handle) ?: error("Encoder headers unavailable")
        return h[0] to h[1]
    }

    /** One encoded frame: [size] bytes in the output buffer. */
    data class Packet(val size: Int, val ptsUs: Long, val keyFrame: Boolean)

    private val meta = LongArray(3)

    /** Encodes a decoded frame; null while x264 is still holding frames back (for B-frames). */
    fun encode(
        y: ByteBuffer, yOffset: Int, yRowStride: Int,
        u: ByteBuffer, uOffset: Int, v: ByteBuffer, vOffset: Int, uvRowStride: Int, uvPixelStride: Int,
        width: Int, height: Int, ptsUs: Long, out: ByteBuffer,
    ): Packet? {
        val n = nativeEncode(handle, y, yOffset, yRowStride, u, uOffset, v, vOffset, uvRowStride, uvPixelStride, width, height, ptsUs, out, meta)
        check(n >= 0) { "H.264 encoding failed" }
        return if (n == 0) null else Packet(n, meta[0], meta[2] == 1L)
    }

    /** The frames still held back after the last input, one at a time; null when done. */
    fun flush(out: ByteBuffer): Packet? {
        val n = nativeFlush(handle, out, meta)
        check(n >= 0) { "H.264 encoding failed" }
        return if (n == 0) null else Packet(n, meta[0], meta[2] == 1L)
    }

    override fun close() {
        if (handle != 0L) nativeClose(handle)
        handle = 0L
    }

    private companion object {
        init {
            System.loadLibrary("ftx264")
        }

        @JvmStatic external fun nativeOpen(
            width: Int, height: Int, fpsNum: Int, fpsDen: Int, crf: Float, preset: String, profile: String, level: Int, colorMatrix: Int, fullRange: Boolean,
        ): Long

        @JvmStatic external fun nativeHeaders(handle: Long): Array<ByteArray>?

        @JvmStatic external fun nativeEncode(
            handle: Long, y: ByteBuffer, yOffset: Int, yRowStride: Int, u: ByteBuffer, uOffset: Int, v: ByteBuffer, vOffset: Int,
            uvRowStride: Int, uvPixelStride: Int, width: Int, height: Int, ptsUs: Long, out: ByteBuffer, meta: LongArray,
        ): Int

        @JvmStatic external fun nativeFlush(handle: Long, out: ByteBuffer, meta: LongArray): Int

        @JvmStatic external fun nativeClose(handle: Long)
    }
}
