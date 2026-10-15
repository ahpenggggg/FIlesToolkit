# FileToolkit

On-device tools for tidying a phone, in one React Native / Expo app (Android and iOS). It combines DupeSweep (Duplicates, Compress video) and FolderRenamer (Folder names, File names), plus Archives (Android). Nothing leaves the phone.

| Tool | What it does |
|---|---|
| **Duplicates** | Finds photos and videos that are ≥ 80% similar (adjustable), keeps the best copy of each group and pre-selects the rest for Trash. |
| **Compress video** | Re-encodes videos to HEVC MP4 with Resolution and Quality presets, a live size estimate, per-video % progress, and a toggle to send originals to Trash or keep them. |
| **Folder names** | Renames each child folder of a picked folder from its photo and video count, e.g. `1V20P` or `JAMES_22V21P`. |
| **File names** | Groups files with look-alike names so each group can be renamed in one go: `Name_00001.jpg`, `Name_00002.mp4`, … |
| **Archives** (Android) | Creates ZIPs from files and folders, with an AES-256 password and/or split into parts; extracts ZIP (incl. split and password), RAR 4/5 (incl. password and multi-part) and 7Z. |

The app opens on a home screen listing every tool. The tool that was open last time reopens on launch, but **nothing is scanned automatically**: each tool waits for you to choose folders and press a button.

- **Duplicates / Compress video:** no folders are selected by default. Choose **All** or specific folders first; Compress lists videos only after you choose folders or tap **Find videos**.
- **Folder names / File names:** the folder you picked is remembered (with its name), but it is only read when you pick it or tap **Scan folder** / **Rescan**.

Every tool chooses folders (and files) the same way, with the shared `folder-picker` module: a **Folders card** on the tool screen and a **Choose folders sheet** that shows one level at a time with a path bar (`Storage › Internal storage › Download`), ticks, All / None and, for media, *Include subfolders*. Duplicates and Compress tick media folders; Folder names and File names pick one folder (storage roots, `Download` itself and `Android/` are protected); Archives picks files and folders to zip, an archive to extract, and destination folders. On iOS the rename tools use the Files folder picker, since iOS has no shared storage to browse. Folders and files are listed in natural order (`IMG_2` before `IMG_10`).

Long lists (the Choose folders sheet and the File names groups) use the shared `FastList` (`src/ui/FastList.tsx`): FlashList, so only the rows on screen are drawn and rows are recycled, plus a **fast scroller**: drag the thumb on the right edge to jump anywhere, with a bubble naming the item (or group) under it.

The bottom button of every tool always offers the next step: **Choose folders → Scan / Find videos → act**.

### Permissions (Android)

On launch the app checks its two permissions and, if one is missing, shows what each is for with a button to grant it (statuses refresh when you return from Settings):

| Permission | Used by | How it is granted |
|---|---|---|
| Photos and videos (`READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`) | Duplicates, Compress video | system prompt |
| All files access (`MANAGE_EXTERNAL_STORAGE`) | Folder names, File names, Archives | toggle in Settings (the app opens the page) |

Each tool also checks again before it needs the permission. *All files access* is fine for sideloading; Google Play only allows it for apps whose core purpose is file management.

## Project layout

Each tool is a self-contained folder under `modules/`, holding its screen, its logic and its native code. Two shared modules hold what more than one tool needs.

