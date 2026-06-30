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

The sample attendance download uses the same format.

## Attendance column

The `Attendance` column accepts only:

- `yes`
- blank

A value of `yes` means the volunteer attended. The row contributes to active-volunteer status, last active date, and total hours.

A blank value means the volunteer was confirmed and deployed for the opportunity but did not attend. The row remains in the event log and contributes to deployment counts, but it does not contribute to active-volunteer status, last active date, or total hours.

Any other value is rejected during import preview.

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
- **Total Hours** sums hours only for event log rows where `Attendance` is `yes`.
- **Deployment Rows** counts all event log rows, including blank-attendance no-show rows.

## Export behaviour

The full database export writes attendance data to an `Attendance Event Log` sheet with the import-template columns:

```text
Name, Email, Contact, Attendance, Event Name, Event Date, Hours
```

Volunteer particulars remain in their own sheet. Attendance is not stored as editable nested rows inside volunteer profiles.

## Legacy attendance migration

If an older browser-local save contains nested attendance rows under volunteer records and no `attendanceLog` array, MakLom migrates those legacy rows into `appData.attendanceLog` as attended rows with `Attendance = yes`.
