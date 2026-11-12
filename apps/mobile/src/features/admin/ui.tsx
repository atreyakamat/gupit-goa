import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { AppText, Button, Field, Notice } from '@/components/ui';
import { colors, radius, spacing, touchTarget } from '@/theme/tokens';
import { adminErrorText } from './api';

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <AppText variant="subheading" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.inkMuted} numberOfLines={3}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} /> : null}
    </Pressable>
  );
}

/** Asks for the note or reason that the audit log records with a sensitive action. */
export function ReasonSheet({
  visible,
  title,
  label = 'Reason',
  confirmLabel,
  required = true,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  label?: string;
  confirmLabel: string;
  required?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Field
        label={label}
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={500}
        hint="Saved in the audit log."
      />
      {error ? <Notice tone="warning">{error}</Notice> : null}
      <Button
        label={confirmLabel}
        disabled={required && reason.trim().length === 0}
        loading={busy}
        onPress={() => void confirm()}
      />
    </Sheet>
  );
}

/** react-hook-form text field. */
export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  multiline,
  keyboardType,
  required,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  hint?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'url' | 'phone-pad';
  required?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      rules={required ? { required: `${label} is required` } : undefined}
      render={({ field, fieldState }) => (
        <Field
          label={label}
          hint={hint}
          value={(field.value as string | undefined) ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={keyboardType === 'url' ? 'none' : undefined}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

export const csv = (list: string[] | null | undefined) => (list ?? []).join(', ');
export const fromCsv = (text: string) =>
  text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
export const shortDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'never';

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
  },
  pressed: { opacity: 0.75 },
});
