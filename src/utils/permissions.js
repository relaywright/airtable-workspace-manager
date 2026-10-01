/**
 * Friendly labels and badge colors for Airtable permission levels.
 * The Airtable API reports levels as none | read | comment | edit | create;
 * "owner" is included for completeness with Airtable's own UI wording.
 */
const PERMISSION_LEVELS = {
  owner: { label: 'Owner', classes: 'bg-success/20 text-success' },
  create: { label: 'Creator', classes: 'bg-success/20 text-success' },
  edit: { label: 'Editor', classes: 'bg-accent/20 text-accent' },
  comment: { label: 'Commenter', classes: 'bg-warning/20 text-warning' },
  read: { label: 'Read only', classes: 'bg-surfaceLight text-textMuted' },
  none: { label: 'No access', classes: 'bg-surfaceLight text-textMuted' },
};

/**
 * @param {string | null | undefined} level - raw permission level from the Airtable API
 * @returns {{ label: string, classes: string } | null} null when the level is missing or unrecognized
 */
export function getPermissionInfo(level) {
  return (level && PERMISSION_LEVELS[level]) || null;
}
