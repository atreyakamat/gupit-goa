import {
  DISCOVERY_LABELS,
  DISCOVERY_LABEL_TEXT,
  PRICE_BANDS,
  PRICE_BAND_TEXT,
  REGIONS,
  REGION_LABELS,
  RESPECT_TAGS,
  SAFETY_TAGS,
  VERIFIED_ATTRIBUTES,
  isWithinGoa,
  toggle,
} from '@gupit/shared';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import {
  AppText,
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
} from '@/components/ui';
import {
  adminApi,
  adminErrorText,
  type ChecklistItem,
  type SpotEditorData,
} from '@/features/admin/api';
import { deleteSpotPhoto, pickAndUploadSpotPhoto } from '@/features/admin/media';
import { FormField, ReasonSheet, csv, fromCsv, shortDate } from '@/features/admin/ui';
import { mediaUrl } from '@/lib/api';
import { useCategories } from '@/lib/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

interface FormValues {
  name: string;
  aliases: string;
  short_description: string;
  description: string;
  locality: string;
  address_text: string;
  lat: string;
  lng: string;
  best_time: string;
  parking_info: string;
  hours_text: string;
  access_notes: string;
  safety_notes: string;
  respect_notes: string;
  search_tags: string;
  crowd_note: string;
  internal_notes: string;
}

interface Choices {
  category: string;
  region: string | null;
  labels: string[];
  price: string | null;
  access: string;
  precision: string;
  safetyTags: string[];
  respectTags: string[];
  attributes: string[];
  method: string | null;
  hoursVerified: boolean;
  safetyReviewed: boolean;
}

const ACCESS: [string, string][] = [
  ['verified_public', 'Public'],
  ['business_premises', 'Business premises'],
  ['permit_required', 'Permit required'],
  ['restricted', 'Restricted'],
  ['unknown', 'Unknown'],
];
const PRECISION: [string, string][] = [
  ['exact', 'Pin checked: exact'],
  ['approximate', 'Pin checked: approximate'],
  ['needs_review', 'Not checked'],
];
const METHODS: [string, string][] = [
  ['team_visit', 'Team visit'],
  ['two_local_sources', 'Two independent local sources'],
  ['authority_plus_second', 'Authority source + second check'],
];
const RIGHTS: [string, string][] = [
  ['owned', 'Ours'],
  ['licensed', 'Licensed'],
  ['permission_granted', 'Permission given'],
  ['public_domain', 'Public domain'],
  ['not_approved', 'Not cleared'],
];

type StatusPrompt = { action: string; title: string; required: boolean } | null;

function toForm(s: SpotEditorData): FormValues {
  return {
    name: s.name,
    aliases: csv(s.aliases),
    short_description: s.short_description ?? '',
    description: s.description ?? '',
    locality: s.locality ?? '',
    address_text: s.address_text ?? '',
    lat: s.lat?.toString() ?? '',
    lng: s.lng?.toString() ?? '',
    best_time: s.best_time ?? '',
    parking_info: s.parking_info ?? '',
    hours_text: s.opening_hours?.text ?? '',
    access_notes: s.access_notes ?? '',
    safety_notes: s.safety_notes ?? '',
    respect_notes: s.respect_notes ?? '',
    search_tags: csv(s.search_tags),
    crowd_note: s.crowd_guide?.note ?? '',
    internal_notes: s.internal_notes ?? '',
  };
}

function toChoices(s: SpotEditorData): Choices {
  return {
    category: s.primary_category_slug,
    region: s.region,
    labels: s.discovery_labels,
    price: s.price_band,
    access: s.public_access_status,
    precision: s.location_precision,
    safetyTags: s.safety_tags,
    respectTags: s.respect_tags,
    attributes: s.verified_attributes,
    method: s.verification_method,
    hoursVerified: Boolean(s.opening_hours?.verified_at),
    safetyReviewed: Boolean(s.safety_reviewed_at),
  };
}

