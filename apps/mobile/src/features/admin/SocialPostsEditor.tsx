import { normaliseInstagramHandle, normaliseInstagramPostUrl } from '@gupit/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking } from 'react-native';
import { AppText, Button, Card, Field, Notice, Row, Section } from '@/components/ui';
import { colors } from '@/theme/tokens';
import { adminApi, adminErrorText } from './api';

/**
 * Link creators' Instagram posts to a place. Only the link, the handle and the reviewer's
 * own note are saved. To reuse a creator's actual photo, get their permission, upload it
 * under Photos, set its rights to "Permission given" and credit them as "@handle".
 */
export function SocialPostsEditor({ spotId }: { spotId: string }) {
  const client = useQueryClient();
  const posts = useQuery({
    queryKey: ['admin', 'social-posts', spotId],
    queryFn: () => adminApi.socialPosts(spotId),
  });
  const [url, setUrl] = useState('');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin', 'social-posts', spotId] });
    await client.invalidateQueries({ queryKey: ['social-posts'] });
  };

  const add = async () => {
    setError(null);
    const cleanUrl = normaliseInstagramPostUrl(url);
    if (!cleanUrl)
      return setError('Paste the link to an Instagram post or reel (not a profile or story).');
    const cleanHandle = handle.trim() ? normaliseInstagramHandle(handle) : null;
    if (handle.trim() && !cleanHandle)
      return setError('That does not look like an Instagram handle.');
    setBusy(true);
    try {
      await adminApi.saveSocialPost(spotId, cleanUrl, cleanHandle, note.trim() || null);
      setUrl('');
      setHandle('');
      setNote('');
      await refresh();
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={`Instagram posts (${posts.data?.length ?? 0})`}>
      <AppText variant="caption" color={colors.inkMuted}>
        Shown on the place page as a tagged card that opens the post in Instagram. Paste links by
        hand: nothing is fetched or copied from Instagram, and captions, photos and videos stay with
        the creator.
      </AppText>
      {(posts.data ?? []).map((post) => (
        <Card key={post.id}>
          <AppText variant="subheading">
            {post.creator_handle ? `@${post.creator_handle}` : 'No handle'}
          </AppText>
          {post.note ? <AppText>{post.note}</AppText> : null}
          <AppText variant="caption" color={colors.inkMuted} numberOfLines={1}>
            {post.post_url}
          </AppText>
          <Row>
            <Button
              label="Open"
              kind="ghost"
              icon="open-outline"
              onPress={() => void Linking.openURL(post.post_url).catch(() => undefined)}
            />
            <Button
              label="Remove"
              kind="ghost"
              icon="trash-outline"
              onPress={() =>
                void adminApi
                  .deleteSocialPost(post.id)
                  .then(refresh)
                  .catch((e) => setError(adminErrorText(e)))
              }
            />
          </Row>
        </Card>
      ))}
      <Field
        label="Post or reel link"
        placeholder="https://www.instagram.com/reel/..."
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Field
        label="Creator handle"
        placeholder="@creator"
        value={handle}
        onChangeText={setHandle}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="One-line note (your own words)"
        value={note}
        onChangeText={setNote}
        maxLength={140}
        hint="For example: Sunset from the upper ramparts. Do not copy the caption."
      />
      {error ? <Notice tone="warning">{error}</Notice> : null}
      <Button
        label="Link this post"
        kind="secondary"
        icon="logo-instagram"
        disabled={url.trim().length === 0}
        loading={busy}
        onPress={() => void add()}
      />
    </Section>
  );
}
