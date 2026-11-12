import { AppText, Card, Notice, Screen, Section } from '@/components/ui';

/**
 * In-app privacy notice. The wording describes what this build actually does. Before public
 * release it needs review by counsel and the contact details filled in (see docs/runbook.md).
 */
export default function Privacy() {
  return (
    <Screen scroll edges={['bottom']}>
      <Notice>Short version: no account, no tracking, no location history, nothing sold.</Notice>

      <Section title="Location">
        <Card>
          <AppText>
            We ask for your location only when you tap Near me, a distance filter, or report how
            busy a place is.
          </AppText>
          <AppText>
            The app takes one reading while it is open. It never tracks you in the background.
          </AppText>
          <AppText>
            For nearby results, your position is sent to our server to sort places by distance and
            is not saved.
          </AppText>
          <AppText>
            For a crowd report, the server checks you are within about 300 m of the place, then
            discards the position. It is not stored with the report.
          </AppText>
          <AppText>
            If you say no, everything else still works: browse all of Goa, filter by area and
            search.
          </AppText>
        </Card>
      </Section>

      <Section title="No account needed, and what stays on your phone">
        <Card>
          <AppText>Browsing, saving and sharing need no sign-up.</AppText>
          <AppText>
            Saved lists and offline copies of places are stored on this phone. Unless you sign in,
            they are not uploaded, and deleting the app deletes them.
          </AppText>
        </Card>
      </Section>

      <Section title="Optional account">
        <Card>
          <AppText>
            You can sign in with your email to back up your saved lists and get them back on another
            phone. We send a one-time code; there is no password.
          </AppText>
          <AppText>
            If you sign in, we store your email address and which places are in which list. Nothing
            else: no location, no browsing history, and your crowd reports are not linked to your
            account.
          </AppText>
          <AppText>
            You can delete your account and its backup at any time from More, then Account. Your
            lists stay on this phone.
          </AppText>
        </Card>
      </Section>

      <Section title="Crowd reports and problem reports">
        <Card>
          <AppText>
            To stop spam, the app creates a random code for this installation. It is not your
            phone's hardware ID or an advertising ID.
          </AppText>
          <AppText>
            The server stores only a one-way hash of that code next to a report. Raw crowd reports
            are deleted after 30 days; only anonymous hourly totals are kept.
          </AppText>
          <AppText>
            Problem reports go to our review team only. Please do not include personal details in
            the note.
          </AppText>
        </Card>
      </Section>

      <Section title="Usage statistics">
        <Card>
          <AppText>
            We count simple events such as a place being opened or a filter used, to improve the
            app. They carry a random code that changes every time you open the app.
          </AppText>
          <AppText>
            They never include your coordinates, what you typed in search, or any message text.
          </AppText>
        </Card>
      </Section>

      <Section title="Partner listings and WhatsApp">
        <Card>
          <AppText>
            Paid listings are always labelled Partner. Tapping Message on WhatsApp opens WhatsApp;
            we record only that the button was tapped. We never see your conversation.
          </AppText>
        </Card>
      </Section>

      <Section title="Services we rely on">
        <Card>
          <AppText>
            Hosting and database: Supabase. Map tiles: the configured map provider, which receives
            map requests from your phone. We do not sell or share personal data or location history
            with anyone.
          </AppText>
        </Card>
      </Section>

      <Section title="Questions or requests">
        <Card>
          <AppText>
            To ask what we hold, request deletion, or raise a concern, use the contact published on
            the app's store page. Because we keep no account and no location history, there is
            usually very little to delete.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}