export default function SpotEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'spot', id],
    queryFn: () => adminApi.spot(id),
    refetchOnMount: 'always',
  });
  const categories = useCategories();
  const { control, handleSubmit, reset } = useForm<FormValues>();
  const [choices, setChoices] = useState<Choices | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const [missing, setMissing] = useState<ChecklistItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<StatusPrompt>(null);
  const [pendingSave, setPendingSave] = useState<Record<string, unknown> | null>(null);

  const spot = query.data;
  useEffect(() => {
    if (spot) {
      reset(toForm(spot));
      setChoices(toChoices(spot));
    }
  }, [spot, reset]);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin'] });
    await client.invalidateQueries({ queryKey: ['cards'] });
    await client.invalidateQueries({ queryKey: ['spot'] });
  };

  if (query.isPending || !choices)
    return (
      <Screen edges={['bottom']}>
        <LoadingState />
      </Screen>
    );
  if (query.isError || !spot)
    return (
      <Screen edges={['bottom']}>
        <ErrorState body={adminErrorText(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );

  const live = spot.verification_status === 'published' || spot.verification_status === 'stale';
  const choose = (patch: Partial<Choices>) => setChoices({ ...choices, ...patch });

  const buildPayload = (values: FormValues): Record<string, unknown> | string => {
    const payload: Record<string, unknown> = {
      name: values.name,
      aliases: fromCsv(values.aliases),
      short_description: values.short_description,
      description: values.description,
      primary_category_slug: choices.category,
      discovery_labels: choices.labels,
      region: choices.region,
      locality: values.locality,
      address_text: values.address_text,
      location_precision: choices.precision,
      public_access_status: choices.access,
      price_band: choices.price,
      best_time: values.best_time,
      parking_info: values.parking_info,
      opening_hours: values.hours_text.trim()
        ? {
            text: values.hours_text.trim(),
            verified_at: choices.hoursVerified
              ? (spot.opening_hours?.verified_at ?? new Date().toISOString().slice(0, 10))
              : null,
          }
        : null,
      safety_tags: choices.safetyTags,
      respect_tags: choices.respectTags,
      safety_notes: values.safety_notes,
      respect_notes: values.respect_notes,
      access_notes: values.access_notes,
      verified_attributes: choices.attributes,
      search_tags: fromCsv(values.search_tags).map((t) => t.toLowerCase()),
      crowd_guide: values.crowd_note.trim()
        ? { ...(spot.crowd_guide ?? {}), note: values.crowd_note.trim() }
        : spot.crowd_guide,
      verification_method: choices.method,
      internal_notes: values.internal_notes,
    };
    if (choices.safetyReviewed !== Boolean(spot.safety_reviewed_at))
      payload.safety_reviewed = choices.safetyReviewed;
    if (values.lat.trim() || values.lng.trim()) {
      const lat = Number(values.lat);
      const lng = Number(values.lng);
      if (!isWithinGoa({ lat, lng }))
        return 'Those coordinates are not in Goa. Check latitude and longitude.';
      if (lat !== spot.lat || lng !== spot.lng) {
        payload.lat = lat;
        payload.lng = lng;
      }
    }
    return payload;
  };

  const save = async (payload: Record<string, unknown>, reason: string | null) => {
    setBusy('save');
    setMessage(null);
    try {
      await adminApi.saveSpot(id, payload, reason);
      await refresh();
      setMessage({ tone: 'info', text: 'Saved.' });
    } catch (e) {
      const text = adminErrorText(e);
      // A live listing needs a reason for safety or access changes: ask, then retry.
      if (String(e instanceof Error ? e.message : e).includes('reason_required_for_safety_edit')) {
        setPendingSave(payload);
      } else {
        setMessage({ tone: 'warning', text });
      }
    } finally {
      setBusy(null);
    }
  };

  const onSave = handleSubmit(async (values) => {
    const payload = buildPayload(values);
    if (typeof payload === 'string') setMessage({ tone: 'warning', text: payload });
    else await save(payload, null);
  });

  const setStatus = async (action: string, reason: string | null) => {
    setBusy(action);
    setMessage(null);
    setMissing(null);
    try {
      const result = await adminApi.setSpotStatus(id, action, reason);
      if (!result.ok && result.missing) setMissing(result.missing);
      else if (!result.ok)
        setMessage({
          tone: 'warning',
          text: 'That action does not apply to this place right now.',
        });
      else
        setMessage({
          tone: 'info',
          text: action === 'publish' ? 'Published. It is now visible in the app.' : 'Done.',
        });
      await refresh();
    } catch (e) {
      setMessage({ tone: 'warning', text: adminErrorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const addPhoto = async () => {
    setBusy('photo');
    setMessage(null);
    try {
      const added = await pickAndUploadSpotPhoto(id);
      if (added) {
        await refresh();
        setMessage({
          tone: 'info',
          text: 'Photo uploaded. Set its rights status before it can appear publicly.',
        });
      }
    } catch (e) {
      setMessage({ tone: 'warning', text: `Upload failed: ${adminErrorText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const subcategories = (categories.data ?? []).filter((c) => c.parent_slug != null);
  const tagChips = (
    all: Record<string, string>,
    selected: string[],
    key: 'safetyTags' | 'respectTags' | 'attributes',
  ) => (
    <Row>
      {Object.entries(all).map(([code, label]) => (
        <Chip
          key={code}
          label={label}
          selected={selected.includes(code)}
          onPress={() => choose({ [key]: toggle(selected, code) } as Partial<Choices>)}
        />
      ))}
    </Row>
  );
  const single = <T extends string | null>(
    options: [string, string][],
    value: T,
    onPick: (next: string) => void,
  ) => (
    <Row>
      {options.map(([code, label]) => (
        <Chip key={code} label={label} selected={value === code} onPress={() => onPick(code)} />
      ))}
    </Row>
  );

  return (
    <Screen scroll edges={['bottom']}>
      <Stack.Screen options={{ title: spot.name }} />
      <Row>
        <Badge label={spot.verification_status} tone={live ? 'quiet' : 'neutral'} />
        {spot.availability_status !== 'open' ? (
          <Badge label={spot.availability_status.replace(/_/g, ' ')} tone="warning" />
        ) : null}
        {spot.safety_blocked ? (
          <Badge label="Safety block" tone="busy" icon="warning-outline" />
        ) : null}
        <Badge label={`Checked ${shortDate(spot.last_verified_at)}`} />
      </Row>
      {spot.safety_blocked ? (
        <Notice tone="danger">
          Blocked: {spot.safety_block_reason}. Hidden from the app until unblocked.
        </Notice>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Section title="Publish checklist">
        <Card>
          {spot.checklist.map((item) => (
            <View key={item.code} style={styles.check}>
              <Ionicons
                name={item.ok ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={item.ok ? colors.crowdQuiet : colors.inkFaint}
              />
              <AppText style={styles.flex} color={item.ok ? colors.ink : colors.inkMuted}>
                {item.label}
                {item.ok ? '' : ' (to do)'}
              </AppText>
            </View>
          ))}
        </Card>
        {missing ? (
          <Notice tone="warning">
            Not published. Still to do: {missing.map((m) => m.label).join('; ')}.
          </Notice>
        ) : null}
      </Section>

      <Section title="Basics">
        <FormField control={control} name="name" label="Name" required />
        <FormField control={control} name="aliases" label="Other names" hint="Comma separated" />
        <AppText variant="label">Category</AppText>
        <Row>
          {subcategories.map((c) => (
            <Chip
              key={c.slug}
              label={c.label}
              selected={choices.category === c.slug}
              onPress={() => choose({ category: c.slug })}
            />
          ))}
        </Row>
        <AppText variant="label">Positioning</AppText>
        <Row>
          {DISCOVERY_LABELS.map((label) => (
            <Chip
              key={label}
              label={DISCOVERY_LABEL_TEXT[label]}
              selected={choices.labels.includes(label)}
              onPress={() => choose({ labels: toggle(choices.labels, label) })}
            />
          ))}
        </Row>
        <FormField
          control={control}
          name="short_description"
          label="Short description"
          hint="Your own words, up to 280 characters. Never copied from a source."
          multiline
        />
        <FormField
          control={control}
          name="description"
          label="Longer description (optional)"
          multiline
        />
        <FormField
          control={control}
          name="search_tags"
          label="Search words"
          hint="Comma separated, e.g. quiet, sunset, family-friendly"
        />
      </Section>

      <Section title="Where">
        <FormField control={control} name="locality" label="Locality" />
        <AppText variant="label">Region</AppText>
        {single(
          REGIONS.map((r) => [r, REGION_LABELS[r]] as [string, string]),
          choices.region,
          (region) => choose({ region }),
        )}
        <FormField control={control} name="address_text" label="Address (optional)" />
        <FormField control={control} name="lat" label="Latitude" keyboardType="decimal-pad" />
        <FormField control={control} name="lng" label="Longitude" keyboardType="decimal-pad" />
        {spot.lat != null && spot.lng != null ? (
          <Button
            label="Check the pin on a map"
            kind="ghost"
            icon="map-outline"
            onPress={() =>
              void Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`,
              )
            }
          />
        ) : null}
        <AppText variant="label">Pin status</AppText>
        {single(PRECISION, choices.precision, (precision) => choose({ precision }))}
        <AppText variant="label">Public access</AppText>
        {single(ACCESS, choices.access, (access) => choose({ access }))}
        <FormField
          control={control}
          name="access_notes"
          label="Getting there"
          hint="Directions and access guidance"
          multiline
        />
        <FormField control={control} name="parking_info" label="Parking" />
      </Section>

      <Section title="Practical details">
        <AppText variant="caption" color={colors.inkMuted}>
          Leave a field empty if it is not verified. The app shows "Not verified" instead of a
          guess.
        </AppText>
        <FormField control={control} name="best_time" label="Best time" />
        <FormField control={control} name="hours_text" label="Opening hours" />
        <Row>
          <Chip
            label="Hours verified"
            selected={choices.hoursVerified}
            onPress={() => choose({ hoursVerified: !choices.hoursVerified })}
          />
        </Row>
        <AppText variant="label">Cost</AppText>
        {single(
          PRICE_BANDS.map((p) => [p, PRICE_BAND_TEXT[p]] as [string, string]),
          choices.price,
          (price) => choose({ price: choices.price === price ? null : price }),
        )}
        <AppText variant="label">Verified features</AppText>
        {tagChips(VERIFIED_ATTRIBUTES, choices.attributes, 'attributes')}
        <FormField
          control={control}
          name="crowd_note"
          label="Usually-busy note (editorial)"
          hint="Shown as guidance, never as live data. Busy time windows are set in the database for now."
        />
      </Section>

      <Section title="Safety and respect">
        <AppText variant="label">Safety</AppText>
        {tagChips(SAFETY_TAGS, choices.safetyTags, 'safetyTags')}
        <FormField control={control} name="safety_notes" label="Safety notes" multiline />
        <AppText variant="label">Respect</AppText>
        {tagChips(RESPECT_TAGS, choices.respectTags, 'respectTags')}
        <FormField control={control} name="respect_notes" label="Respect notes" multiline />
        <Row>
          <Chip
            label="I have reviewed safety and access for this place"
            selected={choices.safetyReviewed}
            onPress={() => choose({ safetyReviewed: !choices.safetyReviewed })}
          />
        </Row>
        <AppText variant="label">How was it verified?</AppText>
        {single(METHODS, choices.method, (method) => choose({ method }))}
        <FormField
          control={control}
          name="internal_notes"
          label="Internal notes (never shown publicly)"
          multiline
        />
      </Section>

      <Button
        label="Save changes"
        icon="save-outline"
        loading={busy === 'save'}
        onPress={() => void onSave()}
      />

      <Section title={`Photos (${spot.media.length})`}>
        <AppText variant="caption" color={colors.inkMuted}>
          Only photos with rights recorded are shown publicly. Do not upload a creator's photo
          without written permission.
        </AppText>
        {spot.media.map((media) => (
          <Card key={media.id}>
            <Image
              source={{ uri: mediaUrl(media.thumb_path ?? media.storage_path) ?? undefined }}
              style={styles.photo}
              contentFit="cover"
              accessibilityLabel={media.alt_text ?? 'Listing photo'}
            />
            <Row>
              {RIGHTS.map(([code, label]) => (
                <Chip
                  key={code}
                  label={label}
                  selected={media.rights_status === code}
                  onPress={() =>
                    void adminApi
                      .saveMedia(media.id, id, { rights_status: code })
                      .then(refresh)
                      .catch((e) => setMessage({ tone: 'warning', text: adminErrorText(e) }))
                  }
                />
              ))}
            </Row>
            <Button
              label="Delete photo"
              kind="danger"
              icon="trash-outline"
              onPress={() =>
                Alert.alert(
                  'Delete this photo?',
                  'It is removed from the listing and from storage.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () =>
                        void deleteSpotPhoto(media.id)
                          .then(refresh)
                          .catch((e) => setMessage({ tone: 'warning', text: adminErrorText(e) })),
                    },
                  ],
                )
              }
            />
          </Card>
        ))}
        <Button
          label="Add a photo"
          kind="secondary"
          icon="image-outline"
          loading={busy === 'photo'}
          onPress={() => void addPhoto()}
        />
      </Section>

      <Section title={`Sources (${spot.sources.length})`}>
        {spot.sources.map((source) => (
          <Card key={source.id}>
            <Row>
              <Badge label={source.source_type.replace(/_/g, ' ')} />
              <Badge
                label={source.verification_status}
                tone={source.verification_status === 'verified' ? 'quiet' : 'neutral'}
              />
            </Row>
            <AppText variant="subheading">
              {source.source_title ?? source.publisher ?? 'Untitled source'}
            </AppText>
            {source.evidence_excerpt ? (
              <AppText variant="caption">"{source.evidence_excerpt}"</AppText>
            ) : null}
            <Row>
              <Chip
                label="Verified"
                selected={source.verification_status === 'verified'}
                onPress={() =>
                  void adminApi
                    .saveSource(source.id, {
                      verification_status:
                        source.verification_status === 'verified' ? 'unverified' : 'verified',
                    })
                    .then(refresh)
                }
              />
              <Chip
                label="Show on public page"
                selected={source.is_public}
                onPress={() =>
                  void adminApi
                    .saveSource(source.id, { is_public: !source.is_public })
                    .then(refresh)
                }
              />
              {source.source_url ? (
                <Chip
                  label="Open"
                  icon="open-outline"
                  onPress={() => void Linking.openURL(source.source_url!).catch(() => undefined)}
                />
              ) : null}
            </Row>
          </Card>
        ))}
        <Button
          label="Record a team visit as a source"
          kind="secondary"
          icon="walk-outline"
          onPress={() =>
            void adminApi
              .saveSource(null, {
                spot_id: id,
                source_type: 'team_visit',
                source_title: `Team visit, ${shortDate(new Date().toISOString())}`,
                verification_status: 'verified',
              })
              .then(refresh)
              .catch((e) => setMessage({ tone: 'warning', text: adminErrorText(e) }))
          }
        />
      </Section>

      <Section title="Status">
        {!live ? (
          <Button
            label="Publish"
            icon="cloud-upload-outline"
            loading={busy === 'publish'}
            onPress={() => void setStatus('publish', null)}
          />
        ) : null}
        <Button
          label="I rechecked this today"
          kind="secondary"
          icon="checkmark-done-outline"
          loading={busy === 'reverify'}
          onPress={() => void setStatus('reverify', null)}
        />
        {live ? (
          <Button
            label="Unpublish (back to review)"
            kind="secondary"
            onPress={() => void setStatus('unpublish', null)}
          />
        ) : null}
        {spot.verification_status === 'published' ? (
          <Button
            label="Mark details as needing a recheck"
            kind="secondary"
            onPress={() => void setStatus('mark_stale', null)}
          />
        ) : null}
        {spot.availability_status === 'open' ? (
          <Button
            label="Mark temporarily unavailable"
            kind="secondary"
            onPress={() => void setStatus('mark_temporarily_unavailable', null)}
          />
        ) : (
          <Button
            label="Mark open again"
            kind="secondary"
            onPress={() => void setStatus('mark_open', null)}
          />
        )}
        <Button
          label="Suspend now"
          kind="danger"
          icon="pause-circle-outline"
          onPress={() => setPrompt({ action: 'suspend', title: 'Suspend listing', required: true })}
        />
        {spot.safety_blocked ? (
          <Button
            label="Remove safety block"
            kind="secondary"
            onPress={() =>
              setPrompt({ action: 'unblock', title: 'Remove safety block', required: true })
            }
          />
        ) : (
          <Button
            label="Block as unsafe"
            kind="danger"
            icon="warning-outline"
            onPress={() =>
              setPrompt({ action: 'block_unsafe', title: 'Block as unsafe', required: true })
            }
          />
        )}
        <Button
          label="Mark permanently closed"
          kind="danger"
          onPress={() =>
            setPrompt({
              action: 'mark_permanently_closed',
              title: 'Permanently closed',
              required: true,
            })
          }
        />
        <Button
          label="Withdraw listing"
          kind="danger"
          onPress={() =>
            setPrompt({ action: 'withdraw', title: 'Withdraw listing', required: true })
          }
        />
      </Section>

      <Section title="Partner">
        {spot.partners.map((partner) => (
          <Button
            key={partner.id}
            label={`${partner.business_name} (${partner.partner_status})`}
            kind="secondary"
            onPress={() => router.push(`/admin/partners/${partner.id}`)}
          />
        ))}
        <Button
          label="Add a partner for this place"
          kind="ghost"
          icon="add"
          onPress={() =>
            router.push({
              pathname: '/admin/partners/[id]',
              params: { id: 'new', spotId: id, spotName: spot.name },
            })
          }
        />
      </Section>

      <ReasonSheet
        visible={prompt != null}
        title={prompt?.title ?? ''}
        confirmLabel="Confirm"
        required={prompt?.required ?? true}
        onClose={() => setPrompt(null)}
        onConfirm={async (reason) => {
          if (prompt) await setStatus(prompt.action, reason);
        }}
      />
      <ReasonSheet
        visible={pendingSave != null}
        title="Why is this changing?"
        label="This edits safety or access details on a live listing"
        confirmLabel="Save with reason"
        onClose={() => setPendingSave(null)}
        onConfirm={async (reason) => {
          if (pendingSave) await save(pendingSave, reason);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  check: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
});
