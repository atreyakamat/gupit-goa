import { Ionicons } from '@expo/vector-icons';
import { instagramProfileUrl, splitCreditLine, type SocialPost } from '@gupit/shared';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Section } from '@/components/ui';
import { useSocialPosts } from '@/lib/hooks';
import { colors, elevation, radius, spacing, touchTarget } from '@/theme/tokens';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/**
 * Instagram posts a reviewer has linked to this place. The app shows the creator's handle
 * and our own one-line note, and opens the post in Instagram. It never copies the caption,
 * photo or video, so creators keep their views and their credit.
 */
export function SocialPostsSection({ spotId }: { spotId: string }) {
  const posts = useSocialPosts(spotId);
  if (!posts.data || posts.data.length === 0) return null;
  return (
    <Section title="Seen on Instagram">
      <View style={styles.list}>
        {posts.data.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </View>
      <AppText variant="caption" color={colors.inkMuted}>
        Posts belong to their creators and open in Instagram.
      </AppText>
    </Section>
  );
}

function PostCard({ post }: { post: SocialPost }) {
  const handle = post.creator_handle ? `@${post.creator_handle}` : 'Instagram post';
  return (
    <Pressable
      onPress={() => open(post.url)}
      accessibilityRole="link"
      accessibilityLabel={`${handle} on Instagram${post.note ? `. ${post.note}` : ''}`}
      accessibilityHint="Opens the post in Instagram"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.logo}>
        <Ionicons name="logo-instagram" size={22} color={colors.onPrimary} />
      </View>
      <View style={styles.body}>
        <AppText variant="subheading" numberOfLines={1}>
          {handle}
        </AppText>
        {post.note ? (
          <AppText variant="caption" color={colors.inkMuted} numberOfLines={2}>
            {post.note}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="open-outline" size={18} color={colors.inkFaint} />
    </Pressable>
  );
}

/** A photo credit where any @handle opens the creator's Instagram profile. */
export function CreditLine({ credit }: { credit: string }) {
  return (
    <AppText variant="caption" color={colors.inkMuted}>
      Photo:{' '}
      {splitCreditLine(credit).map((part, index) =>
        part.handle ? (
          <AppText
            key={index}
            variant="caption"
            color={colors.primary}
            accessibilityRole="link"
            onPress={() => open(instagramProfileUrl(part.handle!))}
          >
            {part.text}
          </AppText>
        ) : (
          part.text
        ),
      )}
    </AppText>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 16,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    ...elevation.card,
  },
  pressed: { opacity: 0.75 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: '#C13584',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
});
