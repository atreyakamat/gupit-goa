import * as Crypto from 'expo-crypto';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { getSupabase } from '@/lib/supabase';
import { adminApi } from './api';

const BUCKET = 'spot-media';

async function upload(path: string, uri: string): Promise<void> {
  const body = await (await fetch(uri)).arrayBuffer();
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, body, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new Error(error.message);
}

/**
 * Picks a photo, makes a compressed full image and a small thumbnail on the device, uploads
 * both and records the media row as NOT approved. A reviewer must then set the rights status;
 * until they do, the photo is never shown on a public page.
 *
 * Returns null if the reviewer cancelled the picker.
 */
export async function pickAndUploadSpotPhoto(spotId: string): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
  });
  const asset = picked.assets?.[0];
  if (picked.canceled || !asset) return null;

  const fullWidth = Math.min(asset.width || 1600, 1600);
  const full = await manipulateAsync(asset.uri, [{ resize: { width: fullWidth } }], {
    compress: 0.8,
    format: SaveFormat.JPEG,
  });
  const thumb = await manipulateAsync(
    asset.uri,
    [{ resize: { width: Math.min(fullWidth, 400) } }],
    { compress: 0.7, format: SaveFormat.JPEG },
  );

  const base = `spots/${spotId}/${Crypto.randomUUID()}`;
  await upload(`${base}.jpg`, full.uri);
  await upload(`${base}_thumb.jpg`, thumb.uri);
  return adminApi.saveMedia(null, spotId, {
    storage_path: `${base}.jpg`,
    thumb_path: `${base}_thumb.jpg`,
    rights_status: 'not_approved',
  });
}

export async function deleteSpotPhoto(mediaId: string): Promise<void> {
  const paths = await adminApi.deleteMedia(mediaId);
  const objects = [paths.storage_path, paths.thumb_path].filter((p): p is string => Boolean(p));
  await getSupabase().storage.from(BUCKET).remove(objects);
}
