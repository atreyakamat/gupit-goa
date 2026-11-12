import {
  CROWD_FILTERS,
  DISCOVERY_LABELS,
  DISCOVERY_LABEL_TEXT,
  PRICE_BANDS,
  PRICE_BAND_TEXT,
  RADIUS_OPTIONS_KM,
  REGIONS,
  REGION_LABELS,
  VERIFIED_ATTRIBUTES,
  countActiveFilters,
  toggle,
  type CrowdFilter,
  type SpotFilters,
} from '@gupit/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Chip, Row, Screen, Section } from '@/components/ui';
import { useNearMe } from '@/features/explore/useNearMe';
import { track } from '@/lib/analytics';
import { useCategories } from '@/lib/hooks';
import { useAppStore } from '@/store/app';
import { colors, spacing } from '@/theme/tokens';

const CROWD_TEXT: Record<CrowdFilter, string> = {
  quiet: 'Quiet now',
  moderate: 'Moderate now',
  busy: 'Busy now',
  unavailable: 'No live crowd data',
};

/**
 * All filters combine. "Open now" is deliberately absent: opening hours are not verified
 * widely enough yet to filter on without misleading people.
 */
export default function Filters() {
  const router = useRouter();
  const { filters, setFilters, position } = useAppStore();
  const [draft, setDraft] = useState<SpotFilters>(filters);
  const categories = useCategories();
  const nearMe = useNearMe();
  const groups = (categories.data ?? []).filter((c) => c.parent_slug == null);
  const count = countActiveFilters(draft);

  const set = (patch: Partial<SpotFilters>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <Screen scroll edges={['bottom']}>
      <View style={styles.spacer} />
      {groups.map((group) => {
        const children = (categories.data ?? []).filter((c) => c.parent_slug === group.slug);
        return (
          <Section key={group.slug} title={group.label}>
            <Row>
              <Chip
                label={`All ${group.label.toLowerCase()}`}
                selected={draft.categorySlugs.includes(group.slug)}
                onPress={() => set({ categorySlugs: toggle(draft.categorySlugs, group.slug) })}
              />
              {children.map((child) => (
                <Chip
                  key={child.slug}
                  label={child.label}
                  selected={draft.categorySlugs.includes(child.slug)}
                  onPress={() => set({ categorySlugs: toggle(draft.categorySlugs, child.slug) })}
                />
              ))}
            </Row>
          </Section>
        );
      })}

      <Section title="Area">
        <Row>
          {REGIONS.map((region) => (
            <Chip
              key={region}
              label={REGION_LABELS[region]}
              selected={draft.regions.includes(region)}
              onPress={() => set({ regions: toggle(draft.regions, region) })}
            />
          ))}
        </Row>
      </Section>

      <Section title="Distance from me">
        {position ? (
          <Row>
            {RADIUS_OPTIONS_KM.map((km) => (
              <Chip
                key={km}
                label={`Within ${km} km`}
                selected={draft.radiusKm === km}
                onPress={() => set({ radiusKm: draft.radiusKm === km ? null : km })}
              />
            ))}
          </Row>
        ) : (
          <>
            <AppText color={colors.inkMuted}>
              Distance filters need your location. Without it you can still filter by area.
            </AppText>
            <Button
              label="Use my location"
              kind="secondary"
              icon="locate-outline"
              onPress={() => void nearMe.start()}
              loading={nearMe.busy}
            />
          </>
        )}
      </Section>

      <Section title="Kind of place">
        <Row>
          {DISCOVERY_LABELS.map((label) => (
            <Chip
              key={label}
              label={DISCOVERY_LABEL_TEXT[label]}
              selected={draft.labels.includes(label)}
              onPress={() => set({ labels: toggle(draft.labels, label) })}
            />
          ))}
        </Row>
      </Section>

      <Section title="Crowd right now">
        <AppText variant="caption" color={colors.inkMuted}>
          Based only on recent reports from people at the place. Most places have no live data most
          of the time.
        </AppText>
        <Row>
          {CROWD_FILTERS.map((level) => (
            <Chip
              key={level}
              label={CROWD_TEXT[level]}
              selected={draft.crowd.includes(level)}
              onPress={() => set({ crowd: toggle(draft.crowd, level) })}
            />
          ))}
        </Row>
      </Section>

      <Section title="Price">
        <AppText variant="caption" color={colors.inkMuted}>
          Only places with a known price band are shown when you pick one.
        </AppText>
        <Row>
          {PRICE_BANDS.map((band) => (
            <Chip
              key={band}
              label={PRICE_BAND_TEXT[band]}
              selected={draft.priceBands.includes(band)}
              onPress={() => set({ priceBands: toggle(draft.priceBands, band) })}
            />
          ))}
        </Row>
      </Section>

      <Section title="Verified features">
        <AppText variant="caption" color={colors.inkMuted}>
          Shown only where a reviewer has checked the fact.
        </AppText>
        <Row>
          {Object.entries(VERIFIED_ATTRIBUTES).map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              selected={draft.attributes.includes(key)}
              onPress={() => set({ attributes: toggle(draft.attributes, key) })}
            />
          ))}
        </Row>
      </Section>

      <Section title="Partners">
        <Row>
          <Chip
            label="Partner places only"
            selected={draft.partnerOnly}
            onPress={() => set({ partnerOnly: !draft.partnerOnly })}
          />
        </Row>
      </Section>

      <View style={styles.actions}>
        <Button
          label={count ? `Show results (${count} filter${count === 1 ? '' : 's'})` : 'Show results'}
          onPress={() => {
            setFilters(draft);
            if (count) track('filter_applied', { count });
            router.back();
          }}
        />
        <Button
          label="Clear all"
          kind="ghost"
          disabled={count === 0}
          onPress={() =>
            setDraft({
              ...draft,
              categorySlugs: [],
              regions: [],
              labels: [],
              crowd: [],
              priceBands: [],
              attributes: [],
              partnerOnly: false,
              radiusKm: null,
            })
          }
        />
      </View>
      {nearMe.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: { height: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
