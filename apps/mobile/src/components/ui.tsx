import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import {
  colors,
  elevation,
  maxFontScale,
  radius,
  spacing,
  touchTarget,
  typography,
} from '@/theme/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// -- Text ---------------------------------------------------------------------

type Variant = keyof typeof typography;

export function AppText({
  variant = 'body',
  color = colors.ink,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  return (
    <Text
      maxFontSizeMultiplier={maxFontScale}
      {...rest}
      style={[typography[variant] as TextStyle, { color }, style]}
    />
  );
}

// -- Layout -------------------------------------------------------------------

export function Screen({
  children,
  scroll = false,
  edges = ['top'],
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
}) {
  const content = padded ? styles.padded : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[content, styles.scrollContent]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, content]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="subheading" accessibilityRole="header" style={styles.flex}>
          {title}
        </AppText>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

// -- Controls -----------------------------------------------------------------

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled = false,
  loading = false,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const foreground =
    kind === 'primary'
      ? colors.onPrimary
      : kind === 'danger'
        ? colors.danger
        : kind === 'ghost'
          ? colors.primary
          : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
        kind === 'secondary' && styles.buttonSecondary,
        kind === 'danger' && styles.buttonDanger,
        kind === 'ghost' && styles.buttonGhost,
        pressed && kind !== 'primary' && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={foreground} /> : null}
          <AppText variant="label" color={foreground} style={styles.buttonLabel}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        active && styles.iconButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? colors.primary : colors.ink} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      {/* Selection is shown with a tick as well as colour. */}
      {selected ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
      {!selected && icon ? <Ionicons name={icon} size={14} color={colors.ink} /> : null}
      <AppText variant="label" color={selected ? colors.onPrimary : colors.ink}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'primary' | 'accent' | 'quiet' | 'moderate' | 'busy' | 'warning';
  icon?: IconName;
}) {
  const palette = {
    neutral: [colors.surfaceMuted, colors.ink],
    primary: [colors.primarySoft, colors.primaryPressed],
    accent: [colors.accentSoft, colors.accent],
    quiet: ['#DDF1E4', colors.crowdQuiet],
    moderate: [colors.warningSoft, colors.crowdModerate],
    busy: [colors.dangerSoft, colors.crowdBusy],
    warning: [colors.warningSoft, colors.crowdModerate],
  } as const;
  const [background, foreground] = palette[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      {icon ? <Ionicons name={icon} size={12} color={foreground} /> : null}
      <AppText variant="caption" color={foreground} style={styles.badgeText}>
        {label}
      </AppText>
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.inkFaint}
        maxFontSizeMultiplier={maxFontScale}
        {...input}
        style={[
          styles.input,
          input.multiline && styles.inputMultiline,
          error ? styles.inputError : null,
          input.style,
        ]}
      />
      {error ? (
        <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={colors.inkMuted}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// -- States -------------------------------------------------------------------

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.state} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} />
      <AppText color={colors.inkMuted}>{label}</AppText>
    </View>
  );
}

export function EmptyState({
  icon = 'compass-outline',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.state}>
      <Ionicons name={icon} size={36} color={colors.inkFaint} />
      <AppText variant="subheading" style={styles.center}>
        {title}
      </AppText>
      {body ? (
        <AppText color={colors.inkMuted} style={styles.center}>
          {body}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={title}
      body={body ?? 'Check your connection and try again.'}
      action={
        onRetry ? (
          <Button label="Try again" kind="secondary" icon="refresh" onPress={onRetry} />
        ) : undefined
      }
    />
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const background =
    tone === 'danger'
      ? colors.dangerSoft
      : tone === 'warning'
        ? colors.warningSoft
        : colors.primarySoft;
  const icon: IconName = tone === 'info' ? 'information-circle-outline' : 'warning-outline';
  return (
    <View style={[styles.notice, { backgroundColor: background }]}>
      <Ionicons name={icon} size={18} color={colors.ink} />
      <AppText variant="caption" style={styles.flex}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.xxl, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...elevation.card,
  },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  button: {
    minHeight: touchTarget + 4,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.dangerSoft },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonLabel: { fontSize: 15 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconButtonActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeText: { fontWeight: '600' },
  field: { gap: spacing.xs },
  input: {
    minHeight: touchTarget + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    minHeight: 220,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
});
