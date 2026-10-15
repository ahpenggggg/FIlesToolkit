package expo.modules.filetoolkit.medialibrary

import android.app.Activity
import android.content.Context
import android.provider.MediaStore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withContext

/** Shared photo/video library access: folder tree, permission (iOS) and the system Trash. */
class MediaLibraryModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var pendingTrash: Promise? = null

    private val ctx: Context get() = appContext.reactContext ?: error("React context not available")

    override fun definition() = ModuleDefinition {
        Name("FTMediaLibrary")

        // Android permissions are requested from TypeScript (PermissionsAndroid).
        AsyncFunction("requestPermission") { promise: Promise -> promise.resolve("granted") }

        AsyncFunction("listFolders") { promise: Promise ->
            scope.launchFor(promise) {
                withContext(Dispatchers.IO) { MediaScanner.listFolders(ctx) }.map { f ->
                    mapOf(
                        "id" to f.path,
                        "name" to f.name,
                        "path" to f.displayPath,
                        "depth" to f.depth,
                        "photos" to f.photoCount,
                        "videos" to f.videoCount,
                        "totalPhotos" to f.totalPhotos,
                        "totalVideos" to f.totalVideos,
                    )
                }
            }
        }

        AsyncFunction("trash") { ids: List<String>, promise: Promise ->
            val uris = ids.mapNotNull { MediaRegistry.uriOf(it) }
            if (uris.isEmpty()) {
                promise.resolve(false)
                return@AsyncFunction
            }
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject("E_NO_ACTIVITY", "No activity to show the confirmation", null)
                return@AsyncFunction
            }
            val sender = try {
                MediaStore.createTrashRequest(ctx.contentResolver, uris, true).intentSender
            } catch (e: Exception) {
                promise.reject("E_TRASH", e.message, e)
                return@AsyncFunction
            }
            pendingTrash = promise
            activity.runOnUiThread {
                try {
                    activity.startIntentSenderForResult(sender, TRASH_REQUEST, null, 0, 0, 0)
                } catch (e: Exception) {
                    pendingTrash = null
                    promise.reject("E_TRASH", e.message, e)
                }
            }
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode == TRASH_REQUEST) {
                pendingTrash?.resolve(payload.resultCode == Activity.RESULT_OK)
                pendingTrash = null
            }
        }

        OnDestroy { scope.cancel() }
    }

    companion object {
        private const val TRASH_REQUEST = 47_201
    }
}
