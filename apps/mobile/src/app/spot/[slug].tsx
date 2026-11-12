import {
  DISCOVERY_LABEL_TEXT,
  PRICE_BAND_TEXT,
  RESPECT_TAGS,
  SAFETY_TAGS,
  VERIFIED_ATTRIBUTES,
  buildDirectionsUrls,
  buildShareMessage,
  buildWhatsAppUrl,
  describeCrowd,
  partnerEnquiryText,
  type DiscoveryLabel,
  type SpotDetail,
} from '@gupit/shared';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { CategoryArt } from '@/components/CategoryArt';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PreviewBanner } from '@/components/PreviewBanner';
import {
  AppText,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
} from '@/components/ui';
import { AlternativesSection } from '@/features/crowd/AlternativesSection';
import { CrowdSection } from '@/features/crowd/CrowdSection';
import { SaveSheet } from '@/features/saved/SaveSheet';
import { CreditLine, SocialPostsSection } from '@/features/spots/SocialPosts';
import { getSessionId, track } from '@/lib/analytics';
import { api, mediaUrl } from '@/lib/api';
import { isPreviewMode } from '@/lib/env';
import {
  useListIdsContaining,
  useOnline,
  useSavedLists,
  useSavedMutations,
  useSpotDetail,
} from '@/lib/hooks';
import { logger } from '@/lib/logger';
import { colors, radius, spacing } from '@/theme/tokens';

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

const ACCESS_TEXT: Record<string, string> = {
  verified_public: 'Open to the public',
  business_premises: 'Business premises: open to customers',
  permit_required: 'Permit or ticket required',
};

