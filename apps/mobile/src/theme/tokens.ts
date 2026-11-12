/**
 * Design tokens. Components read from here; raw colour or spacing values do not belong
 * in screens. The palette is warm sand, deep ink and sea teal, with a laterite accent,
 * chosen to stay legible outdoors in bright light.
 */
export const colors = {
  background: '#F7F2E9',
  surface: '#FFFDF8',
  surfaceMuted: '#EFE8DA',
  border: '#DDD3BF',
  ink: '#14213D',
  inkMuted: '#4A5568',
  inkFaint: '#6B7280',
  onPrimary: '#FFFFFF',
  primary: '#0E7C7B',
  primaryPressed: '#0A5F5E',
  primarySoft: '#DCEFEE',
  accent: '#B5532A',
  accentSoft: '#F6E3D8',
  crowdQuiet: '#22693F',
  crowdModerate: '#8A5A0B',
  crowdBusy: '#B42318',
  crowdNeutral: '#4A5568',
  danger: '#B42318',
  dangerSoft: '#FBE9E7',
  warningSoft: '#FDF1D7',
  overlay: 'rgba(20, 33, 61, 0.45)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const typography = {
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const;

export const elevation = {
  card: {
    shadowColor: '#14213D',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#14213D',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

/** Minimum comfortable touch target (pt/dp). */
export const touchTarget = 44;

/** Text never scales past this, so large accessibility sizes stay usable without breaking layout. */
export const maxFontScale = 1.8;
