import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from 'react-native';
import { AppText, Button, Card, Field, Notice, Screen, Section } from '@/components/ui';
import {
  deleteAccount,
  requestSignInCode,
  signOutAccount,
  syncAccount,
  verifySignInCode,
} from '@/features/account/session';
import type { SyncResult } from '@/features/account/sync';
import { describeAuthError, isValidEmail, normalizeCode } from '@/features/account/validate';
import { isBackendConfigured } from '@/lib/env';
import { useAppStore } from '@/store/app';
import { colors } from '@/theme/tokens';

function describeSync(result: SyncResult): string {
  const parts = [
    result.uploaded === 0
      ? 'Nothing on this phone to back up yet.'
      : `${result.uploaded} saved place${result.uploaded === 1 ? ' is' : 's are'} backed up.`,
  ];
  if (result.restored > 0) {
    parts.push(`${result.restored} added to this phone from your account.`);
  }
  if (result.unavailable > 0) {
    parts.push(`${result.unavailable} could not be loaded and will be tried again.`);
  }
  return parts.join(' ');
}

/** Optional. Guests never see this unless they open it from More. */
export default function Account() {
  const client = useQueryClient();
  const accountEmail = useAppStore((s) => s.accountEmail);
  const isAdmin = useAppStore((s) => s.isAdmin);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState<null | 'send' | 'verify' | 'sync' | 'out' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(describeAuthError(e));
    } finally {
      setBusy(null);
    }
  };

  const backUp = async () => {
    const result = await syncAccount();
    await client.invalidateQueries({ queryKey: ['saved'] });
    if (result) setMessage(describeSync(result));
  };

  const sendCode = () =>
    run('send', async () => {
      await requestSignInCode(email);
      setCode('');
      setStep('code');
      setMessage(null);
    });

  const verify = () =>
    run('verify', async () => {
      await verifySignInCode(email, code);
      setStep('email');
      setEmail('');
      setCode('');
      // Signing in worked; a backup hiccup is reported on its own and retried later.
      await backUp().catch(() =>
        setMessage('You are signed in. The first backup will run when you are back online.'),
      );
    });

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'This deletes your account and its backup for good. Your lists stay on this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () =>
            void run('delete', async () => {
              await deleteAccount();
              setMessage('Your account and its backup were deleted.');
            }),
        },
      ],
    );

  if (!isBackendConfigured) {
    return (
      <Screen scroll edges={['bottom']}>
        <Notice tone="warning">
          This is a preview build with sample places, so accounts are switched off. Everything else
          works without one.
        </Notice>
      </Screen>
    );
  }

  if (accountEmail) {
    return (
      <Screen scroll edges={['bottom']}>
        <Section title="Signed in">
          <Card>
            <AppText variant="subheading">{accountEmail}</AppText>
            <AppText color={colors.inkMuted}>
              Your saved lists are backed up and will appear on any phone where you sign in.
            </AppText>
          </Card>
        </Section>
        {message ? <Notice>{message}</Notice> : null}
        {error ? <Notice tone="warning">{error}</Notice> : null}
        <Button
          label="Back up now"
          icon="cloud-upload-outline"
          loading={busy === 'sync'}
          disabled={busy !== null}
          onPress={() => void run('sync', backUp)}
        />
        <Button
          label="Sign out"
          kind="secondary"
          loading={busy === 'out'}
          disabled={busy !== null}
          accessibilityHint="Your lists stay on this phone"
          onPress={() =>
            void run('out', async () => {
              await signOutAccount();
              setMessage('Signed out. Your lists are still on this phone.');
            })
          }
        />
        {isAdmin ? null : (
          <Button
            label="Delete account"
            kind="danger"
            loading={busy === 'delete'}
            disabled={busy !== null}
            onPress={confirmDelete}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['bottom']}>
      <AppText color={colors.inkMuted}>
        You never need an account to use Gupit Goa. Sign in only if you want your saved lists backed
        up and available on another phone.
      </AppText>
      {message ? <Notice>{message}</Notice> : null}
      {step === 'email' ? (
        <>
          <Field
            label="Email"
            hint="We send a one-time code. No password."
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={() => (isValidEmail(email) ? void sendCode() : undefined)}
          />
          {error ? <Notice tone="warning">{error}</Notice> : null}
          <Button
            label="Send code"
            icon="mail-outline"
            disabled={!isValidEmail(email) || busy !== null}
            loading={busy === 'send'}
            onPress={() => void sendCode()}
          />
        </>
      ) : (
        <>
          <Notice>We sent a code to {email.trim().toLowerCase()}. It can take a minute.</Notice>
          <Field
            label="Code from the email"
            value={code}
            onChangeText={(text) => setCode(normalizeCode(text))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
            maxLength={10}
          />
          {error ? <Notice tone="warning">{error}</Notice> : null}
          <Button
            label="Sign in"
            disabled={code.length < 6 || busy !== null}
            loading={busy === 'verify'}
            onPress={() => void verify()}
          />
          <Button
            label="Use a different email"
            kind="ghost"
            disabled={busy !== null}
            onPress={() => {
              setStep('email');
              setError(null);
            }}
          />
        </>
      )}
      <AppText variant="caption" color={colors.inkMuted}>
        We store your email and which places are in which list. Nothing else. You can delete the
        account at any time.
      </AppText>
    </Screen>
  );
}
