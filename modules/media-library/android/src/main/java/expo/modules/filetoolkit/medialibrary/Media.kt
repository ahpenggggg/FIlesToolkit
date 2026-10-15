package expo.modules.filetoolkit.medialibrary

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.MediaStore

data class MediaItem(
    val id: Long,
    val uri: Uri,
    val isVideo: Boolean,
    val name: String,
    val size: Long,
    val width: Int,
    val height: Int,
    val dateTaken: Long,      // ms, may be 0
    val dateModified: Long,   // seconds
    val durationMs: Long,
    /** Folder key: the file's real parent directory, e.g. "/storage/emulated/0/Download/Saved/Saved". */
    val dir: String,
    val mime: String = "",
    val relativePath: String? = null,
    val volume: String? = null,
) {
    val folderName: String get() = dir.substringAfterLast('/').ifEmpty { dir }
}

/**
 * One real directory. Folders are keyed by full path — NOT MediaStore's BUCKET_ID / BUCKET_DISPLAY_NAME,
 * which merge or mislabel same-named nested folders (Download/Saved vs Download/Saved/Saved) on some devices.
 */
data class MediaFolder(
    val path: String,          // absolute, the key
    val displayPath: String,   // relative to storage root, e.g. "Download/Saved/Saved"
    val name: String,
    val depth: Int,            // 0 = top-level folder in storage
    val photoCount: Int,       // directly inside this folder
    val videoCount: Int,
    val totalPhotos: Int,      // including all subfolders
    val totalVideos: Int,
) {
    val ownCount get() = photoCount + videoCount
    val totalCount get() = totalPhotos + totalVideos
}

/** Which folders to scan. Empty [paths] = everything. */
data class FolderFilter(val paths: Set<String>, val includeSubfolders: Boolean) {
    fun matches(dir: String): Boolean {
        if (paths.isEmpty()) return true
        if (dir in paths) return true
        if (!includeSubfolders) return false
        return paths.any { dir.startsWith("$it/") }
    }
}

object MediaScanner {

