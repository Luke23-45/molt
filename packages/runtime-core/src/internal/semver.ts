// The only file allowed to import `semver` (ADR-02, plan 03 §9). Range and
// version validation happen once, at definition-validation time; resolution
// only calls satisfiesRange. Ad-hoc version comparison is forbidden (note 04).

import { satisfies, valid, validRange } from 'semver';

export function isValidVersion(version: string): boolean {
  return valid(version) !== null;
}

export function isValidRange(range: string): boolean {
  return validRange(range) !== null;
}

export function satisfiesRange(version: string, range: string): boolean {
  return satisfies(version, range);
}
