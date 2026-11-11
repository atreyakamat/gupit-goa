import { CROWD_RULES } from '@gupit/shared';
import { AppText, Card, Screen, Section } from '@/components/ui';

export default function About() {
  return (
    <Screen scroll edges={['bottom']}>
      <Section title="What Gupit Goa is">
        <Card>
          <AppText>
            A guide to places in Goa: the well-known ones and the lesser-known ones, side by side.
            Cafés, restaurants, beaches, forts, nightlife, markets, nature and things to do.
          </AppText>
        </Card>
      </Section>

      <Section title="How a place gets listed">
        <Card>
          <AppText>
            Places are suggested by our research and by local tips. A suggestion is not a listing.
          </AppText>
          <AppText>
            A person on our team checks every place before it appears: that it exists, where the pin
            is, that the public can go there, how to reach it, and what to be careful about.
          </AppText>
          <AppText>
            Nature, swimming and trail spots need a visit by us or confirmation from an authority.
          </AppText>
          <AppText>
            Each page shows the date it was last checked. If we have not verified a fact, we say
            "Not verified" instead of guessing.
          </AppText>
        </Card>
      </Section>

      <Section title="What we do not list">
        <Card>
          <AppText>
            Turtle nesting beaches and other fragile habitats, private property, residential lanes,
            places with unsafe access, and anywhere a community has asked us not to promote.
          </AppText>
        </Card>
      </Section>

      <Section title="What crowd levels mean">
        <Card>
          <AppText>
            Quiet, Moderate or Busy "now" appears only when at least{' '}
            {CROWD_RULES.minDistinctReports} different people who were at the place reported in the
            last {CROWD_RULES.windowMinutes / 60} hours.
          </AppText>
          <AppText>
            Each report is checked to be within about {CROWD_RULES.proximityMetres} m of the place.
            Views and taps are never counted as crowd.
          </AppText>
          <AppText>
            If reports disagree we say "Mixed reports". If there are too few, we say the status is
            unavailable. A "usually busy" note is a guide, and is labelled as one.
          </AppText>
        </Card>
      </Section>

      <Section title="Partner listings">
        <Card>
          <AppText>
            Some businesses pay to be featured. They are always labelled Partner. Paying does not
            change a place's crowd level, safety notes, verification or position in results.
          </AppText>
        </Card>
      </Section>

      <Section title="Something wrong?">
        <Card>
          <AppText>
            Every place page has "Report a problem". Safety reports are looked at first, and a
            listing can be taken down while we check.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}
