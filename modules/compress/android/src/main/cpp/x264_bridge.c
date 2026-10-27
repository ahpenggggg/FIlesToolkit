// JNI bridge to x264: HandBrake's H.264 encoder, used here with HandBrake's settings.
// Frames arrive as the decoder's YUV 4:2:0 planes (planar or semi-planar); they are scaled to the
// output size with a separable Lanczos-3 filter (what HandBrake uses) and encoded at constant quality.
#include <jni.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "x264.h"

#define FILTER_BITS 14
#define LANCZOS_A 3

/** One resampling direction: for each output pixel, the first source pixel and its weights. */
typedef struct {
  int dst;
  int taps;
  int *start;     // [dst]
  int16_t *coef;  // [dst * taps]
} Filter;

typedef struct {
  x264_t *enc;
  x264_picture_t pic;
  int width, height;
  // Scalers, built for the source size on the first frame.
  int srcW, srcH;
  int identity;
  Filter hY, vY, hC, vC;
  uint8_t *tmp;  // horizontal pass output: srcH rows of dstW
} Encoder;

static double lanczos(double x) {
  if (x == 0) return 1.0;
  if (x <= -LANCZOS_A || x >= LANCZOS_A) return 0.0;
  double px = M_PI * x;
  return LANCZOS_A * sin(px) * sin(px / LANCZOS_A) / (px * px);
}

/** Lanczos-3 from [src] to [dst] pixels; when shrinking, the kernel widens so it also low-pass filters. */
static int filter_init(Filter *f, int src, int dst) {
  double scale = (double)src / dst;
  double support = LANCZOS_A * (scale > 1 ? scale : 1);
  double stretch = scale > 1 ? scale : 1;
  f->dst = dst;
  f->taps = (int)ceil(support) * 2 + 1;
  if (f->taps > src) f->taps = src;  // never read past a tiny source
  if (f->taps > 63) f->taps = 63;
  f->start = malloc(sizeof(int) * dst);
  f->coef = malloc(sizeof(int16_t) * dst * f->taps);
  double *w = malloc(sizeof(double) * f->taps);
  if (!f->start || !f->coef || !w) {
    free(w);
    return -1;
  }
  for (int i = 0; i < dst; i++) {
    double center = (i + 0.5) * scale - 0.5;
    int first = (int)floor(center - support) + 1;
    double sum = 0;
    for (int k = 0; k < f->taps; k++) {
      w[k] = lanczos((first + k - center) / stretch);
      sum += w[k];
    }
    // Edge pixels repeat, so weights that fall outside the source fold onto the first/last pixel.
    int start = first < 0 ? 0 : first;
    if (start > src - f->taps) start = src - f->taps > 0 ? src - f->taps : 0;
    int16_t *c = f->coef + (size_t)i * f->taps;
    double acc[64] = {0};
    int n = f->taps < 64 ? f->taps : 64;
    for (int k = 0; k < f->taps; k++) {
      int s = first + k;
      if (s < 0) s = 0;
      if (s > src - 1) s = src - 1;
      int slot = s - start;
      if (slot < 0) slot = 0;
      if (slot >= n) slot = n - 1;
      acc[slot] += w[k] / sum;
    }
    int total = 0;
    for (int k = 0; k < f->taps; k++) {
      c[k] = k < n ? (int16_t)lrint(acc[k] * (1 << FILTER_BITS)) : 0;
      total += c[k];
    }
    // Rounding can leave the weights a little off 1.0; put the remainder on the centre tap.
    int mid = (int)lrint(center) - start;
    if (mid < 0) mid = 0;
    if (mid >= f->taps) mid = f->taps - 1;
    c[mid] += (1 << FILTER_BITS) - total;
    f->start[i] = start;
  }
  free(w);
  return 0;
}

static void filter_free(Filter *f) {
  free(f->start);
  free(f->coef);
  f->start = NULL;
  f->coef = NULL;
}

