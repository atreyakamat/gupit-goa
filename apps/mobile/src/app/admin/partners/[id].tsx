import { normaliseWhatsAppNumber } from '@gupit/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AppText,
  Button,
  Card,
  Chip,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
} from '@/components/ui';
import { adminApi, adminErrorText } from '@/features/admin/api';
import { FormField, shortDate } from '@/features/admin/ui';
import { colors } from '@/theme/tokens';

interface FormValues {
  business_name: string;
  whatsapp_number: string;
  website_url: string;
  plan: string;
  starts_at: string;
  ends_at: string;
  label_text: string;
}

const STATUSES: [string, string][] = [
  ['pilot', 'Pilot (free)'],
  ['active', 'Active'],
  ['paused', 'Paused'],
  ['ended', 'Ended'],
];

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const isDate = (text: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));

export default function PartnerEditor() {
  const params = useLocalSearchParams<{ id: string; spotId?: string; spotName?: string }>();
  const isNew = params.id === 'new';
  const router = useRouter();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'partners'],
    queryFn: adminApi.partners,
    enabled: !isNew,
  });
  const partner = list.data?.find((p) => p.id === params.id);
  const { control, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: {
      business_name: '',
      whatsapp_number: '',
      website_url: '',
      plan: '',
      starts_at: dateOnly(new Date().toISOString()),
      ends_at: '',
      label_text: 'Partner',
    },
  });
  const [status, setStatus] = useState('pilot');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ claim_code: string; expires_at: string } | null>(null);

  useEffect(() => {
    if (partner) {
      reset({
        business_name: partner.business_name,
        whatsapp_number: partner.whatsapp_number,
        website_url: partner.website_url ?? '',
        plan: partner.plan ?? '',
        starts_at: dateOnly(partner.starts_at),
        ends_at: dateOnly(partner.ends_at),
        label_text: partner.label_text,
      });
      setStatus(partner.partner_status);
    }
  }, [partner, reset]);

  if (!isNew && list.isPending)
    return (
      <Screen edges={['bottom']}>
        <LoadingState />
      </Screen>
    );

  const save = handleSubmit(async (values) => {
    setError(null);
    const number = normaliseWhatsAppNumber(values.whatsapp_number);
    if (!number)
      return setError('Enter a valid WhatsApp number, with country code if it is not Indian.');
    if (!isDate(values.starts_at) || (values.ends_at && !isDate(values.ends_at)))
      return setError('Dates must look like 2026-12-01.');
    if (values.website_url && !/^https:\/\//i.test(values.website_url))
      return setError('The website must start with https://');
    if (!/partner|sponsored/i.test(values.label_text))
      return setError('The label must say Partner or Sponsored so it is clear to users.');
    setBusy(true);
    try {
      const data: Record<string, unknown> = {
        business_name: values.business_name,
        whatsapp_number: number,
        website_url: values.website_url || null,
        plan: values.plan || null,
        partner_status: status,
        starts_at: `${values.starts_at}T00:00:00+05:30`,
        ends_at: values.ends_at ? `${values.ends_at}T23:59:59+05:30` : null,
        label_text: values.label_text,
      };
      if (isNew) data.spot_id = params.spotId;
      const id = await adminApi.savePartner(isNew ? null : params.id, data);
      await client.invalidateQueries({ queryKey: ['admin'] });
      if (isNew) router.replace(`/admin/partners/${id}`);
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  });

  const issue = async () => {
    setError(null);
    try {
      setCode(await adminApi.issueClaimCode(params.id));
    } catch (e) {
      setError(adminErrorText(e));
    }
  };

  return (
    <Screen scroll edges={['bottom']}>
      <AppText color={colors.inkMuted}>
        {isNew
          ? `New partner for ${params.spotName ?? 'this place'}`
          : `Listing: ${partner?.spots?.name ?? ''}`}
      </AppText>
      <Notice>
        Partners are always labelled in the app. Prices and plans are recorded for reference only;
        nothing here changes ranking or crowd data.
      </Notice>
      <FormField control={control} name="business_name" label="Business name" required />
      <FormField
        control={control}
        name="whatsapp_number"
        label="WhatsApp number"
        keyboardType="phone-pad"
        hint="The number enquiries should open a chat with"
        required
      />
      <FormField
        control={control}
        name="website_url"
        label="Website (optional)"
        keyboardType="url"
      />
      <FormField
        control={control}
        name="label_text"
        label="Label shown to users"
        hint="Must contain Partner or Sponsored"
        required
      />
      <FormField control={control} name="plan" label="Plan note (internal)" />
      <AppText variant="label">Status</AppText>
      <Row>
        {STATUSES.map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            selected={status === value}
            onPress={() => setStatus(value)}
          />
        ))}
      </Row>
      <FormField control={control} name="starts_at" label="Starts (YYYY-MM-DD)" required />
      <FormField
        control={control}
        name="ends_at"
        label="Ends (YYYY-MM-DD, optional)"
        hint="The label and WhatsApp button disappear after this date."
      />
      {error ? <Notice tone="warning">{error}</Notice> : null}
      <Button
        label={isNew ? 'Create partner' : 'Save partner'}
        loading={busy}
        onPress={() => void save()}
      />

      {!isNew ? (
        <Section title="Partner staff devices">
          <Card>
            <AppText>
              Give staff a one-time code to enter under More, Link partner device. Linked phones
              cannot submit crowd reports for this listing.
            </AppText>
            {code ? (
              <>
                <AppText
                  variant="title"
                  selectable
                  accessibilityLabel={`Code ${code.claim_code.split('').join(' ')}`}
                >
                  {code.claim_code}
                </AppText>
                <AppText variant="caption" color={colors.inkMuted}>
                  Valid until {shortDate(code.expires_at)}. A new code replaces the old one.
                </AppText>
              </>
            ) : null}
            <Button
              label={code ? 'Issue a new code' : 'Issue a code'}
              kind="secondary"
              icon="key-outline"
              onPress={() => void issue()}
            />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