```
src/tools.ts             Tool registry: the home screen and tool headers are built from it
src/app/                 Expo Router routes: _layout.tsx (stack), index.tsx (home), one file per tool
src/shell/               PermissionGate.tsx (launch permission check)
src/ui/                  Design system: theme.ts (brand colours, type), components.tsx (ToolScreen and
                         every shared control), Sheet.tsx (the full-screen sheet behind every picker),
                         FastList.tsx (FlashList with fast scroller and back-to-top button)
src/lib/                 settings.ts (persisted state, AsyncStorage), lastTool.ts, format.ts
modules/
  duplicates/            Duplicates
    DuplicatesScreen.tsx, settings.ts, engine.ts (typed native API)
    android/ ios/        fingerprinting (256-bit DCT pHash + 8×8 colour, cached) and grouping
  compress/              Compress video
    CompressScreen.tsx, plan.ts (presets, size estimate), settings.ts, engine.ts
    android/ ios/        HEVC encoder, quality check, save to library
  folder-rename/         Folder names
    FolderRenameScreen.tsx, naming.ts (target names, conflicts), settings.ts, engine.ts
    android/ ios/        recursive photo/video count per child folder
  file-rename/           File names (TypeScript only)
    FileRenameScreen.tsx, grouping.ts (look-alike name rules), model.ts (groups, numbering), settings.ts
  archiver/              Archives (Android)
    ArchiverScreen.tsx, useCreateZip.tsx, useExtractArchive.tsx, useArchiveJob.ts, naming.ts, engine.ts
    android/             ZipCreator.kt (zip4j: AES-256, split .z01/.z02/….zip), Extractor.kt (zip4j for ZIP,
                         7-Zip engine for RAR 4/5, 7Z, multi-part and passwords), ArchiverModule.kt
  folder-picker/         shared by every tool (TypeScript only)
    FolderPickerSheet.tsx  the Choose folders sheet: one level at a time, path bar, ticks, single/multiple
    FolderScopeCard.tsx    the Folders card: what is chosen, Choose / Change, hint
    types.ts               FolderSource: implement it to feed the picker from anywhere
  media-library/         shared by Duplicates and Compress
    folderSource.ts      the photo library as a FolderSource; useMediaScope.tsx (card + picker + permission)
    permissions.ts, android/ ios/ (folder tree / albums, Trash, item registry)
  folder-access/         shared by Folder names, File names and Archives
    storageSource.ts     device storage as a FolderSource (folders, optionally files; protected folders)
    useFolderTool.tsx    chosen folder, scan on request, progress, picker, two-phase rename
    android/ ios/        list folders and files, rename (Android: All files access; iOS: Files bookmark)
plugins/withReleaseSigning.js  local Android release signing (no EAS)
assets/                 app icon, adaptive icon layers, splash marks, favicon (from FileToolkit-assets)
assets/brand/            wordmark PNGs used on the home screen, brand SVG masters and colour notes
```

### Adding a tool

