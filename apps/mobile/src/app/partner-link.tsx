import { useState } from 'react';
import { AppText, Button, Field, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { colors } from '@/theme/tokens';

/**
 * Partner staff enter a one-time code from our team. Their device is then excluded from
 * crowd reports on their own business, so a partner cannot influence its crowd level.
 */
export default function PartnerLink() {
  const [code, setCode] = useState('');
  const [state, setState] = useState<
    { kind: 'idle' | 'busy' | 'bad' | 'error' } | { kind: 'linked'; name: string }
  >({ kind: 'idle' });

  const submit = async () => {
    setState({ kind: 'busy' });
    try {
      const result = await api.linkPartnerDevice(code);
      setState(
        result.linked
          ? { kind: 'linked', name: result.business_name ?? 'your business' }
          : { kind: 'bad' },
      );
    } catch {
      setState({ kind: 'error' });
    }
  };

  return (
    <Screen scroll edges={['bottom']}>
      <AppText>
        For partner businesses only. Enter the code our team gave you. This phone will then be
        unable to submit crowd reports for your own listing, which keeps crowd levels independent.
      </AppText>
      <Field
        label="Partner code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
      />
      {state.kind === 'linked' ? <Notice>This device is now linked to {state.name}.</Notice> : null}
      {state.kind === 'bad' ? (
        <Notice tone="warning">
          That code is not valid or has expired. Ask our team for a new one.
        </Notice>
      ) : null}
      {state.kind === 'error' ? (
        <Notice tone="warning">Could not check the code. Try again when you are online.</Notice>
      ) : null}
      <Button
        label="Link this device"
        disabled={code.trim().length < 6}
        loading={state.kind === 'busy'}
        onPress={() => void submit()}
      />
      <AppText variant="caption" color={colors.inkMuted}>
        Linking does not share any personal information.
      </AppText>
    </Screen>
  );
}