static inline uint8_t clip8(int v) {
  v = (v + (1 << (FILTER_BITS - 1))) >> FILTER_BITS;
  return v < 0 ? 0 : v > 255 ? 255 : (uint8_t)v;
}

/** Scales one plane: [src] has [pixelStride] bytes between pixels (2 for interleaved chroma). */
static void scale_plane(const Filter *h, const Filter *v, uint8_t *tmp, const uint8_t *src, int srcH, int rowStride,
                        int pixelStride, uint8_t *dst, int dstStride) {
  int dstW = h->dst;
  for (int y = 0; y < srcH; y++) {
    const uint8_t *row = src + (size_t)y * rowStride;
    uint8_t *out = tmp + (size_t)y * dstW;
    for (int x = 0; x < dstW; x++) {
      const int16_t *c = h->coef + (size_t)x * h->taps;
      const uint8_t *p = row + (size_t)h->start[x] * pixelStride;
      int sum = 0;
      for (int k = 0; k < h->taps; k++) sum += c[k] * p[k * pixelStride];
      out[x] = clip8(sum);
    }
  }
  for (int y = 0; y < v->dst; y++) {
    const int16_t *c = v->coef + (size_t)y * v->taps;
    const uint8_t *base = tmp + (size_t)v->start[y] * dstW;
    uint8_t *out = dst + (size_t)y * dstStride;
    for (int x = 0; x < dstW; x++) {
      int sum = 0;
      for (int k = 0; k < v->taps; k++) sum += c[k] * base[(size_t)k * dstW + x];
      out[x] = clip8(sum);
    }
  }
}

/** Same size: copy (and de-interleave chroma when [pixelStride] is 2). */
static void copy_plane(const uint8_t *src, int w, int h, int rowStride, int pixelStride, uint8_t *dst, int dstStride) {
  for (int y = 0; y < h; y++) {
    const uint8_t *row = src + (size_t)y * rowStride;
    uint8_t *out = dst + (size_t)y * dstStride;
    if (pixelStride == 1) {
      memcpy(out, row, w);
    } else {
      for (int x = 0; x < w; x++) out[x] = row[(size_t)x * pixelStride];
    }
  }
}

static void scalers_free(Encoder *e) {
  filter_free(&e->hY);
  filter_free(&e->vY);
  filter_free(&e->hC);
  filter_free(&e->vC);
  free(e->tmp);
  e->tmp = NULL;
  e->srcW = e->srcH = 0;
}

static int scalers_init(Encoder *e, int srcW, int srcH) {
  scalers_free(e);
  e->srcW = srcW;
  e->srcH = srcH;
  e->identity = srcW == e->width && srcH == e->height;
  if (e->identity) return 0;
  if (filter_init(&e->hY, srcW, e->width) || filter_init(&e->vY, srcH, e->height) ||
      filter_init(&e->hC, (srcW + 1) / 2, e->width / 2) || filter_init(&e->vC, (srcH + 1) / 2, e->height / 2))
    return -1;
  e->tmp = malloc((size_t)srcH * e->width);
  return e->tmp ? 0 : -1;
}

/** Writes x264's NAL units (Annex B, with start codes) into [out]; returns the byte count or -1 if it doesn't fit. */
static int write_nals(x264_nal_t *nal, int count, uint8_t *out, jlong cap) {
  int size = 0;
  for (int i = 0; i < count; i++) size += nal[i].i_payload;
  if (size > cap) return -1;
  // x264 lays the payloads out back to back, so one copy is enough.
  if (count > 0) memcpy(out, nal[0].p_payload, size);
  return size;
}

static int finish_output(JNIEnv *env, x264_picture_t *out, x264_nal_t *nal, int nals, int frameSize, jobject outBuf,
                         jlongArray meta) {
  if (frameSize <= 0 || nals <= 0) return 0;
  uint8_t *dst = (*env)->GetDirectBufferAddress(env, outBuf);
  jlong cap = (*env)->GetDirectBufferCapacity(env, outBuf);
  int n = write_nals(nal, nals, dst, cap);
  if (n < 0) return -1;
  jlong m[3] = {out->i_pts, out->i_dts, out->b_keyframe ? 1 : 0};
  (*env)->SetLongArrayRegion(env, meta, 0, 3, m);
  return n;
}

