import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import { MediaLibrary } from './native';

export type Access = 'granted' | 'limited' | 'denied';

const ANDROID_PERMS: Permission[] =
  Number(Platform.Version) >= 33
    ? ([
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ...(Number(Platform.Version) >= 34 ? ['android.permission.READ_MEDIA_VISUAL_USER_SELECTED' as Permission] : []),
      ] as Permission[])
    : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE];

/** Asks for photo/video access if needed. "limited" = user picked only some items (Android 14+/iOS). */
export async function ensureMediaAccess(): Promise<Access> {
  if (Platform.OS === 'ios') return MediaLibrary.requestPermission();

  const result = await PermissionsAndroid.requestMultiple(ANDROID_PERMS);
  return androidAccess((p) => result[p as Permission] === PermissionsAndroid.RESULTS.GRANTED);
}

/** Android: the current photo/video access, without asking. */
export async function checkMediaAccess(): Promise<Access> {
  const results = await Promise.all(ANDROID_PERMS.map((p) => PermissionsAndroid.check(p)));
  const granted = new Set(ANDROID_PERMS.filter((_, i) => results[i]));
  return androidAccess((p) => granted.has(p as Permission));
}

function androidAccess(granted: (permission: string) => boolean): Access {
  if (Number(Platform.Version) >= 33) {
    const images = granted(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    const videos = granted(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
    if (images && videos) return 'granted';
    if (images || videos || granted('android.permission.READ_MEDIA_VISUAL_USER_SELECTED')) return 'limited';
    return 'denied';
  }
  return granted(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE) ? 'granted' : 'denied';
}

/** Where deleted media goes on this platform. */
export function trashName() {
  return Platform.OS === 'ios' ? 'Recently Deleted' : 'Trash';
}
