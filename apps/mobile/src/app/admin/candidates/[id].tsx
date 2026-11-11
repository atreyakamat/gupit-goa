import { REGIONS, REGION_LABELS } from '@gupit/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import {
  AppText,
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
} from '@/components/ui';
import { adminApi, adminErrorText, type CandidateDetail } from '@/features/admin/api';
import { ListRow, ReasonSheet } from '@/features/admin/ui';
import { useCategories } from '@/lib/hooks';
import { colors } from '@/theme/tokens';

type Prompt =
  | { kind: 'reject' }
  | { kind: 'needs_more_evidence' }
  | { kind: 'resolve'; code: string }
  | { kind: 'add_flag' }
  | { kind: 'merge_candidate'; id: string; name: string }
  | { kind: 'merge_spot'; id: string; name: string }
  | null;

const BREAKDOWN: [keyof NonNullable<CandidateDetail['confidence_breakdown']>, string, number][] = [
  ['source_quality', 'Source quality', 25],
  ['corroboration', 'Independent corroboration', 20],
  ['identity', 'Identity and category', 10],
  ['location', 'Location', 20],
  ['recency', 'Recency', 15],
  ['safety_access', 'Safety and access evidence', 10],
];

export default function CandidateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'candidate', id],
    queryFn: () => adminApi.candidate(id),
    refetchOnMount: 'always',
  });
  const categories = useCategories();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: '',
    category: '',
    locality: '',
    region: '',
    lat: '',
    lng: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => client.invalidateQueries({ queryKey: ['admin'] });

  if (query.isPending)
    return (
      <Screen edges={['bottom']}>
        <LoadingState />
      </Screen>
    );
  if (query.isError)
    return (
      <Screen edges={['bottom']}>
        <ErrorState body={adminErrorText(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  const c = query.data;
  const closed = ['approved', 'rejected', 'merged'].includes(c.review_status);
  const openBlocks = c.risk_flags.filter((f) => f.severity === 'block' && !f.resolved_at);
  const subcategories = (categories.data ?? []).filter((cat) => cat.parent_slug != null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    run(async () => {
      const result = await adminApi.decideCandidate(id, 'approve', null);
      if (!result.ok) {
        setError(
          result.reason === 'unresolved_risk_flags'
            ? 'Resolve every blocking risk flag before approving.'
            : 'Set a category before approving.',
        );
        return;
      }
      if (result.spot_id) router.replace(`/admin/spots/${result.spot_id}`);
    });

  const saveEdit = () =>
    run(async () => {
      const data: Record<string, unknown> = {
        candidate_name: form.name,
        proposed_category_slug: form.category || null,
        proposed_locality: form.locality,
        proposed_region: form.region || null,
      };
      if (form.lat.trim() && form.lng.trim()) {
        data.lat = Number(form.lat);
        data.lng = Number(form.lng);
        data.location_status = 'approximate';
      }
      await adminApi.saveCandidate(id, data);
      setEditing(false);
    });

  const extracted = Object.entries(c.extracted_fields).filter(
    ([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0),
  );

  return (
    <Screen scroll edges={['bottom']}>
      <View style={{ gap: 4 }}>
        <AppText variant="title">{c.candidate_name}</AppText>
        <AppText color={colors.inkMuted}>
          {[
            c.proposed_category_slug ?? 'No category yet',
            c.proposed_locality,
            c.proposed_region
              ? REGION_LABELS[c.proposed_region as keyof typeof REGION_LABELS]
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
        <Row>
          <Badge
            label={c.review_status.replace(/_/g, ' ')}
            tone={c.review_status === 'blocked' ? 'busy' : 'primary'}
          />
          <Badge label={c.discovered_by === 'manual' ? 'Manual lead' : 'Research worker'} />
          {c.confidence_score != null ? (
            <Badge label={`Readiness ${c.confidence_score}/100`} />
          ) : null}
        </Row>
      </View>

      <Notice>
        A candidate is not a listing. Approving creates a draft place; it goes public only after the
        publish checklist passes.
      </Notice>
      {error ? <Notice tone="warning">{error}</Notice> : null}

      {c.risk_flags.length ? (
        <Section title="Risk flags">
          {c.risk_flags.map((flag, index) => (
            <Card key={`${flag.code}-${index}`}>
              <Row>
                <Badge
                  label={flag.severity === 'block' ? 'Blocks publishing' : 'Warning'}
                  tone={flag.severity === 'block' ? 'busy' : 'warning'}
                  icon="warning-outline"
                />
                <Badge label={flag.source} />
                {flag.resolved_at ? <Badge label="Resolved" tone="quiet" icon="checkmark" /> : null}
              </Row>
              <AppText variant="subheading">{flag.code.replace(/_/g, ' ')}</AppText>
              {flag.note ? <AppText>{flag.note}</AppText> : null}
              {flag.resolution_note ? (
                <AppText variant="caption" color={colors.inkMuted}>
                  Resolution: {flag.resolution_note}
                </AppText>
              ) : null}
              {!flag.resolved_at && !closed ? (
                <Button
                  label="Resolve with a note"
                  kind="secondary"
                  onPress={() => setPrompt({ kind: 'resolve', code: flag.code })}
                />
              ) : null}
            </Card>
          ))}
        </Section>
      ) : null}

      <Section title="Location">
        <Card>
          <AppText>
            {c.lat != null && c.lng != null
              ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
              : 'No coordinates yet'}
          </AppText>
          <AppText variant="caption" color={colors.inkMuted}>
            Status: {c.location_status.replace(/_/g, ' ')}
            {c.location_confidence != null
              ? ` · confidence ${Math.round(c.location_confidence * 100)}%`
              : ''}
            . The pin is always rechecked on the place editor before publishing.
          </AppText>
          {c.lat != null && c.lng != null ? (
            <Button
              label="Check on a map"
              kind="ghost"
              icon="map-outline"
              onPress={() =>
                void Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`,
                )
              }
            />
          ) : null}
        </Card>
      </Section>

      {c.confidence_breakdown ? (
        <Section title="Why this score">
          <Card>
            {BREAKDOWN.map(([key, label, max]) => (
              <Row key={key} style={{ justifyContent: 'space-between' }}>
                <AppText>{label}</AppText>
                <AppText variant="label">
                  {String(c.confidence_breakdown?.[key] ?? 0)} / {max}
                </AppText>
              </Row>
            ))}
            {(c.confidence_breakdown.notes ?? []).map((note) => (
              <AppText key={note} variant="caption" color={colors.inkMuted}>
                • {note}
              </AppText>
            ))}
            <AppText variant="caption" color={colors.inkMuted}>
              The score orders the queue. It never publishes anything.
            </AppText>
          </Card>
        </Section>
      ) : null}

      <Section title={`Sources (${c.sources.length})`}>
        {c.sources.length === 0 ? (
          <AppText color={colors.inkMuted}>No source evidence yet.</AppText>
        ) : null}
        {c.sources.map((source) => (
          <Card key={source.id}>
            <Row>
              <Badge
                label={source.source_type.replace(/_/g, ' ')}
                tone={source.source_type === 'social_lead' ? 'warning' : 'neutral'}
              />
              {source.source_quality ? (
                <Badge label={`Quality ${source.source_quality}/5`} />
              ) : null}
            </Row>
            <AppText variant="subheading">
              {source.source_title ?? source.publisher ?? 'Untitled source'}
            </AppText>
            {source.evidence_excerpt ? <AppText>"{source.evidence_excerpt}"</AppText> : null}
            {source.claims_supported.length ? (
              <AppText variant="caption" color={colors.inkMuted}>
                Supports: {source.claims_supported.join(', ')}
              </AppText>
            ) : null}
            {source.rights_notes ? (
              <AppText variant="caption" color={colors.inkMuted}>
                {source.rights_notes}
              </AppText>
            ) : null}
            {source.source_url ? (
              <Button
                label="Open source"
                kind="ghost"
                icon="open-outline"
                onPress={() => void Linking.openURL(source.source_url!).catch(() => undefined)}
              />
            ) : null}
          </Card>
        ))}
      </Section>

      {extracted.length ? (
        <Section title="Extracted details (unverified)">
          <Card>
            {extracted.map(([key, value]) => (
              <View key={key}>
                <AppText variant="label" color={colors.inkMuted}>
                  {key.replace(/_/g, ' ')}
                </AppText>
                <AppText>{Array.isArray(value) ? value.join(', ') : String(value)}</AppText>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {c.cluster.length || c.possible_duplicate_spot ? (
        <Section title="Possible duplicates">
          <AppText variant="caption" color={colors.inkMuted}>
            A similar name alone is never treated as the same place. Merge only if you are sure.
          </AppText>
          {c.possible_duplicate_spot ? (
            <ListRow
              title={c.possible_duplicate_spot.name}
              subtitle={`Existing place · ${c.possible_duplicate_spot.locality ?? ''} · ${c.possible_duplicate_spot.verification_status}`}
              right={
                !closed ? (
                  <Button
                    label="Merge"
                    kind="ghost"
                    onPress={() =>
                      setPrompt({
                        kind: 'merge_spot',
                        id: c.possible_duplicate_spot!.id,
                        name: c.possible_duplicate_spot!.name,
                      })
                    }
                  />
                ) : undefined
              }
            />
          ) : null}
          {c.cluster.map((other) => (
            <ListRow
              key={other.id}
              title={other.candidate_name}
              subtitle={`Candidate · ${other.proposed_locality ?? ''} · ${other.review_status.replace(/_/g, ' ')}`}
              onPress={() => router.push(`/admin/candidates/${other.id}`)}
              right={
                !closed ? (
                  <Button
                    label="Merge"
                    kind="ghost"
                    onPress={() =>
                      setPrompt({
                        kind: 'merge_candidate',
                        id: other.id,
                        name: other.candidate_name,
                      })
                    }
                  />
                ) : undefined
              }
            />
          ))}
        </Section>
      ) : null}

      {c.review_notes ? (
        <Section title="Review notes">
          <AppText>{c.review_notes}</AppText>
        </Section>
      ) : null}

      {closed ? (
        c.approved_spot_id ? (
          <Button
            label="Open the place"
            icon="open-outline"
            onPress={() => router.push(`/admin/spots/${c.approved_spot_id}`)}
          />
        ) : null
      ) : (
        <Section title="Decision">
          <Button
            label="Edit details"
            kind="secondary"
            icon="create-outline"
            onPress={() => {
              setForm({
                name: c.candidate_name,
                category: c.proposed_category_slug ?? '',
                locality: c.proposed_locality ?? '',
                region: c.proposed_region ?? '',
                lat: c.lat?.toString() ?? '',
                lng: c.lng?.toString() ?? '',
              });
              setEditing(true);
            }}
          />
          <Button
            label="Approve: create draft place"
            icon="checkmark-circle-outline"
            disabled={openBlocks.length > 0}
            loading={busy}
            onPress={() => void approve()}
          />
          {openBlocks.length ? (
            <AppText variant="caption" color={colors.danger}>
              {openBlocks.length} blocking flag(s) must be resolved first.
            </AppText>
          ) : null}
          <Button
            label="Ask for more evidence"
            kind="secondary"
            onPress={() => setPrompt({ kind: 'needs_more_evidence' })}
          />
          <Button
            label="Add a risk flag"
            kind="secondary"
            icon="flag-outline"
            onPress={() => setPrompt({ kind: 'add_flag' })}
          />
          <Button
            label="Reject"
            kind="danger"
            icon="close-circle-outline"
            onPress={() => setPrompt({ kind: 'reject' })}
          />
        </Section>
      )}

      <ReasonSheet
        visible={prompt != null}
        onClose={() => setPrompt(null)}
        title={
          prompt?.kind === 'reject'
            ? 'Reject candidate'
            : prompt?.kind === 'resolve'
              ? 'Resolve risk flag'
              : prompt?.kind === 'add_flag'
                ? 'Add a blocking risk flag'
                : prompt?.kind === 'needs_more_evidence'
                  ? 'Ask for more evidence'
                  : prompt
                    ? `Merge into ${prompt.name}`
                    : ''
        }
        label={
          prompt?.kind === 'resolve'
            ? 'What did you check, and why is it safe to proceed?'
            : prompt?.kind === 'add_flag'
              ? 'What is the concern?'
              : 'Note'
        }
        required={
          prompt?.kind !== 'needs_more_evidence' &&
          prompt?.kind !== 'merge_candidate' &&
          prompt?.kind !== 'merge_spot'
        }
        confirmLabel="Confirm"
        onConfirm={async (note) => {
          if (!prompt) return;
          if (prompt.kind === 'resolve')
            await adminApi.flagCandidate(id, prompt.code, 'resolve', note);
          else if (prompt.kind === 'add_flag')
            await adminApi.flagCandidate(id, 'reviewer_concern', 'add', note);
          else if (prompt.kind === 'merge_candidate')
            await adminApi.decideCandidate(id, 'merge', note || null, { candidate: prompt.id });
          else if (prompt.kind === 'merge_spot')
            await adminApi.decideCandidate(id, 'merge', note || null, { spot: prompt.id });
          else await adminApi.decideCandidate(id, prompt.kind, note || null);
          await refresh();
          if (prompt.kind === 'reject' || prompt.kind.startsWith('merge')) router.back();
        }}
      />

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit candidate">
        <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <AppText variant="label">Category</AppText>
        <Row>
          {subcategories.map((cat) => (
            <Chip
              key={cat.slug}
              label={cat.label}
              selected={form.category === cat.slug}
              onPress={() => setForm({ ...form, category: cat.slug })}
            />
          ))}
        </Row>
        <Field
          label="Locality"
          value={form.locality}
          onChangeText={(locality) => setForm({ ...form, locality })}
        />
        <AppText variant="label">Region</AppText>
        <Row>
          {REGIONS.map((region) => (
            <Chip
              key={region}
              label={REGION_LABELS[region]}
              selected={form.region === region}
              onPress={() => setForm({ ...form, region })}
            />
          ))}
        </Row>
        <Field
          label="Latitude"
          value={form.lat}
          onChangeText={(lat) => setForm({ ...form, lat })}
          keyboardType="decimal-pad"
          hint="Only from a source or a map check. Never guess from the locality."
        />
        <Field
          label="Longitude"
          value={form.lng}
          onChangeText={(lng) => setForm({ ...form, lng })}
          keyboardType="decimal-pad"
        />
        {error ? <Notice tone="warning">{error}</Notice> : null}
        <Button label="Save" loading={busy} onPress={() => void saveEdit()} />
      </Sheet>
    </Screen>
  );
}