JNIEXPORT jlong JNICALL Java_expo_modules_filetoolkit_compress_X264_nativeOpen(JNIEnv *env, jclass cls, jint width,
                                                                               jint height, jint fpsNum, jint fpsDen,
                                                                               jfloat crf, jstring preset,
                                                                               jstring profile, jint level,
                                                                               jint colorMatrix, jboolean fullRange) {
  x264_param_t p;
  const char *presetName = (*env)->GetStringUTFChars(env, preset, NULL);
  int bad = x264_param_default_preset(&p, presetName, NULL);
  (*env)->ReleaseStringUTFChars(env, preset, presetName);
  if (bad) return 0;

  p.i_width = width;
  p.i_height = height;
  p.i_csp = X264_CSP_I420;
  p.i_fps_num = fpsNum;
  p.i_fps_den = fpsDen;
  // Phone videos have variable frame timing: pass real timestamps in microseconds.
  p.b_vfr_input = 1;
  p.i_timebase_num = 1;
  p.i_timebase_den = 1000000;
  p.rc.i_rc_method = X264_RC_CRF;
  p.rc.f_rf_constant = crf;
  // HandBrake: a keyframe at least every 10 s, and no closer than 1 s apart.
  int fps = fpsDen > 0 ? (fpsNum + fpsDen / 2) / fpsDen : 30;
  if (fps < 1) fps = 30;
  p.i_keyint_max = fps * 10;
  p.i_keyint_min = fps;
  p.i_threads = X264_THREADS_AUTO;
  p.b_annexb = 1;
  p.b_repeat_headers = 0;
  p.i_log_level = X264_LOG_NONE;
  if (level > 0) p.i_level_idc = level;
  if (colorMatrix == 1) {  // BT.709
    p.vui.i_colorprim = 1;
    p.vui.i_transfer = 1;
    p.vui.i_colmatrix = 1;
  } else if (colorMatrix == 2) {  // BT.601
    p.vui.i_colorprim = 6;
    p.vui.i_transfer = 6;
    p.vui.i_colmatrix = 6;
  }
  p.vui.b_fullrange = fullRange ? 1 : 0;

  const char *profileName = (*env)->GetStringUTFChars(env, profile, NULL);
  bad = x264_param_apply_profile(&p, profileName);
  (*env)->ReleaseStringUTFChars(env, profile, profileName);
  if (bad) return 0;

  Encoder *e = calloc(1, sizeof(Encoder));
  if (!e) return 0;
  e->width = width;
  e->height = height;
  e->enc = x264_encoder_open(&p);
  if (!e->enc || x264_picture_alloc(&e->pic, X264_CSP_I420, width, height) < 0) {
    if (e->enc) x264_encoder_close(e->enc);
    free(e);
    return 0;
  }
  return (jlong)(intptr_t)e;
}

/** SPS and PPS, each with its start code, for the MP4 track's codec config. */
JNIEXPORT jobjectArray JNICALL Java_expo_modules_filetoolkit_compress_X264_nativeHeaders(JNIEnv *env, jclass cls,
                                                                                         jlong handle) {
  Encoder *e = (Encoder *)(intptr_t)handle;
  x264_nal_t *nal;
  int count;
  if (x264_encoder_headers(e->enc, &nal, &count) < 0) return NULL;
  jclass byteArray = (*env)->FindClass(env, "[B");
  jobjectArray result = (*env)->NewObjectArray(env, 2, byteArray, NULL);
  for (int i = 0; i < count; i++) {
    int slot = nal[i].i_type == NAL_SPS ? 0 : nal[i].i_type == NAL_PPS ? 1 : -1;
    if (slot < 0) continue;
    jbyteArray arr = (*env)->NewByteArray(env, nal[i].i_payload);
    (*env)->SetByteArrayRegion(env, arr, 0, nal[i].i_payload, (const jbyte *)nal[i].p_payload);
    (*env)->SetObjectArrayElement(env, result, slot, arr);
  }
  return result;
}

