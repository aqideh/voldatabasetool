import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Group,
  NumberInput,
  Stack,
  TagsInput,
  Textarea,
  TextInput,
} from '@mantine/core';
import { updateVolunteer } from './api';
import type { VolunteerRow, VolunteerUpdate } from '../../lib/types';

interface Props {
  volunteer: VolunteerRow | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (row: VolunteerRow) => void;
}

function toNullable(value: string) {
  const cleaned = value.trim();
  return cleaned || null;
}

export function VolunteerDrawer({ volunteer, canWrite, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [recruitedYear, setRecruitedYear] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [programmes, setProgrammes] = useState<string[]>([]);
  const [shirtSize, setShirtSize] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (!volunteer) return;
    setName(volunteer.name);
    setEmail(volunteer.email || '');
    setPhone(volunteer.phone || '');
    setGender(volunteer.gender || '');
    setRecruitedYear(volunteer.recruited_year);
    setTags(volunteer.tags || []);
    setProgrammes(volunteer.programmes_registered || []);
    setShirtSize(volunteer.shirt_size || '');
    setNotes(volunteer.notes || '');
    setMessage(null);
  }, [volunteer]);

  async function save() {
    if (!volunteer || !canWrite) return;
    if (!name.trim()) {
      setMessage({ kind: 'error', text: 'Name is required.' });
      return;
    }

    const update: VolunteerUpdate = {
      name: name.trim(),
      email: toNullable(email),
      phone: toNullable(phone),
      gender: toNullable(gender),
      recruited_year: recruitedYear,
      tags: tags.map((item) => item.trim()).filter(Boolean),
      programmes_registered: programmes.map((item) => item.trim()).filter(Boolean),
      shirt_size: toNullable(shirtSize),
      notes: toNullable(notes),
    };

    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateVolunteer(volunteer.id, volunteer.row_version, update);
      setMessage({ kind: 'success', text: 'Volunteer updated.' });
      onSaved(updated);
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not update volunteer.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      opened={!!volunteer}
      onClose={onClose}
      title={volunteer?.name || 'Volunteer'}
      position="right"
      size="lg"
    >
      {volunteer && (
        <Stack gap="md">
          {!canWrite && (
            <Alert color="blue" variant="light">
              You have read-only access. Editors and admins can update volunteer profiles.
            </Alert>
          )}

          {message && (
            <Alert color={message.kind === 'error' ? 'red' : 'green'} variant="light">
              {message.text}
            </Alert>
          )}

          <TextInput label="Name" required value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={!canWrite} />
          <TextInput label="Email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} disabled={!canWrite} />
          <TextInput label="Phone" value={phone} onChange={(event) => setPhone(event.currentTarget.value)} disabled={!canWrite} />

          <Group grow align="flex-start">
            <TextInput label="Gender" value={gender} onChange={(event) => setGender(event.currentTarget.value)} disabled={!canWrite} />
            <NumberInput
              label="Recruited year"
              value={recruitedYear ?? ''}
              min={1900}
              max={2100}
              onChange={(value) => setRecruitedYear(typeof value === 'number' ? value : null)}
              disabled={!canWrite}
            />
            <TextInput label="T-shirt size" value={shirtSize} onChange={(event) => setShirtSize(event.currentTarget.value)} disabled={!canWrite} />
          </Group>

          <TagsInput
            label="Tags"
            description="Press Enter after each tag"
            value={tags}
            onChange={setTags}
            disabled={!canWrite}
            clearable
          />

          <TagsInput
            label="Programmes"
            description="Press Enter after each programme"
            value={programmes}
            onChange={setProgrammes}
            disabled={!canWrite}
            clearable
          />

          <Textarea
            label="Notes"
            minRows={5}
            autosize
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            disabled={!canWrite}
          />

          {canWrite && (
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>Cancel</Button>
              <Button loading={saving} onClick={() => void save()}>Save changes</Button>
            </Group>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
