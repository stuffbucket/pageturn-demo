/**
 * Build a query string from the current help-menu toggle state while
 * preserving every other query param that was already in the URL.
 *
 * The help-menu UX bug this exists to fix:  the old code wrote
 * `location.search = '?fiducials=1'` straight from the checkbox `change`
 * listener.  Assigning to `location.search` triggers a full document
 * navigation, which closes the panel mid-click — sometimes before the
 * checkbox has even visually toggled.  We now route every URL write through
 * an explicit "Save to URL" button, and this pure builder makes the
 * round-trip easy to unit-test.
 *
 * Keys that are *not* set in `flags` are left untouched (so `?session=…`,
 * `?settle=aero`, `?telemetry=1`, and friends survive a save click even
 * though they aren't represented in the help menu).  Keys that are
 * explicitly set to `false` are removed.
 */
export interface ToggleFlags {
  debug?: boolean;
  fiducials?: boolean;
  capture?: boolean;
  developable?: boolean;
}

const FLAG_TO_PARAM: Record<keyof ToggleFlags, string> = {
  debug:       'debug',
  fiducials:   'fiducials',
  capture:     'capture',
  developable: 'dev-surface',
};

export function buildSettingsSearch(
  currentSearch: string,
  flags: ToggleFlags,
): string {
  const params = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch);
  for (const key of Object.keys(flags) as (keyof ToggleFlags)[]) {
    const v = flags[key];
    if (v === undefined) continue;
    const name = FLAG_TO_PARAM[key];
    if (v) params.set(name, '1');
    else   params.delete(name);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Builds a full absolute URL using `buildSettingsSearch`.  Pulled out so the
 * help-menu button can read `location.origin + pathname` once and feed it
 * back into clipboard / `location.href`.
 */
export function buildSettingsUrl(
  loc: { origin: string; pathname: string; search: string; hash: string },
  flags: ToggleFlags,
): string {
  return loc.origin + loc.pathname + buildSettingsSearch(loc.search, flags) + loc.hash;
}
