import { PROBLEM_TYPES, PROBLEM_TYPE_TEXT, type ProblemType } from '@gupit/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText, Button, Chip, Field, Notice, Row, Screen, Section } from '@/components/ui';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { isPreviewMode } from '@/lib/env';
import { colors } from '@/theme/tokens';

/** Sends a private note to the review team. There are no public comments in this app. */
export default function Report() {
  const { spotId, name } = useLocalSearchParams<{ spotId: string; name?: string }>();
  const router = useRouter();
  const [type, setType] = useState<ProblemType | null>(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'limited'>('idle');

  const send = async () => {
    if (!type) return;
    setState('sending');
    try {
      const result = await api.submitProblem({ spotId, type, message: message.trim() || null });
      if (result.accepted) {
        track('problem_report_submitted', { type });
        setState('sent');
      } else {
        setState(result.reason === 'rate_limited' ? 'limited' : 'error');
      }
    } catch {
      setState('error');
    }
  };

  if (state === 'sent') {
    return (
      <Screen scroll edges={['bottom']}>
        <Notice>Thank you. A reviewer will look at this. Safety reports are checked first.</Notice>
        <Button label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['bottom']}>
      <Section title={name ? `What is wrong with ${name}?` : 'What is wrong?'}>
        <Row>
          {PROBLEM_TYPES.map((option) => (
            <Chip
              key={option}
              label={PROBLEM_TYPE_TEXT[option]}
              selected={type === option}
              onPress={() => setType(option)}
            />
          ))}
        </Row>
      </Section>
      <Field
        label="Anything we should know? (optional)"
        hint="Please do not include personal details. This goes only to our review team."
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={1000}
      />
      {state === 'error' ? (
        <Notice tone="warning">That could not be sent. Check your connection and try again.</Notice>
      ) : null}
      {state === 'limited' ? (
        <Notice tone="warning">
          You have sent several reports in the last hour. Please try again later.
        </Notice>
      ) : null}
      {isPreviewMode ? (
        <Notice>
          Preview build: reports are switched off because there is no backend to send to.
        </Notice>
      ) : null}
      <Button
        label="Send report"
        icon="send-outline"
        disabled={!type || isPreviewMode}
        loading={state === 'sending'}
        onPress={() => void send()}
      />
      <AppText variant="caption" color={colors.inkMuted}>
        No account or contact details are needed. We keep an anonymous device code only to prevent
        spam.
      </AppText>
    </Screen>
  );
}
