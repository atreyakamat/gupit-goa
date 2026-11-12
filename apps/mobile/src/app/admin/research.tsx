import { REGIONS, REGION_LABELS } from '@gupit/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
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
import { adminApi, adminErrorText } from '@/features/admin/api';
import { ReasonSheet, shortDate } from '@/features/admin/ui';
import { colors } from '@/theme/tokens';

const RULES: [string, string][] = [
  ['allow', 'Allow'],
  ['lead_only', 'Lead only'],
  ['block', 'Block'],
];

/** Worker health, the per-adapter kill switch, source rules and manual discovery jobs. */
export default function Research() {
  const client = useQueryClient();
  const dash = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminApi.dashboard,
    refetchOnMount: 'always',
  });
  const adapters = useQuery({ queryKey: ['admin', 'adapters'], queryFn: adminApi.adapters });
  const rules = useQuery({ queryKey: ['admin', 'rules'], queryFn: adminApi.domainRules });
  const jobs = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: adminApi.jobs,
    refetchOnMount: 'always',
  });
  const events = useQuery({
    queryKey: ['admin', 'research-events'],
    queryFn: adminApi.researchEvents,
    refetchOnMount: 'always',
  });
  const [toggle, setToggle] = useState<{ adapter: string; enable: boolean } | null>(null);
  const [queryText, setQueryText] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [rule, setRule] = useState('lead_only');
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ['admin'] });
  const act = async (task: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await task();
      await refresh();
      setMessage(done);
    } catch (e) {
      setMessage(adminErrorText(e));
    }
  };

  if (dash.isPending)
    return (
      <Screen edges={['bottom']}>
        <LoadingState />
      </Screen>
    );
  if (dash.isError)
    return (
      <Screen edges={['bottom']}>
        <ErrorState body={adminErrorText(dash.error)} onRetry={() => void dash.refetch()} />
      </Screen>
    );

  return (
    <Screen scroll edges={['bottom']}>
      <Notice>
        The worker only creates candidates for review. It cannot publish, and it never fetches
        Instagram or other lead-only sites.
      </Notice>
      {message ? <Notice tone="warning">{message}</Notice> : null}

      <Section title="Worker health">
        {dash.data.workers.length === 0 ? (
          <AppText color={colors.inkMuted}>No worker has checked in yet.</AppText>
        ) : null}
        {dash.data.workers.map((worker) => {
          const minutes = Math.round((Date.now() - Date.parse(worker.last_seen_at)) / 60_000);
          return (
            <Card key={worker.worker_id}>
              <Row>
                <Badge
                  label={minutes <= 15 ? 'Seen recently' : `Silent for ${minutes} min`}
                  tone={minutes <= 15 ? 'quiet' : 'warning'}
                />
                <Badge label={worker.status} />
              </Row>
              <AppText variant="caption" color={colors.inkMuted}>
                {worker.worker_id}
              </AppText>
            </Card>
          );
        })}
      </Section>

      <Section title="Source adapters (kill switch)">
        {(adapters.data ?? []).map((adapter) => (
          <Card key={adapter.adapter}>
            <Row>
              <AppText variant="subheading" style={{ flex: 1 }}>
                {adapter.adapter}
              </AppText>
              <Badge
                label={adapter.is_enabled ? 'Enabled' : 'Stopped'}
                tone={adapter.is_enabled ? 'quiet' : 'busy'}
              />
            </Row>
            {adapter.notes ? (
              <AppText variant="caption" color={colors.inkMuted}>
                {adapter.notes}
              </AppText>
            ) : null}
            <Button
              label={adapter.is_enabled ? 'Stop this adapter' : 'Re-enable'}
              kind={adapter.is_enabled ? 'danger' : 'secondary'}
              onPress={() => setToggle({ adapter: adapter.adapter, enable: !adapter.is_enabled })}
            />
          </Card>
        ))}
      </Section>

      <Section title="Queue a discovery search">
        <Field
          label="Search query"
          placeholder="cafes in Assagao Goa"
          value={queryText}
          onChangeText={setQueryText}
          maxLength={160}
          hint="Cover popular and iconic places too, not only hidden ones."
        />
        <Row>
          {REGIONS.map((r) => (
            <Chip
              key={r}
              label={REGION_LABELS[r]}
              selected={region === r}
              onPress={() => setRegion(region === r ? null : r)}
            />
          ))}
        </Row>
        <Button
          label="Add to queue"
          kind="secondary"
          disabled={queryText.trim().length < 3}
          onPress={() =>
            void act(async () => {
              const id = await adminApi.enqueueJob(queryText, region, null);
              if (!id) throw new Error('That query is already queued this week.');
              setQueryText('');
            }, 'Queued. The worker picks it up on its next run.')
          }
        />
      </Section>

      <Section title="Recent jobs">
        {(jobs.data ?? []).slice(0, 12).map((job) => (
          <Row key={job.id} style={{ justifyContent: 'space-between' }}>
            <AppText style={{ flex: 1 }} numberOfLines={1}>
              {job.query ?? '(lead)'}
            </AppText>
            <Badge
              label={job.error_code ? `${job.status}: ${job.error_code}` : job.status}
              tone={
                job.status === 'failed' ? 'busy' : job.status === 'completed' ? 'quiet' : 'neutral'
              }
            />
          </Row>
        ))}
        {jobs.data?.length === 0 ? <AppText color={colors.inkMuted}>No jobs yet.</AppText> : null}
      </Section>

      <Section title="Warnings and errors">
        {(events.data ?? []).slice(0, 15).map((event) => (
          <View key={event.id}>
            <Row>
              <Badge label={event.level} tone={event.level === 'error' ? 'busy' : 'warning'} />
              <AppText variant="label">{event.code}</AppText>
              <AppText variant="caption" color={colors.inkMuted}>
                {shortDate(event.created_at)}
              </AppText>
            </Row>
            {event.message ? <AppText variant="caption">{event.message}</AppText> : null}
          </View>
        ))}
        {events.data?.length === 0 ? (
          <AppText color={colors.inkMuted}>Nothing logged.</AppText>
        ) : null}
      </Section>

      <Section title="Source rules">
        <AppText variant="caption" color={colors.inkMuted}>
          Lead only: a link may be saved as a lead, but the page is never fetched. Block: never used
          at all.
        </AppText>
        {(rules.data ?? []).map((item) => (
          <Row key={item.domain} style={{ justifyContent: 'space-between' }}>
            <AppText style={{ flex: 1 }}>{item.domain}</AppText>
            <Badge
              label={item.rule.replace('_', ' ')}
              tone={item.rule === 'allow' ? 'quiet' : item.rule === 'block' ? 'busy' : 'warning'}
            />
          </Row>
        ))}
        <Field
          label="Domain"
          placeholder="example.com"
          value={domain}
          onChangeText={setDomain}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Row>
          {RULES.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={rule === value}
              onPress={() => setRule(value)}
            />
          ))}
        </Row>
        <Button
          label="Save rule"
          kind="secondary"
          disabled={domain.trim().length < 4}
          onPress={() =>
            void act(async () => {
              await adminApi.setDomainRule(domain, rule, null);
              setDomain('');
            }, 'Rule saved.')
          }
        />
      </Section>

      <ReasonSheet
        visible={toggle != null}
        title={toggle?.enable ? `Re-enable ${toggle.adapter}` : `Stop ${toggle?.adapter ?? ''}`}
        label="Why?"
        confirmLabel="Confirm"
        onClose={() => setToggle(null)}
        onConfirm={async (note) => {
          if (!toggle) return;
          await adminApi.setAdapter(toggle.adapter, toggle.enable, note);
          await refresh();
        }}
      />
    </Screen>
  );
}
