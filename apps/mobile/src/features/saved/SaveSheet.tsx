import type { SpotDetail } from '@gupit/shared';
import { useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { AppText, Button, Chip, Field, Row } from '@/components/ui';
import { track } from '@/lib/analytics';
import { LocalStoreError } from '@/lib/db';
import { useListIdsContaining, useSavedLists, useSavedMutations } from '@/lib/hooks';
import { colors } from '@/theme/tokens';

/** Choose which lists a place is in. Lists live on the phone; signing in is optional. */
export function SaveSheet({
  visible,
  onClose,
  detail,
}: {
  visible: boolean;
  onClose: () => void;
  detail: SpotDetail;
}) {
  const lists = useSavedLists();
  const containing = useListIdsContaining(detail.id);
  const { save, unsave, createList } = useSavedMutations();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const list = await createList.mutateAsync(name);
      await save.mutateAsync({ listId: list.id, detail });
      track('spot_saved', { category: detail.category.slug });
      setName('');
    } catch (e) {
      setError(e instanceof LocalStoreError ? e.message : 'Could not create the list.');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Save to a list">
      <AppText variant="caption" color={colors.inkMuted}>
        Lists are kept on this phone and work offline. No account needed.
      </AppText>
      <Row>
        {(lists.data ?? []).map((list) => {
          const saved = containing.data?.includes(list.id) ?? false;
          return (
            <Chip
              key={list.id}
              label={list.name}
              selected={saved}
              onPress={() => {
                if (saved) {
                  unsave.mutate({ listId: list.id, spotId: detail.id });
                  track('spot_unsaved', { category: detail.category.slug });
                } else {
                  save.mutate({ listId: list.id, detail });
                  track('spot_saved', { category: detail.category.slug });
                }
              }}
            />
          );
        })}
      </Row>
      <Field
        label="New list"
        placeholder="Weekend ideas"
        value={name}
        onChangeText={setName}
        maxLength={40}
        error={error}
        returnKeyType="done"
        onSubmitEditing={() => void create()}
      />
      <Button
        label="Create and save"
        kind="secondary"
        icon="add"
        disabled={name.trim().length === 0}
        loading={createList.isPending}
        onPress={() => void create()}
      />
      <Button label="Done" onPress={onClose} />
    </Sheet>
  );
}
