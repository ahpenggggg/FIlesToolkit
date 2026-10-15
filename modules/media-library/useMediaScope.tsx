import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { Notice } from '@/ui';
import { FolderPickerSheet, FolderScopeCard, type FolderSource } from '../folder-picker';
import { createMediaFolderSource, folderSummary } from './folderSource';
import { ensureMediaAccess, type Access } from './permissions';

interface Options {
  /** 'video' lists only folders that hold videos. */
  kind: 'any' | 'video';
  /** null = not chosen yet, [] = all folders. */
  folderIds: string[] | null;
  includeSubfolders: boolean;
  onChange: (folderIds: string[], includeSubfolders: boolean) => void;
  /** Shown when photo/video access is refused. */
  deniedMessage: string;
  /** Under the folders once chosen. */
  caption: string;
  /** Asks for a choice while none is made. */
  prompt: string;
  /** Locks the card while a job runs. */
  disabled?: boolean;
}

/**
 * The media tools' folder scope: the shared Folders card and picker over the photo library,
 * and the photo/video permission check that every media action goes through.
 */
export function useMediaScope(o: Options) {
  /** Set while the picker is open; a fresh source each time so new folders show up. */
  const [source, setSource] = useState<FolderSource | null>(null);
  const [access, setAccess] = useState<Access | null>(null);

  /** Runs `fn` once photo/video access is granted (or limited). */
  const withAccess = async (fn: () => void) => {
    const a = await ensureMediaAccess();
    setAccess(a);
    if (a === 'denied') Alert.alert('Permission needed', o.deniedMessage);
    else fn();
  };

  const open = () => withAccess(() => setSource(createMediaFolderSource(o.kind)));

  const card = (
    <>
      <FolderScopeCard
        summary={folderSummary(o.folderIds, null, o.includeSubfolders)}
        chosen={o.folderIds != null}
        caption={o.caption}
        prompt={o.prompt}
        onPress={open}
        disabled={o.disabled}
      >
        {access === 'limited' ? <Notice message="Limited access: only the photos and videos you allowed are included." /> : null}
      </FolderScopeCard>
      {source ? (
        <FolderPickerSheet
          title={Platform.OS === 'android' ? 'Choose folders' : 'Choose albums'}
          source={source}
          mode="multiple"
          initialIds={o.folderIds}
          initialSub={o.includeSubfolders}
          onClose={() => setSource(null)}
          onConfirm={(ids, sub) => {
            setSource(null);
            o.onChange(ids, sub);
          }}
        />
      ) : null}
    </>
  );

  return { chosen: o.folderIds != null, open, withAccess, card };
}