/** A fact row. Unknown facts say so plainly; nothing is filled in to look complete. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.fact}>
      <AppText variant="label" color={colors.inkMuted} style={styles.factLabel}>
        {label}
      </AppText>
      <AppText style={styles.factValue} color={value ? colors.ink : colors.inkFaint}>
        {value ?? 'Not verified'}
      </AppText>
    </View>
  );
}

function Gallery({ detail }: { detail: SpotDetail }) {
  const { width } = useWindowDimensions();
  if (detail.media.length === 0) {
    // No rights-cleared photo yet: show category artwork rather than an empty gap.
    return (
      <View style={styles.heroWrap}>
        <CategoryArt categorySlug={detail.category.slug} size={64} style={styles.hero} />
      </View>
    );
  }
  const imageWidth = detail.media.length === 1 ? width - spacing.lg * 2 : width * 0.8;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.gallery}
      decelerationRate="fast"
    >
      {detail.media.map((item, index) => (
        <View key={item.id} style={{ width: imageWidth }}>
          <Image
            source={{ uri: mediaUrl(item.storage_path) ?? undefined }}
            placeholder={
              item.thumb_path ? { uri: mediaUrl(item.thumb_path) ?? undefined } : undefined
            }
            style={styles.photo}
            contentFit="cover"
            transition={200}
            accessibilityLabel={item.alt_text ?? `Photo ${index + 1} of ${detail.name}`}
          />
          {item.credit_line ? <CreditLine credit={item.credit_line} /> : null}
        </View>
      ))}
    </ScrollView>
  );
}

export default function SpotScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const online = useOnline();
  const query = useSpotDetail(slug);
  const detail = query.data?.detail;
  const lists = useSavedLists();
  const containing = useListIdsContaining(detail?.id);
  const { save } = useSavedMutations();
  const [saveOpen, setSaveOpen] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const isSaved = (containing.data?.length ?? 0) > 0;

  useEffect(() => {
    if (!detail) return;
    track('spot_opened', { category: detail.category.slug, region: detail.region });
    if (detail.partner) track('partner_profile_opened', { partner_id: detail.partner.id });
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A place that is reliably busy right now gets alternatives without being asked.
  const busyNow = detail
    ? (() => {
        const d = describeCrowd(detail.crowd, new Date());
        return d.kind === 'live' && d.level === 3;
      })()
    : false;
  useEffect(() => {
    if (busyNow && online) setShowAlternatives(true);
  }, [busyNow, online]);

  if (query.isPending) {
    return (
      <Screen edges={[]}>
        <LoadingState label="Loading place" />
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen edges={[]}>
        <ErrorState
          title="Could not load this place"
          body="It has not been opened on this phone before, so there is no saved copy."
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  }
  if (!detail) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="alert-circle-outline"
          title="This place is not available"
          body="It may have been removed or is being rechecked."
          action={
            <Button
              label="Back to Explore"
              kind="secondary"
              onPress={() => router.replace('/(tabs)')}
            />
          }
        />
      </Screen>
    );
  }

  const onSave = () => {
    if ((lists.data?.length ?? 0) === 0 && !isSaved) {
      save.mutate({ listId: null, detail });
      track('spot_saved', { category: detail.category.slug });
    } else {
      setSaveOpen(true);
    }
  };

  const onShare = async () => {
    track('share_opened', { category: detail.category.slug });
    try {
      await Share.share({ message: buildShareMessage(detail) });
    } catch (error) {
      logger.warn('share_failed', { reason: String(error) });
    }
  };

  const onDirections = async () => {
    track('directions_opened', { category: detail.category.slug });
    const urls = buildDirectionsUrls(detail, Platform.OS === 'ios' ? 'ios' : 'android');
    try {
      await Linking.openURL(urls.primary);
    } catch {
      await Linking.openURL(urls.fallback).catch(() => undefined);
    }
  };

  const onWhatsApp = async () => {
    const partner = detail.partner;
    // Preview partners are invented, so there is nobody to message.
    if (!partner || isPreviewMode) return;
    const url = buildWhatsAppUrl(partner.whatsapp_number, partnerEnquiryText(detail.name));
    if (!url) return;
    // Record intent first (no message content), then hand off. A logging failure never blocks the user.
    void api
      .trackPartnerEnquiry({
        partnerId: partner.id,
        spotId: detail.id,
        surface: 'spot_detail',
        sessionId: getSessionId(),
      })
      .catch(() => undefined);
    await Linking.openURL(url).catch(() => undefined);
  };

  const labels = detail.discovery_labels.filter(
    (l): l is DiscoveryLabel => l in DISCOVERY_LABEL_TEXT,
  );
  const verified = formatDate(detail.last_verified_at);

  return (
    <Screen scroll edges={['bottom']} padded={false}>
      <Stack.Screen options={{ title: detail.name }} />
      <OfflineBanner />
      <PreviewBanner />
      <Gallery detail={detail} />
      <View style={styles.body}>
        <View style={styles.titleBlock}>
          <AppText variant="title" accessibilityRole="header">
            {detail.name}
          </AppText>
          <AppText color={colors.inkMuted}>
            {[
              detail.category.label,
              detail.locality,
              detail.region
                ? `${detail.region[0]!.toUpperCase()}${detail.region.slice(1)} Goa`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          <Row>
            {detail.partner ? (
              <Badge label={detail.partner.label_text} tone="accent" icon="pricetag-outline" />
            ) : null}
            {labels.map((label) => (
              <Badge key={label} label={DISCOVERY_LABEL_TEXT[label]} tone="primary" />
            ))}
          </Row>
        </View>

        {query.data?.fromCache ? (
          <Notice tone="warning">
            Showing the copy saved on this phone on{' '}
            {formatDate(new Date(query.data.cachedAt).toISOString())}. Details may have changed.
          </Notice>
        ) : null}
        {detail.temporarily_unavailable ? (
          <Notice tone="warning">Temporarily unavailable. Check before you travel.</Notice>
        ) : null}
        {detail.needs_recheck ? (
          <Notice tone="warning">
            These details are due for rechecking and may be out of date.
          </Notice>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={isSaved ? 'Saved' : 'Save'}
            kind="secondary"
            icon={isSaved ? 'bookmark' : 'bookmark-outline'}
            onPress={onSave}
            style={styles.action}
          />
          <Button
            label="Share"
            kind="secondary"
            icon="share-outline"
            onPress={() => void onShare()}
            style={styles.action}
          />
          <Button
            label="Directions"
            icon="navigate-outline"
            onPress={() => void onDirections()}
            style={styles.action}
          />
        </View>

        {detail.short_description || detail.description ? (
          <Section title="About">
            {detail.short_description ? <AppText>{detail.short_description}</AppText> : null}
            {detail.description ? <AppText>{detail.description}</AppText> : null}
          </Section>
        ) : null}

        <CrowdSection
          spotId={detail.id}
          slug={detail.slug}
          crowd={detail.crowd}
          onTryInstead={() => {
            setShowAlternatives(true);
            track('alternatives_opened', { category: detail.category.slug });
          }}
        />
        {showAlternatives ? <AlternativesSection spotId={detail.id} /> : null}

        <Section title="Before you go">
          <Card>
            <Fact label="Getting there" value={detail.access_notes} />
            <Fact label="Best time" value={detail.best_time} />
            <Fact label="Hours" value={detail.opening_hours?.text ?? null} />
            <Fact
              label="Cost"
              value={detail.price_band ? PRICE_BAND_TEXT[detail.price_band] : null}
            />
            <Fact label="Parking" value={detail.parking_info} />
            <Fact label="Access" value={ACCESS_TEXT[detail.public_access_status] ?? null} />
            {detail.location_precision === 'approximate' ? (
              <AppText variant="caption" color={colors.inkMuted}>
                The map pin is approximate.
              </AppText>
            ) : null}
          </Card>
          {detail.verified_attributes.length ? (
            <Row>
              {detail.verified_attributes.map((key) => (
                <Badge
                  key={key}
                  label={VERIFIED_ATTRIBUTES[key] ?? key}
                  tone="neutral"
                  icon="checkmark-circle-outline"
                />
              ))}
            </Row>
          ) : null}
        </Section>

        {detail.safety_tags.length || detail.safety_notes ? (
          <Section title="Safety">
            <Card style={styles.safety}>
              {detail.safety_tags.map((tag) => (
                <View key={tag} style={styles.bullet}>
                  <Badge label="!" tone="busy" />
                  <AppText style={styles.flex}>
                    {SAFETY_TAGS[tag] ?? tag.replace(/_/g, ' ')}
                  </AppText>
                </View>
              ))}
              {detail.safety_notes ? <AppText>{detail.safety_notes}</AppText> : null}
            </Card>
          </Section>
        ) : null}

        {detail.respect_tags.length || detail.respect_notes ? (
          <Section title="Please respect">
            <Card>
              {detail.respect_tags.map((tag) => (
                <AppText key={tag}>• {RESPECT_TAGS[tag] ?? tag.replace(/_/g, ' ')}</AppText>
              ))}
              {detail.respect_notes ? <AppText>{detail.respect_notes}</AppText> : null}
            </Card>
          </Section>
        ) : null}

        {detail.partner ? (
          <Section title={detail.partner.business_name}>
            <Card>
              <Badge label={detail.partner.label_text} tone="accent" icon="pricetag-outline" />
              <AppText variant="caption" color={colors.inkMuted}>
                This is a paid partner listing. Partners cannot change crowd levels, safety notes or
                where a place ranks.
              </AppText>
              <Button
                label="Message on WhatsApp"
                icon="logo-whatsapp"
                disabled={isPreviewMode}
                onPress={() => void onWhatsApp()}
                accessibilityHint="Opens WhatsApp. We record only that the button was tapped, never your message."
              />
            </Card>
          </Section>
        ) : null}

        <SocialPostsSection spotId={detail.id} />

        <Section title="How we know">
          <AppText color={colors.inkMuted}>
            {verified ? `Checked by our team on ${verified}.` : 'Verification date not recorded.'}
            {detail.last_visited_at ? ` Last visited ${formatDate(detail.last_visited_at)}.` : ''}
          </AppText>
          {detail.sources.map((source, index) => (
            <AppText
              key={`${source.url ?? source.title}-${index}`}
              variant="caption"
              color={source.url ? colors.primary : colors.inkMuted}
              onPress={
                source.url
                  ? () => void Linking.openURL(source.url!).catch(() => undefined)
                  : undefined
              }
              accessibilityRole={source.url ? 'link' : 'text'}
            >
              {source.title ?? source.publisher ?? 'Source'}
              {source.attribution ? ` (${source.attribution})` : ''}
            </AppText>
          ))}
          <Button
            label="Report a problem with this place"
            kind="ghost"
            icon="flag-outline"
            onPress={() =>
              router.push({ pathname: '/report', params: { spotId: detail.id, name: detail.name } })
            }
          />
        </Section>
      </View>
      <SaveSheet visible={saveOpen} onClose={() => setSaveOpen(false)} detail={detail} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gallery: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  heroWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  hero: { height: 168, borderRadius: radius.lg },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  body: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  titleBlock: { gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, paddingHorizontal: spacing.sm },
  fact: { flexDirection: 'row', gap: spacing.md, paddingVertical: 2 },
  factLabel: { width: 96 },
  factValue: { flex: 1 },
  safety: { borderColor: colors.crowdBusy, borderWidth: 1 },
  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