1. Create `modules/<tool>/` with its screen as the default export of `index.ts` (plus `android/`, `ios/` and `expo-module.config.json` if it needs native code).
2. Add `src/app/<route>.tsx` containing `export { default } from '@modules/<tool>';`.
3. Add an entry to `TOOLS` in `src/tools.ts` (route, title, one-line summary, section, icon, tint, and `platforms` if it isn't on both). It appears on the home screen; new sections go in `TOOL_GROUPS`.
4. Build the screen from the shared parts so it looks and behaves like the rest: `ToolScreen`, `Hero`, an `ActionButton` for the next step, `FolderScopeCard` + `FolderPickerSheet` fed by `createMediaFolderSource` or `createStorageFolderSource` (or your own `FolderSource`), and `ProgressCard`.

Feature modules declare their shared module as a native dependency: `implementation project(':filetoolkit-media-library')` in Gradle and `s.dependency 'FileToolkitMediaLibrary'` in the podspec.

| | Android (Kotlin) | iOS (Swift) |
|---|---|---|
| Media library | MediaStore, real folder tree | PhotoKit, albums |
| Fingerprints | 256-bit DCT pHash + 8×8 colour, cached | same algorithm, ported |
| Grouping | closest-pairs-first, complete linkage, 5% split gap | same, ported |
| Video encode | Media3 Transformer, HEVC (H.264 fallback), scale and fps cap | AVAssetReader/Writer, HEVC; the composition handles rotation, scale, fps cap and HDR→SDR |
| Audio | copied untouched | copied untouched (AAC 128k fallback) |
| Quality check | 5-frame match, ±1 s; unsure → `_compressed` copy, original kept | size and duration checks |
| Save | `Download/Compressed/`, same capture date | same date, location, favourite and albums |
| Delete (if toggled on) | system Trash dialog (30 days) | Recently Deleted (system dialog) |
| Folder access | in-app folder tree, All files access | Files folder picker, saved bookmark |
| Renaming | `File.renameTo`, two-phase | `FileManager.moveItem`, two-phase |

## Folder names

1. Open **Folder names** and choose the parent folder, such as `Downloads/FFF`. Each folder directly inside it is scanned; media is counted recursively inside each one, and nested folders are not renamed on their own.
2. Optionally enter a name prefix. With `JAMES`, a folder with 1 video and 2 photos becomes `JAMES_1V2P`; leave it empty for `1V2P`. The prefix is remembered.
3. Review each folder's current name, media counts and proposed name, then tap **Rename folders** and confirm.

Zero-count segments are left out (`0V20P` becomes `20P`, `22V0P` becomes `22V`), and a folder with no photos or videos is named `0` (or `PREFIX_0`). Characters not allowed in names (`/ \ : * ? " < > |`) can't be typed into the prefix, and a trailing underscore is not doubled. Folders with duplicate target names, or a name held by a file or an unchanged folder, are skipped. Supported photo and video types are listed in `modules/folder-rename/android/…/FolderRenameModule.kt`.

## File names

1. Open **File names** and choose a folder (or tap **Scan folder** to re-read the one chosen before). Files directly inside it are listed; subfolders and hidden files are ignored.
2. Files with similar names are grouped. Names are compared by their letters only, ignoring case, digits, symbols and repeated letters.
   - **Strict pattern match** (on by default) groups only names with the same letter pattern: `own`, `ownnnn` and `ownn_` form one group, while `ownxlee` and `ownxbob` are each their own group, and `IMG_123` is apart from `Img 12002-wa-223`.
   - With it off, names that start alike are grouped too, so `file1`, `fileee12`, `file(2)` and `filexyz~1` form one group.
   - Files that match no other file, and names with fewer than two letters (`a1`, `x_2024`, `2024`), are gathered into one **Other files** group at the end.
   - **Gather small groups** (off by default) also moves every group with fewer than 5 files into **Other files**.
3. Type a name for each group you want to rename, or tap the **Use …** suggestion. Tap a file to leave it out.
   - The **search box** above the list keeps only the files whose name contains what you type (`11 of 3000`), showing every match, and jumps to the first one.
   - Big folders stay quick: the list is virtualized, the fast scroller on the right jumps between groups, and **Back to top** appears once you're a few screens down.
4. Tap **Rename files** and confirm. Files become `Name_00001.jpg`, `Name_00002.mp4` and so on, numbered in the order shown. A group of one file gets the bare name.
   Numbers have 5 digits so names sort correctly in any file manager; a sequence that goes past 99999 gets 6 digits for every file (`Name_000001` … `Name_100000`).

Extensions are never changed (compound ones such as `.tar.gz` are kept whole). Groups given the same name are numbered as one sequence, and numbers already taken by other files in the folder are skipped. Unnamed groups are left as they are.

Both rename tools rename in two passes (everything to a temporary name first, then to its target), so names can be swapped without collisions; if the first pass fails, the items are put back.

## Archives (Android)

**Create ZIP:** choose files and folders (folders are added with everything inside), where to save and a name (both default from the first item; a taken name gets a number). Options: compression (Store / Fast / Normal / Max), an AES-256 **password**, and **split into parts** (25 MB, 100 MB, 500 MB, 1 GB or a custom size), written as standard `name.z01`, `name.z02` … `name.zip`, which WinRAR, 7-Zip and WinZip open.

**Extract:** choose an archive (for split or multi-part sets, the first part: the `.zip`, the `.part1.rar` or the `.001` — e.g. `myfile.zip.001`, `myfile.rar.001`, `myfile.7z.001` as cut by 7-Zip, WinRAR and other splitters); its format, file count, size and parts are listed. Enter the password if it has one; when even the file names are encrypted, tap **Unlock** first. Files go into a new folder named after the archive (`name (1)` if taken) or straight into a folder you choose; existing files are kept (both), replaced or skipped. A wrong password leaves nothing behind.

| | Create | Extract |
|---|---|---|
| ZIP | yes, incl. AES-256 password and split parts | yes, incl. split (`.z01` … `.zip` and `.zip.001` …), AES and ZipCrypto passwords |
| RAR 4 / RAR 5 | no: only WinRAR may create RAR files | yes, incl. password, encrypted names and multi-part (`.partN.rar`, `.r00`, `.rar.001`) |
| 7Z, TAR, GZ and more | no | yes, via the 7-Zip engine (also split `.7z.001` …, incl. password and encrypted names) |

Libraries: [zip4j](https://github.com/srikanth-lingala/zip4j) 2.11.5 (Maven Central) and [7-Zip-JBinding-4Android](https://github.com/omicronapps/7-Zip-JBinding-4Android) 16.02-2.03 (JitPack, added through `expo-build-properties`); both are 16 KB page-size ready.

## Compression presets (HEVC; H.264 gets 1.5× the bitrate)

| Preset | 1080p30 | 720p30 | Extra limits |
|---|---|---|---|
| High | ~4.4 Mbps | ~1.9 Mbps | keeps frame rate |
| Balanced | ~2.2 Mbps | ~1.0 Mbps | ≤ 45% of the source bitrate, max 30 fps |
| Small | ~1.2 Mbps | ~0.55 Mbps | ≤ 25% of the source bitrate, max 30 fps |

A result is only kept if it is **≥ 1 MB smaller**. Videos under 5 MB are hidden.

## Requirements

- Node 20+, JDK 17, Android Studio (SDK 35+) for Android
- Xcode 16+ on a Mac for iOS
- Android 11+ (minSdk 30), iOS 16.4+
- This app has native code, so **Expo Go won't work**. Use a development build.

## Run

```bash
npm install
npx expo run:android          # builds and installs a dev build on a connected phone
npx expo run:ios --device     # Mac only
```

`npx expo run:*` generates `android/` and `ios/` from `app.json` (Continuous Native Generation). Don't edit those folders by hand; they're git-ignored.

### Release APK / AAB (Android), all local, no EAS

```bash
npm run apk            # → dist/FileToolkit-release.apk (also android/app/build/outputs/apk/release/app-release.apk)
npm run install:apk    # adb install to the connected phone
npm run aab            # Play Store bundle → android/app/build/outputs/bundle/release/
```

**Signing:** without a key, release builds use the debug key, which is fine for sideloading. For a real key (required for the Play Store; keep it forever):

```bash
keytool -genkeypair -v -keystore ~/keys/filetoolkit.jks -alias filetoolkit -keyalg RSA -keysize 2048 -validity 10000
```

Then add to `~/.gradle/gradle.properties` (outside the repo):

```
FILETOOLKIT_STORE_FILE=/Users/you/keys/filetoolkit.jks
FILETOOLKIT_STORE_PASSWORD=...
FILETOOLKIT_KEY_ALIAS=filetoolkit
FILETOOLKIT_KEY_PASSWORD=...
```

`plugins/withReleaseSigning.js` wires this in on every prebuild, so `prebuild --clean` never loses it.

**Free cloud build:** `.github/workflows/android-apk.yml` builds the APK on GitHub Actions. Run it manually or push a `v*` tag. For signing, add the secrets listed at the top of the file.

### iOS

- **Your own iPhone (free Apple ID):** `npx expo run:ios --device --configuration Release`. Builds expire after 7 days; re-run to refresh.
- **IPA for other people / TestFlight:** needs the paid Apple Developer Program. Then `npx expo prebuild -p ios` → open `ios/FileToolkit.xcworkspace` → Any iOS Device → **Product → Archive** → Distribute App.

### Checks

```bash
npm run typecheck
npm run lint
npm test               # file-grouping, folder-naming and name-input rules
```

## Platform notes

- **iOS iCloud:** videos that exist only in iCloud are greyed out ("download it in Photos first"). Photos are fingerprinted from a small derivative, so they work.
- **iOS** has no media folders, so the media picker shows albums and smart albums (Videos, Screenshots, Selfies, Screen Recordings, Bursts). The rename tools use folders picked in the Files app.
- **Keep the app open** while compressing. The screen is kept awake automatically.