    private val imagesUri: Uri get() = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
    private val videosUri: Uri get() = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)

    @Suppress("DEPRECATION")
    private val DATA = MediaStore.MediaColumns.DATA

    private val STORAGE_ROOT = Regex("^(/storage/emulated/\\d+|/storage/[^/]+|/sdcard|/mnt/[^/]+/[^/]+)")

    fun storageRoot(path: String): String? = STORAGE_ROOT.find(path)?.value

    fun displayPath(dir: String): String {
        val root = storageRoot(dir) ?: return dir
        val rel = dir.removePrefix(root).trimStart('/')
        val volume = if (root.startsWith("/storage/emulated")) "" else root.substringAfterLast('/') + ": "
        return volume + rel.ifEmpty { "(storage root)" }
    }

    fun query(context: Context, photos: Boolean, videos: Boolean, filter: FolderFilter): List<MediaItem> {
        val out = ArrayList<MediaItem>()
        if (photos) queryCollection(context, imagesUri, false, out)
        if (videos) queryCollection(context, videosUri, true, out)
        return if (filter.paths.isEmpty()) out else out.filter { filter.matches(it.dir) }
    }

    /** All folders holding media, plus their parent folders (so a whole tree can be picked), sorted as a tree. */
    fun listFolders(context: Context): List<MediaFolder> {
        class Acc(var photos: Int = 0, var videos: Int = 0)
        val own = HashMap<String, Acc>()
        for ((uri, isVideo) in listOf(imagesUri to false, videosUri to true)) {
            val proj = arrayOf(DATA, MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.VOLUME_NAME)
            context.contentResolver.query(uri, proj, null, null, null)?.use { c ->
                val ix = Indexes(c)
                while (c.moveToNext()) {
                    val dir = dirOf(c, ix) ?: continue
                    val a = own.getOrPut(dir) { Acc() }
                    if (isVideo) a.videos++ else a.photos++
                }
            }
        }

        // Add ancestor folders up to (not including) the storage root.
        val all = HashMap<String, Acc>()
        for ((dir, a) in own) all[dir] = Acc(a.photos, a.videos)
        for (dir in own.keys) {
            val root = storageRoot(dir) ?: continue
            var p = dir.substringBeforeLast('/', "")
            while (p.length > root.length && p.startsWith(root)) {
                all.getOrPut(p) { Acc() }
                p = p.substringBeforeLast('/', "")
            }
        }

        return all.keys.map { path ->
            val o = all.getValue(path)
            var tp = 0
            var tv = 0
            for ((d, a) in own) if (d == path || d.startsWith("$path/")) { tp += a.photos; tv += a.videos }
            val root = storageRoot(path)
            val depth = if (root == null) 0 else path.removePrefix(root).trim('/').count { it == '/' }
            MediaFolder(
                path = path,
                displayPath = displayPath(path),
                name = path.substringAfterLast('/').ifEmpty { path },
                depth = depth,
                photoCount = o.photos,
                videoCount = o.videos,
                totalPhotos = tp,
                totalVideos = tv,
            )
        }.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.path.replace('/', '\u0001') })
    }

    private class Indexes(c: Cursor) {
        val data = c.getColumnIndex(DATA)
        val rel = c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
        val vol = c.getColumnIndex(MediaStore.MediaColumns.VOLUME_NAME)
    }

    /** Real parent directory. Prefer the absolute file path; fall back to volume + RELATIVE_PATH. */
    private fun dirOf(c: Cursor, ix: Indexes): String? {
        if (ix.data >= 0) {
            val data = c.getString(ix.data)
            if (!data.isNullOrEmpty() && data.contains('/')) return data.substringBeforeLast('/')
        }
        if (ix.rel >= 0) {
            val rel = c.getString(ix.rel)?.trim('/') ?: return null
            val vol = if (ix.vol >= 0) c.getString(ix.vol) else null
            val root = if (vol == null || vol == MediaStore.VOLUME_EXTERNAL_PRIMARY) "/storage/emulated/0" else "/storage/$vol"
            return if (rel.isEmpty()) root else "$root/$rel"
        }
        return null
    }

    private fun queryCollection(context: Context, collection: Uri, isVideo: Boolean, out: MutableList<MediaItem>) {
        val proj = mutableListOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.DATE_TAKEN,
            MediaStore.MediaColumns.DATE_MODIFIED,
            DATA,
            MediaStore.MediaColumns.RELATIVE_PATH,
            MediaStore.MediaColumns.VOLUME_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
        )
        if (isVideo) proj += MediaStore.MediaColumns.DURATION

        context.contentResolver.query(
            collection, proj.toTypedArray(), null, null,
            "${MediaStore.MediaColumns.DATE_ADDED} DESC",
        )?.use { c ->
            val ix = Indexes(c)
            val iId = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val iName = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val iSize = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
            val iW = c.getColumnIndexOrThrow(MediaStore.MediaColumns.WIDTH)
            val iH = c.getColumnIndexOrThrow(MediaStore.MediaColumns.HEIGHT)
            val iTaken = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_TAKEN)
            val iMod = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
            val iDur = if (isVideo) c.getColumnIndexOrThrow(MediaStore.MediaColumns.DURATION) else -1
            val iMime = c.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            while (c.moveToNext()) {
                val size = c.getLong(iSize)
                if (size <= 0) continue
                val dir = dirOf(c, ix) ?: continue
                val id = c.getLong(iId)
                out += MediaItem(
                    id = id,
                    uri = ContentUris.withAppendedId(collection, id),
                    isVideo = isVideo,
                    name = c.getString(iName) ?: "",
                    size = size,
                    width = c.getInt(iW),
                    height = c.getInt(iH),
                    dateTaken = c.getLong(iTaken),
                    dateModified = c.getLong(iMod),
                    durationMs = if (iDur >= 0) c.getLong(iDur) else 0L,
                    dir = dir,
                    mime = c.getString(iMime) ?: "",
                    relativePath = if (ix.rel >= 0) c.getString(ix.rel) else null,
                    volume = if (ix.vol >= 0) c.getString(ix.vol) else null,
                )
            }
        }
    }
}
