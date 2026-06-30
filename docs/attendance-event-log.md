# Attendance Event Log

MakLom treats attendance as a separate event log database, stored in `appData.attendanceLog`.

## Import template

Attendance event log imports must use these exact columns in this exact order:

1. Name
2. Email
3. Contact
4. Attendance
5. Event Name
6. Event Date
7. Hours
8. Minutes

The sample attendance download uses the same format.

## Attendance column

The `Attendance` column accepts only:

- `yes`
- blank

A value of `yes` means the volunteer attended. The row contributes to active-volunteer status, last active date, and total duration.

A blank value means the volunteer was confirmed and deployed for the opportunity but did not attend. The row remains in the event log and contributes to deployment counts, but it does not contribute to active-volunteer status, last active date, or total duration.

Any other value is rejected during import preview.

## Duration fields

Duration is entered through two columns:

- `Hours`
- `Minutes`

Rules:

- `Hours` must be a whole number from `0` to the app's maximum-hours limit.
- `Minutes` must be a whole number from `0` to `59`.
- Minutes are not normalised upward. A value of `60` or higher is rejected.
- If `Attendance` is blank, the stored duration is `0` minutes.
- If `Attendance` is `yes`, MakLom stores the row internally as total `durationMinutes`.

Example:

```text
Hours = 4, Minutes = 30
Stored durationMinutes = 270
Displayed duration = 4h 30m
Decimal Hours export = 4.5
```

There is no hours-only fallback. Event log rows are validated against the `Hours` + `Minutes` model.

## Event Log tab

Use the **Event Log** tab to view and edit attendance event log rows in the app.

The tab supports:

- Search across name, email, contact, attendance, event name, event date, and duration
- Attendance filter for all rows, `yes`, or blank/no-show rows
- Clear event log filters
- Add event log row
- Inline editing for all event log fields
- Separate editable `Hours` and `Minutes` fields
- Delete event log row
- Summary counts for total rows, attended rows, blank/no-show rows, visible rows, and total attended duration

Edits are saved to browser localStorage immediately. Dashboard and Central Database attendance metrics refresh after edits.

## Unmatched volunteers

When an attendance event log row refers to a volunteer who does not exist in the Central Database, MakLom creates a minimal placeholder volunteer profile using the row's name, email, and contact.

The placeholder volunteer is tagged:

```text
needs profile update
```

The placeholder profile also receives this note:

```text
Created from attendance event log import. Update volunteer profile.
```

This prevents deployed or attended volunteers from being lost just because the roster import was incomplete. Use the tag filter to find these profiles and complete their missing details.

## Dashboard definitions

- **Volunteers Deployed by Year** counts unique volunteers appearing in the attendance event log for that event year, whether `Attendance` is `yes` or blank.
- **Active** counts unique volunteers with at least one event log row where `Attendance` is `yes`.
- **Total Duration** sums `durationMinutes` only for event log rows where `Attendance` is `yes`.
- **Decimal Hours** is calculated from total attended minutes.
- **Deployment Rows** counts all event log rows, including blank-attendance no-show rows.

## Export behaviour

The full database export writes attendance data to an `Attendance Event Log` sheet with these columns:

```text
Name, Email, Contact, Attendance, Event Name, Event Date, Hours, Minutes, Decimal Hours, Duration Minutes
```

Volunteer particulars remain in their own sheet. Attendance is not stored as editable nested rows inside volunteer profiles.