/**
 * Encodes one decoded frame. The planes are the decoder's (crop applied by the caller's offsets).
 * Returns the bytes written to [outBuf] (0 while x264 is still buffering frames, -1 on error) and fills
 * [meta] with pts, dts (µs) and keyframe.
 */
JNIEXPORT jint JNICALL Java_expo_modules_filetoolkit_compress_X264_nativeEncode(
    JNIEnv *env, jclass cls, jlong handle, jobject yBuf, jint yOffset, jint yRowStride, jobject uBuf, jint uOffset,
    jobject vBuf, jint vOffset, jint uvRowStride, jint uvPixelStride, jint srcW, jint srcH, jlong ptsUs, jobject outBuf,
    jlongArray meta) {
  Encoder *e = (Encoder *)(intptr_t)handle;
  if ((srcW != e->srcW || srcH != e->srcH) && scalers_init(e, srcW, srcH) < 0) return -1;
  const uint8_t *y = (const uint8_t *)(*env)->GetDirectBufferAddress(env, yBuf) + yOffset;
  const uint8_t *u = (const uint8_t *)(*env)->GetDirectBufferAddress(env, uBuf) + uOffset;
  const uint8_t *v = (const uint8_t *)(*env)->GetDirectBufferAddress(env, vBuf) + vOffset;
  x264_image_t *img = &e->pic.img;
  int cw = e->width / 2, ch = e->height / 2;
  if (e->identity) {
    copy_plane(y, e->width, e->height, yRowStride, 1, img->plane[0], img->i_stride[0]);
    copy_plane(u, cw, ch, uvRowStride, uvPixelStride, img->plane[1], img->i_stride[1]);
    copy_plane(v, cw, ch, uvRowStride, uvPixelStride, img->plane[2], img->i_stride[2]);
  } else {
    scale_plane(&e->hY, &e->vY, e->tmp, y, srcH, yRowStride, 1, img->plane[0], img->i_stride[0]);
    scale_plane(&e->hC, &e->vC, e->tmp, u, (srcH + 1) / 2, uvRowStride, uvPixelStride, img->plane[1], img->i_stride[1]);
    scale_plane(&e->hC, &e->vC, e->tmp, v, (srcH + 1) / 2, uvRowStride, uvPixelStride, img->plane[2], img->i_stride[2]);
  }
  e->pic.i_pts = ptsUs;
  e->pic.i_type = X264_TYPE_AUTO;
  x264_picture_t out;
  x264_nal_t *nal;
  int nals;
  int size = x264_encoder_encode(e->enc, &nal, &nals, &e->pic, &out);
  if (size < 0) return -1;
  return finish_output(env, &out, nal, nals, size, outBuf, meta);
}

/** Drains frames x264 still holds after the last input; returns 0 when none are left. */
JNIEXPORT jint JNICALL Java_expo_modules_filetoolkit_compress_X264_nativeFlush(JNIEnv *env, jclass cls, jlong handle,
                                                                               jobject outBuf, jlongArray meta) {
  Encoder *e = (Encoder *)(intptr_t)handle;
  while (x264_encoder_delayed_frames(e->enc) > 0) {
    x264_picture_t out;
    x264_nal_t *nal;
    int nals;
    int size = x264_encoder_encode(e->enc, &nal, &nals, NULL, &out);
    if (size < 0) return -1;
    if (size > 0) return finish_output(env, &out, nal, nals, size, outBuf, meta);
  }
  return 0;
}

JNIEXPORT void JNICALL Java_expo_modules_filetoolkit_compress_X264_nativeClose(JNIEnv *env, jclass cls, jlong handle) {
  Encoder *e = (Encoder *)(intptr_t)handle;
  if (!e) return;
  scalers_free(e);
  x264_picture_clean(&e->pic);
  x264_encoder_close(e->enc);
  free(e);
}
