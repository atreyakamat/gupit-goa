import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { LoadingState, Screen } from '@/components/ui';
import { getLocalStore } from '@/lib/db';

/** First launch goes to the welcome screen; after that, straight to Explore. No sign-up either way. */
export default function Index() {
  const onboarded = useQuery({
    queryKey: ['setting', 'onboarded'],
    queryFn: async () => (await (await getLocalStore()).getSetting('onboarded')) === '1',
  });
  if (onboarded.isPending) {
    return (
      <Screen>
        <LoadingState label="Opening Gupit Goa" />
      </Screen>
    );
  }
  // If local storage fails, do not block the app: go to Explore.
  return <Redirect href={onboarded.data === false ? '/welcome' : '/(tabs)'} />;
}
