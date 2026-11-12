import {
  GOA_CENTER,
  cardCrowdLabel,
  type LatLng,
  type SpotCard as SpotCardModel,
} from '@gupit/shared';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  UserLocation,
  type CameraRef,
  type GeoJSONSourceRef,
} from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SpotCard } from '@/components/SpotCard';
import { IconButton } from '@/components/ui';
import { mapStyleUrl } from '@/lib/env';
import type { Bounds } from '@/lib/hooks';
import { colors, spacing } from '@/theme/tokens';

/**
 * Native MapLibre map. Pins come from the viewport query (bounded by the server) and are
 * clustered on the device, so the map never renders an unbounded number of markers.
 * The style URL comes from a production tile provider; attribution stays visible.
 */
export function SpotMap({
  cards,
  fetchedAt,
  position,
  onBoundsChange,
  onOpen,
  onNearMe,
}: {
  cards: SpotCardModel[];
  fetchedAt: number;
  position: LatLng | null;
  onBoundsChange: (bounds: Bounds) => void;
  onOpen: (slug: string) => void;
  onNearMe: () => void;
}) {
  const camera = useRef<CameraRef>(null);
  const source = useRef<GeoJSONSourceRef>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selected = cards.find((c) => c.slug === selectedSlug) ?? null;

  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: cards.map((card) => ({
        type: 'Feature',
        id: card.id,
        geometry: { type: 'Point', coordinates: [card.lng, card.lat] },
        properties: {
          slug: card.slug,
          partner: card.is_partner ? 1 : 0,
          crowd: cardCrowdLabel(card, fetchedAt, Date.now()) ? (card.crowd_level ?? 0) : 0,
          selected: card.slug === selectedSlug ? 1 : 0,
        },
      })),
    }),
    [cards, fetchedAt, selectedSlug],
  );

  // Recentre when a fresh location fix arrives.
  useEffect(() => {
    if (position)
      camera.current?.flyTo({ center: [position.lng, position.lat], zoom: 13, duration: 600 });
  }, [position]);

  const handlePress = useCallback(async (feature: GeoJSON.Feature | undefined) => {
    const props = feature?.properties as
      { cluster?: boolean; cluster_id?: number; slug?: string } | null | undefined;
    if (!feature || !props) return;
    if (props.cluster && props.cluster_id != null && feature.geometry.type === 'Point') {
      const zoom = await source.current?.getClusterExpansionZoom(props.cluster_id);
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      camera.current?.easeTo({
        center: [lng, lat],
        zoom: Math.min((zoom ?? 12) + 0.5, 17),
        duration: 350,
      });
    } else if (props.slug) {
      setSelectedSlug(props.slug);
    }
  }, []);

  return (
    <View style={styles.root}>
      <Map
        style={styles.map}
        mapStyle={mapStyleUrl}
        attribution
        logo={false}
        touchPitch={false}
        accessibilityLabel="Map of places in Goa"
        onPress={() => setSelectedSlug(null)}
        onRegionDidChange={(event) => {
          const [west, south, east, north] = event.nativeEvent.bounds;
          onBoundsChange({ west, south, east, north });
        }}
      >
        <Camera
          ref={camera}
          initialViewState={{ center: [GOA_CENTER.lng, GOA_CENTER.lat], zoom: 8.6 }}
          minZoom={7}
          maxZoom={18}
        />
        {position ? <UserLocation accuracy /> : null}
        <GeoJSONSource
          ref={source}
          id="spots"
          data={data}
          cluster
          clusterRadius={42}
          clusterMaxZoom={13}
          hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}
          onPress={(event) => void handlePress(event.nativeEvent.features[0])}
        >
          <Layer
            id="spot-clusters"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': colors.ink,
              'circle-opacity': 0.9,
              'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 30, 26],
              'circle-stroke-width': 2,
              'circle-stroke-color': colors.surface,
            }}
          />
          <Layer
            id="spot-cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            // Use the exact font stack the base style already loads for its own labels, so
            // the glyphs are guaranteed to exist on the tile provider's font server.
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 13,
              'text-font': ['Noto Sans Regular'],
              // Counts must always draw, even over the base map's own labels.
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{ 'text-color': colors.onPrimary }}
          />
          <Layer
            id="spot-pins"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
              // Partner pins use the accent colour; the Partner label is on the card too.
              'circle-color': [
                'case',
                ['==', ['get', 'partner'], 1],
                colors.accent,
                colors.primary,
              ],
              'circle-radius': ['case', ['==', ['get', 'selected'], 1], 12, 8],
              'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 4, 2],
              'circle-stroke-color': colors.surface,
            }}
          />
        </GeoJSONSource>
      </Map>

      <View style={styles.controls}>
        <IconButton
          icon="locate-outline"
          label="Show places near me"
          onPress={onNearMe}
          active={position != null}
        />
      </View>

      {selected ? (
        <View style={styles.selected}>
          <SpotCard spot={selected} fetchedAt={fetchedAt} onPress={() => onOpen(selected.slug)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  controls: { position: 'absolute', right: spacing.lg, top: spacing.lg },
  selected: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
});
