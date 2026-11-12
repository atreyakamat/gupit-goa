import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText, Button, Field, Notice, Screen } from '@/components/ui';
import { signInReviewer } from '@/features/admin/session';
import { isBackendConfigured } from '@/lib/env';
import { colors } from '@/theme/tokens';

/** Reviewers only. Accounts are created by hand; there is no sign-up and guests never see a login wall. */
export default function TeamSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'invalid' | 'not_admin' | 'error'>('idle');

  const submit = async () => {
    setState('busy');
    try {
      const result = await signInReviewer(email, password);
      if (result === 'ok') router.replace('/admin');
      else setState(result);
    } catch {
      setState('error');
    }
  };

  return (
    <Screen scroll edges={['bottom']}>
      <AppText color={colors.inkMuted}>
        For the Gupit Goa review team. You do not need an account to use the app.
      </AppText>
      {!isBackendConfigured ? (
        <Notice tone="warning">This build is not connected to a backend.</Notice>
      ) : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
      />
      {state === 'invalid' ? <Notice tone="warning">Email or password is not right.</Notice> : null}
      {state === 'not_admin' ? (
        <Notice tone="warning">That account is not on the reviewer list.</Notice>
      ) : null}
      {state === 'error' ? (
        <Notice tone="warning">Could not sign in. Check your connection.</Notice>
      ) : null}
      <Button
        label="Sign in"
        disabled={!isBackendConfigured || !email.trim() || !password}
        loading={state === 'busy'}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
