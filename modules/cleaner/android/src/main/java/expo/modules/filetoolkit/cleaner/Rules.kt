package expo.modules.filetoolkit.cleaner

import android.content.Context
import android.content.pm.PackageInfo
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
    /** App installer files (.apk, .apks, .xapk, .apkm) left after installing. */
    APK("apk"),
    /** Files Windows and macOS leave behind (Thumbs.db, desktop.ini, .DS_Store, ._name) and __MACOSX folders. */
    COMPUTER_JUNK("computerJunk"),
    /** Log and crash files (.log, .dmp, .trace) and bug reports in Download. */
    LOG("log"),
    /** Editor and backup leftovers (name~, .bak, .old, .swp). */
    BACKUP("backup"),
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

    /** APKs only need to be left alone for a few minutes: long enough for a copy or an install to finish. */
    const val APK_MIN_AGE_MS = 10 * 60 * 1000L

    /** Also unfinished torrent downloads: qBittorrent (.!qB), µTorrent (.!ut), BitComet (.bc!), aria2 (.aria2). */
    private val TEMP_EXTENSIONS = setOf("tmp", "temp", "crdownload", "part", "partial", "!qb", "!ut", "bc!", "aria2")

    /** Left by Windows and macOS when files are copied from a computer; matched ignoring case. */
    private val COMPUTER_JUNK_NAMES = setOf("thumbs.db", "desktop.ini", ".ds_store")

    /** The folder macOS adds to zips it makes, holding only ._name files. */
    const val MAC_ZIP_FOLDER = "__MACOSX"

    private val LOG_EXTENSIONS = setOf("log", "dmp", "trace")

    /** Android's bug reports, as saved by "Take bug report": bugreport-<device>-<build>-<date>.zip. */
    private val BUG_REPORT = Regex("""^bugreport-.+\.zip$""", RegexOption.IGNORE_CASE)

    private val BACKUP_EXTENSIONS = setOf("bak", "old", "swp")

    /** Installer files: a plain APK, and the split-APK bundles of SAI, APKPure and APKMirror. */
    private val APK_EXTENSIONS = setOf("apk", "apks", "xapk", "apkm")

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

    /** Why [file] (a file, not a folder) at [rel] can be cleaned, or null. */
    fun fileKind(file: File, rel: String, inHidden: Boolean, now: Long): Kind? {
        val name = file.name
        EXPIRING.matchEntire(name)?.let { match ->
            val expires = match.groupValues[2].toLongOrNull() ?: return null
            if (expires * 1000 >= now) return null
            return if (match.groupValues[1] == "trashed") Kind.EXPIRED_TRASH else Kind.EXPIRED_PENDING
        }
        if (inHidden) return null
        val ext = name.substringAfterLast('.', "").lowercase()
        if (name.startsWith(".")) {
            // Hidden files are kept, except the few that are known junk: .DS_Store, ._name, vim's .name.swp.
            if (now - file.lastModified() < MIN_AGE_MS) return null
            if (name.lowercase() in COMPUTER_JUNK_NAMES || isAppleDouble(name)) return Kind.COMPUTER_JUNK
            if (ext == "swp") return Kind.BACKUP
            return null
        }
        if (ext in APK_EXTENSIONS) return if (now - file.lastModified() >= APK_MIN_AGE_MS) Kind.APK else null
        if (now - file.lastModified() < MIN_AGE_MS) return null
        if (ext in TEMP_EXTENSIONS) return Kind.TEMP
        if (name.lowercase() in COMPUTER_JUNK_NAMES) return Kind.COMPUTER_JUNK
        if (ext in LOG_EXTENSIONS) return Kind.LOG
        if (rel.startsWith("Download/") && BUG_REPORT.matches(name)) return Kind.LOG
        if (name.endsWith("~") || ext in BACKUP_EXTENSIONS) return Kind.BACKUP
        if (file.length() == 0L) return Kind.EMPTY_FILE
        return null
    }

    /** macOS's ._name companion files (AppleDouble), which hold Finder metadata no Android app reads. */
    private fun isAppleDouble(name: String) = name.length > 2 && name.startsWith("._")

    /**
     * Whether [dir] at [rel] is a __MACOSX folder that may go: outside hidden and app folders, not new,
     * and holding nothing but ._name and .DS_Store files.
     */
    fun isMacZipFolder(dir: File, rel: String, inHidden: Boolean, now: Long): Boolean {
        if (dir.name != MAC_ZIP_FOLDER || inHidden || isAppArea(rel) || now - dir.lastModified() < MIN_AGE_MS) return false
        fun onlyMacFiles(d: File): Boolean {
            val entries = d.listFiles() ?: return false
            return entries.all { f ->
                when {
                    isLink(f) -> false
                    f.isDirectory -> onlyMacFiles(f)
                    else -> isAppleDouble(f.name) || f.name.equals(".DS_Store", ignoreCase = true)
                }
            }
        }
        return onlyMacFiles(dir)
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

    /**
     * What app an installer file holds and how it compares with what's installed. Split bundles
     * (.apks, .xapk, .apkm) are archives Android can't read directly, so they come back as UNKNOWN.
     */
    fun apkInfo(ctx: Context, file: File): ApkInfo {
        val pm = ctx.packageManager
        val archive = try {
            @Suppress("DEPRECATION")
            pm.getPackageArchiveInfo(file.path, 0)
        } catch (e: Exception) {
            null
        } ?: return ApkInfo(null, null, ApkStatus.UNKNOWN)
        val app = archive.applicationInfo?.let { info ->
            // The label is only readable once the archive's path is set as the app's source.
            info.sourceDir = file.path
            info.publicSourceDir = file.path
            try {
                info.loadLabel(pm).toString()
            } catch (e: Exception) {
                null
            }
        } ?: archive.packageName
        val status = when {
            archive.packageName == null || !canSeeAllApps(ctx) -> ApkStatus.UNKNOWN
            else -> {
                val installed = try {
                    @Suppress("DEPRECATION")
                    pm.getPackageInfo(archive.packageName, 0)
                } catch (e: PackageManager.NameNotFoundException) {
                    null
                }
                when {
                    installed == null -> ApkStatus.NOT_INSTALLED
                    versionCode(installed) >= versionCode(archive) -> ApkStatus.INSTALLED
                    else -> ApkStatus.NEWER
                }
            }
        }
        return ApkInfo(app, archive.versionName, status)
    }

    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
}

/** How an installer file compares with the installed app. Keep the keys in step with ApkStatus in engine.ts. */
enum class ApkStatus(val key: String) {
    /** The same version, or a newer one, is installed: the file isn't needed any more. */
    INSTALLED("installed"),
    /** The file is newer than the installed app: an update not yet installed. */
    NEWER("newer"),
    NOT_INSTALLED("notInstalled"),
    /** A split bundle, a damaged file, or the installed apps can't be seen. */
    UNKNOWN("unknown"),
}

class ApkInfo(val app: String?, val version: String?, val status: ApkStatus)
