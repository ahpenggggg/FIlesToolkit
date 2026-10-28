package expo.modules.filetoolkit.cleaner

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.io.File
import java.nio.file.Files

/** Why an item can be cleaned. Keep the keys in step with CleanKind in engine.ts. */
enum class Kind(val key: String) {
    /** A folder in Android/media of an app that is no longer installed. */
    ORPHAN_APP("orphanApp"),
    /** ".trashed-…" files whose 30 days in Trash ran out but that the system never removed. */
    EXPIRED_TRASH("expiredTrash"),
    /** ".pending-…" files an app started saving and never finished, past their expiry. */
    EXPIRED_PENDING("expiredPending"),
    /** .tmp files and unfinished downloads. */
    TEMP("temp"),
    /** 0-byte files. */
    EMPTY_FILE("emptyFile"),
    /** Folders without a single file inside, at any depth. */
    EMPTY_FOLDER("emptyFolder");

    companion object {
        fun of(key: String): Kind = entries.firstOrNull { it.key == key } ?: throw IllegalArgumentException("Unknown kind $key")
    }
}

/**
 * What counts as safe to clean. The same checks run when scanning and again just before deleting,
 * so nothing that changed in between (a folder that got a file, an app that was reinstalled) goes.
 * Paths are checked relative to their storage volume: "Download/a.tmp", "Android/media/com.app".
 */
object Rules {
    /** Untouched for at least this long: a younger file may still be in use (a download, a copy). */
    const val MIN_AGE_MS = 24 * 60 * 60 * 1000L

    private val TEMP_EXTENSIONS = setOf("tmp", "temp", "crdownload", "part", "partial")

    /** MediaStore's stand-ins: ".trashed-<expiry>-name" and ".pending-<expiry>-name", expiry in seconds. */
    private val EXPIRING = Regex("""^\.(pending|trashed)-(\d+)-.+""")

    private val PACKAGE = Regex("""^[A-Za-z]\w*(\.[A-Za-z]\w*)+$""")

    /** Folders apps and the system expect to find, even when empty. */
    private val STANDARD_FOLDERS = setOf(
        "Alarms", "Audiobooks", "DCIM", "Documents", "Download", "Movies", "Music", "Notifications",
        "Pictures", "Podcasts", "Recordings", "Ringtones", "DCIM/Camera", "Pictures/Screenshots",
    )

    /** Apps' own folders: only their leftovers (ORPHAN_APP) are ever touched in here. */
    fun isAppArea(rel: String) = rel == "Android" || rel.startsWith("Android/")

    /** Inside a hidden folder ("…/.cache/…"), where only MediaStore's expired files are touched. */
    fun inHiddenFolder(rel: String) = rel.split('/').dropLast(1).any { it.startsWith(".") }

    fun isLink(file: File) = Files.isSymbolicLink(file.toPath())

    /** Why [file] (a file, not a folder) can be cleaned, or null. */
    fun fileKind(file: File, inHidden: Boolean, now: Long): Kind? {
        val name = file.name
        EXPIRING.matchEntire(name)?.let { match ->
            val expires = match.groupValues[2].toLongOrNull() ?: return null
            if (expires * 1000 >= now) return null
            return if (match.groupValues[1] == "trashed") Kind.EXPIRED_TRASH else Kind.EXPIRED_PENDING
        }
        if (inHidden || name.startsWith(".")) return null
        if (now - file.lastModified() < MIN_AGE_MS) return null
        if (name.substringAfterLast('.', "").lowercase() in TEMP_EXTENSIONS) return Kind.TEMP
        if (file.length() == 0L) return Kind.EMPTY_FILE
        return null
    }

    /** Whether an empty folder at [rel] may go: not hidden, not a standard or app folder, and not new. */
    fun mayRemoveEmptyFolder(dir: File, rel: String, inHidden: Boolean, now: Long): Boolean =
        rel.isNotEmpty() &&
            !inHidden &&
            !dir.name.startsWith(".") &&
            !isAppArea(rel) &&
            rel !in STANDARD_FOLDERS &&
            now - dir.lastModified() >= MIN_AGE_MS

    /** Whether [dir] holds no file at any depth. Links and unreadable folders count as files. */
    fun hasNoFiles(dir: File): Boolean {
        val entries = dir.listFiles() ?: return false
        return entries.all { it.isDirectory && !isLink(it) && hasNoFiles(it) }
    }

    /** The package [rel] is the media folder of ("Android/media/<package>"), or null. */
    fun mediaFolderPackage(rel: String): String? {
        val parts = rel.split('/')
        if (parts.size != 3 || parts[0] != "Android" || parts[1] != "media") return null
        return parts[2].takeIf { PACKAGE.matches(it) }
    }

    /**
     * Whether every installed app can be seen. Android hides other apps unless QUERY_ALL_PACKAGES is
     * granted; without it any app would look uninstalled, so leftovers are not looked for at all.
     */
    fun canSeeAllApps(ctx: Context) =
        ctx.checkSelfPermission(android.Manifest.permission.QUERY_ALL_PACKAGES) == PackageManager.PERMISSION_GRANTED

    /** Whether [pkg] is installed, counting apps removed with "keep data" as installed. */
    fun isInstalled(ctx: Context, pkg: String): Boolean {
        val pm = ctx.packageManager
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(pkg, PackageManager.MATCH_UNINSTALLED_PACKAGES)
            }
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    /** Whether [rel] is the media folder of an app that is gone. */
    fun isOrphanApp(ctx: Context, rel: String): Boolean {
        val pkg = mediaFolderPackage(rel) ?: return false
        return pkg != ctx.packageName && canSeeAllApps(ctx) && !isInstalled(ctx, pkg)
    }
}
